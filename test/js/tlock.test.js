import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

import {
  CIPHERTEXT_LEN,
  DST,
  MIRRORS,
  TlockError,
  chainInfo,
  decrypt,
  encrypt,
  fetchSignature,
  roundAt,
  timeOfRound,
  verifySignature,
} from "../../web/lib/tlock.ts";

/**
 * TIMELOCK, CHECKED AGAINST THE REFERENCE RATHER THAN AGAINST ITSELF.
 *
 * A round trip through tlock.ts alone proves nothing about the thing that matters: that a
 * ciphertext posted by one client can be opened by any other drand-aware tool, and that
 * tlock.ts can open theirs. A wrong domain-separation tag or a byte-order slip in the GT
 * serialisation would round-trip perfectly here and be unopenable everywhere else. So the
 * core of this file is test/js/vectors/tlock-js.json, produced once by the reference
 * tlock-js 0.9.0 on quicknet's real key and two real signatures (the command is in the
 * file and in generate-tlock-vectors.mjs). It runs offline; nothing here is skipped.
 *
 * Also pinned: that tlock.ts's constants are config/drand.json's, and that the chain hash is
 * derived from the rest, so a mistyped key or genesis cannot pass.
 */

const json = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), "utf8"));
const VEC = json("./vectors/tlock-js.json");
const DRAND = json("../../config/drand.json");
const AUCTION = json("../../config/auction.json");

const hex = (b) => Buffer.from(b).toString("hex");
const sigOf = (round) => VEC.signatures[String(round)];
const SEALED = 1000000; // the round every vector is sealed to
const NEIGHBOUR = 1000001; // the wrong key

const rejects = (code) => (err) => err instanceof TlockError && err.code === code;

// --- the network ---------------------------------------------------------------------

test("tlock.ts pins exactly the network config/drand.json records", () => {
  assert.equal(chainInfo.chainHash, DRAND.chainHash);
  assert.equal(chainInfo.publicKey, DRAND.publicKey);
  assert.equal(chainInfo.genesisTime, DRAND.genesisTime);
  assert.equal(chainInfo.period, DRAND.period);
  assert.equal(chainInfo.groupHash, DRAND.groupHash);
  assert.equal(chainInfo.schemeID, DRAND.schemeID);
  assert.equal(chainInfo.beaconID, DRAND.beaconID);
  assert.deepEqual([...MIRRORS], DRAND.mirrors);
  assert.equal(VEC.chainHash, chainInfo.chainHash, "the vectors were made on this chain");
});

test("the chain hash is the sha256 of the other fields, so none of them can be mistyped", () => {
  // drand's Info.Hash(): uint32_be(period) || int64_be(genesis) || pk || genesis seed || beacon id.
  const period = Buffer.alloc(4);
  period.writeUInt32BE(chainInfo.period);
  const genesis = Buffer.alloc(8);
  genesis.writeBigInt64BE(BigInt(chainInfo.genesisTime));
  const h = createHash("sha256")
    .update(Buffer.concat([period, genesis, Buffer.from(chainInfo.publicKey, "hex"), Buffer.from(chainInfo.groupHash, "hex"), Buffer.from(chainInfo.beaconID)]))
    .digest("hex");
  assert.equal(h, chainInfo.chainHash);
});

test("config/auction.json's tlock block points at config/drand.json, and timelock is on by default", () => {
  assert.equal(AUCTION.tlock.drand, "config/drand.json");
  assert.ok(existsSync(new URL(`../../${AUCTION.tlock.drand}`, import.meta.url)));
  assert.equal(AUCTION.tlock.defaultOn, true, "D-v2-6: on by default in every client");
});

test("the H1 tag is drand's G1 signature DST: the fixture signatures verify under the pinned key", () => {
  assert.equal(DST.H1, "BLS_SIG_BLS12381G1_XMD:SHA-256_SSWU_RO_NUL_");
  assert.equal(verifySignature(SEALED, sigOf(SEALED)), true);
  assert.equal(verifySignature(NEIGHBOUR, sigOf(NEIGHBOUR)), true);
  assert.equal(verifySignature(SEALED, sigOf(NEIGHBOUR)), false, "a signature is for one round only");
  assert.equal(verifySignature(SEALED, "00".repeat(48)), false, "garbage is false, not a throw");
});

// --- rounds --------------------------------------------------------------------------

test("roundAt matches the live beacon at the two wall-clock readings recorded", () => {
  // docs/design/v2.md section 4.1 (2026-09-15) and config/drand.json verified.roundCheck.
  assert.equal(roundAt(1789481397), 32226011);
  assert.equal(roundAt(1790363598), 32520078);
});

test("roundAt and timeOfRound agree with drand-client's roundAt and roundTime", () => {
  assert.ok(VEC.rounds.length >= 5);
  for (const { timestamp, round, roundTime } of VEC.rounds) {
    assert.equal(roundAt(timestamp), round, `roundAt(${timestamp})`);
    assert.equal(timeOfRound(round), roundTime, `timeOfRound(${round})`);
  }
});

test("round r is current from timeOfRound(r) until the next one, and not a second before", () => {
  for (const r of [1, 2, 1000000, 32520078]) {
    const t = timeOfRound(r);
    assert.equal(roundAt(t), r);
    assert.equal(roundAt(t + chainInfo.period - 1), r);
    assert.equal(roundAt(t + chainInfo.period), r + 1);
    if (r > 1) assert.equal(roundAt(t - 1), r - 1);
  }
});

test("there is no round before genesis, and no round zero", () => {
  assert.throws(() => roundAt(chainInfo.genesisTime - 1), rejects("bad-input"));
  assert.throws(() => roundAt(NaN), rejects("bad-input"));
  assert.throws(() => timeOfRound(0), rejects("bad-input"));
  assert.throws(() => timeOfRound(1.5), rejects("bad-input"));
  assert.throws(() => encrypt(0, new Uint8Array(32)), rejects("bad-input"));
});

test("each parameter set's margin M opens bids after commits close and leaves the reveal time section 4.3 promises", () => {
  // T = timestamp(commitEnd + 1). Any T will do for the arithmetic; take one mid-period and
  // one on a round boundary, since roundAt(T + M) may be published up to period - 1 early.
  for (const set of ["humanDemo", "advocated"]) {
    const m = DRAND.margins[set];
    const window = AUCTION[set].revealBlocks * AUCTION.basis.blockSeconds;
    assert.equal(m.revealWindowSeconds, window, `${set}: reveal window`);
    assert.equal(m.secondsLeftToReveal, window - m.M, `${set}: time left`);
    assert.equal(m.roundsOfMargin, m.M / chainInfo.period, `${set}: rounds of margin`);
    for (const T of [timeOfRound(32520078), timeOfRound(32520078) + 1, timeOfRound(32520078) + 2]) {
      const opensAt = timeOfRound(roundAt(T + m.M));
      assert.ok(opensAt > T, `${set}: opens after the commit phase closes`);
      assert.ok(opensAt <= T + m.M && opensAt >= T + m.M - (chainInfo.period - 1), `${set}: within the stated margin`);
    }
  }
});

// --- encrypt / decrypt ---------------------------------------------------------------

test("round trip: what encrypt seals to a round, that round's signature opens", () => {
  for (let i = 0; i < 3; i++) {
    const msg = crypto.getRandomValues(new Uint8Array(32));
    const ct = encrypt(SEALED, msg);
    assert.equal(ct.length, CIPHERTEXT_LEN);
    assert.equal(hex(decrypt(sigOf(SEALED), ct)), hex(msg));
  }
});

test("hex in, with or without 0x, is the same as bytes in", () => {
  const { plaintext, ciphertext } = VEC.fromTlockJs[0];
  assert.equal(hex(decrypt("0x" + sigOf(SEALED), "0x" + ciphertext)), plaintext);
  assert.equal(hex(decrypt(Buffer.from(sigOf(SEALED), "hex"), Buffer.from(ciphertext, "hex"))), plaintext);
});

test("interop: every ciphertext tlock-js sealed opens here, byte for byte", () => {
  assert.equal(VEC.tlockJs, "0.9.0");
  assert.ok(VEC.fromTlockJs.length >= 4, "the vectors are present");
  for (const v of VEC.fromTlockJs) {
    assert.equal(v.round, SEALED);
    assert.equal(hex(decrypt(sigOf(v.round), v.ciphertext)), v.plaintext);
  }
});

test("interop: encrypt reproduces, byte for byte, the ciphertexts tlock-js was shown to open", () => {
  // Each of these was opened by tlock-js's decryptOnG2 when the vectors were generated; the
  // generator refuses to write the file otherwise. Same round, plaintext and sigma must give
  // the same bytes, so any drift in H1..H4 or the U/V/W layout fails here.
  assert.ok(VEC.toTlockJs.length >= 4, "the vectors are present");
  for (const v of VEC.toTlockJs) {
    assert.equal(v.openedByTlockJs, true);
    assert.equal(hex(encrypt(v.round, v.plaintext, v.sigma)), v.ciphertext);
    assert.equal(hex(decrypt(sigOf(v.round), v.ciphertext)), v.plaintext);
  }
});

test("the §4.4 bid convention survives the trip: bps comes back out of the salt's top three bytes", () => {
  const packed = VEC.fromTlockJs.find((v) => v.plaintext.startsWith("0000fa"));
  const salt = decrypt(sigOf(SEALED), packed.ciphertext);
  assert.equal((salt[0] << 16) | (salt[1] << 8) | salt[2], 250);
});

test("the wrong round's signature fails the U = H3(sigma, msg) * G2 check, for either implementation's ciphertexts", () => {
  for (const v of [...VEC.fromTlockJs, ...VEC.toTlockJs]) {
    assert.throws(() => decrypt(sigOf(NEIGHBOUR), v.ciphertext), rejects("decrypt-failed"));
  }
});

test("a tampered ciphertext does not open to a different plaintext; it does not open at all", () => {
  const { ciphertext } = VEC.fromTlockJs[3];
  for (const at of [100, 140, 159]) {
    const b = Buffer.from(ciphertext, "hex");
    b[at] ^= 1;
    assert.throws(() => decrypt(sigOf(SEALED), b), rejects("decrypt-failed"), `byte ${at}`);
  }
  const u = Buffer.from(ciphertext, "hex");
  u[5] ^= 1; // U is no longer a curve point
  assert.throws(() => decrypt(sigOf(SEALED), u), rejects("decrypt-failed"));
});

test("wrong lengths are refused before any curve arithmetic", () => {
  const { ciphertext } = VEC.fromTlockJs[0];
  assert.throws(() => encrypt(SEALED, new Uint8Array(31)), rejects("bad-input"));
  assert.throws(() => encrypt(SEALED, new Uint8Array(32), new Uint8Array(16)), rejects("bad-input"));
  assert.throws(() => decrypt(sigOf(SEALED), ciphertext.slice(0, -2)), rejects("bad-input"));
  assert.throws(() => decrypt(sigOf(SEALED).slice(2), ciphertext), rejects("bad-input"));
  assert.throws(() => decrypt("zz".repeat(48), ciphertext), rejects("bad-input"));
});

// --- beacons -------------------------------------------------------------------------

/** A stand-in for fetch: each mirror answers with whatever `answers` says, and every URL
 *  asked is recorded. */
function fakeFetch(answers) {
  const asked = [];
  const f = async (url) => {
    asked.push(url);
    const a = answers[new URL(url).origin];
    if (a instanceof Error) throw a;
    return { ok: a.status === 200, status: a.status, json: async () => a.body };
  };
  return { f, asked };
}

test("fetchSignature skips a mirror that is early, down or lying, and returns the first signature that verifies", async () => {
  const { f, asked } = fakeFetch({
    "https://a.test": { status: 425, body: {} },
    "https://b.test": new Error("ECONNRESET"),
    "https://c.test": { status: 200, body: { round: SEALED, signature: sigOf(NEIGHBOUR) } }, // hostile
    "https://d.test": { status: 200, body: { round: SEALED, signature: sigOf(SEALED) } },
  });
  const mirrors = ["https://a.test", "https://b.test", "https://c.test", "https://d.test"];
  const sig = await fetchSignature(SEALED, { mirrors, fetch: f });
  assert.equal(hex(sig), sigOf(SEALED));
  assert.equal(asked.length, 4);
  assert.equal(asked[3], `https://d.test/${chainInfo.chainHash}/public/${SEALED}`);
});

test("fetchSignature throws unavailable, listing why, when no mirror answers honestly", async () => {
  const { f } = fakeFetch({
    "https://a.test": { status: 200, body: { round: NEIGHBOUR, signature: sigOf(NEIGHBOUR) } },
    "https://b.test": { status: 200, body: { round: SEALED, signature: sigOf(NEIGHBOUR) } },
  });
  await assert.rejects(fetchSignature(SEALED, { mirrors: ["https://a.test", "https://b.test"], fetch: f }), (err) => {
    assert.ok(rejects("unavailable")(err));
    assert.equal(err.tried.length, 2);
    return true;
  });
});
