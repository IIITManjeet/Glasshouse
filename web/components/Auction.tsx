"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAccount } from "wagmi";
import { AddressLink } from "@/components/Address";
import { type Auction, livePhase, type Source } from "@/lib/useAuctions";
import type { AddressRole } from "@/lib/identity";

const num = (n?: number | null) =>
  n === null || n === undefined || Number.isNaN(n) ? "—" : n.toLocaleString("en-US");
const BLOCK_SECONDS = 2;

/**
 * The connected wallet, or null until the browser has answered.
 *
 * A static export renders this file in Node, where there is no wallet, so the `you` role
 * cannot be decided during the first paint without the client disagreeing with the server
 * and React discarding the tree. WalletChip and BidPanel both guard the same way; this is
 * the third copy of the same two lines and it is cheaper than a shared hook nobody can
 * find. It is only ever used to LABEL a row that is already on screen, so the one-render
 * delay costs nothing.
 */
function useMe(): string | null {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const { address } = useAccount();
  return mounted && address ? address.toLowerCase() : null;
}

/**
 * The source chip. Every figure on this page carries one.
 *
 * DESIGN.md section 2 is the project's own rule: every number on screen is labelled with
 * what produced it. An adversarial review found the earlier page breaking it -- three hard
 * numbers with nothing saying they came from a unit test with mock tokens. Honest framing
 * of a small dataset reads as rigour; dressing it up reads as a lie you did not notice you
 * told.
 */
export function SourceChip({ source, head, isFork }: { source: Source; head: number; isFork: boolean }) {
  const label =
    source === "chain"
      ? isFork
        ? `Source · LOCAL FORK of Base · not mainnet · block ${num(head)}`
        : `Source · Base mainnet · read from the contract · block ${num(head)}`
      : source === "snapshot"
        ? `Source · Snapshot in repo · as of block ${num(head)}`
        : source === "sim"
          ? // Longest chip on the page, deliberately. It is the one a screenshot can do the
            // most damage with, so it names the file and refuses the word "block" without
            // "synthetic" in front of it.
            `Source · SIMULATED by lib/simulate.js · nothing on any chain · synthetic block ${num(head)}`
          : "Source · none";
  // Mainnet reads are the only ones that get the calm tone. A fork, a simulation and a
  // snapshot all get the warning tint, because for a reader the relevant fact about all
  // three is the same: this is not the live chain.
  const tone = source === "chain" && !isFork ? "chip-live" : "chip-warn";
  return <div className={`chip ${tone}`}>{label}</div>;
}

const PHASES = ["commit", "reveal", "exclusive", "open"] as const;

/**
 * The phase track.
 *
 * The contract stores no phase -- it compares block.number against boundaries it wrote at
 * open (GlasshouseBook.sol:159, :185-186, :219). So this is computed against the same block
 * the data describes, never against a local clock, and the countdown is in BLOCKS with
 * seconds as a secondary gloss: blocks are what the contract enforces, seconds are an
 * estimate at 2s each.
 */
/**
 * HOW LONG IS LEFT, AS THE BIGGEST THING ON THE PAGE.
 *
 * The number was already on the board -- "4 blocks · ~8s", set at 12px inside one of four
 * equal columns, styled exactly like the three inert columns beside it. On a live auction
 * the time remaining is not one fact among four; it is the fact that decides whether you
 * act now or read on, and a venue that makes you hunt for it is not behaving like a venue.
 *
 * BLOCKS LEAD AND SECONDS FOLLOW, which is not a stylistic choice. The contract compares
 * `block.number` against boundaries written when the round opened; it has no clock. Seconds
 * are this page multiplying blocks by an assumed 2s and are wrong whenever Base is not
 * producing at exactly that rate. Printing the estimate in the same weight as the enforced
 * number would be the page quietly promoting its own guess.
 *
 * The bar underneath is the whole round, not the current phase: commit, reveal and
 * exclusive in their real proportions, so the segment widths say how the windows compare.
 * It carries no number that is not already stated in words above it.
 *
 * NOW THE LARGEST THING ON THE FRONT PAGE, because the front page IS this instrument. The
 * long sentence that used to follow the estimate ("~68s at 2s blocks, an estimate -- the
 * contract counts blocks") is gone: it explained the same distinction three other places on
 * the page also explained, and a countdown is the one element on a live venue that must be
 * readable in one glance. The estimate keeps its tilde, which is the whole claim, and the
 * argument for blocks moved to /faq#blocks behind a link nobody has to read to bid.
 */
export function Countdown({ a, head }: { a: Auction; head: number }) {
  const phase = livePhase(a, head);
  if (phase === "open") return null;

  const end = phase === "commit" ? a.commitEnd : phase === "reveal" ? a.revealEnd : a.exclusiveEnd;
  const left = Math.max(0, end - head);

  const total = Math.max(1, a.exclusiveEnd - a.openedAtBlock);
  const spans = [
    { key: "commit", w: (a.commitEnd - a.openedAtBlock) / total },
    { key: "reveal", w: (a.revealEnd - a.commitEnd) / total },
    { key: "exclusive", w: (a.exclusiveEnd - a.revealEnd) / total },
  ];
  const done = Math.min(1, Math.max(0, (head - a.openedAtBlock) / total));

  const label =
    phase === "commit"
      ? "left to seal a bid"
      : phase === "reveal"
        ? "left to open your bid"
        : "left in the winner's exclusive window";

  return (
    <div className="card">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-2">
        <span className="tnum text-[2.5rem] leading-none font-medium text-glass sm:text-[3rem]">
          {left}
        </span>
        <span className="text-base text-ink sm:text-lg">
          block{left === 1 ? "" : "s"} {label}
        </span>
        <span className="ml-auto flex items-center gap-1">
          <span className="tnum text-[0.8rem] text-ink-faint">~{left * BLOCK_SECONDS} s</span>
          <Link href="/faq#blocks" className="btn btn-tertiary">
            why blocks, not seconds
          </Link>
        </span>
      </div>

      <div className="mt-3 flex h-1.5 w-full gap-px overflow-hidden rounded-full bg-sunk" aria-hidden="true">
        {spans.map((sp) => (
          <div key={sp.key} className="h-full bg-rule" style={{ width: `${Math.max(0, sp.w) * 100}%` }} />
        ))}
      </div>
      <div className="relative -mt-1.5 h-1.5" aria-hidden="true">
        <div className="h-full rounded-full bg-glass/70" style={{ width: `${done * 100}%` }} />
      </div>
    </div>
  );
}

/**
 * PHASE NAMES AND BLOCK RANGES, AND NOTHING ELSE.
 *
 * Each cell used to carry a sentence under the range -- "sealed bids arrive", "bids open,
 * top two settle", "winner fills at the improved price", "anyone fills, at base price".
 * Four sentences that were correct, that a bidder mid-round does not read, and that said
 * the same thing the round panel, the bid panel and the mechanism section all said again.
 * The ranges are the part the contract enforces and the part a bidder checks, so they stay
 * and the prose goes to /faq#round.
 *
 * ONE NOTE SURVIVES, and it is not an explanation: when nobody has revealed there will be
 * no exclusive window at all, so the cell says that. It is a fact about THIS round read
 * from `bestBidder`, not a description of the mechanism.
 */
export function PhaseTrack({ a, head }: { a: Auction; head: number }) {
  const active = livePhase(a, head);
  const cells = [
    { key: "commit", range: `${num(a.openedAtBlock)}–${num(a.commitEnd)}` },
    { key: "reveal", range: `${num(a.commitEnd + 1)}–${num(a.revealEnd)}` },
    { key: "exclusive", range: `${num(a.revealEnd + 1)}–${num(a.exclusiveEnd)}` },
    { key: "open", range: `from ${num(a.exclusiveEnd + 1)}` },
  ];

  return (
    <div className="grid grid-cols-2 gap-px border border-rule bg-rule sm:grid-cols-4">
      {cells.map((c) => {
        const isActive = c.key === active;
        // The contract collapses the exclusive window to nothing when nobody revealed, so
        // the diagram says that rather than drawing a window that will never exist.
        const isVoid = c.key === "exclusive" && !a.bestBidder;
        return (
          <div
            key={c.key}
            className={[
              "p-3",
              isActive ? "bg-glass-soft" : "bg-raised",
              isVoid ? "opacity-60" : "",
            ].join(" ")}
          >
            <div className="font-mono text-[0.6875rem] uppercase tracking-[0.12em] text-ink-faint">{c.key}</div>
            <div className="tnum mt-2 text-[0.78rem] text-glass">{c.range}</div>
            {isVoid ? <div className="chip mt-2">no reveals — collapses</div> : null}
          </div>
        );
      })}
    </div>
  );
}

/**
 * A sealed bid exists and cannot be read yet. Hatching says that; a spinner would lie.
 *
 * THE HOUSE BID IS LABELLED, and it has to be. The keeper opens every round AND bids in it
 * (scripts/keeper.ts), and it does so from the MAKER'S OWN ADDRESS -- so the maker is a
 * bidder in its own auction. Meanwhile the argument for sealing bids is precisely that an
 * open second-price auction lets a maker insert a bid just under the top.
 *
 * That is defensible: the house commits at index 0, before any visitor can have acted, it
 * cannot read a sealed rival, and it never reveals early -- so it functions as a randomised
 * hidden reserve that supplies liquidity for the demo. What is not defensible is leaving it
 * unlabelled and letting a reader discover it themselves. A card whose bidder is the maker
 * now says so on the card, not in a caption somewhere else.
 */
export function BidCards({ a }: { a: Auction }) {
  const me = useMe();

  // null means the log scan FAILED. That is not "no bids" -- rendering it as none is how
  // a rate-limited request turns into an accusation that nobody bid.
  if (a.bids == null) {
    return (
      <p className="mt-4 text-sm text-amber">
        Bids could not be read from the chain just now. This says nothing about whether any were placed.
      </p>
    );
  }
  if (!a.bids.length) {
    return <p className="mt-4 text-sm text-ink-faint">No bids committed yet.</p>;
  }

  // ONE LINK FOR THE WHOLE ROW, not one per card. The disclosure a bidder needs at the
  // moment of bidding is the tag itself -- one of your rivals is the maker -- and that is on
  // the card. WHY that is defensible is an argument, it is the same argument for every card,
  // and four copies of it in a row of four cards is four times the noise for one fact.
  const hasHouse = a.bids.some(
    (b) => a.maker && b.bidder?.toLowerCase() === a.maker.toLowerCase(),
  );

  return (
    <>
    <div className="mt-4 flex flex-wrap gap-2">
      {a.bids.map((b) => {
        const who = b.bidder?.toLowerCase() ?? null;
        const sealed = b.bps === null || b.bps === undefined;
        const leading = Boolean(a.bestBidder && who === a.bestBidder.toLowerCase());
        const isHouse = Boolean(a.maker && who === a.maker.toLowerCase());
        const isFilled = Boolean(a.filled && a.filledBy && who === a.filledBy.toLowerCase());
        // ONE ROLE PER ADDRESS, AND `house` IS NOT IT HERE. Every value below is read from a
        // chain field or from the connected wallet -- lib/identity.ts's rule -- and the
        // ordering is by what the reader needs first: whether it is them, then whether it
        // won, then whether it filled. `house` is deliberately absent: the amber chip in the
        // card head already says "house · the maker" in the louder register the disclosure
        // deserves, and a second, quieter "house" beside the address would be the same fact
        // twice at two weights.
        const isYou = Boolean(who && me && who === me);
        const role: AddressRole | null = isYou
          ? "you"
          : leading
            ? a.settled
              ? "winner"
              : "leading"
            : isFilled
              ? "filled"
              : null;
        const tx = b.revealTx ?? b.commitTx ?? null;
        return (
          <div
            key={`${b.bidder}-${b.commitIdx}`}
            className={`min-w-[13rem] flex-1 border border-rule p-3 ${sealed ? "hatch" : "bg-raised"}`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="tnum text-[0.7rem] text-ink-faint">#{b.commitIdx}</span>
              {isHouse && (
                <span
                  title="The keeper bids from the maker's own address, always first, and cannot read a sealed rival."
                  className="chip chip-warn"
                >
                  house · the maker
                </span>
              )}
            </div>
            {sealed ? (
              <>
                <div className="tnum my-2 text-lg tracking-[0.1em] text-ink-faint">▨▨▨▨▨▨</div>
                <div className="text-[0.78rem]">
                  <AddressLink addr={b.bidder} role={role} />
                </div>
                <div className="mt-2 text-[0.76rem] text-ink-faint">
                  sealed · block {num(b.committedAtBlock)}
                  {tx && (
                    <>
                      {" "}
                      <a
                        href={`https://basescan.org/tx/${tx}`}
                        target="_blank"
                        rel="noopener"
                        className="text-glass hover:underline"
                      >
                        tx ↗
                      </a>
                    </>
                  )}
                </div>
              </>
            ) : (
              <>
                <div className="tnum my-2 text-lg text-ink">{b.bps} bps</div>
                <div className="text-[0.78rem]">
                  <AddressLink addr={b.bidder} role={role} />
                </div>
                <div className={`mt-2 text-[0.76rem] ${leading ? "text-glass" : "text-ink-faint"}`}>
                  {leading ? "leading" : b.bps === a.secondBps ? "sets the price" : "outbid"}
                  {tx && (
                    <>
                      {" · "}
                      <a
                        href={`https://basescan.org/tx/${tx}`}
                        target="_blank"
                        rel="noopener"
                        className="text-glass hover:underline"
                      >
                        tx ↗
                      </a>
                    </>
                  )}
                </div>
              </>
            )}
          </div>
        );
      })}
    </div>
    {hasHouse ? (
      <div className="mt-2">
        <Link href="/faq#house" className="btn btn-tertiary">
          why the house bids
        </Link>
      </div>
    ) : null}
    </>
  );
}

export function Stats({ a, head }: { a: Auction; head: number }) {
  const p = livePhase(a, head);
  const state = a.settled ? "settled" : p === "open" || p === "exclusive" ? "final" : "running";
  const items: [string, React.ReactNode][] = [
    ["clearing", a.clearingBps === null ? "—" : `${a.clearingBps} bps · ${state}`],
    // Both numbers, never a percentage. A ratio without its denominator is a claim the
    // data does not support -- subgraph/README.md's refusals list.
    ["reveals", a.revealedCount == null ? `not read, ${a.committedCount} committed` : `${a.revealedCount} of ${a.committedCount}`],
    // "winner" only once settled: until then a higher reveal can still displace them.
    // Profile.tsx already said "leading, not settled"; three views disagreeing about one
    // address is worse than any single one being wrong.
    [
      a.settled ? "winner" : "leading",
      a.bestBidder ? (
        <AddressLink addr={a.bestBidder} role={a.settled ? "winner" : "leading"} />
      ) : (
        "no reveals"
      ),
    ],
    ["reserve · max", `${a.reserveBps} · ${a.maxBps} bps`],
  ];
  if (a.filled) items.push(["filled by", <AddressLink key="f" addr={a.filledBy} role="filled" />]);

  return (
    <div className="mt-4 flex flex-wrap gap-6">
      {items.map(([k, v]) => (
        <div key={k}>
          <div className="font-mono text-[0.6875rem] uppercase tracking-[0.12em] text-ink-faint">{k}</div>
          <div className="tnum mt-2 text-sm text-ink">{v}</div>
        </div>
      ))}
    </div>
  );
}

/**
 * The settlement, re-derived independently.
 *
 * Not an echo of the emitted event: the indexer replays the contract's own top-2 rule over
 * the raw reveals and compares. It is the honest answer to "how do we know the auctioneer
 * did not cheat", and the reason this design needs no operator set or challenge window --
 * there is no off-chain claim to challenge, and unlike a challenge period this check has no
 * deadline and can be re-run forever.
 */
export function ReplayCheck({ a }: { a: Auction }) {
  if (a.settlementMatchesDerivation === true) {
    return <p className="tnum mt-4 text-[0.8rem] text-glass">Settlement matches an independent replay of the reveals ✓</p>;
  }
  if (a.settlementMatchesDerivation === false) {
    return (
      <p className="tnum mt-4 text-[0.8rem] font-medium text-brick">
        Settlement DISAGREES with an independent replay. Shown, not hidden.
      </p>
    );
  }
  return <p className="tnum mt-4 text-[0.8rem] text-ink-faint">Replay check runs at settlement.</p>;
}
