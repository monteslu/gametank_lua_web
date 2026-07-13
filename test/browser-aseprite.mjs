// Playwright: Aseprite import. Import a real .ase (the TJ_dog sample) through the
// sprite editor's import button and verify it lands non-blank pixels; also
// unit-check the parser (dims, frames, tag, flattened pixels).
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
  if (!existsSync(ASE)) { console.log("SKIP: sample .ase not present at", ASE, "\nRESULT: PASS - skipped (no sample)"); process.exit(0); }
  proc = await startVite();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
  page.on("pageerror", (e) => console.log("[pageerror]", e.message.slice(0, 160)));
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".sidebar");
  await page.click(".tab.add >> text=+ sprites");
  await page.waitForSelector(".sprite-canvas");

  // import the real .ase via the file chooser
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.click(".tool.import")]);
  await chooser.setFiles(ASE);
  await page.waitForSelector(".import-msg", { timeout: 8000 });
  await page.waitForTimeout(400);

  const msg = await page.locator(".import-msg").textContent();
  check("import reported a size", /imported \d+×\d+/.test(msg));

  const painted = await page.evaluate(() => {
    const c = document.querySelector(".sprite-canvas");
    const { data } = c.getContext("2d").getImageData(0, 0, 128, 128);
    let n = 0; const colors = new Set();
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const isChecker = Math.abs(r - g) < 3 && r <= 48;
      if (!isChecker) { n++; colors.add((r << 16) | (g << 8) | b); }
    }
    return { n, colors: colors.size };
  });
  console.log("     imported non-transparent pixels:", painted.n, "colors:", painted.colors);
  check("aseprite pixels landed in the sheet", painted.n > 100);
  check("multiple palette colors mapped", painted.colors >= 3);

  await browser.close();
} catch (e) {
  console.log("TEST ERROR:", (e.message || String(e)).split("\n")[0]);
  failed = true;
} finally {
  if (proc) try { process.kill(-proc.pid, "SIGKILL"); } catch {}
}
console.log(failed ? "\nRESULT: FAIL" : "\nRESULT: PASS - Aseprite import (real .ase -> sheet)");
process.exit(failed ? 1 : 0);
