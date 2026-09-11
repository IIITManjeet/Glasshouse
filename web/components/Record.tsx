"use client";

import { useEffect, useState } from "react";
import {
  fetchAccount,
  subgraphConfigured,
  type IndexedAt,
  type Provenance,
  type SubgraphAccount,
  type SubgraphResult,
} from "@/lib/subgraph";

/**
 * An address's whole record, from the indexer.
 *
 * The chain reader on this page shows what this address did in the ROUNDS THE BOARD IS
 * HOLDING -- a recent window, one eth_call per round. That is the right source for a live
 * phase and a hopeless one for "have they ever left a bid sealed", which needs every round
 * the Book has ever had. This panel is that question, and only the indexer can answer it.
 *
 * WHAT IT DELIBERATELY IS NOT. Not a win rate, not a share, not a rank, not a profit
 * figure. subgraph/README.md refuses "'solver concentration', 'market share', 'win share'
 * as competitiveness" and says auctionsWon "is a count and is shown as a count". So every
 * figure here is an integer, and where a denominator exists it is printed beside the
 * numerator rather than divided into it.
 *
 * THE INTERESTING NUMBER IS THE UNFLATTERING ONE. `bidsRevealed / bidsCommitted` is a
 * reliability record: a bidder who seals a bid and never opens it has wasted everybody's
 * commit window, and the contract cannot tell that from someone who simply went away. It
 * is the one reputation this project can show without inventing anything -- about honesty
 * rather than about profit -- and it is printed first.
 */

const num = (n: number) => n.toLocaleString("en-US");

// The three the mapping emits, and only those. subgraph/src/provenance.ts is explicit that
// UNKNOWN means "not on our list" and NOT "external" -- it is the value nearly every real
// visitor gets, so it is the one whose wording has to be right.
const PROVENANCE: Record<Provenance, string> = {
  TEAM: "on our own list of wallets",
  INVITED: "invited to test by us",
  UNKNOWN: "not on our list — which does not mean external, and we do not know who it is",
};

export function Record({ address }: { address: string }) {
  const [res, setRes] = useState<SubgraphResult<SubgraphAccount> | null>(null);

  useEffect(() => {
    let cancelled = false;
    setRes(null);
    fetchAccount(address).then((r) => {
      if (!cancelled) setRes(r);
    });
    return () => {
      cancelled = true;
    };
  }, [address]);

  // Configured-off is not a failure and is not worth a panel. The chain-derived history
  // below it still renders; this simply has nothing to add yet. Checked on `res.state`
  // rather than only on subgraphConfigured(), because the helper narrows nothing for the
  // compiler and the union has to be discharged branch by branch.
  if (!subgraphConfigured()) return null;
  if (!res) return <Shell head={null}>Reading the index…</Shell>;
  if (res.state === "off") return null;

  if (res.state === "error") {
    return (
      <Shell head={null} tone="amber">
        The indexer did not answer ({res.message}). This says nothing about whether this
        address has bid — the history below is read straight from the Book and is unaffected.
      </Shell>
    );
  }

  if (res.data === null) {
    return (
      <Shell head={res.head}>
        The indexer has never seen this address commit, reveal or open a round. That is a
        real answer, not a failure to load.
      </Shell>
    );
  }

  const a = res.data;
  const sealed = a.bidsCommitted - a.bidsRevealed;

  // NOTHING TO SHOW IS A SENTENCE, NOT A GRID OF ZEROS.
  //
  // An address the indexer has seen but that has never bid rendered as "0 of 0 sealed"
  // above six tiles reading 0, 0, 0, 0, 0 and a block number. Every figure was correct and
  // the panel said nothing -- worse than nothing, because a wall of zeros looks like a page
  // that failed to load rather than an account that has not bid. The maker's own record is
  // exactly this case: one round opened, and no bidding at all.
  //
  // So when there is no bidding history the counts collapse to a sentence, and the tiles
  // that would all read zero are not drawn. `auctionsOpened` is still shown when it is
  // non-zero, because opening rounds IS activity and is the one thing this address did.
  const neverBid = a.bidsCommitted === 0 && a.fillsRecorded === 0 && a.auctionsWon === 0;

  return (
    <figure data-src="base" className="rounded-card border border-rule bg-raised shadow-card">
      <figcaption className="flex flex-wrap items-center justify-between gap-2 border-b border-rule px-4 py-2.5">
        <span className="font-mono text-[0.72rem] uppercase tracking-[0.14em] text-ink">
          The whole record
        </span>
        {/* A label, not a control: .chip has a soft fill, no border and no hover, so it can
            no longer be mistaken for the button it used to look identical to. */}
        <span className="chip">
          Indexed · GlasshouseBook subgraph
          {res.head && ` · as of block ${num(res.head.number)}`}
        </span>
      </figcaption>

      {neverBid ? (
        <div className="border-b border-rule px-4 py-4">
          <p className="lede max-w-xl text-[0.9rem] text-ink-soft">
            This address has never bid on a Glasshouse round.
            {a.auctionsOpened > 0 && (
              <>
                {" "}
                It has opened{" "}
                <span className="tnum text-ink">{num(a.auctionsOpened)}</span> round
                {a.auctionsOpened === 1 ? "" : "s"} as a maker, which is the other side of the
                book.
              </>
            )}
          </p>
          <p className="lede mt-2 max-w-xl text-[0.82rem] text-ink-faint">
            That is a real answer and not a failure to load — there is simply nothing to
            count yet. Once this address seals a bid, the figures that matter appear here:
            how many it opened of how many it sealed, what it won, and what it forfeited.
          </p>
        </div>
      ) : (
      <>
      {/* The reliability line, first and largest, because it is the one that says something
          about the person rather than about their luck. */}
      <div className="border-b border-rule px-4 py-4">
        <div className="font-mono text-[0.66rem] uppercase tracking-[0.12em] text-ink-faint">
          bids opened
        </div>
        <div className="tnum mt-1.5 text-2xl">
          <span className={sealed === 0 && a.bidsCommitted > 0 ? "text-glass" : ""}>
            {num(a.bidsRevealed)}
          </span>
          <span className="text-ink-faint"> of {num(a.bidsCommitted)} sealed</span>
        </div>
        <p className="mt-1.5 max-w-xl text-[0.82rem] text-ink-faint">
          {a.bidsCommitted === 0
            ? "Has never committed a bid."
            : sealed === 0
              ? "Every bid this address sealed, it opened. A commitment left sealed wastes the round's commit window, and the contract cannot tell that from a bidder who simply went away."
              : `${num(sealed)} commitment${sealed === 1 ? "" : "s"} left sealed and never opened. The contract cannot tell that from a bidder who went away, and neither can this page.`}
        </p>
      </div>

      <dl className="grid grid-cols-2 gap-px bg-rule sm:grid-cols-3">
        <Stat label="rounds won" value={a.auctionsWon} note="settled, as best bidder" good />
        <Stat label="fills recorded" value={a.fillsRecorded} note="as the taker" />
        <Stat label="rounds opened" value={a.auctionsOpened} note="as the maker" />
        <Stat label="forfeits" value={a.forfeits} note="won, then did not fill" bad />
        <Stat label="unrevealed forfeits" value={a.unrevealedForfeits} note="bond lost" bad />
        <Stat label="first seen" value={Number(a.firstSeenBlock)} note="block" />
      </dl>
      </>
      )}

      <p className="border-t border-rule px-4 py-3 text-[0.78rem] leading-relaxed text-ink-faint">
        <strong className="font-medium text-ink-soft">What produced this:</strong> the{" "}
        <code className="font-mono">Account</code> entity in the GlasshouseBook subgraph, over
        every round the Book has had — not the window of recent rounds the board holds. Counted
        by the mapping in <code className="font-mono">subgraph/src/book.ts</code> as events
        arrive; <code className="font-mono">auctionsWon</code> increments only at{" "}
        <code className="font-mono">AuctionSettled</code>, because before that a later reveal
        can still take the win away. Provenance is{" "}
        <strong className="font-medium text-ink-soft">{a.provenance}</strong> —{" "}
        {PROVENANCE[a.provenance] ?? "unclassified"} — which is our label, not the chain&rsquo;s.
        Every figure is a count; nothing here is a rate, a share or a rank.
      </p>
    </figure>
  );
}

function Stat({
  label,
  value,
  note,
  good,
  bad,
}: {
  label: string;
  value: number;
  note: string;
  good?: boolean;
  bad?: boolean;
}) {
  const tone = value === 0 ? "text-ink-faint" : good ? "text-glass" : bad ? "text-brick" : "text-ink";
  return (
    <div className="bg-raised px-4 py-3">
      <dt className="font-mono text-[0.62rem] uppercase tracking-[0.12em] text-ink-faint">{label}</dt>
      <dd className={`tnum mt-1 text-lg ${tone}`}>{num(value)}</dd>
      <dd className="mt-0.5 text-[0.74rem] text-ink-faint">{note}</dd>
    </div>
  );
}

function Shell({
  children,
  head,
  tone = "plain",
}: {
  children: React.ReactNode;
  head: IndexedAt | null;
  tone?: "plain" | "amber";
}) {
  return (
    <div
      className={`rounded-card border px-4 py-3 text-sm ${
        tone === "amber" ? "border-amber bg-amber-soft text-ink-soft" : "border-rule bg-raised text-ink-faint"
      }`}
    >
      {children}
      {head && (
        <span className="tnum ml-1 text-ink-faint"> Indexed as of block {num(head.number)}.</span>
      )}
    </div>
  );
}
