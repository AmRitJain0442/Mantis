import { useCallback, useEffect, useState } from "react";

export type Theme = "light" | "dark";

const STORAGE_KEY = "flowtrace:theme";

const systemTheme = (): Theme =>
  window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";

const storedTheme = (): Theme | null => {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === "light" || value === "dark" ? value : null;
  } catch {
    return null;
  }
};

export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", theme === "light" ? "#eceef2" : "#0a0d12");
}

/** Reads the stored preference, falls back to the OS setting, and follows the OS
 *  until the developer picks a theme explicitly. */
export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => storedTheme() ?? systemTheme());
  const [pinned, setPinned] = useState(() => storedTheme() !== null);

  useEffect(() => applyTheme(theme), [theme]);

  useEffect(() => {
    if (pinned) return;
    const query = window.matchMedia("(prefers-color-scheme: light)");
    const sync = () => setTheme(systemTheme());
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, [pinned]);

  const toggleTheme = useCallback(() => {
    setTheme((current) => {
      const next: Theme = current === "dark" ? "light" : "dark";
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch {
        /* private mode — the choice just won't persist */
      }
      return next;
    });
    setPinned(true);
  }, []);

  return { theme, toggleTheme };
}
