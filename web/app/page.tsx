"use client";

import Link from "next/link";
import { useAuctions, livePhase, type Auction } from "@/lib/useAuctions";
import { SourceChip, PhaseTrack, BidCards, Stats, ReplayCheck } from "@/components/Auction";
import { WalletBar } from "@/components/WalletBar";
import { BidPanel, RevealStrip } from "@/components/BidPanel";
import { Mechanism } from "@/components/Mechanism";
import { Atmosphere } from "@/components/Atmosphere";
import { Reveal } from "@/components/Reveal";

const num = (n?: number | null) =>
  n === null || n === undefined || Number.isNaN(n) ? "—" : n.toLocaleString("en-US");

/**
 * The front door.
 *
 * IT USED TO BE A WALL. Six full-width figures stacked in one column, each with a long
 * prose caption, and a visitor had to scroll past all of it to learn what the thing was.
 * The provenance captions are not the problem -- they are the point -- but putting every
 * one of them on the first page a stranger sees was.
 *
 * So this page now answers three questions and stops: what is the claim (hero), how does
 * it work (the diagram), and is it actually running (the live round). The evidence moved
 * to /proof and the argument to /why, each a link a visitor chooses to follow. Nothing was
 * deleted; the front door just stopped being an archive.
 */
export default function Home() {
  const { auctions, head, source, isFork, loading, error, demo, setDemo } = useAuctions();

  // The round worth showing first is the one still happening. If none is live, the most
  // recent settled one is the honest thing to show -- never a spinner pretending
  // something is coming.
  const live = auctions.find((a) => livePhase(a, head) !== "open");
  const featured: Auction | undefined = live ?? auctions[0];

  return (
    <main>
      {/* `relative` so the atmosphere can absolutely position itself against the hero and
          nothing else. It is behind the content at -z-10 and ignores the pointer. */}
      <section className="relative -mx-5 mb-14 px-5 pt-10 pb-16 sm:pt-16">
        <Atmosphere />

        <p className="font-mono text-[0.7rem] uppercase tracking-[0.14em] text-ink-faint">
          A custom 1inch SwapVM instruction · live on Base
        </p>

        <h1 className="mt-5 max-w-4xl font-display text-4xl leading-[1.12] font-light sm:text-5xl">
          Who fills your order should be decided by{" "}
          <em className="text-glass">what it is worth</em>, not by who is fastest.
        </h1>

        <p className="mt-6 max-w-2xl text-lg leading-relaxed text-ink-soft">
          SwapVM ships two ways to allocate the right to fill an order. One asks who you are.
          The other asks what time it is. Glasshouse asks what you will pay — a sealed-bid,
          second-price auction, settled on chain.
        </p>

        {/* The claim, as three numbers, because the mechanism is more persuasive than any
            adjective available to describe it. The same three the link card carries. */}
        <div className="mt-9 flex flex-wrap gap-x-10 gap-y-5">
          {[
            ["highest bid", "400 bps", "wins the right to fill", "text-glass"],
            ["pays", "250 bps", "the runner-up's bid", "text-amber"],
            ["to the maker", "150 bps", "the difference", "text-ink"],
          ].map(([label, value, note, tone]) => (
            <div key={label}>
              <div className="font-mono text-[0.66rem] uppercase tracking-[0.12em] text-ink-faint">
                {label}
              </div>
              <div className={`tnum mt-1.5 text-3xl ${tone}`}>{value}</div>
              <div className="mt-1 text-[0.82rem] text-ink-faint">{note}</div>
            </div>
          ))}
        </div>

        <div className="mt-10 flex flex-wrap items-center gap-3">
          <a
            href="#live"
            className="border border-glass bg-glass-soft px-4 py-2.5 font-mono text-[0.72rem] uppercase tracking-[0.12em] text-glass hover:bg-glass hover:text-raised"
          >
            Watch a round →
          </a>
          <Link
            href="/proof"
            className="border border-rule px-4 py-2.5 font-mono text-[0.72rem] uppercase tracking-[0.12em] text-ink-soft hover:border-glass hover:text-glass"
          >
            See the proof
          </Link>
          <Link
            href="/why"
            className="border border-rule px-4 py-2.5 font-mono text-[0.72rem] uppercase tracking-[0.12em] text-ink-soft hover:border-glass hover:text-glass"
          >
            Why not a clock
          </Link>
        </div>
      </section>

      {/* The whole round at once, above the instrument that can only ever show one phase
          of it. A visitor landing during the commit window sees three hatched cards and a
          countdown; without this they have no way to know what it counts down TO. */}
      <Reveal className="mb-14">
        <Mechanism />
      </Reveal>

      <section id="live" className="scroll-mt-6">
        <WalletBar className="mb-4" />
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-2xl font-normal">Live on Base</h2>
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

        <nav className="mt-8 border-t border-rule pt-5 text-sm">
          <Link href="/proof" className="text-glass underline underline-offset-2">
            What a finished round produced →
          </Link>
          {" · "}
          <Link href="/why" className="text-glass underline underline-offset-2">
            Why the alternatives are worse
          </Link>
          {" · "}
          <Link href="/rounds" className="text-glass underline underline-offset-2">
            Every round so far
          </Link>
        </nav>
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
