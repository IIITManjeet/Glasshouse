"use client";

import Link from "next/link";
import { useAuctions, livePhase, type Auction } from "@/lib/useAuctions";
import { SourceChip, PhaseTrack, BidCards, Stats, ReplayCheck } from "@/components/Auction";
import { WalletBar } from "@/components/WalletBar";
import { BidPanel, RevealStrip } from "@/components/BidPanel";

const num = (n: number) => n.toLocaleString("en-US");

/**
 * The front door.
 *
 * A short hero, then the live auction immediately below it -- above the fold, moving. The
 * written argument lives on the static page at site/index.html and is a link away, because
 * this is a product and the first thing a visitor should meet is the mechanism working,
 * not an essay about it.
 */
export default function Home() {
  const { auctions, head, source, isFork, loading, error } = useAuctions();

  // The round worth showing first is the one still happening. If none is live, the most
  // recent settled one is the honest thing to show -- never a spinner pretending
  // something is coming.
  const live = auctions.find((a) => livePhase(a, head) !== "open");
  const featured: Auction | undefined = live ?? auctions[0];

  return (
    <main>
      <section className="mb-10 max-w-3xl">
        <h1 className="font-display text-3xl leading-tight font-light sm:text-4xl">
          Who fills your order should be decided by <em className="text-glass not-italic">what it is worth</em>, not by who is fastest.
        </h1>
        <p className="mt-4 text-ink-soft">
          SwapVM ships two ways to allocate the right to fill an order. One asks who you are.
          The other asks what time it is. Glasshouse asks what you will pay — a sealed-bid,
          second-price auction, settled on chain. The winner pays the runner-up&rsquo;s price and
          the difference goes to the maker.
        </p>
        <p className="mt-3 text-sm text-ink-faint">
          <Link href="/rounds" className="text-glass underline underline-offset-2">Every round so far</Link>
          {" · "}
          <a href="/argument" className="text-glass underline underline-offset-2">Why the alternatives are worse</a>
        </p>
      </section>

      <section id="live">
        <WalletBar className="mb-4" />
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-xl font-normal">Live on Base</h2>
          {head > 0 && <SourceChip source={source} head={head} isFork={isFork} />}
        </div>

        {isFork && (
          <p className="mb-4 border-l-2 border-amber bg-amber-soft px-3 py-2 text-sm text-ink-soft">
            Pointed at a local fork of Base, not mainnet. Real contracts and real state, but
            the money is not real.
          </p>
        )}

        {loading && <p className="text-sm text-ink-faint">Reading the Book…</p>}

        {error && (
          <p className="border-l-2 border-brick bg-brick-soft px-3 py-2 text-sm text-ink-soft">
            Could not reach the chain: {error}
          </p>
        )}

        {!loading && !featured && (
          <div className="border border-rule bg-raised p-6">
            <p className="text-ink-soft">No round has been opened on this Book yet.</p>
            <p className="mt-2 text-sm text-ink-faint">
              The keeper opens a fresh round every couple of minutes when it is running. Until
              then there is nothing to watch, and this says so rather than showing a spinner.
            </p>
          </div>
        )}

        {featured && (
          <article className="border border-rule bg-raised p-5">
            <header className="mb-4 flex flex-wrap items-baseline gap-3">
              <h3 className="tnum text-base font-medium">
                Round {featured.round ?? "—"} · {featured.orderHash.slice(0, 10)}…
              </h3>
              <PhaseChip phase={livePhase(featured, head)} settled={featured.settled} />
              {!live && <span className="text-xs text-ink-faint">most recent — nothing is live right now</span>}
            </header>

            <PhaseTrack a={featured} head={head} />
            <BidCards a={featured} />
            <Stats a={featured} head={head} />
            <ReplayCheck a={featured} />

            {/* The whole point of the product: a visitor can join the round they are
                watching. BidPanel decides for itself which of connect / bid / reveal /
                closed applies -- the branching lives with the rules, in bid.js, not here. */}
            <div className="mt-5 border-t border-rule pt-4">
              <BidPanel auction={featured} head={head} />
            </div>

            <p className="mt-4 border-t border-rule pt-3 text-[0.78rem] leading-relaxed text-ink-faint">
              <strong className="font-medium text-ink-soft">What produced this:</strong> the{" "}
              <code className="font-mono">GlasshouseBook</code> contract on Base, read at block{" "}
              <span className="tnum">{num(head)}</span>. The phase is computed here against that same
              block — the contract stores no phase, it compares <code className="font-mono">block.number</code>{" "}
              against boundaries written when the round opened, so any honest reader has to do the same.
            </p>
          </article>
        )}

        {auctions.length > 1 && (
          <p className="mt-4 text-sm">
            <Link href="/rounds" className="text-glass underline underline-offset-2">
              See all {auctions.length} rounds →
            </Link>
          </p>
        )}
      </section>

      {/* Sticky, and the only sticky thing on the page. A reveal the bidder cannot see
          is a reveal they will miss, and missing it costs them the bid. */}
      <RevealStrip head={head} auctions={auctions} />
    </main>
  );
}

function PhaseChip({ phase, settled }: { phase: string; settled: boolean }) {
  const tone =
    phase === "commit" ? "bg-sunk text-ink-soft border-rule"
      : phase === "reveal" ? "bg-amber-soft text-amber border-amber"
        : phase === "exclusive" ? "bg-glass-soft text-glass border-glass"
          : "bg-raised text-ink-faint border-rule";
  return (
    <span className="flex gap-2">
      <span className={`border px-2 py-0.5 font-mono text-[0.66rem] uppercase tracking-[0.12em] ${tone}`}>{phase}</span>
      {settled && (
        <span className="border border-glass bg-glass-soft px-2 py-0.5 font-mono text-[0.66rem] uppercase tracking-[0.12em] text-glass">
          settled
        </span>
      )}
    </span>
  );
}
