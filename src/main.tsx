import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import { AppProvider } from "./context/AppContext.tsx";
import "./index.css";

// Apply saved theme (anti-FOUC was already handled in index.html,
// but HMR cycles can reset the HTML element — this re-applies it).
const savedTheme = localStorage.getItem("elon_theme") ?? "dark";
if (savedTheme === "dark") {
  document.documentElement.classList.add("dark");
  document.documentElement.style.backgroundColor = "#05080a";
  document.body.style.backgroundColor = "#05080a";
} else {
  document.documentElement.classList.remove("dark");
  document.documentElement.style.backgroundColor = "#f8fafc";
  document.body.style.backgroundColor = "#f8fafc";
}

createRoot(document.getElementById("root")!).render(
  <AppProvider>
    <App />
  </AppProvider>
);
