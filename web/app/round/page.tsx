"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useAccount, useWaitForTransactionReceipt } from "wagmi";
import { useBoard } from "@/components/BoardProvider";
import { pageBand } from "@/components/PageBand";
import { SourceChip } from "@/components/Auction";
import { Settlement } from "@/components/Settlement";
import { Receipt } from "@/components/Receipt";
import { Timeline } from "@/components/Timeline";
import { Loading } from "@/components/Loading";
import { WalletBar } from "@/components/WalletBar";
import { BidPanel } from "@/components/BidPanel";
import { Copy } from "@/components/Copy";
import { livePhase } from "@/lib/useAuctions";
import type { Auction, Source } from "@/lib/useAuctions";
import { canSettle } from "@/lib/phase";
import { usePinnedAuction, isAddress } from "@/lib/pinned";
// Plain ESM, deliberately untyped: bid.js is the same file the static page and the Node
// tests load, and a .d.ts would be a second place for the shape to drift.
import { settleRound as settleRoundJs, explainRevert as explainRevertJs } from "@/lib/bid.js";

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
 *
 * AND NOW A THIRD KEY, `?m=`, WHICH IS NOT A CONVENIENCE. An auction in the Book is keyed
 * `key(maker, orderHash)` (GlasshouseBook.sol) -- the hash alone does not name one. Every
 * round this page could previously show was the keeper's, so the maker was implied by the
 * manifest and never had to travel. A round opened from a browser has a maker who appears
 * in no manifest, so its link carries both halves of the key, and `lib/pinned.ts` reads
 * that one auction straight from the Book rather than trying to enumerate it.
 *
 * WHAT THIS PAGE HAS TO DO THAT IT DID NOT BEFORE. It is now the only surface where a
 * visitor-opened round can be bid in and settled, so it mounts the wallet bar and the bid
 * panel during commit and reveal, and offers `settle()` once the exclusive window has
 * elapsed. Both are permissionless on the contract; neither was reachable from the site.
 */
const HASH_RE = /^0x[0-9a-fA-F]{64}$/;

const settleRound = settleRoundJs as (
  args: { maker: string; orderHash: string },
  options?: Record<string, unknown>,
) => Promise<{ txHash: string; maker: string; orderHash: string; settledBy: string }>;
const explainRevert = explainRevertJs as (e: unknown) => string;

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

/** The site's own record of what it shipped: `public/data/rounds.js`, loaded by layout.tsx
 *  with `strategy="beforeInteractive"`, so it has executed before React hydrates. */
type Manifest = { maker: string; rounds: { round: number; orderHash: string }[] };

function readManifest(): Manifest | null {
  if (typeof window === "undefined") return null;
  const m = (window as unknown as { GLASSHOUSE_ROUNDS?: Manifest }).GLASSHOUSE_ROUNDS;
  return m && Array.isArray(m.rounds) && typeof m.maker === "string" ? m : null;
}

/**
 * IS THERE AN ORDER BEHIND THIS AUCTION? THE ONE PREDICATE, COMPUTED ONCE.
 *
 * Two ways to answer yes, and they are different kinds of evidence:
 *
 *   1. `a.filled` IS A CHAIN FACT. `AuctionFilled` can only fire through the router's hook
 *      on a fill that actually executed, so a fill is proof that an order existed. Nothing
 *      about our records is involved.
 *   2. THE MANIFEST IS THE SITE'S OWN RECORD OF WHAT IT SHIPPED. `config/rounds.json`,
 *      generated into `public/data/rounds.js`, lists the order hashes the keeper opened
 *      against orders it posted to Aqua, under the keeper's maker address. Both halves of
 *      the key have to match: the same hash under a different maker is a different auction
 *      and implies nothing about an order.
 *
 * AND THE PHRASING, WHICH IS THE PART THAT MUST NOT BE GOT WRONG. False here means "no
 * order THIS SITE KNOWS OF" -- never "no order exists". The Book is handed an order hash
 * and stores it; it cannot see orders, it has no way to look one up, and neither can this
 * page. Somebody could have posted a SwapVM program for a hash we have never heard of.
 * What we can say without overclaiming is that we did not ship one, and that therefore we
 * cannot show a fill for it.
 *
 * When the manifest cannot be read at all (a server prerender, where this component's
 * output is replaced by the Suspense fallback and reaches no visitor) the answer defaults
 * to "known", so that a shell can never accuse a keeper round of having no order behind it.
 */
function orderKnownFor(a: Auction, manifest: Manifest | null): boolean {
  if (!manifest) return true;
  const hashes = new Set(manifest.rounds.map((r) => String(r.orderHash).toLowerCase()));
  return (
    a.filled ||
    (String(a.maker).toLowerCase() === manifest.maker.toLowerCase() &&
      hashes.has(String(a.orderHash).toLowerCase()))
  );
}

function RoundView() {
  const { auctions, head, source, loading, isFork, error, refresh } = useBoard();
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
  //
  // `?m=` needs no path fallback: it is only ever a real query parameter on the browser's
  // own URL (`/r/<hash>/?m=<maker>`), which is where `useSearchParams` reads from. The
  // rewrite decides which HTML the edge serves and does not touch the location bar.
  const pathname = usePathname() ?? "";
  const fromPath = /^\/r\/(0x[0-9a-fA-F]{64})\/?$/.exec(pathname)?.[1] ?? null;

  const h = params.get("h") ?? fromPath;
  const n = params.get("n");
  const m = params.get("m");
  const asked = h ?? n;

  // The keeper's rounds first, entirely unchanged: they come off the board's poll, which
  // this change does not touch.
  const keeperRound = findRound(auctions, h, n);

  // Only when the board has missed. Keeper links carry no `?m=` at all, so none of this
  // costs a page that already worked anything -- no extra eth_call, no second poll.
  //
  // WHOSE AUCTION, WHEN THE URL DOES NOT SAY. `?m=` only ever appears on a link to a round
  // somebody opened from a browser. Every other round link on this site is `/r/<hash>`
  // alone, because the maker was implied by the manifest -- and the board's poll reads only
  // the SIX most recent manifest rounds (`useAuctions.ts`, `limit: 6`, and BoardProvider
  // records why that number has to stay small). So a keeper round that has scrolled out of
  // that window, and the live-fill order -- which is built above the manifest entirely, and
  // is the one auction on this Book that cleared at the RUNNER-UP's price -- both rendered
  // "this build has not loaded a round with that identifier" on their own permanent URL.
  // True, and a dead end on the round the README leads with.
  //
  // The manifest names the keeper's maker, and it is already loaded (`beforeInteractive`).
  // Using it as the fallback half of the key turns that dead end into the same direct
  // contract read a `?m=` link gets. An explicit, well-formed `?m=` still wins.
  const manifest = readManifest();
  const makerAsked = isAddress(m) ? m : null;
  const fallbackMaker = isAddress(manifest?.maker) ? (manifest as Manifest).maker : null;
  const makerForPin = makerAsked ?? fallbackMaker;
  // `?m=` was supplied and is not an address. Different from `?m=` being absent, and the
  // page has to say which -- telling somebody to add the parameter they already added is
  // the "grid of zeros" mistake in one sentence.
  const makerMalformed = m !== null && m !== "" && !isAddress(m);
  const wantPinned = !keeperRound && !!h && HASH_RE.test(h) && !!makerForPin;
  const pinned = usePinnedAuction(wantPinned ? makerForPin : null, wantPinned ? h : null);

  const a = keeperRound ?? pinned.auction;
  const headNow = keeperRound ? head : pinned.head || head;
  // A pinned auction is always a live contract read; the board's `source` describes the
  // board's poll and would be a lie about this one (it can say "snapshot").
  const src: Source = keeperRound ? source : "chain";

  // The maker-qualified URL, which is the only link that resolves a visitor's round. Read
  // after mount: there is no location during the export's prerender.
  const [href, setHref] = useState("");
  useEffect(() => {
    setHref(window.location.href);
  }, [pathname, a?.orderHash]);

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

  // --- the pinned path, whose three outcomes are not the board's ------------------------
  if (!a && wantPinned) {
    if (pinned.notFound) {
      return (
        <div className="card mt-6">
          <p className="text-sm text-ink">The Book has no auction for that maker and that hash.</p>
          <p className="mt-2 text-[0.8125rem] text-ink-faint">
            This is the contract&rsquo;s own answer, not a failed read:{" "}
            <code className="font-mono">auctions(maker, orderHash)</code> returned an empty struct,
            which is what an auction that was never opened looks like.
            If a round was just opened, the transaction may not be in a block yet — reload in a
            few seconds.
          </p>
          {/* WHICH MAKER WAS ASKED ABOUT, because the answer is only about that one. An
              auction is keyed `key(maker, orderHash)`: the same hash under a different
              maker is a different auction, and "no such auction" without naming the maker
              reads as a claim about the hash. When the URL carried no maker this page
              supplied the keeper's from the manifest, and it has to say so rather than let
              a visitor think their own round was checked. */}
          <p className="tnum mt-2 text-[0.78rem] break-all text-ink-faint">
            maker asked about: {makerForPin}
            {!makerAsked
              ? " — the keeper's, from public/data/rounds.js, because the URL did not name a usable one"
              : null}
          </p>
          {makerMalformed ? (
            <p className="mt-2 text-[0.8125rem] text-amber">
              The <code className="font-mono">?m=</code> in this URL is not a well-formed
              address, so it was not used. A maker is 0x followed by 40 hex characters.
            </p>
          ) : null}
          <Link href="/rounds" className="mt-3 inline-block text-sm text-glass underline underline-offset-2">
            Every round so far →
          </Link>
        </div>
      );
    }
    if (pinned.error) {
      return (
        <div className="card mt-6">
          <p className="text-sm text-ink">Could not read this round from the chain.</p>
          <p className="mt-2 text-[0.8125rem] text-ink-faint">{pinned.error}</p>
          <p className="mt-2 text-[0.8125rem] text-ink-faint">
            That is a statement about this read, not about the round. It does not mean the
            auction is absent — only that the endpoint did not answer.
          </p>
        </div>
      );
    }
    return (
      <Loading
        className="mt-6"
        what="Reading this round from the Book"
        detail="One eth_call for the auction at that maker and hash, plus a log scan for its bids."
      />
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
  if (!a && error && auctions.length === 0) {
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

  if (!a && loading && auctions.length === 0) {
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
        {/* An auction is keyed by (maker, orderHash), and only the keeper's maker is
            implied. A round somebody opened from their own wallet can still be read here --
            it just has to say whose. */}
        <p className="mt-2 text-[0.8125rem] text-ink-faint">
          A round opened from a browser has a maker this build does not know, so its link
          carries one: <code className="font-mono">/r/&lt;hash&gt;/?m=&lt;maker&gt;</code>. With both
          halves of the key this page reads the auction straight from the Book.
        </p>
        {makerMalformed ? (
          <p className="mt-2 text-[0.8125rem] text-amber">
            The <code className="font-mono">?m=</code> in this URL is not a well-formed address,
            so it was not used. A maker is 0x followed by 40 hex characters.
          </p>
        ) : null}
        <Link href="/rounds" className="mt-3 inline-block text-sm text-glass underline underline-offset-2">
          Every round so far →
        </Link>
      </div>
    );
  }

  const phase = livePhase(a, headNow);
  // The same manifest object the key fallback above read, not a second call: one read, one
  // answer, so "whose round is this" and "did we ship an order for it" cannot disagree.
  const orderKnown = orderKnownFor(a, manifest);
  const bonded = (a.bond ?? "0") !== "0";
  const canBid = phase === "commit" || phase === "reveal";

  return (
    <>
      {!orderKnown ? (
        <p className="mt-4 max-w-prose text-sm leading-relaxed text-ink-soft">
          Real sealed bids and real second-price clearing on Base; no SwapVM order was shipped
          for this hash, so nothing could be filled. The price is real; the thing priced is
          empty.
        </p>
      ) : null}

      <div className="mt-8 flex flex-wrap items-center gap-3">
        <SourceChip source={src} head={headNow} isFork={isFork} />
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
        {/* Beside the phase, because it is the same kind of fact about the round: what state
            it is in, and what it is a round FOR. Amber, like every other "this is not the
            live mainnet story you assume" label on the site. */}
        {!orderKnown ? <span className="chip chip-warn">no order behind it</span> : null}
        {a.filled ? <span className="chip chip-live">filled</span> : null}
      </div>

      {/* THE LINK IS THE PRODUCT HERE. A round nobody else can reach is a round with one
          bidder, and one bidder clears at the reserve and demonstrates nothing about second
          price. `window.location.href` rather than a rebuilt URL, so whatever qualified this
          page -- including `?m=`, without which a visitor's round resolves to nothing -- is
          exactly what gets copied. */}
      {href ? (
        <p className="mt-3 flex flex-wrap items-baseline gap-x-2 text-[0.78rem] text-ink-faint">
          <span>Send this round to someone:</span>
          <span className="tnum break-all text-ink-soft">{href}</span>
          <Copy text={href} label="the link to this round" />
        </p>
      ) : null}

      {/* BIDDING LIVES HERE NOW, FOR EVERY ROUND AND NOT JUST THE KEEPER'S.
          It used to exist only on `/`, which shows whichever round the board found -- so a
          round reached by its own URL could be watched and never entered. That is the exact
          failure this page is addressed to fix: a link you can send someone is worth nothing
          if the page it opens has no way in. */}
      {canBid ? (
        <section className="mt-8 max-w-md">
          <WalletBar className="mb-4" />
          {bonded ? (
            <div className="card">
              <div className="card-head">
                <span>Your bid</span>
                <span className="chip chip-warn">bond escrowed</span>
              </div>
              <p className="text-sm text-ink-soft">
                This round escrows a bond; bid from a wallet that has already approved it, not
                from this page.
              </p>
              {/* WHY THE INPUT IS WITHHELD RATHER THAN OFFERED AND ALLOWED TO FAIL.
                  `commit()` pulls the bond with a transferFrom (GlasshouseBook.sol), and
                  `placeBid` has no approve path at all -- it was written for the keeper's
                  rounds, every one of which is bond 0. Rendering the field would produce a
                  pre-flight revert after the visitor had typed a number, which is a worse
                  answer than the sentence above. */}
              <p className="tnum mt-2 text-[0.78rem] leading-snug text-ink-faint">
                bond {a.bond} of the round&rsquo;s token · this page never asks for an approval
              </p>
            </div>
          ) : (
            <BidPanel auction={a} head={headNow} orderKnown={orderKnown} />
          )}
        </section>
      ) : null}

      {/* SETTLE, BECAUSE A ROUND THAT CANNOT BE FINISHED FROM HERE IS NOT RUNNABLE FROM HERE.
          `settle()` is permissionless exactly like `open()`: it walks the revealed bids,
          applies the top-2 rule and writes the outcome, and it does not care who pays the
          gas. Without this the receipt below -- which renders nothing until `settled` -- was
          reachable only by running a script. */}
      {phase === "open" && !a.settled ? (
        <SettleRound
          a={a}
          head={headNow}
          onSettled={keeperRound ? refresh : pinned.refresh}
        />
      ) : null}

      {/* The chart first: it is the only thing here that answers "what happened" in one
          look, and on a settled round it carries the whole claim. It returns null when
          there are no bids to draw, which is the honest state for a round nobody entered. */}
      <div className="mt-8">
        <Settlement a={a} head={headNow} source={src} />
      </div>

      <div className="mt-8">
        <Receipt a={a} source={src} orderKnown={orderKnown} />
      </div>

      <div className="mt-8">
        <Timeline maker={a.maker} orderHash={a.orderHash} />
      </div>

      <div className="mt-12 flex flex-wrap gap-x-6 gap-y-2 text-sm">
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

/**
 * The one control that finishes a round.
 *
 * ITS OWN COMPONENT BECAUSE OF THE HOOKS. The receipt wait is four pieces of state and a
 * wagmi subscription, and putting them in `RoundView` would make every one of them run on
 * every round page including the ones with nothing to settle.
 *
 * THE PREDICATE IS THE CONTRACT'S, NOT THE PHASE WORD'S. `phase()` calls a round with no
 * reveals "open" the block after `revealEnd`, because the exclusive window collapses when
 * there is no winner -- but `settle()` still requires `block.number > revealEnd +
 * exclusiveBlocks` at every bidder count (GlasshouseBook.sol:266, and `canSettle` in
 * lib/phase.ts exists for exactly this divergence). Offering the button on the phase word
 * alone would put a wallet prompt in front of a guaranteed revert the visitor pays for.
 */
function SettleRound({ a, head, onSettled }: { a: Auction; head: number; onSettled: () => void }) {
  const { isConnected } = useAccount();
  const [stage, setStage] = useState<"idle" | "wallet" | "sent">("idle");
  const [tx, setTx] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const receipt = useWaitForTransactionReceipt({
    hash: (tx ?? undefined) as `0x${string}` | undefined,
    query: { enabled: !!tx },
  });

  useEffect(() => {
    if (!tx || receipt.status !== "success") return;
    if (receipt.data?.status === "reverted") {
      setStage("idle");
      setTx(null);
      setNote(
        "The settle was sent and the chain rejected it, so the round is unchanged and nothing was spent beyond gas.",
      );
      return;
    }
    setStage("idle");
    setTx(null);
    onSettled();
  }, [tx, receipt.status, receipt.data, onSettled]);

  // Our head is a poll old, so this is deliberately the only thing that greys the button:
  // the chain's own inequality against the block we last read. Never a local timer.
  const ready = Number.isFinite(head) && head > 0 && canSettle(a, head);

  return (
    <div className="card mt-8 max-w-md">
      <div className="card-head">
        <span>Settle</span>
        <span className="chip">anyone may call it</span>
      </div>
      <p className="text-sm text-ink-soft">
        The reveals are in and the outcome is arithmetic the contract does itself: highest
        revealed bid wins, and it pays the second-highest, or the reserve if there was no
        second. Until somebody calls <code className="font-mono">settle()</code> there is no
        receipt.
      </p>
      {!isConnected ? (
        <p className="mt-3 text-[0.78rem] text-ink-faint">
          Connect a wallet above to call it. Settling costs gas and gains you nothing — it is
          the one step in this mechanism that is a favour.
        </p>
      ) : null}
      <button
        type="button"
        className="btn btn-primary mt-3 w-full"
        disabled={!isConnected || !ready || stage !== "idle"}
        onClick={async () => {
          setNote(null);
          setStage("wallet");
          try {
            const res = await settleRound({ maker: a.maker, orderHash: a.orderHash });
            setTx(res.txHash);
            setStage("sent");
          } catch (e) {
            setStage("idle");
            setNote(explainRevert(e));
          }
        }}
      >
        {stage === "wallet"
          ? "Confirm in wallet…"
          : stage === "sent"
            ? "Waiting for the block…"
            : "Settle this round"}
      </button>
      <p className="tnum mt-2 text-[0.74rem] text-ink-faint">
        {!Number.isFinite(head) || head <= 0
          ? "chain head not read — the contract judges the window, not this page"
          : ready
            ? `settleable since block ${(a.exclusiveEnd + 1).toLocaleString("en-US")}`
            : `not yet — settle opens after block ${a.exclusiveEnd.toLocaleString("en-US")}`}
      </p>
      {tx ? (
        <p className="mt-2 text-[0.74rem] text-ink-faint">
          <a
            href={`https://basescan.org/tx/${tx}`}
            target="_blank"
            rel="noopener"
            className="tnum text-glass hover:underline"
          >
            settle sent · {tx.slice(0, 10)}…{tx.slice(-6)} ↗
          </a>
        </p>
      ) : null}
      {note ? (
        <p role="status" className="mt-2 text-[0.74rem] leading-snug text-brick">
          {note}
        </p>
      ) : null}
    </div>
  );
}

export default function RoundPage() {
  return (
    <main className="relative" style={pageBand("/art/header-round.webp")}>
      {/* ONE LINE, AND NO BACK-LINK IN THE MASTHEAD. The nav marks the page you are on and
          carries Live · Rounds · Evidence · FAQ, so a second "← every round" beside the
          title was a third navigation affordance for a route that already had two. The one
          at the bottom of the round stays: that is where a reader who has finished actually
          reaches for it. */}
      <div>
        <h1 className="font-display text-3xl font-semibold text-ink">One round</h1>
        <p className="mt-3 text-sm text-ink-soft">
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
