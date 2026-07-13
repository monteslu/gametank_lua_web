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
  await page.keyboard.press("KeyZ");           // now C5 - and it PLACES at the cursor
  await page.waitForTimeout(100);
  check("] raises the octave (Z now plays C5)", (await noteReadout()) === "C5");

  // --- cursor placement (tracker-style typing) ---
  // reset octave to 4 for predictable notes
  await page.keyboard.press("BracketLeft");
  await page.waitForTimeout(80);
  // click a cell to set the cursor, then type a run of notes; each should land
  // and the cursor advance one row.
  await page.locator(".mg-row").nth(2).locator(".mg-cell").nth(1).click();  // step 2, ch 1
  await page.waitForTimeout(100);
  const cursorAt = await page.evaluate(() => {
    const c = document.querySelector(".mg-cell.cursor");
    if (!c) return null;
    const row = [...document.querySelectorAll(".mg-row")].indexOf(c.closest(".mg-row"));
    const col = [...c.closest(".mg-row").querySelectorAll(".mg-cell")].indexOf(c);
    return { row, col };
  });
  check("clicking a cell sets the cursor", cursorAt && cursorAt.row === 2 && cursorAt.col === 1);

  // type C, E, G on the keyboard -> three notes down channel 1 from step 2
  await page.keyboard.press("KeyZ");  // C4
  await page.waitForTimeout(80);
  await page.keyboard.press("KeyC");  // E4 (semitone 4)
  await page.waitForTimeout(80);
  await page.keyboard.press("KeyB");  // G4 (semitone 7)
  await page.waitForTimeout(120);

  const placed = await page.evaluate(() => {
    const rows = [...document.querySelectorAll(".mg-row")];
    const cellText = (r, c) => rows[r]?.querySelectorAll(".mg-cell")[c]?.textContent;
    return { s2: cellText(2, 1), s3: cellText(3, 1), s4: cellText(4, 1) };
  });
  console.log("     typed run:", JSON.stringify(placed));
  check("typing places notes from the cursor down", placed.s2 === "C4" && placed.s3 === "E4" && placed.s4 === "G4");

  // Delete clears the cell under the cursor (now at step 5) and the ones we set:
  // move cursor back to step 2 and Delete
  await page.locator(".mg-row").nth(2).locator(".mg-cell").nth(1).click();
  await page.keyboard.press("Delete");
  await page.waitForTimeout(100);
  const afterDel = await page.evaluate(() => [...document.querySelectorAll(".mg-row")][2].querySelectorAll(".mg-cell")[1].textContent);
  check("Delete clears the cell under the cursor", afterDel === "·");

  // --- per-note velocity ---
  await page.locator(".mpb-vel input[type=checkbox]").check();
  await page.waitForTimeout(120);
  const velEnabled = await page.evaluate(() => document.querySelector(".mpb-vel input[type=checkbox]").checked);
  check("velocity mode toggles on", velEnabled);

  // place a full-vel note (step 6 ch 0), then a low-vel note (step 7 ch 0)
  await page.locator(".mpb-vel input[type=range]").fill("63");
  await page.locator(".mg-row").nth(6).locator(".mg-cell").nth(0).click();
  await page.locator(".mg-row").nth(7).locator(".mg-cell").nth(0).click();
  await page.locator(".mpb-vel input[type=range]").fill("10");  // lowers step-7 (cursor there)
  await page.waitForTimeout(150);
  const vops = await page.evaluate(() => {
    const rows = [...document.querySelectorAll(".mg-row")];
    const op = (r) => { const c = rows[r].querySelectorAll(".mg-cell")[0]; return c.classList.contains("on") ? Math.round(getComputedStyle(c).opacity * 100) / 100 : null; };
    return { hi: op(6), lo: op(7) };
  });
  console.log("     velocity opacities: full=" + vops.hi + " low=" + vops.lo);
  check("full-velocity note is bright", vops.hi > 0.9);
  check("low-velocity note is dimmed", vops.lo != null && vops.lo < 0.7);

  await browser.close();
} catch (e) {
  console.log("TEST ERROR:", (e.message || String(e)).split("\n")[0]);
  failed = true;
} finally {
  if (proc) try { process.kill(-proc.pid, "SIGKILL"); } catch {}
}
console.log(failed ? "\nRESULT: FAIL" : "\nRESULT: PASS - piano note picker (keys + tooltips + select + place)");
process.exit(failed ? 1 : 0);
