"use client";

import { useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { AddressLink, RoleChip } from "./Address";
import { rolesOf } from "./Identity";
import {
  fetchAuctionTimeline,
  subgraphConfigured,
  type AuctionTimeline,
  type BondStatus,
  type EventKind,
  type IndexedAt,
  type Provenance,
  type SubgraphResult,
  type TimelineEvent,
} from "@/lib/subgraph";

/**
 * WHAT HAPPENED, IN THE ORDER IT HAPPENED.
 *
 * Everything else on this page shows a round's CURRENT state: who leads, what clears,
 * whether it settled. This shows the sequence that produced it -- which reveal took the
 * lead from whom, and what the clearing price was immediately after each one.
 *
 * THAT ORDERING IS THE ARGUMENT, not decoration. The claim a second-price sealed-bid
 * auction makes is that the price was set by the runner-up rather than chosen by the maker.
 * A final clearing price cannot demonstrate that; a sequence can, because you can watch the
 * number move to each new runner-up as the reveals land, and watch it not move when the
 * winner's own bid comes in.
 *
 * IT RE-DERIVES NOTHING. `BidRevealedEvent` stores `bestBpsAfter`, `secondBpsAfter` and
 * `clearingBpsAfter` -- the state after that reveal was applied -- specifically so a UI can
 * replay without re-implementing the clearing rule (subgraph/schema.graphql says so in as
 * many words). This component is the consumer that was written for. A fourth copy of the
 * rule is exactly what this project does not need: there are already three
 * (GlasshouseBook.sol:229, subgraph/src/helpers.ts, web/lib/reserve-window.ts), and
 * scripts/verify-run.mjs exists to check they still agree.
 *
 * ONLY THE INDEXER CAN ANSWER THIS. An eth_call returns storage as it is now; the order in
 * which it got that way lives only in the logs. So unlike every other panel here, this one
 * has no chain fallback and says so rather than inventing one.
 */

const num = (n: number | string) => Number(n).toLocaleString("en-US");
const tx = (h: string) => `https://basescan.org/tx/${h}`;

// UNKNOWN is what an address not on our list gets, which is nearly everyone including every
// judge. It does NOT mean external and must never be shown as if it did
// (subgraph/src/provenance.ts; subgraph/README.md "Provenance labels").
const PROVENANCE_CHIP: Record<Provenance, string> = {
  TEAM: "ours",
  INVITED: "invited",
  UNKNOWN: "not on our list",
};

const BOND: Record<BondStatus, string> = {
  HELD: "bond held",
  RETURNED: "bond returned",
  FORFEITED_TO_MAKER: "bond forfeited to the maker",
  UNREVEALED_FORFEITED: "bond lost — sealed and never opened",
};

const KIND_LABEL: Record<EventKind, string> = {
  AUCTION_OPENED: "opened",
  BID_COMMITTED: "bid sealed",
  BID_REVEALED: "bid opened",
  AUCTION_FILLED: "filled",
  AUCTION_SETTLED: "settled",
  BOND_CLAIMED: "bond claimed",
  FORFEIT_CLAIMED: "forfeit claimed",
  UNREVEALED_FORFEITED: "unrevealed bond forfeited",
};

export function Timeline({ maker, orderHash }: { maker: string; orderHash: string }) {
  const [res, setRes] = useState<SubgraphResult<AuctionTimeline> | null>(null);
  // Before the early returns, because hooks cannot be conditional. Feeds the `you` role.
  const { address: connected } = useAccount();

  useEffect(() => {
    let cancelled = false;
    setRes(null);
    fetchAuctionTimeline(maker, orderHash).then((r) => {
      if (!cancelled) setRes(r);
    });
    return () => {
      cancelled = true;
    };
  }, [maker, orderHash]);

  if (!subgraphConfigured()) return null;
  if (!res) return <Shell head={null}>Reading the index…</Shell>;
  if (res.state === "off") return null;

  if (res.state === "error") {
    return (
      <Shell head={null} tone="amber">
        The indexer did not answer ({res.message}), so the order of events is not available.
        The outcome shown above is read straight from the Book and is unaffected — it is only
        the <em>sequence</em> that is missing, because nothing but the logs records it.
      </Shell>
    );
  }

  if (res.data === null) {
    return (
      <Shell head={res.head}>
        The indexer has no row for this round yet. For a round the board is showing live that
        is the ordinary case — the indexer is a block or two behind the chain — and it means
        &ldquo;not indexed yet&rdquo;, not &ldquo;did not happen&rdquo;.
      </Shell>
    );
  }

  const a = res.data;
  const events = [...a.events].sort(
    (x, y) =>
      Number(x.blockNumber) - Number(y.blockNumber) || Number(x.logIndex) - Number(y.logIndex),
  );
  const reveals = events.filter((e) => e.kind === "BID_REVEALED");

  // ROLE CONTEXT, ALL OF IT READ FROM ROWS THIS PANEL ALREADY HAS. The maker is the round's
  // own `maker` field; the filler and the winner are the actors on the AuctionFilled and
  // AuctionSettled events, which is the only place the indexer records them for a round.
  // Nothing here is inferred from a name, a list, or an ordering.
  const roundMaker = a.maker.id;
  const filledBy = events.find((e) => e.kind === "AUCTION_FILLED")?.actor ?? null;

  return (
    <figure data-src="base" className="rounded-card border border-rule bg-raised shadow-card">
      <figcaption className="flex flex-wrap items-center justify-between gap-2 border-b border-rule px-4 py-2.5">
        <span className="font-mono text-[0.72rem] uppercase tracking-[0.14em] text-ink">
          What happened, in order
        </span>
        <span className="chip">
          Indexed · GlasshouseBook subgraph
          {res.head && ` · as of block ${num(res.head.number)}`}
        </span>
      </figcaption>

      <ol className="divide-y divide-rule">
        {events.map((e) => (
          <Row
            key={e.id}
            e={e}
            reserveBps={a.reserveBps}
            maker={roundMaker}
            you={connected}
          />
        ))}
      </ol>

      {reveals.length === 0 && (
        <p className="border-t border-rule px-4 py-3 text-[0.82rem] text-ink-faint">
          No bid was ever opened in this round, so there is no price sequence to show.{" "}
          {a.unrevealedCount > 0 && (
            <>
              {num(a.unrevealedCount)} commitment{a.unrevealedCount === 1 ? " was" : "s were"}{" "}
              sealed and never opened. The contract cannot tell that from bidders who simply
              went away, and neither can this page.
            </>
          )}
        </p>
      )}

      {/* The bid ladder, which is the same facts keyed by bidder rather than by time. Shown
          because "who is still holding a bond" is a question the sequence answers only
          indirectly. */}
      <div className="border-t border-rule px-4 py-3">
        <div className="font-mono text-[0.6875rem] uppercase tracking-[0.12em] text-ink-faint">
          the ladder · {num(a.committedCount)} sealed, {num(a.revealedCount)} opened
        </div>
        <ul className="mt-2 space-y-1.5">
          {a.bids.map((b) => {
            // `house` when this bidder IS the maker of the round it is bidding in -- the
            // disclosure the ladder most needs, since a maker's own bid sits in it looking
            // like anybody else's. `winner` only once the round has settled; the identical
            // position before that is `leading`, because a later reveal can still take it
            // (components/Auction.tsx records the same distinction).
            const roles = rolesOf({
              addr: b.bidder.id,
              you: connected,
              maker: roundMaker,
              bidder: true,
              bestBidder: b.leading ? b.bidder.id : null,
              settled: a.settled,
              filledBy,
            });
            return (
            <li key={b.commitIdx} className="flex flex-wrap items-baseline gap-x-2 text-[0.82rem]">
              <span className="tnum text-ink-faint">#{b.commitIdx}</span>
              <AddressLink addr={b.bidder.id} role={roles[0]} />
              {roles.slice(1).map((r) => (
                <RoleChip key={r} role={r} />
              ))}
              <span className="font-mono text-[0.6875rem] uppercase tracking-[0.1em] text-ink-faint">
                {PROVENANCE_CHIP[b.bidder.provenance]}
              </span>
              <span className={b.revealed ? "tnum text-ink" : "text-ink-faint"}>
                {b.revealed ? `${num(b.bps ?? 0)} bps` : "never opened"}
              </span>
              {b.leading && <span className="text-glass">· leads</span>}
              <span className="text-ink-faint">· {BOND[b.bondStatus]}</span>
            </li>
            );
          })}
        </ul>
      </div>

      <p className="border-t border-rule px-4 py-3 text-[0.78rem] leading-relaxed text-ink-faint">
        <strong className="font-medium text-ink-soft">What produced this:</strong> the{" "}
        <code className="font-mono">AuctionEvent</code> rows for this round in the
        GlasshouseBook subgraph, ordered by block then log index, plus its{" "}
        <code className="font-mono">Bid</code> ladder. The price after each reveal is{" "}
        <code className="font-mono">clearingBpsAfter</code>, recorded by the mapping (
        <code className="font-mono">subgraph/src/book.ts</code>) at the moment that reveal was
        applied — this page does not recompute it. An <code className="font-mono">eth_call</code>{" "}
        cannot produce any of this: storage says what is true now, not the order it became
        true, so there is no chain fallback for this panel and none is faked.
        {a.settlementMatchesDerivation === false && (
          <>
            {" "}
            <strong className="font-medium text-brick">
              The settled outcome disagrees with an independent replay of these reveals. That
              is shown, not hidden.
            </strong>
          </>
        )}
      </p>
    </figure>
  );
}

function Row({
  e,
  reserveBps,
  maker,
  you,
}: {
  e: TimelineEvent;
  reserveBps: number;
  /** The round's maker, so an event acted by the maker says so. */
  maker: string;
  /** The connected wallet. */
  you?: string | null;
}) {
  const isReveal = e.kind === "BID_REVEALED";
  const reserveSet = isReveal && (e.secondBpsAfter ?? 0) < reserveBps;

  // DELIBERATELY ONLY THE TIMELESS ROLES HERE. `house`, `you`, `maker` and `filled` are
  // true of the actor at the moment of the event; `winner` and `leading` are not -- at the
  // block a reveal landed, nobody knew who would win, and the row's own words ("took the
  // lead", "did not take the lead") already say what was true then. Stamping the eventual
  // winner onto their first reveal would be hindsight rendered as a fact.
  const actorRoles = rolesOf({
    addr: e.actor,
    you,
    maker,
    bidder: e.kind === "BID_COMMITTED" || e.kind === "BID_REVEALED",
    filledBy: e.kind === "AUCTION_FILLED" ? e.actor : null,
  });
  const winnerRoles = rolesOf({
    addr: e.winner,
    you,
    maker,
    bidder: true,
    bestBidder: e.winner,
    // An AUCTION_SETTLED event is the round settling, so "winner" is the honest word.
    settled: true,
  });

  return (
    <li className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-2.5 text-[0.86rem]">
      <a
        href={tx(e.txHash)}
        target="_blank"
        rel="noopener noreferrer"
        className="tnum shrink-0 text-[0.74rem] text-ink-faint underline decoration-rule underline-offset-2 hover:decoration-glass"
      >
        {num(e.blockNumber)}
      </a>
      <span className="font-mono text-[0.6875rem] uppercase tracking-[0.12em] text-ink">
        {KIND_LABEL[e.kind] ?? e.kind}
      </span>
      <AddressLink addr={e.actor} role={actorRoles[0]} className="text-[0.8rem]" />
      {actorRoles.slice(1).map((r) => (
        <RoleChip key={r} role={r} />
      ))}

      {isReveal && (
        <>
          <span className="tnum text-ink">{num(e.bps ?? 0)} bps</span>
          {e.tookLead ? (
            <span className="text-glass">took the lead</span>
          ) : (
            <span className="text-ink-faint">did not take the lead</span>
          )}
          <span className="tnum text-ink-soft">
            → clearing {num(e.clearingBpsAfter ?? 0)} bps
          </span>
          <span className="text-[0.74rem] text-ink-faint">
            {reserveSet
              ? `the reserve is the price here — the runner-up was at ${num(e.secondBpsAfter ?? 0)} bps, below the ${num(reserveBps)} bps reserve`
              : `set by the runner-up at ${num(e.secondBpsAfter ?? 0)} bps, not by the winner's ${num(e.bestBpsAfter ?? 0)} bps`}
          </span>
        </>
      )}

      {e.kind === "BID_COMMITTED" && (
        <span className="text-ink-faint">
          sealed at position {num(e.commitIdx ?? 0)} — the tie-break key, fixed before anyone
          could see a rival&rsquo;s bid
        </span>
      )}

      {e.kind === "AUCTION_SETTLED" && (
        <>
          <span className="tnum text-ink">{num(e.clearingBps ?? 0)} bps</span>
          <span className="text-ink-faint">to</span>
          <AddressLink addr={e.winner} role={winnerRoles[0]} className="text-[0.8rem]" />
          {e.winnerForfeited && <span className="text-brick">winner forfeited</span>}
          <span className={e.matchesDerivation ? "text-glass" : "text-brick"}>
            {e.matchesDerivation
              ? "matches an independent replay ✓"
              : "DISAGREES with an independent replay"}
          </span>
        </>
      )}
    </li>
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
        tone === "amber"
          ? "border-amber bg-amber-soft text-ink-soft"
          : "border-rule bg-raised text-ink-faint"
      }`}
    >
      {children}
      {head && <span className="tnum ml-1 text-ink-faint"> Indexed as of block {num(head.number)}.</span>}
    </div>
  );
}
