import type { Cell, ResultColumn } from "@/bindings";

/** JSON number grammar: anything else (NaN, Infinity) is kept as a string. */
const JSON_NUMBER = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/;

/**
 * One value as JSON text, built by hand: JSON.stringify of a parsed number would
 * round integers beyond 2^53, and Cell.Json already carries valid JSON text.
 */
function cellJson(cell: Cell, column: string): string {
  switch (cell.t) {
    case "null":
      return "null";
    case "bool":
      return cell.v ? "true" : "false";
    case "int":
    case "decimal":
      return JSON_NUMBER.test(cell.v) ? cell.v : JSON.stringify(cell.v);
    case "float":
      return Number.isFinite(cell.v) ? String(cell.v) : JSON.stringify(String(cell.v));
    case "json":
      return cell.v;
    case "bytes":
      // the grid only carries a preview of longer values
      if (cell.v.previewHex.length < cell.v.len * 2) {
        throw new Error(
          `a coluna ${column} tem um binário que a grade só mostra em parte: copiar perderia dados`
        );
      }
      return JSON.stringify(`0x${cell.v.previewHex}`);
    case "array":
      return `[${cell.v.map(item => cellJson(item, column)).join(", ")}]`;
    case "timestamp":
      return JSON.stringify(cell.v.value);
    case "unknown":
      return JSON.stringify(cell.v.text);
    case "text":
    case "date":
      return JSON.stringify(cell.v);
  }
}

function rowJson(columns: ResultColumn[], row: Cell[]): string {
  const fields = columns.map(
    (column, index) => `${JSON.stringify(column.name)}: ${cellJson(row[index], column.name)}`
  );
  return `{${fields.join(", ")}}`;
}

/** One row as an object, several as an array with an object per line. */
export function rowsAsJson(columns: ResultColumn[], rows: Cell[][]): string {
  if (rows.length === 1) {
    return rowJson(columns, rows[0]);
  }
  return `[\n${rows.map(row => `  ${rowJson(columns, row)}`).join(",\n")}\n]`;
}
