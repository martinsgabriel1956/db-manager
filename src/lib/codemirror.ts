import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { tags } from "@lezer/highlight";

/** Colors come from the CSS tokens, so the editors follow the light/dark theme. */
const highlight = HighlightStyle.define([
  { tag: [tags.keyword, tags.operatorKeyword, tags.modifier], color: "var(--syntax-keyword)" },
  { tag: [tags.string, tags.special(tags.string)], color: "var(--syntax-string)" },
  { tag: [tags.number, tags.bool, tags.null], color: "var(--syntax-number)" },
  { tag: [tags.typeName, tags.standard(tags.name)], color: "var(--syntax-type)" },
  { tag: tags.propertyName, color: "var(--foreground)", fontWeight: "600" },
  {
    tag: [tags.comment, tags.lineComment, tags.blockComment],
    color: "var(--muted-foreground)",
    fontStyle: "italic"
  },
  { tag: tags.invalid, color: "var(--destructive)" }
]);

const theme = EditorView.theme({
  "&": { height: "100%", backgroundColor: "var(--background)", color: "var(--foreground)" },
  "&.cm-focused": {
    outline: "2px solid var(--ring)",
    outlineOffset: "-2px"
  },
  ".cm-scroller": { fontFamily: "var(--font-mono)" },
  ".cm-content": { caretColor: "var(--foreground)" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--foreground)" },
  ".cm-gutters": {
    backgroundColor: "var(--muted)",
    color: "var(--muted-foreground)",
    borderRight: "1px solid var(--border)"
  },
  ".cm-activeLine": { backgroundColor: "color-mix(in oklch, var(--muted) 60%, transparent)" },
  ".cm-activeLineGutter": { backgroundColor: "var(--accent)", color: "var(--foreground)" },
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
    { backgroundColor: "color-mix(in oklch, var(--ring) 40%, transparent)" },
  ".cm-tooltip": {
    backgroundColor: "var(--popover)",
    color: "var(--popover-foreground)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-md)"
  },
  ".cm-tooltip-autocomplete > ul > li[aria-selected]": {
    backgroundColor: "var(--accent)",
    color: "var(--accent-foreground)"
  },
  ".cm-panels": { backgroundColor: "var(--muted)", color: "var(--foreground)" },
  ".cm-panels input, .cm-panels button": { color: "inherit" }
});

export const editorTheme = [theme, syntaxHighlighting(highlight)];

/** Accessible name for the editable area (the host div has no role to carry it). */
export function editorLabel(label: string) {
  return EditorView.contentAttributes.of({ "aria-label": label });
}
