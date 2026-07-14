# gametank_lua_web

A browser IDE for making [GameTank](https://gametank.zone) games in Lua. Write
code, draw sprites, compose music, build a real `.gtr` cart, run it in the
emulator, and flash it to actual hardware, all in a tab. No install.

It's the companion to the [`gtlua`](https://www.npmjs.com/package/gtlua)
clone-and-build CLI, and it uses the **exact same compiler and toolchain**, so
the browser produces carts byte-for-byte identical to the CLI (verified on the
full EEPROM32K + FLASH2M banking pipeline).

Plain JS (ESM + JSDoc, no TypeScript) + Vite + React.

## What's in it

- **Code editor.** Monaco (the VS Code editor), with its built-in Lua
  highlighting, gt-lua completions, and **live diagnostics** from the real
  compiler on every keystroke (our compiler *is* the language service).
- **Build & run.** Play (Ctrl-R) compiles Lua to C to cc65/ca65/ld65 (all WASM,
  in a warm Web Worker) to a `.gtr`, then runs it live in the **emulator** on
  the real GameTank libretro core. Click the screen to play; keyboard and
  gamepad both drive the pad.
- **Sprite editor.** Pencil/fill/line/rect/eraser, select and copy/paste, zoom,
  the hardware-accurate 256-color palette. Import PNG or Aseprite.
- **Animation.** Carve `.gsi` frames over the sheet, set anchors, and
  play-preview the walk cycle. A multi-frame Aseprite imports as a ready-to-run
  animation (packed sheet + frames).
- **Music.** A 4-channel FM step tracker with a Web Audio preview; import MIDI;
  "use in game" drops the song into your code.
- **Debugger.** A live hex view of the running machine's RAM, click-to-edit.
- **Projects.** Saved in the browser (IndexedDB), started blank or cloned from a
  gallery of example games. Export a `.gtr` cart or a `.gtlua` project bundle.
- **Import.** Bring in a `.gtlua` bundle, or a PICO-8 `.p8` / `.p8.png` cart
  (code, graphics, and sound convert into a new project to port from).
- **Flash to hardware.** Over Web Serial, drives Clyde Shaffer's GTFO
  programmer to write your cart to a real GameTank (Chrome/Edge, or Firefox
  151+).
- **C-SDK interop.** The editors read and write Clyde's exact
  `.gtg`/`.gsi`/`.gtm2` formats, so C developers can use them as an asset
  workbench too (raw import/export in each editor).

## Dev

Requires **Node 24+** (the bundled WASM cores need WASM threading/SIMD).

```sh
npm install        # also stages the toolchain/core/examples into public/
npm run dev        # http://localhost:5173
```

`npm install` runs `scripts/stage-toolchain.mjs`, which copies the cc65 WASM
toolchain, the GameTank core, the SDK runtime, and the example games out of the
`gtlua` package into `public/` (all gitignored; regenerate with `npm run
stage`). Cross-origin isolation headers are set in `vite.config.js` (the WASM
tools use SharedArrayBuffer).

## Tests

Playwright drives a real headless Chromium against the running app. Each
`test/browser-*.mjs` spins up its own Vite instance and checks one slice
end-to-end (build, play, sprite/frame/music editors, importers, debugger,
flasher, C-SDK interop). Run the whole set with `node test/run-all.mjs`, or one
with `node test/browser-<name>.mjs`.

## Layout

- `src/App.jsx`: the shell (projects, tabs, build/play, export, flash).
- `src/Editor.jsx`: Monaco + the gt-lua language layer.
- `src/build/`: the Web Worker that runs the SDK's real `build()` over an
  in-memory VFS via a synchronous cc65 glue.
- `src/emu/`: the browser GameTank host (canvas + Web Audio), gamepad support,
  and the RAM debugger.
- `src/gfx/`: palette, `.gtg` sheet, `.gsi` frames, PNG/Aseprite import.
- `src/audio/`: `.gtm2` tracker, FM preview synth, MIDI import.
- `src/flash/`: the Web Serial cart flasher.
- `src/import/`: PICO-8 `.p8` / `.p8.png` cart import.
- `src/projects/`: IndexedDB store, `.gtlua` zip bundle, examples.
