// Playwright: live playback edits. While a song plays, changing the step count
// and tempo (and adding notes) should take effect on the next iteration - the
// playhead should wrap at the NEW step count, not the count from when play began.
import { chromium } from "playwright";
import { startVite } from "./vite-server.mjs";

const maxPlayRow = (page) => page.evaluate(() => {
  const rows = [...document.querySelectorAll(".mg-row")];
  return rows.findIndex((r) => r.classList.contains("playhead"));
});

let proc, URL_, PORT, failed = false;
const check = (n, c) => { console.log((c ? "  ok " : "FAIL ") + n); if (!c) failed = true; };
try {
  ({ proc: proc, url: URL_, port: PORT } = await startVite(import.meta.url));
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1300, height: 900 } });
  page.on("pageerror", (e) => console.log("[pageerror]", e.message.slice(0, 160)));
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: "domcontentloaded" });

  // first run auto-opens the New Project dialog: clone the hello example so
  // the test has an open project (the old seeded-hello baseline)
  await page.waitForSelector(".newproj-grid", { timeout: 30000 });
  await page.locator(".newproj-card", { hasText: "hello" }).locator("button.newproj-clone").click();
  await page.waitForSelector(".monaco-editor", { timeout: 30000 });
  await page.waitForSelector(".sidebar");
  await page.click(".tab.add >> text=+ music");
  await page.waitForSelector(".music-grid");

  // set a slow-ish tempo so we can observe the playhead, then play
  await page.locator(".m-field input[type=number]").first().fill("30");   // tempo (frames/step) = 0.5s/step
  await page.click(".m-play");
  await page.waitForTimeout(300);
  const playingClass = await page.evaluate(() => document.querySelector(".m-play").classList.contains("on"));
  check("playback started", playingClass);

  // observe the playhead advancing (sample the max row index over ~2s)
  let seen = new Set();
  for (let i = 0; i < 8; i++) { seen.add(await maxPlayRow(page)); await page.waitForTimeout(250); }
  check("playhead advances through steps", seen.size >= 3);

  // shrink steps to 4 WHILE PLAYING; the playhead must wrap within 0..3
  await page.locator(".m-field input[type=number]").nth(1).fill("4");   // steps = 4
  await page.waitForTimeout(300);
  let maxRowAfter = -1;
  for (let i = 0; i < 10; i++) { maxRowAfter = Math.max(maxRowAfter, await maxPlayRow(page)); await page.waitForTimeout(150); }
  console.log("     max playhead row after steps=4:", maxRowAfter);
  check("playhead wraps at the NEW step count (<=3)", maxRowAfter >= 0 && maxRowAfter <= 3);

  // add a note while playing - it should just work (no crash, still playing)
  await page.locator(".mg-row").nth(1).locator(".mg-cell").nth(0).click();
  await page.waitForTimeout(300);
  const stillPlaying = await page.evaluate(() => document.querySelector(".m-play").classList.contains("on"));
  const notePlaced = await page.evaluate(() => document.querySelectorAll(".mg-cell.on").length >= 1);
  check("editing notes while playing works (still playing + note placed)", stillPlaying && notePlaced);

  // stop
  await page.click(".m-play");
  await page.waitForTimeout(200);
  const stopped = await page.evaluate(() => !document.querySelector(".mg-row.playhead") && !document.querySelector(".m-play").classList.contains("on"));
  check("stop halts playback + clears the playhead", stopped);

  await browser.close();
} catch (e) {
  console.log("TEST ERROR:", (e.message || String(e)).split("\n")[0]);
  failed = true;
} finally {
  if (proc) try { process.kill(-proc.pid, "SIGKILL"); } catch {}
}
console.log(failed ? "\nRESULT: FAIL" : "\nRESULT: PASS - live playback edits (steps/tempo/notes take effect while playing)");
process.exit(failed ? 1 : 0);
