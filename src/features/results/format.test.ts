import { expect, test } from "vitest";
import type { Cell } from "@/bindings";
import {
  detailText,
  formatCell,
  GRID_TEXT_LIMIT,
  gridText,
  isNumeric,
  prettyJson
} from "@/features/results/format";

test("formats every cell type compactly", () => {
  const cases: [Cell, string][] = [
    [{ t: "null" }, "NULL"],
    [{ t: "bool", v: true }, "true"],
    [{ t: "bool", v: false }, "false"],
    [{ t: "int", v: "9007199254740993" }, "9007199254740993"],
    [{ t: "float", v: 1.5 }, "1.5"],
    [{ t: "decimal", v: "0.1000000001" }, "0.1000000001"],
    [{ t: "text", v: "olá" }, "olá"],
    [{ t: "bytes", v: { len: 2, previewHex: "00ff" } }, "<2 bytes> 0x00ff"],
    [{ t: "bytes", v: { len: 100, previewHex: "ab" } }, "<100 bytes> 0xab…"],
    [{ t: "date", v: "2024-02-29" }, "2024-02-29"],
    [
      { t: "timestamp", v: { value: "2024-01-01 10:00:00+00", tz: "UTC" } },
      "2024-01-01 10:00:00+00"
    ],
    [{ t: "json", v: '{"a": 1}' }, '{"a": 1}'],
    [
      { t: "array", v: [{ t: "int", v: "1" }, { t: "null" }, { t: "array", v: [] }] },
      "[1, NULL, []]"
    ],
    [{ t: "unknown", v: { typeName: "point", text: "(1,2)" } }, "(1,2)"]
  ];

  for (const [cell, expected] of cases) {
    expect(formatCell(cell)).toBe(expected);
  }
});

test("truncates long values in the grid only", () => {
  const long: Cell = { t: "text", v: "x".repeat(GRID_TEXT_LIMIT + 50) };

  expect(gridText(long)).toHaveLength(GRID_TEXT_LIMIT + 1);
  expect(gridText(long).endsWith("…")).toBe(true);
  expect(detailText(long)).toHaveLength(GRID_TEXT_LIMIT + 50);
});

test("detail text pretty-prints json", () => {
  expect(detailText({ t: "json", v: '{"a": [1, 2]}' })).toBe('{\n  "a": [\n    1,\n    2\n  ]\n}');
});

test("pretty json keeps big numbers, strings with delimiters and empty containers intact", () => {
  expect(prettyJson('{"id": 9007199254740993, "s": "a,b:{c}\\"d", "e": {}, "f": [ ]}')).toBe(
    [
      "{",
      '  "id": 9007199254740993,',
      '  "s": "a,b:{c}\\"d",',
      '  "e": {},',
      '  "f": []',
      "}"
    ].join("\n")
  );
});

test("numeric cells are right-aligned", () => {
  expect(isNumeric({ t: "int", v: "1" })).toBe(true);
  expect(isNumeric({ t: "decimal", v: "1" })).toBe(true);
  expect(isNumeric({ t: "float", v: 1 })).toBe(true);
  expect(isNumeric({ t: "text", v: "1" })).toBe(false);
});
