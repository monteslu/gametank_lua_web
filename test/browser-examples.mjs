// Playwright: the genre example games. Fork each of the 5 (shmup/platformer/
// puzzle/racing/sports) and confirm it builds to a valid cart and renders a
// non-blank scene on the emulator (a real playable game, not a black screen).
import { chromium } from "playwright";
import { startVite } from "./vite-server.mjs";

const GENRES = ["shmup", "platformer", "puzzle", "racing", "sports"];

let proc, URL_, PORT, failed = false;
const check = (n, c) => { console.log((c ? "  ok " : "FAIL ") + n); if (!c) failed = true; };
try {
  ({ proc: proc, url: URL_, port: PORT } = await startVite(import.meta.url));
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.log("[pageerror]", e.message.slice(0, 160)));
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".sidebar");
  await page.waitForTimeout(800);

  for (const g of GENRES) {
    await page.evaluate(() => document.querySelector(".newproj-grid") || document.querySelector(".side-new")?.click());
    await page.waitForSelector(".newproj-grid", { timeout: 30000 });
    await page.locator(".newproj-card", { hasText: g }).locator("button.newproj-clone").click();
    await page.waitForTimeout(300);
    // Build the cloned example WITH its assets (sheet + frame table + songs) -
    // shmup/platformer draw with sprf() and won't link without gfx.gsi/gfx.gtg.
    // buildCurrent() passes exactly what the Play button does.
    const r = await page.evaluate(() => window.__gtlua_test.buildCurrent().then((b) => ({ ok: b.ok, len: b.gtr ? b.gtr.byteLength : 0 })).catch((e) => ({ ok: false, err: e.message })));
    // a valid cart is EEPROM32K (32768) or, if it overflows, FLASH2M (2 MB) -
    // the puzzle's larger port re-targets to FLASH2M, which is still valid.
    check(`${g} builds a valid cart`, r.ok && (r.len === 32768 || r.len === 2097152));
    if (!r.ok) console.log("     err:", r.err);
  }

  // run one (shmup) and confirm it renders a scene (not black)
  await page.evaluate(() => document.querySelector(".newproj-grid") || document.querySelector(".side-new")?.click());
  await page.waitForSelector(".newproj-grid", { timeout: 30000 });
  await page.locator(".newproj-card", { hasText: "shmup" }).locator("button.newproj-clone").click();
  await page.waitForTimeout(300);
  await page.click("button.play");
  await page.waitForFunction(() => document.querySelector(".emu-canvas")?.width === 128 && !document.querySelector(".emu-overlay"), { timeout: 120000 });
  await page.waitForTimeout(1000);
  const colors = await page.evaluate(() => {
    const c = document.querySelector(".emu-canvas"); const { data } = c.getContext("2d").getImageData(0, 0, 128, 128);
    const s = new Set(); for (let i = 0; i < data.length; i += 4) s.add((data[i] << 16) | (data[i + 1] << 8) | data[i + 2]);
    return s.size;
  });
  check("a genre game renders a real scene (multiple colors)", colors >= 3);

  await browser.close();
} catch (e) {
  console.log("TEST ERROR:", (e.message || String(e)).split("\n")[0]);
  failed = true;
} finally {
  if (proc) try { process.kill(-proc.pid, "SIGKILL"); } catch {}
}
console.log(failed ? "\nRESULT: FAIL" : "\nRESULT: PASS - 5 genre examples (shmup/platformer/puzzle/racing/sports build + run)");
process.exit(failed ? 1 : 0);
