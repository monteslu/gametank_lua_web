// build-worker.js - the browser build runs in a Web Worker, off the UI thread
// (the same shape as the SDK's node persistent worker: keep the tools warm, keep
// the heavy work off the thread that has to stay responsive).
//
// It holds the cc65/ca65/ld65 wasm binaries + the share tree in memory for the
// worker's lifetime, so repeated builds don't re-fetch or re-parse them. Each
// tool call still spins a fresh WASM instance (single-shot programs; instances
// can't be reused across a run), but that's ~ms, and everything else is warm.
//
// Protocol: the main thread posts { type:"build", id, source, opts }; the worker
// posts back { type:"progress"|"done"|"error", id, ... }. rawr can wrap this
// later; for now it's a thin typed message channel (browser build loop is async,
// so no Atomics needed - unlike the sync CLI).

// Uses the SDK's proven-correct cc65 emscripten glue via browser-toolchain.js
// (fetched, env-flipped to web, blob-imported). runTool mounts the needed share
// subdir itself and returns outputs; we copy those into the shared build vfs.
import { runTool as toolRun } from "./browser-toolchain.js";
import { compile } from "../compiler/index.js";
import { peephole } from "../compiler/peephole.js";

// run one tool; its declared -o/-m/-Ln/--dbgfile outputs land back in `vfs`.
async function tool(name, argv, vfs) {
  const r = await toolRun(name, argv, vfs);
  for (const [p, bytes] of r.outputs) vfs.set(p, bytes);
  return { status: r.status, stderr: r.stderr };
}

/**
 * Build a single-bank (EEPROM32K) cart from Lua. This is the first-slice build
 * path: compile -> cc65 -> peephole -> ca65 (game + SDK units) -> ld65. The full
 * FLASH2M banking ladder is the SDK's build() brain, extracted next; for now
 * this proves the browser toolchain produces a real .gtr end to end.
 */
async function buildCart(source, opts = {}) {
  const t0 = performance.now();
  const progress = (msg) => postMessage({ type: "progress", id: opts.__id, msg });

  // 1. Lua -> C
  progress("compiling lua");
  const r = compile(source, "main.lua", { num8: !!opts.num8 });
  if (!r.ok) return { ok: false, diagnostics: r.diagnostics };

  const vfs = new Map();
  const enc = new TextEncoder();
  vfs.set("/work/main.c", enc.encode(r.c));
  // no-asset build: an empty sheet unit satisfies main's gt_sheet_init reference
  // (matches the CLI's makeSheetC(undefined)). Sprite sheets come later.
  vfs.set("/work/sheet.c", enc.encode("void gt_sheet_init(void) {}\n"));

  // SDK C + asm runtime is served as static assets under /sdk/
  const sdk = await loadSdkRuntime();
  for (const [p, bytes] of sdk.files) vfs.set(p, bytes);

  const cc = async (src, dst, defs = []) => {
    const res = await tool("cc65", ["-t", "none", "-Osr", "--cpu", "65c02", "--codesize", "500", "-g", "--static-locals", "-I", "/sdk", ...defs, "-o", dst, src], vfs);
    if (res.status !== 0) throw new BuildError(`cc65 ${src}`, res.stderr);
    // peephole pass over the .s (same as the CLI)
    const s = new TextDecoder().decode(vfs.get(dst));
    vfs.set(dst, enc.encode(peephole(s).text));
  };
  const as = async (src, dst, defs = []) => {
    const res = await tool("ca65", ["--cpu", "W65C02", "-g", "-I", "/cc65/asminc", ...defs, "-o", dst, src], vfs);
    if (res.status !== 0) throw new BuildError(`ca65 ${src}`, res.stderr);
  };

  progress("compiling C");
  await cc("/work/main.c", "/work/main.s");
  await cc("/work/sheet.c", "/work/sheet.s");
  for (const unit of sdk.cUnits) await cc(`/sdk/${unit}.c`, `/work/${unit}.s`, sdk.defs[unit] ?? []);

  progress("assembling");
  await as("/work/main.s", "/work/main.o");
  await as("/work/sheet.s", "/work/sheet.o");
  for (const unit of sdk.cUnits) await as(`/work/${unit}.s`, `/work/${unit}.o`);
  for (const unit of sdk.asmUnits) await as(`/sdk/${unit}.s`, `/work/${unit}.o`, sdk.asmDefs[unit] ?? []);

  progress("linking");
  const objs = [...sdk.asmUnits, ...sdk.cUnits, "sheet", "main"].map((u) => `/work/${u}.o`);
  const link = await tool("ld65", ["-C", "/sdk/gametank.cfg", "-o", "/work/game.gtr", ...objs, "/cc65/lib/none.lib"], vfs);
  if (link.status !== 0) throw new BuildError("ld65", link.stderr);

  const gtr = vfs.get("/work/game.gtr");
  return { ok: true, gtr, ms: Math.round(performance.now() - t0), diagnostics: r.diagnostics };
}

class BuildError extends Error { constructor(stage, log) { super(`${stage} failed`); this.stage = stage; this.log = log; } }

// The SDK C/asm runtime, served as static assets (staged like the cc65 share
// tree). Loaded once, cached warm. Which units to include is derived from the
// generated C (mirrors the CLI's usesX flags) - first slice includes the base set.
let sdkCache = null;
async function loadSdkRuntime() {
  if (sdkCache) return sdkCache;
  const list = await (await fetch("/sdk/manifest.json")).json();
  const files = new Map();
  await Promise.all(list.files.map(async (f) => {
    files.set(`/sdk/${f}`, new Uint8Array(await (await fetch(`/sdk/${f}`)).arrayBuffer()));
  }));
  sdkCache = { files, cUnits: list.cUnits, asmUnits: list.asmUnits, defs: list.defs ?? {}, asmDefs: list.asmDefs ?? {} };
  return sdkCache;
}

self.onmessage = async (e) => {
  const { type, id, source, opts } = e.data;
  if (type !== "build") return;
  try {
    const result = await buildCart(source, { ...opts, __id: id });
    if (result.gtr) {
      // transfer the .gtr bytes back
      postMessage({ type: "done", id, ...result }, [result.gtr.buffer]);
    } else {
      postMessage({ type: "done", id, ...result });
    }
  } catch (err) {
    postMessage({ type: "error", id, stage: err.stage, message: err.message, log: err.log });
  }
};
