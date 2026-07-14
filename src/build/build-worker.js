// build-worker.js - the browser build runs in a Web Worker, off the UI thread.
// It calls the SDK's REAL build() (the identical FLASH2M banking pipeline the
// CLI uses) over an in-memory VFS, so the browser produces the same carts as
// the CLI - no reimplementation.
//
// The SDK's build() drives the tools SYNCHRONOUSLY (its run()/cc()/as() calls
// don't await). WASM instantiation is only async at COMPILE time, so we compile
// the three cc65/ca65/ld65 modules once at worker startup (async, warm), then
// each tool run is `new WebAssembly.Instance` - synchronous - via cc65-glue.js.
// That's what lets env.runTool be sync and satisfy build() unchanged.
//
// Protocol: main posts { type:"build", id, source, opts }; worker posts back
// { type:"progress"|"done"|"error", id, ... }.

import { build } from "gtlua/build";
import { runWasmTool } from "./cc65-glue.js";

const GLUE_BASE = "/cc65/wasm";
const SHARE_BASE = "/cc65/share";
const SDK_BASE = "/sdk";
const SHARE_FOR = { cc65: ["include"], ca65: ["asminc"], ld65: ["lib", "cfg"] };

const enc = new TextEncoder();
const dec = new TextDecoder();

// ---- warm caches (loaded/compiled once, reused for the worker's life) -------
const moduleCache = new Map();     // tool -> WebAssembly.Module (compiled)
const shareCache = new Map();      // subdir -> Map<vfsPath, Uint8Array>
const compileCache = new Map();    // cc65/ca65 result cache, PERSISTS across builds (see runTool)
// FLASH2M placement replay (build/.placement.json): the CLI persists the last
// winning bank layout on disk so the next build links in ONE pass instead of
// re-running the placement ladder (6-9 game-unit recompiles + links). The
// browser VFS is rebuilt per build, which silently dropped that file and made
// EVERY banked build pay the full search (~3s warm, ~10s cold for a big game).
// Carry it across builds here, keyed PER PROJECT: build() also uses the file's
// mere existence as a "this cart overflows 32K" hint, so seeding another
// project's layout would wrongly route a small EEPROM32K game to FLASH2M.
const replayCache = new Map();     // projectKey -> Uint8Array
const REPLAY_PATH = "/work/build/.placement.json";
let sdkFiles = null;               // Map<path, Uint8Array>
let shareManifest = null;

// ---- IndexedDB persistence: the browser's equivalent of the CLI's build/ dir.
// The Node CLI is subsecond warm ONLY because build/.placement.json + the object
// files persist on disk; a fresh browser session had no disk, so every visit
// paid the full ~10s FLASH2M search again. Both caches are content-addressed
// (compileCache keys embed the source hash + flags), so invalidation is
// automatic; the whole DB is versioned by a toolchain signature (hash of the
// three tool .wasm binaries) and dropped wholesale when the toolchain changes.
const DB_NAME = "gtlua-build-cache";
const CC_CAP = 600;                // entry cap; nuke-and-rebuild past this
let dbPromise = null;
function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("cc")) db.createObjectStore("cc");
        if (!db.objectStoreNames.contains("replay")) db.createObjectStore("replay");
        if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta");
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);      // private mode etc: run memory-only
      req.onblocked = () => resolve(null);
    } catch { resolve(null); }
  });
  return dbPromise;
}
const idbReq = (r) => new Promise((res) => { r.onsuccess = () => res(r.result); r.onerror = () => res(undefined); });
async function idbReadAll(db, store, into) {
  await new Promise((res) => {
    const cur = db.transaction(store).objectStore(store).openCursor();
    cur.onsuccess = () => {
      const c = cur.result;
      if (c) { into.set(c.key, c.value); c.continue(); } else res();
    };
    cur.onerror = () => res();
  });
}
async function idbClearAll(db) {
  await Promise.all(["cc", "replay", "meta"].map((s) => idbReq(db.transaction(s, "readwrite").objectStore(s).clear())));
}
// a stored replay must be a real placement document - a garbage entry does
// not just fail to replay, its mere PRESENCE in the VFS routes small carts
// into the FLASH2M pipeline (build's overflows-32K hint is file existence)
function validReplay(u8) {
  try {
    const parsed = JSON.parse(new TextDecoder().decode(u8));
    return !!(parsed && typeof parsed === "object" && parsed.placement);
  } catch { return false; }
}
const dirtyCC = new Map(), dirtyReplay = new Map();
function persistDirty() {          // fire-and-forget after each build
  if (!dirtyCC.size && !dirtyReplay.size) return;
  openDB().then((db) => {
    if (!db) { dirtyCC.clear(); dirtyReplay.clear(); return; }
    if (dirtyCC.size) {
      const st = db.transaction("cc", "readwrite").objectStore("cc");
      for (const [k, v] of dirtyCC) st.put(v, k);
      dirtyCC.clear();
    }
    if (dirtyReplay.size) {
      const st = db.transaction("replay", "readwrite").objectStore("replay");
      for (const [k, v] of dirtyReplay) st.put(v, k);
      dirtyReplay.clear();
    }
  }).catch(() => {});
}
const toolHashes = new Map();      // tool -> fnv of its wasm binary
let toolSig = "";                  // deterministic signature over all tools
async function loadPersistedCaches() {
  const db = await openDB();
  if (!db) return;
  const saved = await idbReq(db.transaction("meta").objectStore("meta").get("toolSig"));
  if (saved !== toolSig) { await idbClearAll(db); }
  else {
    await idbReadAll(db, "cc", compileCache);
    await idbReadAll(db, "replay", replayCache);
    // self-heal: drop poisoned entries (the SPA-fallback bug stored HTML)
    for (const [k, v] of [...replayCache]) {
      if (!validReplay(v)) {
        replayCache.delete(k);
        db.transaction("replay", "readwrite").objectStore("replay").delete(k);
      }
    }
    if (compileCache.size > CC_CAP) {
      compileCache.clear();
      await idbReq(db.transaction("cc", "readwrite").objectStore("cc").clear());
    }
  }
  db.transaction("meta", "readwrite").objectStore("meta").put(toolSig, "toolSig");
}

async function compileTool(tool) {
  if (moduleCache.has(tool)) return moduleCache.get(tool);
  const bytes = await (await fetch(`${GLUE_BASE}/${tool}.wasm`)).arrayBuffer();
  toolHashes.set(tool, fnv1aHex(new Uint8Array(bytes)));
  const mod = await WebAssembly.compile(bytes);
  moduleCache.set(tool, mod);
  return mod;
}

async function shareManifestFetch() {
  if (!shareManifest) shareManifest = await (await fetch(`${SHARE_BASE}/manifest.json`)).json();
  return shareManifest;
}
async function loadShareSub(sub) {
  if (shareCache.has(sub)) return shareCache.get(sub);
  const m = await shareManifestFetch();
  const files = new Map();
  await Promise.all((m[sub] ?? []).map(async (rel) => {
    files.set(`/cc65/${sub}/${rel}`, new Uint8Array(await (await fetch(`${SHARE_BASE}/${sub}/${rel}`)).arrayBuffer()));
  }));
  shareCache.set(sub, files);
  return files;
}
async function loadSdkRuntime() {
  if (sdkFiles) return sdkFiles;
  const list = await (await fetch(`${SDK_BASE}/manifest.json`)).json();
  const files = new Map();
  await Promise.all(list.files.map(async (rel) => {
    files.set(`${SDK_BASE}/${rel}`, new Uint8Array(await (await fetch(`${SDK_BASE}/${rel}`)).arrayBuffer()));
  }));
  sdkFiles = files;
  return files;
}

// Warm everything the build needs BEFORE build() runs, so runTool can be sync.
async function warmup() {
  await Promise.all([
    compileTool("cc65"), compileTool("ca65"), compileTool("ld65"),
    loadShareSub("include"), loadShareSub("asminc"), loadShareSub("lib"), loadShareSub("cfg"),
    loadSdkRuntime(),
  ]);
  // sorted so Promise.all completion order can't change the signature
  toolSig = [...toolHashes.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([t, h]) => `${t}:${h}`).join(";");
  await loadPersistedCaches();
}

// ---- posix path + hash helpers (build.js's env) -----------------------------
const pjoin = (...parts) => parts.join("/").replace(/\/+/g, "/");
const pdirname = (p) => p.replace(/\/[^/]*$/, "") || "/";
const pbasename = (p, ext) => { let b = p.replace(/^.*\//, ""); if (ext && b.endsWith(ext)) b = b.slice(0, -ext.length); return b; };
const pextname = (p) => { const b = pbasename(p); const i = b.lastIndexOf("."); return i > 0 ? b.slice(i) : ""; };
// FNV-1a hex - build.js keys its in-build object memos with this (cache key only)
function fnv1aHex(data) {
  const bytes = typeof data === "string" ? enc.encode(data) : data;
  let h1 = 0x811c9dc5 >>> 0, h2 = (0x811c9dc5 ^ 0x9e3779b9) >>> 0;
  for (let i = 0; i < bytes.length; i++) {
    h1 = (Math.imul(h1 ^ bytes[i], 0x01000193)) >>> 0;
    h2 = (Math.imul(h2 ^ bytes[bytes.length - 1 - i], 0x01000193)) >>> 0;
  }
  return h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0");
}

/**
 * Build a Lua game to a .gtr in the browser via the SDK's real build().
 * @param {string} source
 * @param {object} opts { num8, quadrantBytes?, sheetBytes?, framesBytes?, __id }
 */
async function buildCart(source, opts = {}) {
  const t0 = performance.now();
  const progress = (msg) => postMessage({ type: "progress", id: opts.__id, msg });
  progress("warming tools");
  await warmup();

  const vfs = new Map(sdkFiles);              // warm SDK runtime, cloned per build
  const projectKey = typeof opts.projectKey === "string" ? opts.projectKey : "";
  const replay = projectKey && replayCache.get(projectKey);
  if (replay) vfs.set(REPLAY_PATH, replay);   // seed THIS project's placement replay
  // Pre-mount the whole cc65 share tree so build()'s `env.exists(asminc)` guard
  // (checked before any tool runs) sees it, and so every tool finds its files.
  for (const sub of ["include", "asminc", "lib", "cfg"]) {
    for (const [p, bytes] of shareCache.get(sub)) vfs.set(p, bytes);
  }
  vfs.set("/work/main.lua", enc.encode(source));
  // sprite sheet: up to four 128x128 quadrant files (gfx.gtg + gfx_1/2/3.gtg).
  // build()'s discoverQuadrants finds the siblings of the base gfx.gtg, so we
  // just mount each present quadrant. (Legacy single-blob sheetBytes still
  // accepted as the base quadrant, for callers not yet on quadrantBytes.)
  let hasSheet = false;
  if (opts.quadrantBytes) {
    for (const [name, bytes] of Object.entries(opts.quadrantBytes)) {
      vfs.set(`/work/${name}`, bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
      hasSheet = true;
    }
  } else if (opts.sheetBytes) {
    vfs.set("/work/gfx.gtg", new Uint8Array(opts.sheetBytes));
    hasSheet = true;
  }
  if (opts.framesBytes) vfs.set("/work/gfx.gsi", new Uint8Array(opts.framesBytes));
  // project songs: mount each .gtm2 blob; build() injects them into the game C
  // and registers a song bank so music(n) plays project song n.
  const songsPaths = [];
  if (opts.songs) {
    opts.songs.forEach((bytes, i) => {
      const p = `/work/song${i}.gtm2`;
      vfs.set(p, bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
      songsPaths.push(p);
    });
  }

  // SYNCHRONOUS tool runner with a CROSS-BUILD compile cache.
  //
  // cc65/ca65 are deterministic (reproducible objects), and each call is
  // `[...flags, -o <dst>, <src>]` with ONE primary input. The SDK runtime units
  // (gt_api/gt_fixed/gt_math/crt0/...) are invariant - the editor can't change
  // them - yet build() recompiles them every time (its objMemo resets per call).
  // So cache the tool's output keyed on (flags + src PATH + hash of the src
  // BYTES): on a hit we write the remembered output and skip the WASM tool. The
  // byte-hash means a changed source -> new key -> recompiles once ("always the
  // latest"). ld65 is NOT cached (many varying .o inputs; already fast).
  const runTool = (tool, args) => {
    const cacheable = (tool === "cc65" || tool === "ca65");
    let cacheKey = null;
    if (cacheable) {
      const oi = args.indexOf("-o");
      const dst = oi >= 0 ? args[oi + 1] : null;
      const src = args[args.length - 1];
      const srcBytes = vfs.get(src);
      if (dst && srcBytes) {
        // key on the flags (with the src path, but NOT the abs -o path) + src hash
        const flagArgs = args.filter((_, i) => i !== oi && i !== oi + 1);
        cacheKey = tool + "\x1f" + flagArgs.join("\x1f") + "\x1f" + fnv1aHex(srcBytes);
        const hit = compileCache.get(cacheKey);
        if (hit) { vfs.set(dst, hit.out); return { status: hit.status, stdout: "", stderr: hit.stderr }; }
      }
    }
    let stderr = "";
    const status = runWasmTool(moduleCache.get(tool), {
      fs: vfs, argv: [tool, ...args], print: () => {}, printErr: (s) => { stderr += s + "\n"; },
    });
    // strip ANSI so build.js's overflow-detection regex in runLink() matches
    // (ld65 colorizes "Segment X overflows ... by N bytes"; the escape between
    // the quote and the segment name would hide it and hard-fail the FLASH2M
    // re-target). Same fix the CLI's wasm_worker applies.
    const cleanErr = stderr.replace(/\x1b\[[0-9;]*m/g, "");
    if (cacheKey && status === 0) {
      const oi = args.indexOf("-o");
      const out = vfs.get(args[oi + 1]);
      if (out) {
        const entry = { out, status, stderr: cleanErr };
        compileCache.set(cacheKey, entry);
        dirtyCC.set(cacheKey, entry);   // flushed to IndexedDB after the build
      }
    }
    return { status, stdout: "", stderr: cleanErr };
  };

  const env = {
    readFile(p) { const b = vfs.get(p); if (!b) throw new Error(`ENOENT ${p}`); return b; },
    readText(p) { return dec.decode(env.readFile(p)); },
    writeFile(p, data) { vfs.set(p, typeof data === "string" ? enc.encode(data) : (data instanceof Uint8Array ? data : new Uint8Array(data))); },
    // A path exists if it's a file key OR a directory prefix of one (build.js
    // guards `-I asminc` with env.exists(asminc), a directory).
    exists(p) { if (vfs.has(p)) return true; const pre = p.endsWith("/") ? p : p + "/"; for (const k of vfs.keys()) if (k.startsWith(pre)) return true; return false; },
    size(p) { const b = vfs.get(p); if (!b) throw new Error(`ENOENT ${p}`); return b.length; },
    mkdirp() { /* flat-key VFS - no dirs */ },
    join: pjoin, dirname: pdirname, basename: pbasename, extname: pextname,
    sdk: SDK_BASE,
    sdkFile: (name) => `${SDK_BASE}/${name}`,
    lib: "/cc65/lib/none.lib",
    asminc: "/cc65/asminc",
    hash: fnv1aHex,
    log: (m) => progress(String(m)),
    warn: () => {},   // cc65 warnings are expected noise; real failures throw from build()
    debug: false,
    runTool,
  };

  const sheetPath = hasSheet ? "/work/gfx.gtg" : undefined;
  const framesPath = opts.framesBytes ? "/work/gfx.gsi" : undefined;
  const gtrPath = "/work/game.gtr";
  await build("/work/main.lua", { outPath: gtrPath, sheetPath, num8: !!opts.num8, framesPath, songsPaths }, env);

  const gtr = vfs.get(gtrPath);
  // harvest the winning placement for this project's next one-pass replay
  const rp = vfs.get(REPLAY_PATH);
  if (projectKey && rp) { replayCache.set(projectKey, rp); dirtyReplay.set(projectKey, rp); }
  persistDirty();
  return { ok: true, gtr, ms: Math.round(performance.now() - t0) };
}

// Kick warmup off the moment the worker exists (page load), so the tools are
// compiled + the share/SDK trees fetched BEFORE the first Play - the first build
// then pays no lazy-init cost. The promise is awaited by buildCart's warmup()
// call too, so a Play that beats warmup just waits on the same in-flight promise.
const warmPromise = warmup().catch((err) => { self.__warmErr = err; });

self.onmessage = async (e) => {
  const { type, id, source, opts } = e.data;
  if (type === "warm") {
    try { await warmPromise; postMessage({ type: "warm-done", id }); }
    catch (err) { postMessage({ type: "warm-done", id, error: String(err) }); }
    return;
  }
  // seed a known-good FLASH2M placement for a project (the staged examples ship
  // the CLI's build/.placement.json), so even the FIRST-EVER build of a big port
  // links in one pass instead of running the placement ladder. Never overwrites
  // a layout the worker has already earned for that project.
  if (type === "seedReplay") {
    const { projectKey, bytes } = e.data;
    if (typeof projectKey === "string" && projectKey && bytes && !replayCache.has(projectKey)) {
      const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
      if (!validReplay(u8)) return;   // never store a non-placement (SPA fallback HTML etc.)
      replayCache.set(projectKey, u8);
      dirtyReplay.set(projectKey, u8);
      persistDirty();
    }
    return;
  }
  if (type !== "build") return;
  try {
    const result = await buildCart(source, { ...opts, __id: id });
    if (result.gtr) postMessage({ type: "done", id, ...result }, [result.gtr.buffer]);
    else postMessage({ type: "done", id, ...result });
  } catch (err) {
    postMessage({ type: "error", id, message: err?.message ?? String(err) });
  }
};
