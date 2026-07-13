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
let sdkFiles = null;               // Map<path, Uint8Array>
let shareManifest = null;

async function compileTool(tool) {
  if (moduleCache.has(tool)) return moduleCache.get(tool);
  const bytes = await (await fetch(`${GLUE_BASE}/${tool}.wasm`)).arrayBuffer();
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
 * @param {object} opts { num8, sheetBytes?, framesBytes?, __id }
 */
async function buildCart(source, opts = {}) {
  const t0 = performance.now();
  const progress = (msg) => postMessage({ type: "progress", id: opts.__id, msg });
  progress("warming tools");
  await warmup();

  const vfs = new Map(sdkFiles);              // warm SDK runtime, cloned per build
  // Pre-mount the whole cc65 share tree so build()'s `env.exists(asminc)` guard
  // (checked before any tool runs) sees it, and so every tool finds its files.
  for (const sub of ["include", "asminc", "lib", "cfg"]) {
    for (const [p, bytes] of shareCache.get(sub)) vfs.set(p, bytes);
  }
  vfs.set("/work/main.lua", enc.encode(source));
  if (opts.sheetBytes) vfs.set("/work/gfx.gtg", new Uint8Array(opts.sheetBytes));
  if (opts.framesBytes) vfs.set("/work/gfx.gsi", new Uint8Array(opts.framesBytes));

  // SYNCHRONOUS tool runner: instantiate the pre-compiled module, run, collect
  // declared outputs. (Share tree already mounted above.)
  const runTool = (tool, args) => {
    let stderr = "";
    const status = runWasmTool(moduleCache.get(tool), {
      fs: vfs, argv: [tool, ...args], print: () => {}, printErr: (s) => { stderr += s + "\n"; },
    });
    // strip ANSI so build.js's overflow-detection regex in runLink() matches
    // (ld65 colorizes "Segment X overflows ... by N bytes"; the escape between
    // the quote and the segment name would hide it and hard-fail the FLASH2M
    // re-target). Same fix the CLI's wasm_worker applies.
    return { status, stdout: "", stderr: stderr.replace(/\x1b\[[0-9;]*m/g, "") };
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

  const sheetPath = opts.sheetBytes ? "/work/gfx.gtg" : undefined;
  const framesPath = opts.framesBytes ? "/work/gfx.gsi" : undefined;
  const gtrPath = "/work/game.gtr";
  await build("/work/main.lua", { outPath: gtrPath, sheetPath, num8: !!opts.num8, framesPath }, env);

  const gtr = vfs.get(gtrPath);
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
  if (type !== "build") return;
  try {
    const result = await buildCart(source, { ...opts, __id: id });
    if (result.gtr) postMessage({ type: "done", id, ...result }, [result.gtr.buffer]);
    else postMessage({ type: "done", id, ...result });
  } catch (err) {
    postMessage({ type: "error", id, message: err?.message ?? String(err) });
  }
};
