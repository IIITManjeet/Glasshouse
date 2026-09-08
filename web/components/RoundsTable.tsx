"use client";

import { type Auction, livePhase } from "@/lib/useAuctions";

const num = (n: number) => n.toLocaleString("en-US");

// Duplicated from components/Auction.tsx rather than imported: that file exports no such
// helper, and this task's brief is to touch nothing outside these two new files -- adding
// an export there would mean editing a file that is out of scope.
const short = (a?: string | null) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "—");
const basescan = (a: string) => `https://basescan.org/address/${a}`;

function AddressLink({ addr }: { addr: string }) {
  return (
    <a
      href={basescan(addr)}
      target="_blank"
      rel="noopener noreferrer"
      title={addr}
      className="tnum text-glass underline decoration-rule underline-offset-2 hover:decoration-glass"
    >
      {short(addr)}
    </a>
  );
}

/**
 * The phase chip for one row.
 *
 * Calls the same `livePhase` the live board's PhaseTrack uses (lib/useAuctions.ts, which
 * wraps lib/phase.js) rather than a second implementation. The contract stores no phase --
 * it only ever compares block.number against boundaries it wrote at open -- so this table
 * and the live board MUST derive "what phase is this" the same way against the same head,
 * or the two views of one auction could disagree about something neither actually stores.
 */
function PhaseChip({ a, head }: { a: Auction; head: number }) {
  const p = livePhase(a, head);
  const live = p !== "open"; // "open" is the quiescent end state; the other three are in flight
  return (
    <span
      className={[
        "inline-block border px-1.5 py-0.5 font-mono text-[0.66rem] uppercase tracking-[0.12em]",
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
      <p className="border border-rule bg-raised p-4 text-sm text-ink-soft">
        No rounds to show. Nothing has been read from the chain or the fallback snapshot yet
        -- that is a statement about this page's data, not a claim that zero rounds have
        happened, so the table says so in prose instead of drawing an empty grid of zeroes.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto border border-rule">
      <table className="w-full min-w-[54rem] border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-rule bg-sunk">
            {["round", "opened", "phase", "reveals", "clearing", "winner", "filled"].map((h) => (
              <th
                key={h}
                scope="col"
                className="px-3 py-2 font-mono text-[0.66rem] font-normal uppercase tracking-[0.12em] text-ink-faint"
              >
                {h}
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
                <td className="tnum px-3 py-2 text-ink">{a.round}</td>
                <td className="tnum px-3 py-2 text-ink-soft">{num(a.openedAtBlock)}</td>
                <td className="px-3 py-2">
                  <PhaseChip a={a} head={head} />
                </td>
                <td className="tnum px-3 py-2 text-ink-soft">
                  {revealsRead ? `${a.revealedCount} of ${a.committedCount}` : `not read, ${a.committedCount} committed`}
                  {missingReveals > 0 && revealWindowClosed ? (
                    <span className="ml-1.5 whitespace-nowrap text-[0.72rem] text-brick">
                      {missingReveals} unrevealed · bond forfeitable
                    </span>
                  ) : null}
                </td>
                <td className="tnum px-3 py-2 text-ink">
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
