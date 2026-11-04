export type Theme = "light" | "dark";

const KEY = "formeasy.theme";

export function currentTheme(): Theme {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

export function applyTheme(theme: Theme, remember = true) {
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "dark" ? "#0f1420" : "#f1f3f8");
  if (!remember) return;
  try { localStorage.setItem(KEY, theme); } catch { /* storage unavailable */ }
}

/** Saved choice, else the system preference. Runs before first paint (see index.html) and again here for safety. */
export function initTheme() {
  let saved: string | null = null;
  try { saved = localStorage.getItem(KEY); } catch { /* storage unavailable */ }
  const dark = saved ? saved === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
  applyTheme(dark ? "dark" : "light", false);
  if (!saved) {
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", (e) => {
      let chosen: string | null = null;
      try { chosen = localStorage.getItem(KEY); } catch { /* storage unavailable */ }
      if (!chosen) applyTheme(e.matches ? "dark" : "light", false);
    });
  }
}
