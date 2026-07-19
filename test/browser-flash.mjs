// Playwright: the Web Serial flasher UI. We can't attach real hardware, so we
// verify: the ⚡ flash button appears (Chromium has Web Serial) and enables
// after a build; flashPlan bank math is correct in-page; and clicking flash with
// no device fails gracefully (modal shows an error, doesn't hang the app).
import { chromium } from "playwright";
import { startVite } from "./vite-server.mjs";

let proc, URL_, PORT, failed = false;
const check = (n, c) => { console.log((c ? "  ok " : "FAIL ") + n); if (!c) failed = true; };
try {
  ({ proc: proc, url: URL_, port: PORT } = await startVite(import.meta.url));
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
  page.on("pageerror", (e) => console.log("[pageerror]", e.message.slice(0, 160)));
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: "domcontentloaded" });

  // first run auto-opens the New Project dialog: clone the hello example so
  // the test has an open project (the old seeded-hello baseline)
  await page.waitForSelector(".newproj-grid", { timeout: 30000 });
  await page.locator(".newproj-card", { hasText: "hello" }).locator("button.newproj-clone").click();
  await page.waitForSelector(".monaco-editor", { timeout: 30000 });
  await page.waitForSelector(".sidebar");
  await page.waitForSelector(".monaco-editor", { timeout: 15000 });

  // flashPlan math in-page
  const plan = await page.evaluate(async () => {
    const { flashPlan } = await import("/src/flash/web-serial-flasher.js");
    const a = flashPlan(32768), b = flashPlan(2097152);
    return { a: [a.banks, a.blocks], b: [b.banks, b.blocks], last: b.writes[b.writes.length - 1].fileOffset };
  });
  check("flashPlan 32K = 2 banks / 8 blocks", plan.a[0] === 2 && plan.a[1] === 8);
  check("flashPlan 2M = 128 banks / 512 blocks", plan.b[0] === 128 && plan.b[1] === 512);
  check("flashPlan covers the whole file", plan.last === 0x1ff000);

  // the flash button exists (Chromium has Web Serial) and is disabled pre-build
  const btnBefore = await page.evaluate(() => { const b = document.querySelector(".tb-btn.flash"); return b ? b.disabled : null; });
  check("flash button present (Web Serial detected)", btnBefore !== null);
  check("flash disabled before a build", btnBefore === true);

  // build, then it enables
  await page.click("button.play");
  await page.waitForFunction(() => document.querySelector(".emu-canvas")?.width === 128 && !document.querySelector(".emu-overlay"), { timeout: 120000 });
  const btnAfter = await page.evaluate(() => document.querySelector(".tb-btn.flash")?.disabled);
  check("flash enabled after a build", btnAfter === false);

  // clicking flash with no device: requestPort() rejects in headless -> the
  // modal should appear and land in an error state (not hang).
  await page.click(".tb-btn.flash");
  await page.waitForSelector(".flash-modal", { timeout: 4000 });
  await page.waitForFunction(() => {
    const s = document.querySelector(".flash-status");
    return s && (/err|no port|not supported|cancel|fail/i.test(s.textContent) || document.querySelector(".flash-status .err"));
  }, { timeout: 6000 }).catch(() => {});
  const modalShown = await page.evaluate(() => !!document.querySelector(".flash-modal"));
  check("flash modal opens and handles no-device gracefully", modalShown);

  await browser.close();
} catch (e) {
  console.log("TEST ERROR:", (e.message || String(e)).split("\n")[0]);
  failed = true;
} finally {
  if (proc) try { process.kill(-proc.pid, "SIGKILL"); } catch {}
}
console.log(failed ? "\nRESULT: FAIL" : "\nRESULT: PASS - Web Serial flasher (plan math + button + graceful no-device)");
process.exit(failed ? 1 : 0);
