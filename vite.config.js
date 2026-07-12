import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // The gt-lua compiler + WASM tools run in Workers with SharedArrayBuffer;
  // those need cross-origin isolation headers in dev. (The cc65 emscripten glue
  // is loaded in browser-toolchain.js by fetching its text and flipping its
  // env flags to web - no node built-ins ever run, so no aliases needed.)
  server: {
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
});
