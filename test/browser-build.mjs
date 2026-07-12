// Playwright test: does the browser build pipeline actually work in a REAL
// browser? Starts Vite, loads the IDE, and drives the browser cc65 toolchain
// (via the window test hook), capturing console errors. This is what we could
// NOT verify without a browser: whether the emscripten glue + node-shim
// instantiates + runs cc65 in-browser and produces correct output.
import { chromium } from "playwright";
import { spawn } from "node:child_process";

function startVite() {
  return new Promise((resolve, reject) => {
    const proc = spawn("npm", ["run", "dev", "--", "--port", "5199", "--strictPort"], {
      cwd: new URL("..", import.meta.url).pathname,
      env: process.env,
    });
    let out = "";
    const onData = (d) => {
      out += d.toString();
      if (/Local:.*5199/.test(out)) resolve({ proc, url: "http://localhost:5199/" });
    };
    proc.stdout.on("data", onData);
    proc.stderr.on("data", onData);
    setTimeout(() => reject(new Error("vite did not start in 20s:\n" + out)), 20000);
  });
}

const { proc, url } = await startVite();
let failed = false;
try {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const consoleErrors = [];
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
  page.on("pageerror", (e) => consoleErrors.push("pageerror: " + e.message));

  await page.goto(url, { waitUntil: "networkidle" });

  // wait for the test hook to be present
  await page.waitForFunction(() => window.__gtlua_test?.runCc65, { timeout: 15000 });

  // drive cc65 in the browser on a two-function C unit
  const result = await page.evaluate(async () => {
    return await window.__gtlua_test.runCc65("int foo(int x){int y=x*3;return y+1;}\nvoid bar(void){foo(7);}\n");
  });

  console.log("=== browser cc65 result ===");
  console.log("status:", result.status);
  console.log("stderr:", (result.stderr || "").slice(0, 200));
  console.log("output .s length:", result.out ? result.out.length : "(null)");
  if (result.out) {
    const hasFoo = result.out.includes("_foo");
    const hasBar = result.out.includes("_bar");
    console.log("has _foo:", hasFoo, "| has _bar:", hasBar);
    console.log("--- first lines ---");
    console.log(result.out.split("\n").slice(3, 8).join("\n"));
    if (!hasFoo || !hasBar || result.status !== 0) failed = true;
  } else {
    failed = true;
  }

  if (consoleErrors.length) {
    console.log("=== console errors ===");
    consoleErrors.slice(0, 8).forEach((e) => console.log("  ", e.slice(0, 160)));
  }

  await browser.close();
} catch (e) {
  console.log("TEST ERROR:", e.message.split("\n")[0]);
  failed = true;
} finally {
  proc.kill("SIGTERM");
}

console.log(failed ? "\nRESULT: FAIL" : "\nRESULT: PASS - cc65 compiles correctly in the browser");
process.exit(failed ? 1 : 0);
