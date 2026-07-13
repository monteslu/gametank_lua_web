// Playwright: the IDE shell smoke test. Sidebar seeds a hello project, examples
// load, forking an example opens it, and the Play loop still runs a cart.
import { chromium } from "playwright";
import { spawn } from "node:child_process";

const PORT = 5000 + Math.floor(Date.now() % 900);
function startVite() {
  return new Promise((resolve, reject) => {
    const proc = spawn("npx", ["vite", "--port", String(PORT), "--strictPort"], {
      cwd: new URL("..", import.meta.url).pathname, env: process.env, detached: true,
    });
    let out = ""; const onData = (d) => { out += d; if (out.includes(`:${PORT}`)) resolve(proc); };
    proc.stdout.on("data", onData); proc.stderr.on("data", onData);
    setTimeout(() => reject(new Error("no vite:\n" + out)), 20000);
  });
}

let proc, failed = false;
const check = (name, cond) => { console.log((cond ? "  ok " : "FAIL ") + name); if (!cond) failed = true; };
try {
  proc = await startVite();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.log("[pageerror]", e.message.slice(0, 200)));
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: "domcontentloaded" });

  // sidebar + seeded project
  await page.waitForSelector(".sidebar", { timeout: 15000 });
  await page.waitForFunction(() => document.querySelectorAll(".side-list .side-item").length >= 1, { timeout: 8000 });
  const projCount = await page.evaluate(() => document.querySelectorAll(".side-item").length);
  check("a project is seeded", projCount >= 1);

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
  await page.waitForFunction(() => document.querySelector(".proj-name")?.value === "orbit", { timeout: 5000 });
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
