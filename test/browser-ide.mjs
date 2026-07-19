// Playwright: the IDE shell smoke test. Sidebar seeds a hello project, examples
// load, forking an example opens it, and the Play loop still runs a cart.
import { chromium } from "playwright";
import { startVite } from "./vite-server.mjs";

let proc, URL_, PORT, failed = false;
const check = (name, cond) => { console.log((cond ? "  ok " : "FAIL ") + name); if (!cond) failed = true; };
try {
  ({ proc: proc, url: URL_, port: PORT } = await startVite(import.meta.url));
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.log("[pageerror]", e.message.slice(0, 200)));
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: "domcontentloaded" });

  // sidebar + seeded project
  await page.waitForSelector(".sidebar", { timeout: 15000 });
  // first run: nothing is forced on you - no auto-created project, the editor
  // area is blank, and the New Project dialog opens itself
  await page.waitForSelector(".newproj-box", { timeout: 8000 });
  const firstRun = await page.evaluate(() => ({
    projects: document.querySelectorAll(".side-list .side-item").length,
    playDisabled: document.querySelector("button.play")?.disabled,
  }));
  check("first run: no forced project, dialog open", firstRun.projects === 0);
  await page.click(".newproj-close");
  await page.waitForTimeout(200);
  const blank = await page.evaluate(() => !!document.querySelector(".no-project"));
  check("blank editor state until a project is picked", blank);

  // examples gallery: the New Project dialog lists Blank + the examples
  await page.click(".side-new");
  await page.waitForFunction(() => document.querySelectorAll(".newproj-card").length >= 4, { timeout: 8000 });
  const exNames = await page.evaluate(() => [...document.querySelectorAll(".newproj-card .newproj-name")].map((el) => el.textContent.trim()));
  check("examples listed in the New Project dialog", exNames.length >= 4 && exNames[0] === "Blank Project");
  console.log("     gallery:", exNames.join(", "));
  const thumbs = await page.evaluate(() => [...document.querySelectorAll(".newproj-card img.newproj-thumb")].filter((i) => i.naturalWidth === 128).length);
  check("example thumbnails load at 128px", thumbs >= 3);

  // clone the orbit example -> it opens as a new project with its source
  await page.locator(".newproj-card", { hasText: "orbit" }).locator("button.newproj-clone").click();
  await page.waitForFunction(() => document.querySelector(".side-list li.active .side-item")?.textContent === "orbit", { timeout: 5000 });
  const editorHasOrbit = await page.evaluate(() => { const s = window.__gtlua_test.getSource() || ""; return s.includes("_update") || s.length > 200; });
  check("forking orbit opened it", editorHasOrbit);

  // Play the forked project -> emulator runs
  await page.click("button.play");
  await page.waitForFunction(() => document.querySelector(".emu-canvas")?.width === 128 && !document.querySelector(".emu-overlay"), { timeout: 120000 });
  await page.waitForTimeout(1200);
  const nonBlack = await page.evaluate(() => {
    const c = document.querySelector(".emu-canvas"); const { data } = c.getContext("2d").getImageData(0, 0, c.width, c.height);
    let n = 0; for (let i = 0; i < data.length; i += 4) if (data[i] || data[i + 1] || data[i + 2]) n++;
    return n;
  });
  check("forked project runs (canvas non-blank)", nonBlack > 500);

  // .gtr download button is enabled after a build
  const gtrEnabled = await page.evaluate(() => !document.querySelector('.tb-btn[title*=".gtr"]')?.disabled);
  check(".gtr download enabled after build", gtrEnabled);

  await browser.close();
} catch (e) {
  console.log("TEST ERROR:", (e.message || String(e)).split("\n")[0]);
  failed = true;
} finally {
  if (proc) try { process.kill(-proc.pid, "SIGKILL"); } catch {}
}
console.log(failed ? "\nRESULT: FAIL" : "\nRESULT: PASS - IDE shell (projects + examples + fork + play + export)");
process.exit(failed ? 1 : 0);
