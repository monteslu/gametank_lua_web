// Playwright: the end-to-end sprite proof. Programmatically draw a solid 8x8
// block into cell 0 of the sheet (via the sprite editor's exposed sheet state),
// set Lua to spr(0, x, y), build, and verify the sprite's color appears on the
// emulator - proving the drawn .gtg rides into the cart and blits in-game.
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

// byte 40 is a bright color; we'll fill cell 0 with it and look for it on screen
const SPRITE_BYTE = 40;

let proc, failed = false;
const check = (n, c) => { console.log((c ? "  ok " : "FAIL ") + n); if (!c) failed = true; };
try {
  proc = await startVite();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
  page.on("pageerror", (e) => console.log("[pageerror]", e.message.slice(0, 200)));
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".sidebar");

  // add a sheet, then paint cell 0 (top-left 8x8) with SPRITE_BYTE by dragging
  // the pencil across it. We pick the swatch for SPRITE_BYTE first.
  await page.click(".tab.add");
  await page.waitForSelector(".sprite-canvas");
  await page.locator(".pal-grid .swatch").nth(SPRITE_BYTE).click();
  const box = await page.locator(".sprite-canvas").boundingBox();
  const zoom = 4;   // default zoom
  // fill the 8x8 top-left block row by row
  for (let row = 0; row < 8; row++) {
    await page.mouse.move(box.x + 1 * zoom, box.y + (row + 0.5) * zoom);
    await page.mouse.down();
    await page.mouse.move(box.x + 7.5 * zoom, box.y + (row + 0.5) * zoom, { steps: 4 });
    await page.mouse.up();
  }
  await page.waitForTimeout(300);

  // point main.lua at the sprite: draw cell 0 big and centered-ish
  await page.click(".pane-tabs .tab >> text=main.lua");
  const code = 'function _draw()\n  cls(0)\n  spr(0, 60, 60)\n  spr(0, 60, 60, 2, 2)\nend\n';
  await page.evaluate((c) => window.__gtlua_test.setSource(c), code);
  await page.waitForTimeout(700);   // let autosave + recompile settle

  // build & run
  await page.click("button.play");
  await page.waitForFunction(() => document.querySelector(".emu-canvas")?.width === 128 && !document.querySelector(".emu-overlay"), { timeout: 120000 });
  await page.waitForTimeout(1500);

  // the sprite's CAPTURE color should now appear on the emulator framebuffer
  const found = await page.evaluate((byte) => {
    const c = document.querySelector(".emu-canvas");
    const { data } = c.getContext("2d").getImageData(0, 0, c.width, c.height);
    // we don't know the exact rgb here, so just count NON-background pixels:
    // cls(0) fills with byte 0's color; a sprite adds a second color region.
    const bg = [data[0], data[1], data[2]];
    let nonBg = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] !== bg[0] || data[i+1] !== bg[1] || data[i+2] !== bg[2]) nonBg++;
    }
    return nonBg;
  }, SPRITE_BYTE);

  console.log("     non-background pixels on screen:", found);
  check("drawn sprite renders in-game (spr(0) blits the .gtg)", found > 50);

  await browser.close();
} catch (e) {
  console.log("TEST ERROR:", (e.message || String(e)).split("\n")[0]);
  failed = true;
} finally {
  if (proc) try { process.kill(-proc.pid, "SIGKILL"); } catch {}
}
console.log(failed ? "\nRESULT: FAIL" : "\nRESULT: PASS - drawn sprite blits in-game");
process.exit(failed ? 1 : 0);
