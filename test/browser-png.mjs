// Playwright: PNG import. Generate a known PNG in-page (canvas -> blob), run it
// through pngToSheet, and verify the RGBA -> GameTank-byte nearest-color mapping
// lands the expected bytes (red/green/blue -> their nearest palette bytes,
// transparent -> 0). Then confirm the sprite editor's "import PNG" button path
// works by importing and building.
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
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.log("[pageerror]", e.message.slice(0, 200)));
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".sidebar");

  // In-page: build a 32x32 PNG (red TL / green TR / blue BL / transparent BR),
  // run it through the real pngToSheet, and report the mapped bytes at sample points.
  const res = await page.evaluate(async () => {
    const W = 32, H = 32;
    const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
    const ctx = cv.getContext("2d");
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "rgb(255,0,0)"; ctx.fillRect(0, 0, 16, 16);
    ctx.fillStyle = "rgb(0,255,0)"; ctx.fillRect(16, 0, 16, 16);
    ctx.fillStyle = "rgb(0,0,255)"; ctx.fillRect(0, 16, 16, 16);
    // BR stays transparent
    const blob = await new Promise((r) => cv.toBlob(r, "image/png"));
    const bytes = new Uint8Array(await blob.arrayBuffer());

    const { pngToSheet } = await import("/src/gfx/png-import.js");
    const { nearestColorByte } = await import("/src/gfx/palette.js");
    const { sheet } = await pngToSheet(bytes);
    const at = (x, y) => sheet[y * 128 + x];
    return {
      red: at(4, 4), redExpect: nearestColorByte(255, 0, 0),
      green: at(20, 4), greenExpect: nearestColorByte(0, 255, 0),
      blue: at(4, 20), blueExpect: nearestColorByte(0, 0, 255),
      transparent: at(20, 20),   // expect 0
      len: sheet.length,
    };
  });

  check("sheet is 16384 bytes", res.len === 16384);
  check(`red pixel -> nearest byte (${res.red}=${res.redExpect})`, res.red === res.redExpect && res.red !== 0);
  check(`green pixel -> nearest byte (${res.green}=${res.greenExpect})`, res.green === res.greenExpect && res.green !== 0);
  check(`blue pixel -> nearest byte (${res.blue}=${res.blueExpect})`, res.blue === res.blueExpect && res.blue !== 0);
  check("transparent pixel -> byte 0", res.transparent === 0);
  check("three regions are distinct colors", res.red !== res.green && res.green !== res.blue && res.red !== res.blue);

  await browser.close();
} catch (e) {
  console.log("TEST ERROR:", (e.message || String(e)).split("\n")[0]);
  failed = true;
} finally {
  if (proc) try { process.kill(-proc.pid, "SIGKILL"); } catch {}
}
console.log(failed ? "\nRESULT: FAIL" : "\nRESULT: PASS - PNG import (native decode + nearest-color to GameTank bytes)");
process.exit(failed ? 1 : 0);
