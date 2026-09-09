"use client";

import Link from "next/link";
import { useAuctions } from "@/lib/useAuctions";
import { SourceChip } from "@/components/Auction";
import { Receipt } from "@/components/Receipt";
import { ReservePanel } from "@/components/Reserve";
import { Leaderboard } from "@/components/Leaderboard";
import { Reveal } from "@/components/Reveal";

/**
 * The evidence: a finished round, who has been bidding, and what the maker does next.
 *
 * Split off the front door so that page can be short. This is the page for somebody who
 * has already decided the idea is interesting and now wants to check it -- which is a
 * different visit, and deserves its own URL to send someone.
 *
 * Every figure here is honest about being empty. The Book has four rounds opened, none
 * revealed in and none settled, so on live data the receipt and the leaderboard both say
 * so rather than showing a shape with nothing in it. The rehearsal fills all three.
 */
export default function ProofPage() {
  const { auctions, head, source, isFork, loading, error, demo, setDemo } = useAuctions();

  const settledRounds = auctions.filter((a) => a.settled);
  const settled = settledRounds.find((a) => a.bestBidder) ?? settledRounds[0];
  const skipped = settled ? settledRounds.indexOf(settled) : 0;

  return (
    <main>
      <section className="mb-8 max-w-3xl">
        <p className="font-mono text-[0.7rem] uppercase tracking-[0.14em] text-ink-faint">
          The evidence
        </p>
        <h1 className="mt-3 font-display text-3xl leading-tight font-light sm:text-4xl">
          What a finished round actually <em className="text-glass">produced</em>.
        </h1>
        <p className="mt-4 text-ink-soft">
          The claim in one card: what the winner bid, what the winner paid, and the gap between
          them that went to the maker instead. Then who has been bidding, and the reserve the
          advisor recommends for the next round.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          {head > 0 && <SourceChip source={source} head={head} isFork={isFork} />}
        </div>
      </section>

      {loading && <p className="mb-6 text-sm text-ink-faint">Reading the Book…</p>}
      {error && (
        <p className="mb-6 border-l-2 border-brick bg-brick-soft px-3 py-2 text-sm text-ink-soft">
          Could not reach the chain: {error}
        </p>
      )}

      <Reveal className="mb-12">
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
      </Reveal>

      <Reveal className="mb-12">
        <Leaderboard auctions={auctions} source={source} />
      </Reveal>

      <Reveal className="mb-12">
        <ReservePanel auctions={auctions} source={source} />
      </Reveal>

      <nav className="border-t border-rule pt-5 text-sm">
        <Link href="/why" className="text-glass underline underline-offset-2">
          Why the alternatives are worse →
        </Link>
        {" · "}
        <Link href="/rounds" className="text-glass underline underline-offset-2">
          Every round so far
        </Link>
        {" · "}
        <Link href="/" className="text-glass underline underline-offset-2">
          Back to the live board
        </Link>
      </nav>
    </main>
  );
}
