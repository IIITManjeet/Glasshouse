import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  encodeAbiParameters,
  encodeFunctionData,
  encodeFunctionResult,
  decodeFunctionData,
  toEventSelector,
} from "viem";

import { AUCTION_WORD, bidsFor, chainHead, decodeAuction, fromChain } from "../../web/lib/chain.ts";

/**
 * THE READ PATH, CHECKED AGAINST THE ABI RATHER THAN AGAINST ITSELF.
 *
 * chain.ts packs calldata and reads return words by hand, with no ABI library in the
 * bundle. That is a deliberate trade, and its cost is that nothing about the hand-packing
 * is checked by a compiler: a selector, a topic or a word index that drifts from the
 * contract still type-checks. So every fixture here is produced by viem from
 * subgraph/abis/GlasshouseBook.json -- the compiled ABI -- and the module under test only
 * ever sees bytes. If the ABI changes and chain.ts does not, these fail.
 *
 * The RPC fallback pool is the other half: a caller-chosen endpoint must be honoured
 * exactly (DEPLOY.md, NEXT_PUBLIC_RPC_URL), and the default must rotate on a rate limit but
 * NOT on a real chain error. Both are asserted by counting which URLs were asked.
 */

const ABI = JSON.parse(readFileSync(new URL("../../subgraph/abis/GlasshouseBook.json", import.meta.url), "utf8"));

const DEFAULT_RPC = "https://mainnet.base.org";
const TENDERLY = "https://base.gateway.tenderly.co";
const CUSTOM = "http://127.0.0.1:8545";

const BOOK = "0xc4ea91fe700918220423ac307c6b1c59650ffbfe";
const MAKER = "0xeebf737f92c8f0d9070f35a7d9baf416923becdf";
const HASH = "0x" + "ab".repeat(32);

/** An Auction struct where every field holds a value no other field holds. */
function distinctStruct(over = {}) {
  return {
    router: "0x5c3bae054e8b4915a13726b397b1aea864247dbf",
    tokenIn: "0x4200000000000000000000000000000000000006",
    commitEnd: 51008641,
    revealEnd: 51008671,
    exclusiveBlocks: 15,
    reserveBps: 50,
    maxBps: 500,
    bond: 2n ** 100n + 7n, // past Number.MAX_SAFE_INTEGER, as a uint128 may be
    best: "0x1111111111111111111111111111111111111111",
    bestBps: 400,
    bestCommitIdx: 3,
    secondBps: 250,
    commitCount: 4,
    filledBy: "0x2222222222222222222222222222222222222222",
    settled: true,
    winnerForfeited: true,
    ...over,
  };
}

const auctionsResult = (struct) => encodeFunctionResult({ abi: ABI, functionName: "auctions", result: struct });

/**
 * Stand-in JSON-RPC endpoints. `handlers` maps a URL to a function of (method, params)
 * that returns a result or throws a JSON-RPC error message; every request is logged.
 */
function endpoints(handlers) {
  const log = [];
  globalThis.fetch = async (url, init) => {
    const { method, params } = JSON.parse(init.body);
    log.push({ url, method, params });
    const h = handlers[url];
    if (!h) throw new TypeError(`fetch failed (${url} is not a test endpoint)`);
    try {
      const result = await h(method, params);
      return { json: async () => ({ jsonrpc: "2.0", id: 1, result }) };
    } catch (e) {
      if (e instanceof TypeError) throw e; // transport failure: fetch itself rejects
      return { json: async () => ({ jsonrpc: "2.0", id: 1, error: { code: -32000, message: e.message } }) };
    }
  };
  return log;
}

/** Run a promise to completion while fast-forwarding the backoff timers it waits on. */
async function drive(promise) {
  let settled = false;
  promise.then(
    () => (settled = true),
    () => (settled = true),
  );
  while (!settled) {
    await new Promise((r) => setImmediate(r));
    mock.timers.tick(10_000);
  }
  return promise;
}

// --- decoding ------------------------------------------------------------------------

test("the word map is the ABI's Auction tuple, in the ABI's order", () => {
  const fn = ABI.find((x) => x.type === "function" && x.name === "auctions");
  const components = fn.outputs[0].components.map((c) => c.name);
  assert.deepEqual(Object.keys(AUCTION_WORD), components);
  components.forEach((name, i) => assert.equal(AUCTION_WORD[name], i, `${name} is word ${i}`));
});

test("decodeAuction reads each struct field from its own word, as the ABI encodes it", () => {
  const s = distinctStruct();
  const a = decodeAuction(auctionsResult(s));
  assert.deepEqual(a, {
    commitEnd: s.commitEnd,
    revealEnd: s.revealEnd,
    exclusiveEnd: s.revealEnd + s.exclusiveBlocks,
    reserveBps: s.reserveBps,
    maxBps: s.maxBps,
    bond: s.bond.toString(),
    bestBidder: s.best,
    bestBps: s.bestBps,
    secondBps: s.secondBps,
    committedCount: s.commitCount,
    filledBy: s.filledBy,
    filled: true,
    settled: true,
    winnerForfeited: true,
  });
});

test("decodeAuction: zero addresses are nobody, false flags are false", () => {
  const zero = "0x0000000000000000000000000000000000000000";
  const a = decodeAuction(auctionsResult(distinctStruct({ best: zero, filledBy: zero, settled: false, winnerForfeited: false, bond: 0n })));
  assert.equal(a.bestBidder, null);
  assert.equal(a.filledBy, null);
  assert.equal(a.filled, false);
  assert.equal(a.settled, false);
  assert.equal(a.winnerForfeited, false);
  assert.equal(a.bond, "0");
});

// --- the log scan ----------------------------------------------------------------------

const BIDDER_A = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const BIDDER_B = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const BIDDER_C = "0xcccccccccccccccccccccccccccccccccccccccc";
const topicOf = (name) => toEventSelector(ABI.find((x) => x.type === "event" && x.name === name));
const addrTopic = (a) => "0x" + a.slice(2).padStart(64, "0");

function eventLog(name, bidder, block, tx, data = "0x") {
  return {
    topics: [topicOf(name), addrTopic(MAKER), HASH, addrTopic(bidder)],
    data,
    blockNumber: "0x" + block.toString(16),
    transactionHash: tx,
  };
}
const committed = (bidder, block, idx, tx) =>
  eventLog("BidCommitted", bidder, block, tx, encodeAbiParameters([{ type: "uint40" }], [idx]));
const revealed = (bidder, block, bps, tx) =>
  eventLog("BidRevealed", bidder, block, tx, encodeAbiParameters([{ type: "uint24" }, { type: "uint128" }], [bps, 0n]));

test("bidsFor recognises the ABI's BidCommitted and BidRevealed topics and nothing else", async () => {
  const logs = [
    committed(BIDDER_B, 100, 0, "0xc0"),
    committed(BIDDER_A, 101, 1, "0xc1"),
    committed(BIDDER_B, 102, 2, "0xdup"), // a second sighting never re-orders or overwrites
    revealed(BIDDER_A, 140, 400, "0xr1"),
    revealed(BIDDER_C, 141, 999, "0xr2"), // a reveal with no commit in range is not a bidder
    // AuctionFilled also carries an address in topics[3]; it is not a bid.
    { ...eventLog("AuctionFilled", BIDDER_C, 150, "0xf"), data: "0x" },
    { topics: [topicOf("AuctionSettled"), addrTopic(MAKER), HASH], data: "0x", blockNumber: "0x99" },
  ];
  const log = endpoints({ [CUSTOM]: (method) => (method === "eth_getLogs" ? logs : null) });

  const bids = await bidsFor(CUSTOM, BOOK, HASH, -5, 200);

  assert.deepEqual(bids, [
    { bidder: BIDDER_B, commitIdx: 0, committedAtBlock: 100, bps: null, commitTx: "0xc0", revealTx: null },
    { bidder: BIDDER_A, commitIdx: 1, committedAtBlock: 101, bps: 400, commitTx: "0xc1", revealTx: "0xr1" },
  ]);
  assert.equal(log.length, 1, "one eth_getLogs, nothing else");
  assert.deepEqual(log[0].params, [
    { address: BOOK, fromBlock: "0x0", toBlock: "0xc8", topics: [null, null, HASH] },
  ], "fromBlock is clamped at 0 and the scan is filtered by order hash in topic 2");
});

// --- fromChain -------------------------------------------------------------------------

test("fromChain asks auctions(maker, hash) with the ABI's calldata, pinned to one head", async () => {
  const HEAD = 51008700;
  const manifest = { maker: MAKER, rounds: [{ round: 7, orderHash: HASH }] };
  const s = distinctStruct({ settled: false, winnerForfeited: false });
  const scans = [];
  const log = endpoints({
    [CUSTOM]: (method, params) => {
      if (method === "eth_blockNumber") return "0x" + HEAD.toString(16);
      if (method === "eth_call") {
        const { functionName, args } = decodeFunctionData({ abi: ABI, data: params[0].data });
        assert.equal(functionName, "auctions");
        assert.equal(params[0].to, BOOK);
        assert.equal(params[1], "0x" + HEAD.toString(16), "every read is pinned to the head block");
        assert.equal(params[0].data, encodeFunctionData({ abi: ABI, functionName: "auctions", args }));
        return auctionsResult(s);
      }
      if (method === "eth_getLogs") {
        scans.push(params[0]);
        return [committed(BIDDER_A, s.commitEnd - 10, 0, "0xc"), revealed(BIDDER_A, s.commitEnd + 3, 400, "0xr")];
      }
    },
  });

  const board = await fromChain({ rpc: CUSTOM, book: BOOK, manifest, limit: 6 });

  assert.equal(board.source, "chain");
  assert.equal(board.head, HEAD);
  assert.equal(board.auctions.length, 1);
  const a = board.auctions[0];
  assert.equal(a.orderHash, HASH);
  assert.equal(a.maker, MAKER, "the maker comes from the manifest: it is not in the struct");
  assert.equal(a.round, 7);
  assert.equal(a.openedAtBlock, s.commitEnd - 60);
  assert.equal(a.clearingBps, 250, "a winner clears at max(secondBps, reserveBps)");
  assert.equal(a.settlementMatchesDerivation, null, "only the subgraph can answer that");
  assert.equal(a.revealedCount, 1);
  assert.equal(a.bids.length, 1);
  assert.deepEqual(scans[0].fromBlock, "0x" + (s.commitEnd - 60).toString(16));
  assert.deepEqual(
    scans[0].toBlock,
    "0x" + Math.min(HEAD, s.revealEnd + s.exclusiveBlocks + 5).toString(16),
    "the scan stops at the head or five blocks past the exclusive window, whichever is first",
  );
  assert.ok(log.every((l) => l.url === CUSTOM));
});

test("fromChain: no winner clears at nothing, and a failed log scan is null rather than zero", async () => {
  const zero = "0x0000000000000000000000000000000000000000";
  const manifest = { maker: MAKER, rounds: [{ round: 0, orderHash: HASH }] };
  endpoints({
    [CUSTOM]: (method) => {
      if (method === "eth_blockNumber") return "0x3e8";
      if (method === "eth_call") return auctionsResult(distinctStruct({ best: zero }));
      throw new Error("query exceeds max results"); // eth_getLogs refuses
    },
  });
  const board = await fromChain({ rpc: CUSTOM, book: BOOK, manifest });
  const a = board.auctions[0];
  assert.equal(a.clearingBps, null, "nobody won, which is not a price of zero");
  assert.deepEqual(a.bids, []);
  assert.equal(a.revealedCount, null, "not read is not nobody revealed");
});

test("fromChain returns null for no manifest, and for a head the node will not give", async () => {
  assert.equal(await fromChain({ rpc: CUSTOM, book: BOOK, manifest: null }), null);
  assert.equal(await fromChain({ rpc: CUSTOM, book: BOOK, manifest: { maker: MAKER, rounds: [] } }), null);
  const log = endpoints({ [CUSTOM]: () => null });
  assert.equal(await fromChain({ rpc: CUSTOM, book: BOOK, manifest: { maker: MAKER, rounds: [{ round: 0, orderHash: HASH }] } }), null);
  assert.deepEqual(log.map((l) => l.method), ["eth_blockNumber"], "and nothing else is asked");
});

// --- endpoint selection ----------------------------------------------------------------
// Ordered: the pool remembers the member that last answered for the life of the module,
// and the final test below is the one that moves it.

test("a caller-chosen endpoint is retried on a rate limit and never substituted", async (t) => {
  mock.timers.enable({ apis: ["setTimeout"] });
  t.after(() => mock.timers.reset());
  let n = 0;
  const log = endpoints({
    [CUSTOM]: () => {
      n++;
      if (n < 3) throw new Error("over rate limit");
      return "0x10";
    },
    [DEFAULT_RPC]: () => assert.fail("the default endpoint must never be asked"),
    [TENDERLY]: () => assert.fail("the pool must never be asked"),
  });
  assert.equal(await drive(chainHead(CUSTOM)), 16);
  assert.deepEqual(log.map((l) => l.url), [CUSTOM, CUSTOM, CUSTOM]);
});

test("a caller-chosen endpoint gives up after four rate-limited tries, with the node's error", async (t) => {
  mock.timers.enable({ apis: ["setTimeout"] });
  t.after(() => mock.timers.reset());
  const log = endpoints({ [CUSTOM]: () => { throw new Error("-32016 over rate limit"); } });
  await assert.rejects(drive(chainHead(CUSTOM)), { message: "eth_blockNumber: -32016 over rate limit" });
  assert.equal(log.length, 4);
});

test("a caller-chosen endpoint's real error is thrown at once, and a dead one is not replaced", async () => {
  let log = endpoints({ [CUSTOM]: () => { throw new Error("execution reverted"); } });
  await assert.rejects(chainHead(CUSTOM), { message: "eth_blockNumber: execution reverted" });
  assert.equal(log.length, 1);

  log = endpoints({}); // every fetch rejects: the fork is down
  await assert.rejects(chainHead(CUSTOM), TypeError);
  assert.deepEqual(log.map((l) => l.url), [CUSTOM], "a down fork is an error, never mainnet data");
});

test("the default pool does not rotate on a real chain error", async () => {
  const log = endpoints({
    [DEFAULT_RPC]: () => { throw new Error("invalid argument 0: hex string without 0x prefix"); },
    [TENDERLY]: () => assert.fail("a malformed question must not be asked twice"),
  });
  await assert.rejects(chainHead(DEFAULT_RPC), /hex string without 0x prefix/);
  assert.deepEqual(log.map((l) => l.url), [DEFAULT_RPC]);
});

test("the default pool reports the last error when every member is down", async (t) => {
  mock.timers.enable({ apis: ["setTimeout"] });
  t.after(() => mock.timers.reset());
  const log = endpoints({
    [DEFAULT_RPC]: () => { throw new Error("over rate limit"); },
    [TENDERLY]: () => { throw new Error("429 Too Many Requests"); },
  });
  await assert.rejects(drive(chainHead(DEFAULT_RPC)), { message: "eth_blockNumber: 429 Too Many Requests" });
  assert.deepEqual(log.map((l) => l.url), [DEFAULT_RPC, TENDERLY]);
});

test("the default pool moves on from a rate limit and remembers the member that answered", async (t) => {
  mock.timers.enable({ apis: ["setTimeout"] });
  t.after(() => mock.timers.reset());
  const log = endpoints({
    [DEFAULT_RPC]: () => { throw new Error("eth_call: over rate limit"); },
    [TENDERLY]: () => "0x2a",
  });
  assert.equal(await drive(chainHead(DEFAULT_RPC)), 42);
  assert.deepEqual(log.map((l) => l.url), [DEFAULT_RPC, TENDERLY]);

  // The next read starts where the last one succeeded, so a spent budget is not re-spent.
  log.length = 0;
  assert.equal(await chainHead(DEFAULT_RPC), 42);
  assert.deepEqual(log.map((l) => l.url), [TENDERLY]);
});
