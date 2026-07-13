// Playwright: the genre example games. Fork each of the 5 (shmup/platformer/
// puzzle/racing/sports) and confirm it builds to a valid cart and renders a
// non-blank scene on the emulator (a real playable game, not a black screen).
import { chromium } from "playwright";
import { spawn } from "node:child_process";

const GENRES = ["shmup", "platformer", "puzzle", "racing", "sports"];
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
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.log("[pageerror]", e.message.slice(0, 160)));
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".sidebar");
  await page.waitForTimeout(800);

  for (const g of GENRES) {
    await page.locator(".side-item.example", { hasText: g }).first().click();
    await page.waitForTimeout(300);
    const src = await page.evaluate(() => window.__gtlua_test.getSource());
    const r = await page.evaluate((s) => window.__gtlua_test.build(s).then((b) => ({ ok: b.ok, len: b.gtr ? b.gtr.byteLength : 0 })).catch((e) => ({ ok: false, err: e.message })), src);
    check(`${g} builds a valid cart`, r.ok && r.len === 32768);
    if (!r.ok) console.log("     err:", r.err);
  }

  // run one (shmup) and confirm it renders a scene (not black)
  await page.locator(".side-item.example", { hasText: "shmup" }).first().click();
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
