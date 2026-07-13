import React, { useState, useMemo, useCallback, useRef, useEffect, Suspense } from "react";
import { compile } from "gtlua/compiler/index.js";
// Monaco is heavy (~2.8MB); lazy-load the editor so the app shell + emulator
// paint immediately and Monaco streams in behind a Suspense fallback.
const Editor = React.lazy(() => import("./Editor.jsx").then((m) => ({ default: m.Editor })));
import { buildGtr, prewarm } from "./build/build-client.js";
import { EmulatorPane } from "./emu/EmulatorPane.jsx";
import { RamViewer } from "./emu/RamViewer.jsx";
import { WebSerialFlasher, webSerialAvailable } from "./flash/web-serial-flasher.js";
import { Sidebar } from "./projects/Sidebar.jsx";
import { listProjects, getProject, createProject, saveProject, deleteProject } from "./projects/store.js";
import { loadExampleFiles } from "./projects/examples.js";
import { zipStore, unzip } from "./projects/zip.js";
import { downloadBytes, pickFile } from "./util/download.js";
import { SpriteEditor } from "./gfx/SpriteEditor.jsx";
import { newSheet } from "./gfx/gtg.js";
import { FrameEditor } from "./gfx/FrameEditor.jsx";
import { parseGsi, encodeGsi } from "./gfx/gsi.js";
import { MusicEditor, newSong, songToBytes } from "./audio/MusicEditor.jsx";
import { toHex } from "./audio/gtm2.js";

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
  const [music, setMusic] = useState(null);      // tracker grid model or null (music.json)
  const [view, setView] = useState("code");      // "code" | "sprite" | "frames" | "music"

  const [rom, setRom] = useState(null);
  const [host, setHost] = useState(null);          // running GameTankHost (for the debugger)
  const [bottomTab, setBottomTab] = useState("problems");   // "problems" | "ram"
  const [flash, setFlash] = useState(null);        // { log:[], done, total, label, error, running } while flashing
  const [building, setBuilding] = useState(false);
  const [buildMsg, setBuildMsg] = useState("");
  const [buildErr, setBuildErr] = useState("");
  const buildSeq = useRef(0);
  const saveTimer = useRef(0);
  const sheetSaveTimer = useRef(0);
  const framesSaveTimer = useRef(0);
  const musicSaveTimer = useRef(0);

  // --- projects list + initial project ------------------------------------
  const refreshProjects = useCallback(async () => {
    const list = await listProjects();
    setProjects(list);
    return list;
  }, []);

  useEffect(() => {
    prewarm();   // compile the build tools + fetch the toolchain now, before Play
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
    const mus = rec.files["music.json"];
    setMusic(mus ? JSON.parse(asText(mus)) : null);
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

  // importing a multi-frame Aseprite: set BOTH the packed sheet and the carved
  // .gsi frames, then jump to the frames view to preview the animation.
  const onImportAnimation = useCallback(async (buf, frameList) => {
    setSheet(buf); setFrames(frameList); setView("frames");
    if (!currentId) return;
    const rec = await getProject(currentId);
    if (!rec) return;
    rec.files["gfx.gtg"] = buf;
    rec.files["gfx.gsi"] = encodeGsi(frameList);
    await saveProject(rec, Date.now());
    refreshProjects();
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

  // music (tracker grid model persisted as music.json)
  const onMusicChange = useCallback((m) => {
    setMusic(m);
    if (!currentId) return;
    clearTimeout(musicSaveTimer.current);
    musicSaveTimer.current = setTimeout(async () => {
      const rec = await getProject(currentId);
      if (!rec) return;
      rec.files["music.json"] = JSON.stringify(m);
      await saveProject(rec, Date.now());
      refreshProjects();
    }, 500);
  }, [currentId, refreshProjects]);

  const addMusic = useCallback(async () => {
    const m = newSong();
    setMusic(m); setView("music");
    if (!currentId) return;
    const rec = await getProject(currentId);
    if (!rec) return;
    rec.files["music.json"] = JSON.stringify(m);
    await saveProject(rec, Date.now());
    refreshProjects();
  }, [currentId, refreshProjects]);

  // insert a hexdata(...) + song() snippet into main.lua so the tune plays
  const insertSongSnippet = useCallback(() => {
    if (!music) return;
    const hex = toHex(songToBytes(music));
    const snippet =
      `local tune = hexdata("${hex}")\n\n` +
      `function _init()\n  song(tune)   -- loops; song(tune, false) to play once\nend\n\n`;
    onChange(snippet + source);
    setView("code");
  }, [music, source, onChange]);

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

  // flash the built cart to real hardware over Web Serial (the GTFO programmer)
  const flashToCart = useCallback(async () => {
    if (!rom) return;
    setFlash({ log: [], done: 0, total: 1, label: "", running: true, error: null });
    const flasher = new WebSerialFlasher({
      onProgress: (e) => setFlash((f) => {
        if (!f) return f;
        if (e.type === "log") return { ...f, log: [...f.log, e.msg] };
        return { ...f, done: e.done, total: e.total, label: e.label };
      }),
    });
    try {
      await flasher.open();       // shows the serial port picker
      await flasher.flash(rom);
      setFlash((f) => f && { ...f, running: false });
    } catch (e) {
      setFlash((f) => f && { ...f, running: false, error: String(e?.message ?? e) });
    } finally {
      try { await flasher.close(); } catch { /* */ }
    }
  }, [rom]);

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
        {webSerialAvailable() && (
          <button className="tb-btn flash" onClick={flashToCart} disabled={!rom} title="flash the built cart to real GameTank hardware over USB">⚡ flash</button>
        )}
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
              {music
                ? <button className={"tab " + (view === "music" ? "sel" : "")} onClick={() => setView("music")}>music</button>
                : <button className="tab add" onClick={addMusic} title="add a music track (FM tracker)">+ music</button>}
            </div>
            {view === "code" && (
              <Suspense fallback={<div className="editor-loading">loading editor…</div>}>
                <Editor value={source} onChange={onChange} diagnostics={result.diagnostics} />
              </Suspense>
            )}
            {view === "sprite" && <SpriteEditor sheet={sheet} onChange={onSheetChange} onImportAnimation={onImportAnimation} />}
            {view === "frames" && <FrameEditor sheet={sheet} frames={frames || []} onChange={onFramesChange} />}
            {view === "music" && (
              <div className="music-pane-wrap">
                <div className="music-usebar">
                  <button className="tb-btn" onClick={insertSongSnippet} title="insert hexdata + song() into main.lua">▸ use in game</button>
                  <span className="music-usehint">adds a <code>hexdata(...)</code> + <code>song(tune)</code> to your code</span>
                </div>
                <MusicEditor song={music} onChange={onMusicChange} />
              </div>
            )}
          </section>

          <section className="pane emu-pane">
            <div className="pane-title">emulator</div>
            <EmulatorPane rom={rom} onHost={setHost} />
          </section>

          <section className="pane output-pane">
            <div className="pane-tabs bottom">
              <button className={"tab " + (bottomTab === "problems" ? "sel" : "")} onClick={() => setBottomTab("problems")}>
                problems{errors.length ? ` (${errors.length})` : ""}
              </button>
              <button className={"tab " + (bottomTab === "ram" ? "sel" : "")} onClick={() => setBottomTab("ram")}>RAM</button>
            </div>
            {bottomTab === "problems" && (
              <ul className="problems">
                {result.diagnostics.length === 0 && <li className="ok">no problems - compiles clean</li>}
                {result.diagnostics.map((d, i) => (
                  <li key={i} className={d.severity}>
                    <span className="loc">{d.line}:{d.col}</span> {d.message}
                  </li>
                ))}
              </ul>
            )}
            {bottomTab === "ram" && <RamViewer host={host} />}
          </section>
        </main>
      </div>

      {flash && (
        <div className="flash-modal" onClick={(e) => { if (e.target === e.currentTarget && !flash.running) setFlash(null); }}>
          <div className="flash-box">
            <div className="flash-title">⚡ flashing to GameTank</div>
            {!flash.error && (
              <div className="flash-bar"><div className="flash-fill" style={{ width: `${Math.round((flash.done / flash.total) * 100)}%` }} /></div>
            )}
            <div className="flash-status">
              {flash.error ? <span className="err">{flash.error}</span>
                : flash.running ? `${flash.label} — ${flash.done}/${flash.total} blocks`
                : "done ✓"}
            </div>
            <div className="flash-log">{flash.log.map((l, i) => <div key={i}>{l}</div>)}</div>
            {!flash.running && <button className="tb-btn" onClick={() => setFlash(null)}>close</button>}
          </div>
        </div>
      )}
    </div>
  );
}
