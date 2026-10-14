export type Theme = "system" | "light" | "dark";

// index.html reads the same key before the first paint
const KEY = "theme";

export const THEME_LABEL: Record<Theme, string> = {
  system: "Sistema",
  light: "Claro",
  dark: "Escuro"
};

export const NEXT_THEME: Record<Theme, Theme> = { system: "light", light: "dark", dark: "system" };

export function storedTheme(): Theme {
  const value = localStorage.getItem(KEY);
  return value === "light" || value === "dark" ? value : "system";
}

/** "system" drops the attribute, so the CSS falls back to prefers-color-scheme. */
export function applyTheme(theme: Theme) {
  if (theme === "system") {
    delete document.documentElement.dataset.theme;
    localStorage.removeItem(KEY);
  } else {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(KEY, theme);
  }
}
