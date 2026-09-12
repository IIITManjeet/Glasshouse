"use client";

import { type Auction, type Bid } from "@/lib/useAuctions";

/**
 * BID ACTIVITY YOU CAN SEE, AND NOTHING YOU CANNOT.
 *
 * This replaces the string "reveals · 2 of 3". That string is correct and it is also the
 * reason /rounds read as an exported spreadsheet: the one fact a bidding venue is FOR --
 * how many people are in this round right now -- was a sentence you had to parse, in a
 * column of other sentences you also had to parse.
 *
 * WHAT A CELL IS. One cell per commitment the contract holds, in commit order. Nothing is
 * drawn for a bidder who did not commit, so the strip cannot overstate a round: its length
 * IS `committedCount`, read from GlasshouseBook over eth_call, and the count is printed in
 * the container's `title` so a screen reader and a hover both get the number back.
 *
 * THREE STATES, NOT TWO, and this is the whole reason the component is worth a file.
 *   - sealed          -> `.hatch`. The house meaning of hatching is exactly this: a value
 *                        EXISTS and cannot be read yet. A bid in the commit window is that.
 *   - opened          -> solid glass at 55%. `bps` came back from a Reveal log.
 *   - could not read  -> also `.hatch`, dimmed, and SAID SO in the title and (at full size)
 *                        in words. `a.bids` and `a.revealedCount` are both null when the log
 *                        scan for a round failed. "We could not read it" is not "nobody
 *                        opened a bid", and the second is an accusation about bidders. The
 *                        commitments are still real -- they came from a different call that
 *                        DID return -- so the cells are honest; which of them are open is
 *                        the part that is missing, and the dimming is that missing part.
 *
 * NO PERCENTAGES, NO BAR. A 2-of-3 strip is two counts side by side, which is the project's
 * rule (subgraph/README.md's refusals list). Widening a cell by its bid, or drawing the
 * strip as a filled bar, would turn three commitments into a statistic about three
 * commitments.
 */

/** Hard ceiling on cells drawn. No keeper round comes close; a runaway `committedCount`
 *  from a bad read should degrade to a legible strip plus a number, not to 400 divs. */
const MAX_CELLS = 32;

type Mode = "full" | "compact";

function cellState(bid: Bid | undefined, scanned: boolean): "opened" | "sealed" | "unread" {
  if (!scanned) return "unread";
  // A bid with bps === null is SEALED, not "unrevealed": the bidder may still have blocks
  // left. The word "unrevealed" is the table's to say, once it can prove the window closed.
  return bid && bid.bps !== null ? "opened" : "sealed";
}

export function BidStrip({
  a,
  mode = "full",
  className = "",
}: {
  a: Auction;
  mode?: Mode;
  className?: string;
}) {
  const committed = Math.max(0, a.committedCount ?? 0);
  // `bids` null means the log scan failed. `revealedCount` is null in the same case; either
  // one being null is enough to stop this component claiming which cells are open.
  const scanned = a.bids !== null && a.bids !== undefined && a.revealedCount !== null && a.revealedCount !== undefined;
  const opened = scanned ? (a.revealedCount as number) : null;

  if (committed === 0) {
    // Zero commitments is a real answer, and it is a sentence rather than an empty strip --
    // a strip with no cells in it looks like a component that failed to render.
    const words = scanned ? "no bids sealed" : "not read";
    return mode === "compact" ? (
      <span className={`text-ink-faint ${className}`} title={scanned ? "The contract holds no commitments for this round." : "The commitment count for this round could not be read."}>
        {"—"}
      </span>
    ) : (
      <span className={`text-[0.8125rem] text-ink-faint ${className}`}>{words}</span>
    );
  }

  const byIdx = new Map<number, Bid>();
  for (const b of a.bids ?? []) byIdx.set(b.commitIdx, b);

  const n = Math.min(committed, MAX_CELLS);
  const hidden = committed - n;

  const title = scanned
    ? `${opened} of ${committed} sealed bid${committed === 1 ? "" : "s"} opened. Hatched cells are still sealed; solid cells were opened in a Reveal log.`
    : `${committed} sealed bid${committed === 1 ? "" : "s"} committed. The log scan that says which of them were opened failed for this round, so none of these cells claims either way.`;

  const box = mode === "compact" ? "h-4 w-2" : "h-[18px] w-[14px]";

  return (
    <span
      className={`inline-flex items-end gap-[3px] ${className}`}
      title={title}
      // The number is the fact; the cells are a rendering of it. Give assistive tech the
      // fact directly rather than eighteen unlabelled boxes.
      role="img"
      aria-label={title}
    >
      {Array.from({ length: n }, (_, i) => {
        const bid = byIdx.get(i);
        const state = cellState(bid, scanned);
        return (
          <span key={i} className="inline-flex flex-col items-center gap-1">
            <span
              className={[
                box,
                "block rounded-[2px]",
                state === "opened"
                  ? "bg-glass/55"
                  : state === "sealed"
                    ? "hatch border border-rule"
                    : "hatch border border-rule opacity-50",
              ].join(" ")}
              title={
                state === "opened"
                  ? `#${i} · opened at ${bid?.bps} bps`
                  : state === "sealed"
                    ? `#${i} · sealed`
                    : `#${i} · committed; whether it was opened could not be read`
              }
            />
            {mode === "full" ? (
              <span className="tnum text-[0.6875rem] leading-none text-ink-faint">{`#${i}`}</span>
            ) : null}
          </span>
        );
      })}
      {hidden > 0 ? (
        <span className="tnum text-[0.6875rem] leading-none text-ink-faint">{`+${hidden}`}</span>
      ) : null}
      {mode === "full" && !scanned ? (
        <span className="ml-1.5 self-center text-[0.8125rem] text-amber">not read</span>
      ) : null}
    </span>
  );
}

export default BidStrip;
