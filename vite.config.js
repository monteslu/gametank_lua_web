import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const GL_STUB = fileURLToPath(new URL("./src/emu/gl-stub.js", import.meta.url));

export default defineConfig({
  plugins: [react()],
  // The gt-lua compiler + WASM tools run in Workers with SharedArrayBuffer;
  // those need cross-origin isolation headers in dev. (The cc65 emscripten glue
  // is loaded through luacretro-web/build by fetching its text and flipping its
  // env flags to web - no node built-ins ever run there.)
  server: {
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
  // luacretro-web ships raw JSX (no build step in the lib). It is symlinked in
  // via `file:`, so Vite must NOT prebundle it (esbuild's dep scanner would
  // choke on the .jsx entry) and React must resolve to ONE copy across the
  // symlink boundary or hooks blow up with the classic invalid-hook-call.
  resolve: {
    dedupe: ["react", "react-dom"],
    alias: [
      // romdev-core-host declares native-gles/webgl-node as OPTIONAL deps and
      // only reaches them through a lazy `await import()` in glOptionalDep.js,
      // on the HW-render path for the 3D cores (N64/PS1/Dreamcast). The
      // GameTank core is software, so that path never runs in this app — but
      // esbuild and rollup still FOLLOW the literal specifier, and native-gles
      // is a .node binary neither can load. Stub the specifiers.
      { find: /^native-gles$/, replacement: GL_STUB },
      { find: /^webgl-node$/, replacement: GL_STUB },
    ],
  },
  optimizeDeps: {
    exclude: ["luacretro-web"],
    include: [
      // luacretro-web itself is excluded (raw JSX, symlinked), but its deps are
      // plain ESM in node_modules and Vite discovers them LATE — as imports of
      // an excluded dep. Listing them here prebundles them at server start;
      // without it the first import 504s as an "Outdated Optimize Dep" and the
      // page never boots.
      "romdev-core-host",
      "romdev-core-host/framebuffer.js",
      "@monaco-editor/react",
      // gtlua/build is reached lazily from the build worker; without it here
      // Vite discovers it mid-build and reloads the page, destroying the
      // execution context the test is driving.
      "gtlua/build",
      "gtlua/compiler/index.js",
      "gtlua/compiler/builtins.js",
      "gtlua/compiler/frames.js",
      "gtlua/compiler/gt_palette.js",
      "gtlua/compiler/peephole.js",   // imported by build.js, so the worker reaches it
      "gtlua/compiler/gtm2.mjs",
    ],
  },
  // node: builtins stay external in BOTH bundles. romdev-core-host reaches its
  // Node I/O adapter through a lazy `await import("./io-node.js")` on the
  // path-based load paths, which never run in the browser (the IDE only ever
  // hands it bytes) - but rollup still FOLLOWS the literal specifier and then
  // fails on `readFile is not exported by __vite-browser-external`. gtlua's
  // build driver has the same shape of lazy node fallback.
  worker: { format: "es", rollupOptions: { external: [/^node:/] } },
  build: { rollupOptions: { external: [/^node:/] } },
});
