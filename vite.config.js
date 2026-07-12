import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The cc65 Emscripten glue was built for node (-sENVIRONMENT=node); it does
// `import("module")` + require("fs"/"path"/"url") at init. Alias those to browser
// stubs so the glue loads in the browser. (Proper fix: rebuild the wasm for web
// in romdev - see src/build/node-shims.js.)
const nodeStub = "/src/build/node-shims.js";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      module: nodeStub,
      "node:module": nodeStub,
    },
  },
  // The cc65 wasm glue imports these; keep Vite from trying to pre-bundle them.
  optimizeDeps: { exclude: ["module", "node:module"] },
  // The gt-lua compiler + WASM tools run in Workers with SharedArrayBuffer;
  // those need cross-origin isolation headers in dev.
  server: {
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
});
