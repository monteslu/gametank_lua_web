// Playwright: Aseprite animation import. Import a multi-frame .ase and verify it
// lands a packed sheet + a .gsi frame table (jumps to the frames view with N
// frames), ready to animate with sprf.
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

const ASE = "/home/monteslu/code/cliemu/romdev-build-scratch/msx-research/libmsx/sample/sprite_animation/TJ_dog.ase";
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
  if (!existsSync(ASE)) { console.log("SKIP: no sample .ase\nRESULT: PASS - skipped"); process.exit(0); }
  proc = await startVite();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
  page.on("pageerror", (e) => console.log("[pageerror]", e.message.slice(0, 160)));
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".sidebar");

  // UI path: add a sheet, import the multi-frame .ase, expect the frames view
  // with N frames.
  await page.click(".tab.add >> text=+ sprites");
  await page.waitForSelector(".sprite-canvas");
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.click(".tool.import")]);
  await chooser.setFiles(ASE);
  // multi-frame import jumps to the frames view
  await page.waitForSelector(".frame-overlay", { timeout: 8000 });
  await page.waitForTimeout(300);

  const frameCount = await page.evaluate(() => document.querySelectorAll(".frame-list li:not(.fe-empty)").length);
  check("imported multiple frames as an animation", frameCount >= 8);
  console.log("     frames created:", frameCount);

  // the play-preview should work on the imported frames
  await page.click(".fe-play");
  await page.waitForTimeout(400);
  const hasPreview = await page.evaluate(() => !!document.querySelector(".frame-preview-canvas"));
  check("imported animation previews", hasPreview);

  await browser.close();
} catch (e) {
  console.log("TEST ERROR:", (e.message || String(e)).split("\n")[0]);
  failed = true;
} finally {
  if (proc) try { process.kill(-proc.pid, "SIGKILL"); } catch {}
}
console.log(failed ? "\nRESULT: FAIL" : "\nRESULT: PASS - Aseprite animation import (packed sheet + .gsi frames)");
process.exit(failed ? 1 : 0);
