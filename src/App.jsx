import React, { useState, useMemo, useCallback, useRef, useEffect, Suspense } from "react";
import { compile } from "gtlua/compiler/index.js";
// Monaco is heavy (~2.8MB); lazy-load the editor so the app shell + emulator
// paint immediately and Monaco streams in behind a Suspense fallback.
const Editor = React.lazy(() => import("./Editor.jsx").then((m) => ({ default: m.Editor })));
import { buildGtr } from "./build/build-client.js";
import { EmulatorPane } from "./emu/EmulatorPane.jsx";
import { Sidebar } from "./projects/Sidebar.jsx";
import { listProjects, getProject, createProject, saveProject, deleteProject } from "./projects/store.js";
import { loadExampleFiles } from "./projects/examples.js";
import { zipStore, unzip } from "./projects/zip.js";
import { downloadBytes, pickFile } from "./util/download.js";
import { SpriteEditor } from "./gfx/SpriteEditor.jsx";
import { newSheet } from "./gfx/gtg.js";
import { FrameEditor } from "./gfx/FrameEditor.jsx";
import { parseGsi, encodeGsi } from "./gfx/gsi.js";

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

const dec = new TextDecoder();
const asText = (v) => (typeof v === "string" ? v : dec.decode(v));

/**
 * Root IDE shell. Owns the current project (persisted to IndexedDB, autosaved),
 * the live compile, the Play->build->run loop, and export/import. The editor is
 * the left column; emulator + problems stack on the right; the project explorer
 * is the far-left sidebar.
 */
export function App() {
  const [projects, setProjects] = useState([]);
  const [currentId, setCurrentId] = useState(null);
  const [source, setSource] = useState(HELLO);
  const [projectName, setProjectName] = useState("hello");
  const [sheet, setSheet] = useState(null);      // Uint8Array(16384) or null (no gfx.gtg)
  const [frames, setFrames] = useState(null);    // array of {vxo,vyo,w,h,gx,gy} or null
  const [view, setView] = useState("code");      // "code" | "sprite" | "frames"

  const [rom, setRom] = useState(null);
  const [building, setBuilding] = useState(false);
  const [buildMsg, setBuildMsg] = useState("");
  const [buildErr, setBuildErr] = useState("");
  const buildSeq = useRef(0);
  const saveTimer = useRef(0);
  const sheetSaveTimer = useRef(0);
  const framesSaveTimer = useRef(0);

  // --- projects list + initial project ------------------------------------
  const refreshProjects = useCallback(async () => {
    const list = await listProjects();
    setProjects(list);
    return list;
  }, []);

  useEffect(() => {
    (async () => {
      const list = await refreshProjects();
      if (list.length) {
        await openProject(list[0].id);
      } else {
        // first run: seed a "hello" project the user owns
        const rec = await createProject("hello", { "main.lua": HELLO }, Date.now());
        await refreshProjects();
        setCurrentId(rec.id); setSource(HELLO); setProjectName(rec.name);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openProject = useCallback(async (id) => {
    const rec = await getProject(id);
    if (!rec) return;
    setCurrentId(rec.id);
    setProjectName(rec.name);
    setSource(asText(rec.files["main.lua"] ?? ""));
    const g = rec.files["gfx.gtg"];
    setSheet(g ? (g instanceof Uint8Array ? g : new Uint8Array(g)) : null);
    const gsi = rec.files["gfx.gsi"];
    setFrames(gsi ? parseGsi(gsi instanceof Uint8Array ? gsi : new Uint8Array(gsi)) : null);
    setView("code");
    setRom(null); setBuildMsg(""); setBuildErr("");
  }, []);

  // --- live compile --------------------------------------------------------
  const result = useMemo(() => {
    try {
      return compile(source, "main.lua");
    } catch (e) {
      return { ok: false, c: null, diagnostics: [{ severity: "error", message: String(e?.message ?? e), line: 1, col: 1 }] };
    }
  }, [source]);

  const errors = result.diagnostics.filter((d) => d.severity === "error");
  const warnings = result.diagnostics.filter((d) => d.severity === "warning");

  // --- autosave (debounced) to IndexedDB ----------------------------------
  const onChange = useCallback((v) => {
    setSource(v);
    if (!currentId) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      const rec = await getProject(currentId);
      if (!rec) return;
      rec.files["main.lua"] = v;
      await saveProject(rec, Date.now());
      refreshProjects();
    }, 500);
  }, [currentId, refreshProjects]);

  // expose editor set/get for the test harness (Monaco has no plain textarea)
  useEffect(() => {
    if (typeof window === "undefined" || !window.__gtlua_test) return;
    window.__gtlua_test.setSource = (t) => onChange(t);
    window.__gtlua_test.getSource = () => source;
  }, [onChange, source]);

  // sprite-sheet edits: immutable buffer in, debounced persist as gfx.gtg
  const onSheetChange = useCallback((buf) => {
    setSheet(buf);
    if (!currentId) return;
    clearTimeout(sheetSaveTimer.current);
    sheetSaveTimer.current = setTimeout(async () => {
      const rec = await getProject(currentId);
      if (!rec) return;
      rec.files["gfx.gtg"] = buf;
      await saveProject(rec, Date.now());
      refreshProjects();
    }, 500);
  }, [currentId, refreshProjects]);

  // create an empty sprite sheet for this project + switch to the sprite view
  const addSheet = useCallback(async () => {
    const buf = newSheet();
    setSheet(buf); setView("sprite");
    if (!currentId) return;
    const rec = await getProject(currentId);
    if (!rec) return;
    rec.files["gfx.gtg"] = buf;
    await saveProject(rec, Date.now());
    refreshProjects();
  }, [currentId, refreshProjects]);

  // frame-table (.gsi) edits: array in, debounced persist as encoded gfx.gsi
  const onFramesChange = useCallback((arr) => {
    setFrames(arr);
    if (!currentId) return;
    clearTimeout(framesSaveTimer.current);
    framesSaveTimer.current = setTimeout(async () => {
      const rec = await getProject(currentId);
      if (!rec) return;
      rec.files["gfx.gsi"] = encodeGsi(arr);
      await saveProject(rec, Date.now());
      refreshProjects();
    }, 500);
  }, [currentId, refreshProjects]);

  const addFrames = useCallback(async () => {
    setFrames([]); setView("frames");
    if (!currentId) return;
    const rec = await getProject(currentId);
    if (!rec) return;
    rec.files["gfx.gsi"] = encodeGsi([]);
    await saveProject(rec, Date.now());
    refreshProjects();
  }, [currentId, refreshProjects]);

  // --- project ops ---------------------------------------------------------
  const newProject = useCallback(async () => {
    const rec = await createProject("untitled", { "main.lua": "function _draw()\n  cls(0)\nend\n" }, Date.now());
    await refreshProjects();
    await openProject(rec.id);
  }, [refreshProjects, openProject]);

  const forkExample = useCallback(async (ex) => {
    const files = await loadExampleFiles(ex);
    const rec = await createProject(ex.name, files, Date.now());
    await refreshProjects();
    await openProject(rec.id);
  }, [refreshProjects, openProject]);

  const removeProject = useCallback(async (id) => {
    await deleteProject(id);
    const list = await refreshProjects();
    if (id === currentId) {
      if (list.length) await openProject(list[0].id);
      else await newProject();
    }
  }, [currentId, refreshProjects, openProject, newProject]);

  const rename = useCallback(async (name) => {
    setProjectName(name);
    if (!currentId) return;
    const rec = await getProject(currentId);
    if (!rec) return;
    rec.name = name || "untitled";
    await saveProject(rec, Date.now());
    refreshProjects();
  }, [currentId, refreshProjects]);

  // --- build / play --------------------------------------------------------
  const play = useCallback(async () => {
    if (errors.length) return;
    const seq = ++buildSeq.current;
    setBuilding(true); setBuildErr(""); setBuildMsg("building...");
    try {
      const { gtr, ms } = await buildGtr(source, {
        // num8 (8.8 fixed) is a per-project numeric mode; default off to match
        // the CLI. A project toggle can set it later; forcing it on would change
        // fixed-point semantics for games that don't expect it.
        sheetBytes: sheet ? sheet.buffer.slice(sheet.byteOffset, sheet.byteOffset + sheet.byteLength) : undefined,
        framesBytes: frames && frames.length ? encodeGsi(frames).buffer : undefined,
        onProgress: (m) => { if (seq === buildSeq.current) setBuildMsg(m); },
      });
      if (seq !== buildSeq.current) return;
      setBuildMsg(`built ${gtr.length.toLocaleString()} bytes in ${ms} ms`);
      setRom(gtr);
    } catch (e) {
      if (seq !== buildSeq.current) return;
      setBuildErr(String(e?.message ?? e));
      setBuildMsg("");
    } finally {
      if (seq === buildSeq.current) setBuilding(false);
    }
  }, [source, errors.length, sheet, frames]);

  // Ctrl-R / Cmd-R = play (the sacred loop)
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === "r" || e.key === "R")) {
        e.preventDefault();
        play();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [play]);

  const downloadGtr = useCallback(() => {
    if (!rom) return;
    downloadBytes(`${projectName || "game"}.gtr`, rom, "application/octet-stream");
  }, [rom, projectName]);

  const exportBundle = useCallback(async () => {
    const rec = currentId ? await getProject(currentId) : { files: { "main.lua": source } };
    const files = { ...rec.files };
    files["project.json"] = JSON.stringify({ name: projectName, entry: "main.lua" }, null, 2);
    const zip = zipStore(files);
    downloadBytes(`${projectName || "project"}.gtlua`, zip, "application/zip");
  }, [currentId, source, projectName]);

  const importBundle = useCallback(async () => {
    const picked = await pickFile(".gtlua,.zip");
    if (!picked) return;
    let files;
    try { files = unzip(picked.bytes); } catch (e) { setBuildErr(`import failed: ${e.message}`); return; }
    let name = picked.name.replace(/\.(gtlua|zip)$/i, "");
    if (files["project.json"]) {
      try { name = JSON.parse(dec.decode(files["project.json"])).name || name; } catch { /* keep filename */ }
      delete files["project.json"];
    }
    // text-decode main.lua (stored as bytes in the zip)
    const norm = {};
    for (const [p, bytes] of Object.entries(files)) norm[p] = p.endsWith(".lua") ? dec.decode(bytes) : bytes;
    const rec = await createProject(name, norm, Date.now());
    await refreshProjects();
    await openProject(rec.id);
  }, [refreshProjects, openProject]);

  return (
    <div className="ide">
      <header className="topbar">
        <span className="logo">gt-lua <span className="dim">web</span></span>
        <input className="proj-name" value={projectName} onChange={(e) => rename(e.target.value)} title="project name" />
        <button className="play" onClick={play} disabled={building || errors.length > 0} title="build & run (Ctrl-R)">
          {building ? "building..." : "▶ Play"}
        </button>
        <button className="tb-btn" onClick={downloadGtr} disabled={!rom} title="download the built .gtr cart">.gtr</button>
        <button className="tb-btn" onClick={exportBundle} title="export project as .gtlua">export</button>
        <span className={"status " + (errors.length ? "err" : "ok")}>
          {errors.length ? `${errors.length} error${errors.length > 1 ? "s" : ""}` : "ready"}
          {warnings.length ? ` · ${warnings.length} warning${warnings.length > 1 ? "s" : ""}` : ""}
        </span>
        <span className="build-msg">{buildErr ? <span className="err">{buildErr}</span> : buildMsg}</span>
      </header>

      <div className="body">
        <Sidebar
          projects={projects}
          currentId={currentId}
          onOpen={openProject}
          onNew={newProject}
          onFork={forkExample}
          onDelete={removeProject}
          onImport={importBundle}
        />

        <main className="panes">
          <section className="pane editor-pane">
            <div className="pane-tabs">
              <button className={"tab " + (view === "code" ? "sel" : "")} onClick={() => setView("code")}>main.lua</button>
              {sheet
                ? <button className={"tab " + (view === "sprite" ? "sel" : "")} onClick={() => setView("sprite")}>gfx.gtg</button>
                : <button className="tab add" onClick={addSheet} title="add a sprite sheet">+ sprites</button>}
              {frames
                ? <button className={"tab " + (view === "frames" ? "sel" : "")} onClick={() => setView("frames")}>gfx.gsi</button>
                : sheet && <button className="tab add" onClick={addFrames} title="add a frame table (sprf animation)">+ frames</button>}
            </div>
            {view === "code" && (
              <Suspense fallback={<div className="editor-loading">loading editor…</div>}>
                <Editor value={source} onChange={onChange} diagnostics={result.diagnostics} />
              </Suspense>
            )}
            {view === "sprite" && <SpriteEditor sheet={sheet} onChange={onSheetChange} />}
            {view === "frames" && <FrameEditor sheet={sheet} frames={frames || []} onChange={onFramesChange} />}
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
    </div>
  );
}
