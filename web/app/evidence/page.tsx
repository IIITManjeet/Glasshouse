"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useBoard } from "@/components/BoardProvider";
import { pageBand } from "@/components/PageBand";
import { Receipt } from "@/components/Receipt";
import { Timeline } from "@/components/Timeline";
import { Settlement } from "@/components/Settlement";
import { Verification } from "@/components/Verification";
import { ReservePanel } from "@/components/Reserve";
import { Leaderboard } from "@/components/Leaderboard";
import { Comparison } from "@/components/Comparison";
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
 * ONLY THE RECEIPT IS SUSPENDED, and that boundary is smaller than it first was for a
 * reason the lint caught. `useSearchParams` forces a Suspense boundary in a static export;
 * wrapping the WHOLE page in one made the entire page prerender as empty, and
 * scripts/lint-provenance.mjs -- which counts figures in the built HTML -- went from six to
 * two. Everything that does not depend on `?round=` renders at build time, so a crawler, a
 * reader with JavaScript off, and the lint all still see the figures.
 */

/**
 * FOUR SECTIONS, NOT FIVE. `lens` LEFT.
 *
 * `<LatencyLens>` is a drawing of a unit test with assigned valuations and an assigned
 * arrival order -- a picture of an ARGUMENT, not of a chain event. It was the one panel on
 * an evidence page that could not point at anything that happened, and a reader scanning
 * for "did this work" had to walk past it. It now opens the `#why-not-clock` answer on
 * /faq, which is where the question is actually asked.
 *
 * The page was ~1,600 words. Everything cut was a second and third sentence restating a
 * heading; every figure and every caption is untouched, because the captions are the
 * evidence.
 */
const SECTIONS = [
  ["receipt", "the receipt"],
  ["bidders", "who is bidding"],
  ["comparison", "three gates"],
  ["reserve", "next auction"],
] as const;

/**
 * The receipt, pinned by `?round=N` when a share link says so.
 *
 * A pinned round wins even when it has no winner: somebody followed a link to THAT round,
 * and quietly showing them a different one would make the page lie about which auction it
 * is describing.
 */
function PinnedReceipt() {
  const { auctions, source, head, loading, setDemo } = useBoard();
  const params = useSearchParams();

  const asked = params.get("round");
  const wanted = Number(asked);
  const pinned =
    asked !== null && Number.isInteger(wanted)
      ? auctions.find((a) => a.round === wanted)
      : undefined;

  const settledRounds = auctions.filter((a) => a.settled);
  const newest = settledRounds.find((a) => a.bestBidder) ?? settledRounds[0];
  const shown = pinned ?? newest;
  const skipped = pinned || !shown ? 0 : settledRounds.indexOf(shown);
  const missing = asked !== null && !pinned && !loading;

  if (loading && auctions.length === 0) {
    return (
      <Loading
        what="Looking for a settled round"
        detail="A receipt needs a reveal window that has closed with at least one envelope opened. Reading the Book to find one."
      />
    );
  }

  return (
    <>
      {missing && (
        <p className="mb-3 border-l-2 border-amber bg-amber-soft px-3 py-2 text-sm text-ink-soft">
          Round {asked} is not in the window this page reads — it holds the most recent rounds
          only. It is still on chain;{" "}
          <Link href="/rounds" className="text-glass underline underline-offset-2">
            the rounds table
          </Link>{" "}
          lists what this build can see.
        </p>
      )}
      {pinned && (
        <p className="mb-3 font-mono text-[0.7rem] uppercase tracking-[0.12em] text-glass">
          Pinned to round {pinned.round} by the link you followed
        </p>
      )}

      {shown ? (
        <>
          {/* The mechanism as one picture, above the receipt. The receipt proves the
              numbers; this shows where the price CAME from -- a line drawn at the
              runner-up's height, passing through the winner's column without touching it.
              It is a figure with real values and a source line, not decoration: an image
              that merely resembled a chart is the one thing this page cannot carry. */}
          <div className="mb-3">
            <Settlement a={shown} head={head} source={source} />
          </div>
          <Receipt a={shown} source={source} />
          {/* The verifier's own findings, under the receipt it corroborates. Shown as a
              recorded run rather than a live check, and failures first -- the tool's whole
              worth is that it reports what it could not confirm. */}
          <div className="mt-3">
            <Verification />
          </div>
          {/* The receipt is the OUTCOME; this is the SEQUENCE that produced it, and only the
              indexer can give it -- an eth_call returns storage as it is now, never the order
              it got that way. Suppressed for the rehearsal, which has no indexed round and
              whose block numbers are not Base blocks: a timeline there would be the one panel
              on this page that could not carry its own provenance. */}
          {source !== "sim" && (
            <div className="mt-3">
              <Timeline maker={shown.maker} orderHash={shown.orderHash} />
            </div>
          )}
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
        <div className="border border-rule bg-raised rounded-card shadow-card p-6">
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
    </>
  );
}

export default function EvidencePage() {
  const { auctions, source, head, error } = useBoard();

  return (
    <main className="relative" style={pageBand("/art/header-evidence.webp")}>
      {/* THE EYEBROWS ARE GONE, ALL FIVE OF THEM. `GH 03 · Evidence · 5 panels` and its
          siblings were an academic paper's figure numbers: they numbered panels nobody
          refers to by number, and they announced a count that went stale the moment a panel
          moved. Nothing on the site linked to "GH 07". */}
      <section className="mb-8 max-w-3xl">
        <h1 className="font-display text-3xl font-semibold text-ink">
          Everything here is <em className="text-glass not-italic">checkable</em>, and says how.
        </h1>
        <p className="lede mt-4 text-ink-soft">
          Every figure says whether it came from Base or from a unit test — including where the
          number is less flattering.
        </p>
      </section>

      <nav className="mb-12 flex flex-wrap gap-x-4 gap-y-1 border-y border-rule py-2 font-mono text-[0.6875rem] uppercase tracking-[0.12em] text-ink-faint">
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

      <div>
        <section id="receipt" className="mb-14 scroll-mt-6">
          <h2 className="mb-1 font-display text-2xl font-semibold">Did it work</h2>
          <p className="mb-5 max-w-2xl text-sm text-ink-soft">
            What the winner bid, what the winner paid, and the gap that went to the maker.
          </p>
          <Suspense
            fallback={
              <Loading
                what="Reading the round"
                detail="Resolving which round to show — a share link can pin a specific one."
              />
            }
          >
            <PinnedReceipt />
          </Suspense>
        </section>
      </div>

      <div>
        <section id="bidders" className="mb-14 scroll-mt-6">
          <h2 className="mb-1 font-display text-2xl font-semibold">Who is bidding</h2>
          <p className="mb-5 max-w-2xl text-sm text-ink-soft">
            Counts, never shares — and a round counts as won only once it has settled.
          </p>
          <Leaderboard auctions={auctions} source={source} />
        </section>
      </div>

      <div>
        <section id="comparison" className="mb-14 scroll-mt-6">
          <h2 className="mb-1 font-display text-2xl font-semibold">Is it actually better</h2>
          <p className="mb-5 max-w-2xl text-sm text-ink-soft">
            The same order, three ways — every number from a unit test, not from a network.
          </p>
          <Comparison />
        </section>
      </div>

      <div>
        <section id="reserve" className="mb-14 scroll-mt-6">
          <h2 className="mb-1 font-display text-2xl font-semibold">What happens next</h2>
          <p className="mb-5 max-w-2xl text-sm text-ink-soft">
            The advisor reads the rounds that already happened and prints the command.
          </p>
          <ReservePanel auctions={auctions} source={source} head={head} />
        </section>
      </div>

      {/* "The long version" LEFT THIS ROW for the footer, where it sits on every route
          instead of only on the page a reader has already finished. /board became / when
          the instrument moved, so the first link is the live board at its new address. */}
      <nav className="border-t border-rule pt-5 text-sm">
        <Link href="/" className="text-glass underline underline-offset-2">
          Watch a round →
        </Link>
        {" · "}
        <Link href="/rounds" className="text-glass underline underline-offset-2">
          Every round so far
        </Link>
        {" · "}
        <Link href="/faq#why-not-clock" className="text-glass underline underline-offset-2">
          Why not a clock →
        </Link>
      </nav>
    </main>
  );
}
