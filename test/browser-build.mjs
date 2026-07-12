// Playwright test: build a Lua game to a .gtr in a REAL browser, in the Worker
// (threaded, warm tools). Owns vite's lifecycle; kills the whole process group.
import { chromium } from "playwright";
import { spawn } from "node:child_process";

const PORT = 5000 + Math.floor(Date.now() % 900);
const URL_ = `http://localhost:${PORT}/`;

function startVite() {
  return new Promise((resolve, reject) => {
    const proc = spawn("npx", ["vite", "--port", String(PORT), "--strictPort"], {
      cwd: new URL("..", import.meta.url).pathname,
      env: process.env,
      detached: true,
    });
    let out = "";
    const onData = (d) => { out += d.toString(); if (out.includes(`:${PORT}`)) resolve(proc); };
    proc.stdout.on("data", onData);
    proc.stderr.on("data", onData);
    setTimeout(() => reject(new Error("vite did not start:\n" + out)), 20000);
  });
}

let proc;
let failed = false;
try {
  proc = await startVite();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.on("console", (m) => { if (m.type() === "error") console.log("[console.error]", m.text().slice(0, 200)); });
  page.on("pageerror", (e) => console.log("[pageerror]", e.message.slice(0, 200)));

  await page.goto(URL_, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__gtlua_test?.build, { timeout: 15000 });

  const HELLO = `function _draw()
  cls(1)
  print("hi", 40, 40, 14)
  circfill(64, 64, 20, 10)
end`;

  const result = await page.evaluate(async (src) => {
    const t0 = performance.now();
    try {
      const r = await window.__gtlua_test.build(src);
      return { ok: r.ok, gtrLen: r.gtr ? r.gtr.byteLength : 0, ms: r.ms, wall: Math.round(performance.now() - t0) };
    } catch (e) {
      return { ok: false, buildError: { message: e.message } };
    }
  }, HELLO);

  console.log("=== browser build ===");
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok || result.gtrLen !== 32768) failed = true;

  await browser.close();
} catch (e) {
  console.log("TEST ERROR:", (e.message || String(e)).split("\n")[0]);
  failed = true;
} finally {
  if (proc) try { process.kill(-proc.pid, "SIGKILL"); } catch {}
}

console.log(failed ? "\nRESULT: FAIL" : "\nRESULT: PASS - .gtr built in the browser worker");
process.exit(failed ? 1 : 0);
