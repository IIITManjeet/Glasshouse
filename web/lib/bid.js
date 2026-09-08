// The wallet: connect, seal a bid, be held to the reveal deadline.
//
// WHAT THIS FILE IS FOR. Everything else in site/ reads. This is the only module that
// writes -- to the chain, and to localStorage. Both writes can cost a visitor money, and
// they cost it in opposite directions, so the whole file is arranged around one asymmetry:
//
//   a commit that is never revealed is a bid thrown away (and, when bond > 0, a bond the
//   maker may take -- GlasshouseBook.sol:329-342);
//   a reveal that arrives too late costs a cent of gas.
//
// So this module is eager about revealing and paranoid about committing. Concretely:
//   * the secret is in localStorage, and READ BACK, before the commit is ever offered to
//     the wallet (placeBid, step 3). If the tab dies between signing and the receipt, the
//     salt survives. This is the ENS-2017 failure mode and the single most important
//     ordering in the file;
//   * if storage is blocked, the commit is NOT sent. A sealed bid whose salt exists only
//     in a variable in a dead tab is unrevealable by anyone, including us;
//   * placeBid refuses a bps the reveal would reject. commit() does not range-check
//     (:155-175); reveal() does (:187). Committing 600 bps to a maxBps-500 round is a bid
//     that can never be revealed, and the contract will happily take it;
//   * placeBid refuses to overwrite a secret that is already on chain;
//   * revealBid never consults our own clock. Only the chain decides whether a reveal is
//     late (ui-flow.md section 6.5, cta-patterns.md section 4.8).
//
// NO LIBRARIES. Plain ESM, EIP-1193 over window.ethereum, fetch for RPC, calldata packed
// by hand. Same rules as site/chain.js, and the same rule about selectors: EVERY selector
// below was computed with `cast sig` from the signature in subgraph/abis/GlasshouseBook.json,
// never guessed, and each carries its signature in a comment. (Cross-check: this file's
// SEL_AUCTIONS agrees with the one chain.js:21 has been using in production.)
//
// KECCAK. There is none in the browser without a library, so the commitment is not
// computed here -- it is read from the contract's own `commitmentFor` (:111-113) by
// eth_call. That is not a workaround, it is the safer choice: the contract's comment at
// :106-110 says exactly why. Because a wrong commitment silently loses the bid, this file
// asks TWO independent nodes (the wallet's and the public RPC) and refuses to commit if
// they disagree.
//
// NO DOM. Not one line. The caller owns the DOM; this module owns the money.

import { phase } from "./phase.js";
import { decodeAuction, chainHead } from "./chain.js";

// --- configuration -----------------------------------------------------------------

export const BASE_CHAIN_ID = 8453;
export const BASE_CHAIN_ID_HEX = "0x2105";

const DEFAULTS = {
  book: "0xc4ea91Fe700918220423ac307C6B1c59650FFbfe",
  rpc: "https://mainnet.base.org",
  explorer: "https://basescan.org",
};

let cfg = { ...DEFAULTS };

/** Override the Book address or the read RPC (tests, a fork, a second deployment). */
export function configure(next = {}) {
  cfg = { ...cfg, ...next };
  return { ...cfg };
}

// --- selectors ---------------------------------------------------------------------
// `cast sig "<signature>"`, signatures from subgraph/abis/GlasshouseBook.json.

const SEL_COMMIT = "0xd2a51f15"; // commit(address,bytes32,bytes32)
const SEL_REVEAL = "0x71574f83"; // reveal(address,bytes32,uint24,bytes32)
const SEL_COMMITMENT_FOR = "0x9f863a14"; // commitmentFor(address,uint24,bytes32)
const SEL_AUCTIONS = "0xee5bcb62"; // auctions(address,bytes32)
const SEL_BIDS = "0xa078ed70"; // bids(address,bytes32,address)

// Reveal is the one call with a deadline, so it is sent with an explicit gas limit rather
// than waiting on the wallet's eth_estimateGas round trip -- and, more to the point, so
// that a failing estimate cannot refuse to send at all. reveal() writes at most four
// packed slots and emits one event; measured worst case is well under 150k. Unused gas is
// refunded, so overshooting costs nothing.
const REVEAL_GAS = "0x3d090"; // 250,000

const MAX_UINT24 = 16777215;

// --- typed errors ------------------------------------------------------------------

/**
 * Every throw from this module is a BidError with a stable `code`, so the caller can
 * switch on the code for the button state and use `explainRevert(e)` for the sentence.
 * `cause` keeps the original provider error; nothing is swallowed.
 */
export class BidError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.name = "BidError";
    this.code = code;
    Object.assign(this, extra);
  }
}

const fail = (code, message, extra) => {
  throw new BidError(code, message, extra);
};

// --- hex helpers -------------------------------------------------------------------
// Deliberately duplicated from chain.js rather than exported from it: chain.js is the
// read path and this is the write path, and a shared mutable surface between them buys
// nothing. They are four lines.

const strip = (h) => String(h).replace(/^0x/, "");
const pad32 = (h) => strip(h).toLowerCase().padStart(64, "0");
const word = (data, i) => strip(data).slice(i * 64, (i + 1) * 64);
const asInt = (w) => Number(BigInt("0x" + w));
const isZeroWord = (w) => /^0+$/.test(w);

const isAddress = (a) => typeof a === "string" && /^0x[0-9a-fA-F]{40}$/.test(a);
const isBytes32 = (h) => typeof h === "string" && /^0x[0-9a-fA-F]{64}$/.test(h);

function requireAddress(v, what) {
  if (!isAddress(v)) fail("BAD_ARGUMENT", `${what} must be a 20-byte address, got ${v}`);
  return v.toLowerCase();
}

function requireBytes32(v, what) {
  if (!isBytes32(v)) fail("BAD_ARGUMENT", `${what} must be a 32-byte hex string, got ${v}`);
  return v.toLowerCase();
}

// --- randomness --------------------------------------------------------------------

/**
 * 32 bytes from the CSPRNG. Never Math.random: the salt is the only thing standing
 * between a sealed bid and anyone who wants to guess it before the reveal window, and
 * Math.random is seeded predictably in every engine.
 *
 * If crypto.getRandomValues is missing (an insecure context, an ancient browser) this
 * throws rather than degrading. A weak salt in a sealed-bid auction is not a degraded
 * feature, it is a broken one.
 */
export function randomSalt() {
  const c = globalThis.crypto;
  if (!c || typeof c.getRandomValues !== "function") {
    fail(
      "NO_CSPRNG",
      "This browser has no crypto.getRandomValues, so a sealed bid cannot be generated safely. Open the page over https."
    );
  }
  const bytes = new Uint8Array(32);
  c.getRandomValues(bytes);
  let out = "0x";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

// --- the provider ------------------------------------------------------------------
// EIP-6963 multi-provider discovery is cut (ui-flow.md section 10: needs a library and a
// build). window.ethereum only; a visitor with two extensions gets whichever one won.

function provider() {
  const p = globalThis.ethereum;
  if (!p || typeof p.request !== "function") {
    fail(
      "NO_PROVIDER",
      "No browser wallet found. Bidding needs a wallet extension on Base; everything else on this page works without one."
    );
  }
  return p;
}

export function hasProvider() {
  const p = globalThis.ethereum;
  return !!(p && typeof p.request === "function");
}

/**
 * EIP-1193 request. The provider's error is deliberately NOT wrapped: revert decoding
 * needs the original `data` field, which every wrapper in this ecosystem puts somewhere
 * different. classifyRevert digs it back out.
 */
function request(method, params = []) {
  return provider().request({ method, params });
}

/** Promise with a deadline. Resolves to `fallback` rather than rejecting on timeout. */
function withBudget(promise, ms, fallback) {
  let timer;
  return Promise.race([
    promise.then(
      (v) => {
        clearTimeout(timer);
        return v;
      },
      (e) => {
        clearTimeout(timer);
        throw e;
      }
    ),
    new Promise((resolve) => {
      timer = setTimeout(() => resolve(fallback), ms);
    }),
  ]);
}

// --- reads -------------------------------------------------------------------------

/** eth_call over plain fetch, against the public RPC. Mirrors chain.js's transport. */
async function callViaRpc(to, data, at = "latest") {
  const res = await fetch(cfg.rpc, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to, data }, at] }),
  });
  const body = await res.json();
  if (body.error) {
    const e = new Error(body.error.message || "eth_call failed");
    e.code = body.error.code;
    e.data = body.error.data;
    throw e;
  }
  return body.result;
}

/** eth_call through the wallet's own node -- the node that will judge the transaction. */
async function callViaWallet(to, data, from) {
  const params = from ? { to, data, from } : { to, data };
  return request("eth_call", [params, "latest"]);
}

/**
 * The auction struct, decoded by chain.js's decoder so the read path and the write path
 * can never disagree about field order. Returns null for a round that was never opened.
 *
 * Two fields are added here that chain.js omits because the board does not draw them:
 * `bond` (word 7) and `tokenIn` (word 1). The write path needs both -- the bond is what
 * commit() escrows (:171-172) and the token is what a failed transfer names.
 */
export async function readAuction(maker, orderHash) {
  const m = requireAddress(maker, "maker");
  const h = requireBytes32(orderHash, "orderHash");
  const data = await callViaRpc(cfg.book, SEL_AUCTIONS + pad32(m) + pad32(h));
  const a = decodeAuction(data);
  if (!a) return null;
  a.tokenIn = "0x" + word(data, 1).slice(24);
  a.bond = BigInt("0x" + word(data, 7)).toString(); // uint128; a string, never a Number
  return a;
}

/**
 * This wallet's own Bid row (:348). The reconciliation primitive: ui-flow.md section 6.3
 * overrules the earlier "reconcile against the subgraph" decision precisely because the
 * indexer can be three blocks behind, and three blocks is the difference between
 * "Reveal now, 2 blocks left" and a RevealClosed revert.
 *
 * Struct Bid is four static fields, so four flat words:
 *   0 commitment   1 commitIdx   2 revealed   3 bondClaimed
 */
export async function readOwnBid(maker, orderHash, bidder) {
  const m = requireAddress(maker, "maker");
  const h = requireBytes32(orderHash, "orderHash");
  const b = requireAddress(bidder, "bidder");
  const data = await callViaRpc(cfg.book, SEL_BIDS + pad32(m) + pad32(h) + pad32(b));
  if (!data || data === "0x") return null;
  const commitment = "0x" + word(data, 0);
  return {
    committed: !isZeroWord(word(data, 0)),
    commitment,
    commitIdx: asInt(word(data, 1)),
    revealed: asInt(word(data, 2)) === 1,
    bondClaimed: asInt(word(data, 3)) === 1,
  };
}

/**
 * The commitment, from the contract, from two nodes.
 *
 * WHY TWO. commitmentFor is `pure` (:111), so every honest node returns the same 32
 * bytes; a node that returns anything else -- broken, on the wrong chain, or hostile --
 * produces a commitment the bidder can never open, and commit() escrows the bond before
 * anyone finds out (:172). One extra eth_call, issued in parallel, is cheap insurance on
 * the one read in the whole product where being wrong costs the bid. If the two disagree
 * we refuse to commit at all rather than pick a winner.
 *
 * If only one node answers we proceed on it: one source is what every other read on this
 * page already runs on, and refusing here would mean a visitor behind a flaky RPC cannot
 * bid at all.
 */
async function fetchCommitment(bidder, bps, salt) {
  const data = SEL_COMMITMENT_FOR + pad32(bidder) + pad32(bps.toString(16)) + pad32(salt);

  const [viaRpc, viaWallet] = await Promise.allSettled([
    callViaRpc(cfg.book, data),
    callViaWallet(cfg.book, data, bidder),
  ]);

  const ok = (r) => r.status === "fulfilled" && isBytes32(r.value) && !isZeroWord(strip(r.value));
  const a = ok(viaRpc) ? viaRpc.value.toLowerCase() : null;
  const b = ok(viaWallet) ? viaWallet.value.toLowerCase() : null;

  // A zero commitment is not a valid keccak output in any practical sense; getting one
  // means the call hit an address with no Book on it (an empty return decodes to nothing,
  // and some nodes pad that to zeros). Committing it would store bytes32(0), which the
  // contract reads as "no commitment at all" (:162, :190) -- the bid would be gone.
  if (!a && !b) {
    fail(
      "COMMITMENT_UNAVAILABLE",
      "Could not read the commitment from the Book, so nothing was sent. Check your connection to Base and try again.",
      { cause: viaRpc.reason || viaWallet.reason }
    );
  }
  if (a && b && a !== b) {
    fail(
      "COMMITMENT_MISMATCH",
      "Two nodes returned different commitments for the same bid, so nothing was sent. Reload the page and try again.",
      { fromRpc: a, fromWallet: b }
    );
  }
  return { commitment: a || b, confirmedBy: a && b ? "both" : a ? "rpc" : "wallet" };
}

// --- connection --------------------------------------------------------------------

let connected = null; // the address this module last saw authorised; used only as a default

/**
 * Prompts. Call it from a click and nowhere else -- every surveyed wallet UI treats an
 * unprompted eth_requestAccounts as hostile (ux-pattern-research.md section 5).
 */
export async function connect() {
  if (!hasProvider()) provider(); // throws NO_PROVIDER with the right sentence
  let accounts;
  try {
    accounts = await request("eth_requestAccounts");
  } catch (e) {
    const c = classifyRevert(e);
    if (c.kind === "user-rejected") fail("USER_REJECTED", c.sentence, { cause: e });
    if (c.kind === "request-pending") fail("REQUEST_PENDING", c.sentence, { cause: e });
    fail("CONNECT_FAILED", c.sentence, { cause: e });
  }
  if (!accounts || accounts.length === 0) {
    fail("NOT_CONNECTED", "The wallet returned no account. Unlock it and try again.");
  }
  const chainId = await currentChainId();
  connected = accounts[0].toLowerCase();
  return { address: connected, chainId, onBase: chainId === BASE_CHAIN_ID };
}

/**
 * The no-prompt path for a returning visitor (cta-patterns.md section 4.5 walk-away):
 * eth_accounts asks the wallet what it already authorises for this origin. Returns null
 * rather than throwing when there is no wallet or no authorisation -- a page that works
 * without a wallet should not have to catch an exception to find that out.
 */
export async function restoreConnection() {
  if (!hasProvider()) return null;
  try {
    const accounts = await request("eth_accounts");
    if (!accounts || accounts.length === 0) return null;
    connected = accounts[0].toLowerCase();
    const chainId = await currentChainId();
    return { address: connected, chainId, onBase: chainId === BASE_CHAIN_ID };
  } catch {
    // A wallet that refuses eth_accounts is indistinguishable from no wallet for our
    // purposes, and this runs on page load where a throw would be noise.
    return null;
  }
}

export async function currentChainId() {
  const hex = await request("eth_chainId");
  return Number(BigInt(hex));
}

/** Forget the account locally. EIP-1193 has no disconnect; the wallet stays connected. */
export function forgetConnection() {
  connected = null;
}

export function connectedAddress() {
  return connected;
}

/**
 * EIP-3326 switch, EIP-3085 add on 4902.
 *
 * The verification loop at the end is not defensive padding: several wallets resolve
 * wallet_switchEthereumChain before the switch has actually taken effect, and a commit
 * sent one tick early lands on whatever chain the wallet was still on. There is no Book
 * at this address on other chains, so it would be gas burned on a revert -- but on a
 * chain where SOMETHING lives at this address, it would be worse. So we re-read
 * eth_chainId until it agrees, and give up rather than guess.
 */
export async function ensureBaseChain() {
  const current = await currentChainId();
  if (current === BASE_CHAIN_ID) return { chainId: BASE_CHAIN_ID, switched: false };

  try {
    await request("wallet_switchEthereumChain", [{ chainId: BASE_CHAIN_ID_HEX }]);
  } catch (e) {
    const code = digCode(e);
    // 4902: the wallet does not know this chain. Some wallets report it as -32603 with
    // "Unrecognized chain ID" in the message instead, so both are treated as "add it".
    const unknownChain = code === 4902 || /unrecognized chain|add.*chain|chain.*not.*added/i.test(String(e && e.message));
    if (!unknownChain) {
      const c = classifyRevert(e);
      if (c.kind === "user-rejected") {
        fail("CHAIN_SWITCH_REJECTED", "You declined the network switch. Bidding needs Base; the rest of the page does not.", { cause: e });
      }
      fail("CHAIN_SWITCH_FAILED", c.sentence, { cause: e });
    }
    try {
      await request("wallet_addEthereumChain", [
        {
          chainId: BASE_CHAIN_ID_HEX,
          chainName: "Base",
          nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
          rpcUrls: [cfg.rpc],
          blockExplorerUrls: [cfg.explorer],
        },
      ]);
    } catch (addErr) {
      const c = classifyRevert(addErr);
      fail(
        c.kind === "user-rejected" ? "CHAIN_ADD_REJECTED" : "CHAIN_ADD_FAILED",
        c.kind === "user-rejected"
          ? "You declined adding Base to the wallet. Bidding needs Base."
          : `Base could not be added to the wallet: ${c.sentence}`,
        { cause: addErr }
      );
    }
  }

  // Confirm, do not assume. Up to ~2 s of polling; the switch is usually instant.
  for (let i = 0; i < 10; i++) {
    const now = await currentChainId();
    if (now === BASE_CHAIN_ID) return { chainId: BASE_CHAIN_ID, switched: true };
    await new Promise((r) => setTimeout(r, 200));
  }
  fail(
    "WRONG_CHAIN",
    "The wallet is still not on Base, so nothing was sent. Switch to Base in the wallet and try again."
  );
}

// --- the secret store --------------------------------------------------------------
//
// KEY. ui-flow.md section 6.1 keys records by the Book's own `key()` hash. We cannot
// compute that without keccak, and a round trip to `key()` before every localStorage read
// would be absurd, so the key is `glasshouse:bid:<orderHash>:<bidder>` and `maker` lives
// inside the record and is checked on read. Collision would need two makers to open
// auctions on the same order hash; the keeper varies postTransferInData per round so its
// hashes are unique, and `open()` reverts AlreadyOpened on reuse (:131).
//
// The record is deliberately plaintext. Encrypting it would need a key, and the only
// place to put the key is the same localStorage -- encryption theatre (ui-flow.md 6.1).

const KEY_PREFIX = "glasshouse:bid:";
const RECORD_VERSION = 1;

// ui-flow.md section 6.1 deletes a record 24 h after exclusiveEnd. exclusiveEnd is minutes
// after the commit, so measuring from the commit is the same deadline give or take, and
// works when the block clock is unavailable. 26 h rather than 24 so the drift is always in
// the direction of keeping the record too long: a stale record explains what happened, a
// deleted one leaves the visitor with a missing bid and no sentence.
const PRUNE_AFTER_MS = 26 * 60 * 60 * 1000;

const recordKey = (orderHash, bidder) => `${KEY_PREFIX}${String(orderHash).toLowerCase()}:${String(bidder).toLowerCase()}`;

function storage() {
  try {
    const s = globalThis.localStorage;
    // Presence is not availability: Safari in private mode and a browser set to block
    // site data both throw on the first write, not on the property access.
    if (!s) return null;
    return s;
  } catch {
    return null;
  }
}

function readRecordAt(key) {
  const s = storage();
  if (!s) return null;
  try {
    const raw = s.getItem(key);
    if (!raw) return null;
    const rec = JSON.parse(raw);
    return rec && typeof rec === "object" ? rec : null;
  } catch {
    // A record we cannot parse is a record we cannot reveal from. Report it as absent so
    // the caller shows "no sealed bid in this browser" and offers Enter secret, rather
    // than crashing the strip on every poll.
    return null;
  }
}

/**
 * Write, then READ BACK. localStorage can accept a setItem and lose it (quota eviction,
 * a browser in a storage-partitioned iframe), and a silent loss here is exactly the
 * failure this whole file exists to prevent. Returns true only if the bytes are there.
 */
function writeRecord(rec) {
  const s = storage();
  if (!s) return false;
  const key = recordKey(rec.orderHash, rec.bidder);
  try {
    s.setItem(key, JSON.stringify(rec));
  } catch {
    return false;
  }
  const back = readRecordAt(key);
  return !!(back && back.salt === rec.salt && back.bps === rec.bps && back.bidder === rec.bidder);
}

function allKeys() {
  const s = storage();
  if (!s) return [];
  const out = [];
  try {
    for (let i = 0; i < s.length; i++) {
      const k = s.key(i);
      if (k && k.startsWith(KEY_PREFIX)) out.push(k);
    }
  } catch {
    return [];
  }
  return out;
}

/** Drop records old enough that nothing can be done with them. Never touches a young one. */
function prune(now = Date.now()) {
  const s = storage();
  if (!s) return 0;
  let dropped = 0;
  for (const k of allKeys()) {
    const rec = readRecordAt(k);
    const at = rec && Number(rec.committedAtMs);
    if (rec && Number.isFinite(at) && now - at > PRUNE_AFTER_MS) {
      try {
        s.removeItem(k);
        dropped++;
      } catch {
        /* blocked storage: leaving the record is harmless */
      }
    }
  }
  return dropped;
}

/**
 * The stored secret for a round, or null.
 *
 * `bidder` is optional because the caller wiring a button usually has only the round in
 * hand. Resolution order, and why:
 *   1. the bidder passed in;
 *   2. the connected account -- the only account that can actually sign a reveal;
 *   3. if exactly one record exists for this round, that one.
 * Rule 3 is what lets the UI say "sealed from 0x91ab...04ce, switch back to that account
 * to reveal" (ui-flow.md section 5.2) instead of silently showing no bid. The record
 * always carries `bidder`, so the caller must compare it before arming a Reveal button:
 * revealing from the wrong account is a guaranteed NoCommitment revert (:190).
 */
/** @param {string} orderHash @param {string|null} [bidder] */
export function pendingBid(orderHash, bidder = null) {
  prune();
  const h = String(orderHash || "").toLowerCase();
  if (!isBytes32(h)) return null;

  const who = bidder ? String(bidder).toLowerCase() : connected;
  if (who) {
    const rec = readRecordAt(recordKey(h, who));
    if (rec) return rec;
    if (bidder) return null; // an explicit bidder was asked for; do not substitute another
  }

  const mine = allKeys()
    .filter((k) => k.startsWith(`${KEY_PREFIX}${h}:`))
    .map(readRecordAt)
    .filter(Boolean);
  return mine.length === 1 ? mine[0] : null;
}

/** Every live record in this browser, newest first. The sticky strip's input. */
/** @param {string|null} [bidder] */
export function listBids(bidder = null) {
  prune();
  const who = bidder ? String(bidder).toLowerCase() : null;
  return allKeys()
    .map(readRecordAt)
    .filter(Boolean)
    .filter((r) => !who || r.bidder === who)
    .sort((a, b) => (b.committedAtMs || 0) - (a.committedAtMs || 0));
}

/**
 * Delete a secret. With no `bidder`, deletes only the connected account's record, and if
 * there is no connected account, only an unambiguous single record for the round -- a
 * "forget" that reaches across accounts would be a way to destroy a bid the visitor still
 * needs to reveal.
 */
/** @param {string} orderHash @param {string|null} [bidder] */
export function forgetBid(orderHash, bidder = null) {
  const s = storage();
  if (!s) return false;
  const rec = pendingBid(orderHash, bidder);
  if (!rec) return false;
  try {
    s.removeItem(recordKey(rec.orderHash, rec.bidder));
    return true;
  } catch {
    return false;
  }
}

/** What `Copy bid secret` copies. Enough to reveal from any other browser. */
/** @param {string} orderHash @param {string|null} [bidder] */
export function exportSecret(orderHash, bidder = null) {
  const r = pendingBid(orderHash, bidder);
  if (!r) return null;
  return JSON.stringify(
    { maker: r.maker, orderHash: r.orderHash, bidder: r.bidder, bps: r.bps, salt: r.salt, revealEnd: r.revealEnd },
    null,
    2
  );
}

/**
 * The `Enter secret` path (cta-patterns.md section 4.13): adopt a (bps, salt) pair typed
 * in from another browser. Not validated here -- validation is the contract's, at reveal,
 * as BadReveal (:192). Marked `typed` so the UI can say where it came from.
 */
export function adoptSecret({ maker, orderHash, bidder, bps, salt, revealEnd = null, commitEnd = null }) {
  const rec = {
    v: RECORD_VERSION,
    orderHash: requireBytes32(orderHash, "orderHash"),
    maker: requireAddress(maker, "maker"),
    bidder: requireAddress(bidder, "bidder"),
    bps: requireBps(bps),
    salt: requireBytes32(salt, "salt"),
    commitment: null,
    commitEnd,
    revealEnd,
    exclusiveEnd: null,
    bond: null,
    committedAt: null,
    committedAtMs: Date.now(),
    txHash: null,
    revealTx: null,
    source: "typed",
    state: "sealed",
  };
  if (!writeRecord(rec)) {
    fail("STORAGE_BLOCKED", "This browser is not allowing site storage, so the secret could not be saved here.", { record: rec });
  }
  return rec;
}

function requireBps(bps) {
  if (typeof bps !== "number" || !Number.isInteger(bps) || bps < 0 || bps > MAX_UINT24) {
    fail("BAD_BPS", `A bid must be a whole number of basis points between 0 and ${MAX_UINT24}.`, { bps });
  }
  return bps;
}

// --- placing a bid -----------------------------------------------------------------

/**
 * Seal a bid. Returns { txHash, salt } once the wallet has broadcast; the caller waits
 * for the receipt.
 *
 * The order of operations is the whole point, and it is cta-patterns.md section 4.7's,
 * with the guards this file adds:
 *
 *   0. refuse a bid the reveal would reject, and refuse to clobber a secret that is
 *      already on chain            <- both are silent bid-losers, checked before anything
 *   1. salt from the CSPRNG
 *   2. commitment from the contract, from two nodes
 *   3. WRITE THE RECORD, AND VERIFY IT           <- before any wallet prompt exists
 *   4. pre-flight eth_call of the exact calldata <- a revert here costs no signature
 *   5. eth_sendTransaction
 *   6. store the tx hash in the same record
 *
 * Step 3 before step 5 is the ordering that matters: between signing and the receipt the
 * bond is escrowed and the bid exists on chain, and if the tab dies in that window the
 * salt must already be somewhere it survives. Step 3 before step 4 costs nothing and
 * removes a second window where a signature could exist without a stored secret.
 *
 * options:
 *   auction              - a decoded auction from chain.js, to skip one eth_call
 *   acceptUnstoredSecret - proceed even though storage is blocked. Only pass this after
 *                          the visitor has demonstrably copied the secret; the default is
 *                          to refuse, because an unstored salt is an unrevealable bid.
 *   skipPreflight        - send without simulating
 */
export async function placeBid({ maker, orderHash, bps }, options = {}) {
  const m = requireAddress(maker, "maker");
  const h = requireBytes32(orderHash, "orderHash");
  const value = requireBps(bps);

  const account = await requireConnectedOnBase();

  // --- step 0a: would the reveal accept this number? ---------------------------------
  // commit() takes any bytes32 (:155-175). reveal() enforces the range (:187). A bid
  // outside [reserveBps, maxBps] therefore commits cleanly and can never be opened: the
  // bid is void and, with bond > 0, the bond is the maker's. The contract cannot protect
  // the bidder here, so the page must.
  const auction = options.auction || (await readAuction(m, h));
  if (!auction) {
    fail("ROUND_NOT_OPEN", "That round is not open on the Book yet. Wait for the next round on the board.");
  }
  if (value < auction.reserveBps || value > auction.maxBps) {
    fail(
      "BID_OUT_OF_RANGE",
      `A bid of ${value} bps cannot be revealed in this round: it accepts ${auction.reserveBps} to ${auction.maxBps} bps. Nothing was sent.`,
      { bps: value, reserveBps: auction.reserveBps, maxBps: auction.maxBps }
    );
  }

  // --- step 0b: is there already a secret here that still matters? --------------------
  // Generating a new salt over a live record destroys the old one, and the old bid may be
  // sitting on chain waiting to be revealed. The chain settles it: a non-zero commitment
  // in bids() means the old secret is the only thing that can open a real bid, so we stop.
  // A local record with no on-chain commitment is provably worthless and may be replaced.
  const existing = readRecordAt(recordKey(h, account));
  const onChain = await readOwnBid(m, h, account).catch(() => null);

  // A FAILED READ IS NOT PERMISSION TO OVERWRITE.
  //
  // readOwnBid swallowing its error meant that when the RPC was merely unreachable,
  // `onChain` came back null and the guard below waved us through -- a fresh salt then
  // replaced a record whose commit had already been broadcast, and the only secret that
  // could open that bid was gone. The bond goes with it. If this browser holds a record
  // that reached the chain and we cannot confirm the chain, we stop.
  if (existing && existing.txHash && !onChain) {
    fail(
      "CHAIN_UNREADABLE",
      `This browser holds a bid of ${existing.bps} bps that was already broadcast for this round, ` +
        "and the chain cannot be read right now to check it. Refusing to replace it: a new bid " +
        "would destroy the only secret that can reveal the old one. Try again in a moment.",
      { existing },
    );
  }

  if (onChain && onChain.committed) {
    fail(
      "ALREADY_SEALED",
      existing
        ? `This wallet already has a sealed bid of ${existing.bps} bps in this round. Only one bid per wallet is allowed; reveal that one.`
        : "This wallet already has a sealed bid in this round, and this browser has no secret for it. Enter the bps and salt you saved, or reveal from the browser you bid in.",
      { existing }
    );
  }

  // --- step 1: the salt ---------------------------------------------------------------
  const salt = randomSalt();

  // Started here, awaited at step 3, so the head costs no extra wall time inside a commit
  // window measured in seconds. It is only ever a lower bound for a log scan, so a failure
  // to read it must not stop a bid: null is an acceptable answer.
  const headPromise = chainHead(cfg.rpc).catch(() => null);

  // --- step 2: the commitment, from the contract --------------------------------------
  const { commitment, confirmedBy } = await fetchCommitment(account, value, salt);
  const headAtWrite = await headPromise;

  // --- step 3: the record, BEFORE the wallet ------------------------------------------
  const record = {
    v: RECORD_VERSION,
    orderHash: h,
    maker: m,
    bidder: account,
    bps: value,
    salt,
    commitment,
    commitmentConfirmedBy: confirmedBy,
    commitEnd: auction.commitEnd,
    revealEnd: auction.revealEnd,
    exclusiveEnd: auction.exclusiveEnd,
    bond: auction.bond != null ? String(auction.bond) : null,
    tokenIn: auction.tokenIn || null,
    reserveBps: auction.reserveBps,
    maxBps: auction.maxBps,
    // `committedAt` is a BLOCK -- the head at the moment the record was written, which is
    // one or two blocks before the commit actually lands. It is a lower bound for a log
    // scan, never a claim about where the bid sits, and it is null when the RPC did not
    // answer. `committedAtMs` is wall clock and is what pruning uses, because the block
    // clock is not available at all when storage is read on a cold load.
    committedAt: headAtWrite,
    committedAtMs: Date.now(),
    txHash: null,
    revealTx: null,
    source: "generated",
    state: "secret-written",
  };

  const stored = writeRecord(record);
  if (!stored && !options.acceptUnstoredSecret) {
    // NOT SENT. This is the branch a hostile reviewer should look for: the alternative is
    // to broadcast anyway and hope the visitor never closes the tab, which turns a blocked
    // localStorage into a lost bid and, with bond > 0, lost money. The salt travels on the
    // error so the caller can offer "copy this, then continue".
    fail(
      "STORAGE_BLOCKED",
      "This browser is blocking site storage, so the bid secret could not be saved and nothing was sent. Copy the secret first, or allow storage for this site.",
      { salt, bps: value, record }
    );
  }
  record.storedLocally = stored;

  // --- step 4: pre-flight -------------------------------------------------------------
  const data = SEL_COMMIT + pad32(m) + pad32(h) + pad32(commitment);
  if (!options.skipPreflight) {
    const revert = await preflight({ from: account, to: cfg.book, data }, 4000);
    if (revert) {
      record.state = "dead";
      record.lastError = revert.name || revert.kind;
      writeRecord(record);
      fail("PREFLIGHT_REVERT", revert.sentence, { revert, record });
    }
  }

  // --- step 5: send -------------------------------------------------------------------
  let txHash;
  try {
    txHash = await request("eth_sendTransaction", [{ from: account, to: cfg.book, data }]);
  } catch (e) {
    const c = classifyRevert(e);
    // The record stays. On a 4001 the visitor may simply click again; on a revert the
    // record is what lets the strip say what happened instead of vanishing.
    record.state = c.kind === "user-rejected" ? "secret-written" : "dead";
    record.lastError = c.name || c.kind;
    writeRecord(record);
    fail(c.kind === "user-rejected" ? "USER_REJECTED" : "SEND_FAILED", c.sentence, { cause: e, record });
  }

  // --- step 6: remember the hash ------------------------------------------------------
  record.txHash = txHash;
  record.state = "sealing";
  writeRecord(record); // best effort; the secret is already safe, and the hash is not

  return { txHash, salt, bps: value, commitment, record };
}

// --- revealing ---------------------------------------------------------------------

/**
 * Open a sealed bid. Returns { txHash, bps }.
 *
 * THE DEADLINE IS NOT OURS TO ENFORCE. There is no check anywhere in this function
 * against revealEnd, on purpose, and it must stay that way (cta-patterns.md section 4.8,
 * ui-flow.md section 6.5). Our head is a poll old at best; the contract compares
 * block.number at inclusion (:186). A reveal we refuse to send because our clock says it
 * is late costs the bid. A reveal that lands one block late costs a cent. So we always
 * offer to send, right up to and past our idea of the deadline, and let the chain say no.
 *
 * The caller may still grey the button once the CHAIN's head is past revealEnd -- that is
 * the chain's answer, not ours. It must never grey it because a local timer expired.
 *
 * The pre-flight is the one place a reveal can be stopped before the wallet opens, and it
 * stops only on errors that no later block can fix:
 *   BadReveal, NoCommitment, AlreadyRevealed, BidOutOfRange, RevealClosed
 * all describe a state that is monotone -- waiting cannot help. RevealNotOpen is the
 * opposite: it becomes valid within a block or two, so we send anyway and let the
 * transaction sit. Anything the pre-flight cannot decode (a timeout, a node error) sends
 * anyway too: an unattempted reveal is the only outcome guaranteed to fail.
 *
 * Note that even the RevealClosed abort is the CHAIN's judgment, not ours -- it is the
 * Book, executing at the node's latest block, saying no. That is the distinction the rule
 * turns on. `skipPreflight: true` removes even that, and is the right call at one or two
 * blocks left, where 1.5 s of simulation costs a block.
 *
 * options:
 *   bps, salt     - supply the secret directly (the Enter-secret path); otherwise the
 *                   stored record is used
 *   skipPreflight - send with no simulation. Correct at one or two blocks left, where
 *                   1.5 s of simulation is a block.
 *   gas           - override REVEAL_GAS
 */
export async function revealBid({ maker, orderHash, bps = null, salt = null }, options = {}) {
  const m = requireAddress(maker, "maker");
  const h = requireBytes32(orderHash, "orderHash");
  const account = await requireConnectedOnBase();

  const record = pendingBid(h, account);
  const useBps = bps != null ? requireBps(bps) : record ? requireBps(record.bps) : null;
  const useSalt = salt != null ? requireBytes32(salt, "salt") : record ? requireBytes32(record.salt, "salt") : null;

  if (useBps == null || useSalt == null) {
    const other = pendingBid(h);
    fail(
      "NO_SECRET",
      other && other.bidder !== account
        ? `The sealed bid in this browser belongs to ${other.bidder}. Switch back to that account to reveal it.`
        : `No sealed bid for ${account} in this browser. If you bid from another browser, enter its bps and salt.`,
      { otherBidder: other ? other.bidder : null }
    );
  }
  if (record && record.maker && record.maker !== m) {
    fail("MAKER_MISMATCH", "The stored secret is for a different maker's order. Nothing was sent.", { record });
  }

  const data = SEL_REVEAL + pad32(m) + pad32(h) + pad32(useBps.toString(16)) + pad32(useSalt);

  if (!options.skipPreflight) {
    // 1.5 s, then send regardless (ui-flow.md 6.5): at five blocks left a simulation is
    // not worth a block. withBudget resolves to null on timeout, which reads as "no known
    // revert" and falls through to the send.
    const revert = await preflight({ from: account, to: cfg.book, data }, 1500);
    if (revert && revert.name !== "RevealNotOpen" && revert.kind === "contract") {
      if (record && revert.name === "AlreadyRevealed") {
        record.state = "revealed";
        writeRecord(record);
      }
      fail("PREFLIGHT_REVERT", revert.sentence, { revert, record });
    }
  }

  let txHash;
  try {
    txHash = await request("eth_sendTransaction", [
      { from: account, to: cfg.book, data, gas: options.gas || REVEAL_GAS },
    ]);
  } catch (e) {
    const c = classifyRevert(e);
    fail(c.kind === "user-rejected" ? "USER_REJECTED" : "SEND_FAILED", c.sentence, { cause: e, record });
  }

  // After the send, not before. The reveal is already broadcast; a storage failure here
  // loses a convenience (the pending link), not money, and must not turn a successful
  // reveal into a thrown error.
  if (record) {
    record.revealTx = txHash;
    record.state = "revealing";
    writeRecord(record);
  }

  return { txHash, bps: useBps };
}

/**
 * eth_call the exact calldata that is about to be signed, and decode the revert.
 * Returns null when the call succeeds, when it times out, or when the failure is not a
 * revert we can read -- every one of those means "we learned nothing, proceed".
 */
async function preflight(tx, budgetMs) {
  const attempt = (async () => {
    try {
      await callViaWallet(tx.to, tx.data, tx.from);
      return null;
    } catch (e) {
      const c = classifyRevert(e);
      // A user-rejected or transport-level failure of an eth_call tells us nothing about
      // whether the transaction would succeed.
      return c.kind === "contract" || c.kind === "revert-string" ? c : null;
    }
  })();
  try {
    return await withBudget(attempt, budgetMs, null);
  } catch {
    return null;
  }
}

async function requireConnectedOnBase() {
  const accounts = await request("eth_accounts");
  if (!accounts || accounts.length === 0) {
    fail("NOT_CONNECTED", "Connect a wallet first.");
  }
  const account = accounts[0].toLowerCase();
  connected = account;
  const chainId = await currentChainId();
  if (chainId !== BASE_CHAIN_ID) {
    // Not switched silently: switching a chain is a wallet prompt, and a prompt the
    // visitor did not click for is the thing every wallet-UX source warns against. The
    // caller shows `Switch to Base` and calls ensureBaseChain() from that click.
    fail("WRONG_CHAIN", `This wallet is on chain ${chainId}. Switch to Base (8453) to bid.`, { chainId });
  }
  return account;
}

// --- derived state -----------------------------------------------------------------

/**
 * One place that turns (auction, record, on-chain bid, head) into what the button should
 * be. Exported because it is the part worth unit-testing without a DOM, and because the
 * card and the sticky strip must never disagree -- ui-flow.md acceptance 4.
 *
 * `phase` comes from site/phase.js and is not re-derived here.
 * `canReveal` is the contract's own predicate (:185-186), nothing softer.
 */
/** @param {{auction: any, record?: any, onChain?: any, head: number}} args */
export function bidState({ auction, record = null, onChain = null, head }) {
  const p = phase(auction, head);
  const n = Number(head);
  const revealEnd = Number(auction.revealEnd);
  const commitEnd = Number(auction.commitEnd);

  const revealed = !!(onChain && onChain.revealed);
  const committed = !!(onChain && onChain.committed) || !!(record && record.txHash);

  // Both are the contract's inequalities, not a margin of ours.
  const canCommit = n <= commitEnd && !committed;
  const canReveal = n > commitEnd && n <= revealEnd && committed && !revealed;

  let state;
  if (!record && !committed) state = "none";
  else if (revealed) state = "revealed";
  else if (committed && p === "commit") state = "sealed";
  else if (committed && p === "reveal") state = "reveal-due";
  else if (committed && n > revealEnd) state = "missed";
  else if (record && record.txHash) state = "sealing";
  else state = "secret-written";

  return {
    phase: p,
    state,
    canCommit,
    canReveal,
    committed,
    revealed,
    blocksToCommitEnd: commitEnd - n,
    blocksToRevealEnd: revealEnd - n,
    // The urgency threshold from cta-patterns.md section 4.8, which flags it as the one
    // number in that document nobody has tested. It is presentation, not a gate.
    urgent: canReveal && revealEnd - n <= 10,
    lastCall: canReveal && revealEnd - n <= 1,
  };
}

// --- revert decoding ---------------------------------------------------------------
//
// Every selector below is `cast sig "<signature>"` of the signature in the comment beside
// it, taken from subgraph/abis/GlasshouseBook.json. All 17 errors in that ABI are here:
// the 16 declared in GlasshouseBook.sol:85-100 plus SafeERC20FailedOperation, which the
// Book inherits and which is what a bond transfer failure actually surfaces as. The four
// OpenZeppelin ERC20 errors at the end are not the Book's, but SafeERC20 bubbles a token's
// own revert data through commit(), so they reach the page and need a sentence too.

const BOOK_ERRORS = {
  // --- GlasshouseBook.sol:85-100 ---
  "0x1da42b26": {
    // AlreadyOpened()
    name: "AlreadyOpened",
    sentence: "That round has already been opened. Nothing to do here; the board shows the round that is accepting bids now.",
  },
  "0x6d36408a": {
    // NotOpened()
    name: "NotOpened",
    sentence: "That round has not been opened on the Book yet, so nothing was placed. Wait for the board to show a round accepting bids.",
  },
  "0x5419376a": {
    // BadWindow()
    name: "BadWindow",
    sentence: "The round's windows are invalid, which only the maker can cause. Nothing you can do from here; report the round.",
  },
  "0x1164ebab": {
    // CommitClosed()
    name: "CommitClosed",
    sentence: "The commit window closed while you were signing, so no bid was placed and nothing was escrowed. Place a bid in the round that is open now.",
  },
  "0xd8960546": {
    // RevealClosed()
    name: "RevealClosed",
    sentence: "The reveal window closed before your reveal landed, so this bid is void. Nothing further can be done for this round; if a bond was escrowed the maker may now claim it.",
  },
  "0xccc87fea": {
    // RevealNotOpen()
    name: "RevealNotOpen",
    sentence: "Reveal has not opened yet: it opens the block after the commit window ends. Try again in a few seconds.",
  },
  "0xbfec5558": {
    // AlreadyCommitted()
    name: "AlreadyCommitted",
    sentence: "This wallet already has a sealed bid in this round, and only one per wallet is allowed. Reveal that bid instead; if this browser has no secret for it, enter the bps and salt you saved.",
  },
  "0x5b07c989": {
    // NoCommitment()
    name: "NoCommitment",
    sentence: "The Book has no sealed bid from this address in this round. Check you are on the wallet you bid from.",
  },
  "0xa89ac151": {
    // AlreadyRevealed()
    name: "AlreadyRevealed",
    sentence: "This bid is already revealed. Nothing more to do; the board will show it on the next poll.",
  },
  "0x8ff14e0d": {
    // BadReveal()
    name: "BadReveal",
    sentence: "The bps and salt do not match the sealed commitment, so the reveal was rejected. Check you are on the right wallet and round, and that the salt was copied whole; a sealed bid whose secret is lost cannot be opened by anyone.",
  },
  "0x72bd9963": {
    // BidOutOfRange(uint24,uint24,uint24)
    name: "BidOutOfRange",
    decode: (args) => {
      const [bps, reserve, max] = args;
      return `The reveal was rejected: ${bps} bps is outside this round's range of ${reserve} to ${max} bps, so the bid cannot be opened. Bid inside the range next round.`;
    },
    sentence: "The reveal was rejected because the bid is outside this round's allowed range, so it cannot be opened.",
  },
  "0x91655201": {
    // NotRouter()
    name: "NotRouter",
    sentence: "The Book rejected a hook call from an address that is not the round's router. This is not something the page can cause; report the round.",
  },
  "0xba329a9b": {
    // NotSettled()
    name: "NotSettled",
    sentence: "The round has not settled yet. Bonds are released after settle, which anyone may call once the exclusive window has elapsed.",
  },
  "0x560ff900": {
    // AlreadySettled()
    name: "AlreadySettled",
    sentence: "This round is already settled, so there was nothing to do. The board shows the result.",
  },
  "0x8e3e8125": {
    // WindowNotElapsed()
    name: "WindowNotElapsed",
    sentence: "Settle is not possible yet: the winner's exclusive window has not elapsed. Wait for the block the board names, then try again.",
  },
  "0x969bf728": {
    // NothingToClaim()
    name: "NothingToClaim",
    sentence: "There is nothing to claim for this wallet in this round: either the bond was already returned, or the bid was never revealed. The round's row shows which.",
  },
  "0x5274afe7": {
    // SafeERC20FailedOperation(address) -- inherited via SafeERC20, raised by the bond
    // transfer at GlasshouseBook.sol:172
    name: "SafeERC20FailedOperation",
    decode: (args) => `The bond token at ${args[0]} refused the transfer, so no bid was placed. Approve the Book for the bond amount and check your balance of that token.`,
    sentence: "The bond token refused the transfer, so no bid was placed. Approve the Book for the bond amount and check your balance.",
  },

  // --- not the Book's, but bubbled through SafeERC20 when the bond moves ---
  "0xfb8f41b2": {
    // ERC20InsufficientAllowance(address,uint256,uint256)
    name: "ERC20InsufficientAllowance",
    decode: (args) => `The Book is approved for only ${args[2]} of the bond token but needs ${args[1]}, so no bid was placed. Approve the bond amount and try again.`,
    sentence: "The Book is not approved for enough of the bond token. Approve the bond amount and try again.",
  },
  "0xe450d38c": {
    // ERC20InsufficientBalance(address,uint256,uint256)
    name: "ERC20InsufficientBalance",
    decode: (args) => `That wallet holds ${args[1]} of the bond token but the bond is ${args[2]}, so no bid was placed. Top up and try again.`,
    sentence: "That wallet does not hold enough of the bond token to cover the bond, so no bid was placed.",
  },
  "0xe602df05": {
    // ERC20InvalidApprover(address)
    name: "ERC20InvalidApprover",
    sentence: "The bond token rejected the approval. Nothing was placed; check the token address on the round.",
  },
  "0x94280d62": {
    // ERC20InvalidSpender(address)
    name: "ERC20InvalidSpender",
    sentence: "The bond token rejected the Book as a spender. Nothing was placed; check the token address on the round.",
  },
};

const SEL_ERROR_STRING = "0x08c379a0"; // Error(string)
const SEL_PANIC = "0x4e487b71"; // Panic(uint256)

const PANIC_REASONS = {
  0x01: "an assertion in the contract failed",
  0x11: "an arithmetic operation overflowed",
  0x12: "the contract divided by zero",
  0x21: "a value was cast to an enum out of range",
  0x32: "an array index was out of bounds",
  0x41: "the contract ran out of memory",
};

/**
 * Providers bury revert data at different depths: MetaMask puts it at `e.data`, some at
 * `e.data.data`, some at `e.data.originalError.data`, ethers-shaped wrappers at
 * `e.info.error.data`, and a raw JSON-RPC body at `e.error.data`. Rather than enumerate
 * shapes that keep changing, walk the object for the first thing that looks like ABI
 * revert data.
 */
function digData(e, depth = 0) {
  if (e == null || depth > 6) return null;
  if (typeof e === "string") return looksLikeRevertData(e.trim()) ? e.trim().toLowerCase() : null;
  if (typeof e !== "object") return null;
  for (const k of ["data", "originalError", "error", "cause", "info", "value", "body", "details"]) {
    if (k in e) {
      const found = digData(e[k], depth + 1);
      if (found) return found;
    }
  }
  return null;
}

/**
 * ABI revert data is a 4-byte selector followed by whole 32-byte words, so its hex length
 * is 8 + 64k. Checking that -- rather than "starts with 0x and is long" -- is what stops a
 * transaction hash (64) or an address (40) sitting in some wallet's `data` field from
 * being read as a selector and reported as an unrecognised contract error.
 */
function looksLikeRevertData(s) {
  if (typeof s !== "string" || !/^0x[0-9a-fA-F]*$/.test(s)) return false;
  const len = s.length - 2;
  return len >= 8 && (len - 8) % 64 === 0;
}

/** The first numeric or string EIP-1193 code in the object graph. */
function digCode(e, depth = 0) {
  if (e == null || typeof e !== "object" || depth > 6) return null;
  if (typeof e.code === "number") return e.code;
  if (typeof e.code === "string" && e.code) return e.code;
  for (const k of ["error", "cause", "info", "data", "originalError"]) {
    if (k in e) {
      const found = digCode(e[k], depth + 1);
      if (found != null) return found;
    }
  }
  return null;
}

function messageOf(e) {
  if (e == null) return "";
  if (typeof e === "string") return e;
  const parts = [];
  const walk = (x, d) => {
    if (x == null || d > 4) return;
    if (typeof x === "string") return void parts.push(x);
    if (typeof x !== "object") return;
    if (typeof x.message === "string") parts.push(x.message);
    if (typeof x.reason === "string") parts.push(x.reason);
    for (const k of ["error", "cause", "info", "data", "originalError"]) if (k in x) walk(x[k], d + 1);
  };
  walk(e, 0);
  return parts.join(" | ");
}

function scanMessageForRevertData(msg) {
  if (!msg) return null;
  const candidates = String(msg).match(/0x[0-9a-fA-F]+/g) || [];
  for (const c of candidates) if (looksLikeRevertData(c)) return c.toLowerCase();
  return null;
}

function decodeUint(dataWords, i) {
  return BigInt("0x" + word(dataWords, i)).toString();
}

function decodeAddressArg(dataWords, i) {
  return "0x" + word(dataWords, i).slice(24);
}

function decodeErrorString(data) {
  try {
    const body = strip(data).slice(8);
    const len = Number(BigInt("0x" + body.slice(64, 128)));
    const hex = body.slice(128, 128 + len * 2);
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

/**
 * Full classification: kind, error name, decoded arguments, the sentence, and the raw
 * data. `explainRevert` is this function's `sentence`; the rest is here because the
 * caller needs the kind to pick a colour and the name to pick a button state, and
 * re-parsing the message to get them back would be worse.
 *
 * kind is one of:
 *   contract       a decoded custom error from the Book (or a token, through it)
 *   revert-string  require(msg) / Panic
 *   user-rejected  4001 and its variants
 *   wallet         a provider-level condition (pending request, wrong chain, no funds)
 *   network        the RPC did not answer
 *   unknown        nothing recognisable; the raw message is carried through
 */
export function classifyRevert(errorLike) {
  const code = digCode(errorLike);
  const msg = messageOf(errorLike);
  // Some nodes put the revert bytes only in the message ("execution reverted: 0x1164ebab",
  // "Reverted 0x8ff14e0d"), so the message is scanned as a fallback. The length rule in
  // looksLikeRevertData keeps addresses and hashes in the same sentence from matching.
  const data = digData(errorLike) || scanMessageForRevertData(msg);

  // 1. Contract revert data first: it is the most specific thing available, and a wallet
  //    will often wrap a real revert in a generic -32603.
  if (data && data.length >= 10) {
    const selector = data.slice(0, 10).toLowerCase();
    const body = strip(data).slice(8);
    const entry = BOOK_ERRORS[selector];
    if (entry) {
      let args = [];
      if (entry.name === "BidOutOfRange") args = [0, 1, 2].map((i) => decodeUint(body, i));
      else if (entry.name === "SafeERC20FailedOperation" || entry.name === "ERC20InvalidApprover" || entry.name === "ERC20InvalidSpender") {
        args = [decodeAddressArg(body, 0)];
      } else if (entry.name === "ERC20InsufficientAllowance" || entry.name === "ERC20InsufficientBalance") {
        args = [decodeAddressArg(body, 0), decodeUint(body, 1), decodeUint(body, 2)];
      }
      let sentence = entry.sentence;
      try {
        if (entry.decode && args.length) sentence = entry.decode(args);
      } catch {
        /* keep the argument-free sentence rather than lose the message */
      }
      return { kind: "contract", name: entry.name, selector, args, sentence, raw: data, message: msg };
    }
    if (selector === SEL_ERROR_STRING) {
      const reason = decodeErrorString(data);
      return {
        kind: "revert-string",
        name: "Error",
        selector,
        args: reason ? [reason] : [],
        sentence: reason ? `The contract rejected it: ${reason}` : "The contract rejected the transaction without saying why.",
        raw: data,
        message: msg,
      };
    }
    if (selector === SEL_PANIC) {
      const n = Number(BigInt("0x" + body.slice(0, 64)));
      return {
        kind: "revert-string",
        name: "Panic",
        selector,
        args: [n],
        sentence: `The contract hit an internal error (${PANIC_REASONS[n] || `panic code 0x${n.toString(16)}`}). Nothing was changed. Report the round.`,
        raw: data,
        message: msg,
      };
    }
    // An unknown selector is still worth naming: the caller shows the sentence and puts
    // the four bytes in a <details>, which is what makes an unexpected revert reportable.
    return {
      kind: "unknown",
      name: null,
      selector,
      args: [],
      sentence: `The transaction was rejected by the contract with an error this page does not recognise (${selector}). Nothing was changed; try again, and report the round if it repeats.`,
      raw: data,
      message: msg,
    };
  }

  // 2. Wallet and RPC conditions.
  if (code === 4001 || code === "ACTION_REJECTED" || /user (rejected|denied)|rejected the request|denied transaction/i.test(msg)) {
    return { kind: "user-rejected", name: "UserRejected", selector: null, args: [], sentence: "Cancelled in the wallet. Nothing was sent and nothing was escrowed.", raw: null, message: msg };
  }
  if (code === -32002 || /already pending|request.*already/i.test(msg)) {
    return { kind: "wallet", name: "RequestPending", selector: null, args: [], sentence: "Open your wallet: a request from this page is already waiting there.", raw: null, message: msg };
  }
  if (code === 4100 || /unauthorized/i.test(msg)) {
    return { kind: "wallet", name: "Unauthorized", selector: null, args: [], sentence: "The wallet has not authorised this page for that account. Connect again and approve the account.", raw: null, message: msg };
  }
  if (code === 4902 || /unrecognized chain/i.test(msg)) {
    return { kind: "wallet", name: "UnrecognizedChain", selector: null, args: [], sentence: "The wallet does not know Base yet. Add Base (chain 8453) and try again.", raw: null, message: msg };
  }
  if (code === 4900 || code === 4901 || /disconnected/i.test(msg)) {
    return { kind: "wallet", name: "Disconnected", selector: null, args: [], sentence: "The wallet is not connected to Base right now. Reconnect it and try again.", raw: null, message: msg };
  }
  if (code === 4200 || /unsupported method|does not support/i.test(msg)) {
    return { kind: "wallet", name: "UnsupportedMethod", selector: null, args: [], sentence: "This wallet does not support the request. A desktop browser extension on Base is what this page needs.", raw: null, message: msg };
  }
  if (/insufficient funds|gas \* price \+ value|have \d+ want \d+/i.test(msg)) {
    return { kind: "wallet", name: "InsufficientFunds", selector: null, args: [], sentence: "Not enough ETH on Base to pay for gas, so nothing was sent. Add a little ETH on Base and try again.", raw: null, message: msg };
  }
  if (/intrinsic gas too low|gas required exceeds|out of gas/i.test(msg)) {
    return { kind: "wallet", name: "GasTooLow", selector: null, args: [], sentence: "The transaction was given too little gas. Try again; if the wallet suggested the limit, raise it.", raw: null, message: msg };
  }
  if (/nonce too low|replacement transaction underpriced|already known/i.test(msg)) {
    return { kind: "wallet", name: "NonceConflict", selector: null, args: [], sentence: "Another transaction from this wallet is still pending. Wait for it to confirm, or speed it up in the wallet, then try again.", raw: null, message: msg };
  }
  if (/rate limit|-32016|429|too many requests/i.test(msg)) {
    return { kind: "network", name: "RateLimited", selector: null, args: [], sentence: "Base's public endpoint is rate limiting this page. Wait a few seconds and try again.", raw: null, message: msg };
  }
  if (/failed to fetch|network ?error|timeout|timed out|ECONNRESET|Load failed/i.test(msg)) {
    return { kind: "network", name: "NetworkError", selector: null, args: [], sentence: "Base did not answer, so nothing was sent. Check your connection and try again.", raw: null, message: msg };
  }
  if (/execution reverted/i.test(msg)) {
    return { kind: "unknown", name: "Reverted", selector: null, args: [], sentence: "The contract rejected the transaction and did not say why. Nothing was changed; reload the page so it reads the round again, then try again.", raw: null, message: msg };
  }

  return {
    kind: "unknown",
    name: null,
    selector: null,
    args: [],
    // Never the bare word "error", never a hex string alone (cta-patterns.md section 7).
    sentence: msg
      ? `Something went wrong and nothing was sent: ${msg.split(" | ")[0]}`
      : "Something went wrong and nothing was sent. Try again.",
    raw: null,
    message: msg,
  };
}

/**
 * One sentence a person can act on, for any error this module or a wallet can produce.
 *
 * A BidError already carries a written sentence (they are authored above); anything else
 * goes through classifyRevert. Use classifyRevert directly when the caller needs the kind
 * or the error name as well.
 */
export function explainRevert(errorLike) {
  if (errorLike instanceof BidError && errorLike.message) return errorLike.message;
  return classifyRevert(errorLike).sentence;
}
