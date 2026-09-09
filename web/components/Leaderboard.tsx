"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useMemo } from "react";
import type { Auction, Source } from "@/lib/useAuctions";

/**
 * Standings across the rounds on the board.
 *
 * THE HONEST SHAPE OF THIS IS NOT THE OBVIOUS ONE, and the difference is the whole reason
 * this file has a comment this long.
 *
 * subgraph/README.md's refusals list forbids "'solver concentration', 'market share',
 * 'win share' as competitiveness", and says `Account.auctionsWon` "is a count and is shown
 * as a count". ui-spec.md S2 repeats it: never a ratio without its numerator and
 * denominator. So this is not a win-rate table. Every column is an integer you could
 * recount from the rounds above, the rank number is a position in THIS list and not a
 * standing in any market, and there is no percentage anywhere.
 *
 * On live data it is nearly always empty, and it says so plainly. Four rounds have been
 * opened on the Book and none has ever been revealed in or settled, so there is no winner
 * to rank -- and an empty leaderboard with an explanation is worth more than a populated
 * one that had to invent someone.
 *
 * In the rehearsal it fills up and moves, which is what it is for: the display is real,
 * the data is simulated, and the chip says which. The house bidder is disclosed on the
 * page for the same reason -- a keeper that also bids would otherwise sit at the top of
 * this table with no explanation.
 */

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

type Row = {
  bidder: string;
  entered: number;
  revealed: number;
  won: number;
  best: number | null;
};

/**
 * Counts per bidder, from the rounds on the board.
 *
 * `won` counts only SETTLED rounds. Until a round settles its best bidder is provisional --
 * a later reveal can displace them -- and crediting a win that a subsequent block takes
 * away is how a leaderboard starts lying without anyone editing it.
 */
export function standings(auctions: Auction[]): Row[] {
  const by = new Map<string, Row>();

  for (const a of auctions) {
    if (!a.bids) continue; // null is "the log scan failed", not "nobody bid"
    for (const b of a.bids) {
      if (!b.bidder) continue;
      const key = b.bidder.toLowerCase();
      const row = by.get(key) ?? { bidder: b.bidder, entered: 0, revealed: 0, won: 0, best: null };
      row.entered += 1;
      if (b.bps !== null && b.bps !== undefined) {
        row.revealed += 1;
        row.best = row.best === null ? b.bps : Math.max(row.best, b.bps);
      }
      by.set(key, row);
    }
    if (a.settled && a.bestBidder) {
      const key = a.bestBidder.toLowerCase();
      const row = by.get(key);
      if (row) row.won += 1;
    }
  }

  return [...by.values()].sort(
    (x, y) => y.won - x.won || y.revealed - x.revealed || (y.best ?? -1) - (x.best ?? -1),
  );
}

export function Leaderboard({
  auctions,
  source,
  className,
}: {
  auctions: Auction[];
  source: Source;
  className?: string;
}) {
  const reduced = useReducedMotion();
  const rows = useMemo(() => standings(auctions), [auctions]);
  const simulated = source === "sim";
  const settledCount = auctions.filter((a) => a.settled).length;

  return (
    <figure data-src={simulated ? "sim" : "chain"} className={`border border-rule bg-raised ${className ?? ""}`}>
      <figcaption className="flex flex-wrap items-center justify-between gap-2 border-b border-rule px-4 py-2.5">
        <span className="font-mono text-[0.72rem] uppercase tracking-[0.14em] text-ink">
          Who has been bidding
        </span>
        <span
          className={`border px-2 py-0.5 font-mono text-[0.64rem] uppercase tracking-[0.12em] ${
            simulated ? "border-amber text-amber" : "border-glass text-glass"
          }`}
        >
          {simulated ? "Simulated · not a chain read" : "Base mainnet · read from the contract"}
        </span>
      </figcaption>

      {rows.length === 0 ? (
        <div className="px-4 py-8">
          <p className="text-ink-soft">Nobody has opened a sealed bid yet.</p>
          <p className="mt-2 max-w-xl text-sm text-ink-faint">
            {auctions.length === 0
              ? "No round has been opened on this Book."
              : `${auctions.length} round${auctions.length === 1 ? " has" : "s have"} been opened and ${
                  settledCount === 0 ? "none has settled" : `${settledCount} settled`
                }, but no commitment has been revealed — so there is no bid to count and no
                   winner to name.`}{" "}
            This table fills in when one is. It is not hidden while empty, and it is not
            padded with anyone.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto px-4 py-4">
          <table className="w-full min-w-[34rem] border-collapse text-[0.84rem]">
            <thead>
              <tr className="border-b border-rule text-left font-mono text-[0.64rem] uppercase tracking-[0.12em] text-ink-faint">
                <th className="w-8 py-2 pr-3 font-normal">#</th>
                <th className="py-2 pr-4 font-normal">bidder</th>
                <th className="py-2 pr-4 text-right font-normal">rounds entered</th>
                <th className="py-2 pr-4 text-right font-normal">bids opened</th>
                <th className="py-2 pr-4 text-right font-normal">rounds won</th>
                <th className="py-2 text-right font-normal">highest bid</th>
              </tr>
            </thead>
            <tbody>
              <AnimatePresence initial={false}>
                {rows.map((r, i) => (
                  <motion.tr
                    key={r.bidder.toLowerCase()}
                    // `layout` is what makes a rank change read as a rank change rather
                    // than as the numbers silently swapping under a fixed order.
                    layout={!reduced}
                    initial={reduced ? false : { opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.28, ease: [0.22, 0.61, 0.36, 1] }}
                    className={`border-b border-rule ${i === 0 && r.won > 0 ? "bg-glass-soft" : ""}`}
                  >
                    <td className="tnum py-2.5 pr-3 text-ink-faint">{i + 1}</td>
                    <td className="tnum py-2.5 pr-4">{short(r.bidder)}</td>
                    <td className="tnum py-2.5 pr-4 text-right">{r.entered}</td>
                    <td className="tnum py-2.5 pr-4 text-right">
                      {r.revealed}
                      <span className="text-ink-faint"> of {r.entered}</span>
                    </td>
                    <td className={`tnum py-2.5 pr-4 text-right ${r.won > 0 ? "text-glass" : "text-ink-faint"}`}>
                      {r.won}
                    </td>
                    <td className="tnum py-2.5 text-right">{r.best === null ? "—" : `${r.best} bps`}</td>
                  </motion.tr>
                ))}
              </AnimatePresence>
            </tbody>
          </table>
        </div>
      )}

      <p className="border-t border-rule px-4 py-3 text-[0.78rem] leading-relaxed text-ink-faint">
        <strong className="font-medium text-ink-soft">What produced this:</strong>{" "}
        {simulated ? (
          <>
            counted here from the rounds <code className="font-mono">web/lib/simulate.js</code> is
            replaying. The display is real and the bidders are not — these addresses belong to nobody.
          </>
        ) : (
          <>
            counted here from the rounds on the board, which come from the{" "}
            <code className="font-mono">GlasshouseBook</code> contract on Base. One row per address that
            has committed to at least one round in the window shown.
          </>
        )}{" "}
        Every column is a <strong className="font-medium text-ink-soft">count</strong>, never a share:
        the number ranked on is rounds won, printed beside the rounds entered it came from. A round
        counts as won only once it has settled, because until then a later reveal can still take it
        away. This is a position in this list, not a standing in a market — Glasshouse does not have
        one, and <code className="font-mono">subgraph/README.md</code> refuses to imply it does.{" "}
        {!simulated && "The keeper bids too, and is disclosed rather than filtered out."}
      </p>
    </figure>
  );
}
