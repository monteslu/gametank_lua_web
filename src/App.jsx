import React, { useState, useMemo, useCallback, useRef } from "react";
import { compile } from "gtlua/compiler/index.js";
import { Editor } from "./Editor.jsx";
import { buildGtr } from "./build/build-client.js";
import { EmulatorPane } from "./emu/EmulatorPane.jsx";

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
 * Root IDE shell: a code editor with LIVE diagnostics (our real compiler IS the
 * language service, running in-browser) + a Play button that builds the source
 * to a .gtr in the worker and runs it in the emulator pane. This is the sacred
 * edit -> Play -> running loop.
 */
export function App() {
  const [source, setSource] = useState(HELLO);
  const [rom, setRom] = useState(null);         // Uint8Array of the built cart
  const [building, setBuilding] = useState(false);
  const [buildMsg, setBuildMsg] = useState("");
  const [buildErr, setBuildErr] = useState("");
  const buildSeq = useRef(0);

  // Live compile on every edit (front-end only: fast, pure JS, zero node deps).
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

  const play = useCallback(async () => {
    if (errors.length) return;                  // don't build broken source
    const seq = ++buildSeq.current;
    setBuilding(true); setBuildErr(""); setBuildMsg("building...");
    try {
      const { gtr, ms } = await buildGtr(source, {
        onProgress: (m) => { if (seq === buildSeq.current) setBuildMsg(m); },
      });
      if (seq !== buildSeq.current) return;      // superseded by a newer Play
      setBuildMsg(`built ${gtr.length.toLocaleString()} bytes in ${ms} ms`);
      setRom(gtr);
    } catch (e) {
      if (seq !== buildSeq.current) return;
      setBuildErr(String(e?.message ?? e));
      setBuildMsg("");
    } finally {
      if (seq === buildSeq.current) setBuilding(false);
    }
  }, [source, errors.length]);

  return (
    <div className="ide">
      <header className="topbar">
        <span className="logo">gt-lua <span className="dim">web</span></span>
        <button className="play" onClick={play} disabled={building || errors.length > 0} title="build & run (Ctrl-R)">
          {building ? "building..." : "▶ Play"}
        </button>
        <span className={"status " + (errors.length ? "err" : "ok")}>
          {errors.length ? `${errors.length} error${errors.length > 1 ? "s" : ""}` : "ready"}
          {warnings.length ? ` · ${warnings.length} warning${warnings.length > 1 ? "s" : ""}` : ""}
        </span>
        <span className="build-msg">{buildErr ? <span className="err">{buildErr}</span> : buildMsg}</span>
      </header>

      <main className="panes">
        <section className="pane editor-pane">
          <div className="pane-title">main.lua</div>
          <Editor value={source} onChange={onChange} diagnostics={result.diagnostics} />
        </section>

        <section className="pane emu-pane">
          <div className="pane-title">emulator</div>
          <EmulatorPane rom={rom} />
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
        </section>
      </main>
    </div>
  );
}
