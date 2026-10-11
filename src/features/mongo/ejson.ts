// Documents arrive as Extended JSON text (see adapters/mongo/ejson.rs): Int64 is
// always {"$numberLong": "…"}, so JSON.parse is safe — bare integers are Int32 and
// every lossy type sits in a string inside a "$" wrapper.

export type JsonValue =
  null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

/** Label for an Extended JSON wrapper (ObjectId, dates, …); null for a plain value/object. */
export function describeWrapper(value: JsonValue): string | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const keys = Object.keys(value);
  const only = (key: string) => keys.length === 1 && keys[0] === key;
  const inner = (key: string) => value[key];

  if (only("$oid")) {
    return `ObjectId("${inner("$oid")}")`;
  }
  if (only("$date")) {
    const date = inner("$date");
    const text = typeof date === "string" ? date : describeWrapper(date);
    return `ISODate("${text}")`;
  }
  if (only("$numberLong")) {
    return `NumberLong(${inner("$numberLong")})`;
  }
  if (only("$numberDecimal")) {
    return `Decimal128("${inner("$numberDecimal")}")`;
  }
  if (only("$numberDouble")) {
    return String(inner("$numberDouble"));
  }
  if (only("$numberInt")) {
    return String(inner("$numberInt"));
  }
  if (only("$binary")) {
    const binary = inner("$binary") as { base64?: string; subType?: string };
    const bytes = Math.floor(((binary.base64 ?? "").replace(/=+$/, "").length * 3) / 4);
    return `Binary(${binary.subType ?? "00"}, ${bytes} bytes)`;
  }
  if (only("$regularExpression")) {
    const regex = inner("$regularExpression") as { pattern?: string; options?: string };
    return `/${regex.pattern ?? ""}/${regex.options ?? ""}`;
  }
  if (only("$timestamp")) {
    const timestamp = inner("$timestamp") as { t?: number; i?: number };
    return `Timestamp(${timestamp.t}, ${timestamp.i})`;
  }
  if (only("$minKey") || only("$maxKey")) {
    return keys[0] === "$minKey" ? "MinKey" : "MaxKey";
  }
  return null;
}

export function parseDocument(text: string): Record<string, JsonValue> {
  return JSON.parse(text) as Record<string, JsonValue>;
}

/** The document's _id as Extended JSON text, to address it in writes. */
export function idOf(documentText: string): string {
  return JSON.stringify(parseDocument(documentText)._id);
}

export function isValidJson(text: string): boolean {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}
