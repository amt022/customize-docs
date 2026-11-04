import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import Editor from "./components/Editor";
import Home from "./components/Home";
import "./styles.css";
import "./polish.css";
import "./dark.css";
import { initTheme } from "./theme";

initTheme();

function App() {
  const read = () => new URLSearchParams(location.hash.slice(1)).get("doc");
  const readTool = () => (new URLSearchParams(location.hash.slice(1)).get("tool") === "images" ? "images" : "edit");
  const [doc, setDoc] = useState<string | null>(read);
  const [tool, setTool] = useState<"edit" | "images">(readTool);
  useEffect(() => {
    const on = () => { setDoc(read()); setTool(readTool()); };
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  const open = (id: string | null, startTool: "edit" | "images" = "edit") => {
    location.hash = id ? `doc=${id}${startTool === "images" ? "&tool=images" : ""}` : "";
    setDoc(id);
    setTool(startTool);
  };
  return doc ? <Editor key={doc} id={doc} startTool={tool} onClose={() => open(null)} /> : <Home onOpen={open} />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
