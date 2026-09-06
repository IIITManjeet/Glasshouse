// The recommendation is policy, not fact (docs/design/subgraph-design.md section 7.2):
// the subgraph mapping records what happened per auction (competition, thin, bestBps,
// ...) as integers, and this file decides what to do about it. Kept pure and dependency-
// free so the page and the advisor run the identical function over the identical window
// and can never quietly disagree about the number they show a maker.
//
// The three regimes this rule leans on are test/ReserveMatrix.t.sol, not a guess:
//   - five competitive bidders (400/250/100/60/30): clearing is 250 bps at every reserve
//     tested, 0 through 200 (test_Competitive_SecondPriceDominatesTheReserve). The
//     reserve is inert; recommending above the floor would only exclude bidders who were
//     never the ones setting the price.
//   - a thin ladder (400/30/20): clearing is 30 at reserve 0, 50 at reserve 50, 200 at
//     reserve 200 (test_Thin_TheReserveIsWhatProtectsTheMaker). Here the reserve IS the
//     maker's protection, and it should rise toward what the winner already showed they
//     would pay.
//   - one bidder: pays exactly the reserve, including 0 if the reserve is 0
//     (test_OneBidder_PaysExactlyTheReserve, test_OneBidder_ZeroReserveReturnsNothing-
//     ToTheMaker). That second test is the number that appears if only one person bids
//     and the reserve was left at 0 - the argument against ever defaulting there.
//
// A binding reserve never shows up in the data as "two reveals, both below the reserve":
// reveal() rejects any bps < reserveBps outright (GlasshouseBook.sol:187), so with two or
// more reveals the runner-up is always >= the reserve. It shows up as a SOLE auction (one
// reveal, the rest of that auction's commitments unrevealed) or as a CONTESTED auction
// whose runner-up was far below the winner. Both are folded into `thin` upstream, in the
// mapping; this file only reads `competition` and `thin`, it does not recompute them.
//
// This is a heuristic that splits a known-safe value (the floor) from a known-unsafe one
// (a reserve above a winner we actually had). It is not an optimal-reserve computation -
// that needs the bidders' value distribution, which a handful of auctions does not
// estimate - and the page must say so next to the number.

export const NO_HISTORY = "NO_HISTORY";
export const COMPETITION_PRICES = "COMPETITION_PRICES";
export const NO_REVEALS = "NO_REVEALS";
export const WINNER_BELOW_FLOOR = "WINNER_BELOW_FLOOR";
export const THIN_COMPETITION = "THIN_COMPETITION";

/**
 * window: rows shaped like the Q3 query result (subgraph-design.md section 7.2),
 *         ordered most-recent-settled-first (`orderBy: revealEnd, orderDirection: desc`).
 *         Each row needs: competition ("NONE"|"SOLE"|"CONTESTED"), thin (boolean),
 *         bestBps (integer), bestBidder (object/id, or null/undefined if nobody
 *         revealed), unrevealedCount, teamRevealed, invitedRevealed, unknownRevealed
 *         (integers).
 * opts.floorBps: the staleness floor (config/auction.json basis.reserveBps = 50). Never
 *         recommended below, because that is the number window-sizing.md derived from
 *         mid-price movement over the lockup, not from competition.
 * opts.maxBps:   config/auction.json advocated.maxBps = 500. A ceiling on the band; never
 *         a reason to recommend higher than the window supports.
 * opts.K: window size. The rule truncates `window` to the first K rows itself, so a
 *         caller that forgot `first: $k` in the query still gets the same answer as one
 *         that didn't - the truncation is part of the rule, not just the query.
 *
 * Returns { bps, band: [lo, hi], reason, n, empty, weak, strong, minBest, unrevealed,
 *           provenance: { team, invited, unknown } }.
 */
export function recommendReserve(window, { floorBps = 50, maxBps = 500, K = 8 } = {}) {
  const rows = window.slice(0, K);
  const n = rows.length;

  let empty = 0;
  let weak = 0;
  let strong = 0;
  let minBest; // undefined until a row with a winner is seen
  let unrevealed = 0;
  let team = 0;
  let invited = 0;
  let unknown = 0;

  for (const r of rows) {
    if (r.competition === "NONE") empty++;
    if (r.thin) weak++;
    if (r.competition === "CONTESTED" && !r.thin) strong++;
    if (r.bestBidder != null) {
      minBest = minBest === undefined ? r.bestBps : Math.min(minBest, r.bestBps);
    }
    unrevealed += r.unrevealedCount ?? 0;
    team += r.teamRevealed ?? 0;
    invited += r.invitedRevealed ?? 0;
    unknown += r.unknownRevealed ?? 0;
  }

  const base = {
    n,
    empty,
    weak,
    strong,
    minBest: minBest === undefined ? null : minBest,
    unrevealed,
    provenance: { team, invited, unknown },
  };

  if (n === 0) {
    return { bps: floorBps, band: [floorBps, floorBps], reason: NO_HISTORY, ...base };
  }

  if (strong * 2 > n) {
    // Strict majority of auctions where competition, not the reserve, set the price.
    // minBest is defined here: strong > 0 requires at least one CONTESTED row, and
    // CONTESTED implies a winner.
    //
    // Same band arithmetic and the same guard as the THIN_COMPETITION arm below.
    // Without the guard this returns an inverted band: two settled auctions at
    // reserveBps 0 with reveals of 30 and 20 bps give minBest = 30 and, at the default
    // floor of 50, [50, 29]. `bps` is the floor either way, so only the band was
    // nonsense, but a band whose high end is below its low end is not a band.
    //
    // The reason stays COMPETITION_PRICES: it names why the recommendation is the
    // floor, which is still "competition set the price". WINNER_BELOW_FLOOR is the
    // thin arm's answer to a different question, where the band IS the recommendation.
    const hi = Math.min(minBest - 1, maxBps);
    if (hi < floorBps) {
      return { bps: floorBps, band: [floorBps, floorBps], reason: COMPETITION_PRICES, ...base };
    }
    return { bps: floorBps, band: [floorBps, hi], reason: COMPETITION_PRICES, ...base };
  }

  if (empty * 2 > n) {
    // test_ReserveAboveEveryBid_AuctionAccomplishesNothing: an auction with zero reveals
    // looks identical whether nobody was interested or the reserve excluded everyone.
    // The Book cannot tell those apart and neither can this rule, so it does not guess
    // upward - it returns to the floor rather than compounding a reserve that may
    // already be the problem.
    return { bps: floorBps, band: [floorBps, floorBps], reason: NO_REVEALS, ...base };
  }

  // Weak is at least half, or there is no majority in either direction; ties favour
  // protecting the maker (test_Thin_TheReserveIsWhatProtectsTheMaker,
  // test_OneBidder_PaysExactlyTheReserve). The reserve is the price in this regime, so
  // raise it toward the lowest winning bid this window actually saw, minus one bps so
  // the recommendation would not have excluded that winner.
  const hi = Math.min(minBest - 1, maxBps);
  if (hi < floorBps) {
    return { bps: floorBps, band: [floorBps, floorBps], reason: WINNER_BELOW_FLOOR, ...base };
  }
  const mid = Math.floor((floorBps + hi) / 2); // integer division, deliberately not rounded
  return { bps: mid, band: [floorBps, hi], reason: THIN_COMPETITION, ...base };
}
