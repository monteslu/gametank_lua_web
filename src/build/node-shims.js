// Browser shims for the node built-ins the cc65/ca65/ld65 Emscripten glue
// touches at init. The glue was built with -sENVIRONMENT=node (ENVIRONMENT_IS_
// NODE hardcoded true), so at load it does `await import("module")` then
// require("fs"/"path"/"url") to set up scriptDirectory + readBinary. In the
// browser we never hit those code paths meaningfully - we pass Module.wasmBinary
// (so it never reads the .wasm off disk) and drive the in-memory FS ourselves -
// but the requires still EXECUTE at init and would throw. These stubs satisfy
// them harmlessly.
//
// This is a BRIDGE so browser dev can proceed now. The proper fix is rebuilding
// the cc65 wasm in romdev with -sENVIRONMENT=web,worker,node (multi-env glue),
// which drops the node path entirely. Tracked in internal-gtlua/WEB_IDE_PLAN.md.

// `import("module")` -> { createRequire }. The glue calls
// createRequire(import.meta.url) and then require("fs"/"path"/"url"); we return
// a require that hands back our fs/path/url stubs.
const stubModules = {
  fs: makeFsStub(),
  path: makePathStub(),
  url: makeUrlStub(),
};

function makeRequire() {
  return (name) => stubModules[name] ?? {};
}

function makeFsStub() {
  // The glue only uses fs.readFileSync/readFile for the .wasm, which we bypass
  // by passing Module.wasmBinary. Provide no-op-ish stubs so init doesn't throw.
  return {
    readFileSync: () => new Uint8Array(0),
    readFile: (_p, _o, cb) => (typeof cb === "function" ? cb(null, new Uint8Array(0)) : undefined),
    promises: { readFile: async () => new Uint8Array(0) },
  };
}

function makePathStub() {
  return {
    dirname: (p) => String(p).replace(/\/[^/]*$/, "") || ".",
    join: (...parts) => parts.join("/").replace(/\/+/g, "/"),
    basename: (p) => String(p).replace(/^.*\//, ""),
  };
}

function makeUrlStub() {
  return {
    fileURLToPath: (u) => String(u).replace(/^file:\/\//, ""),
  };
}

// The alias target for `module` / `node:module`.
export const createRequire = () => makeRequire();
export default { createRequire };
