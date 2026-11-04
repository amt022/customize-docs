import { useState } from "react";
import { applyTheme, currentTheme, type Theme } from "../theme";

export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(currentTheme);
  const flip = () => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    applyTheme(next);
    setTheme(next);
  };
  return (
    <button className="theme-toggle" onClick={flip} title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
      aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}>
      {theme === "dark" ? "☀️" : "🌙"}
    </button>
  );
}
