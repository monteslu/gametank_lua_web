// run-all.mjs - run every test/browser-*.mjs in sequence and report a tally.
// Pass --fast to skip the slow FLASH2M byte-identical test.
import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";

const fast = process.argv.includes("--fast");
const here = new URL(".", import.meta.url).pathname;
let tests = readdirSync(here).filter((f) => /^browser-.*\.mjs$/.test(f)).sort();
if (fast) tests = tests.filter((f) => f !== "browser-flash2m.mjs");

let pass = 0, fail = 0;
const failed = [];
for (const t of tests) {
  process.stdout.write(`\n### ${t} ###\n`);
  const r = spawnSync("node", [here + t], { stdio: "inherit" });
  if (r.status === 0) pass++;
  else { fail++; failed.push(t); }
}
console.log(`\n========================================`);
console.log(`${pass} passed, ${fail} failed, of ${tests.length}${fast ? " (fast: flash2m skipped)" : ""}`);
if (failed.length) console.log("failed: " + failed.join(", "));
process.exit(fail ? 1 : 0);
