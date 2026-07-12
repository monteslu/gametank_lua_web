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
  await page.waitForFunction(() => document.querySelectorAll(".side-list .side-item:not(.example)").length >= 1, { timeout: 8000 });
  const projCount = await page.evaluate(() => document.querySelectorAll(".side-item:not(.example)").length);
  check("a project is seeded", projCount >= 1);

  // examples loaded
  await page.waitForFunction(() => document.querySelectorAll(".side-item.example").length >= 3, { timeout: 8000 });
  const exNames = await page.evaluate(() => [...document.querySelectorAll(".side-item.example")].map((b) => b.textContent.split(/\s{2,}|\n/)[0].trim()));
  check("examples listed (hello/orbit/...)", exNames.length >= 3);
  console.log("     examples:", exNames.join(", "));

  // fork the orbit example -> it opens as a new project with its source
  const orbitBtn = page.locator(".side-item.example", { hasText: "orbit" });
  await orbitBtn.click();
  await page.waitForFunction(() => document.querySelector(".proj-name")?.value === "orbit", { timeout: 5000 });
  const editorHasOrbit = await page.evaluate(() => (document.querySelector(".code")?.value || "").includes("_update") || (document.querySelector(".code")?.value || "").length > 200);
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
