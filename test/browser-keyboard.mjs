// Playwright: keyboard ownership. The emulator's gamepad keys must NOT be
// captured globally (that broke Enter/arrows in the editor). Verify:
//  1. With the emulator RUNNING but the EDITOR focused, Enter inserts a newline.
//  2. After clicking the emulator, it captures input (focused state) and the
//     editor no longer receives those keys.
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

let proc, failed = false;
const check = (n, c) => { console.log((c ? "  ok " : "FAIL ") + n); if (!c) failed = true; };
try {
  proc = await startVite();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
  page.on("pageerror", (e) => console.log("[pageerror]", e.message.slice(0, 160)));
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".sidebar");
  await page.waitForSelector(".monaco-editor", { timeout: 15000 });

  // build & run so the emulator is live (its listener is active)
  await page.click("button.play");
  await page.waitForFunction(() => document.querySelector(".emu-canvas")?.width === 128 && !document.querySelector(".emu-overlay"), { timeout: 120000 });
  await page.waitForTimeout(500);

  // reset the editor to a known one-line doc, focus it, press Enter a few times
  await page.evaluate(() => window.__gtlua_test.setSource("line1"));
  await page.waitForTimeout(200);
  // click into the editor and move cursor to end
  await page.click(".monaco-editor .view-lines");
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("line2");
  await page.keyboard.press("Enter");
  await page.keyboard.type("line3");
  await page.waitForTimeout(300);
  const src = await page.evaluate(() => window.__gtlua_test.getSource());
  check("Enter makes newlines in the editor while emulator runs", /line1\n\s*line2\n\s*line3/.test(src));

  // now click the emulator screen: it should take focus (capture input)
  await page.click(".emu-screen");
  await page.waitForTimeout(150);
  const emuFocused = await page.evaluate(() => document.querySelector(".emu-screen.focused") !== null);
  check("clicking the emulator gives it keyboard focus", emuFocused);

  // with the emulator focused, a REAL arrow keypress should be captured
  // (default prevented) - install a probe, press the key, read defaultPrevented.
  await page.evaluate(() => {
    window.__kbProbe = null;
    window.__probe = (e) => { if (e.code === "ArrowRight") window.__kbProbe = e.defaultPrevented; };
    window.addEventListener("keydown", window.__probe);
  });
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(100);
  const arrowPrevented = await page.evaluate(() => { window.removeEventListener("keydown", window.__probe); return window.__kbProbe; });
  check("emulator captures gamepad keys when focused (arrow prevented)", arrowPrevented === true);

  // click back into the editor: emulator releases input
  await page.click(".monaco-editor .view-lines");
  await page.waitForTimeout(150);
  const releasedToEditor = await page.evaluate(() => document.querySelector(".emu-screen.focused") === null);
  check("clicking back into the editor releases emulator input", releasedToEditor);

  await browser.close();
} catch (e) {
  console.log("TEST ERROR:", (e.message || String(e)).split("\n")[0]);
  failed = true;
} finally {
  if (proc) try { process.kill(-proc.pid, "SIGKILL"); } catch {}
}
console.log(failed ? "\nRESULT: FAIL" : "\nRESULT: PASS - keyboard ownership (editor vs emulator)");
process.exit(failed ? 1 : 0);
