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

// Boundaries and the reference block can arrive as a JS number, a decimal string (The
// Graph serialises `BigInt` fields as strings over HTTP), or a bigint. Normalise to
// bigint before comparing so a block height near the edge of Number's safe integer range
// is never silently rounded.
function toBigInt(value) {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" || typeof value === "string") return BigInt(value);
  throw new TypeError(`phase(): expected a block-number-like value, got ${typeof value}: ${value}`);
}

/**
 * a: the auction's boundaries and reveal state.
 *      commitEnd, revealEnd, exclusiveEnd - inclusive block boundaries (matching the
 *      Auction entity fields of the same names).
 *      bestBidder - null/undefined if nobody has revealed yet, otherwise anything truthy
 *      (the subgraph puts an Account id there; a boolean works too).
 * n: the block the answer is "as of". Almost always `_meta.block.number` from the same
 *    query that fetched `a` - see the rules in section 6.1 for why it must be that block
 *    and not a locally-read clock or a different query's head.
 *
 * Returns one of "commit" | "reveal" | "exclusive" | "open".
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
export function phase(a, n) {
  const block = toBigInt(n);
  const commitEnd = toBigInt(a.commitEnd);
  const revealEnd = toBigInt(a.revealEnd);

  if (block <= commitEnd) return "commit"; // GlasshouseBook.sol:159
  if (block <= revealEnd) return "reveal"; // :185-186, :219

  // No reveal means no winner, and outcome() returns exclusiveUntil = revealEnd when
  // a.best == address(0) (:222-225) - i.e. the exclusive window collapses to zero length
  // rather than existing with nobody exclusive in it. Checking bestBidder here mirrors
  // that collapse instead of reading a boundary that the contract itself skipped past.
  if (a.bestBidder != null && block <= toBigInt(a.exclusiveEnd)) return "exclusive"; // :231, GlasshouseAuctionLib.sol:62

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
 *
 * a: needs `exclusiveEnd`, and `settled` if the caller asked for it.
 * n: the block the answer is "as of", from the same query (see `phase`).
 */
export function canSettle(a, n) {
  if (a.settled === true) return false;
  return toBigInt(n) > toBigInt(a.exclusiveEnd);
}
