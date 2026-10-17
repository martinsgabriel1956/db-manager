import { useState } from "react";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test } from "vitest";
import type { AppError, Engine } from "@/bindings";
import { SqlWorkspace } from "@/features/editor/SqlWorkspace";
import { findParams, paramValue, type ParamInput } from "@/features/editor/params";
import { callsTo, devPostgres, fakeBackend } from "@/test/fakeBackend";
import { renderWithClient } from "@/test/render";

function Workspace({ initialSql, engine = "postgres" }: { initialSql: string; engine?: Engine }) {
  const [sql, setSql] = useState(initialSql);
  const [params, setParams] = useState<Record<string, ParamInput>>({});
  return (
    <SqlWorkspace
      connectionId="pg-dev"
      engine={engine}
      defaultSchema="public"
      sql={sql}
      onSqlChange={setSql}
      params={params}
      onParamsChange={setParams}
    />
  );
}

test("finds placeholders outside strings, comments, casts and quoted names (Postgres)", () => {
  const sql = [
    "SELECT ':skip', \"a:b\", x::text, y :: int, arr[1:n] -- :comment",
    "FROM t /* :block */ WHERE id = :id AND (name = :name OR :name IS NULL)",
    "AND body = $$ :dollar $$ AND f(:first,:second)=:third;"
  ].join("\n");

  const found = findParams(sql, "postgres");

  expect(found.names).toEqual(["id", "name", "name", "first", "second", "third"]);
  expect(found.parts).toHaveLength(found.names.length + 1);
  // put back together with the placeholders, the text is the original
  const rebuilt = found.parts.reduce(
    (text, part, index) => `${text}:${found.names[index - 1]}${part}`
  );
  expect(rebuilt).toBe(sql);
});

test("finds placeholders in MySQL and SQLite, and none in plain SQL", () => {
  expect(findParams("SELECT @v := 1, `a:b` FROM t WHERE c = :c # :hash", "mysql").names).toEqual([
    "c"
  ]);
  expect(findParams("SELECT * FROM t WHERE c = :c AND d = '?:x'", "sqlite").names).toEqual(["c"]);
  expect(findParams("SELECT 1", "postgres")).toEqual({ parts: ["SELECT 1"], names: [] });
});

test("NULL travels as NULL, a number as a number, the rest as text", () => {
  expect(paramValue({ kind: "null", value: "ignored" })).toEqual({ kind: "null" });
  expect(paramValue({ kind: "number", value: "10" })).toEqual({ kind: "number", value: "10" });
  expect(paramValue({ kind: "text", value: "10" })).toEqual({ kind: "text", value: "10" });
});

test("asks the values before running and runs the filled SQL", async () => {
  const calls = fakeBackend([devPostgres]);
  const user = userEvent.setup();
  renderWithClient(
    <Workspace initialSql="SELECT * FROM users WHERE name = :name AND id > :min OR note IS :name" />
  );

  await user.click(screen.getByRole("button", { name: "Executar" }));

  const dialog = await screen.findByRole("dialog", { name: "Parâmetros" });
  // one field per name, even when it repeats
  expect(within(dialog).getAllByRole("textbox")).toHaveLength(2);
  expect(callsTo(calls, "run_script")).toHaveLength(0);
  await user.type(within(dialog).getByLabelText(":name"), "O'Brien");
  await user.type(within(dialog).getByLabelText(":min"), "10");
  await user.selectOptions(within(dialog).getByLabelText("Tipo de :min"), "Número");
  await user.click(within(dialog).getByRole("button", { name: "Executar" }));

  await waitFor(() => expect(callsTo(calls, "run_script")).toHaveLength(1));
  expect(callsTo(calls, "fill_params")[0]).toEqual({
    connectionId: "pg-dev",
    parts: ["SELECT * FROM users WHERE name = ", " AND id > ", " OR note IS ", ""],
    values: [
      { kind: "text", value: "O'Brien" },
      { kind: "number", value: "10" },
      { kind: "text", value: "O'Brien" }
    ]
  });
  expect(callsTo(calls, "run_script")[0]).toMatchObject({
    sql: "SELECT * FROM users WHERE name = 'O'Brien' AND id > 10 OR note IS 'O'Brien'"
  });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

  // the next run offers the same values, and NULL is a choice
  await user.click(screen.getByRole("button", { name: "Executar" }));
  const again = await screen.findByRole("dialog", { name: "Parâmetros" });
  expect(within(again).getByLabelText(":name")).toHaveValue("O'Brien");
  expect(within(again).getByLabelText("Tipo de :min")).toHaveValue("number");
  await user.selectOptions(within(again).getByLabelText("Tipo de :name"), "NULL");
  expect(within(again).getByLabelText(":name")).toBeDisabled();
  await user.click(within(again).getByRole("button", { name: "Executar" }));

  await waitFor(() => expect(callsTo(calls, "run_script")).toHaveLength(2));
  expect(callsTo(calls, "run_script")[1]).toMatchObject({
    sql: "SELECT * FROM users WHERE name = NULL AND id > 10 OR note IS NULL"
  });
});

test("a value the backend refuses stays in the form with the reason", async () => {
  const error: AppError = {
    kind: "validation",
    message: '"dez" não é um número; para outro valor, use texto'
  };
  const calls = fakeBackend([devPostgres], { fill_params: () => Promise.reject(error) });
  const user = userEvent.setup();
  renderWithClient(<Workspace initialSql="SELECT * FROM users LIMIT :n" />);

  await user.click(screen.getByRole("button", { name: "Executar" }));
  const dialog = await screen.findByRole("dialog", { name: "Parâmetros" });
  await user.type(within(dialog).getByLabelText(":n"), "dez");
  await user.click(within(dialog).getByRole("button", { name: "Executar" }));

  expect(await within(dialog).findByRole("alert")).toHaveTextContent("não é um número");
  expect(callsTo(calls, "run_script")).toHaveLength(0);
  // cancelling runs nothing
  await user.click(within(dialog).getByRole("button", { name: "Cancelar" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(callsTo(calls, "run_script")).toHaveLength(0);
});

test("explain and the export use the filled SQL too", async () => {
  const calls = fakeBackend([devPostgres], {
    explain: () => ({
      status: "explained",
      plan: {
        sql: "EXPLAIN",
        durationMs: 1,
        root: {
          label: "Seq Scan on users",
          details: [],
          cost: 1,
          rows: 1,
          actualRows: null,
          actualMs: null,
          loops: null,
          children: []
        }
      }
    })
  });
  const user = userEvent.setup();
  renderWithClient(<Workspace initialSql="SELECT * FROM users WHERE id = :id" />);

  await user.click(screen.getByRole("button", { name: /Explicar/ }));
  let dialog = await screen.findByRole("dialog", { name: "Parâmetros" });
  await user.type(within(dialog).getByLabelText(":id"), "7");
  await user.click(within(dialog).getByRole("button", { name: "Executar" }));
  await waitFor(() => expect(callsTo(calls, "explain")).toHaveLength(1));
  expect(callsTo(calls, "explain")[0]).toMatchObject({
    sql: "SELECT * FROM users WHERE id = '7'"
  });

  await user.click(screen.getByRole("button", { name: "Executar" }));
  dialog = await screen.findByRole("dialog", { name: "Parâmetros" });
  await user.click(within(dialog).getByRole("button", { name: "Executar" }));
  await user.click(await screen.findByRole("button", { name: /Exportar CSV/ }));
  await waitFor(() => expect(callsTo(calls, "export_query")).toHaveLength(1));
  expect(callsTo(calls, "export_query")[0]).toMatchObject({
    sql: "SELECT * FROM users WHERE id = '7'"
  });
});
