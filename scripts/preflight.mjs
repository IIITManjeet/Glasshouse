#!/usr/bin/env node
// Pre-deploy checks. Run this BEFORE `hardhat ignition deploy` against a real chain.
//
// WHY THIS EXISTS: the Aqua address in the parameter file is a deterministic address
// carried over from research notes, not something the npm package ships. Deploying a
// router pointed at an address with no code there would succeed, cost real gas, and
// fail silently later when a swap tried to source balances. Everything checked here is
// cheap to check and expensive to get wrong.
//
//   node scripts/preflight.mjs 8453
//
// Reads the RPC URL from BASE_RPC_URL (8453) or BASE_SEPOLIA_RPC_URL (84532).

import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

const LIMIT = 24576;

const CHAINS = {
  "8453": { name: "Base mainnet", rpcEnv: "BASE_RPC_URL", needsAqua: true },
  "84532": { name: "Base Sepolia", rpcEnv: "BASE_SEPOLIA_RPC_URL", needsAqua: false },
};

const chainId = process.argv[2];
const chain = CHAINS[chainId];
if (!chain) {
  console.error(`usage: node scripts/preflight.mjs <${Object.keys(CHAINS).join("|")}>`);
  process.exit(2);
}

const rpc = process.env[chain.rpcEnv];
if (!rpc) {
  console.error(`FAIL  ${chain.rpcEnv} is not set. Export it, or pass it through the keystore.`);
  process.exit(1);
}

let failures = 0;
const pass = (msg) => console.log(`  ok    ${msg}`);
const fail = (msg) => {
  console.log(`  FAIL  ${msg}`);
  failures++;
};
const warn = (msg) => console.log(`  warn  ${msg}`);

async function rpcCall(method, params) {
  const res = await fetch(rpc, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const json = await res.json();
  if (json.error) throw new Error(`${method}: ${json.error.message}`);
  return json.result;
}

const isZero = (addr) => /^0x0{40}$/i.test(addr);

async function hasCode(addr) {
  const code = await rpcCall("eth_getCode", [addr, "latest"]);
  return code && code !== "0x";
}

// --- bytecode budget, from the local artifacts -------------------------------------

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

async function routerSize() {
  for await (const file of walk("artifacts")) {
    let artifact;
    try {
      artifact = JSON.parse(await readFile(file, "utf8"));
    } catch {
      continue;
    }
    if (artifact.contractName !== "GlasshouseRouter") continue;
    const bytecode = artifact.deployedBytecode?.object ?? artifact.deployedBytecode;
    if (typeof bytecode !== "string") continue;
    return (bytecode.replace(/^0x/, "").length / 2) | 0;
  }
  return null;
}

// --- run ---------------------------------------------------------------------------

console.log(`\npreflight: ${chain.name} (chain ${chainId})\n`);

const params = JSON.parse(await readFile(`ignition/parameters/chain-${chainId}.json`, "utf8")).$global;

const reported = await rpcCall("eth_chainId", []);
if (parseInt(reported, 16) === Number(chainId)) pass(`RPC reports chain ${chainId}`);
else fail(`RPC reports chain ${parseInt(reported, 16)}, expected ${chainId} -- wrong endpoint`);

if (isZero(params.owner)) {
  fail("owner is the zero address. Set it to the deployer before deploying.");
} else if (await hasCode(params.owner)) {
  warn(`owner ${params.owner} is a contract. Intended?`);
} else {
  const wei = BigInt(await rpcCall("eth_getBalance", [params.owner, "latest"]));
  const eth = Number(wei) / 1e18;
  if (wei === 0n) fail(`owner ${params.owner} has no ETH on ${chain.name}`);
  else pass(`owner ${params.owner} holds ${eth.toFixed(6)} ETH`);
}

if (await hasCode(params.weth)) pass(`WETH ${params.weth} has code`);
else fail(`WETH ${params.weth} has NO CODE on ${chain.name}`);

if (chain.needsAqua) {
  if (isZero(params.aqua)) {
    fail("aqua is the zero address, but this chain is meant to use the real Aqua.");
  } else if (await hasCode(params.aqua)) {
    pass(`Aqua ${params.aqua} has code`);
  } else {
    fail(`Aqua ${params.aqua} has NO CODE on ${chain.name}. Do not deploy against it.`);
  }
} else if (isZero(params.aqua)) {
  pass("aqua is zero, as intended: signature mode, no Aqua on this chain");
}

const size = await routerSize();
if (size === null) warn("no GlasshouseRouter artifact found. Run `npm run build` first.");
else if (size > LIMIT) fail(`GlasshouseRouter is ${size} B, over the EIP-170 limit of ${LIMIT}`);
else pass(`GlasshouseRouter is ${size} B, ${LIMIT - size} under the limit`);

console.log("");
if (failures > 0) {
  console.log(`${failures} check(s) failed. Do not deploy.\n`);
  process.exit(1);
}
console.log("All checks passed. Safe to deploy.\n");
