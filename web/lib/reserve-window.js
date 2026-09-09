// Turning board rows into the window `reserve-rule.js` expects.
//
// The rule was written against the subgraph's Q3 result: rows already carrying
// `competition`, `thin`, `winnerMarginBps` and the per-provenance reveal counts, because
// subgraph/src/helpers.ts derives all of them in the mapping. The subgraph is deployed to
// Studio and not published, so nothing can query it, and the page reads the Book directly
// instead -- which gives it the raw fields and none of the derived ones.
//
// So they are derived here, and they are a TRANSLITERATION of the mapping, not a second
// opinion: `classify` and `isThin` below are subgraph/src/helpers.ts:244-261 line for
// line, and the clearing rule is applyDerivedClearing(), which is itself verbatim from
// GlasshouseBook.sol:229. Three copies of one rule is one too many, and the moment the
// subgraph is published this file should be deleted rather than kept in sync. Until then
// the alternative is a reserve panel that cannot run at all, and the rule matters more to
// a maker than the duplication does.

/** subgraph/src/helpers.ts:244 */
function classify(revealedCount) {
  if (revealedCount === 0) return "NONE";
  if (revealedCount === 1) return "SOLE";
  return "CONTESTED";
}

/** subgraph/src/helpers.ts:257. The factor of two is a threshold, labelled as one. */
function isThin(competition, winnerMarginBps, clearingBps) {
  if (competition === "SOLE") return true;
  return competition === "CONTESTED" && winnerMarginBps > clearingBps;
}

/**
 * The settled rows of the board, newest first, in the rule's shape.
 *
 * Only settled auctions count. A round still in its reveal window has a `bestBps` that a
 * later reveal can displace, and feeding a provisional winner into a rule that recommends
 * a reserve "one below the lowest winner we had" would recommend against a winner who is
 * not the winner yet.
 *
 * Rows whose reveals could not be READ are dropped rather than counted as zero-reveal
 * auctions. `revealedCount === null` means an eth_getLogs call failed; scoring it as NONE
 * would push the rule toward its NO_REVEALS arm on the strength of a network error. The
 * count of dropped rows comes back so the panel can say how many it could not see.
 */
export function reserveWindow(auctions) {
  const rows = [];
  let unreadable = 0;

  for (const a of auctions) {
    if (!a.settled) continue;
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
