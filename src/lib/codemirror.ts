import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { tags } from "@lezer/highlight";

/** Colors come from the CSS tokens, so the editors follow the light/dark theme. */
const highlight = HighlightStyle.define([
  {
    tag: [tags.keyword, tags.operatorKeyword, tags.modifier],
    color: "var(--syntax-keyword)",
    fontWeight: "700"
  },
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
  ".cm-content": { caretColor: "var(--select)" },
  // CodeMirror's own #888 is off the zone scale
  ".cm-placeholder": { color: "var(--muted-foreground)" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--select)", borderLeftWidth: "2px" },
  ".cm-gutters": {
    backgroundColor: "var(--muted)",
    color: "var(--muted-foreground)",
    borderRight: "1px solid var(--border)"
  },
  ".cm-activeLine": { backgroundColor: "color-mix(in oklch, var(--muted) 60%, transparent)" },
  ".cm-activeLineGutter": { backgroundColor: "var(--accent)", color: "var(--foreground)" },
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
    { backgroundColor: "color-mix(in oklch, var(--ring) 40%, transparent)" },
  // a script step: blue is "where you are"; the one that stopped the script is crossed, as a conflict
  ".cm-step-picked": {
    backgroundColor: "color-mix(in oklch, var(--select) 14%, transparent)",
    boxShadow: "inset 0 -2px 0 var(--select)"
  },
  ".cm-step-failed": {
    backgroundImage:
      "repeating-linear-gradient(135deg, var(--hatch) 0 1px, transparent 1px 5px), repeating-linear-gradient(45deg, var(--hatch) 0 1px, transparent 1px 5px)",
    backgroundRepeat: "no-repeat",
    backgroundSize: "100% 5px",
    backgroundPosition: "bottom",
    boxShadow: "inset 0 -2px 0 var(--destructive)"
  },
  // under the dialog layer (z-50): a lingering completion never paints over a sheet
  ".cm-tooltip": {
    backgroundColor: "var(--popover)",
    color: "var(--popover-foreground)",
    border: "1px solid var(--foreground)",
    borderRadius: "0",
    zIndex: "40"
  },
  // the completion's kind as a legend code in a square cell, like the engine codes; no emoji
  ".cm-completionIcon": {
    width: "1.75rem",
    paddingRight: "0.5rem",
    opacity: "1",
    fontFamily: "var(--font-display)",
    fontStretch: "75%",
    fontWeight: "600",
    fontSize: "0.6875rem",
    letterSpacing: "0.1em",
    color: "var(--muted-foreground)"
  },
  "[aria-selected] > .cm-completionIcon": { color: "inherit" },
  ".cm-completionIcon-keyword::after": { content: "'KW'" },
  ".cm-completionIcon-type::after": { content: "'TY'" },
  ".cm-completionIcon-class::after": { content: "'TB'" },
  ".cm-completionIcon-property::after": { content: "'CL'" },
  ".cm-completionIcon-function::after, .cm-completionIcon-method::after": { content: "'FN'" },
  ".cm-completionIcon-namespace::after": { content: "'SC'" },
  ".cm-completionIcon-variable::after, .cm-completionIcon-constant::after": { content: "'VR'" },
  ".cm-completionIcon-text::after": { content: "'TX'" },
  // room around each option, in the 4px rhythm: the default 1px reads cramped
  ".cm-tooltip-autocomplete > ul > li": { padding: "4px 8px 4px 4px" },
  ".cm-tooltip-autocomplete > ul > li[aria-selected]": {
    backgroundColor: "var(--select)",
    color: "var(--select-foreground)"
  },
  ".cm-panels": { backgroundColor: "var(--muted)", color: "var(--foreground)" },
  ".cm-panels input, .cm-panels button": { color: "inherit" }
});

export const editorTheme = [theme, syntaxHighlighting(highlight)];

/** Accessible name for the editable area (the host div has no role to carry it). */
export function editorLabel(label: string) {
  return EditorView.contentAttributes.of({ "aria-label": label });
}
