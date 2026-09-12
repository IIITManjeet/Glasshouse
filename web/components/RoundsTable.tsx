"use client";

import Link from "next/link";
import { type Auction, livePhase } from "@/lib/useAuctions";
// The local copy of this used to point at Basescan and nowhere else. It now comes from
// components/Address.tsx, which sends the address text to the bidder's own record here and
// keeps Basescan on a separate arrow.
import { AddressLink } from "./Address";

const num = (n?: number | null) =>
  n === null || n === undefined || Number.isNaN(n) ? "—" : n.toLocaleString("en-US");

/**
 * The phase chip for one row.
 *
 * Calls the same `livePhase` the live board's PhaseTrack uses (lib/useAuctions.ts, which
 * wraps lib/phase.js) rather than a second implementation. The contract stores no phase --
 * it only ever compares block.number against boundaries it wrote at open -- so this table
 * and the live board MUST derive "what phase is this" the same way against the same head,
 * or the two views of one auction could disagree about something neither actually stores.
 */
/** Which columns carry a quantity. Drives both the header and the cell alignment, so
 *  the two cannot drift apart -- they were two separate literals before this. */
const COLUMNS = [
  { key: "round", numeric: true },
  { key: "opened", numeric: true },
  { key: "phase", numeric: false },
  { key: "reveals", numeric: true },
  { key: "clearing", numeric: true },
  { key: "winner", numeric: false },
  { key: "filled", numeric: false },
] as const;

function PhaseChip({ a, head }: { a: Auction; head: number }) {
  const p = livePhase(a, head);
  const live = p !== "open"; // "open" is the quiescent end state; the other three are in flight
  return (
    <span
      className={[
        "inline-block whitespace-nowrap border px-1.5 py-0.5 font-mono text-[0.6875rem] uppercase tracking-[0.12em]",
        live ? "border-glass bg-glass-soft text-glass" : "border-rule text-ink-faint",
      ].join(" ")}
    >
      {p}
    </span>
  );
}

/**
 * Every auction the caller handed us, newest round first, as a plain instrument-tier table.
 *
 * No percentages anywhere on this component (subgraph/README.md's refusals list): reveals
 * are printed as "N of M", never as a share, and there is no win-rate, concentration or
 * fill-rate column because none of those are computable from what GlasshouseBook emits --
 * see the same list for why a ratio without both its numbers is not shown at all.
 */
export function RoundsTable({ auctions, head }: { auctions: Auction[]; head: number }) {
  // The caller's array is whatever order its source produced it in. This table's contract
  // is "newest first", so it sorts defensively rather than trusting an upstream order that
  // isn't part of its own interface.
  const rows = [...auctions].sort((a, b) => b.round - a.round);

  if (rows.length === 0) {
    return (
      <p className="border border-rule bg-raised rounded-card shadow-card p-4 text-sm text-ink-soft">
        No rounds to show. Nothing has been read from the chain or the fallback snapshot yet
        -- that is a statement about this page's data, not a claim that zero rounds have
        happened, so the table says so in prose instead of drawing an empty grid of zeroes.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto border border-rule">
      <table className="w-full min-w-[62rem] border-collapse text-left text-sm">
        <thead className="sticky top-0 z-10">
          <tr className="border-b border-rule bg-lifted">
            {/* RIGHT-ALIGN THE NUMBERS. This is the single cheapest thing that makes a
                table read as a market rather than as a spreadsheet somebody exported: a
                column of figures whose digits do not line up cannot be scanned, only read
                one row at a time. `tnum` already gives tabular figures, so right-aligning
                actually lines the places up rather than approximately so. Words stay left;
                mixing the two is what the alignment is FOR -- the eye can tell a quantity
                from a label before reading either. */}
            {COLUMNS.map(({ key, numeric }) => (
              <th
                key={key}
                scope="col"
                className={[
                  "whitespace-nowrap px-3 py-2.5 font-mono text-[0.6875rem] font-normal uppercase tracking-[0.12em] text-ink-faint",
                  numeric ? "text-right" : "text-left",
                ].join(" ")}
              >
                {key}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((a) => {
            const p = livePhase(a, head);
            // Same "running while reveal is open / final once it isn't / settled after
            // settle()" language Stats() in components/Auction.tsx uses for the live board,
            // so the two views never describe one clearing price two different ways.
            const clearingState = a.settled ? "settled" : p === "open" || p === "exclusive" ? "final" : "running";
            const clearingTone =
              clearingState === "settled" ? "text-glass" : clearingState === "running" ? "text-amber" : "text-ink-soft";

            // A bid with bps === null is SEALED, not "unrevealed" -- those are different
            // claims. It only becomes "unrevealed" once the reveal window has provably
            // closed: settled is true, or the head we are rendering against has already
            // passed revealEnd. Before that, a missing reveal just means a bidder still has
            // blocks left to use; labelling it "unrevealed" this early would accuse someone
            // of an omission they have not committed yet.
            const revealWindowClosed = a.settled === true || head > a.revealEnd;
            // revealedCount is null when the log scan failed. "Not read" and "nobody
            // revealed" are different claims; only one of them is defensible.
            const revealsRead = a.revealedCount !== null && a.revealedCount !== undefined;
            const missingReveals = revealsRead ? a.committedCount - (a.revealedCount as number) : 0;
            // A bond can only be forfeited if there is one. Every keeper round runs with
            // bond = 0 (scripts/keeper.ts:58), so claiming otherwise is simply false.
            const hasBond = a.bond !== undefined && a.bond !== "0";

            return (
              <tr key={a.orderHash} className="border-b border-rule last:border-b-0 hover:bg-raised">
                {/* THE ROW OPENS. Every auction has a page at /r/<hash> and the table is
                    where anyone would look for it -- a list of rounds none of which can be
                    opened is a list, not an index. The hash is the key rather than the
                    round number because the most interesting auction on this Book, the one
                    that cleared at the runner-up's price, has no round number: it is the
                    live-fill order, built above the manifest so it can never collide with
                    a keeper round. */}
                <td className="tnum px-3 py-2 text-right text-ink">
                  <Link
                    href={`/r/${a.orderHash}`}
                    className="text-glass underline decoration-rule underline-offset-2 hover:decoration-glass"
                  >
                    {/* The hash, not the word "open". An auction with no manifest index
                        showed "open" here, one column from a phase chip also reading
                        OPEN -- two unrelated meanings wearing the same word in the same
                        row. The short hash is what /r/ is keyed by and what the chain
                        calls it. */}
                    {a.round ?? `${String(a.orderHash).slice(0, 6)}…`}
                  </Link>
                </td>
                <td className="tnum whitespace-nowrap px-3 py-2 text-right text-ink-soft">{num(a.openedAtBlock)}</td>
                <td className="px-3 py-2">
                  <PhaseChip a={a} head={head} />
                </td>
                <td className="tnum px-3 py-2 text-right text-ink-soft">
                  <span className="whitespace-nowrap">
                    {revealsRead ? `${a.revealedCount} of ${a.committedCount}` : `not read, ${a.committedCount} committed`}
                  </span>
                  {missingReveals > 0 && revealWindowClosed ? (
                    <span className="ml-1.5 whitespace-nowrap text-[0.72rem] text-brick">
                      {missingReveals} unrevealed · bond forfeitable
                    </span>
                  ) : null}
                </td>
                <td className="tnum px-3 py-2 text-right text-ink">
                  {a.clearingBps === null ? (
                    <span className="text-ink-faint">—</span>
                  ) : (
                    <>
                      {a.clearingBps} bps <span className={clearingTone}>· {clearingState}</span>
                      {/* An independent replay disagreeing with the settled outcome is
                          shown here, never hidden -- the same rule ReplayCheck follows on
                          the live board. It is null (not checked) far more often than it is
                          false, since only the subgraph, not this chain read, can replay. */}
                      {a.settlementMatchesDerivation === false ? (
                        <span className="ml-1.5 block text-[0.72rem] text-brick">replay disagrees</span>
                      ) : null}
                    </>
                  )}
                </td>
                <td className="px-3 py-2">
                  {a.bestBidder ? (
                    <AddressLink addr={a.bestBidder} />
                  ) : (
                    <span className="text-ink-faint">no reveals</span>
                  )}
                </td>
                <td className="px-3 py-2">
                  {a.filled && a.filledBy ? (
                    <span className="tnum text-glass">
                      filled · <AddressLink addr={a.filledBy} />
                    </span>
                  ) : a.winnerForfeited ? (
                    // Distinct from a plain "not filled": the winner had the exclusive
                    // window and let it lapse, which is the one outcome the design
                    // language's brick tone (forfeit / missed deadline) is for.
                    <span className="text-brick">winner forfeited</span>
                  ) : a.settled ? (
                    <span className="text-ink-faint">not filled</span>
                  ) : (
                    <span className="text-ink-faint">not yet</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
