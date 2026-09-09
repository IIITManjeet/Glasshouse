// A round that actually finishes, for when no round is running.
//
// WHY THIS EXISTS. The Book on Base holds one auction with two sealed commitments, zero
// reveals and no settlement (site/data/snapshot.js). The keeper opens rounds only while it
// is running, and a round is 75 blocks -- about two and a half minutes -- of which the
// interesting part is the last third. So the honest default state of this page is a sealed
// card and a countdown, and a visitor who arrives at the wrong moment never sees the one
// thing the whole project claims: that the winner pays the RUNNER-UP's price, and the
// difference goes to the maker.
//
// That is a demonstration problem, not a truth problem, and the fix is a demonstration --
// never a fake. This module produces the same Auction shape as web/lib/chain.js and
// site/data/snapshot.js, so the same components render it, and it is labelled `sim`
// everywhere it surfaces: a source chip in amber, a banner that cannot be dismissed, and a
// caption on every figure. DESIGN.md section 2 is the project's rule -- every number says
// what produced it -- and a simulation is exactly the case that rule was written for.
//
// Two things it deliberately does NOT do:
//   * It does not touch the wallet. BidPanel is replaced while this is on, because a
//     commitment signed against a synthetic order hash is a bid that can never be
//     revealed -- the same class of bug test/js/auction-shape.test.js was written to stop.
//   * It does not invent a mechanism. Every number below is the contract's own arithmetic
//     over assigned bids: top two of the revealed set, clearing = max(second, reserve),
//     GlasshouseBook.sol's rule and nothing else.

/** The advocated configuration, config/auction.json -- the same one the keeper opens. */
export const SIM_COMMIT_BLOCKS = 30;
export const SIM_REVEAL_BLOCKS = 30;
export const SIM_EXCLUSIVE_BLOCKS = 15;
export const SIM_RESERVE_BPS = 50;
export const SIM_MAX_BPS = 500;

/** 75 blocks of auction, then 5 before the next opens, so the board is never empty. */
const ROUND_BLOCKS = SIM_COMMIT_BLOCKS + SIM_REVEAL_BLOCKS + SIM_EXCLUSIVE_BLOCKS;
const CYCLE_BLOCKS = ROUND_BLOCKS + 5;

/**
 * The synthetic origin. Base was near this height when ui-spec.md was written, so the
 * figures LOOK like the real ones -- which is the point of a rehearsal -- and every chip
 * that carries them says SIMULATED, which is the point of the provenance rule.
 */
export const SIM_ORIGIN_BLOCK = 51_204_061;

/** One block per 400 ms: a 75-block round runs in 30 seconds, which fits a demo video. */
export const SIM_MS_PER_BLOCK = 400;

const SIM_MAKER = "0x5f1a0000000000000000000000000000000000e2";

/**
 * Four bidders with ASSIGNED valuations, exactly as test/Comparison.t.sol assigns them.
 * Nothing here was observed; the arrival order is chosen, not measured.
 */
const BIDDERS = [
  "0x91ab00000000000000000000000000000000004c",
  "0x3c0d000000000000000000000000000000000081",
  "0x7e4400000000000000000000000000000000001f",
  "0xa20900000000000000000000000000000000009b",
];

/**
 * The four outcomes worth showing, in order, repeating.
 *
 * They are not four variations on a win: they are the four states the contract can end in,
 * including the two that flatter nobody. A demo that only ever shows a contested auction
 * clearing at the runner-up's bid is a sales reel; this one also shows the round where the
 * reserve had to set the price because only one bidder revealed, and the round where
 * nobody revealed at all and there is no winner to show.
 *
 * `commits` and `reveals` are block OFFSETS from the round's opening block. `bps` is the
 * bid each revealer opens their envelope to show.
 *
 * THE ORDER IS DELIBERATE, and it is the one place this file makes a presentational
 * choice rather than a mechanical one. The receipt section shows the most recent settled
 * round that produced a winner, so whichever outcome sits just behind the live round is
 * the one a visitor meets first. Contested is placed there, because a receipt for a round
 * where nobody revealed is four dashes and teaches nothing. The other three are still in
 * the window, still on the board above it, and still counted by the reserve advisor below
 * -- ordering which one leads is not the same as hiding the rest.
 */
const SCRIPT = [
  {
    key: "empty",
    note: "two sealed bids, neither opened; there is no winner and the page says so",
    commits: [5, 15],
    reveals: [],
    fills: false,
  },
  {
    key: "sole",
    note: "one bidder opened their envelope; the reserve, not competition, set the price",
    commits: [4, 12],
    reveals: [{ at: 36, bps: 180 }],
    fills: true,
  },
  {
    key: "contested",
    note: "three sealed bids, two opened, the loser sets the price",
    commits: [3, 9, 17],
    reveals: [
      { at: 34, bps: 400 },
      { at: 41, bps: 250 },
      // The third never reveals. The contract cannot tell disinterest from a bidder who
      // simply went away, and neither can this page, so it says so and stops there.
    ],
    fills: true,
  },
  {
    key: "close",
    note: "four bids, three opened, twenty bps between first and second",
    commits: [2, 7, 14, 22],
    reveals: [
      { at: 33, bps: 320 },
      { at: 39, bps: 300 },
      { at: 47, bps: 90 },
    ],
    fills: true,
  },
];

/** FNV-1a, so a round index maps to a stable 32-byte-looking hash without a dependency. */
function fakeHash(seed) {
  let out = "";
  for (let i = 0; i < 8; i++) {
    let h = (0x811c9dc5 ^ (seed * 2654435761 + i * 40503)) >>> 0;
    for (let k = 0; k < 4; k++) h = Math.imul(h ^ (h >>> 13), 0x01000193) >>> 0;
    out += h.toString(16).padStart(8, "0");
  }
  return "0x" + out;
}

/**
 * One round, evaluated at a block. Pure: same `head`, same object, every time.
 *
 * The derivations are the contract's, not a stored result. `settled` is not a flag this
 * module sets when it feels like it -- it is `head` compared against the reveal boundary,
 * the same comparison GlasshouseBook.sol makes, which is the same reason web/lib/phase.js
 * exists rather than the page trusting a phase field.
 */
function roundAt(index, head) {
  const script = SCRIPT[index % SCRIPT.length];
  const openedAtBlock = SIM_ORIGIN_BLOCK + index * CYCLE_BLOCKS;
  if (head < openedAtBlock) return null; // not opened yet

  const commitEnd = openedAtBlock + SIM_COMMIT_BLOCKS;
  const revealEnd = commitEnd + SIM_REVEAL_BLOCKS;
  const exclusiveEnd = revealEnd + SIM_EXCLUSIVE_BLOCKS;

  // A commitment is visible once its block has passed. Before that the card does not
  // exist -- it is not a sealed card with nothing in it, it is a bid nobody has made.
  const bids = script.commits
    .filter((off) => head >= openedAtBlock + off)
    .map((off, i) => {
      const reveal = script.reveals[i];
      const opened = reveal && head >= openedAtBlock + reveal.at;
      return {
        bidder: BIDDERS[i % BIDDERS.length],
        commitIdx: i,
        committedAtBlock: openedAtBlock + off,
        // null is "sealed", and it is the same null the log scan produces for a commitment
        // whose reveal has not landed. Components already read it that way.
        bps: opened ? reveal.bps : null,
      };
    });

  const revealed = bids.filter((b) => b.bps !== null).sort((a, b) => b.bps - a.bps);
  const best = revealed[0] ?? null;
  const second = revealed[1] ?? null;

  // The whole mechanism, in one line: the winner pays the runner-up, and when there is no
  // runner-up the reserve stands in for one.
  const clearingBps = best ? Math.max(second ? second.bps : 0, SIM_RESERVE_BPS) : null;

  const settled = head > revealEnd + 1;
  const fillsAt = revealEnd + 4; // inside the exclusive window, as the winner must
  const filled = Boolean(best) && script.fills && head >= fillsAt;

  return {
    round: index,
    orderHash: fakeHash(index),
    maker: SIM_MAKER,
    openedAtBlock,
    commitEnd,
    revealEnd,
    exclusiveEnd,
    reserveBps: SIM_RESERVE_BPS,
    maxBps: SIM_MAX_BPS,
    bond: "0",
    committedCount: bids.length,
    revealedCount: revealed.length,
    bestBidder: best ? best.bidder : null,
    bestBps: best ? best.bps : 0,
    secondBps: second ? second.bps : 0,
    clearingBps,
    filled,
    filledBy: filled && best ? best.bidder : null,
    settled,
    winnerForfeited: false,
    // In the simulation the replay is trivially the same arithmetic, so this is true
    // rather than null -- but the caption says the replay is simulated too, because a
    // green tick that checks nothing is worse than no tick.
    settlementMatchesDerivation: settled ? true : null,
    bids,
    // Not part of the shared shape: a sentence for the caption, so each round explains
    // which of the four end states it is showing.
    simNote: script.note,
    simKey: script.key,
  };
}

/**
 * The board, at `elapsedMs` into the simulation. Newest first, same envelope `fromChain`
 * returns, so useAuctions can swap one for the other without a component knowing.
 */
export function simulate(elapsedMs, limit = 6) {
  const blocks = Math.floor(elapsedMs / SIM_MS_PER_BLOCK);
  const head = SIM_ORIGIN_BLOCK + blocks;
  const newest = Math.floor(blocks / CYCLE_BLOCKS);

  const auctions = [];
  for (let i = newest; i >= 0 && auctions.length < limit; i--) {
    const a = roundAt(i, head);
    if (a) auctions.push(a);
  }
  return { source: "sim", head, auctions };
}

/** How far in to start, so the first frame is mid-flight rather than an empty board. */
export const SIM_WARM_START_MS = (3 * CYCLE_BLOCKS + 34) * SIM_MS_PER_BLOCK;
