import { fireEvent, render, screen, within } from "@testing-library/react";
import { expect, test } from "vitest";
import type { Cell, ResultColumn } from "@/bindings";
import { fitColumnWidths, ResultGrid } from "@/features/results/ResultGrid";

test("columns fit their header or longest value, on the 14px grid and capped", () => {
  const columns: ResultColumn[] = [
    { name: "id", typeName: "int4", editable: true },
    { name: "profile", typeName: "jsonb", editable: true }
  ];
  const rows: Cell[][] = [
    [
      { t: "int", v: "1" },
      { t: "json", v: `{"bio": "${"x".repeat(300)}"}` }
    ]
  ];

  const [id, profile] = fitColumnWidths(columns, rows);
  // the header "id int4" (7 characters) is longer than "1": 7 × 7.2 + 35 = 85.4 → 98
  expect(id).toBe(98);
  expect(id % 14).toBe(0);
  // a long value stops at the cap; the detail panel holds the rest
  expect(profile).toBe(364);
});

test("Alt+arrows resize the selected column by one grid cell", async () => {
  const columns: ResultColumn[] = [{ name: "id", typeName: "int4", editable: false }];
  render(
    <ResultGrid
      columns={columns}
      rows={[[{ t: "int", v: "1" }]]}
      hasMore={false}
      isLoadingMore={false}
      selected={{ row: 0, column: 0 }}
      onSelect={() => undefined}
    />
  );
  const cell = screen.getByRole("gridcell");
  expect(cell.style.width).toBe("98px");

  fireEvent.keyDown(screen.getByRole("grid"), { key: "ArrowRight", altKey: true });
  expect(screen.getByRole("gridcell").style.width).toBe("112px");
});

test("a wide result renders only the columns in view, numbered for assistive tech", () => {
  const columns: ResultColumn[] = Array.from({ length: 300 }, (_, n) => ({
    name: `c${n}`,
    typeName: "int4",
    editable: false
  }));
  const rows: Cell[][] = [columns.map((_, n) => ({ t: "int", v: String(n) }))];

  render(
    <ResultGrid
      columns={columns}
      rows={rows}
      hasMore={false}
      isLoadingMore={false}
      selected={{ row: 0, column: 250 }}
      onSelect={() => undefined}
    />
  );

  const grid = screen.getByRole("grid", { name: "Resultado" });
  expect(grid).toHaveAttribute("aria-colcount", "300");
  const cells = within(grid).getAllByRole("gridcell");
  expect(cells.length).toBeLessThan(20);
  // the selected cell stays mounted so aria-activedescendant always resolves
  const selected = cells.find(cell => cell.getAttribute("aria-selected") === "true");
  expect(selected).toHaveAttribute("aria-colindex", "251");
  expect(grid.getAttribute("aria-activedescendant")).toBe(selected?.id);
});

test("the grid tells what its keys do and says when the value panel opens", () => {
  let open = false;
  render(
    <ResultGrid
      columns={[{ name: "id", typeName: "int4", editable: false }]}
      rows={[[{ t: "int", v: "1" }]]}
      hasMore={false}
      isLoadingMore={false}
      selected={{ row: 0, column: 0 }}
      onSelect={() => undefined}
      detailOpen={open}
      onToggleDetail={() => {
        open = !open;
      }}
    />
  );
  const grid = screen.getByRole("grid");
  expect(grid).toHaveAccessibleDescription(
    "Espaço mostra o valor inteiro; Alt+← → ajusta a largura da coluna."
  );

  fireEvent.keyDown(grid, { key: " " });
  expect(open).toBe(true);
  expect(screen.getByText("Painel do valor aberto ao lado da grade")).toBeInTheDocument();
});
