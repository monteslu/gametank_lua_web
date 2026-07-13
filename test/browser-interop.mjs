// Playwright: C-SDK asset interop. Verify the raw .gtg/.gsi/.gtm2 import+export
// buttons exist in their editors and the pure round-trips are byte-stable (a C
// project's assets load into our editors and export back unchanged).
import { chromium } from "playwright";
import { spawn } from "node:child_process";

const PORT = 5000 + Math.floor(Date.now() % 900);
function startVite() {
  return new Promise((resolve, reject) => {
    const proc = spawn("npx", ["vite", "--port", String(PORT), "--strictPort"], {
      cwd: new URL("..", import.meta.url).pathname, env: process.env, detached: true,
    });
    let out = ""; const d = (x) => { out += x; if (out.includes(`:${PORT}`)) resolve(proc); };
    proc.stdout.on("data", d); proc.stderr.on("data", d); setTimeout(() => reject(new Error("no vite")), 20000);
  });
}

let proc, failed = false;
const check = (n, c) => { console.log((c ? "  ok " : "FAIL ") + n); if (!c) failed = true; };
try {
  proc = await startVite();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
  page.on("pageerror", (e) => console.log("[pageerror]", e.message.slice(0, 160)));
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".sidebar");

  // pure round-trips (the interop guarantee)
  const rt = await page.evaluate(async () => {
    const { fromGtg, toGtg, newSheet, setPixel } = await import("/src/gfx/gtg.js");
    const { encodeGsi, parseGsi, frameFromRect } = await import("/src/gfx/gsi.js");
    const { gtm2ToModel, encodeGtm2 } = await import("/src/audio/gtm2.js");
    // gtg
    const s = newSheet(); setPixel(s, 10, 20, 42); setPixel(s, 100, 100, 200);
    const s2 = fromGtg(toGtg(s));
    const gtg = s2[20 * 128 + 10] === 42 && s2[100 * 128 + 100] === 200;
    // gsi
    const f2 = parseGsi(encodeGsi([frameFromRect(0, 0, 16, 16), frameFromRect(16, 0, 8, 24)]));
    const gsi = f2.length === 2 && f2[0].w === 16 && f2[1].gx === 16;
    // gtm2 byte-stable
    const b = encodeGtm2({ instruments: [0, 8, 2, 3], events: [{ delay: 8, notes: { 0: 60 } }, { delay: 8, notes: { 0: 64 } }] });
    const m = gtm2ToModel(b);
    const evs = []; let pending = m.delay;
    for (let st = 0; st < m.steps; st++) { const notes = {}; let any = false; for (let ch = 0; ch < 4; ch++) { const n = m.grid[st][ch]; if (n) { notes[ch] = n; any = true; } } if (any) { evs.push({ delay: pending, notes }); pending = m.delay; } else pending += m.delay; }
    const re = encodeGtm2({ instruments: m.instruments, events: evs });
    const gtm2 = b.length === re.length && b.every((x, i) => x === re[i]);
    return { gtg, gsi, gtm2 };
  });
  check(".gtg round-trips byte-stable", rt.gtg);
  check(".gsi round-trips byte-stable", rt.gsi);
  check(".gtm2 round-trips byte-stable", rt.gtm2);

  // the import/export buttons exist in each editor
  await page.click(".tab.add >> text=+ sprites");
  await page.waitForSelector(".sprite-canvas");
  // the .gtg import/export are now icon buttons (aria-labelled)
  const gtgIn = await page.locator('.sprite-toolbar .tool[aria-label="import .gtg"]').count();
  const gtgOut = await page.locator('.sprite-toolbar .tool[aria-label="export .gtg"]').count();
  check("sprite editor has .gtg import/export", gtgIn === 1 && gtgOut === 1);

  await page.click(".tab.add >> text=+ frames");
  await page.waitForSelector(".frame-overlay");
  const frameBtns = await page.evaluate(() => [...document.querySelectorAll(".frame-toolbar .tool")].map((b) => b.textContent).join("|"));
  check("frame editor has .gsi import/export", /\.gsi ▾/.test(frameBtns) && /\.gsi ▴/.test(frameBtns));

  await page.click(".tab.add >> text=+ music");
  await page.waitForSelector(".music-grid");
  const musicBtns = await page.evaluate(() => [...document.querySelectorAll(".music-toolbar .tool")].map((b) => b.textContent).join("|"));
  check("music editor has .gtm2 import/export", /\.gtm2 ▾/.test(musicBtns) && /\.gtm2 ▴/.test(musicBtns));

  await browser.close();
} catch (e) {
  console.log("TEST ERROR:", (e.message || String(e)).split("\n")[0]);
  failed = true;
} finally {
  if (proc) try { process.kill(-proc.pid, "SIGKILL"); } catch {}
}
console.log(failed ? "\nRESULT: FAIL" : "\nRESULT: PASS - C-SDK asset interop (.gtg/.gsi/.gtm2 round-trip + buttons)");
process.exit(failed ? 1 : 0);
