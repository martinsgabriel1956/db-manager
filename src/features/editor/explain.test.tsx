import { useState } from "react";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PostgreSQL, sql } from "@codemirror/lang-sql";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { expect, test } from "vitest";
import type { Engine, ExplainResponse, PlanNode } from "@/bindings";
import { statementAt } from "@/features/editor/SqlEditor";
import { SqlWorkspace } from "@/features/editor/SqlWorkspace";
import { hottest, planRows } from "@/features/results/PlanView";
import { callsTo, fakeBackend, prodPostgres } from "@/test/fakeBackend";
import { renderWithClient } from "@/test/render";

function node(label: string, cost: number | null, children: PlanNode[] = []): PlanNode {
  return {
    label,
    details: [],
    cost,
    rows: cost === null ? null : 10,
    actualRows: null,
    actualMs: null,
    loops: null,
    children
  };
}

const joinPlan = node("Hash Join", 40, [
  { ...node("Seq Scan on orders o", 30), details: ["Filter: (total > 0)"] },
  node("Hash", 6, [node("Seq Scan on users u", 5)])
]);

function explained(root: PlanNode, sqlText = "EXPLAIN (FORMAT JSON) SELECT 2"): ExplainResponse {
  return { status: "explained", plan: { sql: sqlText, root, durationMs: 4 } };
}

function Workspace({ initialSql, engine }: { initialSql: string; engine: Engine }) {
  const [text, setText] = useState(initialSql);
  return (
    <SqlWorkspace
      connectionId="pg-1"
      engine={engine}
      defaultSchema="public"
      sql={text}
      onSqlChange={setText}
      params={{}}
      onParamsChange={() => undefined}
    />
  );
}

function renderWorkspace(initialSql: string, engine: Engine = "postgres") {
  return renderWithClient(<Workspace initialSql={initialSql} engine={engine} />);
}

function editorView(): EditorView {
  return EditorView.findFromDOM(document.querySelector(".cm-content") as HTMLElement)!;
}

test("explains the selection, or the statement under the cursor", () => {
  const doc = "SELECT 1;\n\nSELECT 'a;b'\n  FROM t;\nSELECT 3";
  const at = (head: number, anchor = head) =>
    statementAt(
      EditorState.create({
        doc,
        selection: EditorSelection.single(anchor, head),
        extensions: sql({ dialect: PostgreSQL })
      })
    );

  expect(at(3)).toBe("SELECT 1;");
  // the blank line after a statement still means it
  expect(at(10)).toBe("SELECT 1;");
  // a semicolon inside a string does not end the statement
  expect(at(25)).toBe("SELECT 'a;b'\n  FROM t;");
  expect(at(doc.length)).toBe("SELECT 3");
  expect(at(0, 9)).toBe("SELECT 1;");
  expect(statementAt(EditorState.create({ doc: "  ", extensions: sql() }))).toBe("");
});

test("the most expensive node is the one with the highest own cost", () => {
  const rows = planRows(joinPlan);

  expect(rows.map(row => [row.node.label, row.depth, row.selfCost])).toEqual([
    ["Hash Join", 0, 4],
    ["Seq Scan on orders o", 1, 30],
    ["Hash", 1, 1],
    ["Seq Scan on users u", 2, 5]
  ]);
  expect(hottest(rows)).toBe(1);
  // SQLite plans have no costs: nothing to single out
  expect(hottest(planRows(node("QUERY PLAN", null, [node("SCAN t", null)])))).toBeNull();
  expect(hottest(planRows(node("Result", 0.01)))).toBeNull();
});

test("Ctrl+Shift+E explains the statement under the cursor as a tree", async () => {
  const calls = fakeBackend([prodPostgres], { explain: () => explained(joinPlan) });
  renderWorkspace("SELECT 1;\nSELECT 2;");

  act(() => editorView().dispatch({ selection: { anchor: 14 } }));
  // CodeMirror finds Shift+letter bindings by keyCode
  fireEvent.keyDown(editorView().contentDOM, {
    key: "E",
    keyCode: 69,
    ctrlKey: true,
    shiftKey: true
  });

  await waitFor(() => expect(callsTo(calls, "explain")).toHaveLength(1));
  expect(callsTo(calls, "explain")[0]).toMatchObject({
    sql: "SELECT 2;",
    analyze: false,
    confirmed: false
  });
  const table = await screen.findByRole("table", { name: "Plano de execução" });
  const rows = within(table).getAllByRole("row");
  expect(rows[0]).toHaveTextContent("NóCustoLinhas estimadas");
  expect(rows[1]).toHaveTextContent("Nível 1: Hash Join40.0010");
  expect(rows[4]).toHaveTextContent("Nível 3: └ Seq Scan on users u");
  // marked with a word, not only a tint
  expect(rows[2]).toHaveTextContent("Seq Scan on orders o Mais caro");
  expect(rows[2]).toHaveTextContent("Filter: (total > 0)");
  expect(within(table).getAllByText("Mais caro")).toHaveLength(1);
  expect(screen.getByText("EXPLAIN (FORMAT JSON) SELECT 2")).toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("Plano de execução · 4 ms");
});

test("ANALYZE runs the statement, so it goes through the confirmation", async () => {
  const analyzed: PlanNode = { ...node("Delete on t", 20), actualRows: 0, actualMs: 1.5, loops: 1 };
  const calls = fakeBackend([prodPostgres], {
    explain: args =>
      (args as { confirmed: boolean }).confirmed
        ? explained(analyzed, "EXPLAIN (ANALYZE, FORMAT JSON) DELETE FROM t WHERE id = 1")
        : {
            status: "needsConfirmation",
            confirmation: {
              destructive: false,
              reason: "Conexão de produção: confirme antes de escrever",
              statements: ["EXPLAIN (ANALYZE, FORMAT JSON) DELETE FROM t WHERE id = 1"]
            }
          }
  });
  const user = userEvent.setup();
  renderWorkspace("DELETE FROM t WHERE id = 1");

  // from the keyboard, as everything else
  screen.getByRole("button", { name: "Mais formas de explicar" }).focus();
  await user.keyboard("{Enter}");
  await user.click(
    await screen.findByRole("menuitem", { name: "Explicar com ANALYZE (executa a instrução)" })
  );
  const dialog = await screen.findByRole("alertdialog");
  expect(dialog).toHaveTextContent("EXPLAIN (ANALYZE, FORMAT JSON) DELETE FROM t WHERE id = 1");
  await user.click(within(dialog).getByRole("button", { name: /Executar/ }));

  await waitFor(() => expect(callsTo(calls, "explain")).toHaveLength(2));
  expect(callsTo(calls, "explain")[1]).toMatchObject({ analyze: true, confirmed: true });
  const table = await screen.findByRole("table", { name: "Plano de execução" });
  expect(within(table).getAllByRole("row")[1]).toHaveTextContent("Delete on t20.001001.5001");
  expect(screen.getByRole("status")).toHaveTextContent("Confirmado");
  expect(screen.getByRole("status")).toHaveTextContent("com ANALYZE · a instrução rodou");
});

test("only Postgres offers ANALYZE; SQLite says why there is no cost", async () => {
  fakeBackend([prodPostgres], {
    explain: () => explained(node("QUERY PLAN", null, [node("SCAN t", null)]))
  });
  const user = userEvent.setup();
  renderWorkspace("SELECT * FROM t", "sqlite");

  expect(screen.queryByRole("button", { name: "Mais formas de explicar" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Explicar" }));

  const table = await screen.findByRole("table", { name: "Plano de execução" });
  expect(within(table).getAllByRole("row")[0]).toHaveTextContent(/^Nó$/);
  expect(screen.getByText(/O SQLite não estima custo nem linhas/)).toBeInTheDocument();
  expect(within(table).queryByText("Mais caro")).not.toBeInTheDocument();
});
