"use client";

import Link from "next/link";
import { useAuctions, livePhase, type Auction } from "@/lib/useAuctions";
import { SourceChip, PhaseTrack, BidCards, Stats, ReplayCheck } from "@/components/Auction";
import { WalletBar } from "@/components/WalletBar";
import { BidPanel, RevealStrip } from "@/components/BidPanel";
import { Mechanism } from "@/components/Mechanism";
import { Atmosphere } from "@/components/Atmosphere";
import { Reveal } from "@/components/Reveal";
import { Feature, Plate } from "@/components/Feature";
import { SketchSealed, SketchSecondPrice, SketchReplay, SketchClock } from "@/components/Sketch";

const num = (n?: number | null) =>
  n === null || n === undefined || Number.isNaN(n) ? "—" : n.toLocaleString("en-US");

/**
 * The landing page.
 *
 * STRUCTURED AS A LANDING PAGE RATHER THAN AS AN INSTRUMENT WITH A HEADING. It opens with
 * the claim, shows the product working, then makes one claim per band with the real
 * component beside it, and closes on where it is deployed.
 *
 * The visuals in those bands are the product's own components, not screenshots. That is
 * the one form of "product shot" this page can carry honestly: a screenshot goes stale the
 * day the component changes and nothing catches it, while these cannot -- and anything
 * showing data is either live or wearing the rehearsal's label.
 *
 * The evidence still lives at /proof and /why. This page's job is to make a stranger want
 * to open them.
 */
export default function Home() {
  const { auctions, head, source, isFork, loading, error, demo, setDemo } = useAuctions();

  const live = auctions.find((a) => livePhase(a, head) !== "open");
  const featured: Auction | undefined = live ?? auctions[0];

  return (
    <main>
      {/* ---- HERO ------------------------------------------------------------------ */}
      <section className="relative -mx-5 px-5 pt-12 pb-16 sm:pt-20 sm:pb-20">
        <Atmosphere />

        <p className="font-mono text-[0.7rem] uppercase tracking-[0.14em] text-ink-faint">
          A custom 1inch SwapVM instruction · live on Base
        </p>

        <h1 className="mt-5 max-w-4xl font-display text-4xl leading-[1.1] font-light sm:text-5xl lg:text-6xl">
          Who fills your order should be decided by{" "}
          <em className="text-glass">what it is worth</em>, not by who is fastest.
        </h1>

        <p className="mt-6 max-w-2xl text-lg leading-relaxed text-ink-soft">
          SwapVM ships two ways to allocate the right to fill an order. One asks who you are.
          The other asks what time it is. Glasshouse asks what you will pay — a sealed-bid,
          second-price auction, settled on chain.
        </p>

        <div className="mt-10 flex flex-wrap gap-x-12 gap-y-6">
          {[
            ["highest bid", "400 bps", "wins the right to fill", "text-glass"],
            ["pays", "250 bps", "the runner-up's bid", "text-amber"],
            ["to the maker", "150 bps", "the difference", "text-ink"],
          ].map(([label, value, note, tone]) => (
            <div key={label}>
              <div className="font-mono text-[0.66rem] uppercase tracking-[0.12em] text-ink-faint">
                {label}
              </div>
              <div className={`tnum mt-1.5 text-3xl sm:text-4xl ${tone}`}>{value}</div>
              <div className="mt-1 text-[0.82rem] text-ink-faint">{note}</div>
            </div>
          ))}
        </div>

        <div className="mt-11 flex flex-wrap items-center gap-3">
          <a
            href="#live"
            className="border border-glass bg-glass-soft px-5 py-3 font-mono text-[0.72rem] uppercase tracking-[0.12em] text-glass transition-colors hover:bg-glass hover:text-raised"
          >
            Watch a round →
          </a>
          <button
            type="button"
            onClick={() => setDemo(true)}
            className="border border-rule px-5 py-3 font-mono text-[0.72rem] uppercase tracking-[0.12em] text-ink-soft transition-colors hover:border-glass hover:text-glass"
          >
            Run the rehearsal
          </button>
        </div>
      </section>

      {/* ---- THE PRODUCT, WORKING -------------------------------------------------- */}
      <section id="live" className="scroll-mt-6 border-t border-rule pt-12">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="font-mono text-[0.68rem] uppercase tracking-[0.14em] text-glass">
              Happening now
            </p>
            <h2 className="mt-2 font-display text-2xl font-light sm:text-3xl">Live on Base</h2>
          </div>
          {head > 0 && <SourceChip source={source} head={head} isFork={isFork} />}
        </div>

        <WalletBar className="mb-4" />

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
          <article className="border border-rule bg-raised p-5 sm:p-6">
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

            {/* Bidding is cut out entirely during the rehearsal: a commitment is
                hash(bps, salt, ORDER HASH) and a synthetic hash names no auction in the
                Book, so it would bind to nothing and could never be revealed. A disabled
                button still invites the click. */}
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
                  <code className="font-mono">web/lib/simulate.ts</code>, stepping one scripted round
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
      </section>

      {/* ---- FEATURE BANDS --------------------------------------------------------- */}

      <Feature
        eyebrow="Sealed, then opened"
        title={<>A bid nobody can read cannot be <em className="text-glass">front-run</em>.</>}
        visual={
          <Plate className="flex items-center justify-center">
            <SketchSealed className="w-full max-w-[19rem]" />
          </Plate>
        }
      >
        <p>
          You commit to a hash of your bid, a salt and the order. It sits on chain in public and
          says nothing — not to a searcher, not to the maker, not to us.
        </p>
        <p>
          When the commit window closes you open it. The contract checks the hash matches and only
          then learns what you offered, which is far too late for anyone to bid against you.
        </p>
      </Feature>

      <Feature
        eyebrow="Second price"
        title={<>The winner pays what the <em className="text-glass">runner-up</em> offered.</>}
        flip
        visual={
          <Plate className="flex items-center justify-center">
            <SketchSecondPrice className="w-full max-w-[19rem]" />
          </Plate>
        }
      >
        <p>
          Bid 400 and win against a 250, and you pay 250. What you bid decides <em>whether</em> you
          win; it does not decide what it costs you.
        </p>
        <p>
          That is what makes bidding your true value safe, and it is the difference — 150 bps here —
          that goes to the maker rather than to whoever had the fastest connection.
        </p>
      </Feature>

      <Feature
        eyebrow="No operator to trust"
        title={<>You can re-derive the settlement <em className="text-glass">yourself</em>.</>}
        visual={
          <Plate className="flex items-center justify-center">
            <SketchReplay className="w-full max-w-[19rem]" />
          </Plate>
        }
      >
        <p>
          The reveals are on chain. Anyone can replay the contract&rsquo;s own top-two rule over them
          and compare the answer to what was settled — and if the two ever disagree, this page shows
          it rather than hiding it.
        </p>
        <p>
          That is why this needs no operator set and no challenge window. There is no off-chain claim
          to challenge, and unlike a challenge period the check has no deadline.
        </p>
      </Feature>

      <Feature
        eyebrow="Why not a clock"
        title={<>A falling price is still a <em className="text-glass">race</em>.</>}
        flip
        visual={
          <Plate className="flex items-center justify-center">
            <SketchClock className="w-full max-w-[19rem]" />
          </Plate>
        }
      >
        <p>
          A Dutch auction shows every bidder in a block the same number, so the tie breaks on
          transaction order — and order on chain is sold to whoever pays the builder most.
        </p>
        <p>
          The fill goes to the fastest participant regardless of what it is worth to them.{" "}
          <Link href="/why" className="text-glass underline underline-offset-2">
            The three gates, run on one order →
          </Link>
        </p>
      </Feature>

      {/* ---- HOW A ROUND RUNS ------------------------------------------------------ */}
      <Reveal>
        <section className="border-t border-rule py-14 sm:py-16">
          <p className="font-mono text-[0.68rem] uppercase tracking-[0.14em] text-glass">
            End to end
          </p>
          <h2 className="mt-3 mb-8 max-w-2xl font-display text-2xl leading-snug font-light sm:text-3xl">
            One round, from sealed to paid.
          </h2>
          <Mechanism />
        </section>
      </Reveal>

      {/* ---- CLOSING --------------------------------------------------------------- */}
      <Reveal>
        <section className="border-t border-rule py-14">
          <h2 className="max-w-2xl font-display text-2xl leading-snug font-light sm:text-3xl">
            Deployed, and open to read.
          </h2>
          <div className="mt-7 flex flex-wrap gap-x-14 gap-y-6">
            {[
              ["the receipt", "What a finished round produced", "/proof"],
              ["the argument", "Why the alternatives are worse", "/why"],
              ["the history", "Every round so far", "/rounds"],
            ].map(([label, note, href]) => (
              <Link key={href} href={href} className="group">
                <div className="font-mono text-[0.66rem] uppercase tracking-[0.12em] text-ink-faint">
                  {label}
                </div>
                <div className="mt-1.5 text-ink group-hover:text-glass">
                  {note} <span className="text-glass">→</span>
                </div>
              </Link>
            ))}
          </div>
        </section>
      </Reveal>

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
