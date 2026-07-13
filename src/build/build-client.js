// build-client.js - main-thread client for the build Worker.
//
// One long-lived Worker (warm tools: cc65/ca65/ld65 compiled once, share tree
// mounted once), driven request/response by id. Both the React app and the
// test hook use this so there's one place that owns the worker protocol.

/**
 * @typedef {object} BuildOpts
 * @property {boolean} [num8]
 * @property {Record<string, Uint8Array>} [quadrantBytes] up to 4 sprite-sheet
 *   quadrant files, keyed by filename (gfx.gtg + gfx_1/2/3.gtg)
 * @property {ArrayBuffer} [framesBytes] encoded .gsi frame table
 * @property {Uint8Array[]} [songs] the project's .gtm2 songs, in order - the
 *   build registers them so music(n) plays project song n
 * @property {(msg:string)=>void} [onProgress]
 */

let worker = null;
let nextId = 1;
const pending = new Map();   // id -> { resolve, reject, onProgress }

function ensureWorker() {
  if (worker) return worker;
  worker = new Worker(new URL("./build-worker.js", import.meta.url), { type: "module" });
  worker.onmessage = (e) => {
    const { type, id } = e.data;
    const p = pending.get(id);
    if (!p) return;
    if (type === "progress") { p.onProgress?.(e.data.msg); return; }
    pending.delete(id);
    if (type === "done" || type === "warm-done") p.resolve(e.data);
    else if (type === "error") p.reject(new Error(e.data.message || "build failed"));
  };
  worker.onerror = (e) => {
    // a hard worker error rejects everything in flight
    for (const [, p] of pending) p.reject(new Error(e.message || "worker crashed"));
    pending.clear();
  };
  return worker;
}

/**
 * Create the build worker and start warming it (compile the WASM tools + fetch
 * the share/SDK trees) NOW - call once on app mount. The worker also self-warms
 * on creation, so this mainly ensures the worker EXISTS early; the returned
 * promise resolves when warmup is done. Idempotent.
 */
let warmed = null;
export function prewarm() {
  if (warmed) return warmed;
  const w = ensureWorker();
  const id = nextId++;
  warmed = new Promise((resolve) => {
    pending.set(id, { resolve, reject: resolve });   // resolve either way; warmup is best-effort
    w.postMessage({ type: "warm", id });
  });
  return warmed;
}

/**
 * Build a Lua game to a .gtr in the worker.
 * @param {string} source
 * @param {BuildOpts} [opts]
 * @returns {Promise<{ ok: boolean, gtr: Uint8Array, ms: number }>}
 */
export function buildGtr(source, opts = {}) {
  const w = ensureWorker();
  const id = nextId++;
  const { onProgress, ...rest } = opts;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, onProgress });
    w.postMessage({ type: "build", id, source, opts: rest });
  });
}

/**
 * Seed a known-good FLASH2M placement (a CLI build/.placement.json) for a
 * project, so its first-ever build links in one pass instead of running the
 * bank-placement search. Fire-and-forget; the worker ignores it if it already
 * has a layout for that project.
 */
export function seedReplay(projectKey, bytes) {
  ensureWorker().postMessage({ type: "seedReplay", projectKey, bytes });
}
