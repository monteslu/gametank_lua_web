// build-client.js - main-thread client for the build Worker.
//
// One long-lived Worker (warm tools: cc65/ca65/ld65 compiled once, share tree
// mounted once), driven request/response by id. Both the React app and the
// test hook use this so there's one place that owns the worker protocol.

/** @typedef {{ num8?: boolean, sheetBytes?: ArrayBuffer, framesBytes?: ArrayBuffer, onProgress?: (msg:string)=>void }} BuildOpts */

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
    if (type === "done") p.resolve(e.data);
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
