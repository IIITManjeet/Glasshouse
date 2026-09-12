"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useBoard } from "@/components/BoardProvider";
import { pageBand } from "@/components/PageBand";
import { SourceChip } from "@/components/Auction";
import { Settlement } from "@/components/Settlement";
import { Receipt } from "@/components/Receipt";
import { Timeline } from "@/components/Timeline";
import { Loading } from "@/components/Loading";
import { livePhase } from "@/lib/useAuctions";
import type { Auction } from "@/lib/useAuctions";

/**
 * ONE ROUND, ON ITS OWN URL.
 *
 * Until now a round could be read three ways and linked none: the board showed whichever
 * one was live, /rounds listed them all in a table with no row you could open, and
 * /evidence showed the newest settled one with `?round=` as an undocumented back door.
 * There was no address for "this auction" -- so a maker could not send a bidder the round
 * they meant, a judge could not link the 250 bps fill in a writeup, and the receipt for a
 * specific round was reachable only by guessing a query parameter.
 *
 * Every auction on this Book now has a page, and the table links to it.
 *
 * WHY A QUERY PARAMETER. next.config.mjs sets output: "export", so there is no server at
 * request time to resolve /round/[hash] against -- only the shell this build produces. The
 * hash travels as ?h= and is read client-side, exactly as ?a= does on /account and ?rpc=
 * does in useAuctions. /r/<hash> is a Vercel edge rewrite onto the same page, mirroring
 * /profile/<address>, so the pretty URL is the one worth sharing.
 *
 * IT ACCEPTS BOTH KEYS, and that is not redundancy. `round` is an index into
 * config/rounds.json and most auctions have one; the live-fill order deliberately does NOT
 * (it is built above the manifest so it can never collide with a keeper round), and it is
 * the single most interesting auction on the chain -- the one that cleared at the
 * runner-up's price. A page that could only address rounds by number could not address
 * that one at all.
 */
const HASH_RE = /^0x[0-9a-fA-F]{64}$/;

function findRound(auctions: Auction[], h: string | null, n: string | null): Auction | undefined {
  if (h && HASH_RE.test(h)) {
    const want = h.toLowerCase();
    return auctions.find((a) => String(a.orderHash).toLowerCase() === want);
  }
  if (n !== null && n !== "") {
    const want = Number(n);
    if (Number.isInteger(want)) return auctions.find((a) => a.round === want);
  }
  return undefined;
}

function RoundView() {
  const { auctions, head, source, loading, isFork } = useBoard();
  const params = useSearchParams();

  const h = params.get("h");
  const n = params.get("n");
  const asked = h ?? n;
  const a = findRound(auctions, h, n);

  if (!asked) {
    return (
      <p className="mt-6 text-sm text-ink-soft">
        No round in the URL. Open one from{" "}
        <Link href="/rounds" className="text-glass underline underline-offset-2">
          every round so far
        </Link>
        .
      </p>
    );
  }

  if (loading && auctions.length === 0) {
    return (
      <Loading
        className="mt-6"
        what="Reading this round from the Book"
        detail="One eth_call for the auction, plus a log scan for its bids."
      />
    );
  }

  if (!a) {
    // NOT FOUND IS NOT THE SAME AS NOT LOADED, and saying so matters here: this build only
    // knows the rounds in its manifest plus whatever the snapshot carried, so a hash it
    // cannot find may be perfectly real and simply outside what was loaded.
    return (
      <div className="mt-6">
        <p className="text-sm text-ink-soft">
          This build has not loaded a round with that identifier.
        </p>
        <p className="mt-2 text-[0.8125rem] text-ink-faint">
          It reads {auctions.length} round(s) — the most recent from the manifest in
          public/data/rounds.js, plus anything in the checked-in snapshot. A hash outside
          that set is not necessarily wrong; it is not one of the rounds this page can see.
        </p>
        <Link href="/rounds" className="mt-3 inline-block text-sm text-glass underline underline-offset-2">
          Every round so far →
        </Link>
      </div>
    );
  }

  const phase = livePhase(a, head);

  return (
    <>
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <SourceChip source={source} head={head} isFork={isFork} />
        <span
          className={[
            "chip",
            phase === "commit" || phase === "reveal" || phase === "exclusive"
              ? "chip-live"
              : "",
          ].join(" ")}
        >
          {phase}
        </span>
        {a.filled ? <span className="chip chip-live">filled</span> : null}
      </div>

      {/* The chart first: it is the only thing here that answers "what happened" in one
          look, and on a settled round it carries the whole claim. It returns null when
          there are no bids to draw, which is the honest state for a round nobody entered. */}
      <div className="mt-8">
        <Settlement a={a} head={head} source={source} />
      </div>

      <div className="mt-8">
        <Receipt a={a} source={source} />
      </div>

      <div className="mt-8">
        <Timeline maker={a.maker} orderHash={a.orderHash} />
      </div>

      <div className="mt-10 flex flex-wrap gap-x-6 gap-y-2 text-sm">
        <Link href="/rounds" className="text-glass underline underline-offset-2">
          ← Every round
        </Link>
        <Link href="/evidence" className="text-glass underline underline-offset-2">
          The evidence page →
        </Link>
        <Link href="/board" className="text-glass underline underline-offset-2">
          The live board →
        </Link>
      </div>
    </>
  );
}

export default function RoundPage() {
  return (
    <main className="relative mx-auto max-w-[62rem] px-4 py-10 sm:px-6" style={pageBand("/art/header-round.webp")}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <div>
          <h1 className="font-display text-3xl font-semibold text-ink">One round</h1>
          <p className="mt-1 text-sm text-ink-soft">
            Everything this Book recorded about a single auction — the bids in commit order,
            the price and where it came from, and the transactions that produced them.
          </p>
        </div>
        <Link href="/rounds" className="text-sm text-glass underline underline-offset-2">
          ← every round
        </Link>
      </div>

      {/* useSearchParams needs a Suspense boundary under static export, the same as
          /account. Without it the build fails rather than degrading. */}
      <Suspense fallback={<Loading className="mt-6" what="Reading the URL" detail="" />}>
        <RoundView />
      </Suspense>
    </main>
  );
}
