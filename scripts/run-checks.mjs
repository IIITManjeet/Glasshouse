#!/usr/bin/env node
// The three suites, run so that ONE failure does not hide the other two.
//
// `npm test` used to be `test:solidity && test:js && lint:page`. The `&&` is the bug: a
// single red Solidity test short-circuits the chain, so the 44 JS tests and the provenance
// lint never run and never report. That is the wrong failure mode for this repository in
// particular -- lint:page is what checks that every figure on the page still carries a
// source tag and a "what produced this" caption, which is the project's central claim, and
// it was silently skipped for as long as anything upstream of it was broken.
//
// Fail-fast is right when a later step depends on an earlier one. These three do not: they
// read the same tree and nothing else. So all three run, each reports, and the exit code is
// the OR of their failures -- red if anything is red, but red with a full account of what.

import { spawnSync } from "node:child_process";

const SUITES = [
  ["test:solidity", "Solidity suite (Hardhat runner; `forge test` runs the same files)"],
  ["test:js", "JS unit tests (node --test over test/js/)"],
  ["lint:page", "provenance lint (every figure has a source tag and a caption)"],
];

const failed = [];

for (const [script, what] of SUITES) {
  console.log(`\n${"=".repeat(72)}\n  npm run ${script}  --  ${what}\n${"=".repeat(72)}\n`);
  // shell: true because on Windows `npm` is npm.cmd and spawn will not find it otherwise.
  const r = spawnSync(`npm run ${script}`, { shell: true, stdio: "inherit" });
  if (r.status !== 0) failed.push(script);
}

console.log(`\n${"=".repeat(72)}`);
for (const [script] of SUITES) {
  console.log(`  ${failed.includes(script) ? "FAIL" : "pass"}  ${script}`);
}
console.log("=".repeat(72));

if (failed.length > 0) {
  console.error(`\n${failed.length} of ${SUITES.length} suites failed: ${failed.join(", ")}\n`);
  process.exit(1);
}
console.log("\nall three suites green\n");
