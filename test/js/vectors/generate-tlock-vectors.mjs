#!/usr/bin/env node
// Generate test/js/vectors/tlock-js.json: interop vectors between web/lib/tlock.ts and the
// reference tlock-js, run ONCE and checked in.
//
// Reproduce, from the repo root:
//
//   npm install --no-save tlock-js@0.9.0
//   node test/js/vectors/generate-tlock-vectors.mjs
//
// tlock-js is deliberately not a dependency: it is needed only here, it pulls in a second
// copy of @noble/curves (1.x) and a drand client, and the checked-in vectors are what the
// test suite runs against. Network: read-only GETs to api.drand.sh for two past rounds'
// signatures and the chain info.
//
// What it proves, in both directions, on the real quicknet key and real signatures:
//   * tlock-js -> Glasshouse: tlock-js's own `encryptOnG2RFC9380` (the function
//     `timelockEncrypt` calls for scheme bls-unchained-g1-rfc9380) seals messages; the test
//     opens them with tlock.ts `decrypt`.
//   * Glasshouse -> tlock-js: tlock.ts `encrypt`, with a fixed sigma, seals messages; this
//     script opens each with tlock-js's `decryptOnG2` and refuses to write the file unless
//     every one comes back intact. The test re-encrypts with the same sigma and demands the
//     same bytes, so tlock.ts can never drift from ciphertexts tlock-js is known to open.
//   * round arithmetic: drand-client's `roundAt` / `roundTime` (as re-exported by tlock-js)
//     for a spread of timestamps.

import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { randomBytes } from "node:crypto";

import { encrypt, chainInfo, verifySignature } from "../../../web/lib/tlock.ts";

const require = createRequire(import.meta.url);
const ibe = require("tlock-js/crypto/ibe");
const { hashedRoundNumber } = require("tlock-js/drand/timelock-encrypter");
const tlock = require("tlock-js");
const tlockVersion = require("tlock-js/package.json").version;
// The curve library tlock-js actually ran on (its nested copy, not ours). Read off disk
// because noble 1.x does not export ./package.json.
const noble1 = JSON.parse(
  readFileSync(new URL("node_modules/@noble/curves/package.json", pathToFileURL(require.resolve("tlock-js/package.json"))), "utf8"),
).version;

const hex = (b) => Buffer.from(b).toString("hex");
const API = "https://api.drand.sh";

async function get(path) {
  const res = await fetch(`${API}/${chainInfo.chainHash}${path}`);
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json();
}

const info = await get("/info");
for (const [k, v] of [
  ["public_key", chainInfo.publicKey],
  ["genesis_time", chainInfo.genesisTime],
  ["period", chainInfo.period],
  ["schemeID", chainInfo.schemeID],
  ["hash", chainInfo.chainHash],
]) {
  if (info[k] !== v) throw new Error(`live chain info ${k} = ${info[k]}, tlock.ts pins ${v}`);
}

// Two adjacent past rounds: one to seal to, and its neighbour as the wrong key.
const ROUNDS = [1000000, 1000001];
const signatures = {};
for (const r of ROUNDS) {
  const b = await get(`/public/${r}`);
  if (b.round !== r || !verifySignature(r, b.signature)) throw new Error(`round ${r}: bad beacon`);
  signatures[r] = b.signature;
}
const round = ROUNDS[0];
const pk = Buffer.from(chainInfo.publicKey, "hex");
const split = (ct) => ({ U: ct.subarray(0, 96), V: ct.subarray(96, 128), W: ct.subarray(128) });

const messages = [
  Buffer.alloc(32, 0),
  Buffer.alloc(32, 0xff),
  // A bid salt as §4.4 packs it: bps = 250 in the top three bytes, 29 random bytes below.
  Buffer.concat([Buffer.from([0x00, 0x00, 0xfa]), randomBytes(29)]),
  randomBytes(32),
];

const fromTlockJs = [];
for (const m of messages) {
  const c = await ibe.encryptOnG2RFC9380(pk, hashedRoundNumber(round), m);
  fromTlockJs.push({ round, plaintext: hex(m), ciphertext: hex(Buffer.concat([c.U, c.V, c.W])) });
}

const toTlockJs = [];
for (const m of messages) {
  const sigma = randomBytes(32);
  const ct = Buffer.from(encrypt(round, m, sigma));
  const opened = await ibe.decryptOnG2(Buffer.from(signatures[round], "hex"), split(ct));
  if (!Buffer.from(opened).equals(m)) throw new Error("tlock-js could not open a tlock.ts ciphertext");
  toTlockJs.push({ round, plaintext: hex(m), sigma: hex(sigma), ciphertext: hex(ct), openedByTlockJs: true });
}

const rounds = [chainInfo.genesisTime, chainInfo.genesisTime + 2, chainInfo.genesisTime + 3, 1789481397, 1790000000, 1790000001, 1790000002, 2000000000].map(
  (t) => ({ timestamp: t, round: tlock.roundAt(t * 1000, info), roundTime: tlock.roundTime(info, tlock.roundAt(t * 1000, info)) / 1000 }),
);

const out = {
  generatedBy: "test/js/vectors/generate-tlock-vectors.mjs",
  command: "npm install --no-save tlock-js@0.9.0 && node test/js/vectors/generate-tlock-vectors.mjs",
  generatedAt: new Date().toISOString().slice(0, 10),
  tlockJs: tlockVersion,
  tlockJsNobleCurves: noble1,
  source: `${API}/${chainInfo.chainHash}/public/<round>`,
  chainHash: chainInfo.chainHash,
  signatures,
  fromTlockJs,
  toTlockJs,
  rounds,
};
writeFileSync(new URL("./tlock-js.json", import.meta.url), JSON.stringify(out, null, 2) + "\n");
console.log(`wrote ${fromTlockJs.length} + ${toTlockJs.length} vectors, ${rounds.length} round checks (tlock-js ${tlockVersion})`);
