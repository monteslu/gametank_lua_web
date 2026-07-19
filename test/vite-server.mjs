// vite-server.mjs - one dev server helper for every browser-*.mjs test.
//
// This used to be copy-pasted into all 21 test files as:
//
//   const PORT = 5000 + Math.floor(Date.now() % 900);
//   spawn("npx", ["vite", "--port", String(PORT), "--strictPort"])
//
// which derives the port from the CLOCK. run-all.mjs runs the suite back to
// back, so two tests a few hundred ms apart land on the same port; with
// --strictPort the second one dies instead of picking another. Locally that
// looked like a rare flake. On a CI runner it took out 17 of 19 tests.
//
// Instead: ask the OS for a genuinely free port, and hand it to vite. There is
// a small race between closing the probe socket and vite binding, so on a bind
// failure we retry with a fresh port rather than failing the test.
import { spawn } from "node:child_process";
import { createServer } from "node:net";

// CI runners are slower and start cold (no warm optimizeDeps cache), so the
// 20s budget the inline copies used was not enough on its own.
const START_TIMEOUT_MS = Number(process.env.VITE_START_TIMEOUT_MS || (process.env.CI ? 120000 : 40000));

/** Ask the OS for a free port by binding :0 and reading back what we got. */
function freePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close((err) => (err ? reject(err) : resolve(port)));
    });
  });
}

function spawnOnce(port, cwd) {
  return new Promise((resolve, reject) => {
    const proc = spawn("npx", ["vite", "--port", String(port), "--strictPort"], {
      cwd, env: process.env, detached: true,
    });
    let out = "";
    let settled = false;
    const finish = (fn, arg) => { if (!settled) { settled = true; clearTimeout(timer); fn(arg); } };

    const onData = (d) => {
      out += d.toString();
      // strip ANSI before matching: vite colorizes the URL, so a naive
      // `includes(":" + port)` can miss across an escape sequence.
      const clean = out.replace(/\x1b\[[0-9;]*m/g, "");
      if (clean.includes(`:${port}`)) finish(resolve, { proc, port, url: `http://localhost:${port}/` });
      if (/EADDRINUSE|Port .* is already in use/i.test(clean)) {
        try { process.kill(-proc.pid); } catch {}
        finish(reject, Object.assign(new Error("port busy"), { retryable: true }));
      }
    };
    proc.stdout.on("data", onData);
    proc.stderr.on("data", onData);
    proc.on("error", (e) => finish(reject, e));
    proc.on("exit", (code) => finish(reject, new Error(`vite exited (${code}):\n` + out)));

    const timer = setTimeout(() => {
      try { process.kill(-proc.pid); } catch {}
      finish(reject, new Error(`vite did not start within ${START_TIMEOUT_MS}ms:\n` + out));
    }, START_TIMEOUT_MS);
  });
}

/**
 * Start a vite dev server on a free port.
 * @returns {Promise<{proc: import("node:child_process").ChildProcess, port: number, url: string, stop: () => void}>}
 */
export async function startVite(importMetaUrl) {
  const cwd = new URL("..", importMetaUrl).pathname;
  let lastErr;
  for (let attempt = 0; attempt < 4; attempt++) {
    const port = await freePort();
    try {
      const started = await spawnOnce(port, cwd);
      return { ...started, stop: () => { try { process.kill(-started.proc.pid); } catch {} } };
    } catch (e) {
      lastErr = e;
      if (!e.retryable) throw e;   // a real startup failure: surface it, don't mask it as a port race
    }
  }
  throw lastErr;
}
