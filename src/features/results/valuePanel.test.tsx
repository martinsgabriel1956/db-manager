import { useState } from "react";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test } from "vitest";
import type { Cell, ResultColumn } from "@/bindings";
import { SqlWorkspace } from "@/features/editor/SqlWorkspace";
import { wantsPanel } from "@/features/results/CellDetail";
import { jsonProblem } from "@/features/results/jsonCheck";
import { devPostgres, executed, fakeBackend } from "@/test/fakeBackend";
import { renderWithClient } from "@/test/render";

test("JSON problems name the line and column", () => {
  expect(jsonProblem('{"n": 18446744073709551616, "a": [1, -2.5e3, true, null, "\\u00e9"]}')).toBe(
    null
  );
  expect(jsonProblem('{\n  "a": 1,\n  "b" 2\n}')).toEqual({
    line: 3,
    column: 7,
    message: 'esperado ":"'
  });
  const cases: [string, string][] = [
    ["", "falta um valor"],
    ["{'a': 1}", "esperada uma chave entre aspas"],
    ['{"a": 1,}', "esperada uma chave entre aspas"],
    ["[1 2]", 'esperado "," ou "]"'],
    ['"abc', "string sem aspas de fechamento"],
    ['"a\nb"', "quebra de linha ou caractere de controle dentro da string"],
    ['"\\x"', "escape inválido dentro da string"],
    ['"\\u12"', "escape \\u inválido"],
    ["-", "número inválido"],
    ["tru", "valor inesperado (esperado true)"],
    ["{} x", "texto depois do fim do JSON"],
    ["NaN", "valor inesperado: N"]
  ];
  for (const [text, message] of cases) {
    expect(jsonProblem(text)?.message, text).toBe(message);
  }
});

test("only JSON and text the grid cannot show whole open the panel by themselves", () => {
  const column = (typeName: string): ResultColumn => ({ name: "c", typeName, editable: true });
  const text = (v: string): Cell => ({ t: "text", v });
  expect(wantsPanel(column("JSON"), { t: "null" })).toBe(true);
  expect(wantsPanel(column("text"), text("curto"))).toBe(false);
  expect(wantsPanel(column("text"), text("linha 1\nlinha 2"))).toBe(true);
  expect(wantsPanel(column("text"), text("x".repeat(201)))).toBe(true);
  expect(wantsPanel(column("int4"), { t: "int", v: "1" })).toBe(false);
});

function Workspace() {
  const [sql, setSql] = useState("SELECT body FROM posts");
  return (
    <SqlWorkspace
      connectionId="pg-dev"
      engine="postgres"
      defaultSchema="public"
      sql={sql}
      onSqlChange={setSql}
      params={{}}
      onParamsChange={() => undefined}
    />
  );
}

test("long text in a query result opens whole, wrapped, beside a resizable split", async () => {
  const body = `${"palavra ".repeat(60)}\nfim`;
  fakeBackend([devPostgres], {
    run_script: () =>
      executed({
        statementCount: 1,
        durationMs: 2,
        result: {
          kind: "rows",
          batch: {
            columns: [
              { name: "id", typeName: "int4", editable: true },
              { name: "body", typeName: "text", editable: true }
            ],
            rows: [
              [
                { t: "int", v: "1" },
                { t: "text", v: body }
              ]
            ],
            hasMore: false
          },
          cursorId: null
        }
      })
  });
  const user = userEvent.setup();
  renderWithClient(<Workspace />);
  await user.click(screen.getByRole("button", { name: "Executar" }));

  // a short value keeps the grid's width
  await user.click(await screen.findByRole("gridcell", { name: "1" }));
  expect(screen.queryByRole("complementary", { name: "Valor da célula" })).not.toBeInTheDocument();

  await user.keyboard("{ArrowRight}");
  const panel = screen.getByRole("complementary", { name: "Valor da célula" });
  // the whole value, as stored, read-only in a query result
  expect(within(panel).getByRole("region", { name: "Valor de body" }).textContent).toBe(body);
  expect(within(panel).queryByRole("button", { name: "Aplicar" })).not.toBeInTheDocument();
  // the split between grid and panel is a keyboard-operable separator
  expect(screen.getByRole("separator", { name: "Largura do painel do valor" })).toHaveAttribute(
    "tabindex",
    "0"
  );
  // the focus stayed in the grid: arrows keep walking the cells
  expect(screen.getByRole("grid")).toHaveFocus();
});
