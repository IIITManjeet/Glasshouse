"use client";

import { type Auction, livePhase } from "@/lib/useAuctions";

/**
 * Filtering the rounds list by what actually happened in each round.
 *
 * WHY TABS AND NOT A DROPDOWN. The questions a visitor has here are few, fixed and worth
 * advertising: what is live, what settled, what nobody bid on. A select hides all of that
 * behind one word and makes you open it to find out the options even exist. Tabs also carry
 * their counts, which is the answer to most of those questions before you click anything.
 *
 * EVERY TAB SHOWS ITS COUNT, and the counts are the project's usual rule: a number is shown
 * beside the number it is out of, never as a share. "Settled 4" next to "All 7" is two
 * counts; "57% settled" would be a statistic about a sample of seven, which is not a
 * statistic.
 *
 * NULL IS NOT ZERO, and this is the one that would quietly produce a lie. `revealedCount`
 * is null when the log scan for a round FAILED -- the chain reader could not read it, which
 * is different from reading it and finding nothing. Scoring those rows as "no reveals" would
 * put a round in the "nobody opened a bid" tab on the strength of a network error, and that
 * tab is an accusation about bidders. So `unreadable` rows are counted separately and named
 * under the tabs rather than being swept into whichever bucket is convenient.
 *
 * NOT A NEW SOURCE OF TRUTH. Every predicate below reads fields the board already has and
 * calls the same `livePhase` the live board and the table use. Nothing here re-derives a
 * phase or a clearing price; a fourth implementation of the clearing rule is exactly what
 * scripts/verify-run.mjs exists to prevent.
 */

export type RoundFilterId = "all" | "live" | "settled" | "winner" | "unopened" | "filled";

export interface RoundFilter {
  id: RoundFilterId;
  label: string;
  /** Shown under the tabs when this one is selected, so the list always says what it is. */
  blurb: string;
  match: (a: Auction, head: number) => boolean;
}

/** A reveal count we can trust. Null means "not read", and no filter may guess past it. */
const readable = (a: Auction) => a.revealedCount !== null && a.revealedCount !== undefined;

export const ROUND_FILTERS: RoundFilter[] = [
  {
    id: "all",
    label: "All",
    blurb: "Every round this build knows about, newest first.",
    match: () => true,
  },
  {
    id: "live",
    label: "Live",
    blurb:
      "Rounds still inside a window the contract enforces — taking sealed bids, opening them, or held for the winner to fill.",
    // Anything not yet past its exclusive window. `livePhase` is the board's own rule.
    match: (a, head) => livePhase(a, head) !== "open",
  },
  {
    id: "settled",
    label: "Settled",
    blurb:
      "settle() has been called and the outcome is final on chain. It is permissionless, so a round can be finished without being settled.",
    match: (a) => a.settled,
  },
  {
    id: "winner",
    label: "Had a winner",
    blurb:
      "At least one bid was opened, so the contract has a best bidder and a clearing price. The price is the runner-up's bid, or the reserve when there was no runner-up.",
    match: (a) => Boolean(a.bestBidder),
  },
  {
    id: "unopened",
    label: "Nobody opened",
    blurb:
      "Bids were sealed and the reveal window closed with none of them opened. The contract cannot tell that from bidders who simply went away, and neither can this page. Rounds whose bids could not be READ are excluded rather than counted here.",
    match: (a, head) =>
      livePhase(a, head) === "open" &&
      (a.committedCount ?? 0) > 0 &&
      readable(a) &&
      a.revealedCount === 0,
  },
  {
    id: "filled",
    label: "Filled",
    blurb: "The order was actually filled — tokens moved, and the Book recorded it.",
    match: (a) => a.filled,
  },
];

export function countFor(filter: RoundFilter, auctions: Auction[], head: number) {
  return auctions.filter((a) => filter.match(a, head)).length;
}

/** Rounds whose bids could not be read at all. Named, never silently bucketed. */
export function unreadableCount(auctions: Auction[]) {
  return auctions.filter((a) => !readable(a)).length;
}

export function RoundsFilterTabs({
  auctions,
  head,
  active,
  onChange,
}: {
  auctions: Auction[];
  head: number;
  active: RoundFilterId;
  onChange: (id: RoundFilterId) => void;
}) {
  return (
    // A tablist, not a row of buttons: arrow-key navigation and the selected state both
    // come from the roles, and a screen reader announces "tab, 2 of 6, selected".
    <div
      role="tablist"
      aria-label="Filter rounds"
      className="flex flex-wrap items-center gap-1 rounded-control border border-rule bg-sunk p-1"
    >
      {ROUND_FILTERS.map((f) => {
        const n = countFor(f, auctions, head);
        const selected = f.id === active;
        return (
          <button
            key={f.id}
            type="button"
            role="tab"
            aria-selected={selected}
            // A count of zero still gets a tab, disabled rather than hidden: a tab that
            // appears only when it has contents makes the set of questions you can ask
            // change under you, and "nobody opened: 0" is itself worth being able to see.
            disabled={n === 0 && f.id !== "all"}
            onClick={() => onChange(f.id)}
            className={[
              "rounded-chip px-2.5 py-1 font-mono text-[0.7rem] uppercase tracking-[0.1em] transition-colors",
              selected
                ? "bg-glass-soft text-glass"
                : n === 0 && f.id !== "all"
                  ? "cursor-not-allowed text-ink-faint opacity-60"
                  : "text-ink-soft hover:text-ink",
            ].join(" ")}
          >
            {f.label} <span className="tnum ml-0.5 text-[0.6875rem]">{n}</span>
          </button>
        );
      })}
    </div>
  );
}

export default RoundsFilterTabs;
