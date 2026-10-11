import { expect, test } from "vitest";
import type { Cell, ResultColumn } from "@/bindings";
import {
  addRow,
  buildChanges,
  DEFAULT_CELL,
  displayRows,
  editText,
  EMPTY_STAGED,
  removeNewRow,
  stageInsertValue,
  stagedCount,
  stageUpdate,
  toggleDelete
} from "@/features/table/staged";

const columns: ResultColumn[] = [
  { name: "id", typeName: "int4", editable: true },
  { name: "name", typeName: "text", editable: true },
  { name: "note", typeName: "text", editable: true }
];

const rows: Cell[][] = [
  [{ t: "int", v: "1" }, { t: "text", v: "Ana" }, { t: "null" }],
  [
    { t: "int", v: "2" },
    { t: "text", v: "Bia" },
    { t: "text", v: "x" }
  ]
];

test("edit text is the rendered value, empty for NULL", () => {
  expect(editText({ t: "int", v: "42" })).toBe("42");
  expect(editText({ t: "bool", v: true })).toBe("true");
  expect(editText({ t: "null" })).toBe("");
});

test("typing the original value back unstages the edit", () => {
  let staged = stageUpdate(EMPTY_STAGED, 0, "name", "Ana Paula", rows[0][1]);
  expect(staged.updates).toEqual({ 0: { name: "Ana Paula" } });

  staged = stageUpdate(staged, 0, "name", "Ana", rows[0][1]);
  expect(staged.updates).toEqual({});

  // NULL stays NULL: nothing to stage; NULL → '' is a real change
  expect(stageUpdate(EMPTY_STAGED, 0, "note", null, rows[0][2]).updates).toEqual({});
  expect(stageUpdate(EMPTY_STAGED, 0, "note", "", rows[0][2]).updates).toEqual({ 0: { note: "" } });
  expect(stageUpdate(EMPTY_STAGED, 1, "note", null, rows[1][2]).updates).toEqual({
    1: { note: null }
  });
});

test("display rows apply edits and append new rows with DEFAULT placeholders", () => {
  let staged = stageUpdate(EMPTY_STAGED, 1, "note", null, rows[1][2]);
  staged = addRow(staged);
  staged = stageInsertValue(staged, staged.inserts[0].id, "name", "Caio");

  expect(displayRows(rows, columns, staged)).toEqual([
    rows[0],
    [{ t: "int", v: "2" }, { t: "text", v: "Bia" }, { t: "null" }],
    [DEFAULT_CELL, { t: "text", v: "Caio" }, DEFAULT_CELL]
  ]);
});

test("changes go deletes, updates, inserts, keyed by the original primary key", () => {
  let staged = stageUpdate(EMPTY_STAGED, 0, "name", "Ana Paula", rows[0][1]);
  staged = stageUpdate(staged, 1, "name", "ignored: row is deleted", rows[1][1]);
  staged = toggleDelete(staged, 1);
  staged = addRow(staged);
  staged = stageInsertValue(staged, staged.inserts[0].id, "name", "Caio");
  staged = stageInsertValue(staged, staged.inserts[0].id, "note", null);

  expect(stagedCount(staged)).toBe(3);
  expect(buildChanges(rows, columns, ["id"], staged)).toEqual([
    { kind: "delete", key: [{ column: "id", value: { t: "int", v: "2" } }] },
    {
      kind: "update",
      key: [{ column: "id", value: { t: "int", v: "1" } }],
      values: [{ column: "name", value: "Ana Paula" }]
    },
    {
      kind: "insert",
      values: [
        { column: "name", value: "Caio" },
        { column: "note", value: null }
      ]
    }
  ]);
});

test("delete toggles and new rows can be dropped", () => {
  let staged = toggleDelete(EMPTY_STAGED, 0);
  expect(staged.deletes).toEqual([0]);
  staged = toggleDelete(staged, 0);
  expect(staged.deletes).toEqual([]);

  staged = addRow(staged);
  staged = removeNewRow(staged, staged.inserts[0].id);
  expect(staged).toEqual(EMPTY_STAGED);
  expect(stagedCount(staged)).toBe(0);
});
