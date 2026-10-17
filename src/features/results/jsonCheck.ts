/** Where a JSON text stops being JSON, 1-based, for a message the user can act on. */
export type JsonProblem = { line: number; column: number; message: string };

class JsonSyntaxError extends Error {
  constructor(
    message: string,
    readonly position: number
  ) {
    super(message);
  }
}

const NUMBER = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;

/**
 * Checks JSON syntax without parsing it into values: JSON.parse would only say "invalid" in
 * WebKitGTK (no position), and its numbers are what this panel must never touch.
 */
export function jsonProblem(text: string): JsonProblem | null {
  let position = 0;

  function fail(message: string): never {
    throw new JsonSyntaxError(message, position);
  }

  function skipSpace() {
    while (position < text.length && " \t\n\r".includes(text[position])) {
      position++;
    }
  }

  function literal(word: string) {
    if (!text.startsWith(word, position)) {
      fail(`valor inesperado (esperado ${word})`);
    }
    position += word.length;
  }

  function string() {
    position++;
    while (position < text.length) {
      const char = text[position];
      if (char === '"') {
        position++;
        return;
      }
      if (char === "\\") {
        const escape = text[position + 1];
        if (escape === "u") {
          if (!/^[0-9a-fA-F]{4}$/.test(text.slice(position + 2, position + 6))) {
            fail("escape \\u inválido");
          }
          position += 6;
        } else if (escape !== undefined && '"\\/bfnrt'.includes(escape)) {
          position += 2;
        } else {
          fail("escape inválido dentro da string");
        }
        continue;
      }
      if (char < " ") {
        fail("quebra de linha ou caractere de controle dentro da string");
      }
      position++;
    }
    fail("string sem aspas de fechamento");
  }

  function sequence(close: "}" | "]", item: () => void) {
    position++;
    skipSpace();
    if (text[position] === close) {
      position++;
      return;
    }
    for (;;) {
      item();
      skipSpace();
      if (text[position] === ",") {
        position++;
        continue;
      }
      if (text[position] === close) {
        position++;
        return;
      }
      fail(`esperado "," ou "${close}"`);
    }
  }

  function member() {
    skipSpace();
    if (text[position] !== '"') {
      fail("esperada uma chave entre aspas");
    }
    string();
    skipSpace();
    if (text[position] !== ":") {
      fail('esperado ":"');
    }
    position++;
    value();
  }

  function value() {
    skipSpace();
    const char = text[position];
    if (char === "{") {
      sequence("}", member);
    } else if (char === "[") {
      sequence("]", value);
    } else if (char === '"') {
      string();
    } else if (char === "t") {
      literal("true");
    } else if (char === "f") {
      literal("false");
    } else if (char === "n") {
      literal("null");
    } else if (char === "-" || (char >= "0" && char <= "9")) {
      NUMBER.lastIndex = position;
      const match = NUMBER.exec(text);
      if (!match) {
        fail("número inválido");
      }
      position += match[0].length;
    } else if (char === undefined) {
      fail("falta um valor");
    } else {
      fail(`valor inesperado: ${char}`);
    }
  }

  try {
    value();
    skipSpace();
    if (position < text.length) {
      fail("texto depois do fim do JSON");
    }
    return null;
  } catch (error) {
    if (!(error instanceof JsonSyntaxError)) {
      throw error;
    }
    const lines = text.slice(0, error.position).split("\n");
    return {
      line: lines.length,
      column: lines[lines.length - 1].length + 1,
      message: error.message
    };
  }
}
