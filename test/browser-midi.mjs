// Playwright: MIDI import into the tracker. Generate a tiny SMF in-page, run it
// through midiToSong, and verify notes land in the grid; also exercise the
// import button via setInputFiles with a real .mid file.
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

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

// build a tiny format-0 SMF: C E G C quarter notes
function makeMidi() {
  const vlq = (n) => { const b = []; b.unshift(n & 0x7f); n >>= 7; while (n) { b.unshift((n & 0x7f) | 0x80); n >>= 7; } return b; };
  const div = 480, ev = [];
  for (const n of [60, 64, 67, 72]) { ev.push(...vlq(0), 0x90, n, 0x64, ...vlq(div), 0x80, n, 0x00); }
  ev.push(...vlq(0), 0xff, 0x2f, 0x00);
  const trk = [0x4d, 0x54, 0x72, 0x6b, (ev.length >> 24) & 255, (ev.length >> 16) & 255, (ev.length >> 8) & 255, ev.length & 255, ...ev];
  const hdr = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, (div >> 8) & 255, div & 255];
  return Buffer.from([...hdr, ...trk]);
}

let proc, failed = false;
const check = (n, c) => { console.log((c ? "  ok " : "FAIL ") + n); if (!c) failed = true; };
const midPath = new URL("../.tmp-test.mid", import.meta.url).pathname;
try {
  writeFileSync(midPath, makeMidi());
  proc = await startVite();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
  page.on("pageerror", (e) => console.log("[pageerror]", e.message.slice(0, 160)));
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".sidebar");
  await page.click(".tab.add >> text=+ music");
  await page.waitForSelector(".music-grid");

  // unit-level: midiToSong extracts the 4 notes
  const parsed = await page.evaluate(async () => {
    const { midiToSong, parseMidi } = await import("/src/audio/midi-import.js");
    const vlq = (n) => { const b = []; b.unshift(n & 0x7f); n >>= 7; while (n) { b.unshift((n & 0x7f) | 0x80); n >>= 7; } return b; };
    const div = 480, ev = [];
    for (const n of [60, 64, 67, 72]) { ev.push(...vlq(0), 0x90, n, 0x64, ...vlq(div), 0x80, n, 0x00); }
    ev.push(...vlq(0), 0xff, 0x2f, 0x00);
    const trk = [0x4d, 0x54, 0x72, 0x6b, (ev.length >> 24) & 255, (ev.length >> 16) & 255, (ev.length >> 8) & 255, ev.length & 255, ...ev];
    const hdr = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, (div >> 8) & 255, div & 255];
    const smf = new Uint8Array([...hdr, ...trk]);
    const p = parseMidi(smf);
    const song = midiToSong(smf);
    return { notes: p.notes.length, placed: song.grid.flat().filter(Boolean).length };
  });
  check("midiToSong parses notes (4)", parsed.notes === 4);
  check("midiToSong places notes in the grid (4)", parsed.placed === 4);

  // button flow: import a real .mid via the file chooser
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.click(".music-toolbar .tool.import")]);
  await chooser.setFiles(midPath);
  await page.waitForSelector(".import-msg", { timeout: 8000 });
  await page.waitForTimeout(300);
  const onCells = await page.evaluate(() => document.querySelectorAll(".mg-cell.on").length);
  check("import button placed notes in the grid", onCells >= 4);

  await browser.close();
} catch (e) {
  console.log("TEST ERROR:", (e.message || String(e)).split("\n")[0]);
  failed = true;
} finally {
  if (proc) try { process.kill(-proc.pid, "SIGKILL"); } catch {}
  try { (await import("node:fs")).unlinkSync(midPath); } catch { /* */ }
}
console.log(failed ? "\nRESULT: FAIL" : "\nRESULT: PASS - MIDI import (parse + convert + button flow)");
process.exit(failed ? 1 : 0);
