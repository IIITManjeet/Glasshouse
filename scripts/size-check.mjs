#!/usr/bin/env node
// Bytecode size guard.
//
// WHY THIS EXISTS: `SwapVMRouter` with the full opcode set compiles to ~29,130 bytes
// and CANNOT be deployed (EIP-170 caps runtime bytecode at 24,576). solc reports that
// as a *warning*, not an error — so without this check the failure surfaces only when
// a deploy reverts on-chain. GlasshouseRouter lives in the ~4,200 bytes of headroom
// left by AquaSwapVMRouter, so we measure on every build.
//
// Exit code 1 if any deployable contract exceeds the limit.

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const LIMIT = 24576;
const ARTIFACTS = "artifacts";

// Contracts we knowingly build over the limit for TESTING only. The test EVM does not
// enforce EIP-170, which is how the three-way comparison test can run the full-opcode
// router. These are never deployed.
const TEST_ONLY = [/Debug$/, /^GlasshouseTestRouter$/, /^SwapVMRouter$/];

async function* walk(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.name.endsWith(".json")) yield p;
  }
}

const rows = [];
for await (const file of walk(ARTIFACTS)) {
  let art;
  try {
    art = JSON.parse(await readFile(file, "utf8"));
  } catch {
    continue;
  }
  const name = art.contractName;
  const bytecode = art.deployedBytecode?.object ?? art.deployedBytecode;
  if (!name || typeof bytecode !== "string" || !bytecode.startsWith("0x")) continue;
  const size = (bytecode.length - 2) / 2;
  if (size === 0) continue;
  rows.push({ name, size, testOnly: TEST_ONLY.some((re) => re.test(name)) });
}

const seen = new Map();
for (const r of rows) if (!seen.has(r.name) || seen.get(r.name).size < r.size) seen.set(r.name, r);

const ours = [...seen.values()]
  .filter((r) => /^Glasshouse/.test(r.name))
  .sort((a, b) => b.size - a.size);
const others = [...seen.values()]
  .filter((r) => !/^Glasshouse/.test(r.name) && /Router$/.test(r.name))
  .sort((a, b) => b.size - a.size);

const fmt = (r) => {
  const pct = ((r.size / LIMIT) * 100).toFixed(1);
  const head = LIMIT - r.size;
  const flag = r.size > LIMIT ? (r.testOnly ? "TEST-ONLY (over, expected)" : "OVER LIMIT") : "ok";
  return `  ${r.name.padEnd(34)} ${String(r.size).padStart(6)} B  ${pct.padStart(5)}%  headroom ${String(head).padStart(6)}  ${flag}`;
};

console.log(`\nEIP-170 limit: ${LIMIT} bytes\n`);
if (ours.length) {
  console.log("Glasshouse:");
  ours.forEach((r) => console.log(fmt(r)));
}
if (others.length) {
  console.log("\nReference routers:");
  others.forEach((r) => console.log(fmt(r)));
}

const violations = [...seen.values()].filter((r) => r.size > LIMIT && !r.testOnly);
if (violations.length) {
  console.error(`\nFAIL: ${violations.length} deployable contract(s) exceed EIP-170.`);
  process.exit(1);
}
console.log("\nPASS: all deployable contracts fit.\n");
