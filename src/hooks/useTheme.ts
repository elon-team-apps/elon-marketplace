import { useState, useEffect } from "react";

export type Theme = "dark" | "light";

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => {
    return (localStorage.getItem("elon_theme") as Theme) ?? "dark";
  });

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "dark") {
      root.classList.add("dark");
      root.style.backgroundColor = "#05080a";
      document.body.style.backgroundColor = "#05080a";
    } else {
      root.classList.remove("dark");
      root.style.backgroundColor = "#f8fafc";
      document.body.style.backgroundColor = "#f8fafc";
    }
    localStorage.setItem("elon_theme", theme);
  }, [theme]);

  const toggle = () => setTheme((t) => (t === "dark" ? "light" : "dark"));

  return { theme, toggle };
}
