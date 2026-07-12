import React, { useState, useMemo, useCallback } from "react";
import { compile } from "gtlua/compiler/index.js";
import { Editor } from "./Editor.jsx";

const HELLO = `-- hello: a complete GameTank game. No assets, just code.
function _draw()
  cls(1)                          -- dark blue background
  print("hello gametank", 38, 14, 14)   -- pink title

  circfill(64, 72, 26, 10)        -- yellow head
  rectfill(53, 62, 58, 68, 0)     -- left eye
  rectfill(70, 62, 75, 68, 0)     -- right eye
  circfill(64, 82, 9, 0)          -- mouth
end
`;

/**
 * Root IDE shell. For this first slice: a code editor with LIVE diagnostics
 * (the plan's headline differentiator - our real compiler IS the language
 * service, running in-browser) and a peek at the generated C. Build/run/assets
 * come next.
 */
export function App() {
  const [source, setSource] = useState(HELLO);

  // Run the real gt-lua compiler on every edit. Pure JS, zero node deps, so it
  // runs synchronously in the browser (a Worker + debounce comes when it's a
  // perf issue - for a screen of code it's sub-millisecond).
  const result = useMemo(() => {
    try {
      return compile(source, "main.lua");
    } catch (e) {
      return { ok: false, c: null, diagnostics: [{ severity: "error", message: String(e?.message ?? e), line: 1, col: 1 }] };
    }
  }, [source]);

  const errors = result.diagnostics.filter((d) => d.severity === "error");
  const warnings = result.diagnostics.filter((d) => d.severity === "warning");

  const onChange = useCallback((v) => setSource(v), []);

  return (
    <div className="ide">
      <header className="topbar">
        <span className="logo">gt-lua <span className="dim">web</span></span>
        <span className={"status " + (errors.length ? "err" : "ok")}>
          {errors.length ? `${errors.length} error${errors.length > 1 ? "s" : ""}` : "ready"}
          {warnings.length ? ` · ${warnings.length} warning${warnings.length > 1 ? "s" : ""}` : ""}
        </span>
      </header>

      <main className="panes">
        <section className="pane editor-pane">
          <div className="pane-title">main.lua</div>
          <Editor value={source} onChange={onChange} diagnostics={result.diagnostics} />
        </section>

        <section className="pane output-pane">
          <div className="pane-title">problems</div>
          <ul className="problems">
            {result.diagnostics.length === 0 && <li className="ok">no problems - compiles clean</li>}
            {result.diagnostics.map((d, i) => (
              <li key={i} className={d.severity}>
                <span className="loc">{d.line}:{d.col}</span> {d.message}
              </li>
            ))}
          </ul>

          <div className="pane-title">generated C {result.ok ? `(${result.c.length} bytes)` : "(none)"}</div>
          <pre className="genc">{result.ok ? result.c : "// fix the errors above to see the generated C"}</pre>
        </section>
      </main>
    </div>
  );
}
