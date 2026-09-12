"use client";

import { Suspense } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
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
  const { auctions, head, source, loading, isFork, error } = useBoard();
  const params = useSearchParams();

  // THE SAME BUG AS F-10, IN THE FILE THAT DID NOT GET THE FIX.
  //
  // `/r/<hash>` is a Vercel REWRITE onto `/round/?h=<hash>` (vercel.json). A rewrite
  // changes which file the edge serves; it does NOT change the browser's location. So the
  // client still sees `/r/<hash>/` with an EMPTY query string, `params.get("h")` returns
  // null, and the page renders its "No round in the URL" state -- for every round link on
  // the site, including the one in the rounds table and any URL anyone shared.
  //
  // `/profile/<addr>` had exactly this defect, it was in production the whole time, and
  // DESIGN.md F-10 records it. `app/account/page.tsx:90` fixed it by reading the address
  // out of the PATH as a fallback. This file was written before that fix and never got it,
  // so the bug survived in the one place nobody re-checked -- found by opening a round link
  // and seeing an empty page.
  //
  // Query parameter first, path second: `?h=` is what `/round/?h=` itself uses and what
  // `/evidence`'s old back door used, so it stays authoritative.
  const pathname = usePathname() ?? "";
  const fromPath = /^\/r\/(0x[0-9a-fA-F]{64})\/?$/.exec(pathname)?.[1] ?? null;

  const h = params.get("h") ?? fromPath;
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

  // A FAILED READ IS NOT A SLOW READ, and this page used to have no way to say so.
  //
  // `error` was the one field of `useBoard()` this file did not destructure, so when the
  // chain read failed the guard below stayed true forever and the page sat on "Reading this
  // round from the Book..." indefinitely. Every other surface on the site distinguishes
  // "we could not read it" from "there is nothing there" -- it is the rule the rounds
  // filters and the account page are both built on -- and this was the one place that
  // silently collapsed the two into a spinner.
  //
  // It matters most on exactly the RPC condition that produced it: Base's public endpoint
  // rate limits (-32016 / HTTP 429), which this project has already been bitten by once
  // when a poll cost ten calls instead of three. A visitor who arrives mid-limit should be
  // told, and told that the number is not wrong -- only unread.
  if (error && auctions.length === 0) {
    return (
      <div className="card mt-6">
        <p className="text-sm text-ink">Could not read this round from the chain.</p>
        <p className="mt-2 text-[0.8125rem] text-ink-faint">{error}</p>
        <p className="mt-2 text-[0.8125rem] text-ink-faint">
          That is a statement about this read, not about the round: Base&apos;s public endpoint
          rate limits, and a refused call is not an empty auction. Reload, or open it on
          Basescan.
        </p>
        <Link
          href="/rounds"
          className="mt-3 inline-block text-sm text-glass underline underline-offset-2"
        >
          Every round so far →
        </Link>
      </div>
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
        {/* `/board` is gone -- the instrument moved to `/` and the nav's "Live" entry is
            the way there now. A third link to it from the bottom of a round page was one
            of the three places this route pointed at the board. */}
      </div>
    </>
  );
}

export default function RoundPage() {
  return (
    <main className="relative mx-auto max-w-[62rem] px-4 py-10 sm:px-6" style={pageBand("/art/header-round.webp")}>
      {/* ONE LINE, AND NO BACK-LINK IN THE MASTHEAD. The nav marks the page you are on and
          carries Live · Rounds · Evidence · FAQ, so a second "← every round" beside the
          title was a third navigation affordance for a route that already had two. The one
          at the bottom of the round stays: that is where a reader who has finished actually
          reaches for it. */}
      <div>
        <h1 className="font-display text-3xl font-semibold text-ink">One round</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Everything this Book recorded about a single auction.
        </p>
      </div>

      {/* useSearchParams needs a Suspense boundary under static export, the same as
          /account. Without it the build fails rather than degrading. */}
      <Suspense fallback={<Loading className="mt-6" what="Reading the URL" detail="" />}>
        <RoundView />
      </Suspense>
    </main>
  );
}
