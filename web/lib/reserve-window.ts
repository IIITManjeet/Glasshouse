// Turning board rows into the window `reserve-rule.js` expects.
//
// The rule was written against the subgraph's Q3 result: rows already carrying
// `competition`, `thin`, `winnerMarginBps` and the per-provenance reveal counts, because
// subgraph/src/helpers.ts derives all of them in the mapping. The page reads the Book
// directly instead -- which gives it the raw fields and none of the derived ones.
//
// So they are derived here, and they are a TRANSLITERATION of the mapping, not a second
// opinion: `classify` and `isThin` below are subgraph/src/helpers.ts:244-261 line for
// line, and the clearing rule is applyDerivedClearing(), which is itself verbatim from
// GlasshouseBook.sol:229. Three copies of one rule is one too many, and the condition this
// file's deletion was made conditional on HAS NOW ARRIVED: the subgraph was published on
// 2026-09-11, so the panel could read the derived fields instead of re-deriving them. Until
// that swap is made this is a live divergence risk -- any edit to helpers.ts:244-261 must be
// mirrored here or the panel and the index will quietly disagree.

import type { CompetitionClass, ReserveRow } from "./reserve-rule";
import type { Auction } from "./useAuctions";

/**
 * A window row: everything `recommendReserve` reads, plus the three derived values the
 * panel shows beside its recommendation. Declared as an extension rather than widened
 * into ReserveRow itself, so the rule's own input stays exactly what the rule reads.
 */
export interface ReserveWindowRow extends ReserveRow {
  clearingBps: number;
  winnerMarginBps: number;
  round: number;
}

/** What `reserveWindow` gives back: the rule's rows, plus what it could not see. */
export interface ReserveWindow {
  rows: ReserveWindowRow[];
  /** Settled rounds dropped because their reveals could not be READ. */
  unreadable: number;
  /** A chain read cannot answer "was this bidder on our list"; the subgraph can. */
  provenanceKnown: false;
}

/** subgraph/src/helpers.ts:244 */
function classify(revealedCount: number): CompetitionClass {
  if (revealedCount === 0) return "NONE";
  if (revealedCount === 1) return "SOLE";
  return "CONTESTED";
}

/** subgraph/src/helpers.ts:257. The factor of two is a threshold, labelled as one. */
function isThin(competition: CompetitionClass, winnerMarginBps: number, clearingBps: number): boolean {
  if (competition === "SOLE") return true;
  return competition === "CONTESTED" && winnerMarginBps > clearingBps;
}

/**
 * The rows of the board whose reveal window has CLOSED, newest first, in the rule's shape.
 *
 * THE FILTER IS `revealEnd < head`, NOT `settled`, and the difference is not cosmetic.
 * This function used to select on `settled`, reasoning that a round still in its reveal
 * window has a `bestBps` a later reveal can displace, so feeding a provisional winner into
 * a rule that recommends "one bps below the lowest winner we had" would recommend against
 * a winner who is not the winner yet. That reasoning is right, and `settled` was the wrong
 * expression of it: the property it describes is "the reveal set is final", which is
 * exactly `revealEnd < head`. `settled` is that property PLUS an unrelated event -- someone
 * calling the permissionless `settle()` -- so it over-filtered.
 *
 * It also made this disagree with `scripts/reserve-advisor.mjs`, which runs the design
 * doc's Q3 (`docs/design/subgraph-design.md` §7.2, line 1110: `where: { maker, revealEnd_lt:
 * $head }`, "what makes every row's reveal set final"). §7.2 requires the page and the
 * advisor to "agree to the basis point on the same head block", and the header of
 * reserve-rule.ts claims they "can never quietly disagree". With a live keeper they would
 * have disagreed on every round, for the 15-plus blocks each one spends past its reveal
 * window and not yet settled. scripts/verify-run.mjs found this; the spec decided it.
 *
 * Rows whose reveals could not be READ are dropped rather than counted as zero-reveal
 * auctions. `revealedCount === null` means an eth_getLogs call failed; scoring it as NONE
 * would push the rule toward its NO_REVEALS arm on the strength of a network error. The
 * count of dropped rows comes back so the panel can say how many it could not see.
 *
 * `head` is the block the caller's rows are as of -- the same number the panel prints, not
 * a fresh read, so the window and the caption cannot describe different blocks.
 */
export function reserveWindow(auctions: readonly Auction[], head: number): ReserveWindow {
  const rows: ReserveWindowRow[] = [];
  let unreadable = 0;

  for (const a of auctions) {
    if (!(a.revealEnd < head)) continue;
    if (a.revealedCount === null || a.revealedCount === undefined) {
      unreadable++;
      continue;
    }
    const revealedCount = a.revealedCount;
    const hasWinner = Boolean(a.bestBidder);
    const clearingBps = hasWinner ? Math.max(a.secondBps ?? 0, a.reserveBps) : 0;
    const winnerMarginBps = hasWinner ? (a.bestBps ?? 0) - clearingBps : 0;
    const competition = classify(revealedCount);

    rows.push({
      competition,
      thin: isThin(competition, winnerMarginBps, clearingBps),
      bestBps: a.bestBps ?? 0,
      bestBidder: a.bestBidder,
      clearingBps,
      winnerMarginBps,
      unrevealedCount: Math.max(0, (a.committedCount ?? 0) - revealedCount),
      // A chain read cannot answer "was this bidder on our list": the list is ours, and
      // the subgraph is where it lives. Zero here is not a claim that no team wallet
      // revealed -- the panel says the breakdown is unavailable rather than printing
      // three zeros as if they were counts.
      teamRevealed: 0,
      invitedRevealed: 0,
      unknownRevealed: 0,
      round: a.round,
    });
  }

  return { rows, unreadable, provenanceKnown: false };
}
