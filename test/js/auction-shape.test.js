import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { decodeAuction } from "../../web/lib/chain.js";

/**
 * THE TWO DATA PATHS MUST PRODUCE THE SAME SHAPE.
 *
 * The page reads auctions either from the chain (`web/lib/chain.js`) or from the
 * checked-in snapshot (`scripts/make-snapshot.mjs`). Nothing forced them to agree, and
 * they did not: the chain path carried `round` but no `maker`, the snapshot carried
 * `maker` but no `round`.
 *
 * That cost twice. The visible half was a crash -- `num(a.round)` reaching
 * `undefined.toLocaleString()` on first load, which blanked the page. The dangerous half
 * was silent: `maker` is NOT in the Auction struct, because it is half of the mapping key
 * and the struct never repeats it, and `BidPanel` passes `auction.maker` straight into
 * `placeBid`. Undefined there builds a commitment against the wrong auction key -- a bid
 * that seals correctly and can NEVER be revealed. Nobody would have found that until a
 * stranger lost a bid on mainnet.
 *
 * So the shape is asserted rather than assumed, on both sides.
 */

/** Every field the page's components read. Adding one here without adding it to BOTH
 *  producers is the mistake this file exists to catch. */
const REQUIRED = [
  "orderHash",
  "maker",
  "round",
  "openedAtBlock",
  "commitEnd",
  "revealEnd",
  "exclusiveEnd",
  "reserveBps",
  "maxBps",
  "committedCount",
  "revealedCount",
  "bestBidder",
  "secondBps",
  "clearingBps",
  "filled",
  "settled",
  "bids",
];

function loadSnapshot() {
  const src = readFileSync(new URL("../../site/data/snapshot.js", import.meta.url), "utf8");
  const json = src.slice(src.indexOf("{", src.indexOf("=")), src.lastIndexOf("}") + 1);
  return JSON.parse(json);
}

test("the snapshot carries every field the page reads", () => {
  const snap = loadSnapshot();
  assert.ok(Array.isArray(snap.auctions), "snapshot has an auctions array");
  for (const a of snap.auctions) {
    for (const key of REQUIRED) {
      assert.ok(
        key in a,
        `snapshot auction ${a.orderHash} is missing "${key}" — the page reads it and would ` +
          `crash or, worse for "maker", sign against the wrong auction key`,
      );
    }
  }
});

test("decodeAuction returns the struct fields, and NOT the ones only a caller can know", () => {
  // 16 static words, taken from a real mainnet response for the first auction ever opened.
  const words = [
    "0000000000000000000000005c3bae054e8b4915a13726b397b1aea864247dbf", // router
    "0000000000000000000000004200000000000000000000000000000000000006", // tokenIn
    "00000000000000000000000000000000000000000000000000000000030a5481", // commitEnd
    "00000000000000000000000000000000000000000000000000000000030a549f", // revealEnd
    "000000000000000000000000000000000000000000000000000000000000000f", // exclusiveBlocks
    "0000000000000000000000000000000000000000000000000000000000000032", // reserveBps 50
    "00000000000000000000000000000000000000000000000000000000000001f4", // maxBps 500
    "0000000000000000000000000000000000000000000000000000000000000000", // bond
    "0000000000000000000000000000000000000000000000000000000000000000", // best
    "0000000000000000000000000000000000000000000000000000000000000000", // bestBps
    "0000000000000000000000000000000000000000000000000000000000000000", // bestCommitIdx
    "0000000000000000000000000000000000000000000000000000000000000000", // secondBps
    "0000000000000000000000000000000000000000000000000000000000000002", // commitCount
    "0000000000000000000000000000000000000000000000000000000000000000", // filledBy
    "0000000000000000000000000000000000000000000000000000000000000000", // settled
    "0000000000000000000000000000000000000000000000000000000000000000", // winnerForfeited
  ];
  const a = decodeAuction("0x" + words.join(""));

  assert.equal(a.commitEnd, 51008641);
  assert.equal(a.revealEnd, 51008671);
  assert.equal(a.exclusiveEnd, 51008686, "exclusiveEnd is derived: the struct holds BLOCKS");
  assert.equal(a.reserveBps, 50);
  assert.equal(a.maxBps, 500);
  assert.equal(a.committedCount, 2);
  assert.equal(a.bestBidder, null, "a zero address is nobody, not an address of zeros");
  assert.equal(a.settled, false);
  assert.equal(a.bond, "0");

  // The struct genuinely cannot carry these -- maker is half the mapping key and the round
  // is ours, not the contract's. fromChain() must add both, which is precisely the bug
  // this file was written for.
  assert.ok(!("maker" in a), "maker is not in the struct; fromChain must supply it");
  assert.ok(!("round" in a), "round is not in the struct; fromChain must supply it");
});

test("an unopened round decodes as null, not as an auction of zeros", () => {
  // commitEnd == 0 is how the Book says "never opened" (open() requires commitBlocks > 0,
  // GlasshouseBook.sol:134). Returning an object here would put a phantom round on the
  // board with every boundary at block zero.
  assert.equal(decodeAuction("0x" + "0".repeat(64 * 16)), null);
  assert.equal(decodeAuction("0x"), null);
  assert.equal(decodeAuction(undefined), null);
});

/**
 * THE SIMULATOR IS THE THIRD DATA PATH.
 *
 * web/lib/simulate.js feeds the same components as the chain read and the snapshot, so it
 * is bound by the same contract, and it is the path most likely to drift: it is the only
 * one not derived from an ABI or a generator, so nothing but this test stops a field being
 * renamed in it alone.
 */
test("every simulated round carries every field the page reads", async () => {
  const { simulate, SIM_WARM_START_MS } = await import("../../web/lib/simulate.ts");
  const board = simulate(SIM_WARM_START_MS);
  assert.ok(board.auctions.length > 0, "the warm start lands mid-flight, not on an empty board");
  for (const a of board.auctions) {
    for (const key of REQUIRED) {
      assert.ok(key in a, `simulated round ${a.round} is missing "${key}"`);
    }
  }
});

test("the simulation clears at the runner-up's bid, which is the whole claim", async () => {
  const { simulate, SIM_WARM_START_MS } = await import("../../web/lib/simulate.ts");
  const board = simulate(SIM_WARM_START_MS);
  const contested = board.auctions.find((a) => a.simKey === "contested");
  assert.ok(contested, "the script's contested round is in the window");
  assert.equal(contested.bestBps, 400);
  assert.equal(contested.secondBps, 250);
  // Not the winner's own bid, and not the reserve: the runner-up's.
  assert.equal(contested.clearingBps, 250);
  assert.equal(contested.committedCount, 3);
  assert.equal(contested.revealedCount, 2, "one envelope is never opened, on purpose");
});

test("a sole reveal clears at the reserve, and a round with none has no winner", async () => {
  const { simulate, SIM_WARM_START_MS, SIM_RESERVE_BPS } = await import("../../web/lib/simulate.ts");
  const board = simulate(SIM_WARM_START_MS);

  const sole = board.auctions.find((a) => a.simKey === "sole");
  assert.equal(sole.revealedCount, 1);
  assert.equal(sole.secondBps, 0, "there is no runner-up");
  assert.equal(sole.clearingBps, SIM_RESERVE_BPS, "so the reserve stands in for one");

  const empty = board.auctions.find((a) => a.simKey === "empty");
  assert.equal(empty.revealedCount, 0);
  assert.equal(empty.bestBidder, null);
  // Null, not zero. "Nobody won" is not "the price was nothing" -- the receipt and the
  // stats line both branch on this and would print 0 bps as a cleared price.
  assert.equal(empty.clearingBps, null);
  assert.equal(empty.filled, false);
});

test("the simulation is a pure function of the block, so it never runs backwards", async () => {
  const { simulate, SIM_MS_PER_BLOCK, SIM_WARM_START_MS } = await import("../../web/lib/simulate.ts");
  const at = (ms) => simulate(ms).auctions.find((a) => a.simKey === "contested");
  const early = at(SIM_WARM_START_MS);
  const later = at(SIM_WARM_START_MS + 40 * SIM_MS_PER_BLOCK);

  assert.deepEqual(at(SIM_WARM_START_MS), early, "same input, same output");
  assert.ok(later.revealedCount >= early.revealedCount, "reveals never un-happen");
  assert.ok(later.committedCount >= early.committedCount, "commitments never un-happen");
});

test("the reserve window drops unreadable rows rather than scoring them as no-reveal", async () => {
  const { reserveWindow } = await import("../../web/lib/reserve-window.ts");
  const rows = [
    // Settled, two reveals, winner 400 over a runner-up at 250.
    { settled: true, revealedCount: 2, committedCount: 3, bestBidder: "0xa", bestBps: 400, secondBps: 250, reserveBps: 50, round: 1 },
    // Settled, but eth_getLogs failed. NOT a zero-reveal auction.
    { settled: true, revealedCount: null, committedCount: 2, bestBidder: null, bestBps: 0, secondBps: 0, reserveBps: 50, round: 2 },
    // Still running: a later reveal can still displace this winner.
    { settled: false, revealedCount: 1, committedCount: 2, bestBidder: "0xb", bestBps: 300, secondBps: 0, reserveBps: 50, round: 3 },
  ];
  const w = reserveWindow(rows);
  assert.equal(w.rows.length, 1, "one settled, readable round");
  assert.equal(w.unreadable, 1);
  assert.equal(w.rows[0].competition, "CONTESTED");
  assert.equal(w.rows[0].clearingBps, 250);
  assert.equal(w.rows[0].winnerMarginBps, 150);
  // isThin: CONTESTED and margin > clearing. 150 is not greater than 250.
  assert.equal(w.rows[0].thin, false);
  assert.equal(w.rows[0].unrevealedCount, 1);
});
