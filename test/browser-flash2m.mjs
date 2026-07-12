// Playwright test: build a FLASH2M game (driftmania) in the browser via the
// SDK's real build(), and prove the .gtr is BYTE-IDENTICAL to the CLI's golden.
// This is the proof that the browser and CLI run the identical banking pipeline.
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";

const PORT = 5000 + Math.floor(Date.now() % 900);
const URL_ = `http://localhost:${PORT}/`;

function startVite() {
  return new Promise((resolve, reject) => {
    const proc = spawn("npx", ["vite", "--port", String(PORT), "--strictPort"], {
      cwd: new URL("..", import.meta.url).pathname, env: process.env, detached: true,
    });
    let out = "";
    const onData = (d) => { out += d.toString(); if (out.includes(`:${PORT}`)) resolve(proc); };
    proc.stdout.on("data", onData); proc.stderr.on("data", onData);
    setTimeout(() => reject(new Error("vite did not start:\n" + out)), 20000);
  });
}

const DRIFT = "/home/monteslu/code/cliemu/gtlua-ports/driftmania";
const src = readFileSync(`${DRIFT}/main.lua`, "utf8");
const sheetB64 = Buffer.from(readFileSync(`${DRIFT}/gfx.gtg`)).toString("base64");
const golden = readFileSync("/home/monteslu/code/cliemu/gtlua-build-golden/driftmania.gtr");

let proc, failed = false;
try {
  proc = await startVite();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.on("console", (m) => { if (m.type() === "error") console.log("[err]", m.text().slice(0, 200)); });
  page.on("pageerror", (e) => console.log("[pageerror]", e.message.slice(0, 200)));
  await page.goto(URL_, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__gtlua_test?.build, { timeout: 15000 });

  const result = await page.evaluate(async ({ src, sheetB64 }) => {
    const sheetBytes = Uint8Array.from(atob(sheetB64), (c) => c.charCodeAt(0)).buffer;
    try {
      const r = await window.__gtlua_test.build(src, { num8: true, sheetBytes });
      return { ok: r.ok, gtr: r.gtr ? Array.from(new Uint8Array(r.gtr)) : null, gtrLen: r.gtr ? r.gtr.byteLength : 0, ms: r.ms };
    } catch (e) { return { ok: false, message: e.message }; }
  }, { src, sheetB64 });

  console.log("=== browser FLASH2M build ===");
  console.log("ok:", result.ok, "| gtrLen:", result.gtrLen, "| ms:", result.ms);
  if (!result.ok) { console.log("ERR:", result.message); failed = true; }
  else if (result.gtrLen !== 2097152) { console.log("NOT FLASH2M size (expected 2097152)"); failed = true; }
  else {
    const got = Buffer.from(result.gtr);
    const same = got.length === golden.length && got.equals(golden);
    console.log(same ? "BYTE-IDENTICAL to the CLI golden" : `DIFFERS from golden (${got.length} vs ${golden.length})`);
    if (!same) failed = true;
  }
  await browser.close();
} catch (e) {
  console.log("TEST ERROR:", (e.message || String(e)).split("\n")[0]);
  failed = true;
} finally {
  if (proc) try { process.kill(-proc.pid, "SIGKILL"); } catch {}
}
console.log(failed ? "\nRESULT: FAIL" : "\nRESULT: PASS - FLASH2M cart built in-browser, identical to CLI");
process.exit(failed ? 1 : 0);
