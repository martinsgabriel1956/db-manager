/**
 * Re-indents JSON text without parsing it, so numbers keep every digit
 * (JSON.parse would round 64-bit integers). Assumes valid JSON.
 */
export function prettyJson(text: string): string {
  let out = "";
  let depth = 0;
  let inString = false;
  const newline = () => "\n" + "  ".repeat(depth);
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (inString) {
      out += char;
      if (char === "\\") {
        out += text[++i];
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
      out += char;
    } else if (char === "{" || char === "[") {
      const close = char === "{" ? "}" : "]";
      const next = text.slice(i + 1).trimStart()[0];
      if (next === close) {
        // empty: {} and [] stay on one line
        out += char + close;
        i = text.indexOf(close, i + 1);
      } else {
        depth++;
        out += char + newline();
      }
    } else if (char === "}" || char === "]") {
      depth--;
      out += newline() + char;
    } else if (char === ",") {
      out += "," + newline();
    } else if (char === ":") {
      out += ": ";
    } else if (!/\s/.test(char)) {
      out += char;
    }
  }
  return out;
}
