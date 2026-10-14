import { useState } from "react";
import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import { PostgreSQL, schemaCompletionSource, sql } from "@codemirror/lang-sql";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { expect, test } from "vitest";
import type { AppError, RunResponse, ScriptOutcome } from "@/bindings";
import { tagNames, textToRun, toNamespace } from "@/features/editor/SqlEditor";
import { SqlWorkspace } from "@/features/editor/SqlWorkspace";
import { callsTo, executed, fakeBackend, prodPostgres, rowsOutcome } from "@/test/fakeBackend";
import { renderWithClient } from "@/test/render";

function Workspace({ initialSql }: { initialSql: string }) {
  const [sql, setSql] = useState(initialSql);
  return (
    <SqlWorkspace
      connectionId="pg-1"
      engine="postgres"
      defaultSchema="public"
      sql={sql}
      onSqlChange={setSql}
    />
  );
}

function renderWorkspace(initialSql = "SELECT 1") {
  return renderWithClient(<Workspace initialSql={initialSql} />);
}

function editorView(): EditorView {
  const content = document.querySelector(".cm-content") as HTMLElement;
  return EditorView.findFromDOM(content)!;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

test("textToRun uses the selection, or the whole document", () => {
  const doc = "SELECT 1;\nSELECT 2;";
  const whole = EditorState.create({ doc });
  const selected = EditorState.create({ doc, selection: EditorSelection.range(10, 19) });

  expect(textToRun(whole)).toBe(doc);
  expect(textToRun(selected)).toBe("SELECT 2;");
});

test("completion tables become a schema namespace", () => {
  expect(
    toNamespace([
      { schema: "public", table: "users", columns: ["id"] },
      { schema: "public", table: "teams", columns: ["id", "name"] },
      { schema: "app", table: "logs", columns: [] }
    ])
  ).toEqual({ public: { users: ["id"], teams: ["id", "name"] }, app: { logs: [] } });
});

test("tables complete as TB and schemas as SC, never as data types", () => {
  const tables = [{ schema: "public", table: "users", columns: ["id"] }];
  const source = tagNames(
    schemaCompletionSource({
      dialect: PostgreSQL,
      schema: toNamespace(tables),
      defaultSchema: "public"
    }),
    new Set(["public"])
  );
  const doc = "SELECT * FROM u";
  const state = EditorState.create({ doc, extensions: sql({ dialect: PostgreSQL }) });
  const result = source(new CompletionContext(state, doc.length, true)) as CompletionResult;

  const typeOf = (label: string) => result.options.find(option => option.label === label)?.type;
  expect(typeOf("users")).toBe("class");
  expect(typeOf("public")).toBe("namespace");
});

test("runs the editor content and shows the rows", async () => {
  const calls = fakeBackend([prodPostgres]);
  const user = userEvent.setup();
  renderWorkspace("SELECT 1 AS n");

  await user.click(screen.getByRole("button", { name: "Executar" }));

  expect(await screen.findByRole("status")).toHaveTextContent("1 linha retornada · 5 ms");
  expect(screen.getByRole("gridcell")).toHaveTextContent("1");
  const run = callsTo(calls, "run_script")[0] as { connectionId: string; sql: string };
  expect(run).toMatchObject({ connectionId: "pg-1", sql: "SELECT 1 AS n" });
});

test("runs only the selected text", async () => {
  const calls = fakeBackend([prodPostgres]);
  const user = userEvent.setup();
  renderWorkspace("SELECT 1;\nSELECT 2;");

  act(() => editorView().dispatch({ selection: EditorSelection.range(10, 19) }));
  await user.click(screen.getByRole("button", { name: "Executar" }));

  await waitFor(() => expect(callsTo(calls, "run_script")).toHaveLength(1));
  expect(callsTo(calls, "run_script")[0]).toMatchObject({ sql: "SELECT 2;" });
});

test("edits in the editor are what runs next", async () => {
  const calls = fakeBackend([prodPostgres]);
  const user = userEvent.setup();
  renderWorkspace("");

  act(() => editorView().dispatch({ changes: { from: 0, insert: "SELECT now()" } }));
  await user.click(screen.getByRole("button", { name: "Executar" }));

  await waitFor(() =>
    expect(callsTo(calls, "run_script")[0]).toMatchObject({ sql: "SELECT now()" })
  );
});

test("an empty editor runs nothing", async () => {
  const calls = fakeBackend([prodPostgres]);
  const user = userEvent.setup();
  renderWorkspace("   ");

  await user.click(screen.getByRole("button", { name: "Executar" }));

  expect(callsTo(calls, "run_script")).toHaveLength(0);
  expect(screen.getByText("Execute uma query para ver o resultado.")).toBeInTheDocument();
});

test("streams more rows from the cursor and releases it on unmount", async () => {
  const first: ScriptOutcome = {
    statementCount: 3,
    durationMs: 12,
    result: {
      kind: "rows",
      batch: {
        columns: [{ name: "g", typeName: "int4", editable: true }],
        rows: [[{ t: "int", v: "1" }]],
        hasMore: true
      },
      cursorId: "run-cursor"
    }
  };
  let fetches = 0;
  const calls = fakeBackend([prodPostgres], {
    run_script: () => executed(first),
    // first fetch brings one more row; the next stays in flight, so the cursor stays open
    fetch_more: () =>
      ++fetches === 1
        ? { columns: [], rows: [[{ t: "int", v: "2" }]], hasMore: true }
        : new Promise(() => undefined)
  });
  const user = userEvent.setup();
  const { unmount } = renderWorkspace();

  await user.click(screen.getByRole("button", { name: "Executar" }));

  // the grid asks for more as soon as the end is visible
  await waitFor(() => expect(callsTo(calls, "fetch_more").length).toBeGreaterThanOrEqual(1));
  expect(callsTo(calls, "fetch_more")[0]).toEqual({ cursorId: "run-cursor" });
  expect(await screen.findByText("2")).toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("· 3 comandos (resultado do último)");

  unmount();
  expect(callsTo(calls, "close_cursor")).toContainEqual({ cursorId: "run-cursor" });
});

test("a failing fetch shows its error under the rows", async () => {
  const error: AppError = { kind: "database", message: "division by zero [22012]" };
  fakeBackend([prodPostgres], {
    run_script: () =>
      executed({
        ...rowsOutcome,
        result: {
          ...rowsOutcome.result,
          batch: { ...(rowsOutcome.result as { batch: object }).batch, hasMore: true },
          cursorId: "c"
        } as ScriptOutcome["result"]
      }),
    fetch_more: () => Promise.reject(error)
  });
  const user = userEvent.setup();
  renderWorkspace();

  await user.click(screen.getByRole("button", { name: "Executar" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("division by zero");
});

test("commands report affected rows", async () => {
  fakeBackend([prodPostgres], {
    run_script: () =>
      executed({ statementCount: 1, durationMs: 3, result: { kind: "command", rowsAffected: 1 } })
  });
  const user = userEvent.setup();
  renderWorkspace("SET search_path TO app");

  await user.click(screen.getByRole("button", { name: "Executar" }));

  expect(await screen.findByRole("status")).toHaveTextContent(
    "Comando executado · 1 linha afetada · 3 ms"
  );
});

test("errors from the database are shown", async () => {
  const error: AppError = {
    kind: "database",
    message: "cannot execute CREATE TABLE in a read-only transaction [25006]"
  };
  fakeBackend([prodPostgres], { run_script: () => Promise.reject(error) });
  const user = userEvent.setup();
  renderWorkspace("CREATE TABLE t (id int)");

  await user.click(screen.getByRole("button", { name: "Executar" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("read-only transaction");
});

test("cancel stops a running query", async () => {
  const pending = deferred<RunResponse>();
  const calls = fakeBackend([prodPostgres], { run_script: () => pending.promise });
  const user = userEvent.setup();
  renderWorkspace("SELECT pg_sleep(30)");

  await user.click(screen.getByRole("button", { name: "Executar" }));
  expect(await screen.findByText("Executando…")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Cancelar" }));

  const runId = (callsTo(calls, "run_script")[0] as { runId: string }).runId;
  expect(callsTo(calls, "cancel_run")).toEqual([{ runId }]);

  const cancelled: AppError = { kind: "cancelled", message: "query cancelada" };
  pending.reject(cancelled);
  expect(await screen.findByRole("alert")).toHaveTextContent("query cancelada");
  expect(screen.getByRole("button", { name: "Executar" })).toBeInTheDocument();
});

test("destructive scripts wait for confirmation and run only after it", async () => {
  const calls = fakeBackend([prodPostgres], {
    run_script: args =>
      (args as { confirmed: boolean }).confirmed
        ? executed({
            statementCount: 1,
            durationMs: 4,
            result: { kind: "command", rowsAffected: 7 }
          })
        : {
            status: "needsConfirmation",
            confirmation: {
              destructive: true,
              reason: "Comando destrutivo: DELETE sem WHERE",
              statements: ["DELETE FROM t"]
            }
          }
  });
  const user = userEvent.setup();
  renderWorkspace("DELETE FROM t");

  await user.click(screen.getByRole("button", { name: "Executar" }));
  const dialog = await screen.findByRole("alertdialog");
  expect(dialog).toHaveTextContent("Comando destrutivo: DELETE sem WHERE");
  expect(dialog).toHaveTextContent("DELETE FROM t;");

  // the workspace runs on a prod connection, so confirming names production
  expect(dialog).toHaveTextContent("Postgres prod");
  // destructive on prod: the click alone does not run it, the connection's name does
  const execute = screen.getByRole("button", { name: "Executar em produção" });
  expect(execute).toBeDisabled();
  await user.type(screen.getByLabelText(/digite o nome da conexão/), "Postgres pro");
  expect(execute).toBeDisabled();
  await user.type(screen.getByLabelText(/digite o nome da conexão/), "d");
  await user.click(execute);

  const receipt = await screen.findByRole("status");
  expect(receipt).toHaveTextContent("7 linhas afetadas");
  // a confirmed run closes with where it ran and where it was recorded
  expect(receipt).toHaveTextContent(
    /^Confirmado e executado em Postgres prod.* · Comando executado · 7 linhas afetadas · 4 ms · Ver no histórico$/
  );
  expect(screen.getByRole("button", { name: "Ver no histórico" })).toBeInTheDocument();
  const runs = callsTo(calls, "run_script") as { confirmed: boolean; sql: string }[];
  expect(runs.map(run => run.confirmed)).toEqual([false, true]);
  expect(runs[1].sql).toBe("DELETE FROM t");
});

test("dismissing the confirmation runs nothing and keeps the previous result", async () => {
  const calls = fakeBackend([prodPostgres], {
    run_script: args =>
      (args as { sql: string }).sql.startsWith("SELECT")
        ? executed(rowsOutcome)
        : {
            status: "needsConfirmation",
            confirmation: {
              destructive: false,
              reason: "Conexão de produção: confirme antes de escrever",
              statements: ["UPDATE t SET a = 1 WHERE id = 1"]
            }
          }
  });
  const user = userEvent.setup();
  renderWorkspace("SELECT 1 AS n");
  await user.click(screen.getByRole("button", { name: "Executar" }));
  expect(await screen.findByRole("gridcell")).toHaveTextContent("1");

  act(() =>
    editorView().dispatch({
      changes: { from: 0, to: 13, insert: "UPDATE t SET a = 1 WHERE id = 1" }
    })
  );
  await user.click(screen.getByRole("button", { name: "Executar" }));
  await screen.findByRole("alertdialog");
  await user.click(screen.getByRole("button", { name: "Cancelar" }));

  await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
  expect(callsTo(calls, "run_script")).toHaveLength(2);
  const statuses = screen.getAllByRole("status");
  expect(statuses[0]).toHaveTextContent("Execução cancelada Nada rodou no banco.");
  // the kept result reads as the earlier one, without a receipt for a run that did not happen
  expect(statuses[1]).toHaveTextContent(/^Resultado anterior · 1 linha/);
  expect(screen.queryByText(/Confirmado e executado/)).not.toBeInTheDocument();
  expect(screen.getByRole("gridcell")).toHaveTextContent("1");
});
