import { useState } from "react";
import { screen, waitFor, within } from "@testing-library/react";
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
  expect(tabs.map(tab => tab.textContent)).toEqual(["Execução", "1 · SELECT 1;", "3 · SELECT 3"]);
  const last = screen.getByRole("tab", { name: "comando 3 de 3, concluído" });
  expect(last).toHaveAttribute("aria-selected", "true");
  expect(within(screen.getByRole("grid")).getByText("3")).toBeInTheDocument();

  // from anywhere inside the results
  await user.click(last);
  await user.keyboard("{Alt>}{PageUp}{/Alt}");
  expect(screen.getByRole("tab", { name: "comando 1 de 3, concluído" })).toHaveAttribute(
    "aria-selected",
    "true"
  );

  // the summary lists every statement, the command with its affected rows
  await user.click(screen.getByRole("tab", { name: "Execução" }));
  const list = screen.getByRole("list", { name: "Comandos do script" });
  expect(within(list).getByRole("button", { name: "comando 2 de 3, concluído" })).toHaveTextContent(
    "2 linhas afetadas"
  );
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
  expect(screen.getByRole("button", { name: "comando 2 de 3, erro" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "comando 3 de 3, não executado" })).toBeInTheDocument();
  // the result that ran before the failure is still there
  expect(screen.getByRole("tab", { name: "comando 1 de 3, concluído" })).toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("Parou no comando 2 de 3");
});

test("an earlier result says it kept its first rows and exports up to its statement", async () => {
  const outcome = scriptOutcome([rows(["1", "2"], true), rows(["3"])]);
  outcome.steps[0].rowCount = 1500;
  const { calls, user } = await run(outcome);

  await user.click(await screen.findByRole("tab", { name: "comando 1 de 2, concluído" }));
  expect(
    screen.getByText(
      "Mostrando as primeiras 2 de 1500 linhas. Rode o comando sozinho para ver todas."
    )
  ).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: /Exportar CSV/ }));
  await waitFor(() =>
    expect(callsTo(calls, "export_query")).toEqual([
      expect.objectContaining({ sql: "SELECT 1; UPDATE x; SELECT 3", statement: 0 })
    ])
  );
});
