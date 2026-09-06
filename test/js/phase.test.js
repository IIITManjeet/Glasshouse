import { test } from "node:test";
import assert from "node:assert/strict";

import { phase } from "../../site/phase.js";

// Same boundary constants as test/ReserveMatrix.t.sol and test/GlasshouseBook.t.sol:
// vm.roll(1000), commitBlocks = 30, revealBlocks = 30, exclusiveBlocks = 15.
const OPENED_AT = 1000n;
const COMMIT_END = OPENED_AT + 30n; // 1030
const REVEAL_END = COMMIT_END + 30n; // 1060
const EXCLUSIVE_END = REVEAL_END + 15n; // 1075

function auction(bestBidder) {
  return { commitEnd: COMMIT_END, revealEnd: REVEAL_END, exclusiveEnd: EXCLUSIVE_END, bestBidder };
}

// Mirrors test_Outcome_PhasesAreDisjointInBlockSpace and
// test_Outcome_ExclusiveWindowEndsAtRevealEndPlusExclusive (test/GlasshouseBook.t.sol).
test("phase: with a winner, walks commit -> reveal -> exclusive -> open", () => {
  const a = auction("0xWINNER");
  assert.equal(phase(a, COMMIT_END), "commit"); // last commit block, inclusive
  assert.equal(phase(a, COMMIT_END + 1n), "reveal"); // first reveal block
  assert.equal(phase(a, REVEAL_END), "reveal"); // last reveal block, inclusive
  assert.equal(phase(a, REVEAL_END + 1n), "exclusive"); // first exclusive block
  assert.equal(phase(a, EXCLUSIVE_END), "exclusive"); // last exclusive block, inclusive
  assert.equal(phase(a, EXCLUSIVE_END + 1n), "open"); // first open block
});

// GlasshouseBook.sol:222-225: no reveal means outcome() reports exclusiveUntil ==
// revealEnd, i.e. the exclusive window collapses to nothing. The reader must reach the
// same conclusion without a boundary to compare against, by checking bestBidder.
test("phase: with no winner, reveal is immediately followed by open, never exclusive", () => {
  const a = auction(null);
  assert.equal(phase(a, COMMIT_END), "commit");
  assert.equal(phase(a, COMMIT_END + 1n), "reveal");
  assert.equal(phase(a, REVEAL_END), "reveal");
  assert.equal(phase(a, REVEAL_END + 1n), "open"); // not "exclusive"
  assert.equal(phase(a, EXCLUSIVE_END), "open");
  assert.equal(phase(a, EXCLUSIVE_END + 1n), "open");
});

test("phase: bestBidder undefined is treated the same as null", () => {
  const a = { commitEnd: COMMIT_END, revealEnd: REVEAL_END, exclusiveEnd: EXCLUSIVE_END };
  assert.equal(phase(a, REVEAL_END + 1n), "open");
});

// The Graph serialises BigInt scalars as decimal strings over HTTP; _meta.block.number
// comes back as a plain number. Both must compare correctly against bigint boundaries.
test("phase: accepts numbers, decimal strings and bigints interchangeably", () => {
  const bigintAuction = auction("w");
  const stringAuction = {
    commitEnd: String(COMMIT_END),
    revealEnd: String(REVEAL_END),
    exclusiveEnd: String(EXCLUSIVE_END),
    bestBidder: "w",
  };
  const numberAuction = {
    commitEnd: Number(COMMIT_END),
    revealEnd: Number(REVEAL_END),
    exclusiveEnd: Number(EXCLUSIVE_END),
    bestBidder: "w",
  };

  for (const a of [bigintAuction, stringAuction, numberAuction]) {
    assert.equal(phase(a, Number(REVEAL_END) + 1), "exclusive");
    assert.equal(phase(a, String(REVEAL_END + 1n)), "exclusive");
    assert.equal(phase(a, REVEAL_END + 1n), "exclusive");
  }
});

test("phase: rejects a reference block it cannot interpret", () => {
  assert.throws(() => phase(auction(null), null), TypeError);
  assert.throws(() => phase(auction(null), undefined), TypeError);
  assert.throws(() => phase(auction(null), {}), TypeError);
});

test("phase: before commitEnd, before any activity, is commit", () => {
  const a = auction(null);
  assert.equal(phase(a, OPENED_AT), "commit");
});
