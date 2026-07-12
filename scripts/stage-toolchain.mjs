// Stage the cc65 WASM toolchain (glue + wasm + share subtree + a manifest) into
// public/cc65/ so Vite serves it to the browser. Sourced from the SDK's
// installed romdev-toolchain-cc65 package. Run after npm install (postinstall).
// public/cc65 is gitignored - regenerate anytime.
import { cp, mkdir, readdir, writeFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// Resolve the gtlua package (and its bundled cc65 toolchain) through node's own
// resolution, so this works whether gtlua is the published npm package or a
// local file: link - and the IDE needs no sibling SDK checkout to build.
const require = createRequire(import.meta.url);
const GTLUA = path.dirname(require.resolve("gtlua/package.json"));
// romdev-toolchain-cc65 doesn't export ./package.json and npm may hoist it, so
// resolve its main entry (from gtlua's scope) and walk up to the package root.
const cc65Main = require.resolve("romdev-toolchain-cc65", { paths: [GTLUA, HERE] });
const PKG = cc65Main.slice(0, cc65Main.lastIndexOf("romdev-toolchain-cc65") + "romdev-toolchain-cc65".length);
if (!existsSync(path.join(PKG, "wasm"))) {
  console.error(`romdev-toolchain-cc65 wasm not found under ${PKG}\nRun 'npm install' first.`);
  process.exit(1);
}

const OUT = path.join(HERE, "public", "cc65");
await rm(OUT, { recursive: true, force: true });
await mkdir(path.join(OUT, "wasm"), { recursive: true });
await mkdir(path.join(OUT, "share"), { recursive: true });

for (const f of ["cc65.js", "ca65.js", "ld65.js", "cc65.wasm", "ca65.wasm", "ld65.wasm"]) {
  await cp(path.join(PKG, "wasm", f), path.join(OUT, "wasm", f));
}
const SUBS = ["asminc", "include", "lib", "cfg"];
for (const sub of SUBS) {
  await cp(path.join(PKG, "share", "cc65", sub), path.join(OUT, "share", sub), { recursive: true });
}

const manifest = {};
for (const sub of SUBS) {
  const files = [];
  const walk = async (dir, rel) => {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const rp = rel ? rel + "/" + e.name : e.name;
      if (e.isDirectory()) await walk(path.join(dir, e.name), rp);
      else files.push(rp);
    }
  };
  await walk(path.join(OUT, "share", sub), "");
  manifest[sub] = files;
}
await writeFile(path.join(OUT, "share", "manifest.json"), JSON.stringify(manifest));
console.log("staged cc65 toolchain -> public/cc65 (" + SUBS.map((s) => `${s}=${manifest[s].length}`).join(" ") + ")");

// ---- stage the SDK C/asm runtime -> public/sdk ----------------------------
// The whole sdk/ dir (~500K: .c/.s/.h/.inc/.cfg) so #includes resolve without
// cherry-picking. The manifest names the base unit set the browser build links
// for a minimal (no-asset) EEPROM32K cart.
const SDK = path.join(GTLUA, "sdk");
const SDK_OUT = path.join(HERE, "public", "sdk");
await rm(SDK_OUT, { recursive: true, force: true });
await cp(SDK, SDK_OUT, { recursive: true });

const sdkFiles = [];
{
  const walk = async (dir, rel) => {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const rp = rel ? rel + "/" + e.name : e.name;
      if (e.isDirectory()) await walk(path.join(dir, e.name), rp);
      else sdkFiles.push(rp);
    }
  };
  await walk(SDK_OUT, "");
}
// base unit set for a minimal build (matches bin/gtlua.js section 2's always-on units)
const sdkManifest = {
  files: sdkFiles,
  cUnits: ["gt_api", "gt_fixed", "gt_math"],
  asmUnits: ["crt0", "vectors", "interrupt", "gt_blitq", "gt_fixed_asm", "gt_circ", "gt_line", "gt_print_asm"],
  defs: { gt_api: [] },
  asmDefs: {},
};
await writeFile(path.join(SDK_OUT, "manifest.json"), JSON.stringify(sdkManifest));
console.log("staged SDK runtime -> public/sdk (" + sdkFiles.length + " files, " + sdkManifest.cUnits.length + " C + " + sdkManifest.asmUnits.length + " asm units)");

// ---- stage the GameTank emulator core -> public/core ----------------------
// The libretro core's glue .js + .wasm, so the browser emulator pane can load
// and run the built .gtr. The glue is node-targeted (-sENVIRONMENT=node); the
// browser host fetches the text and flips the env flags (same trick the cc65
// path uses), so we ship the glue verbatim.
const CORE_PKG = path.dirname(require.resolve("romdev-core-gametank", { paths: [GTLUA, HERE] }));
const CORE_OUT = path.join(HERE, "public", "core");
await rm(CORE_OUT, { recursive: true, force: true });
await mkdir(CORE_OUT, { recursive: true });
for (const f of ["gametank_libretro.js", "gametank_libretro.wasm"]) {
  await cp(path.join(CORE_PKG, "wasm", f), path.join(CORE_OUT, f));
}
console.log("staged GameTank core -> public/core (gametank_libretro.js + .wasm)");

// ---- stage the SDK's example games -> public/examples ---------------------
// The forkable seed set. Each example is (for now) a lone main.lua; the
// manifest lists them + a short blurb so the IDE can show a gallery without
// hardcoding the Lua in JS. Sourced from the package = one source of truth.
const EX_SRC = path.join(GTLUA, "examples");
const EX_OUT = path.join(HERE, "public", "examples");
const EX_META = {
  hello: "A smiley + text. The zero-asset starting point.",
  orbit: "Bouncing bodies with fixed-point math.",
  "pad-square": "Move a square with the d-pad. Input demo.",
  audio: "Built-in SFX and music.",
  mathcheck: "Fixed-point math self-test.",
};
await rm(EX_OUT, { recursive: true, force: true });
await mkdir(EX_OUT, { recursive: true });
const examples = [];
for (const name of Object.keys(EX_META)) {
  const src = path.join(EX_SRC, name, "main.lua");
  if (!existsSync(src)) continue;
  await mkdir(path.join(EX_OUT, name), { recursive: true });
  await cp(src, path.join(EX_OUT, name, "main.lua"));
  examples.push({ name, blurb: EX_META[name], files: ["main.lua"] });
}
await writeFile(path.join(EX_OUT, "manifest.json"), JSON.stringify({ examples }));
console.log("staged examples -> public/examples (" + examples.map((e) => e.name).join(", ") + ")");
