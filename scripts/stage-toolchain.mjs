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

// ---- stage the example games -> public/examples ---------------------------
// The forkable seed set. Small SDK demos come from the gtlua package; the 5
// genre games (a fuller showcase: sprites/music/SFX/gamepad) live in this repo's
// examples/. Each is a lone main.lua; the manifest lists them + a blurb so the
// IDE shows a gallery without hardcoding the Lua in JS.
const EX_OUT = path.join(HERE, "public", "examples");
const SDK_EX = path.join(GTLUA, "examples");
const LOCAL_EX = path.join(HERE, "examples");
// The three PICO-8 ports are FULL games (big banked carts, licensed). They're
// vendored in-repo under examples/ (like the genre games) - NOT pulled from a
// sibling repo - so they always ship, whatever the build machine has checked
// out. (They used to come from ../gtlua-ports and silently vanished from a
// deploy where that sibling wasn't present.)
// order = gallery order. `from` picks the source tree. `num8` marks a project
// that must build in the 8.8 number model; `license` carries a credit line.
const EX_LIST = [
  { name: "hello", from: SDK_EX, blurb: "A smiley + text. The zero-asset starting point." },
  { name: "shmup", from: LOCAL_EX, blurb: "STARFALL: a space shooter. Move + fire, music + SFX." },
  { name: "platformer", from: LOCAL_EX, blurb: "Run and jump across platforms. Gravity + gamepad." },
  { name: "puzzle", from: LOCAL_EX, blurb: "Falling-block stacker. Rotate, drop, clear lines." },
  { name: "racing", from: LOCAL_EX, blurb: "Top-down racer. Dodge traffic, keep on the road." },
  { name: "sports", from: LOCAL_EX, blurb: "2-player paddle-ball. First to the corner wins." },
  // real ported games (heavier - first build takes ~10-15s, banked 2 MB carts)
  { name: "cherry-bomb", from: LOCAL_EX, blurb: "Cherry Bomb by Krystman / Lazy Devs (PICO-8 port). CC-BY-NC-SA.", license: "Cherry Bomb (c) Krystman / Lazy Devs Academy - CC-BY-NC-SA 4.0" },
  { name: "combo-pool", from: LOCAL_EX, num8: true, blurb: "Combo Pool by NuSan (PICO-8 port). Merge balls, chain combos. CC-BY-NC-SA.", license: "Combo Pool (c) NuSan - CC-BY-NC-SA 4.0" },
  { name: "newleste", from: LOCAL_EX, blurb: "Celeste Classic (newleste.p8 port). Climb, jump, dash. GPL-3.0.", license: "Celeste Classic / newleste.p8 - Maddy Thorson, Noel Berry + CelesteClassic community - GPL-3.0" },
  { name: "orbit", from: SDK_EX, blurb: "Bouncing bodies with fixed-point math." },
  { name: "audio", from: SDK_EX, blurb: "Built-in SFX and music." },
];
await rm(EX_OUT, { recursive: true, force: true });
await mkdir(EX_OUT, { recursive: true });
const examples = [];
for (const ex of EX_LIST) {
  const dir = path.join(ex.from, ex.name);
  const src = path.join(dir, "main.lua");
  if (!existsSync(src)) {
    // a listed example whose source is missing is a BUILD ERROR, not a silent
    // skip - a silent skip is exactly how the 3 ports vanished from a deploy.
    throw new Error(`example "${ex.name}" listed in EX_LIST but ${src} is missing`);
  }
  await mkdir(path.join(EX_OUT, ex.name), { recursive: true });
  await cp(src, path.join(EX_OUT, ex.name, "main.lua"));
  const files = ["main.lua"];
  // an example may ship a sprite sheet, frame table, tracker song, and/or a
  // LICENSE (ports) so those editors open populated + attribution ships.
  for (const asset of ["gfx.gtg", "gfx.gsi", "music.json", "LICENSE"]) {
    if (existsSync(path.join(dir, asset))) {
      await cp(path.join(dir, asset), path.join(EX_OUT, ex.name, asset));
      files.push(asset);
    }
  }
  // big FLASH2M ports: stage the CLI's winning bank layout as placement.json.
  // NOT in `files` (it must never fork into the project); the IDE fetches it at
  // fork time to seed the build worker's replay cache, so the fork's first
  // build links in one pass instead of running the ~10s placement search.
  // Self-validating downstream (function-set check + link proof), so a stale
  // layout only ever costs one extra pass.
  // the winning bank layout (vendored placement.json, or the port's build dir)
  const placementSrc = existsSync(path.join(dir, "placement.json"))
    ? path.join(dir, "placement.json")
    : path.join(dir, "build", ".placement.json");
  if (existsSync(placementSrc)) {
    await cp(placementSrc, path.join(EX_OUT, ex.name, "placement.json"));
  }
  const entry = { name: ex.name, blurb: ex.blurb, files };
  // 128x128 gallery thumbnail (an emulator screenshot of the example running),
  // kept in this repo under examples-thumbs/ so it needs no package republish
  if (existsSync(path.join(HERE, "examples-thumbs", `${ex.name}.png`))) {
    await cp(path.join(HERE, "examples-thumbs", `${ex.name}.png`), path.join(EX_OUT, ex.name, "thumb.png"));
    entry.thumb = true;
  }
  if (ex.num8) entry.num8 = true;
  if (ex.license) entry.license = ex.license;
  examples.push(entry);
}
await writeFile(path.join(EX_OUT, "manifest.json"), JSON.stringify({ examples }));
console.log("staged examples -> public/examples (" + examples.map((e) => e.name).join(", ") + ")");

// ---- stage the gt-lua cheatsheet -> public/docs -----------------------------
// The IDE shows it in a reference tab next to the code editor. Sourced from the
// gtlua package so it's always the version that matches the compiler.
const DOCS_OUT = path.join(HERE, "public", "docs");
await rm(DOCS_OUT, { recursive: true, force: true });
await mkdir(DOCS_OUT, { recursive: true });
// Stage the whole gt-lua docs folder (top-level *.md) so every in-app link
// resolves: the cheatsheet, the PICO-8-porter guides it links to, and THEIR
// cross-links (GRAPHICS/SPRITES/PALETTE/MUSIC/...). The importer banner + the
// cheatsheet footer point users at these, so a missing one is a 404. Small
// (~90KB total) and always matches the installed compiler.
const DOCS_SRC = path.join(GTLUA, "docs");
const staged = [];
if (existsSync(DOCS_SRC)) {
  for (const f of await readdir(DOCS_SRC)) {
    if (!f.endsWith(".md")) continue;               // top-level markdown only
    await cp(path.join(DOCS_SRC, f), path.join(DOCS_OUT, f));
    staged.push(f);
  }
}
if (staged.length) console.log(`staged docs -> public/docs (${staged.length} md files)`);
