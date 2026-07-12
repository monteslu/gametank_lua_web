// Dev/test harness: expose the browser build primitives on window so a
// Playwright test (or the console) can drive them in a real browser. Imported
// only from main.jsx in dev; tree-shaken out of a normal prod build path.
import { runTool as emGlueRunTool } from "./browser-toolchain.js";

if (typeof window !== "undefined") {
  window.__gtlua_test = {
    // compile a tiny C to .s via the EMSCRIPTEN-glue path (the working one)
    async runCc65(cSource) {
      const vfs = new Map([["/work/t.c", new TextEncoder().encode(cSource)]]);
      const r = await emGlueRunTool("cc65", ["-t", "none", "-Osr", "--cpu", "65c02", "-o", "/work/t.s", "/work/t.c"], vfs);
      const s = r.outputs.get("/work/t.s");
      return { status: r.status, stderr: r.stderr, out: s ? new TextDecoder().decode(s) : null };
    },
  };
}
