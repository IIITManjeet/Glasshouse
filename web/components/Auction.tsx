"use client";

import { type Auction, livePhase, type Source } from "@/lib/useAuctions";

const num = (n?: number | null) =>
  n === null || n === undefined || Number.isNaN(n) ? "—" : n.toLocaleString("en-US");
const short = (a?: string | null) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "—");
const BLOCK_SECONDS = 2;

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
export function PhaseTrack({ a, head }: { a: Auction; head: number }) {
  const active = livePhase(a, head);
  const cells = [
    { key: "commit", range: `${num(a.openedAtBlock)}–${num(a.commitEnd)}`, note: "sealed bids arrive", end: a.commitEnd },
    { key: "reveal", range: `${num(a.commitEnd + 1)}–${num(a.revealEnd)}`, note: "bids open, top two settle", end: a.revealEnd },
    { key: "exclusive", range: `${num(a.revealEnd + 1)}–${num(a.exclusiveEnd)}`, note: "winner fills at the improved price", end: a.exclusiveEnd },
    { key: "open", range: `from ${num(a.exclusiveEnd + 1)}`, note: "anyone fills, at base price", end: 0 },
  ];

  return (
    <div className="grid grid-cols-2 gap-px border border-rule bg-rule sm:grid-cols-4">
      {cells.map((c) => {
        const isActive = c.key === active;
        // The contract collapses the exclusive window to nothing when nobody revealed, so
        // the diagram says that rather than drawing a window that will never exist.
        const isVoid = c.key === "exclusive" && !a.bestBidder;
        // commit() accepts while block.number <= commitEnd (GlasshouseBook.sol:159), so at
        // head == commitEnd there is ONE block left, not two. The +1 disagreed with
        // bid.js and printed a different countdown beside the same deadline.
        const left = isActive && c.end ? Math.max(0, c.end - head) : 0;
        return (
          <div
            key={c.key}
            className={[
              "p-3",
              isActive ? "bg-glass-soft" : "bg-raised",
              isVoid ? "opacity-60" : "",
            ].join(" ")}
          >
            <div className="font-mono text-[0.66rem] uppercase tracking-[0.12em] text-ink-faint">{c.key}</div>
            <div className="tnum mt-1 text-[0.78rem] text-glass">{c.range}</div>
            {isActive && c.end ? (
              <div className="tnum mt-1 text-[0.78rem] text-glass">
                {left} block{left === 1 ? "" : "s"} · ~{left * BLOCK_SECONDS}s
              </div>
            ) : (
              <div className="mt-1 text-[0.76rem] text-ink-faint">{isVoid ? "collapses if nobody reveals" : c.note}</div>
            )}
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
  return (
    <div className="mt-4 flex flex-wrap gap-2">
      {a.bids.map((b) => {
        const sealed = b.bps === null || b.bps === undefined;
        const leading = a.bestBidder && b.bidder?.toLowerCase() === a.bestBidder.toLowerCase();
        const isHouse = Boolean(a.maker && b.bidder?.toLowerCase() === a.maker.toLowerCase());
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
                  className="border border-amber px-1.5 py-0.5 font-mono text-[0.58rem] uppercase tracking-[0.1em] text-amber"
                >
                  house · the maker
                </span>
              )}
            </div>
            {sealed ? (
              <>
                <div className="tnum my-1 text-lg tracking-[0.1em] text-ink-faint">▨▨▨▨▨▨</div>
                <div className="tnum text-[0.78rem] text-ink-soft">{short(b.bidder)}</div>
                <div className="mt-1 text-[0.76rem] text-ink-faint">
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
                <div className="tnum my-1 text-lg text-ink">{b.bps} bps</div>
                <div className="tnum text-[0.78rem] text-ink-soft">{short(b.bidder)}</div>
                <div className={`mt-1 text-[0.76rem] ${leading ? "text-glass" : "text-ink-faint"}`}>
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
  );
}

export function Stats({ a, head }: { a: Auction; head: number }) {
  const p = livePhase(a, head);
  const state = a.settled ? "settled" : p === "open" || p === "exclusive" ? "final" : "running";
  const items: [string, string][] = [
    ["clearing", a.clearingBps === null ? "—" : `${a.clearingBps} bps · ${state}`],
    // Both numbers, never a percentage. A ratio without its denominator is a claim the
    // data does not support -- subgraph/README.md's refusals list.
    ["reveals", a.revealedCount == null ? `not read, ${a.committedCount} committed` : `${a.revealedCount} of ${a.committedCount}`],
    // "winner" only once settled: until then a higher reveal can still displace them.
    // Profile.tsx already said "leading, not settled"; three views disagreeing about one
    // address is worse than any single one being wrong.
    [a.settled ? "winner" : "leading", a.bestBidder ? short(a.bestBidder) : "no reveals"],
    ["reserve · max", `${a.reserveBps} · ${a.maxBps} bps`],
  ];
  if (a.filled) items.push(["filled by", short(a.filledBy)]);

  return (
    <div className="mt-4 flex flex-wrap gap-6">
      {items.map(([k, v]) => (
        <div key={k}>
          <div className="font-mono text-[0.66rem] uppercase tracking-[0.12em] text-ink-faint">{k}</div>
          <div className="tnum mt-0.5 text-sm text-ink">{v}</div>
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
