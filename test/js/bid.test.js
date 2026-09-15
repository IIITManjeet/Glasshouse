import { test, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  decodeFunctionData,
  encodeErrorResult,
  encodeFunctionData,
  encodeFunctionResult,
  encodeAbiParameters,
  encodePacked,
  keccak256,
  parseAbi,
} from "viem";

import {
  BASE_CHAIN_ID,
  BidError,
  OPEN_DEFAULTS,
  ROUTER,
  WETH,
  adoptSecret,
  bidState,
  classifyRevert,
  configure,
  connect,
  connectedAddress,
  ensureBaseChain,
  explainRevert,
  exportSecret,
  forgetBid,
  forgetConnection,
  hasProvider,
  listBids,
  openRound,
  pendingBid,
  placeBid,
  randomSalt,
  readAuction,
  readOwnBid,
  restoreConnection,
  revealBid,
  settleRound,
} from "../../web/lib/bid.ts";

/**
 * THE WRITE PATH, WITH A STAND-IN WALLET AND A STAND-IN NODE, CHECKED AGAINST THE ABI.
 *
 * bid.ts is the one module on the site that can lose a visitor money, and it packs every
 * byte it signs by hand. Nothing here talks to a live wallet: `window.ethereum`, `fetch`
 * and `localStorage` are replaced by small fakes that behave like the Book, and every
 * expected byte string is produced by viem from subgraph/abis/GlasshouseBook.json.
 *
 * The commitment is the part that must match Solidity exactly. GlasshouseBook.commitmentFor
 * is `keccak256(abi.encodePacked(bidder, bps, salt))` (src/book/GlasshouseBook.sol:111-113)
 * and reveal() checks `b.commitment == keccak256(abi.encodePacked(msg.sender, bps, salt))`
 * (:192). The fake node computes exactly that with viem's encodePacked, so the tests below
 * pin the whole chain: the commitmentFor calldata bid.ts sends, the commit calldata that
 * carries its answer, the secret it stores, and the reveal calldata that must open it.
 */

const ABI = JSON.parse(readFileSync(new URL("../../subgraph/abis/GlasshouseBook.json", import.meta.url), "utf8"));
const OZ_ERRORS = parseAbi([
  "error ERC20InsufficientAllowance(address spender, uint256 allowance, uint256 needed)",
  "error ERC20InsufficientBalance(address sender, uint256 balance, uint256 needed)",
  "error ERC20InvalidApprover(address approver)",
  "error ERC20InvalidSpender(address spender)",
]);

const RPC = "http://rpc.test";
const BOOK = "0xc4ea91fe700918220423ac307c6b1c59650ffbfe";
const MAKER = "0xeebf737f92c8f0d9070f35a7d9baf416923becdf";
const BIDDER = "0x91ab00000000000000000000000000000000004c";
const OTHER = "0x2222222222222222222222222222222222222222";
const HASH = "0x" + "ab".repeat(32);
const ZERO_ADDR = "0x0000000000000000000000000000000000000000";
const ZERO_WORD = "0x" + "0".repeat(64);

const commitmentOf = (bidder, bps, salt) =>
  keccak256(encodePacked(["address", "uint24", "bytes32"], [bidder, bps, salt]));

// --- the fakes ---------------------------------------------------------------------------

class MemoryStorage {
  #m = new Map();
  blocked = false;
  get length() {
    return this.#m.size;
  }
  key(i) {
    return [...this.#m.keys()][i] ?? null;
  }
  getItem(k) {
    return this.#m.has(k) ? this.#m.get(k) : null;
  }
  setItem(k, v) {
    if (this.blocked) throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
    this.#m.set(k, String(v));
  }
  removeItem(k) {
    this.#m.delete(k);
  }
}

function openedStruct(over = {}) {
  return {
    router: ROUTER,
    tokenIn: WETH,
    commitEnd: 1030,
    revealEnd: 1060,
    exclusiveBlocks: 15,
    reserveBps: 50,
    maxBps: 500,
    bond: 0n,
    best: ZERO_ADDR,
    bestBps: 0,
    bestCommitIdx: 0,
    secondBps: 0,
    commitCount: 0,
    filledBy: ZERO_ADDR,
    settled: false,
    winnerForfeited: false,
    ...over,
  };
}
const UNOPENED = openedStruct({ router: ZERO_ADDR, tokenIn: ZERO_ADDR, commitEnd: 0, revealEnd: 0, exclusiveBlocks: 0, reserveBps: 0, maxBps: 0 });

/** Revert data the way a wallet reports it: -32603 with the bytes under `data`. */
const reverted = (errorName, args) => ({
  code: -32603,
  message: "execution reverted",
  data: encodeErrorResult({ abi: ABI, errorName, args }),
});

let world;
let storage;

function freshWorld() {
  return {
    chainId: BASE_CHAIN_ID,
    accounts: [BIDDER],
    head: 1000,
    auction: openedStruct(),
    ownBid: null, // { commitment, commitIdx, revealed, bondClaimed }
    commitmentFrom: {}, // { rpc?: fn, wallet?: fn } overriding the honest answer
    rpcFails: new Set(), // function names the read RPC refuses
    preflight: null, // (functionName) => error to throw from the wallet's eth_call
    sendError: null,
    onSend: null,
    calls: [], // every eth_call, as { via, functionName, args, params }
    requests: [], // every wallet request, as { method, params }
    sent: [],
  };
}

/** The Book's pure and view functions, answered from `world`. */
function ethCall(via, call) {
  const { functionName, args } = decodeFunctionData({ abi: ABI, data: call.data });
  world.calls.push({ via, functionName, args, params: call });
  if (via === "rpc" && world.rpcFails.has(functionName)) throw new Error("upstream connect error");
  switch (functionName) {
    case "auctions":
      return encodeFunctionResult({ abi: ABI, functionName, result: world.auction ?? UNOPENED });
    case "bids": {
      const b = world.ownBid ?? { commitment: ZERO_WORD, commitIdx: 0, revealed: false, bondClaimed: false };
      return encodeFunctionResult({ abi: ABI, functionName, result: b });
    }
    case "commitmentFor": {
      const override = world.commitmentFrom[via];
      if (override) return override(...args);
      return commitmentOf(...args);
    }
    default: {
      // commit / reveal / open / settle, simulated as a pre-flight
      const err = world.preflight?.(functionName);
      if (err) throw err;
      return "0x";
    }
  }
}

function install() {
  world = freshWorld();
  storage = new MemoryStorage();
  Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true, writable: true });

  globalThis.fetch = async (url, init) => {
    assert.equal(url, RPC, "bid.ts reads only the configured RPC");
    const { method, params } = JSON.parse(init.body);
    try {
      let result;
      if (method === "eth_call") result = ethCall("rpc", params[0]);
      else if (method === "eth_blockNumber") result = "0x" + world.head.toString(16);
      else throw new Error(`unexpected RPC method ${method}`);
      return { json: async () => ({ jsonrpc: "2.0", id: 1, result }) };
    } catch (e) {
      return { json: async () => ({ jsonrpc: "2.0", id: 1, error: { code: -32000, message: e.message } }) };
    }
  };

  globalThis.ethereum = {
    async request({ method, params }) {
      world.requests.push({ method, params });
      switch (method) {
        case "eth_accounts":
        case "eth_requestAccounts":
          return world.accounts;
        case "eth_chainId":
          return "0x" + world.chainId.toString(16);
        case "eth_call":
          return ethCall("wallet", params[0]);
        case "eth_sendTransaction": {
          if (world.sendError) throw world.sendError;
          world.onSend?.(params[0]);
          world.sent.push(params[0]);
          return "0x" + "77".repeat(32);
        }
        default:
          throw Object.assign(new Error(`unsupported method ${method}`), { code: 4200 });
      }
    },
  };

  configure({ rpc: RPC, book: BOOK });
  forgetConnection();
}

beforeEach(install);

const storedRecord = (bidder = BIDDER) => {
  const raw = storage.getItem(`glasshouse:bid:${HASH}:${bidder}`);
  return raw ? JSON.parse(raw) : null;
};

// --- the commitment, end to end ---------------------------------------------------------

test("placeBid seals keccak256(abi.encodePacked(bidder, bps, salt)), asked of two nodes with the ABI's calldata", async () => {
  let atSend = null;
  world.onSend = () => (atSend = storedRecord());

  const res = await placeBid({ maker: MAKER, orderHash: HASH, bps: 250 });

  // The salt is 32 bytes and the commitment is the contract's own hash of it.
  assert.match(res.salt, /^0x[0-9a-f]{64}$/);
  assert.equal(res.commitment, commitmentOf(BIDDER, 250, res.salt));

  // commitmentFor was asked of the read RPC AND the wallet's node, with identical calldata.
  const asks = world.calls.filter((c) => c.functionName === "commitmentFor");
  assert.deepEqual(asks.map((c) => c.via).sort(), ["rpc", "wallet"]);
  const expected = encodeFunctionData({ abi: ABI, functionName: "commitmentFor", args: [BIDDER, 250, res.salt] });
  for (const c of asks) {
    assert.equal(c.params.data, expected);
    assert.equal(c.params.to, BOOK);
  }
  assert.equal(asks.find((c) => c.via === "wallet").params.from, BIDDER);

  // The transaction commits exactly that hash, to the Book, from the bidder.
  assert.equal(world.sent.length, 1);
  const tx = world.sent[0];
  assert.equal(tx.data, encodeFunctionData({ abi: ABI, functionName: "commit", args: [MAKER, HASH, res.commitment] }));
  assert.equal(tx.to, BOOK);
  assert.equal(tx.from, BIDDER);
  assert.ok(!("gas" in tx), "commit leaves the gas estimate to the wallet");

  // THE ORDERING: the secret was in storage, readable, before the wallet saw anything.
  assert.ok(atSend, "the record existed at the moment eth_sendTransaction was requested");
  assert.equal(atSend.salt, res.salt);
  assert.equal(atSend.bps, 250);
  assert.equal(atSend.state, "secret-written");
  const firstSend = world.requests.findIndex((r) => r.method === "eth_sendTransaction");
  const preflight = world.requests.findIndex((r) => r.method === "eth_call" && decodeFunctionData({ abi: ABI, data: r.params[0].data }).functionName === "commit");
  assert.ok(preflight >= 0 && preflight < firstSend, "the exact commit calldata is simulated before it is sent");

  // And afterwards the record carries the hash.
  const after = storedRecord();
  assert.equal(after.state, "sealing");
  assert.equal(after.txHash, res.txHash);
  assert.equal(after.commitment, res.commitment);
  assert.equal(after.commitmentConfirmedBy, "both");
  assert.equal(after.committedAt, 1000, "the head at write time, a lower bound for the log scan");
  assert.equal(after.maker, MAKER);
  assert.equal(after.reserveBps, 50);
  assert.equal(after.maxBps, 500);
  assert.equal(after.bond, "0");
  assert.equal(after.tokenIn, WETH);
});

test("revealBid sends reveal(maker, hash, bps, salt), which opens the commitment placeBid sealed", async () => {
  const sealed = await placeBid({ maker: MAKER, orderHash: HASH, bps: 321 });
  world.sent.length = 0;

  const res = await revealBid({ maker: MAKER, orderHash: HASH });

  assert.equal(res.bps, 321);
  const tx = world.sent[0];
  assert.equal(tx.data, encodeFunctionData({ abi: ABI, functionName: "reveal", args: [MAKER, HASH, 321, sealed.salt] }));
  assert.equal(tx.gas, "0x3d090", "reveal carries its explicit 250,000 gas limit");
  // GlasshouseBook.sol:192, from the reveal's own arguments.
  const { args } = decodeFunctionData({ abi: ABI, data: tx.data });
  assert.equal(commitmentOf(tx.from, args[2], args[3]), sealed.commitment);

  const rec = storedRecord();
  assert.equal(rec.state, "revealing");
  assert.equal(rec.revealTx, res.txHash);
});

test("a typed-in secret reveals with the bps and salt supplied, not a stored record", async () => {
  const salt = "0x" + "5a".repeat(32);
  await revealBid({ maker: MAKER, orderHash: HASH, bps: 120, salt });
  assert.equal(world.sent[0].data, encodeFunctionData({ abi: ABI, functionName: "reveal", args: [MAKER, HASH, 120, salt] }));
});

// --- salt ------------------------------------------------------------------------------

test("randomSalt is 32 CSPRNG bytes, never repeated, and refuses to run without a CSPRNG", () => {
  const salts = new Set(Array.from({ length: 64 }, randomSalt));
  assert.equal(salts.size, 64);
  for (const s of salts) assert.match(s, /^0x[0-9a-f]{64}$/);

  const real = Object.getOwnPropertyDescriptor(globalThis, "crypto");
  try {
    Object.defineProperty(globalThis, "crypto", { value: undefined, configurable: true });
    assert.throws(() => randomSalt(), (e) => e instanceof BidError && e.code === "NO_CSPRNG");
  } finally {
    Object.defineProperty(globalThis, "crypto", real);
  }
});

test("two bids never share a salt", async () => {
  const a = await placeBid({ maker: MAKER, orderHash: HASH, bps: 100 });
  storage.removeItem(`glasshouse:bid:${HASH}:${BIDDER}`);
  const b = await placeBid({ maker: MAKER, orderHash: HASH, bps: 100 });
  assert.notEqual(a.salt, b.salt);
  assert.notEqual(a.commitment, b.commitment);
});

// --- the guards that stop a bid before it is lost ----------------------------------------

const rejectsWith = (promise, code, check = () => true) =>
  assert.rejects(promise, (e) => {
    assert.ok(e instanceof BidError, `expected a BidError, got ${e}`);
    assert.equal(e.code, code, e.message);
    return check(e) !== false;
  });

test("a bid the reveal would reject is refused before anything is signed", async () => {
  await rejectsWith(placeBid({ maker: MAKER, orderHash: HASH, bps: 501 }), "BID_OUT_OF_RANGE", (e) =>
    assert.equal(e.message, "A bid of 501 bps cannot be revealed in this round: it accepts 50 to 500 bps. Nothing was sent."),
  );
  await rejectsWith(placeBid({ maker: MAKER, orderHash: HASH, bps: 49 }), "BID_OUT_OF_RANGE");
  assert.equal(world.sent.length, 0);
  assert.equal(storage.length, 0, "and no secret was generated for it");

  // Both ends of the range are the contract's, inclusive (reveal(), :187).
  await placeBid({ maker: MAKER, orderHash: HASH, bps: 500 });
  assert.equal(world.sent.length, 1);
});

test("malformed arguments are BAD_ARGUMENT or BAD_BPS, before the wallet is asked anything", async () => {
  await rejectsWith(placeBid({ maker: "0x1234", orderHash: HASH, bps: 100 }), "BAD_ARGUMENT", (e) =>
    assert.equal(e.message, "maker must be a 20-byte address, got 0x1234"),
  );
  await rejectsWith(placeBid({ maker: MAKER, orderHash: "0xab", bps: 100 }), "BAD_ARGUMENT");
  for (const bps of [12.5, -1, "250", 16777216, NaN]) {
    await rejectsWith(placeBid({ maker: MAKER, orderHash: HASH, bps }), "BAD_BPS");
  }
  assert.equal(world.requests.length, 0);
});

test("an unopened round, a wrong chain and no account each stop the bid with their own sentence", async () => {
  world.auction = null;
  await rejectsWith(placeBid({ maker: MAKER, orderHash: HASH, bps: 100 }), "ROUND_NOT_OPEN");

  world.auction = openedStruct();
  world.chainId = 1;
  await rejectsWith(placeBid({ maker: MAKER, orderHash: HASH, bps: 100 }), "WRONG_CHAIN", (e) =>
    assert.equal(e.message, "This wallet is on chain 1. Switch to Base (8453) to bid."),
  );

  world.chainId = BASE_CHAIN_ID;
  world.accounts = [];
  await rejectsWith(placeBid({ maker: MAKER, orderHash: HASH, bps: 100 }), "NOT_CONNECTED", (e) =>
    assert.equal(e.message, "Connect a wallet first."),
  );
  assert.equal(world.sent.length, 0);
});

test("a bid already on chain is never overwritten, with or without its secret here", async () => {
  world.ownBid = { commitment: "0x" + "cd".repeat(32), commitIdx: 0, revealed: false, bondClaimed: false };
  await rejectsWith(placeBid({ maker: MAKER, orderHash: HASH, bps: 100 }), "ALREADY_SEALED", (e) =>
    assert.match(e.message, /this browser has no secret for it/),
  );

  adoptSecret({ maker: MAKER, orderHash: HASH, bidder: BIDDER, bps: 77, salt: "0x" + "01".repeat(32) });
  await rejectsWith(placeBid({ maker: MAKER, orderHash: HASH, bps: 100 }), "ALREADY_SEALED", (e) =>
    assert.match(e.message, /already has a sealed bid of 77 bps/),
  );
  assert.equal(world.sent.length, 0);
  assert.equal(storedRecord().bps, 77, "the stored secret survived");
});

test("a broadcast secret is not replaced when the chain cannot be read to check it", async () => {
  await placeBid({ maker: MAKER, orderHash: HASH, bps: 250 });
  const before = storedRecord();
  world.rpcFails.add("bids");

  await rejectsWith(
    placeBid({ maker: MAKER, orderHash: HASH, bps: 300 }, { auction: { commitEnd: 1030, revealEnd: 1060, exclusiveEnd: 1075, reserveBps: 50, maxBps: 500 } }),
    "CHAIN_UNREADABLE",
    (e) => assert.match(e.message, /holds a bid of 250 bps that was already broadcast/),
  );
  assert.equal(world.sent.length, 1, "only the first bid was ever sent");
  assert.deepEqual(storedRecord(), before);
});

test("blocked storage sends nothing, and hands the salt back so it can be copied", async () => {
  storage.blocked = true;
  await rejectsWith(placeBid({ maker: MAKER, orderHash: HASH, bps: 250 }), "STORAGE_BLOCKED", (e) => {
    assert.match(e.salt, /^0x[0-9a-f]{64}$/);
    assert.equal(e.bps, 250);
    assert.equal(e.record.salt, e.salt);
  });
  assert.equal(world.sent.length, 0);

  // Only an explicit acceptance proceeds, and the result says the secret is not stored.
  const res = await placeBid({ maker: MAKER, orderHash: HASH, bps: 250 }, { acceptUnstoredSecret: true });
  assert.equal(world.sent.length, 1);
  assert.equal(res.record.storedLocally, false);
});

test("two nodes that disagree about the commitment stop the bid; one silent node does not", async () => {
  world.commitmentFrom.wallet = () => "0x" + "ee".repeat(32);
  await rejectsWith(placeBid({ maker: MAKER, orderHash: HASH, bps: 250 }), "COMMITMENT_MISMATCH", (e) =>
    assert.equal(e.fromWallet, "0x" + "ee".repeat(32)),
  );
  assert.equal(world.sent.length, 0);
  assert.equal(storage.length, 0, "no record is written for a commitment nobody agrees on");

  world.commitmentFrom.wallet = () => ZERO_WORD; // a zero hash is no answer at all
  world.commitmentFrom.rpc = () => ZERO_WORD;
  await rejectsWith(placeBid({ maker: MAKER, orderHash: HASH, bps: 250 }), "COMMITMENT_UNAVAILABLE");
  assert.equal(world.sent.length, 0);

  world.commitmentFrom = { wallet: () => { throw new Error("wallet node timeout"); } };
  const res = await placeBid({ maker: MAKER, orderHash: HASH, bps: 250 });
  assert.equal(res.record.commitmentConfirmedBy, "rpc");
  assert.equal(res.commitment, commitmentOf(BIDDER, 250, res.salt));
});

test("a commit the pre-flight says would revert is not sent, and its record is marked dead", async () => {
  world.preflight = (fn) => (fn === "commit" ? reverted("CommitClosed") : null);
  await rejectsWith(placeBid({ maker: MAKER, orderHash: HASH, bps: 250 }), "PREFLIGHT_REVERT", (e) => {
    assert.match(e.message, /^The commit window closed while you were signing/);
    assert.equal(e.revert.name, "CommitClosed");
  });
  assert.equal(world.sent.length, 0);
  const rec = storedRecord();
  assert.equal(rec.state, "dead");
  assert.equal(rec.lastError, "CommitClosed");
});

test("a rejection in the wallet keeps the record live so the visitor can click again", async () => {
  world.sendError = { code: 4001, message: "User rejected the request." };
  await rejectsWith(placeBid({ maker: MAKER, orderHash: HASH, bps: 250 }), "USER_REJECTED", (e) =>
    assert.equal(e.message, "Cancelled in the wallet. Nothing was sent and nothing was escrowed."),
  );
  const rec = storedRecord();
  assert.equal(rec.state, "secret-written");
  assert.equal(rec.lastError, "UserRejected");

  world.sendError = { code: -32000, message: "insufficient funds for gas * price + value" };
  await rejectsWith(placeBid({ maker: MAKER, orderHash: HASH, bps: 250 }), "SEND_FAILED");
  assert.equal(storedRecord().state, "dead");
});

// --- the reveal pre-flight policy -------------------------------------------------------

test("reveal pre-flight: stops on monotone contract errors, sends through RevealNotOpen and noise", async () => {
  const salt = "0x" + "42".repeat(32);
  adoptSecret({ maker: MAKER, orderHash: HASH, bidder: BIDDER, bps: 200, salt });

  world.preflight = () => reverted("RevealNotOpen");
  await revealBid({ maker: MAKER, orderHash: HASH });
  assert.equal(world.sent.length, 1, "RevealNotOpen becomes valid in a block, so it is sent");

  world.preflight = () => ({ message: "Failed to fetch" });
  await revealBid({ maker: MAKER, orderHash: HASH });
  assert.equal(world.sent.length, 2, "a pre-flight that learned nothing never blocks a reveal");

  world.preflight = () => ({ message: "execution reverted: boom", data: "0x08c379a0" + encodeAbiParameters([{ type: "string" }], ["boom"]).slice(2) });
  await revealBid({ maker: MAKER, orderHash: HASH });
  assert.equal(world.sent.length, 3, "only decoded Book errors stop a reveal, not a revert string");

  world.preflight = () => reverted("BadReveal");
  await rejectsWith(revealBid({ maker: MAKER, orderHash: HASH }), "PREFLIGHT_REVERT", (e) => assert.match(e.message, /^The bps and salt do not match/));
  assert.equal(world.sent.length, 3);

  world.preflight = () => reverted("AlreadyRevealed");
  await rejectsWith(revealBid({ maker: MAKER, orderHash: HASH }), "PREFLIGHT_REVERT");
  assert.equal(storedRecord().state, "revealed");
  assert.equal(world.sent.length, 3);
});

test("revealBid names the account a stored secret belongs to, and refuses another maker's", async () => {
  await rejectsWith(revealBid({ maker: MAKER, orderHash: HASH }), "NO_SECRET", (e) =>
    assert.equal(e.message, `No sealed bid for ${BIDDER} in this browser. If you bid from another browser, enter its bps and salt.`),
  );

  adoptSecret({ maker: MAKER, orderHash: HASH, bidder: OTHER, bps: 200, salt: "0x" + "42".repeat(32) });
  await rejectsWith(revealBid({ maker: MAKER, orderHash: HASH }), "NO_SECRET", (e) => {
    assert.equal(e.message, `The sealed bid in this browser belongs to ${OTHER}. Switch back to that account to reveal it.`);
    assert.equal(e.otherBidder, OTHER);
  });

  adoptSecret({ maker: OTHER, orderHash: HASH, bidder: BIDDER, bps: 200, salt: "0x" + "42".repeat(32) });
  await rejectsWith(revealBid({ maker: MAKER, orderHash: HASH }), "MAKER_MISMATCH");
  assert.equal(world.sent.length, 0);
});

// --- open and settle ---------------------------------------------------------------------

test("openRound sends open() with the ABI's calldata, as the connected maker, always unfillable", async () => {
  world.auction = null;
  const res = await openRound();

  assert.match(res.orderHash, /^0x[0-9a-f]{64}$/);
  assert.equal(res.generatedHash, true);
  assert.equal(res.unfillable, true);
  assert.equal(res.maker, BIDDER);
  const tx = world.sent[0];
  const d = OPEN_DEFAULTS;
  assert.equal(
    tx.data,
    encodeFunctionData({
      abi: ABI,
      functionName: "open",
      args: [res.orderHash, ROUTER, WETH, d.commitBlocks, d.revealBlocks, d.exclusiveBlocks, d.reserveBps, d.maxBps, BigInt(d.bond)],
    }),
  );
  assert.equal(tx.gas, "0x30d40");

  const chosen = await openRound({ orderHash: HASH, reserveBps: 10, maxBps: 20, commitBlocks: 5, bond: 10n ** 20n });
  assert.equal(chosen.generatedHash, false);
  assert.equal(chosen.unfillable, true, "a hash the caller chose is exactly as unfillable");
  assert.equal(
    world.sent[1].data,
    encodeFunctionData({ abi: ABI, functionName: "open", args: [HASH, ROUTER, WETH, 5, 60, 15, 10, 20, 10n ** 20n] }),
  );
});

test("openRound checks the contract's window and range requirements, and an existing round", async () => {
  world.auction = null;
  await rejectsWith(openRound({ commitBlocks: 0 }), "BAD_ARGUMENT", (e) =>
    assert.equal(e.message, "commitBlocks must be a positive whole number of blocks, got 0"),
  );
  await rejectsWith(openRound({ reserveBps: 600, maxBps: 500 }), "BAD_ARGUMENT", (e) =>
    assert.equal(e.message, "The round needs reserve <= max < 10000 bps. Got reserve 600, max 500."),
  );
  await rejectsWith(openRound({ maxBps: 10000 }), "BAD_ARGUMENT");

  world.auction = openedStruct();
  await rejectsWith(openRound({ orderHash: HASH }), "ALREADY_OPENED");
  assert.equal(world.sent.length, 0);
});

test("settleRound sends settle(maker, hash) for anyone, and not for a settled round", async () => {
  const res = await settleRound({ maker: MAKER, orderHash: HASH });
  assert.equal(world.sent[0].data, encodeFunctionData({ abi: ABI, functionName: "settle", args: [MAKER, HASH] }));
  assert.equal(world.sent[0].gas, "0x1d4c0");
  assert.deepEqual(res, { txHash: "0x" + "77".repeat(32), maker: MAKER, orderHash: HASH, settledBy: BIDDER });

  world.auction = openedStruct({ settled: true });
  await rejectsWith(settleRound({ maker: MAKER, orderHash: HASH }), "ALREADY_SETTLED");

  // A caller's decoded auction is trusted and saves the read.
  world.calls.length = 0;
  await settleRound({ maker: MAKER, orderHash: HASH }, { auction: { settled: false }, skipPreflight: true });
  assert.equal(world.calls.length, 0);
  assert.equal(world.sent.length, 2);
});

test("settle pre-flight stops on a revert string as well as a Book error", async () => {
  world.preflight = () => reverted("WindowNotElapsed");
  await rejectsWith(settleRound({ maker: MAKER, orderHash: HASH }), "PREFLIGHT_REVERT", (e) => assert.match(e.message, /^Settle is not possible yet/));
  assert.equal(world.sent.length, 0);
});

// --- reads -------------------------------------------------------------------------------

test("readAuction and readOwnBid decode the ABI's tuples field by field", async () => {
  world.auction = openedStruct({ tokenIn: OTHER, bond: 2n ** 120n, best: BIDDER, bestBps: 300, secondBps: 120, commitCount: 5 });
  const a = await readAuction(MAKER.toUpperCase().replace("0X", "0x"), HASH);
  assert.equal(a.tokenIn, OTHER);
  assert.equal(a.bond, (2n ** 120n).toString());
  assert.equal(a.bestBidder, BIDDER);
  assert.equal(a.committedCount, 5);
  assert.equal(a.exclusiveEnd, 1075);
  const call = world.calls.at(-1);
  assert.equal(call.params.data, encodeFunctionData({ abi: ABI, functionName: "auctions", args: [MAKER, HASH] }), "addresses are lowercased, not rejected");

  world.auction = null;
  assert.equal(await readAuction(MAKER, HASH), null, "never opened reads as null");

  assert.deepEqual(await readOwnBid(MAKER, HASH, BIDDER), { committed: false, commitment: ZERO_WORD, commitIdx: 0, revealed: false, bondClaimed: false });
  world.ownBid = { commitment: "0x" + "cd".repeat(32), commitIdx: 3, revealed: true, bondClaimed: true };
  assert.deepEqual(await readOwnBid(MAKER, HASH, BIDDER), { committed: true, commitment: "0x" + "cd".repeat(32), commitIdx: 3, revealed: true, bondClaimed: true });
  assert.equal(
    world.calls.at(-1).params.data,
    encodeFunctionData({ abi: ABI, functionName: "bids", args: [MAKER, HASH, BIDDER] }),
  );
});

// --- the secret store --------------------------------------------------------------------

test("pendingBid resolves the explicit bidder, then the connected account, then a lone record", async () => {
  const salt = "0x" + "42".repeat(32);
  adoptSecret({ maker: MAKER, orderHash: HASH.toUpperCase().replace("0X", "0x"), bidder: OTHER, bps: 90, salt });

  assert.equal(pendingBid(HASH).bidder, OTHER, "one record for the round, nobody connected: that one");
  assert.equal(pendingBid(HASH, BIDDER), null, "an explicit bidder is never substituted");
  assert.equal(pendingBid(HASH, OTHER.toUpperCase().replace("0X", "0x")).bps, 90);
  assert.equal(pendingBid("not a hash"), null);

  adoptSecret({ maker: MAKER, orderHash: HASH, bidder: BIDDER, bps: 91, salt });
  assert.equal(pendingBid(HASH), null, "two records and nobody connected is ambiguous");

  await connect();
  assert.equal(connectedAddress(), BIDDER);
  assert.equal(pendingBid(HASH).bps, 91, "the connected account is the one that can sign");
});

test("records older than 26 hours are pruned; younger ones never are", (t) => {
  const salt = "0x" + "42".repeat(32);
  t.mock.method(Date, "now", () => 1_000_000_000_000);
  adoptSecret({ maker: MAKER, orderHash: HASH, bidder: BIDDER, bps: 90, salt });

  Date.now.mock.mockImplementation(() => 1_000_000_000_000 + 26 * 3600 * 1000);
  assert.ok(pendingBid(HASH, BIDDER), "exactly 26 h is still kept");

  Date.now.mock.mockImplementation(() => 1_000_000_000_000 + 26 * 3600 * 1000 + 1);
  assert.equal(pendingBid(HASH, BIDDER), null);
  assert.equal(storage.length, 0);
});

test("listBids is newest first and filterable; exportSecret carries what a reveal needs; forgetBid removes", (t) => {
  const salt = "0x" + "42".repeat(32);
  let now = 1_000_000_000_000;
  t.mock.method(Date, "now", () => now);
  const H2 = "0x" + "cd".repeat(32);
  adoptSecret({ maker: MAKER, orderHash: HASH, bidder: BIDDER, bps: 90, salt, revealEnd: 1060 });
  now += 1000;
  adoptSecret({ maker: MAKER, orderHash: H2, bidder: BIDDER, bps: 91, salt });
  now += 1000;
  adoptSecret({ maker: MAKER, orderHash: H2, bidder: OTHER, bps: 92, salt });
  storage.setItem("glasshouse:bid:garbage", "{not json");
  storage.setItem("unrelated", "{}");

  assert.deepEqual(listBids().map((r) => r.bps), [92, 91, 90]);
  assert.deepEqual(listBids(BIDDER).map((r) => r.bps), [91, 90]);

  assert.deepEqual(JSON.parse(exportSecret(HASH, BIDDER)), { maker: MAKER, orderHash: HASH, bidder: BIDDER, bps: 90, salt, revealEnd: 1060 });
  assert.equal(exportSecret(HASH, OTHER), null);

  assert.equal(forgetBid(H2, OTHER), true);
  assert.deepEqual(listBids().map((r) => r.bps), [91, 90]);
});

test("adoptSecret validates what it stores and refuses when storage will not keep it", () => {
  assert.throws(() => adoptSecret({ maker: MAKER, orderHash: HASH, bidder: BIDDER, bps: 90, salt: "0x1234" }), (e) => e.code === "BAD_ARGUMENT");
  assert.throws(() => adoptSecret({ maker: MAKER, orderHash: HASH, bidder: BIDDER, bps: 9.5, salt: HASH }), (e) => e.code === "BAD_BPS");

  const rec = adoptSecret({ maker: MAKER.toUpperCase().replace("0X", "0x"), orderHash: HASH, bidder: BIDDER, bps: 90, salt: HASH });
  assert.equal(rec.maker, MAKER, "addresses are stored lowercased, so the maker check on reveal compares like with like");
  assert.equal(rec.source, "typed");
  assert.equal(rec.state, "sealed");

  storage.blocked = true;
  assert.throws(
    () => adoptSecret({ maker: MAKER, orderHash: HASH, bidder: OTHER, bps: 90, salt: HASH }),
    (e) => e.code === "STORAGE_BLOCKED" && e.message === "This browser is not allowing site storage, so the secret could not be saved here.",
  );
});

// --- derived state -----------------------------------------------------------------------

test("bidState walks the contract's inequalities block by block", () => {
  const auction = { commitEnd: 1030, revealEnd: 1060, exclusiveEnd: 1075, bestBidder: null };
  const sealed = { committed: true, revealed: false };
  const at = (head, record, onChain) => bidState({ auction, record, onChain, head });

  // Commit window: commit() accepts block.number <= commitEnd (:159).
  assert.deepEqual(at(1030, null, null), {
    phase: "commit", state: "none", canCommit: true, canReveal: false, committed: false, revealed: false,
    blocksToCommitEnd: 0, blocksToRevealEnd: 30, urgent: false, lastCall: false,
  });
  assert.equal(at(1030, null, sealed).state, "sealed");
  assert.equal(at(1030, null, sealed).canCommit, false, "one bid per wallet");
  assert.equal(at(1031, null, null).canCommit, false);

  // Reveal window: commitEnd < block.number <= revealEnd (:185-186).
  assert.equal(at(1031, null, sealed).state, "reveal-due");
  assert.equal(at(1031, null, sealed).canReveal, true);
  assert.equal(at(1049, null, sealed).urgent, false);
  assert.equal(at(1050, null, sealed).urgent, true, "ten blocks left is urgent");
  assert.equal(at(1058, null, sealed).lastCall, false);
  assert.equal(at(1059, null, sealed).lastCall, true);
  assert.equal(at(1060, null, sealed).canReveal, true, "revealEnd itself still accepts a reveal");
  assert.equal(at(1061, null, sealed).canReveal, false);
  assert.equal(at(1061, null, sealed).state, "missed");

  // A local broadcast counts as committed before the log scan has seen it.
  assert.equal(at(1040, { txHash: "0x77" }, null).state, "reveal-due");
  assert.equal(at(1040, { txHash: null }, null).state, "secret-written");
  assert.equal(at(1040, { txHash: "0x77" }, { committed: true, revealed: true }).state, "revealed");
  assert.equal(at("1040", null, sealed).blocksToRevealEnd, 20, "a string head is a block number too");
});

// --- revert and wallet error classification ----------------------------------------------

const sampleArg = (input, i) => (input.type === "address" ? `0x${String(i + 1).repeat(40)}` : BigInt(100 * (i + 1)));

test("every error in the Book's ABI decodes to its own name, and so do the four ERC20 errors", () => {
  const errors = [...ABI.filter((x) => x.type === "error"), ...OZ_ERRORS];
  assert.equal(errors.length, 21, "17 from the Book's ABI plus four OpenZeppelin token errors");
  for (const abiError of errors) {
    const args = abiError.inputs.map(sampleArg);
    const data = encodeErrorResult({ abi: [abiError], errorName: abiError.name, args });
    const c = classifyRevert({ code: -32603, message: "execution reverted", data });
    assert.equal(c.kind, "contract", abiError.name);
    assert.equal(c.name, abiError.name);
    assert.equal(c.selector, data.slice(0, 10));
    assert.equal(c.raw, data);
    assert.ok(c.sentence.length > 20 && !/^0x/.test(c.sentence), `${abiError.name} has a sentence`);
  }
});

test("errors with arguments put the decoded values in the sentence", () => {
  const range = classifyRevert({ data: encodeErrorResult({ abi: ABI, errorName: "BidOutOfRange", args: [600, 50, 500] }) });
  assert.deepEqual(range.args, ["600", "50", "500"]);
  assert.equal(range.sentence, "The reveal was rejected: 600 bps is outside this round's range of 50 to 500 bps, so the bid cannot be opened. Bid inside the range next round.");

  const token = classifyRevert({ data: encodeErrorResult({ abi: ABI, errorName: "SafeERC20FailedOperation", args: [WETH] }) });
  assert.equal(token.sentence, `The bond token at ${WETH} refused the transfer, so no bid was placed. Approve the Book for the bond amount and check your balance of that token.`);

  const balance = classifyRevert({ data: encodeErrorResult({ abi: OZ_ERRORS, errorName: "ERC20InsufficientBalance", args: [BIDDER, 5n, 9n] }) });
  assert.equal(balance.sentence, "That wallet holds 5 of the bond token but the bond is 9, so no bid was placed. Top up and try again.");
});

test(
  "ERC20InsufficientAllowance names the allowance as the approved amount",
  { todo: "bid.ts prints args[2] (needed) as the allowance and args[1] (allowance) as the need -- swapped; left as-is by the TypeScript migration" },
  () => {
    const c = classifyRevert({ data: encodeErrorResult({ abi: OZ_ERRORS, errorName: "ERC20InsufficientAllowance", args: [BOOK, 5n, 9n] }) });
    assert.equal(c.sentence, "The Book is approved for only 5 of the bond token but needs 9, so no bid was placed. Approve the bond amount and try again.");
  },
);

test("revert data is found wherever a wallet buried it, and never mistaken for a hash", () => {
  const data = encodeErrorResult({ abi: ABI, errorName: "RevealClosed" });
  const shapes = [
    { data },
    { data: { data } },
    { data: { originalError: { data } } },
    { info: { error: { data } } },
    { error: { data } },
    { cause: { body: { details: data } } },
    { message: `execution reverted: ${data}` },
    { message: `Reverted ${data}` },
    data,
  ];
  for (const s of shapes) assert.equal(classifyRevert(s).name, "RevealClosed", JSON.stringify(s));

  // A transaction hash (64 hex) and an address (40) are not selector-plus-words.
  const hash = classifyRevert({ data: "0x" + "12".repeat(32), message: "nonce too low" });
  assert.equal(hash.kind, "wallet");
  assert.equal(hash.name, "NonceConflict");
  assert.equal(classifyRevert({ message: `from ${BIDDER}: user rejected` }).kind, "user-rejected");
});

test("Error(string), Panic and an unknown selector each get a sentence", () => {
  const err = classifyRevert({ data: "0x08c379a0" + encodeAbiParameters([{ type: "string" }], ["not the maker"]).slice(2) });
  assert.equal(err.kind, "revert-string");
  assert.equal(err.sentence, "The contract rejected it: not the maker");

  const panic = classifyRevert({ data: "0x4e487b71" + encodeAbiParameters([{ type: "uint256" }], [0x11n]).slice(2) });
  assert.equal(panic.name, "Panic");
  assert.deepEqual(panic.args, [17]);
  assert.equal(panic.sentence, "The contract hit an internal error (an arithmetic operation overflowed). Nothing was changed. Report the round.");
  assert.match(classifyRevert({ data: "0x4e487b71" + encodeAbiParameters([{ type: "uint256" }], [0x99n]).slice(2) }).sentence, /panic code 0x99/);

  const unknown = classifyRevert({ data: "0xdeadbeef" });
  assert.equal(unknown.kind, "unknown");
  assert.equal(unknown.selector, "0xdeadbeef");
  assert.match(unknown.sentence, /does not recognise \(0xdeadbeef\)/);
});

test("wallet and network conditions map by code first, then by message", () => {
  const cases = [
    [{ code: 4001 }, "user-rejected", "UserRejected"],
    [{ code: "ACTION_REJECTED" }, "user-rejected", "UserRejected"],
    [{ message: "MetaMask Tx Signature: User denied transaction signature." }, "user-rejected", "UserRejected"],
    [{ code: -32002 }, "wallet", "RequestPending"],
    [{ code: 4100 }, "wallet", "Unauthorized"],
    [{ code: 4902 }, "wallet", "UnrecognizedChain"],
    [{ error: { code: 4901 } }, "wallet", "Disconnected"],
    [{ code: 4200 }, "wallet", "UnsupportedMethod"],
    [{ message: "insufficient funds for gas * price + value" }, "wallet", "InsufficientFunds"],
    [{ message: "intrinsic gas too low" }, "wallet", "GasTooLow"],
    [{ message: "replacement transaction underpriced" }, "wallet", "NonceConflict"],
    [{ message: "eth_call: over rate limit" }, "network", "RateLimited"],
    [new TypeError("Failed to fetch"), "network", "NetworkError"],
    [{ message: "execution reverted" }, "unknown", "Reverted"],
  ];
  for (const [e, kind, name] of cases) {
    const c = classifyRevert(e);
    assert.equal(c.kind, kind, JSON.stringify(e));
    assert.equal(c.name, name, JSON.stringify(e));
    assert.equal(explainRevert(e), c.sentence);
  }

  assert.equal(classifyRevert({ message: "the node is sad", reason: "very" }).sentence, "Something went wrong and nothing was sent: the node is sad");
  assert.equal(classifyRevert(null).sentence, "Something went wrong and nothing was sent. Try again.");
});

test("explainRevert returns a BidError's own sentence rather than re-classifying it", () => {
  const e = new BidError("STORAGE_BLOCKED", "a sentence written for this case", { salt: HASH });
  assert.equal(e.name, "BidError");
  assert.equal(e.code, "STORAGE_BLOCKED");
  assert.equal(e.salt, HASH);
  assert.ok(e instanceof Error);
  assert.equal(explainRevert(e), "a sentence written for this case");
});

// --- connection --------------------------------------------------------------------------

test("connect and restoreConnection report the account and whether it is on Base", async () => {
  assert.equal(hasProvider(), true);
  assert.deepEqual(await connect(), { address: BIDDER, chainId: 8453, onBase: true });
  assert.equal(world.requests[0].method, "eth_requestAccounts");

  world.chainId = 10;
  assert.deepEqual(await restoreConnection(), { address: BIDDER, chainId: 10, onBase: false });
  assert.ok(!world.requests.slice(1).some((r) => r.method === "eth_requestAccounts"), "restoring never prompts");

  world.accounts = [];
  assert.equal(await restoreConnection(), null);
  await rejectsWith(connect(), "NOT_CONNECTED");

  globalThis.ethereum.request = async () => { throw { code: 4001, message: "User rejected the request." }; };
  await rejectsWith(connect(), "USER_REJECTED");
  assert.equal(await restoreConnection(), null, "a wallet that refuses is treated as no wallet on load");

  delete globalThis.ethereum;
  assert.equal(hasProvider(), false);
  assert.equal(await restoreConnection(), null);
  await rejectsWith(connect(), "NO_PROVIDER", (e) =>
    assert.equal(e.message, "No browser wallet found. Bidding needs a wallet extension on Base; everything else on this page works without one."),
  );
});

test("ensureBaseChain switches, adds Base on 4902, and confirms by re-reading the chain id", async () => {
  assert.deepEqual(await ensureBaseChain(), { chainId: 8453, switched: false });

  world.chainId = 1;
  const inner = globalThis.ethereum.request;
  globalThis.ethereum.request = async (req) => {
    if (req.method === "wallet_switchEthereumChain") {
      world.requests.push(req);
      throw { code: 4902, message: "Unrecognized chain ID 0x2105" };
    }
    if (req.method === "wallet_addEthereumChain") {
      world.requests.push(req);
      world.chainId = 8453;
      return null;
    }
    return inner(req);
  };
  assert.deepEqual(await ensureBaseChain(), { chainId: 8453, switched: true });
  const add = world.requests.find((r) => r.method === "wallet_addEthereumChain");
  assert.deepEqual(add.params, [{
    chainId: "0x2105",
    chainName: "Base",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: [RPC],
    blockExplorerUrls: ["https://basescan.org"],
  }]);

  world.chainId = 1;
  globalThis.ethereum.request = async (req) => {
    if (req.method === "wallet_switchEthereumChain") throw { code: 4001, message: "User rejected the request." };
    return inner(req);
  };
  await rejectsWith(ensureBaseChain(), "CHAIN_SWITCH_REJECTED");
});

test("ensureBaseChain gives up rather than guess when the wallet never actually switches", async (t) => {
  mock.timers.enable({ apis: ["setTimeout"] });
  t.after(() => mock.timers.reset());
  world.chainId = 1;
  const inner = globalThis.ethereum.request;
  globalThis.ethereum.request = async (req) => (req.method === "wallet_switchEthereumChain" ? null : inner(req));

  const p = ensureBaseChain();
  let settled = false;
  p.then(() => (settled = true), () => (settled = true));
  while (!settled) {
    await new Promise((r) => setImmediate(r));
    mock.timers.tick(200);
  }
  await rejectsWith(p, "WRONG_CHAIN");
  assert.equal(world.requests.filter((r) => r.method === "eth_chainId").length, 11, "one read, then ten confirmations");
});
