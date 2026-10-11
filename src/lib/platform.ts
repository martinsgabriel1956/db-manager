/** Matches CodeMirror's `Mod-Enter`: Cmd on macOS, Ctrl elsewhere. */
export const RUN_SHORTCUT = /Mac|iPhone|iPad/.test(navigator.userAgent) ? "⌘+Enter" : "Ctrl+Enter";
