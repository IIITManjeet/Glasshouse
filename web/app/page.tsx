"use client";

import Link from "next/link";
import { useAuctions, livePhase, type Auction } from "@/lib/useAuctions";
import { SourceChip, PhaseTrack, BidCards, Stats, ReplayCheck } from "@/components/Auction";
import { WalletBar } from "@/components/WalletBar";
import { BidPanel, RevealStrip } from "@/components/BidPanel";
import { Receipt } from "@/components/Receipt";
import { Comparison } from "@/components/Comparison";
import { LatencyLens } from "@/components/Lens";
import { ReservePanel } from "@/components/Reserve";
import { Mechanism } from "@/components/Mechanism";

const num = (n?: number | null) =>
  n === null || n === undefined || Number.isNaN(n) ? "—" : n.toLocaleString("en-US");

const SECTIONS = [
  ["live", "live round"],
  ["receipt", "receipt"],
  ["comparison", "comparison"],
  ["lens", "why not a clock"],
  ["reserve", "next auction"],
] as const;

/**
 * The front door.
 *
 * A short hero, then the live auction immediately below it -- above the fold, moving. The
 * written argument lives on the static page at site/index.html and is a link away, because
 * this is a product and the first thing a visitor should meet is the mechanism working,
 * not an essay about it.
 *
 * Everything below the live round is the evidence, in the order a sceptic asks for it:
 * what a finished round looks like (the receipt), whether the alternatives are actually
 * worse (the comparison), why a clock cannot do this (the lens), and what the maker does
 * next (the reserve). Each is a figure carrying its own source, and none of them needs the
 * network -- so the page below the fold is the same whether the chain answers or not.
 */
export default function Home() {
  const { auctions, head, source, isFork, loading, error, demo, setDemo } = useAuctions();

  // The round worth showing first is the one still happening. If none is live, the most
  // recent settled one is the honest thing to show -- never a spinner pretending
  // something is coming.
  const live = auctions.find((a) => livePhase(a, head) !== "open");
  const featured: Auction | undefined = live ?? auctions[0];

  // The receipt is about a round that FINISHED, which is rarely the one on the board.
  //
  // The newest settled round with a WINNER, not simply the newest settled round: a round
  // where nobody opened an envelope settles with no winner, no clearing price and no fill,
  // and a receipt for it is four dashes. Those rounds are not hidden -- they are on the
  // board above, in the rounds table, and counted in the reserve window below -- but the
  // section that exists to show what a completed round looks like should show one.
  const settledRounds = auctions.filter((a) => a.settled);
  const settled = settledRounds.find((a) => a.bestBidder) ?? settledRounds[0];
  const skipped = settled ? settledRounds.indexOf(settled) : 0;

  return (
    <main>
      <section className="mb-8 max-w-3xl">
        <h1 className="font-display text-3xl leading-tight font-light sm:text-4xl">
          Who fills your order should be decided by <em className="text-glass">what it is worth</em>, not by who is fastest.
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
          <a href="/argument.html" className="text-glass underline underline-offset-2">Why the alternatives are worse</a>
        </p>
      </section>

      {/* The whole round at once, above the instrument that can only ever show one phase
          of it. A visitor landing during the commit window sees three hatched cards and a
          countdown; without this they have no way to know what it counts down TO. */}
      <section className="mb-12">
        <Mechanism />
      </section>

      {/* One line of anchors, no sticky bar. ui-spec.md section 2.3. */}
      <nav className="mb-10 flex flex-wrap gap-x-4 gap-y-1 border-y border-rule py-2 font-mono text-[0.68rem] uppercase tracking-[0.12em] text-ink-faint">
        {SECTIONS.map(([id, label]) => (
          <a key={id} href={`#${id}`} className="hover:text-glass">
            {label}
          </a>
        ))}
      </nav>

      <section id="live" className="scroll-mt-6">
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
              then there is nothing to watch, and this says so rather than showing a spinner.{" "}
              <button type="button" onClick={() => setDemo(true)} className="text-glass underline underline-offset-2">
                Watch a simulated round instead
              </button>
              .
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
                closed applies -- the branching lives with the rules, in bid.js, not here.

                Except during the rehearsal, where there is nothing to sign against. A
                commitment is hash(bps, salt, ORDER HASH) and the rehearsal's hashes name
                no auction in the Book, so the commit would succeed against nothing and
                the reveal could never land. Cutting the panel out entirely is the only
                honest option -- a disabled button still invites the click. */}
            <div className="mt-5 border-t border-rule pt-4">
              {demo ? (
                <div className="border border-amber bg-amber-soft px-3 py-2.5 text-sm text-ink-soft">
                  <strong className="font-medium text-amber">Bidding is off during the rehearsal.</strong>{" "}
                  A sealed bid commits to a hash of your bid, your salt and this round&rsquo;s{" "}
                  <em>order hash</em> — and the rehearsal&rsquo;s order hashes name no auction in the Book,
                  so the commitment would bind to nothing and could never be revealed.{" "}
                  <button type="button" onClick={() => setDemo(false)} className="text-glass underline underline-offset-2">
                    Switch to the real chain
                  </button>{" "}
                  to bid on a live round.
                </div>
              ) : (
                <BidPanel auction={featured} head={head} />
              )}
            </div>

            <p className="mt-4 border-t border-rule pt-3 text-[0.78rem] leading-relaxed text-ink-faint">
              <strong className="font-medium text-ink-soft">What produced this:</strong>{" "}
              {demo ? (
                <>
                  <code className="font-mono">web/lib/simulate.js</code>, stepping one scripted round
                  forward a block every 0.4 s. The phase, the clearing price and the winner are computed
                  from the block shown by the same functions the live board uses — the simulation supplies
                  the reveals, not the rules.
                </>
              ) : (
                <>
                  the <code className="font-mono">GlasshouseBook</code> contract on Base, read at block{" "}
                  <span className="tnum">{num(head)}</span>. The phase is computed here against that same
                  block — the contract stores no phase, it compares{" "}
                  <code className="font-mono">block.number</code> against boundaries written when the round
                  opened, so any honest reader has to do the same.
                </>
              )}
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

      <section id="receipt" className="mt-14 scroll-mt-6">
        <h2 className="mb-1 font-display text-xl font-normal">What a finished round looks like</h2>
        <p className="mb-4 max-w-2xl text-sm text-ink-soft">
          The claim in one card: what the winner bid, what the winner paid, and the gap between
          them that went to the maker instead.
        </p>
        {settled ? (
          <>
            <Receipt a={settled} source={source} />
            {skipped > 0 && (
              <p className="mt-2 text-[0.8rem] text-ink-faint">
                {skipped} more recent round{skipped === 1 ? "" : "s"} settled with no winner — every
                commitment stayed sealed, so there is no price and no fill to print.{" "}
                <Link href="/rounds" className="text-glass underline underline-offset-2">
                  They are in the rounds table
                </Link>
                .
              </p>
            )}
          </>
        ) : (
          <div className="border border-rule bg-raised p-6">
            <p className="text-ink-soft">No round on this Book has settled yet.</p>
            <p className="mt-2 max-w-2xl text-sm text-ink-faint">
              A receipt needs a reveal window that has closed with at least one envelope opened.
              This build has not seen one, and inventing a plausible receipt is exactly the thing
              this page refuses to do.{" "}
              <button type="button" onClick={() => setDemo(true)} className="text-glass underline underline-offset-2">
                Run the rehearsal
              </button>{" "}
              to see the same card filled in from a simulated round — labelled as one.
            </p>
          </div>
        )}
      </section>

      <section id="comparison" className="mt-14 scroll-mt-6">
        <h2 className="mb-1 font-display text-xl font-normal">The same order, three ways</h2>
        <p className="mb-4 max-w-2xl text-sm text-ink-soft">
          Every number in this section came from a unit test with mock tokens and assigned
          valuations. Nothing in it was observed on a network, and it is labelled that way
          throughout.
        </p>
        <Comparison />
      </section>

      <section id="lens" className="mt-14 scroll-mt-6">
        <h2 className="mb-1 font-display text-xl font-normal">Why a clock cannot do this</h2>
        <p className="mb-4 max-w-2xl text-sm text-ink-soft">
          A falling price is still a race. It sorts bidders by when they arrive, and arrival on
          chain is sold to whoever pays the builder most — so the fill goes to the fastest
          participant, whatever the fill is worth to them.
        </p>
        <LatencyLens />
      </section>

      <section id="reserve" className="mt-14 scroll-mt-6">
        <h2 className="mb-1 font-display text-xl font-normal">What the maker does next</h2>
        <p className="mb-4 max-w-2xl text-sm text-ink-soft">
          There is no maker dashboard. The advisor reads the rounds that already happened and
          prints the command, with the reserve it recommends and the reason it recommends it.
        </p>
        <ReservePanel auctions={auctions} source={source} />
      </section>

      {/* Sticky, and the only sticky thing on the page. A reveal the bidder cannot see
          is a reveal they will miss, and missing it costs them the bid.

          Never fed the rehearsal's rounds: the strip matches stored bid records against
          the auctions on the board by order hash, and a simulated hash matches nothing --
          but if one ever did, it would tell a real bidder to reveal into an auction that
          does not exist. */}
      <RevealStrip head={head} auctions={demo ? [] : auctions} />
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
