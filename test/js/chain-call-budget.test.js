import { test } from "node:test";
import assert from "node:assert/strict";

import { fromChain } from "../../web/lib/chain.js";

/**
 * HOW MANY RPC CALLS ONE POLL COSTS, WHICH NOTHING USED TO MEASURE.
 *
 * `newestOpenedRound` memoises the newest opened round so a poll confirms it in one or
 * two calls instead of binary-searching all 300. The memo was guarded by `cursor > 0`,
 * and the remembered cursor for a chain holding exactly one auction is 0 -- so the fast
 * path never engaged, every poll paid the full ~10-call search, and `writeCursor(0)`
 * stored a value that failed the same guard on the next tick. The memo could not warm up.
 *
 * It was invisible for as long as mainnet was empty, because an unopened round 0 returns
 * early after ONE call. The first real keeper round on Base (2026-09-12) turned a
 * one-call poll into a ten-call one, and the deployed /evidence page was rate limited by
 * the public endpoint shortly after.
 *
 * Correctness tests would not have caught it: the function returned the right round the
 * whole time, at ten times the price. So this asserts the PRICE, not just the answer.
 */

/** Sixteen flat 32-byte words, the shape `auctions(address,bytes32)` returns. */
function encodeAuction({ commitEnd }) {
  const words = new Array(16).fill("0".repeat(64));
  const at = (i, v) => (words[i] = BigInt(v).toString(16).padStart(64, "0"));
  at(2, commitEnd); // 0 here means "never opened", which is how an absent round reads
  at(3, commitEnd + 60); // revealEnd
  at(4, 15); // exclusiveBlocks
  return "0x" + words.join("");
}

const MAKER = "0xeEbf737F92C8F0d9070f35a7D9BAf416923bEcDf";
const BOOK = "0xc4ea91Fe700918220423ac307C6B1c59650FFbfe";

/** 300 precomputed rounds, as config/rounds.json actually carries. */
const manifest = {
  maker: MAKER,
  rounds: Array.from({ length: 300 }, (_, i) => ({
    round: i,
    // Hex, because the stub endpoint decodes the hash back into a round number the
    // same way it arrives on the wire. Decimal here reads round 41 back as 0x41.
    orderHash: "0x" + i.toString(16).padStart(64, "0"),
  })),
};

/**
 * Stands in for the endpoint and counts what was asked of it. `openedThrough` is the
 * highest round index the Book has seen, matching the contract's guarantee that rounds
 * are opened strictly in order.
 */
function fakeEndpoint(openedThrough) {
  const counts = { eth_blockNumber: 0, eth_call: 0, eth_getLogs: 0 };
  globalThis.fetch = async (_url, init) => {
    const { method, params } = JSON.parse(init.body);
    counts[method] = (counts[method] ?? 0) + 1;
    let result;
    if (method === "eth_blockNumber") {
      result = "0x" + (1000).toString(16);
    } else if (method === "eth_call") {
      // The order hash is the second 32-byte argument after the 4-byte selector.
      const round = Number(BigInt("0x" + params[0].data.slice(10 + 64, 10 + 128)));
      result = round <= openedThrough ? encodeAuction({ commitEnd: 900 }) : encodeAuction({ commitEnd: 0 });
    } else if (method === "eth_getLogs") {
      result = [];
    }
    return { json: async () => ({ jsonrpc: "2.0", id: 1, result }) };
  };
  return counts;
}

test("one opened round costs a handful of calls, not a full binary search", async () => {
  const counts = fakeEndpoint(0);
  const got = await fromChain({ rpc: "http://endpoint.test", book: BOOK, manifest, limit: 6 });

  assert.ok(got, "round 0 is open, so the board must have something to show");
  assert.equal(got.auctions.length, 1);
  assert.equal(got.auctions[0].round, 0);

  // A binary search over 300 rounds is ~10 eth_calls. The memoised path is: confirm the
  // cursor's round is open, find the next one is not, then read the round itself.
  assert.ok(
    counts.eth_call <= 4,
    `one opened round should cost at most 4 eth_calls; this took ${counts.eth_call}. ` +
      `That is the fast path in newestOpenedRound failing to engage -- see the guard there.`,
  );
});

test("an empty chain still costs one call, as it did before any round existed", async () => {
  const counts = fakeEndpoint(-1); // nothing opened at all
  const got = await fromChain({ rpc: "http://endpoint.test", book: BOOK, manifest, limit: 6 });

  assert.equal(got, null, "nothing opened means no board, so the snapshot can take over");
  assert.ok(
    counts.eth_call <= 2,
    `an empty chain should settle in at most 2 eth_calls; this took ${counts.eth_call}.`,
  );
});

test("the search still finds the newest round when many are open", async () => {
  const counts = fakeEndpoint(41);
  const got = await fromChain({ rpc: "http://endpoint.test", book: BOOK, manifest, limit: 6 });

  assert.ok(got);
  assert.equal(got.auctions[0].round, 41, "the newest opened round leads the board");
  assert.equal(got.auctions.length, 6, "and the limit is respected");
  // Cold cursor (0) plus a forward walk to 41 is linear, which is the existing design:
  // rounds open minutes apart, so a live tab advances one at a time. Asserted only to
  // keep it bounded rather than to bless the shape.
  assert.ok(counts.eth_call < 60, `unbounded search: ${counts.eth_call} eth_calls`);
});
