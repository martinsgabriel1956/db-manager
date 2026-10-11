import { expect, test } from "vitest";
import { describeWrapper, idOf, isValidJson, type JsonValue } from "@/features/mongo/ejson";

test("describes Extended JSON wrappers like the mongo shell", () => {
  const cases: [JsonValue, string | null][] = [
    [{ $oid: "65a1b2c3d4e5f60718293a4b" }, 'ObjectId("65a1b2c3d4e5f60718293a4b")'],
    [{ $date: "2024-01-01T00:00:00Z" }, 'ISODate("2024-01-01T00:00:00Z")'],
    [{ $date: { $numberLong: "-62135596800000" } }, 'ISODate("NumberLong(-62135596800000)")'],
    [{ $numberLong: "9007199254740993" }, "NumberLong(9007199254740993)"],
    [{ $numberDecimal: "19.90" }, 'Decimal128("19.90")'],
    [{ $numberDouble: "NaN" }, "NaN"],
    [{ $binary: { base64: "AP8=", subType: "00" } }, "Binary(00, 2 bytes)"],
    [{ $regularExpression: { pattern: "^a", options: "i" } }, "/^a/i"],
    [{ $timestamp: { t: 1, i: 2 } }, "Timestamp(1, 2)"],
    [{ $minKey: 1 }, "MinKey"],
    // not wrappers
    [{ $oid: "x", other: 1 }, null],
    [{ name: "Ana" }, null],
    [[1, 2], null],
    ["text", null],
    [42, null],
    [null, null]
  ];
  for (const [value, expected] of cases) {
    expect(describeWrapper(value)).toBe(expected);
  }
});

test("extracts the _id as Extended JSON", () => {
  expect(idOf('{"_id":{"$oid":"65a1b2c3d4e5f60718293a4b"},"a":1}')).toBe(
    '{"$oid":"65a1b2c3d4e5f60718293a4b"}'
  );
  expect(idOf('{"_id":7}')).toBe("7");
  expect(idOf('{"_id":{"$numberLong":"9007199254740993"}}')).toBe(
    '{"$numberLong":"9007199254740993"}'
  );
});

test("checks JSON syntax", () => {
  expect(isValidJson('{"a": 1}')).toBe(true);
  expect(isValidJson("{a: 1}")).toBe(false);
});
