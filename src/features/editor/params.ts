import type { Engine, ParamValue } from "@/bindings";
import { sqlDialect } from "@/features/editor/SqlEditor";

/** The SQL cut around its `:name` placeholders: `parts` has one more item than `names`. */
export type FoundParams = { parts: string[]; names: string[] };

/** What the form keeps per name: the last value typed and how it goes in. */
export type ParamInput = { kind: "text" | "number" | "null"; value: string };

type Token = { name: string; from: number; to: number };

const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Tokens that may sit right before a placeholder: `=:id`, `(:a`, `,:b`, `[:n`. */
const OPENS_VALUE = new Set(["Operator", "(", "[", "{", ";"]);

/**
 * Finds `:name` placeholders with the same lezer grammar the editor highlights, so strings,
 * comments, quoted identifiers and `$$` bodies are single tokens and never searched. Postgres
 * and MySQL read `:` as punctuation: a placeholder is a lone `:` glued to a name. A `:` after
 * another `:` (the `::text` cast), or glued to a name or number before it (`arr[lo:hi]`), is
 * not one. SQLite reads `:name` as a variable token of its own.
 */
export function findParams(sql: string, engine: Engine): FoundParams {
  // ponytail: parses the text to run again instead of slicing the editor's own tree; same
  // grammar, and a selection is read as what it is, the text that runs
  const tree = sqlDialect(engine).language.parser.parse(sql);
  const tokens: Token[] = [];
  tree.iterate({
    enter: node => {
      if (!node.node.firstChild) {
        tokens.push({ name: node.name, from: node.from, to: node.to });
      }
    }
  });

  const found: { from: number; to: number; name: string }[] = [];
  tokens.forEach((token, index) => {
    const text = sql.slice(token.from, token.to);
    if (token.name === "SpecialVar" && text.startsWith(":") && NAME.test(text.slice(1))) {
      found.push({ from: token.from, to: token.to, name: text.slice(1) });
      return;
    }
    if (token.name !== "Punctuation" || text !== ":") {
      return;
    }
    const next = tokens[index + 1];
    const previous = tokens[index - 1];
    const name = next ? sql.slice(next.from, next.to) : "";
    const gluedAfter = next !== undefined && next.from === token.to && NAME.test(name);
    const gluedBefore =
      previous !== undefined &&
      previous.to === token.from &&
      !OPENS_VALUE.has(previous.name) &&
      !(previous.name === "Punctuation" && sql.slice(previous.from, previous.to) === ",");
    if (gluedAfter && !gluedBefore) {
      found.push({ from: token.from, to: next.to, name });
    }
  });

  const parts: string[] = [];
  let start = 0;
  for (const placeholder of found) {
    parts.push(sql.slice(start, placeholder.from));
    start = placeholder.to;
  }
  parts.push(sql.slice(start));
  return { parts, names: found.map(placeholder => placeholder.name) };
}

/** Each name once, in order of first appearance: one field per name in the form. */
export function uniqueNames(names: string[]): string[] {
  return [...new Set(names)];
}

export function paramValue(input: ParamInput | undefined): ParamValue {
  if (!input || input.kind === "null") {
    return { kind: "null" };
  }
  return input.kind === "number"
    ? { kind: "number", value: input.value }
    : { kind: "text", value: input.value };
}
