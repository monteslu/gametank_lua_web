import React, { useState, useMemo, useCallback, useRef, useEffect, Suspense } from "react";
import { compile } from "gtlua/compiler/index.js";
// Monaco is heavy (~2.8MB); lazy-load the editor so the app shell + emulator
// paint immediately and Monaco streams in behind a Suspense fallback.
const Editor = React.lazy(() => import("./Editor.jsx").then((m) => ({ default: m.Editor })));
// cheatsheet pulls in marked; lazy-load it too so it's not in the main bundle
const Cheatsheet = React.lazy(() => import("./Cheatsheet.jsx").then((m) => ({ default: m.Cheatsheet })));
const ProjectSettings = React.lazy(() => import("./ProjectSettings.jsx").then((m) => ({ default: m.ProjectSettings })));
import { buildGtr, prewarm, seedReplay } from "./build/build-client.js";
import { EmulatorPane } from "./emu/EmulatorPane.jsx";
import { RamViewer } from "./emu/RamViewer.jsx";
import { WebSerialFlasher, webSerialAvailable } from "./flash/web-serial-flasher.js";
import { Sidebar } from "./projects/Sidebar.jsx";
import { listProjects, getProject, createProject, saveProject, deleteProject } from "./projects/store.js";
import { loadExampleFiles, loadExamplePlacement } from "./projects/examples.js";
import { zipStore, unzip } from "./projects/zip.js";
import { readManifest, writeManifest, ensureManifest, defaultManifest } from "./projects/manifest.js";
import { downloadBytes, pickFile } from "./util/download.js";
import { SpriteEditor } from "./gfx/SpriteEditor.jsx";
import { newSheet, splitSheet, joinSheet, QUAD_FILES } from "./gfx/gtg.js";
import { FrameEditor } from "./gfx/FrameEditor.jsx";
import { parseGsi, encodeGsi } from "./gfx/gsi.js";
import { MusicEditor, newSong, songToBytes } from "./audio/MusicEditor.jsx";
import { toHex } from "./audio/gtm2.js";
import { parseSongbook, serializeSongbook, defaultSongName, songVarName } from "./audio/songbook.js";

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
  // Songs: a project can hold several .gtm2 songs (title/level/boss). `songs` is
  // the songbook [{name, model}]; `songIdx` is the active one; `music` mirrors
  // the active song's MODEL so the editor/build/copy paths stay single-song.
  const [songs, setSongs] = useState(null);      // [{name, model}] or null (no music)
  const [songIdx, setSongIdx] = useState(0);
  const [music, setMusic] = useState(null);      // active song model (songs[songIdx].model)
  const [num8, setNum8] = useState(false);       // 8.8 fixed-point build mode (mirrors project.num8)
  const [project, setProject] = useState({});    // project.json manifest (title/romname/num8, GameTank SDK shape)
  const [view, setView] = useState("code");      // "code" | "sprite" | "frames" | "music"

  const [rom, setRom] = useState(null);
  const [host, setHost] = useState(null);          // running GameTankHost (for the debugger)
  const [bottomTab, setBottomTab] = useState("problems");   // "problems" | "ram"
  const [flash, setFlash] = useState(null);        // { log:[], done, total, label, error, running } while flashing
  const [building, setBuilding] = useState(false);
  const [warm, setWarm] = useState(false);       // build worker prewarmed (tools compiled + toolchain fetched)
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
    // compile the build tools + fetch the toolchain now, before Play; the
    // status stays "warming up..." and Play stays disabled until this settles
    // (a cold click would otherwise sit on a silent multi-second first build)
    prewarm().then(() => setWarm(true));
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
    // sprite sheet: stored as up to four 128x128 quadrant files (gfx.gtg +
    // gfx_1/2/3.gtg, the C SDK layout); stitch them into one 256x256 buffer to
    // edit. A project has a sheet if at least the base quadrant exists.
    setSheet(rec.files["gfx.gtg"] ? joinSheet(rec.files) : null);
    const gsi = rec.files["gfx.gsi"];
    setFrames(gsi ? parseGsi(gsi instanceof Uint8Array ? gsi : new Uint8Array(gsi)) : null);
    const book = parseSongbook(rec.files["music.json"] ? asText(rec.files["music.json"]) : null);
    setSongs(book ? book.songs : null);
    setSongIdx(book ? book.current : 0);
    setMusic(book ? book.songs[book.current].model : null);
    // project.json - the GameTank project manifest (official C SDK shape:
    // title/romname, plus gtlua build knobs like num8). readManifest always
    // returns a complete manifest, defaulting anything missing - so even a
    // legacy project opened here behaves as if it always had one.
    const proj = readManifest(rec.files["project.json"] ? asText(rec.files["project.json"]) : null, rec.name);
    setProject(proj);
    setNum8(!!proj.num8);
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
    window.__gtlua_test.getHost = () => host;
  }, [onChange, source, host]);

  // Write a 256x256 sheet into a project record as quadrant files: present
  // quadrants (splitSheet omits empty NE/SW/SE) are written, and any quadrant
  // file that's no longer present is deleted so a cleared quadrant doesn't linger
  // in the ROM. Mutates rec.files in place; caller saves.
  const writeSheetFiles = (rec, sheet) => {
    const quads = splitSheet(sheet);
    for (const name of QUAD_FILES) {
      if (quads[name]) rec.files[name] = quads[name];
      else delete rec.files[name];
    }
  };

  // sprite-sheet edits: immutable 256x256 buffer in, debounced persist as the
  // quadrant files.
  const onSheetChange = useCallback((buf) => {
    setSheet(buf);
    if (!currentId) return;
    clearTimeout(sheetSaveTimer.current);
    sheetSaveTimer.current = setTimeout(async () => {
      const rec = await getProject(currentId);
      if (!rec) return;
      writeSheetFiles(rec, buf);
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
    writeSheetFiles(rec, buf);
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
    writeSheetFiles(rec, buf);
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

  // project.json (Settings tab): persist the manifest + mirror num8 into the
  // build. Title/romname are metadata; num8 changes what the next build does.
  const onProjectChange = useCallback(async (next) => {
    setProject(next);
    setNum8(!!next.num8);
    if (!currentId) return;
    const rec = await getProject(currentId);
    if (!rec) return;
    rec.files["project.json"] = writeManifest(next);
    // keep the project's display name in sync with its title
    if (next.title && next.title !== rec.name) rec.name = next.title;
    await saveProject(rec, Date.now());
    refreshProjects();
  }, [currentId, refreshProjects]);

  // music: a songbook [{name, model}] persisted as music.json (v2 envelope).
  // Persist the whole book immediately (add/rename/delete are structural), or
  // debounced for note edits.
  const persistSongbook = useCallback(async (bookSongs, current, debounce) => {
    if (!currentId) return;
    const write = async () => {
      const rec = await getProject(currentId);
      if (!rec) return;
      rec.files["music.json"] = serializeSongbook({ songs: bookSongs, current });
      await saveProject(rec, Date.now());
      refreshProjects();
    };
    if (debounce) {
      clearTimeout(musicSaveTimer.current);
      musicSaveTimer.current = setTimeout(write, 500);
    } else {
      await write();
    }
  }, [currentId, refreshProjects]);

  // an edit to the ACTIVE song: update its model in the book, debounced save
  const onMusicChange = useCallback((m) => {
    setMusic(m);
    setSongs((prev) => {
      const next = (prev ?? [{ name: "song 0", model: m }]).slice();
      const i = Math.min(songIdx, next.length - 1);
      next[i] = { ...next[i], model: m };
      persistSongbook(next, i, true);
      return next;
    });
  }, [songIdx, persistSongbook]);

  const addMusic = useCallback(async () => {
    const m = newSong();
    const book = [{ name: "song 0", model: m }];
    setSongs(book); setSongIdx(0); setMusic(m); setView("music");
    await persistSongbook(book, 0, false);
  }, [persistSongbook]);

  // add another song to the book and switch to it
  const addSong = useCallback(async () => {
    const m = newSong();
    setSongs((prev) => {
      const base = prev ?? [];
      const name = defaultSongName({ songs: base });
      const next = [...base, { name, model: m }];
      const i = next.length - 1;
      setSongIdx(i); setMusic(m);
      persistSongbook(next, i, false);
      return next;
    });
  }, [persistSongbook]);

  const selectSong = useCallback((i) => {
    setSongIdx(i);
    setMusic(songs?.[i]?.model ?? null);
    persistSongbook(songs, i, false);
  }, [songs, persistSongbook]);

  const renameSong = useCallback((i, name) => {
    setSongs((prev) => {
      if (!prev) return prev;
      const next = prev.slice();
      next[i] = { ...next[i], name };
      persistSongbook(next, songIdx, false);
      return next;
    });
  }, [songIdx, persistSongbook]);

  const deleteSong = useCallback(async (i) => {
    if (!songs || songs.length === 0) return;
    const next = songs.slice();
    next.splice(i, 1);
    if (next.length === 0) {
      // last song removed -> project has no music again
      setSongs(null); setSongIdx(0); setMusic(null); setView("code");
      if (currentId) {
        const rec = await getProject(currentId);
        if (rec) { delete rec.files["music.json"]; await saveProject(rec, Date.now()); refreshProjects(); }
      }
      return;
    }
    const ni = Math.min(i, next.length - 1);
    setSongs(next); setSongIdx(ni); setMusic(next[ni].model);
    await persistSongbook(next, ni, false);
  }, [songs, currentId, persistSongbook, refreshProjects]);

  // Copy the ACTIVE song as a single `hexdata(...)` line to the clipboard, named
  // after the song (so multiple songs land in distinct variables). The SDK's
  // only way to embed a composed song is a hexdata blob the game plays with
  // song()/music_bank(); there is no build-side song input. We hand over one
  // line rather than splicing code into the file (which would collide with the
  // user's _init).
  const [copiedSong, setCopiedSong] = useState(false);
  const copySongLine = useCallback(async () => {
    if (!music) return;
    const hex = toHex(songToBytes(music));
    const name = songVarName(songs?.[songIdx]?.name, songIdx);
    const line = `local ${name} = hexdata("${hex}")`;
    try { await navigator.clipboard.writeText(line); } catch { /* clipboard blocked */ }
    setCopiedSong(true);
    setTimeout(() => setCopiedSong(false), 1500);
  }, [music, songs, songIdx]);

  // --- project ops ---------------------------------------------------------
  const newProject = useCallback(async () => {
    const files = { "main.lua": "function _draw()\n  cls(0)\nend\n" };
    files["project.json"] = writeManifest(defaultManifest("untitled"));
    const rec = await createProject("untitled", files, Date.now());
    await refreshProjects();
    await openProject(rec.id);
  }, [refreshProjects, openProject]);

  const forkExample = useCallback(async (ex) => {
    const files = await loadExampleFiles(ex);
    // seed a project.json manifest (GameTank SDK shape) so build knobs like
    // num8 survive fork/reload/export and the Settings tab can edit them. If the
    // example shipped its own project.json, keep it; else default from its name.
    ensureManifest(files, ex.name);
    if (ex.num8 && !JSON.parse(files["project.json"]).num8) {
      const m = readManifest(files["project.json"], ex.name);
      m.num8 = true;
      files["project.json"] = writeManifest(m);
    }
    const rec = await createProject(ex.name, files, Date.now());
    // big FLASH2M ports ship the CLI's winning bank layout; seed it so the
    // fork's first build links in one pass instead of the ~10s placement
    // search. AWAITED before openProject: opening triggers the shadow build,
    // and worker messages process in order - the seed must land first.
    const placement = await loadExamplePlacement(ex);
    if (placement) seedReplay(String(rec.id), placement);
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
    if (errors.length || !warm) return;   // Ctrl-R lands here too; gate it like the button
    const seq = ++buildSeq.current;
    setBuilding(true); setBuildErr(""); setBuildMsg("building...");
    try {
      // sprite sheet -> the up-to-four 128x128 quadrant files the compiler
      // stitches (gfx.gtg + gfx_1/2/3.gtg). splitSheet omits empty quadrants.
      const quadrantBytes = sheet ? splitSheet(sheet) : undefined;
      // tracker songs -> .gtm2 blobs, in songbook order; the build registers
      // them so music(0) plays THE PROJECT'S song 0 (the tune in the editor),
      // music(1) song 1, and so on.
      const songBytes = songs && songs.length ? songs.map((s) => songToBytes(s.model)) : undefined;
      const { gtr, ms } = await buildGtr(source, {
        // num8 (8.8 fixed) is a per-project setting; some ports require it.
        num8,
        quadrantBytes,
        framesBytes: frames && frames.length ? encodeGsi(frames).buffer : undefined,
        songs: songBytes,
        // scopes the worker's FLASH2M placement replay to this project, so one
        // project's banked layout never leaks into another's build
        projectKey: String(currentId ?? ""),
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
  }, [source, errors.length, sheet, frames, songs, num8, currentId, warm]);

  // Shadow build: once per opened project, silently run the real build in the
  // worker right after warmup. It populates the compile + placement caches (and
  // IndexedDB), so the user's actual first Play is a cache hit instead of the
  // full cold search. The worker is serial, so a Play clicked mid-shadow simply
  // queues behind it - never slower than the old cold build.
  const shadowed = useRef(new Set());
  useEffect(() => {
    if (!warm || !currentId || building || errors.length) return;
    if (shadowed.current.has(currentId)) return;
    shadowed.current.add(currentId);
    try {
      buildGtr(source, {
        num8,
        quadrantBytes: sheet ? splitSheet(sheet) : undefined,
        framesBytes: frames && frames.length ? encodeGsi(frames).buffer : undefined,
        songs: songs && songs.length ? songs.map((sg) => songToBytes(sg.model)) : undefined,
        projectKey: String(currentId),
      }).catch(() => {});
    } catch { /* best-effort warmer; Play reports real errors */ }
  }, [warm, currentId, building, errors.length, source, sheet, frames, songs, num8]);

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
    // ship a complete, normalized project.json (title/entry/romname/num8) so the
    // bundle re-imports cleanly here AND is a valid GameTank-shaped project file.
    const m = readManifest(files["project.json"], projectName);
    files["project.json"] = writeManifest(m);
    const zip = zipStore(files);
    downloadBytes(`${m.romname ? m.romname.replace(/\.gtr$/i, "") : projectName || "project"}.gtlua`, zip, "application/zip");
  }, [currentId, source, projectName]);

  const importBundle = useCallback(async () => {
    const picked = await pickFile(".gtlua,.zip");
    if (!picked) return;
    let files;
    try { files = unzip(picked.bytes); } catch (e) { setBuildErr(`import failed: ${e.message}`); return; }
    // text-decode the text files (project.json + *.lua stored as bytes in the zip)
    const norm = {};
    for (const [p, bytes] of Object.entries(files)) {
      norm[p] = (p.endsWith(".lua") || p.endsWith(".json")) ? dec.decode(bytes) : bytes;
    }
    const fileName = picked.name.replace(/\.(gtlua|zip)$/i, "");
    // read (or default) the manifest, then KEEP it - the project name comes from
    // its title, and its build settings (num8) survive the round-trip. A bundle
    // with no manifest (or a legacy {name,entry} one) gets a fresh valid one.
    const manifest = ensureManifest(norm, fileName);
    const rec = await createProject(manifest.title || fileName, norm, Date.now());
    await refreshProjects();
    await openProject(rec.id);
  }, [refreshProjects, openProject]);

  return (
    <div className="ide">
      <header className="topbar">
        <span className="logo">gt-lua <span className="dim">web</span></span>
        <input className="proj-name" value={projectName} onChange={(e) => rename(e.target.value)} title="project name" />
        <button className="play" onClick={play} disabled={!warm || building || errors.length > 0}
          title={warm ? "build & run (Ctrl-R)" : "warming up the build tools..."}>
          {building ? "building..." : warm ? "▶ Play" : "warming up..."}
        </button>
        <button className="tb-btn" onClick={downloadGtr} disabled={!rom} title="download the built .gtr cart">.gtr</button>
        <button className="tb-btn" onClick={exportBundle} title="export project as .gtlua">export</button>
        {webSerialAvailable() && (
          <button className="tb-btn flash" onClick={flashToCart} disabled={!rom} title="flash the built cart to real GameTank hardware over USB">⚡ flash</button>
        )}
        <span className={"status " + (errors.length ? "err" : "ok")}>
          {errors.length ? `${errors.length} error${errors.length > 1 ? "s" : ""}` : warm ? "ready" : "warming up..."}
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
              <button className={"tab " + (view === "settings" ? "sel" : "")} onClick={() => setView("settings")} title="project settings (project.json)">⚙ settings</button>
              <button className={"tab cheat-tab " + (view === "cheat" ? "sel" : "")} onClick={() => setView("cheat")}>📖 cheatsheet</button>
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
                <div className="song-bar" title="a project can hold several songs; a game plays one at a time with song()">
                  {(songs ?? []).map((s, i) => (
                    <button
                      key={i}
                      className={"song-tab " + (i === songIdx ? "sel" : "")}
                      onClick={() => selectSong(i)}
                      onDoubleClick={() => {
                        const name = prompt("song name", s.name);
                        if (name != null && name.trim()) renameSong(i, name.trim());
                      }}
                      title="click to switch · double-click to rename"
                    >{s.name}</button>
                  ))}
                  <button className="song-add" onClick={addSong} title="add another song">＋</button>
                  {songs && songs.length > 0 && (
                    <button
                      className="song-del"
                      onClick={() => { if (confirm(`Delete "${songs[songIdx].name}"?`)) deleteSong(songIdx); }}
                      title="delete the active song"
                    >🗑</button>
                  )}
                </div>
                <div className="music-usebar">
                  <span className="music-usehint">
                    <b>play in game:</b> <code>music({songIdx})</code> plays this song ({songs?.[songIdx]?.name ?? "song"}) · songs are built into the cart by position
                  </span>
                  <span className="tb-sep" />
                  <button className="tb-btn" onClick={copySongLine} title="advanced: copy this song as a raw hexdata(...) line, for playing via song() from your own data">
                    {copiedSong ? "✓ copied" : "⧉ copy hexdata"}
                  </button>
                </div>
                <MusicEditor song={music} onChange={onMusicChange} />
              </div>
            )}
            {view === "settings" && (
              <Suspense fallback={<div className="cheat-empty">loading…</div>}>
                <ProjectSettings project={project} onChange={onProjectChange} projectName={projectName} />
              </Suspense>
            )}
            {view === "cheat" && (
              <Suspense fallback={<div className="cheat-empty">loading…</div>}><Cheatsheet /></Suspense>
            )}
          </section>

          <section className="pane emu-pane">
            <EmulatorPane rom={rom} onHost={setHost} building={building} buildMsg={buildMsg} />
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
