import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.jsx";
import "./styles.css";
import "./icons.css";
import "./build/test-hook.js";

// Monaco's web workers, bundled locally by Vite (?worker) instead of fetched
// from a CDN - the app must be self-contained. We only edit a custom text
// language, so the base editor worker covers everything.
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
self.MonacoEnvironment = {
  getWorker() { return new EditorWorker(); },
};

createRoot(document.getElementById("root")).render(<App />);
