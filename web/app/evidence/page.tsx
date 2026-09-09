"use client";

import Link from "next/link";
import { useBoard } from "@/components/BoardProvider";
import { Receipt } from "@/components/Receipt";
import { ReservePanel } from "@/components/Reserve";
import { Leaderboard } from "@/components/Leaderboard";
import { Comparison } from "@/components/Comparison";
import { LatencyLens } from "@/components/Lens";
import { Reveal } from "@/components/Reveal";
import { Loading } from "@/components/Loading";

/**
 * Everything a sceptic asks for, on one page, grouped by CLAIM.
 *
 * This replaces /proof and /why, which were the same kind of thing -- evidence -- split by
 * where the data came from: chain on one, unit test on the other. That distinction matters
 * enormously to us and not at all to a visitor, who does not know it exists and cannot use
 * it to decide which link to click. Splitting an argument by its data source is a filing
 * decision, not an information architecture.
 *
 * Grouped by the question instead:
 *   1. did it work           the receipt, from a round that finished
 *   2. who is playing        the leaderboard, counts and never shares
 *   3. is it better          the three gates run on one order
 *   4. why not a clock       the same three bidders under both rules
 *   5. what happens next     the reserve the advisor recommends
 *
 * Every figure still carries its own source tag, so nothing is lost by putting a test
 * result and a chain read on the same page -- which is the point of having tags at all.
 * Anchored sections, so any single claim is linkable on its own.
 */

const SECTIONS = [
  ["receipt", "the receipt"],
  ["bidders", "who is bidding"],
  ["comparison", "three gates"],
  ["lens", "why not a clock"],
  ["reserve", "next auction"],
] as const;

export default function EvidencePage() {
  const { auctions, source, loading, error, setDemo } = useBoard();

  const settledRounds = auctions.filter((a) => a.settled);
  const settled = settledRounds.find((a) => a.bestBidder) ?? settledRounds[0];
  const skipped = settled ? settledRounds.indexOf(settled) : 0;

  return (
    <main>
      <section className="mb-8 max-w-3xl">
        <p className="font-mono text-[0.68rem] uppercase tracking-[0.14em] text-glass">
          The evidence
        </p>
        <h1 className="mt-3 font-display text-3xl leading-tight font-light sm:text-4xl">
          Everything here is <em className="text-glass">checkable</em>, and says how.
        </h1>
        <p className="mt-4 text-ink-soft">
          Some of this was read from Base and some came from a unit test with mock tokens and
          assigned valuations. Which is which is printed on each figure rather than left for you
          to guess — including where the numbers are less flattering.
        </p>
      </section>

      <nav className="mb-12 flex flex-wrap gap-x-4 gap-y-1 border-y border-rule py-2 font-mono text-[0.68rem] uppercase tracking-[0.12em] text-ink-faint">
        {SECTIONS.map(([id, label]) => (
          <a key={id} href={`#${id}`} className="hover:text-glass">
            {label}
          </a>
        ))}
      </nav>

      {error && (
        <p className="mb-6 border-l-2 border-brick bg-brick-soft px-3 py-2 text-sm text-ink-soft">
          Could not reach the chain: {error}
        </p>
      )}

      <Reveal>
        <section id="receipt" className="mb-14 scroll-mt-6">
          <h2 className="mb-1 font-display text-2xl font-light">Did it work</h2>
          <p className="mb-5 max-w-2xl text-sm text-ink-soft">
            The claim in one card: what the winner bid, what the winner paid, and the gap between
            them that went to the maker.
          </p>
          {loading && auctions.length === 0 ? (
            <Loading
              what="Looking for a settled round"
              detail="A receipt needs a reveal window that has closed with at least one envelope opened. Reading the Book to find one."
            />
          ) : settled ? (
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
      </Reveal>

      <Reveal>
        <section id="bidders" className="mb-14 scroll-mt-6">
          <h2 className="mb-1 font-display text-2xl font-light">Who is bidding</h2>
          <p className="mb-5 max-w-2xl text-sm text-ink-soft">
            Counts, never shares. A round is only counted as won once it has settled, because
            until then a later reveal can still take it away.
          </p>
          <Leaderboard auctions={auctions} source={source} />
        </section>
      </Reveal>

      <Reveal>
        <section id="comparison" className="mb-14 scroll-mt-6">
          <h2 className="mb-1 font-display text-2xl font-light">Is it actually better</h2>
          <p className="mb-5 max-w-2xl text-sm text-ink-soft">
            The same order, three ways. Every number in this section came from a unit test — mock
            tokens, assigned valuations, nothing observed on a network.
          </p>
          <Comparison />
        </section>
      </Reveal>

      <Reveal>
        <section id="lens" className="mb-14 scroll-mt-6">
          <h2 className="mb-1 font-display text-2xl font-light">Why not a clock</h2>
          <p className="mb-5 max-w-2xl text-sm text-ink-soft">
            The same three bidders under both rules. Only the rule for choosing among them
            differs — and the axis each rule ignores is drawn, not deleted.
          </p>
          <LatencyLens />
        </section>
      </Reveal>

      <Reveal>
        <section id="reserve" className="mb-14 scroll-mt-6">
          <h2 className="mb-1 font-display text-2xl font-light">What happens next</h2>
          <p className="mb-5 max-w-2xl text-sm text-ink-soft">
            There is no maker dashboard. The advisor reads the rounds that already happened and
            prints the command, with the reason it recommends what it does.
          </p>
          <ReservePanel auctions={auctions} source={source} />
        </section>
      </Reveal>

      <nav className="border-t border-rule pt-5 text-sm">
        <Link href="/board" className="text-glass underline underline-offset-2">
          Watch a round →
        </Link>
        {" · "}
        <a href="/argument.html" className="text-glass underline underline-offset-2">
          The long version
        </a>
        {" · "}
        <Link href="/rounds" className="text-glass underline underline-offset-2">
          Every round so far
        </Link>
      </nav>
    </main>
  );
}
