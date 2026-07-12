// Dev/test harness: expose the browser build on window so a Playwright test (or
// the console) can drive it in a real browser. Thin wrapper over build-client.js
// (the same worker the React app uses).
import { buildGtr } from "./build-client.js";

if (typeof window !== "undefined") {
  window.__gtlua_test = {
    build(source, opts = {}) { return buildGtr(source, opts); },
    // App registers these so tests can drive the (Monaco) editor's model without
    // poking DOM internals.
    setSource: null,   // (text) => void
    getSource: null,   // () => string
  };
}
