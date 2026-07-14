// lib-playtest.mjs - shared harness for driving a genre example with REAL input
// and reading the framebuffer, so tests prove playability (not just "it renders").
import { chromium } from "playwright";
import { spawn } from "node:child_process";

export function startVite() {
  const PORT = 5000 + Math.floor(Date.now() % 900);
  return new Promise((resolve, reject) => {
    const proc = spawn("npx", ["vite", "--port", String(PORT), "--strictPort"], {
      cwd: new URL("..", import.meta.url).pathname, env: process.env, detached: true,
    });
    let out = ""; const d = (x) => { out += x; if (out.includes(`:${PORT}`)) resolve({ proc, PORT }); };
    proc.stdout.on("data", d); proc.stderr.on("data", d); setTimeout(() => reject(new Error("no vite")), 20000);
  });
}

// Open the IDE, fork `game`, build+run it, click the emulator to grab input.
export async function launch(game) {
  const { proc, PORT } = await startVite();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ deviceScaleFactor: 2 });
  page.on("pageerror", (e) => console.log("[pageerror]", e.message.slice(0, 160)));
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".sidebar");
  await page.waitForTimeout(1000);
  await page.waitForSelector(".newproj-grid", { timeout: 30000 });   // auto-opens on first run
  await page.locator(".newproj-card", { hasText: game }).locator("button.newproj-clone").click();
  await page.waitForTimeout(500);
  await page.click("button.play");
  await page.waitForFunction(() => document.querySelector(".emu-canvas")?.width === 128 && !document.querySelector(".emu-overlay"), { timeout: 120000 });
  await page.waitForTimeout(600);
  await page.click(".emu-screen");
  await page.waitForTimeout(150);
  return { browser, page, proc, cleanup: async () => { try { await browser.close(); } catch {} try { process.kill(-proc.pid, "SIGKILL"); } catch {} } };
}

// Keyboard: arrows = d-pad, Z=A, X=B, C=C, Enter=START (matches EmulatorPane KEYMAP).
export const KEY = { LEFT: "ArrowLeft", RIGHT: "ArrowRight", UP: "ArrowUp", DOWN: "ArrowDown", A: "KeyZ", B: "KeyX", C: "KeyC", START: "Enter" };

// hold a key for ~ms, letting the game react
export async function hold(page, key, ms = 500) {
  await page.keyboard.down(key); await page.waitForTimeout(ms); await page.keyboard.up(key); await page.waitForTimeout(120);
}
export async function tap(page, key) { await page.keyboard.down(key); await page.waitForTimeout(90); await page.keyboard.up(key); await page.waitForTimeout(120); }

// Read the framebuffer as raw RGBA.
export const fb = (page) => page.evaluate(() => {
  const c = document.querySelector(".emu-canvas");
  return Array.from(c.getContext("2d").getImageData(0, 0, 128, 128).data);
});

// A cheap whole-frame signature to detect that SOMETHING changed.
export const frameSig = (page) => page.evaluate(() => {
  const d = document.querySelector(".emu-canvas").getContext("2d").getImageData(0, 0, 128, 128).data;
  let s = 0; for (let i = 0; i < d.length; i += 4) s = (s + d[i] * 3 + d[i + 1] * 5 + d[i + 2] * 7) >>> 0;
  return s;
});

// Find the x-centroid (0..127) of the brightest-vs-background pixels in a y-band -
// good for "did the player sprite move left/right". Returns -1 if nothing found.
export const brightXInBand = (page, y0, y1, minLum = 90) => page.evaluate(([y0, y1, minLum]) => {
  const d = document.querySelector(".emu-canvas").getContext("2d").getImageData(0, 0, 128, 128).data;
  let sx = 0, n = 0;
  for (let y = y0; y < y1; y++) for (let x = 0; x < 128; x++) {
    const o = (y * 128 + x) * 4; const lum = d[o] * 0.3 + d[o + 1] * 0.6 + d[o + 2] * 0.1;
    if (lum > minLum) { sx += x; n++; }
  }
  return n ? Math.round(sx / n) : -1;
}, [y0, y1, minLum]);
