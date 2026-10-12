import { render, screen, within } from "@testing-library/react";
import { expect, test } from "vitest";
import type { Cell, ResultColumn } from "@/bindings";
import { ResultGrid } from "@/features/results/ResultGrid";

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
