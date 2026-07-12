// Playwright: the sprite editor. Add a sheet, draw with pencil + rect, verify
// pixels land, the sheet persists on the project, and a sprite-bearing build
// still produces a cart.
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
  page.on("pageerror", (e) => console.log("[pageerror]", e.message.slice(0, 200)));
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".sidebar");

  await page.click(".tab.add");
  await page.waitForSelector(".sprite-canvas");
  check("sprite editor opened", true);

  // pick a full-palette color; draw a pencil line then a filled-ish rect
  await page.locator(".pal-grid .swatch").nth(31).click();
  const canvas = page.locator(".sprite-canvas");
  const box = await canvas.boundingBox();
  await page.mouse.move(box.x + 30, box.y + 30); await page.mouse.down();
  await page.mouse.move(box.x + 150, box.y + 150, { steps: 8 }); await page.mouse.up();
  await page.click(".tool >> text=rect");
  await page.mouse.move(box.x + 60, box.y + 200); await page.mouse.down();
  await page.mouse.move(box.x + 260, box.y + 320, { steps: 6 }); await page.mouse.up();
  await page.waitForTimeout(300);

  const painted = await page.evaluate(() => {
    const c = document.querySelector(".sprite-canvas");
    const { data } = c.getContext("2d").getImageData(0, 0, 128, 128);
    let n = 0;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i+1];
      const isChecker = Math.abs(r-g) < 3 && r <= 48;
      if (!isChecker) n++;
    }
    return n;
  });
  check("pencil + rect painted pixels", painted > 80);

  // the palette swatch RGB must match the core CAPTURE table (byte 31)
  const swatchMatchesCapture = await page.evaluate(() => {
    const sel = document.querySelector(".pal-grid .swatch.sel");
    if (!sel) return false;
    const bg = getComputedStyle(sel).backgroundColor; // rgb(185, 197, 65) for byte 31
    return /185.*197.*65/.test(bg);
  });
  check("swatch rgb = core CAPTURE (byte 31 = 185,197,65)", swatchMatchesCapture);

  // persisted to IndexedDB: reload and confirm gfx.gtg came back
  await page.waitForTimeout(700);   // let autosave fire
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(".sidebar");
  const hasSheetTab = await page.evaluate(() => [...document.querySelectorAll(".pane-tabs .tab")].some((t) => t.textContent.includes("gfx.gtg")));
  check("sheet persisted across reload", hasSheetTab);

  // build a cart with the sprite present
  await page.click("button.play");
  await page.waitForFunction(() => document.querySelector(".emu-canvas")?.width === 128 && !document.querySelector(".emu-overlay"), { timeout: 120000 });
  const gtrOk = await page.evaluate(() => !document.querySelector('.tb-btn[title*=".gtr"]')?.disabled);
  check("sprite-bearing build produced a cart", gtrOk);

  await browser.close();
} catch (e) {
  console.log("TEST ERROR:", (e.message || String(e)).split("\n")[0]);
  failed = true;
} finally {
  if (proc) try { process.kill(-proc.pid, "SIGKILL"); } catch {}
}
console.log(failed ? "\nRESULT: FAIL" : "\nRESULT: PASS - sprite editor (draw + core palette + persist + build)");
process.exit(failed ? 1 : 0);
