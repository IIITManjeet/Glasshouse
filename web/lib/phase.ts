// The contract has no phase variable. `outcome()` compares `block.number` against two
// stored boundaries (src/book/GlasshouseBook.sol:219-231) and `commit()`/`reveal()`
// compare it against a third (:159, :185-186); nothing is emitted when a boundary passes.
// A subgraph mapping only runs on an event, so it cannot stamp a phase either without it
// going stale between events. The faithful design is the contract's own: store the
// boundaries, and have every reader compute the phase against the block number it fetched
// in the SAME query, via `_meta.block.number`. This file is that computation, written once
// so the page and the advisor can never disagree about what block they are as of.
//
// docs/design/subgraph-design.md section 6.1.
//
// TYPED, AND THERE WAS A SECOND COPY. `site/phase.js` was byte-identical to this file and
// the two had drifted apart in who imported them -- the tests and the advisor read one, the
// app read the other. That made `Reserve.tsx`'s claim to run "the identical function" the
// advisor runs true only by luck. One file now, and the types are the reason a third copy
// cannot quietly reappear: a caller that passes the wrong shape stops compiling.

/** What a block number can arrive as. The Graph serialises `BigInt` fields as decimal
 *  strings over HTTP, the chain reader produces numbers, and viem hands back bigints. */
export type Blockish = number | string | bigint;

/** The four phases. Not a `string`: a caller comparing against "revealing" or "settled"
 *  is a bug this union catches at the keystroke rather than in a screenshot. */
export type Phase = "commit" | "reveal" | "exclusive" | "open";

/** The boundaries a phase is computed from. Structural on purpose -- the subgraph row, the
 *  decoded struct and the simulator all satisfy it without sharing a base type. */
export interface PhaseInput {
  commitEnd: Blockish;
  revealEnd: Blockish;
  exclusiveEnd: Blockish;
  /** null/undefined if nobody has revealed. The subgraph puts an Account id here; the
   *  chain reader an address; a boolean would work. Only its truthiness is read. */
  bestBidder?: string | null | boolean;
}

/** What `canSettle` needs, which is less. */
export interface SettleInput {
  exclusiveEnd: Blockish;
  settled?: boolean;
}

// Normalise to bigint before comparing so a block height near the edge of Number's safe
// integer range is never silently rounded.
function toBigInt(value: Blockish): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" || typeof value === "string") return BigInt(value);
  throw new TypeError(`phase(): expected a block-number-like value, got ${typeof value}: ${value}`);
}

/**
 * a: the auction's boundaries and reveal state.
 * n: the block the answer is "as of". Almost always `_meta.block.number` from the same
 *    query that fetched `a` - see the rules in section 6.1 for why it must be that block
 *    and not a locally-read clock or a different query's head.
 *
 * "settled" is not a phase returned here. A settled auction is still "open" by this
 * function and the caller layers the `Auction.settled` flag on top of it.
 *
 * "open" is NOT the same predicate as "settle() would succeed", and a caller that
 * treats it as one shows a reverting button. settle() requires
 * `n > revealEnd + exclusiveBlocks` unconditionally (GlasshouseBook.sol:266), whereas
 * this function returns "open" from `n > revealEnd` onward when nobody revealed,
 * because that is when the FILL is open (:222-225). For a winnerless auction with
 * exclusiveBlocks = 15 those differ for 15 blocks, about 30 s on Base. Use
 * `canSettle(a, n)` below for the settle predicate; do not re-derive it from the phase.
 */
export function phase(a: PhaseInput, n: Blockish): Phase {
  const block = toBigInt(n);
  const commitEnd = toBigInt(a.commitEnd);
  const revealEnd = toBigInt(a.revealEnd);

  if (block <= commitEnd) return "commit"; // GlasshouseBook.sol:159
  if (block <= revealEnd) return "reveal"; // :185-186, :219

  // No reveal means no winner, and outcome() returns exclusiveUntil = revealEnd when
  // a.best == address(0) (:222-225) - i.e. the exclusive window collapses to zero length
  // rather than existing with nobody exclusive in it. Checking bestBidder here mirrors
  // that collapse instead of reading a boundary that the contract itself skipped past.
  if (a.bestBidder != null && a.bestBidder !== false && block <= toBigInt(a.exclusiveEnd)) {
    return "exclusive"; // :231, GlasshouseAuctionLib.sol:62
  }

  return "open"; // :224, GlasshouseAuctionLib.sol:76-77
}

/**
 * Would `settle(maker, orderHash)` succeed at block `n`?
 *
 * A separate function from `phase()` because the two boundaries genuinely differ.
 * settle() requires `block.number > a.revealEnd + a.exclusiveBlocks`
 * (GlasshouseBook.sol:266) with NO test on `a.best`, so the exclusive window counts
 * against the settle clock even for an auction nobody bid on -- which is exactly the
 * auction `phase()` calls "open" the block after revealEnd. `Auction.exclusiveEnd` is
 * stored as `revealEnd + exclusiveBlocks` at every bidder count (subgraph
 * schema.graphql), so it is the correct boundary to compare here even though `phase()`
 * skips past it when there is no winner.
 *
 * Also false once `a.settled` is true: settle() reverts with AlreadySettled (:265).
 * A row that omits `settled` is treated as not settled, which is what a query that did
 * not ask for the field means.
 */
export function canSettle(a: SettleInput, n: Blockish): boolean {
  if (a.settled === true) return false;
  return toBigInt(n) > toBigInt(a.exclusiveEnd);
}
