// Playwright test: the full edit -> Play -> running loop. Loads the IDE, clicks
// Play (builds the default hello cart in the worker), then verifies the
// emulator canvas actually renders non-blank pixels (the cart ran on the core).
import { chromium } from "playwright";
import { spawn } from "node:child_process";

const PORT = 5000 + Math.floor(Date.now() % 900);
const URL_ = `http://localhost:${PORT}/`;

function startVite() {
  return new Promise((resolve, reject) => {
    const proc = spawn("npx", ["vite", "--port", String(PORT), "--strictPort"], {
      cwd: new URL("..", import.meta.url).pathname, env: process.env, detached: true,
    });
    let out = "";
    const onData = (d) => { out += d.toString(); if (out.includes(`:${PORT}`)) resolve(proc); };
    proc.stdout.on("data", onData); proc.stderr.on("data", onData);
    setTimeout(() => reject(new Error("vite did not start:\n" + out)), 20000);
  });
}

let proc, failed = false;
try {
  proc = await startVite();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.on("console", (m) => { if (m.type() === "error") console.log("[err]", m.text().slice(0, 200)); });
  page.on("pageerror", (e) => console.log("[pageerror]", e.message.slice(0, 200)));
  await page.goto(URL_, { waitUntil: "domcontentloaded" });

  // click Play
  await page.waitForSelector("button.play", { timeout: 15000 });
  await page.click("button.play");

  // wait for the emulator to be running (overlay gone) - build + core load
  await page.waitForFunction(() => {
    const c = document.querySelector(".emu-canvas");
    return c && c.width === 128 && !document.querySelector(".emu-overlay");
  }, { timeout: 120000 });

  // give the loop a few frames, then sample the canvas pixels
  await page.waitForTimeout(1500);
  const stats = await page.evaluate(() => {
    const c = document.querySelector(".emu-canvas");
    const ctx = c.getContext("2d");
    const { data } = ctx.getImageData(0, 0, c.width, c.height);
    let nonBlack = 0; const colors = new Set();
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      if (r || g || b) nonBlack++;
      colors.add((r << 16) | (g << 8) | b);
    }
    return { total: data.length / 4, nonBlack, distinct: colors.size };
  });

  console.log("=== emulator canvas ===");
  console.log(`pixels: ${stats.total} | non-black: ${stats.nonBlack} | distinct colors: ${stats.distinct}`);
  // the hello cart draws a blue bg + yellow smiley + pink text: expect lots of
  // non-black pixels and several distinct colors
  if (stats.nonBlack < 1000) { console.log("canvas looks blank - cart didn't render"); failed = true; }
  else if (stats.distinct < 3) { console.log("only " + stats.distinct + " colors - expected the smiley scene"); failed = true; }
  else console.log("scene rendered (blue bg + smiley + text)");

  await browser.close();
} catch (e) {
  console.log("TEST ERROR:", (e.message || String(e)).split("\n")[0]);
  failed = true;
} finally {
  if (proc) try { process.kill(-proc.pid, "SIGKILL"); } catch {}
}
console.log(failed ? "\nRESULT: FAIL" : "\nRESULT: PASS - edit -> Play -> running in the emulator");
process.exit(failed ? 1 : 0);
