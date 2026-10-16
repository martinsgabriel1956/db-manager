import { expect, test } from "vitest";
import { byGroup, treeMove, type TreeRow } from "@/features/explorer/treeNav";

// connection (open) > schema (open) > two tables, then a closed connection
const rows: TreeRow[] = [
  { level: 1, expanded: true },
  { level: 2, expanded: true },
  { level: 3, expanded: null },
  { level: 3, expanded: null },
  { level: 1, expanded: false }
];

test("up and down move one row and stop at the ends", () => {
  expect(treeMove(rows, 0, "ArrowDown")).toEqual({ focus: 1 });
  expect(treeMove(rows, 4, "ArrowDown")).toBeNull();
  expect(treeMove(rows, 2, "ArrowUp")).toEqual({ focus: 1 });
  expect(treeMove(rows, 0, "ArrowUp")).toBeNull();
});

test("home and end jump to the first and last row", () => {
  expect(treeMove(rows, 2, "Home")).toEqual({ focus: 0 });
  expect(treeMove(rows, 1, "End")).toEqual({ focus: 4 });
});

test("right expands a closed row and enters an open one", () => {
  expect(treeMove(rows, 4, "ArrowRight")).toEqual({ toggle: 4 });
  expect(treeMove(rows, 1, "ArrowRight")).toEqual({ focus: 2 });
  expect(treeMove(rows, 2, "ArrowRight")).toBeNull();
});

test("left collapses an open row and climbs from a leaf to its parent", () => {
  expect(treeMove(rows, 0, "ArrowLeft")).toEqual({ toggle: 0 });
  expect(treeMove(rows, 3, "ArrowLeft")).toEqual({ focus: 1 });
  expect(treeMove(rows, 4, "ArrowLeft")).toBeNull();
});

test("other keys and a missing row do nothing", () => {
  expect(treeMove(rows, 0, "Enter")).toBeNull();
  expect(treeMove(rows, 9, "ArrowDown")).toBeNull();
});

test("ungrouped connections come first, then groups in alphabetical order", () => {
  const connections = [
    { name: "a", group: "Zeta" },
    { name: "b", group: null },
    { name: "c", group: "Água" },
    { name: "d", group: "Zeta" },
    { name: "e" }
  ];

  expect(byGroup(connections)).toEqual({
    ungrouped: [connections[1], connections[4]],
    groups: [
      { name: "Água", connections: [connections[2]] },
      { name: "Zeta", connections: [connections[0], connections[3]] }
    ]
  });
});
