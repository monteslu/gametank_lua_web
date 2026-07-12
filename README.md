# gametank_lua_web

Web IDE for [gt-lua](../gametank_lua_sdk): write GameTank games in Lua, build and
play them in the browser. Companion to the `gametank_lua_sdk` clone-and-build CLI.

Plain JS (ESM + JSDoc, no TypeScript) + Vite + React, matching house style.

## Status

Early. Working so far:

- **Live diagnostics**: the real gt-lua compiler (`compile()`, pure JS, zero node
  deps) runs in-browser on every edit and reports positioned errors/warnings.
  Our compiler *is* the language service - no LSP backend.
- Code editor (textarea + diagnostic gutter; Monaco next) and a generated-C peek.

Next (see `../internal-gtlua/WEB_IDE_PLAN.md`):

- Monaco editor with the gt-lua language (highlighting, completions, hover).
- Browser build: the WASM cc65/ca65/ld65 toolchain (reusing the SDK's
  `wasm_worker.js` runTool core) driven over rawr -> a real `.gtr`.
- Emulator pane (the GameTank core to a canvas; copy `bin/gtlua-run.mjs`).
- Sprite/animation/SFX/music editors, importers, projects, Web Serial flashing.

## Dev

```sh
npm install
npm run dev      # http://localhost:5173
```

Cross-origin isolation headers are set in `vite.config.js` (the WASM tools use
SharedArrayBuffer).
