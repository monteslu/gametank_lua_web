// Stage the cc65 WASM toolchain (glue + wasm + share subtree + a manifest) into
// public/cc65/ so Vite serves it to the browser. Sourced from the SDK's
// installed romdev-toolchain-cc65 package. Run after npm install (postinstall).
// public/cc65 is gitignored - regenerate anytime.
import { cp, mkdir, readdir, writeFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PKG = path.resolve(HERE, "..", "gametank_lua_sdk", "node_modules", "romdev-toolchain-cc65");
if (!existsSync(PKG)) {
  console.error(`romdev-toolchain-cc65 not found at ${PKG}\nRun 'npm install' in ../gametank_lua_sdk first.`);
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
