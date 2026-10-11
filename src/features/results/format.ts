import type { Cell } from "@/bindings";

/** Grid cells show at most this many characters; the detail panel shows everything. */
export const GRID_TEXT_LIMIT = 200;

/** Compact, single-line rendering used in the grid and inside arrays. */
export function formatCell(cell: Cell): string {
  switch (cell.t) {
    case "null":
      return "NULL";
    case "bool":
      return cell.v ? "true" : "false";
    case "float":
      return String(cell.v);
    case "bytes": {
      const truncated = cell.v.previewHex.length < cell.v.len * 2 ? "…" : "";
      return `<${cell.v.len} bytes> 0x${cell.v.previewHex}${truncated}`;
    }
    case "timestamp":
      return cell.v.value;
    case "array":
      return `[${cell.v.map(formatCell).join(", ")}]`;
    case "unknown":
      return cell.v.text;
    case "int":
    case "decimal":
    case "text":
    case "date":
    case "json":
      return cell.v;
  }
}

export function gridText(cell: Cell): string {
  const text = formatCell(cell);
  return text.length > GRID_TEXT_LIMIT ? `${text.slice(0, GRID_TEXT_LIMIT)}…` : text;
}

/** Full rendering for the detail panel: JSON pretty-printed, everything else as in the grid. */
export function detailText(cell: Cell): string {
  return cell.t === "json" ? prettyJson(cell.v) : formatCell(cell);
}

export function isNumeric(cell: Cell): boolean {
  return cell.t === "int" || cell.t === "decimal" || cell.t === "float";
}

/**
 * Re-indents JSON text without parsing it: JSON.parse would round numbers beyond
 * 2^53, which is exactly what Cell.Json avoids by carrying text.
 */
export function prettyJson(text: string): string {
  const indent = (depth: number) => "  ".repeat(depth);
  let out = "";
  let depth = 0;
  let inString = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (inString) {
      out += char;
      if (char === "\\") {
        out += text[++i] ?? "";
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
      out += char;
    } else if (char === "{" || char === "[") {
      const closing = char === "{" ? "}" : "]";
      const next = text.slice(i + 1).trimStart()[0];
      if (next === closing) {
        out += `${char}${closing}`;
        i = text.indexOf(closing, i + 1);
      } else {
        depth++;
        out += `${char}\n${indent(depth)}`;
      }
    } else if (char === "}" || char === "]") {
      depth--;
      out += `\n${indent(depth)}${char}`;
    } else if (char === ",") {
      out += `,\n${indent(depth)}`;
    } else if (char === ":") {
      out += ": ";
    } else if (!/\s/.test(char)) {
      out += char;
    }
  }
  return out;
}
