// browser-toolchain.js - run cc65/ca65/ld65 as WASM in the browser.
//
// This is the browser adaptation of the SDK's compiler/wasm_worker.js runTool
// core (see its header note on the shared, environment-agnostic core). The
// difference is purely I/O: the node version reads inputs from and writes
// outputs to the host filesystem; here everything lives in an in-memory VFS the
// caller supplies (Map of vfsPath -> Uint8Array), and the cc65 share tree is
// fetched from /cc65/ (staged in public/).
//
// Load flow per tool: fetch the glue module + its .wasm once (cached), fetch the
// tool's needed share subdir once (cached), then per call: fresh Emscripten
// instance (emcc can't reuse across callMain), mount share + inputs into MEMFS,
// callMain, read outputs back. Same shape as native cc65; proven byte-identical
// there.

const GLUE_BASE = "/cc65/wasm";
const SHARE_BASE = "/cc65/share";

// which share subdir(s) each tool needs (skip the big target/ tree)
const SHARE_FOR = { cc65: ["include"], ca65: ["asminc"], ld65: ["lib", "cfg"] };

const factoryCache = new Map();   // tool -> { factory, wasmBinary }
const shareCache = new Map();     // subdir -> [{ vfs, bytes }]
let shareManifest = null;         // { subdir: [relPaths] }

async function loadFactory(tool) {
  const hit = factoryCache.get(tool);
  if (hit) return hit;
  const [mod, wasmBinary] = await Promise.all([
    import(/* @vite-ignore */ `${GLUE_BASE}/${tool}.js`),
    fetch(`${GLUE_BASE}/${tool}.wasm`).then((r) => r.arrayBuffer()).then((b) => new Uint8Array(b)),
  ]);
  const entry = { factory: mod.default, wasmBinary };
  factoryCache.set(tool, entry);
  return entry;
}

// The share tree can't be listed at runtime in the browser, so we ship a
// manifest (generated at build/stage time) of the files under each subdir.
async function loadShareManifest() {
  if (shareManifest) return shareManifest;
  shareManifest = await fetch(`${SHARE_BASE}/manifest.json`).then((r) => r.json());
  return shareManifest;
}

async function loadShareSub(sub) {
  if (shareCache.has(sub)) return shareCache.get(sub);
  const manifest = await loadShareManifest();
  const rels = manifest[sub] ?? [];
  const files = await Promise.all(rels.map(async (rel) => {
    const bytes = new Uint8Array(await fetch(`${SHARE_BASE}/${sub}/${rel}`).then((r) => r.arrayBuffer()));
    return { vfs: `/cc65/${sub}/${rel}`, bytes };
  }));
  shareCache.set(sub, files);
  return files;
}

function ensureDir(FS, dir) {
  const parts = dir.split("/").filter(Boolean);
  let cur = "";
  for (const p of parts) { cur += "/" + p; try { FS.mkdir(cur); } catch { /* exists */ } }
}

/**
 * Run one cc65-family tool in the browser.
 * @param {"cc65"|"ca65"|"ld65"} tool
 * @param {string[]} argv  same argv you'd pass native cc65 (VFS paths)
 * @param {Map<string,Uint8Array>} vfs  input files, keyed by absolute VFS path
 * @returns {Promise<{ status:number, stderr:string, outputs:Map<string,Uint8Array> }>}
 */
export async function runTool(tool, argv, vfs) {
  const { factory, wasmBinary } = await loadFactory(tool);

  let log = "";
  let capturedExit = null;
  const mod = await factory({
    wasmBinary,
    noInitialRun: true,
    print: (m) => { log += m + "\n"; },
    printErr: (m) => { log += m + "\n"; },
    quit: (s, e) => { capturedExit = s; throw e ?? new Error("exit " + s); },
    onExit: (s) => { capturedExit = s; },
    // don't let the glue try to locate/fetch the .wasm; we passed wasmBinary
    locateFile: (p) => p,
  });
  const FS = mod.FS;

  // mount the share subdir(s) this tool needs (from cache)
  for (const sub of SHARE_FOR[tool] ?? []) {
    for (const { vfs: p, bytes } of await loadShareSub(sub)) {
      ensureDir(FS, p.replace(/\/[^/]*$/, ""));
      FS.writeFile(p, bytes);
    }
  }
  // mount the caller's input files
  for (const [p, bytes] of vfs) {
    ensureDir(FS, p.replace(/\/[^/]*$/, ""));
    FS.writeFile(p, bytes);
  }

  // detect declared -o/-m/-Ln/--dbgfile outputs so we can read them back
  const outPaths = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "-o" || argv[i] === "-m" || argv[i] === "-Ln" || argv[i] === "--dbgfile") {
      outPaths.push(argv[i + 1]); i++;
    }
  }

  let status = 0;
  try { mod.callMain(argv); }
  catch (e) {
    if (e && typeof e === "object" && "status" in e) status = e.status;
    else if (capturedExit !== null) status = capturedExit;
    else status = status || 1;
  }
  if (capturedExit !== null && status === 0) status = capturedExit;
  if (mod.EXITSTATUS != null && status === 0) status = mod.EXITSTATUS;

  const outputs = new Map();
  for (const p of outPaths) {
    try { outputs.set(p, mod.FS.readFile(p)); } catch { /* tool may not have written it on failure */ }
  }

  // strip ANSI so downstream parsing matches native (the overflow regex etc.)
  return { status, stderr: log.replace(/\x1b\[[0-9;]*m/g, ""), outputs };
}
