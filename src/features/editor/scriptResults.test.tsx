import { useState } from "react";
import { act, screen, waitFor, within } from "@testing-library/react";
import { EditorView } from "@codemirror/view";
import userEvent from "@testing-library/user-event";
import { expect, test } from "vitest";
import type { ScriptOutcome, StatementResult } from "@/bindings";
import { SqlWorkspace } from "@/features/editor/SqlWorkspace";
import { callsTo, executed, fakeBackend, prodPostgres, scriptOutcome } from "@/test/fakeBackend";
import { renderWithClient } from "@/test/render";

// every statement is 9 characters plus a space: scriptOutcome lays spans out every 10
const SQL = "SELECT 1; UPDATE x; SELECT 3";

function rows(values: string[], hasMore = false): StatementResult {
  return {
    kind: "rows",
    batch: {
      columns: [{ name: "n", typeName: "int4", editable: true }],
      rows: values.map(v => [{ t: "int", v }]),
      hasMore
    },
    cursorId: null
  };
}

function Workspace() {
  const [sql, setSql] = useState(SQL);
  return (
    <SqlWorkspace
      connectionId="pg-1"
      engine="postgres"
      defaultSchema="public"
      sql={sql}
      onSqlChange={setSql}
      params={{}}
      onParamsChange={() => undefined}
    />
  );
}

async function run(outcome: ScriptOutcome) {
  const calls = fakeBackend([prodPostgres], { run_script: () => executed(outcome) });
  const user = userEvent.setup();
  renderWithClient(<Workspace />);
  await user.click(screen.getByRole("button", { name: "Executar" }));
  return { calls, user };
}

test("each result gets its tab, the last one opens, Alt+PageUp walks back", async () => {
  const { user } = await run(
    scriptOutcome([rows(["1"]), { kind: "command", rowsAffected: 2 }, rows(["3"])])
  );

  const results = await screen.findByRole("tablist", { name: "Resultados do script" });
  const tabs = within(results).getAllByRole("tab");
  // the accessible name holds what the tab shows
  expect(tabs.map(tab => tab.textContent)).toEqual([
    "Execução",
    "comando 1 de 3 · SELECT 1;",
    "comando 3 de 3 · SELECT 3"
  ]);
  const last = screen.getByRole("tab", { name: "comando 3 de 3 · SELECT 3" });
  expect(last).toHaveAttribute("aria-selected", "true");
  expect(within(screen.getByRole("grid")).getByText("3")).toBeInTheDocument();

  // each tab's receipt is its own statement's, not the last one's
  expect(screen.getByRole("status")).toHaveTextContent("Comando 3 de 3 · 1 linha retornada");

  // from anywhere inside the results, and again: the focus follows the tab
  await user.click(last);
  await user.keyboard("{Alt>}{PageUp}{/Alt}");
  const first = screen.getByRole("tab", { name: "comando 1 de 3 · SELECT 1;" });
  expect(first).toHaveAttribute("aria-selected", "true");
  await waitFor(() => expect(first).toHaveFocus());
  await user.keyboard("{Alt>}{PageUp}{/Alt}");
  expect(screen.getByRole("tab", { name: "Execução" })).toHaveAttribute("aria-selected", "true");

  // the summary lists every statement, the command with its affected rows
  const list = screen.getByRole("list", { name: "Comandos do script" });
  expect(
    within(list).getByRole("button", { name: /^comando 2 de 3,\s*UPDATE x;/ })
  ).toHaveTextContent("2 linhas afetadas");
});

test("Alt+PageDown in the editor switches results without leaving the text", async () => {
  const { user } = await run(scriptOutcome([rows(["1"]), rows(["2"])]));
  await screen.findByRole("tablist", { name: "Resultados do script" });

  await user.click(document.querySelector(".cm-content") as HTMLElement);
  await user.keyboard("{Alt>}{PageDown}{/Alt}");

  expect(screen.getByRole("tab", { name: "Execução" })).toHaveAttribute("aria-selected", "true");
  expect(document.activeElement).toHaveClass("cm-content");
});

test("a script that stops opens on the summary, with the error and what did not run", async () => {
  const done = scriptOutcome([rows(["1"]), rows(["2"]), rows(["3"])]);
  const message = 'comando 2 de 3: syntax error at or near "x" [42601]';
  await run({
    ...done,
    steps: [
      done.steps[0],
      { ...done.steps[1], status: "failed", rowCount: null, result: null },
      { ...done.steps[2], status: "notRun", rowCount: null, result: null }
    ],
    error: { kind: "database", message }
  });

  expect(await screen.findByRole("tab", { name: "Execução" })).toHaveAttribute(
    "aria-selected",
    "true"
  );
  expect(screen.getByRole("alert")).toHaveTextContent(message);
  expect(screen.getByRole("button", { name: /^comando 2 de 3,.*erro/ })).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: /^comando 3 de 3,.*não executado/ })
  ).toBeInTheDocument();
  // the result that ran before the failure is still there
  expect(screen.getByRole("tab", { name: "comando 1 de 3 · SELECT 1;" })).toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("Parou no comando 2 de 3");
  // where it stopped is marked in the editor, and the summary says so
  expect(document.querySelector(".cm-step-failed")).toHaveTextContent("UPDATE x;");
  expect(screen.getByText("Comando 2 de 3 marcado no editor.")).toBeInTheDocument();
});

test("an earlier result says it kept its first rows and exports up to its statement", async () => {
  const outcome = scriptOutcome([rows(["1", "2"], true), rows(["3"])]);
  outcome.steps[0].rowCount = 1500;
  const { calls, user } = await run(outcome);

  await user.click(await screen.findByRole("tab", { name: "comando 1 de 2 · SELECT 1;" }));
  expect(screen.getByText("Mostrando as primeiras 2 de 1500 linhas.")).toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("Comando 1 de 2 · 2 de 1500 linhas");

  await user.click(screen.getByRole("button", { name: /Exportar CSV/ }));
  await waitFor(() =>
    expect(callsTo(calls, "export_query")).toEqual([
      expect.objectContaining({ sql: "SELECT 1; UPDATE x; SELECT 3", statement: 0 })
    ])
  );
});

test("an earlier result after a write cannot be exported, and says why before asking for a file", async () => {
  const { calls, user } = await run(
    scriptOutcome([{ kind: "command", rowsAffected: 2 }, rows(["1"]), rows(["3"])])
  );

  await user.click(await screen.findByRole("tab", { name: /^comando 2 de 3/ }));
  await user.click(screen.getByRole("button", { name: /Exportar CSV/ }));

  expect(screen.getByRole("alert")).toHaveTextContent("o script altera dados antes deste");
  expect(callsTo(calls, "export_query")).toEqual([]);
});

test("picking a statement marks it in the editor without selecting it", async () => {
  const { user } = await run(scriptOutcome([rows(["1"]), { kind: "command", rowsAffected: 2 }]));

  await user.click(await screen.findByRole("tab", { name: "Execução" }));
  await user.click(screen.getByRole("button", { name: /^comando 2 de 2/ }));

  const view = EditorView.findFromDOM(document.querySelector(".cm-content") as HTMLElement)!;
  // Run keeps running the whole script: the pick is a mark, not a selection
  expect(view.state.selection.main.empty).toBe(true);
  expect(document.querySelector(".cm-step-picked")).toHaveTextContent("UPDATE x;");
  expect(screen.getByRole("button", { name: "Executar" })).toBeInTheDocument();
  expect(screen.getByText("Comando 2 de 2 marcado no editor.")).toBeInTheDocument();
});

test("a picked statement runs alone on request", async () => {
  const { calls, user } = await run(
    scriptOutcome([rows(["1"]), { kind: "command", rowsAffected: 2 }])
  );

  await user.click(await screen.findByRole("tab", { name: "Execução" }));
  await user.click(screen.getByRole("button", { name: /^comando 2 de 2/ }));
  await user.click(screen.getByRole("button", { name: "Rodar só este comando" }));

  await waitFor(() => expect(callsTo(calls, "run_script")).toHaveLength(2));
  expect(callsTo(calls, "run_script")[1]).toMatchObject({ sql: "UPDATE x;" });
});

test("the summary is one Tab stop, with arrows between statements", async () => {
  const { user } = await run(scriptOutcome([rows(["1"]), rows(["2"]), rows(["3"])]));
  await user.click(await screen.findByRole("tab", { name: "Execução" }));

  const buttons = within(screen.getByRole("list", { name: "Comandos do script" })).getAllByRole(
    "button"
  );
  expect(buttons.map(button => button.tabIndex)).toEqual([0, -1, -1]);
  act(() => buttons[0].focus());
  await user.keyboard("{End}");
  await waitFor(() => expect(buttons[2]).toHaveFocus());
});

test("a statement is not marked once the editor no longer holds what ran", async () => {
  const { user } = await run(scriptOutcome([rows(["1"]), { kind: "command", rowsAffected: 2 }]));
  const view = EditorView.findFromDOM(document.querySelector(".cm-content") as HTMLElement)!;
  act(() => view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: "SELECT 9" } }));

  await user.click(await screen.findByRole("tab", { name: "Execução" }));
  await user.click(screen.getByRole("button", { name: /^comando 2 de 2/ }));

  expect(document.querySelector(".cm-step-picked")).toBeNull();
  expect(screen.getByText(/o editor mudou desde a execução/)).toBeInTheDocument();
});
