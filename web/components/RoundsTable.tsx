"use client";

import type { MouseEvent } from "react";
import { type Auction, livePhase } from "@/lib/useAuctions";
// The local copy of this used to point at Basescan and nowhere else. It now comes from
// components/Address.tsx, which sends the address text to the bidder's own record here and
// keeps Basescan on a separate arrow.
import { AddressLink } from "./Address";
import { BidStrip } from "./BidStrip";

const num = (n?: number | null) =>
  n === null || n === undefined || Number.isNaN(n) ? "—" : n.toLocaleString("en-US");

/** `unknown` on purpose. Written as `x !== null && x !== undefined` against a field typed
 *  `number | null`, TypeScript is entitled to call the second half a comparison with no
 *  overlap; this keeps the three-state check (not read / read as zero / read as N) in one
 *  place instead of spelling it out at six call sites. */
const isNil = (v: unknown) => v === null || v === undefined;

/**
 * A LEDGER, NOT A SPREADSHEET.
 *
 * Same rows, same numbers, different object. What changed and why:
 *
 * 1. COLUMN ORDER IS THE READING ORDER OF A MARKET. round, then what window it is in, then
 *    who is in it, then the price, then who won, then whether it filled -- and `opened`, a
 *    block number nobody scans for, last rather than second. The old order put the least
 *    interesting number in column two.
 *
 * 2. THE HOVER NO LONGER LIES. `hover:bg-raised` sat on the whole `<tr>` while only the
 *    round cell was a link: the entire row lit up under the cursor and then swallowed the
 *    click. `.row-link` in globals.css is the fix and the contract -- a real hover surface,
 *    a chevron in the last cell, one real anchor inside carrying the focus ring, and the
 *    row genuinely navigating. The guard in `openRow` is the other half: a click that lands
 *    on the winner's address, its Basescan arrow, or any other control inside the row
 *    belongs to THAT control, and the row must not hijack it.
 *
 * 3. A LIVE ROUND ANNOUNCES ITSELF THREE WAYS, because one way is a guess: a glass rule
 *    down the left edge, a pulsing dot, and a phase cell that counts blocks instead of
 *    printing a bare word. Rounds where nobody opened a bid go faint throughout so the eye
 *    skips them without having to read them.
 *
 * 4. THE PHASE CELL IS A `.chip`, NOT A HAND-ROLLED BORDERED SPAN. The old one was
 *    `border px-1.5 py-0.5 font-mono text-[0.6875rem] uppercase tracking-[0.12em]` -- the
 *    exact shape DESIGN.md F-3 is about, a label indistinguishable from a button, sitting
 *    in a row that is now itself clickable.
 *
 * 5. THE PHASE WORD `open` IS NOW `open to all`. `livePhase` returns "open" for the
 *    quiescent END state -- anyone may fill, at base price -- one column from a round that
 *    a visitor would read as "open for bids". The old file's own comment flagged this
 *    collision; naming it fixes it.
 *
 * STILL NO PERCENTAGES ANYWHERE (subgraph/README.md's refusals list): the bid strip is two
 * counts side by side, never a share, and there is no win-rate, concentration or fill-rate
 * column because none of them is computable from what GlasshouseBook emits.
 */

/** Which columns carry a quantity. Drives both the header and the cell alignment, so the
 *  two cannot drift apart -- they were two separate literals before this.
 *
 *  `round` is deliberately NOT numeric here. It is the row's identifier and its anchor, and
 *  every ledger in the world sets its instrument column flush left; right-aligning it put
 *  the one thing you click furthest from the edge you scan. The quantities that have to line
 *  up -- clearing and opened -- still do. */
const COLUMNS = [
  { key: "round", numeric: false },
  { key: "phase", numeric: false },
  { key: "bids", numeric: false },
  { key: "clearing", numeric: true },
  { key: "winner", numeric: false },
  { key: "filled", numeric: false },
  { key: "opened", numeric: true },
] as const;

/** A plain <a>, never next/link. /r/<hash> is an edge rewrite in vercel.json onto
 *  /round/?h=, not a route this static export produced, so next/link resolves it on the
 *  CLIENT, finds nothing and renders 404 without making a request. components/Address.tsx
 *  documents the same trap for /profile/<addr>. */
const roundHref = (a: Auction) => `/r/${a.orderHash}`;

/**
 * THE CLICK GUARD, and the reason `.row-link` is allowed to exist at all.
 *
 * A row with three anchors in it (the round, the winner's record, the winner on Basescan)
 * plus a whole-row destination is exactly the ambiguity globals.css forbids on cards. It is
 * permitted on a row only with this: anything the visitor actually aimed at wins, and the
 * row destination is the fallback for the 80% of the row that is not a target.
 *
 * Modifier-clicks and middle-clicks are left alone too -- cmd-click on a row should be the
 * browser's business, and `location.assign` would have stolen it into the current tab.
 */
function openRow(e: MouseEvent<HTMLTableRowElement>, href: string) {
  if (e.defaultPrevented || e.button !== 0) return;
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const target = e.target as HTMLElement | null;
  if (target?.closest?.("a, button, input, select, textarea, label, summary")) return;
  window.location.assign(href);
}

export function RoundsTable({ auctions, head }: { auctions: Auction[]; head: number }) {
  // The caller's array is whatever order its source produced it in. This table's contract
  // is "newest first", so it sorts defensively rather than trusting an upstream order that
  // isn't part of its own interface.
  const rows = [...auctions].sort((a, b) => b.round - a.round);

  if (rows.length === 0) {
    return (
      <p className="border border-rule bg-raised rounded-card shadow-card p-4 text-sm text-ink-soft">
        No rounds to show. Nothing has been read from the chain or the fallback snapshot yet
        -- that is a statement about this page&rsquo;s data, not a claim that zero rounds have
        happened, so the table says so in prose instead of drawing an empty grid of zeroes.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto border border-rule rounded-card">
      <table className="w-full min-w-[58rem] border-collapse text-left text-sm">
        <thead className="sticky top-0 z-10">
          <tr>
            {/* RIGHT-ALIGN THE QUANTITIES. This is the single cheapest thing that makes a
                table read as a market rather than as a spreadsheet somebody exported: a
                column of figures whose digits do not line up cannot be scanned, only read
                one row at a time. `tnum` already gives tabular figures, so right-aligning
                actually lines the places up rather than approximately so. Words and
                identifiers stay left; mixing the two is what the alignment is FOR -- the eye
                can tell a quantity from a label before reading either. */}
            {COLUMNS.map(({ key, numeric }) => (
              <th
                key={key}
                scope="col"
                // The background goes on the CELLS, not the row: a sticky <thead> paints
                // nothing of its own, so a row-level background scrolls away and the rows
                // slide under bare text.
                className={[
                  "whitespace-nowrap border-b border-rule bg-lifted px-3 py-2.5 font-mono text-[0.6875rem] font-normal uppercase tracking-[0.12em] text-ink-faint",
                  numeric ? "text-right" : "text-left",
                ].join(" ")}
              >
                {key}
              </th>
            ))}
            {/* The chevron column. `.row-link` injects the `›` into the last cell, so the
                header needs a matching one -- with a real name for a screen reader, which
                gets no chevron and would otherwise meet an unlabelled column. */}
            <th scope="col" className="w-8 border-b border-rule bg-lifted px-3 py-2.5">
              <span className="sr-only">open the round</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((a) => {
            const p = livePhase(a, head);
            const isLive = p !== "open"; // "open" is the quiescent end state
            const end = p === "commit" ? a.commitEnd : p === "reveal" ? a.revealEnd : a.exclusiveEnd;
            // commit() accepts while block.number <= commitEnd (GlasshouseBook.sol:159), so
            // at head == commitEnd there is ONE block left. No +1 here; the same subtraction
            // Countdown does, against the same head.
            const blocksLeft = Math.max(0, end - head);

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
            const revealsRead = !isNil(a.revealedCount);
            const missingReveals = revealsRead ? a.committedCount - (a.revealedCount as number) : 0;

            // A ROW THE EYE SHOULD SKIP. The window closed and nothing was opened in it --
            // no winner, no price, nothing to read. Faint throughout, and only ever when the
            // count was actually READ: a failed log scan must not dim a round into looking
            // like one nobody bid in.
            const nobodyOpened = revealWindowClosed && revealsRead && (a.revealedCount as number) === 0;

            const href = roundHref(a);

            return (
              <tr
                key={a.orderHash}
                className={[
                  "row-link border-b border-rule last:border-b-0",
                  nobodyOpened ? "text-ink-faint" : "",
                ].join(" ")}
                // A live round announces itself three ways and this is the first: a glass
                // rule down the left edge. Transparent rather than absent on the others, so
                // the 2px does not shift every settled row two pixels left of the live one.
                style={{ borderLeft: `2px solid ${isLive ? "var(--color-glass)" : "transparent"}` }}
                onClick={(e) => openRow(e, href)}
              >
                {/* THE ROW OPENS, and the round cell is the anchor that makes it keyboard
                    reachable -- `.row-link` needs one real <a> inside it to carry the focus
                    ring, because a <tr> is not focusable and giving it a tabindex would put
                    a second tab stop on every row. The hash is the key rather than the round
                    number because the most interesting auction on this Book, the one that
                    cleared at the runner-up's price, has no round number: it is the live-fill
                    order, built above the manifest so it can never collide with a keeper
                    round. */}
                <td className="px-3 py-2.5">
                  <a
                    href={href}
                    className={[
                      "tnum whitespace-nowrap font-medium underline decoration-rule underline-offset-2 hover:decoration-glass",
                      nobodyOpened ? "text-ink-faint" : "text-ink",
                    ].join(" ")}
                  >
                    {/* The hash, not the word "open". An auction with no manifest index
                        showed "open" here, one column from a phase chip also reading
                        OPEN -- two unrelated meanings wearing the same word in the same
                        row. The short hash is what /r/ is keyed by and what the chain
                        calls it. */}
                    {Number.isFinite(a.round) ? a.round : `${String(a.orderHash).slice(0, 6)}…`}
                  </a>
                </td>

                <td className="whitespace-nowrap px-3 py-2.5">
                  {isLive ? (
                    // A CHIP, NOT A HAND-ROLLED BORDERED SPAN, and it counts blocks rather
                    // than printing a bare word: "commit · 17 blk" is the only thing in this
                    // row that tells you whether you can still act.
                    <span className="chip chip-live">
                      <span className="live-dot" aria-hidden="true" />
                      <span className="tnum">
                        {p} · {blocksLeft} blk
                      </span>
                    </span>
                  ) : (
                    // `open` from livePhase means the END state: the exclusive window lapsed
                    // and anyone may fill at base price. Spelled out, because "open" beside a
                    // list of rounds reads as "open for bids", which is its opposite.
                    <span className={nobodyOpened ? "text-ink-faint" : "text-ink-soft"}>
                      {a.settled ? "settled · open to all" : "open to all"}
                    </span>
                  )}
                </td>

                <td className="px-3 py-2.5">
                  <BidStrip a={a} mode="compact" />
                  {missingReveals > 0 && revealWindowClosed ? (
                    // A bond can only be forfeited if there is one, and every keeper round
                    // runs with bond = 0 (scripts/keeper.ts:58), so this says "unrevealed"
                    // and leaves the bond out of it.
                    <span className="ml-1.5 whitespace-nowrap align-middle text-[0.72rem] text-brick">
                      {missingReveals} unrevealed
                    </span>
                  ) : null}
                </td>

                <td className="tnum whitespace-nowrap px-3 py-2.5 text-right">
                  {isNil(a.clearingBps) ? (
                    <span className="text-ink-faint">—</span>
                  ) : (
                    <>
                      <span className={nobodyOpened ? "" : "text-ink"}>{a.clearingBps} bps</span>{" "}
                      <span className={nobodyOpened ? "" : clearingTone}>· {clearingState}</span>
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

                <td className="px-3 py-2.5">
                  {a.bestBidder ? (
                    // The mark comes along on purpose: it is what turns six rows of hex into
                    // six recognisable participants, and it is the same mark the receipt and
                    // the profile draw for the same address.
                    <AddressLink addr={a.bestBidder} role={a.settled ? "winner" : "leading"} />
                  ) : revealWindowClosed && revealsRead ? (
                    <span className="text-ink-faint">nobody opened a bid</span>
                  ) : revealsRead ? (
                    <span className="text-ink-faint">not yet</span>
                  ) : (
                    <span className="text-amber">not read</span>
                  )}
                </td>

                <td className="px-3 py-2.5">
                  {a.filled && a.filledBy ? (
                    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-glass">
                      filled · <AddressLink addr={a.filledBy} role="filled" mark={false} />
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

                <td className="tnum whitespace-nowrap px-3 py-2.5 text-right font-normal text-ink-soft">
                  {num(a.openedAtBlock)}
                </td>

                {/* The chevron lives here: `.row-link > td:last-child::after` draws it, and
                    it goes glass on hover so the row's destination is visible before the
                    click rather than discovered by it. */}
                <td className="w-8 px-3 py-2.5 text-right align-middle" aria-hidden="true" />
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default RoundsTable;
