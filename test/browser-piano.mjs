// Playwright: the piano note picker. Verify the keyboard renders (white + black
// keys with name tooltips), selecting a key updates the current note, and a
// grid cell placed after picks up the piano-selected pitch.
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
  await page.click(".tab.add >> text=+ music");
  await page.waitForSelector(".music-grid");

  const layout = await page.evaluate(() => ({
    whites: document.querySelectorAll(".pk-white").length,
    blacks: document.querySelectorAll(".pk-black").length,
    tooltip: document.querySelector(".pk-white")?.getAttribute("title"),
  }));
  check("piano renders white + black keys", layout.whites >= 30 && layout.blacks >= 20);
  check("keys have name tooltips", /^[A-G]#?\d$/.test(layout.tooltip || ""));

  // click a white key on its lower (label) area, where a real user clicks - the
  // upper part can be overlapped by a black key (normal piano geometry).
  const clickWhite = async (name) => {
    const box = await page.locator(`.pk-white[title="${name}"]`).boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height - 8);
    await page.waitForTimeout(120);
  };

  await clickWhite("E4");
  const sel = await page.evaluate(() => document.querySelector(".mpb-label b")?.textContent);
  check("selecting a key updates the current note (E4)", sel === "E4");
  const keyHighlighted = await page.evaluate(() => document.querySelector(".pk-white.sel")?.getAttribute("title"));
  check("selected key is highlighted", keyHighlighted === "E4");

  // pick a black key (a sharp) and confirm
  await page.locator(".pk-black").nth(10).click();
  await page.waitForTimeout(150);
  const selSharp = await page.evaluate(() => document.querySelector(".mpb-label b")?.textContent);
  check("black keys select sharps", /#/.test(selSharp || ""));

  // place a note in the grid; it should carry the piano-selected pitch
  await clickWhite("G4");
  await page.locator(".mg-row .mg-cell").first().click();
  await page.waitForTimeout(150);
  const cellText = await page.evaluate(() => document.querySelector(".mg-cell.on")?.textContent);
  check("grid cell uses the piano-selected note (G4)", cellText === "G4");

  // --- computer-keyboard note shortcuts (base octave = 4) ---
  // click somewhere neutral to move focus off any input first
  await page.locator(".music-grid").click({ position: { x: 5, y: 5 } });
  const noteReadout = () => page.evaluate(() => document.querySelector(".mpb-label b")?.textContent);

  await page.keyboard.press("KeyZ");           // C of base octave (4)
  await page.waitForTimeout(100);
  check("Z plays C4 (base octave)", (await noteReadout()) === "C4");

  await page.keyboard.press("KeyS");           // C#4
  await page.waitForTimeout(100);
  check("S plays C#4 (a sharp)", (await noteReadout()) === "C#4");

  await page.keyboard.press("KeyQ");           // C one octave up (C5)
  await page.waitForTimeout(100);
  check("Q plays C5 (octave up)", (await noteReadout()) === "C5");

  await page.keyboard.press("BracketRight");   // octave up -> base 5
  await page.waitForTimeout(100);
  await page.keyboard.press("KeyZ");           // now C5
  await page.waitForTimeout(100);
  check("] raises the octave (Z now plays C5)", (await noteReadout()) === "C5");

  await browser.close();
} catch (e) {
  console.log("TEST ERROR:", (e.message || String(e)).split("\n")[0]);
  failed = true;
} finally {
  if (proc) try { process.kill(-proc.pid, "SIGKILL"); } catch {}
}
console.log(failed ? "\nRESULT: FAIL" : "\nRESULT: PASS - piano note picker (keys + tooltips + select + place)");
process.exit(failed ? 1 : 0);
