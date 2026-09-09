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
