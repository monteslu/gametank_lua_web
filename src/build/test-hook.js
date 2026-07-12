// Dev/test harness: expose the browser build in a Worker (threaded, warm tools)
// on window so a Playwright test (or the console) can drive it in a real browser.
if (typeof window !== "undefined") {
  let worker = null;
  let nextId = 1;
  const pending = new Map();

  const ensureWorker = () => {
    if (worker) return worker;
    worker = new Worker(new URL("./build-worker.js", import.meta.url), { type: "module" });
    worker.onmessage = (e) => {
      const { type, id } = e.data;
      const p = pending.get(id);
      if (!p) return;
      if (type === "done") { pending.delete(id); p.resolve(e.data); }
      else if (type === "error") { pending.delete(id); p.reject(e.data); }
      // "progress" messages are ignored in the test harness
    };
    return worker;
  };

  window.__gtlua_test = {
    // build a Lua game to a .gtr in the worker (threaded, warm tools)
    build(source, opts = {}) {
      const w = ensureWorker();
      const id = nextId++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        w.postMessage({ type: "build", id, source, opts });
      });
    },
  };
}
