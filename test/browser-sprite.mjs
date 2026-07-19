// Playwright: the sprite editor. Add a sheet, draw with pencil + rect, verify
// pixels land, the sheet persists on the project, and a sprite-bearing build
// still produces a cart.
import { chromium } from "playwright";
import { startVite } from "./vite-server.mjs";

let proc, URL_, PORT, failed = false;
const check = (n, c) => { console.log((c ? "  ok " : "FAIL ") + n); if (!c) failed = true; };
try {
  ({ proc: proc, url: URL_, port: PORT } = await startVite(import.meta.url));
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
  page.on("pageerror", (e) => console.log("[pageerror]", e.message.slice(0, 200)));
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: "domcontentloaded" });

  // first run auto-opens the New Project dialog: clone the hello example so
  // the test has an open project (the old seeded-hello baseline)
  await page.waitForSelector(".newproj-grid", { timeout: 30000 });
  await page.locator(".newproj-card", { hasText: "hello" }).locator("button.newproj-clone").click();
  await page.waitForSelector(".monaco-editor", { timeout: 30000 });
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
  await page.locator('.sprite-toolbar .tool.icon:has(.ti-rectangle)').click();  // rect tool (now an icon)
  await page.mouse.move(box.x + 60, box.y + 200); await page.mouse.down();
  await page.mouse.move(box.x + 260, box.y + 320, { steps: 6 }); await page.mouse.up();
  await page.waitForTimeout(300);

  // count painted pixels now, so we can prove undo reduces them
  const countPainted = () => page.evaluate(() => {
    const c = document.querySelector(".sprite-canvas");
    const { data } = c.getContext("2d").getImageData(0, 0, 256, 256);
    let n = 0;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i + 1];
      if (!(Math.abs(r - g) < 3 && r <= 48)) n++;   // not checker background
    }
    return n;
  });
  const beforeUndo = await countPainted();

  // UNDO removes the last stroke (the rect); painted count drops
  await page.locator('.sprite-toolbar .tool.icon[aria-label="undo"]').click();
  await page.waitForTimeout(200);
  const afterUndo = await countPainted();
  check("undo removed the last stroke", afterUndo < beforeUndo);

  // EYEDROPPER: change the active color, then pick the drawn color back. The
  // selected swatch should return to byte 31 (185,197,65).
  await page.locator(".pal-grid .swatch").nth(5).click();          // change color away
  await page.locator('.sprite-toolbar .tool.icon:has(.ti-color-picker)').click();
  await page.mouse.move(box.x + 90, box.y + 90); await page.mouse.down(); await page.mouse.up();
  await page.waitForTimeout(150);
  const droppedBack = await page.evaluate(() => {
    const sel = document.querySelector(".pal-grid .swatch.sel");
    return sel ? /185.*197.*65/.test(getComputedStyle(sel).backgroundColor) : false;
  });
  check("eyedropper picked the drawn color (swatch = byte 31)", droppedBack);

  // re-apply the rect (redo) so the persist/build steps below still have art
  await page.locator(".sprite-canvas").hover();
  await page.keyboard.press("Control+Shift+KeyZ");
  await page.waitForTimeout(200);

  const painted = await countPainted();
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
console.log(failed ? "\nRESULT: FAIL" : "\nRESULT: PASS - sprite editor (draw + undo + eyedropper + core palette + persist + build)");
process.exit(failed ? 1 : 0);
