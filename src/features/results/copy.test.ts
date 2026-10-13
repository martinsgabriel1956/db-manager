import { expect, test } from "vitest";
import type { Cell, ResultColumn } from "@/bindings";
import { rowsAsJson } from "@/features/results/copy";

const column = (name: string): ResultColumn => ({ name, typeName: "", editable: false });

test("one row is an object; values keep their exact text", () => {
  const columns = ["id", "price", "ratio", "tags", "at", "raw", "bin"].map(column);
  const row: Cell[] = [
    { t: "int", v: "9007199254740993" },
    { t: "decimal", v: "NaN" },
    { t: "float", v: Infinity },
    { t: "array", v: [{ t: "text", v: 'a"b' }, { t: "null" }] },
    { t: "timestamp", v: { value: "2026-10-13 12:00:00+00", tz: "UTC" } },
    { t: "unknown", v: { typeName: "point", text: "(1,2)" } },
    { t: "bytes", v: { len: 2, previewHex: "cafe" } }
  ];

  expect(rowsAsJson(columns, [row])).toBe(
    '{"id": 9007199254740993, "price": "NaN", "ratio": "Infinity", "tags": ["a\\"b", null], ' +
      '"at": "2026-10-13 12:00:00+00", "raw": "(1,2)", "bin": "0xcafe"}'
  );
});

test("several rows are an array, one object per line", () => {
  const rows: Cell[][] = [[{ t: "bool", v: true }], [{ t: "json", v: '{"a": [1]}' }]];
  expect(rowsAsJson([column("v")], rows)).toBe('[\n  {"v": true},\n  {"v": {"a": [1]}}\n]');
});

test("a binary the grid only previews is refused, not copied with loss", () => {
  const rows: Cell[][] = [[{ t: "bytes", v: { len: 64, previewHex: "00" } }]];
  expect(() => rowsAsJson([column("photo")], rows)).toThrow("a coluna photo");
});
