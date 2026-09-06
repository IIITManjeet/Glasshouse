import { test } from "node:test";
import assert from "node:assert/strict";

import {
  recommendReserve,
  NO_HISTORY,
  COMPETITION_PRICES,
  NO_REVEALS,
  WINNER_BELOW_FLOOR,
  THIN_COMPETITION,
} from "../../site/reserve-rule.js";

// Row builders. Fields match the Q3 query in subgraph-design.md section 7.2, i.e. what
// the subgraph actually computes per auction (section 5.3, 6.3) - this file only
// consumes `competition` and `thin`, it does not recompute them from a bid ladder.

function contested({ bestBps, thin, unrevealedCount = 0 }) {
  return {
    competition: "CONTESTED",
    thin,
    bestBps,
    bestBidder: { id: "0xwinner" },
    unrevealedCount,
    teamRevealed: 0,
    invitedRevealed: 0,
    unknownRevealed: 0,
  };
}

// The subtle case: a binding reserve never appears as "two reveals below the reserve" -
// reveal() rejects any bps < reserveBps outright, so a thin ladder shows up as ONE
// reveal plus the excluded bidders sitting unrevealed (test_Thin_TheReserveIsWhatProtects
// TheMaker at reserve 50/200: the sole reveal is the strong bidder, the two weak ones
// never get to reveal at all). A row builder for "sole reveal, N commitments never
// resolved" is therefore not a corner case here, it is the normal shape of a thin row.
function sole({ bestBps, unrevealedCount }) {
  return {
    competition: "SOLE",
    thin: true, // classify(): revealedCount == 1 is always thin, section 6.3
    bestBps,
    bestBidder: { id: "0xwinner" },
    unrevealedCount,
    teamRevealed: 0,
    invitedRevealed: 0,
    unknownRevealed: 0,
  };
}

function empty() {
  return {
    competition: "NONE",
    thin: false,
    bestBps: 0,
    bestBidder: null,
    unrevealedCount: 0,
    teamRevealed: 0,
    invitedRevealed: 0,
    unknownRevealed: 0,
  };
}

test("recommendReserve: no settled auctions yet falls back to the floor", () => {
  const rec = recommendReserve([], { floorBps: 50, maxBps: 500, K: 8 });
  assert.equal(rec.reason, NO_HISTORY);
  assert.equal(rec.bps, 50);
  assert.deepEqual(rec.band, [50, 50]);
  assert.equal(rec.n, 0);
  assert.equal(rec.minBest, null);
});

// test_Competitive_SecondPriceDominatesTheReserve: 400/250/100/60/30 clears at 250 at
// every reserve 0..200. winnerMarginBps (400-250=150) does not exceed clearingBps (250),
// so this is CONTESTED and NOT thin: "strong" competition, per section 6.3.
test("recommendReserve: a strict majority of strong contested auctions keeps the floor", () => {
  const window = [
    contested({ bestBps: 400, thin: false }),
    contested({ bestBps: 420, thin: false }),
    contested({ bestBps: 400, thin: false }),
    contested({ bestBps: 400, thin: false }),
    contested({ bestBps: 400, thin: false }),
  ];
  const rec = recommendReserve(window, { floorBps: 50, maxBps: 500, K: 8 });
  assert.equal(rec.reason, COMPETITION_PRICES);
  assert.equal(rec.bps, 50);
  assert.equal(rec.strong, 5);
  assert.equal(rec.minBest, 400);
  assert.deepEqual(rec.band, [50, 399]); // one below the lowest winning bid observed
});

// test_ReserveAboveEveryBid_AuctionAccomplishesNothing: a reserve set too high looks
// exactly like nobody being interested. A majority of empty auctions must not push the
// recommendation anywhere but the floor - raising it further would compound whatever
// already excluded everyone.
test("recommendReserve: a strict majority of no-reveal auctions stays at the floor", () => {
  const window = [empty(), empty(), empty(), contested({ bestBps: 300, thin: false }), contested({ bestBps: 300, thin: false })];
  const rec = recommendReserve(window, { floorBps: 50, maxBps: 500, K: 8 });
  assert.equal(rec.reason, NO_REVEALS);
  assert.equal(rec.bps, 50);
  assert.deepEqual(rec.band, [50, 50]);
  assert.equal(rec.empty, 3);
});

// test_Thin_TheReserveIsWhatProtectsTheMaker at reserve 50/200: the ladder is
// 400/30/20, the weak bidders cannot reveal at all, so the window shows a SOLE reveal
// (bestBps 400) with two unrevealed commitments. That is thin competition, not "no
// reveals" and not "strong": the reserve is doing the maker's protecting.
test("recommendReserve: thin windows (sole reveals with unrevealed commitments) raise toward the lowest winner", () => {
  const window = [
    sole({ bestBps: 400, unrevealedCount: 2 }),
    sole({ bestBps: 400, unrevealedCount: 2 }),
    contested({ bestBps: 300, thin: true, unrevealedCount: 0 }), // weak runner-up, still thin
    sole({ bestBps: 150, unrevealedCount: 1 }),
  ];
  const rec = recommendReserve(window, { floorBps: 50, maxBps: 500, K: 8 });
  assert.equal(rec.reason, THIN_COMPETITION);
  assert.equal(rec.weak, 4);
  assert.equal(rec.strong, 0);
  assert.equal(rec.empty, 0);
  assert.equal(rec.minBest, 150); // lowest winning bid in the window
  assert.deepEqual(rec.band, [50, 149]);
  assert.equal(rec.bps, Math.floor((50 + 149) / 2));
  assert.equal(rec.unrevealed, 5); // 2 + 2 + 0 + 1: the excluded bidders are counted, not dropped
});

// test_OneBidder_PaysExactlyTheReserve, one row: a lone winner who bid only just above
// the current floor leaves no room to recommend anything higher.
test("recommendReserve: a thin window whose only winner bid near the floor cannot clear it", () => {
  const window = [sole({ bestBps: 30, unrevealedCount: 0 })];
  const rec = recommendReserve(window, { floorBps: 50, maxBps: 500, K: 8 });
  assert.equal(rec.reason, WINNER_BELOW_FLOOR);
  assert.equal(rec.bps, 50);
  assert.deepEqual(rec.band, [50, 50]);
});

// Neither strong nor empty reaches a strict majority (2 of 4 each): ties go to
// protecting the maker, i.e. the thin/reserve-is-the-price branch, per section 7.2.
test("recommendReserve: an exact split between strong and weak favours protecting the maker", () => {
  const window = [
    contested({ bestBps: 400, thin: false }),
    contested({ bestBps: 400, thin: false }),
    sole({ bestBps: 200, unrevealedCount: 1 }),
    sole({ bestBps: 200, unrevealedCount: 1 }),
  ];
  const rec = recommendReserve(window, { floorBps: 50, maxBps: 500, K: 8 });
  assert.equal(rec.reason, THIN_COMPETITION);
  assert.equal(rec.strong, 2);
  assert.equal(rec.weak, 2);
});

test("recommendReserve: the band never exceeds maxBps", () => {
  const window = [sole({ bestBps: 5000, unrevealedCount: 0 })];
  const rec = recommendReserve(window, { floorBps: 50, maxBps: 500, K: 8 });
  assert.equal(rec.reason, THIN_COMPETITION);
  assert.equal(rec.band[1], 500);
  assert.equal(rec.bps, Math.floor((50 + 500) / 2));
});

// K truncates defensively, matching the query's `first: $k`, so a caller that queried
// more rows than the window size still gets the rule's answer for a window of K.
test("recommendReserve: truncates to the first K rows regardless of how many are passed", () => {
  const window = Array.from({ length: 20 }, () => contested({ bestBps: 300, thin: false }));
  const rec = recommendReserve(window, { floorBps: 50, maxBps: 500, K: 8 });
  assert.equal(rec.n, 8);
});

test("recommendReserve: provenance and unrevealed counts sum across the window used", () => {
  const window = [
    { ...sole({ bestBps: 400, unrevealedCount: 2 }), teamRevealed: 1, invitedRevealed: 0, unknownRevealed: 0 },
    { ...sole({ bestBps: 300, unrevealedCount: 1 }), teamRevealed: 0, invitedRevealed: 1, unknownRevealed: 0 },
  ];
  const rec = recommendReserve(window, { floorBps: 50, maxBps: 500, K: 8 });
  assert.equal(rec.unrevealed, 3);
  assert.deepEqual(rec.provenance, { team: 1, invited: 1, unknown: 0 });
});

// Section 9 refuses any bidder-population index computed from our three to five
// wallets. This rule stays inside that: the summary object carries only counts (n,
// empty, weak, strong, minBest, unrevealed, provenance), never a derived ratio or index.
// Locking the key set catches an accidental addition early.
test("recommendReserve: result carries only the documented count fields", () => {
  const rec = recommendReserve([contested({ bestBps: 300, thin: false })], { floorBps: 50, maxBps: 500, K: 8 });
  assert.deepEqual(
    Object.keys(rec).sort(),
    ["band", "bps", "empty", "minBest", "n", "provenance", "reason", "strong", "unrevealed", "weak"].sort()
  );
  assert.deepEqual(Object.keys(rec.provenance).sort(), ["invited", "team", "unknown"]);
});
