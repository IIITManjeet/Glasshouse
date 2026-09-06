#!/usr/bin/env node
// Verify a deployer private key WITHOUT printing it or storing it anywhere.
//
// Reads the key from stdin, reports only its length and the address it derives, and
// compares that against the `owner` in the Base parameter file. The key itself is never
// echoed, logged or written.
//
// RUN THIS IN YOUR OWN TERMINAL, not through the `!` prefix -- anything typed into a `!`
// command may end up in the conversation transcript.
//
//   node scripts/check-key.mjs
//   (paste the key, press enter)

import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { addr } from "micro-eth-signer";

const params = JSON.parse(await readFile("ignition/parameters/chain-8453.json", "utf8")).$global;
const expected = params.owner.toLowerCase();

const rl = createInterface({ input: process.stdin, terminal: false });
process.stdout.write("Paste the private key and press enter (it will not be echoed back):\n");

const key = await new Promise((resolve) => rl.once("line", (l) => resolve(l)));
rl.close();

const trimmed = key.trim().replace(/^["']|["']$/g, "");
const body = trimmed.startsWith("0x") || trimmed.startsWith("0X") ? trimmed.slice(2) : trimmed;

console.log("");

// The single most likely mistake, called out by name: an address is 20 bytes and a
// private key is 32, and both are "a 0x hex string from my wallet".
if (body.length === 40) {
  console.log("  *** THIS IS AN ADDRESS, NOT A PRIVATE KEY. ***");
  console.log("");
  console.log("  An address is 20 bytes / 40 hex characters and is public.");
  console.log("  A private key is 32 bytes / 64 hex characters and is secret.");
  console.log("");
  console.log("  In MetaMask: the three dots next to the account name ->");
  console.log("  Account details -> Show private key. It asks for your password.");
  console.log("");
  process.exit(1);
}

console.log(`  characters after 0x   ${body.length}   ${body.length === 64 ? "ok" : "SHOULD BE 64"}`);
console.log(`  has 0x prefix         ${trimmed.startsWith("0x") ? "yes" : "no  <- hardhat wants it"}`);
console.log(`  hex only              ${/^[0-9a-fA-F]*$/.test(body) ? "yes" : "NO  <- stray characters"}`);
if (trimmed !== key.trim()) console.log("  had surrounding quotes: yes  <- store it without quotes");
if (key !== key.trim()) console.log("  had leading/trailing whitespace: yes");

if (body.length === 64 && /^[0-9a-fA-F]+$/.test(body)) {
  const derived = addr.fromPrivateKey(`0x${body}`).toLowerCase();
  console.log("");
  console.log(`  derives address       ${derived}`);
  console.log(`  parameter file owner  ${expected}`);
  console.log(`  match                 ${derived === expected ? "YES" : "NO -- this is a different account"}`);
}
console.log("");
console.log("  Store it with:  npx hardhat keystore set DEPLOYER_PRIVATE_KEY");
console.log("  Paste 0x followed by the 64 hex characters. No quotes, no spaces.");
console.log("");
