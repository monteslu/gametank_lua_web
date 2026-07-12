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
