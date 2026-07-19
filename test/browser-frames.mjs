// Playwright: the frame-table editor. Add a sheet + frames, carve a frame by
// dragging over the sheet, verify it lands in the table, edit a field, and build
// a game that uses sprf() so the .gsi rides into the cart and blits.
import { chromium } from "playwright";
import { startVite } from "./vite-server.mjs";

const setCode = (page, c) => page.evaluate((code) => window.__gtlua_test.setSource(code), c);

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

  // add a sheet, paint an 8x8 block into cell 0 so the frame has content
  await page.click(".tab.add");                      // + sprites
  await page.waitForSelector(".sprite-canvas");
  await page.locator(".pal-grid .swatch").nth(40).click();
  let box = await page.locator(".sprite-canvas").boundingBox();
  for (let r = 0; r < 8; r++) {
    await page.mouse.move(box.x + 4, box.y + (r + 0.5) * 4); await page.mouse.down();
    await page.mouse.move(box.x + 30, box.y + (r + 0.5) * 4, { steps: 3 }); await page.mouse.up();
  }

  // add frames (the second + tab)
  await page.click(".tab.add");                      // + frames
  await page.waitForSelector(".frame-overlay");
  check("frame editor opened", true);

  // carve a frame: drag a rect over the top-left 8x8 (zoom 3 default)
  box = await page.locator(".frame-overlay").boundingBox();
  const z = 3;
  await page.mouse.move(box.x + 0 * z + 1, box.y + 0 * z + 1); await page.mouse.down();
  await page.mouse.move(box.x + 8 * z, box.y + 8 * z, { steps: 5 }); await page.mouse.up();
  await page.waitForTimeout(200);
  const frameCount = await page.evaluate(() => document.querySelectorAll(".frame-list li:not(.fe-empty)").length);
  check("carving added a frame", frameCount >= 1);

  // carve a second frame elsewhere
  await page.mouse.move(box.x + 8 * z + 1, box.y + 0 * z + 1); await page.mouse.down();
  await page.mouse.move(box.x + 16 * z, box.y + 8 * z, { steps: 5 }); await page.mouse.up();
  await page.waitForTimeout(200);
  const frameCount2 = await page.evaluate(() => document.querySelectorAll(".frame-list li:not(.fe-empty)").length);
  check("second frame carved", frameCount2 >= 2);

  // preview button enables + a preview canvas renders
  await page.click(".fe-play");
  await page.waitForTimeout(400);
  const hasPreview = await page.evaluate(() => !!document.querySelector(".frame-preview-canvas"));
  check("play preview renders a frame", hasPreview);

  // persisted: reload, expect the gfx.gsi tab back
  await page.waitForTimeout(700);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(".sidebar");
  const hasGsiTab = await page.evaluate(() => [...document.querySelectorAll(".pane-tabs .tab")].some((t) => t.textContent.includes("gfx.gsi")));
  check("frame table persisted across reload", hasGsiTab);

  // build a game that uses sprf(0) with the frame table present
  await page.click(".pane-tabs .tab >> text=main.lua");
  await setCode(page, 'function _draw()\n  cls(0)\n  sprf(0, 60, 60)\n  sprf(1, 90, 60)\nend\n');
  await page.waitForTimeout(700);
  await page.click("button.play");
  await page.waitForFunction(() => document.querySelector(".emu-canvas")?.width === 128 && !document.querySelector(".emu-overlay"), { timeout: 120000 });
  await page.waitForTimeout(1500);
  const nonBg = await page.evaluate(() => {
    const c = document.querySelector(".emu-canvas"); const { data } = c.getContext("2d").getImageData(0, 0, c.width, c.height);
    const bg = [data[0], data[1], data[2]]; let n = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i] !== bg[0] || data[i+1] !== bg[1] || data[i+2] !== bg[2]) n++;
    return n;
  });
  console.log("     non-bg pixels (sprf output):", nonBg);
  check("sprf frames blit in-game (.gsi rode into the cart)", nonBg > 20);

  await browser.close();
} catch (e) {
  console.log("TEST ERROR:", (e.message || String(e)).split("\n")[0]);
  failed = true;
} finally {
  if (proc) try { process.kill(-proc.pid, "SIGKILL"); } catch {}
}
console.log(failed ? "\nRESULT: FAIL" : "\nRESULT: PASS - frame-table editor (carve + preview + persist + sprf build)");
process.exit(failed ? 1 : 0);
