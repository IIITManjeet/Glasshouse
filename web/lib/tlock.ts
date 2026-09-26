// Timelock sealed bids: encrypt a bid to a future drand round, open it with that round's
// signature.
//
// WHAT THIS FILE IS FOR. A v2 commit can carry, beside its commitment, a 160-byte
// ciphertext of the bid's salt encrypted to a drand quicknet round at or after the end of
// the commit phase (docs/design/v2.md §3.4, §4). Once that round is published, anyone --
// the keeper, a visitor, the maker -- can decrypt it and call `revealFor`. The contract
// never reads the bytes; it checks the plaintext against the commitment exactly as v1
// does, so a wrong decryption cannot open anybody's bid, only fail to.
//
// THE SCHEME IS tlock's IBE, NOT tlock's FILE FORMAT. `tlock` proper wraps a random age file
// key in Boneh-Franklin IBE and encrypts the payload with ChaCha20-Poly1305. A bid is 35
// bytes and fits in one hash, so this file does the IBE step alone on a 32-byte plaintext:
// the salt, with `bps` in its top three bytes (§4.4). The bytes are `U || V || W`, which is
// the body of a tlock age stanza byte for byte, so any tlock implementation's IBE can open
// them. test/js/tlock.test.js holds that to vectors produced by the reference `tlock-js`, in
// both directions: a domain-separation slip here would give ciphertexts only Glasshouse can
// open, which is worse than none.
//
// THE CONSTANTS ARE PINNED, NOT FETCHED. A mirror that served a different public key could
// make every ciphertext undecryptable by the real network. config/drand.json holds the same
// values with the live source they were checked against; the test asserts the two agree and
// that the chain hash below is the sha256 of the other fields, so no one field can be
// mistyped without a failure. They are restated here, not imported, because the web app's
// bundler root is web/ and cannot reach config/ (see next.config.mjs, `turbopack.root`).
//
// TYPED, NO BUILD STEP. Only erasable syntax, so `node --test` and the keeper load this file
// directly, as they do chain.ts and bid.ts. The only libraries are @noble/curves and
// @noble/hashes: BLS12-381 arithmetic is not something to write by hand.

import { bls12_381 } from "@noble/curves/bls12-381.js";
import type { Fp12 } from "@noble/curves/abstract/tower.js";
import { sha256 } from "@noble/hashes/sha2.js";

// --- the network ---------------------------------------------------------------------

/**
 * drand quicknet, as served by `/<chainHash>/info` on every mirror below (config/drand.json
 * records when and where each value was checked). Signatures are in G1 (48 bytes), the
 * public key in G2 (96 bytes), and each round signs its round number alone ("unchained"),
 * so a ciphertext to round r needs only round r's signature to open.
 */
export const chainInfo = Object.freeze({
  chainHash: "52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971",
  publicKey:
    "83cf0f2896adee7eb8b5f01fcad3912212c437e0073e911fb90022d3e760183c8c4b450b6a0a6c3ac6a5776a2d1064510d1fec758c921cc22b0e17e63aaf4bcb5ed66304de9cf809bd274ca73bab4af5a6e9c76a4bc09e76eae8991ef5ece45a",
  genesisTime: 1692803367,
  period: 3,
  groupHash: "f477d5c89f21a17c863a7f937c6a6d15859414d2be09cd448d4279af331c5d3e",
  schemeID: "bls-unchained-g1-rfc9380",
  beaconID: "quicknet",
});

/** Public HTTP mirrors, all serving the chain hash above. A mirror is only ever trusted to
 *  be available: every signature it returns is checked against the pinned key. */
export const MIRRORS: readonly string[] = Object.freeze([
  "https://api.drand.sh",
  "https://api2.drand.sh",
  "https://api3.drand.sh",
  "https://drand.cloudflare.com",
]);

/**
 * The tags, copied from tlock-js 0.9.0 `crypto/ibe.js` (`encryptOnG2RFC9380`, `gtToHash`,
 * `h3`, `h4`) and proved by the interop vectors rather than by this comment.
 *
 * H1 is hash-to-curve on G1 per RFC 9380 with drand's signature DST: the IBE identity for
 * round r is the very point the network signs, which is why its signature is the key.
 * H2..H4 are not RFC 9380 DSTs but plain sha256 prefixes, as in drand/kyber's ibe.go.
 */
export const DST = Object.freeze({
  H1: "BLS_SIG_BLS12381G1_XMD:SHA-256_SSWU_RO_NUL_",
  H2: "IBE-H2",
  H3: "IBE-H3",
  H4: "IBE-H4",
});

/** U (a compressed G2 point) || V (32) || W (32). The Book's TLOCK_CIPHERTEXT_LEN. */
export const CIPHERTEXT_LEN = 160;
export const PLAINTEXT_LEN = 32;
export const SIGNATURE_LEN = 48;
const U_LEN = 96;

// --- errors --------------------------------------------------------------------------

export type TlockErrorCode =
  /** A length, a round number or a hex string that cannot be what the caller meant. */
  | "bad-input"
  /** The ciphertext did not open with this signature: wrong round, wrong network, or
   *  bytes that were never a ciphertext. Nothing distinguishes these, by design of IBE. */
  | "decrypt-failed"
  /** No mirror returned a signature for the round that verifies against the pinned key. */
  | "unavailable";

export class TlockError extends Error {
  declare code: TlockErrorCode;
  [extra: string]: unknown;

  constructor(code: TlockErrorCode, message: string, extra: Record<string, unknown> = {}) {
    super(message);
    this.name = "TlockError";
    this.code = code;
    Object.assign(this, extra);
  }
}

function fail(code: TlockErrorCode, message: string, extra?: Record<string, unknown>): never {
  throw new TlockError(code, message, extra);
}

// --- rounds --------------------------------------------------------------------------

/**
 * The round current at unix time `timestamp` (seconds): drand's own
 * `floor((t - genesis) / period) + 1`, the same as drand-client's `roundAt` and Go tlock's
 * `network.RoundNumber`. Round r is published at `timeOfRound(r)`, which is at or before
 * `timestamp`: a ciphertext to `roundAt(T)` can be opened from somewhere in (T - period, T].
 */
export function roundAt(timestamp: number): number {
  if (!Number.isFinite(timestamp)) fail("bad-input", `A timestamp must be a number of seconds, not ${timestamp}.`);
  if (timestamp < chainInfo.genesisTime) {
    fail("bad-input", `${timestamp} is before quicknet's genesis (${chainInfo.genesisTime}); there is no round then.`);
  }
  return Math.floor((timestamp - chainInfo.genesisTime) / chainInfo.period) + 1;
}

/** The unix time (seconds) at which round `round` is published. */
export function timeOfRound(round: number): number {
  assertRound(round);
  return chainInfo.genesisTime + (round - 1) * chainInfo.period;
}

function assertRound(round: number): void {
  if (!Number.isSafeInteger(round) || round < 1) {
    fail("bad-input", `A drand round is a whole number from 1 up, not ${round}.`);
  }
}

// --- bytes ---------------------------------------------------------------------------

/** What a byte string can arrive as: bytes, or hex with or without 0x (event data, JSON). */
export type Bytesish = Uint8Array | string;

function bytes(input: Bytesish, len: number, what: string): Uint8Array {
  let out: Uint8Array;
  if (typeof input === "string") {
    const h = input.replace(/^0x/, "");
    if (h.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(h)) fail("bad-input", `The ${what} is not a hex string.`);
    out = new Uint8Array(h.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(2 * i, 2 * i + 2), 16);
  } else {
    out = input;
  }
  if (out.length !== len) fail("bad-input", `The ${what} must be ${len} bytes, not ${out.length}.`, { length: out.length });
  return out;
}

const concat = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

const xor = (a: Uint8Array, b: Uint8Array): Uint8Array => a.map((x, i) => x ^ b[i]);
const ascii = (s: string): Uint8Array => new TextEncoder().encode(s);

// --- the IBE hashes ------------------------------------------------------------------

const { G1, G2, fields } = bls12_381;
const Fr = fields.Fr;

/** H1: the G1 point round `round` is signed over. The signed message is
 *  sha256(uint64_be(round)), unchained (§4.1). */
function roundPoint(round: number) {
  const be = new Uint8Array(8);
  new DataView(be.buffer).setBigUint64(0, BigInt(round));
  return G1.hashToCurve(sha256(be), { DST: DST.H1 });
}

/** The 576 bytes of a GT element as kyber (and so tlock) writes them: every Fp coefficient
 *  big-endian, highest tower coefficient first -- Fp12 (c1, c0), Fp6 (c2, c1, c0),
 *  Fp2 (c1, c0). Noble has no serialiser in that order; this is tlock-js's `fp12ToBytes`. */
function gtBytes(gt: Fp12): Uint8Array {
  const fp = (x: bigint) => bytes(x.toString(16).padStart(96, "0"), 48, "field element");
  const parts: Uint8Array[] = [];
  for (const f6 of [gt.c1, gt.c0]) {
    for (const f2 of [f6.c2, f6.c1, f6.c0]) parts.push(fp(f2.c1), fp(f2.c0));
  }
  return concat(...parts);
}

/** H2: GT -> 32 bytes. */
const h2 = (gt: Fp12): Uint8Array => sha256(concat(ascii(DST.H2), gtBytes(gt)));

/** H3: (sigma, msg) -> a non-zero scalar, by kyber's rejection sampling: hash once, then
 *  hash `uint16_le(i) || that` for i = 1.. with the top bit cleared until it is below r. */
function h3(sigma: Uint8Array, msg: Uint8Array): bigint {
  const seed = sha256(concat(ascii(DST.H3), sigma, msg));
  for (let i = 1; i < 65535; i++) {
    const d = sha256(concat(new Uint8Array([i & 0xff, i >> 8]), seed));
    d[0] >>= 1;
    const n = BigInt("0x" + Array.from(d, (b) => b.toString(16).padStart(2, "0")).join(""));
    if (n > 0n && n < Fr.ORDER) return n;
  }
  return fail("decrypt-failed", "H3 found no scalar, which does not happen for honest input.");
}

/** H4: sigma -> 32 bytes. */
const h4 = (sigma: Uint8Array): Uint8Array => sha256(concat(ascii(DST.H4), sigma));

// --- encrypt / decrypt ---------------------------------------------------------------

/**
 * Encrypt a 32-byte plaintext so it opens only with round `round`'s signature.
 *
 * `sigma` is the IBE's per-ciphertext randomness and must be fresh and secret: anyone who
 * learns it can decrypt without drand. It is a parameter ONLY so the tests can reproduce a
 * vector byte for byte; production callers leave it out and get 32 bytes from
 * crypto.getRandomValues.
 */
export function encrypt(round: number, plaintext32: Bytesish, sigma?: Bytesish): Uint8Array {
  assertRound(round);
  const msg = bytes(plaintext32, PLAINTEXT_LEN, "plaintext");
  const s = sigma === undefined ? crypto.getRandomValues(new Uint8Array(PLAINTEXT_LEN)) : bytes(sigma, PLAINTEXT_LEN, "sigma");

  const pk = G2.Point.fromBytes(bytes(chainInfo.publicKey, 96, "public key"));
  const gid = bls12_381.pairing(roundPoint(round), pk); // e(H1(round), pk)
  const r = h3(s, msg);
  const U = G2.Point.BASE.multiply(r);
  const V = xor(s, h2(fields.Fp12.pow(gid, r)));
  const W = xor(msg, h4(s));
  return concat(U.toBytes(true), V, W);
}

/**
 * Open a ciphertext with the signature of the round it was sealed to. Throws
 * `decrypt-failed` when the signature is not that round's (or the bytes are not a
 * ciphertext): the recovered randomness must re-derive U exactly, so a wrong key cannot
 * yield a plausible-looking plaintext.
 */
export function decrypt(signature48: Bytesish, ciphertext160: Bytesish): Uint8Array {
  const sig = bytes(signature48, SIGNATURE_LEN, "signature");
  const ct = bytes(ciphertext160, CIPHERTEXT_LEN, "ciphertext");

  let sigPoint, U;
  try {
    sigPoint = G1.Point.fromBytes(sig);
    U = G2.Point.fromBytes(ct.subarray(0, U_LEN));
  } catch (cause) {
    return fail("decrypt-failed", "The signature or the ciphertext is not a valid curve point.", { cause });
  }
  const V = ct.subarray(U_LEN, U_LEN + 32);
  const W = ct.subarray(U_LEN + 32);

  const sigma = xor(V, h2(bls12_381.pairing(sigPoint, U))); // e(sig, U) = e(H1, pk)^r
  const msg = xor(W, h4(sigma));
  if (!G2.Point.BASE.multiply(h3(sigma, msg)).equals(U)) {
    fail("decrypt-failed", "This signature does not open this ciphertext. It is for another round, or the bytes were never sealed to one.");
  }
  return msg;
}

// --- beacons -------------------------------------------------------------------------

/** True if `signature48` is quicknet's signature for `round` under the pinned key. One
 *  pairing check; this is what makes a mirror untrusted. */
export function verifySignature(round: number, signature48: Bytesish): boolean {
  assertRound(round);
  try {
    const sig = G1.Point.fromBytes(bytes(signature48, SIGNATURE_LEN, "signature"));
    const pk = G2.Point.fromBytes(bytes(chainInfo.publicKey, 96, "public key"));
    return bls12_381.shortSignatures.verify(sig, roundPoint(round), pk);
  } catch {
    return false;
  }
}

export type FetchLike = (url: string) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/**
 * Round `round`'s signature, from the first mirror that returns one that verifies. A mirror
 * that is down, early (drand answers 425 before a round exists), or lying is skipped, and
 * if none answers honestly this throws `unavailable` -- the caller's cue that bidders must
 * self-reveal (§4.2), not a reason to try a signature nobody checked.
 */
export async function fetchSignature(
  round: number,
  { mirrors = MIRRORS, fetch: get = globalThis.fetch as FetchLike }: { mirrors?: readonly string[]; fetch?: FetchLike } = {},
): Promise<Uint8Array> {
  assertRound(round);
  const tried: string[] = [];
  for (const base of mirrors) {
    const url = `${base.replace(/\/$/, "")}/${chainInfo.chainHash}/public/${round}`;
    try {
      const res = await get(url);
      if (!res.ok) {
        tried.push(`${base}: HTTP ${res.status}`);
        continue;
      }
      const body = (await res.json()) as { round?: unknown; signature?: unknown };
      if (Number(body.round) !== round || typeof body.signature !== "string") {
        tried.push(`${base}: answered for another round`);
        continue;
      }
      if (!verifySignature(round, body.signature)) {
        tried.push(`${base}: signature does not verify`);
        continue;
      }
      return bytes(body.signature, SIGNATURE_LEN, "signature");
    } catch (cause) {
      tried.push(`${base}: ${(cause as Error)?.message ?? cause}`);
    }
  }
  return fail("unavailable", `No drand mirror returned a valid signature for round ${round}.`, { round, tried });
}
