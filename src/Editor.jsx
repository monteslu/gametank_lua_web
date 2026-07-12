import React, { useCallback, useRef } from "react";
import MonacoEditor, { loader } from "@monaco-editor/react";
// Editor CORE only (not the "monaco-editor" barrel, which registers EVERY
// language and bloats the bundle by ~3MB).
import * as monaco from "monaco-editor/esm/vs/editor/editor.api";
// Monaco's OWN built-in Lua language (real tokenizer, maintained upstream) - we
// use it as the base and only layer gt-lua completions + diagnostics on top. We
// do NOT hand-write a Lua grammar.
import "monaco-editor/esm/vs/basic-languages/lua/lua.contribution";
import { BUILTINS, CALLBACKS, GT_MEMBERS } from "gtlua/compiler/builtins.js";

// Use the LOCALLY-bundled monaco (not the default CDN) - the app is self-contained.
loader.config({ monaco });

const KEYWORDS = [
  "and", "break", "do", "else", "elseif", "end", "false", "for", "function",
  "goto", "if", "in", "local", "nil", "not", "or", "repeat", "return", "then",
  "true", "until", "while",
];
const BUILTIN_NAMES = Object.keys(BUILTINS);
const GT_MEMBER_NAMES = Object.keys(GT_MEMBERS);
const EXTRA = ["btn", "btnp", "print", "rnd", "flr", "abs", "min", "max", "sin", "cos",
  "sqrt", "band", "bor", "bxor", "shl", "shr", "mid", "sgn", "peek", "poke", "sfx", "music"];
const ALL_BUILTINS = [...new Set([...BUILTIN_NAMES, ...EXTRA])];

// Add the gt-lua-specific layer to Monaco's built-in `lua` language: completions
// (builtins, callbacks, gt.* members) + a dark theme. Registered once.
let registered = false;
function registerGtLua(m) {
  if (registered) return;
  registered = true;

  m.languages.registerCompletionItemProvider("lua", {
    triggerCharacters: ["."],
    provideCompletionItems(model, position) {
      const line = model.getValueInRange({ startLineNumber: position.lineNumber, startColumn: 1, endColumn: position.column, endLineNumber: position.lineNumber });
      const word = model.getWordUntilPosition(position);
      const range = { startLineNumber: position.lineNumber, endLineNumber: position.lineNumber, startColumn: word.startColumn, endColumn: word.endColumn };
      const K = m.languages.CompletionItemKind;
      // after `gt.` suggest members
      if (/\bgt\.\w*$/.test(line)) {
        return { suggestions: GT_MEMBER_NAMES.map((name) => ({ label: name, kind: K.Method, insertText: name, range, detail: "gt." + name })) };
      }
      const suggestions = [
        ...ALL_BUILTINS.map((name) => ({ label: name, kind: K.Function, insertText: name, range, detail: "gt-lua builtin" })),
        ...CALLBACKS.map((name) => ({ label: name, kind: K.Event, insertText: name, range, detail: "callback (_init/_update/_draw...)" })),
        { label: "gt", kind: K.Module, insertText: "gt", range, detail: "GameTank API namespace" },
      ];
      return { suggestions };
    },
  });

  // a dark theme close to our app palette (colors Monaco's own Lua tokens)
  m.editor.defineTheme("gtlua-dark", {
    base: "vs-dark", inherit: true,
    rules: [
      { token: "comment.lua", foreground: "6b7280", fontStyle: "italic" },
      { token: "comment", foreground: "6b7280", fontStyle: "italic" },
      { token: "string.lua", foreground: "9ece6a" },
      { token: "string", foreground: "9ece6a" },
      { token: "number.lua", foreground: "ff9e64" },
      { token: "number", foreground: "ff9e64" },
      { token: "keyword.lua", foreground: "bb9af7" },
      { token: "keyword", foreground: "bb9af7" },
      { token: "identifier.lua", foreground: "d6dae2" },
    ],
    colors: { "editor.background": "#0f1117" },
  });
}

/**
 * The code editor: Monaco (the VS Code editor), self-hosted (no CDN), using
 * Monaco's built-in Lua language for highlighting, with a thin gt-lua layer on
 * top (completions for our builtins + live compiler diagnostics as markers).
 */
export function Editor({ value, onChange, diagnostics }) {
  const monacoRef = useRef(null);
  const editorRef = useRef(null);

  const beforeMount = useCallback((m) => { registerGtLua(m); }, []);

  const onMount = useCallback((editor, m) => {
    monacoRef.current = m;
    editorRef.current = editor;
    pushMarkers(m, editor, diagnostics);
    editor.addCommand(m.KeyMod.CtrlCmd | m.KeyCode.KeyR, () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "r", ctrlKey: true, metaKey: true }));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (monacoRef.current && editorRef.current) pushMarkers(monacoRef.current, editorRef.current, diagnostics);

  return (
    <MonacoEditor
      className="monaco"
      language="lua"
      theme="gtlua-dark"
      value={value}
      onChange={(v) => onChange(v ?? "")}
      beforeMount={beforeMount}
      onMount={onMount}
      options={{
        fontFamily: "ui-monospace, 'SF Mono', Menlo, Consolas, monospace",
        fontSize: 13,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        tabSize: 2,
        insertSpaces: true,
        automaticLayout: true,
        renderLineHighlight: "line",
        smoothScrolling: true,
        padding: { top: 8 },
      }}
    />
  );
}

function pushMarkers(m, editor, diagnostics) {
  const model = editor.getModel();
  if (!model) return;
  const sev = (s) => (s === "error" ? m.MarkerSeverity.Error : s === "warning" ? m.MarkerSeverity.Warning : m.MarkerSeverity.Info);
  const markers = (diagnostics || []).map((d) => ({
    severity: sev(d.severity),
    message: d.message,
    startLineNumber: d.line || 1,
    endLineNumber: d.line || 1,
    startColumn: d.col || 1,
    endColumn: (d.col || 1) + 1,
  }));
  m.editor.setModelMarkers(model, "gtlua", markers);
}
