// Perf smoke test: measure in-browser build wall-time. A warm edited build of a
// small game must be well under a second (it's ~70ms after the O(n^2) linker-IO
// fix; guard at 800ms to catch a regression). Prints timings; fails if slow.
import { chromium } from "playwright";
import { startVite } from "./vite-server.mjs";

const HELLO = `function _draw()\n  cls(1)\n  print("hi", 40, 40, 14)\n  circfill(64, 64, 20, 10)\nend\n`;
const build = (page, src) => page.evaluate((src) => window.__gtlua_test.build(src).then((r) => r.ms), src);

let proc, URL_, PORT, failed = false;
try {
  ({ proc: proc, url: URL_, port: PORT } = await startVite(import.meta.url));
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.log("[pageerror]", e.message.slice(0, 160)));
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__gtlua_test?.build, { timeout: 15000 });

  const cold = await build(page, HELLO);                 // includes warmup
  console.log("cold build (incl warmup):", cold, "ms");

  const edited = [];
  for (let i = 0; i < 4; i++) {
    const src = HELLO.replace("cls(1)", `cls(${1 + i})`).replace("20", String(20 + i));
    edited.push(await build(page, src));
  }
  const avg = Math.round(edited.reduce((a, b) => a + b, 0) / edited.length);
  console.log("warm edited builds:", edited.join(", "), "ms  (avg", avg + "ms)");

  if (avg > 800) { console.log(`SLOW: warm edited build avg ${avg}ms > 800ms budget`); failed = true; }
  else console.log(`fast: warm edited build avg ${avg}ms (budget 800ms)`);

  await browser.close();
} catch (e) {
  console.log("PERF ERROR:", (e.message || String(e)).split("\n")[0]);
  failed = true;
} finally {
  if (proc) try { process.kill(-proc.pid, "SIGKILL"); } catch {}
}
console.log(failed ? "\nRESULT: FAIL" : "\nRESULT: PASS - build perf (warm edited build < 800ms)");
process.exit(failed ? 1 : 0);
