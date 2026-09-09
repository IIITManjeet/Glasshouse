import { test } from "node:test";
import assert from "node:assert/strict";

import { canSettle, phase } from "../../web/lib/phase.ts";

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

// ---- canSettle -------------------------------------------------------------------
//
// settle() requires block.number > a.revealEnd + a.exclusiveBlocks (GlasshouseBook.sol:266)
// with no test on a.best, so it is NOT the same predicate as phase() == "open". These
// tests pin the difference, which is the whole reason canSettle exists as its own export.

test("canSettle: with a winner, opens one block after exclusiveEnd, in step with phase", () => {
  const a = auction("0xWINNER");
  assert.equal(canSettle(a, REVEAL_END), false);
  assert.equal(canSettle(a, EXCLUSIVE_END), false); // last exclusive block, inclusive
  assert.equal(canSettle(a, EXCLUSIVE_END + 1n), true);
  // With a winner the two predicates agree, which is why the bug hid.
  assert.equal(phase(a, EXCLUSIVE_END + 1n), "open");
});

// The defect this function was added for: phase() calls a winnerless auction "open"
// from revealEnd + 1, because the FILL is open then (:222-225), but settle() still
// counts the exclusive blocks. A page that drove a settle button off the phase showed
// a reverting button for 15 blocks, about 30 s on Base.
test("canSettle: with no winner, stays false through the whole exclusive window", () => {
  const a = auction(null);
  for (let n = REVEAL_END + 1n; n <= EXCLUSIVE_END; n += 1n) {
    assert.equal(phase(a, n), "open", `phase at ${n}`);
    assert.equal(canSettle(a, n), false, `canSettle at ${n}`);
  }
  assert.equal(canSettle(a, EXCLUSIVE_END + 1n), true);
});

test("canSettle: an already settled auction can never be settled again", () => {
  const a = { ...auction("0xWINNER"), settled: true };
  assert.equal(canSettle(a, EXCLUSIVE_END + 1n), false);
  assert.equal(canSettle(a, EXCLUSIVE_END + 1000n), false);
  // A row that did not ask for `settled` is treated as not settled.
  assert.equal(canSettle(auction("0xWINNER"), EXCLUSIVE_END + 1n), true);
  assert.equal(canSettle({ ...auction("0xWINNER"), settled: false }, EXCLUSIVE_END + 1n), true);
});

test("canSettle: accepts numbers, decimal strings and bigints interchangeably", () => {
  const rows = [
    auction("w"),
    { commitEnd: String(COMMIT_END), revealEnd: String(REVEAL_END), exclusiveEnd: String(EXCLUSIVE_END), bestBidder: "w" },
    { commitEnd: Number(COMMIT_END), revealEnd: Number(REVEAL_END), exclusiveEnd: Number(EXCLUSIVE_END), bestBidder: "w" },
  ];
  for (const a of rows) {
    assert.equal(canSettle(a, Number(EXCLUSIVE_END)), false);
    assert.equal(canSettle(a, String(EXCLUSIVE_END + 1n)), true);
    assert.equal(canSettle(a, EXCLUSIVE_END + 1n), true);
  }
});
