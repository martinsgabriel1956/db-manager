const isMac = /Mac|iPhone|iPad/.test(navigator.userAgent);

/** Matches CodeMirror's `Mod-Enter`: Cmd on macOS, Ctrl elsewhere. */
export const RUN_SHORTCUT = isMac ? "⌘+Enter" : "Ctrl+Enter";
export const SIDEBAR_SHORTCUT = isMac ? "⌘+B" : "Ctrl+B";
export const FORMAT_SHORTCUT = isMac ? "⌘+Shift+F" : "Ctrl+Shift+F";
