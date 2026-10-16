import type { EditorState } from "@codemirror/state";
import { formatDialect, mysql, postgresql, sqlite } from "sql-formatter";
import type { Engine } from "@/bindings";
import { errorMessage } from "@/lib/errors";

const DIALECT = { postgres: postgresql, mysql, sqlite };

const bare = (text: string) => text.replace(/\s+/g, "");

/**
 * Reformats SQL in the connection's dialect, keeping keyword case, strings, quoted identifiers
 * and comments. Throws instead of returning SQL that differs in anything but whitespace.
 */
export function formatSql(text: string, engine: Engine): string {
  // DELIMITER is a line of the mysql client, not SQL: the formatter would join it to the code
  if (engine === "mysql" && /^\s*DELIMITER\s/im.test(text)) {
    throw new Error("o formatador não entende DELIMITER; selecione só o SQL entre eles");
  }
  const dialect = engine === "mysql" || engine === "sqlite" ? DIALECT[engine] : DIALECT.postgres;
  let formatted: string;
  try {
    formatted = formatDialect(text, { dialect });
  } catch (error) {
    // its first line says where ("Parse error: Unexpected … at line 3 column 5"); the rest is advice
    throw new Error(`o formatador não entendeu o SQL: ${errorMessage(error).split("\n")[0]}`);
  }
  // whitespace is all a formatter may change; anything else would change what runs
  if (bare(formatted) !== bare(text)) {
    throw new Error("a formatação mudaria mais que espaços e quebras de linha; nada foi alterado");
  }
  return formatted;
}

/** The change that formats the selection, or the whole document when nothing is selected. */
export function formatChange(state: EditorState, engine: Engine) {
  const { from, to } = state.selection.main;
  const [start, end] = from === to ? [0, state.doc.length] : [from, to];
  return { from: start, to: end, insert: formatSql(state.sliceDoc(start, end), engine) };
}
