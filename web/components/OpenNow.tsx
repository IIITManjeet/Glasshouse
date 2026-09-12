"use client";

import { type Auction, livePhase } from "@/lib/useAuctions";
// IMPORTED, NOT COPIED. There was a second countdown in this file for about ten minutes and
// it was already wrong: it counted `commitEnd - head + 1`, because commit() accepts while
// `block.number <= commitEnd` and that off-by-one is easy to re-derive incorrectly. One
// countdown, in components/Auction.tsx, against the same head the row data describes.
import { Countdown } from "./Auction";
import { AddressLink } from "./Address";
import { BidStrip } from "./BidStrip";
import { ArrowRight } from "./Icon";

const num = (n?: number | null) =>
  n === null || n === undefined || Number.isNaN(n) ? "—" : n.toLocaleString("en-US");

/**
 * THE TILE THAT MAKES /rounds A VENUE RATHER THAN AN EXPORT.
 *
 * The page below this is a ledger, and a ledger is the right shape for history. It is the
 * wrong shape for "can I bid right now", which is the only question a visitor arrives with.
 * That question used to be answerable on this page only by reading a phase word in row one
 * of a seven-column table and then leaving for the board.
 *
 * THREE STATES, AND ALL THREE HAVE TO LOOK DELIBERATE. Every exchange in the world shows
 * its last print when the market is quiet; a venue that renders nothing between rounds
 * looks broken, and worse, looks like it has never had a round.
 *
 *   1. A round is open        -> the block countdown is the biggest thing on the page, the
 *                                bid strip says who is in it, and the page's ONE primary is
 *                                the act.
 *   2. No round is open       -> the same tile becomes the LAST PRINT: clearing price at the
 *                                same size in amber (money to the maker), who won, and the
 *                                sentence saying why nothing is open right now.
 *   3. Nothing loaded at all  -> NO TILE. This is the one case where drawing something would
 *                                be a lie: "we could not read the chain" is not "the market
 *                                is quiet", and the page's own honest sentence card says
 *                                which of the two it is. `auctions.length === 0` covers both
 *                                the zero-rounds case and the failed-read case, and the
 *                                caller distinguishes them in prose.
 *
 * THE PRIMARY IS SINGULAR, ACROSS THE WHOLE PAGE. globals.css: one `.btn-primary` per view.
 * With two live rounds only the one you can still bid in gets it; the rest are secondary.
 * With no round in the commit window the page has no primary at all, which is correct --
 * there is nothing to act on.
 */

/** Where the instrument lives. Not /board: the bidding UI is being moved to the root. */
const INSTRUMENT = "/";

/** A plain <a>, never next/link: /r/<hash> is a vercel.json edge rewrite onto /round/?h=,
 *  not a route this static export produced, so next/link resolves it client-side, finds
 *  nothing and renders 404 without ever making a request. components/Address.tsx owns the
 *  same rule for /profile/<addr>. */
function roundHref(a: Auction) {
  return `/r/${a.orderHash}`;
}

function PhaseChip({ a, head }: { a: Auction; head: number }) {
  const p = livePhase(a, head);
  // The dot is never the only carrier of "live" -- the phase word beside it and the block
  // countdown below it both say the same thing, which is the rule that lets the one
  // animation on this site exist at all.
  return (
    <span className="chip chip-live">
      <span className="live-dot" aria-hidden="true" /> {p}
    </span>
  );
}

function LiveTile({ a, head, primary }: { a: Auction; head: number; primary: boolean }) {
  const p = livePhase(a, head);
  const canStillBid = p === "commit";
  // NO TRAILING ARROW CHARACTER. It was `"Bid in this round →"` -- the glyph baked into
  // the label string, so it took the sans face's own metrics: it did not scale with the
  // 15px primary, and it sat on the text baseline rather than on the optical centre of a
  // 44px control. `<ArrowRight />` is a 16px path centred by `.btn`'s own flexbox.
  const label = canStillBid
    ? "Bid in this round"
    : p === "reveal"
      ? "Watch the reveals"
      : // The exclusive window: reveals are over and the winner is filling. "Watch the
        // reveals" would be a small lie about which window this is.
        "Watch the winner fill";

  return (
    <div className="card">
      <div className="card-head">
        <span>
          <a
            href={roundHref(a)}
            className="text-glass underline decoration-rule underline-offset-2 hover:decoration-glass"
          >
            {Number.isFinite(a.round) ? `Round ${a.round}` : "Live-fill order"}
          </a>
          <span className="text-ink-faint"> · open now</span>
        </span>
        <PhaseChip a={a} head={head} />
      </div>

      {/* THE BIGGEST THING ON THE PAGE. Blocks lead, seconds follow, because the contract
          compares block.number against boundaries it wrote at open and has no clock. */}
      <Countdown a={a} head={head} />

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="text-[0.8125rem] text-ink-soft">
          sealed bids
        </span>
        <BidStrip a={a} mode="full" />
      </div>

      {/* THE PRIMARY IS NOT A FOOTNOTE, AND IT USED TO LIVE IN ONE.
          This anchor sat inside `.card-foot`: a 13px, `--color-ink-faint`, 10px-padded
          caption strip whose whole job is to be the quietest band on the card. Dropping a
          44px filled control into it ballooned the strip to ~64px, gave the loudest thing
          on the page a caption-coloured surround, and put the act BELOW a horizontal rule
          from the round it acts on. The parameters footnote stays in the foot, which is
          what a foot is for; the act comes back up into the card body, 16px under the
          sealed-bid count it follows from. */}
      <div className="mt-4">
        <a
          href={INSTRUMENT}
          className={primary && canStillBid ? "btn btn-primary" : "btn btn-secondary"}
        >
          {label}
          <ArrowRight />
        </a>
      </div>

      <p className="card-foot">
        reserve <span className="tnum text-ink-soft">{a.reserveBps}</span> · max{" "}
        <span className="tnum text-ink-soft">{a.maxBps}</span> bps
      </p>
    </div>
  );
}

function LastPrintTile({ a, head, lastOpened }: { a: Auction; head: number; lastOpened: number }) {
  const priced = a.clearingBps !== null && a.clearingBps !== undefined;
  // WHO SET THE PRICE, read from the fields rather than assumed. The contract clears at the
  // runner-up's bid, or at the reserve when there was no runner-up (GlasshouseBook's
  // second-price rule). Comparing clearingBps against both is how this page knows which of
  // the two happened without re-implementing the rule -- a fourth implementation of the
  // clearing rule is what scripts/verify-run.mjs exists to prevent.
  const bySecond = priced && a.secondBps > 0 && a.clearingBps === a.secondBps;
  const byReserve = priced && !bySecond && a.clearingBps === a.reserveBps;
  const setBy = bySecond
    ? "set by the runner-up"
    : byReserve
      ? "set by the reserve, with no runner-up"
      : "set by the contract's clearing rule";

  return (
    <>
    <div className="card">
      <div className="card-head">
        <span>
          <a
            href={roundHref(a)}
            className="text-glass underline decoration-rule underline-offset-2 hover:decoration-glass"
          >
            {Number.isFinite(a.round) ? `Round ${a.round}` : "Live-fill order"}
          </a>
          <span className="text-ink-faint"> · last print</span>
        </span>
        <span className="chip">{a.settled ? "settled" : livePhase(a, head) === "open" ? "closed" : "in flight"}</span>
      </div>

      {priced ? (
        // A SURFACE STEP, NOT A SECOND BOX. This was `border border-rule bg-raised
        // rounded-card`, which drew a full second frame 16px inside the card's own
        // border -- around the one number on the tile anybody quotes. `bg-raised` is also
        // the card's own colour, so the border was the only thing separating them: a
        // rectangle whose sole content was "there is a rectangle here". `--color-sunk` is
        // a real step down from the card in both themes and needs no outline at all.
        <div className="bg-sunk rounded-control px-4 py-3">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-2">
            {/* AMBER, NOT GLASS. In this palette amber is the provisional and the money --
                the clearing price is what the maker actually paid away, and it is the one
                figure on a settled round anybody quotes. */}
            <span className="tnum text-4xl leading-none font-medium text-amber sm:text-5xl">
              {a.clearingBps}
            </span>
            <span className="text-sm text-ink">bps cleared</span>
            <span className="tnum ml-auto text-[0.78rem] text-ink-faint">
              block {num(a.openedAtBlock)}
            </span>
          </div>
          <p className="mt-2 text-[0.8125rem] text-ink-soft">
            {setBy}
            {a.bestBps > 0 ? (
              <>
                {" · winner bid "}
                <span className="tnum">{a.bestBps}</span>
              </>
            ) : null}
          </p>
        </div>
      ) : (
        // A round with no clearing price is a real outcome, not a missing number, and a
        // 3rem em-dash would be the "grid of zeroes" mistake in one character.
        <p className="bg-sunk rounded-control px-4 py-3 text-sm text-ink-soft">
          The last round closed without a clearing price: no bid was opened in it, so the
          contract has no second price to clear at.
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-[0.8125rem] text-ink-soft">
        <span className="inline-flex items-center gap-2">
          winner{" "}
          {a.bestBidder ? (
            <AddressLink addr={a.bestBidder} role={a.settled ? "winner" : "leading"} />
          ) : (
            <span className="text-ink-faint">none</span>
          )}
        </span>
        <span className="inline-flex items-center gap-2">
          sealed bids <BidStrip a={a} mode="full" />
        </span>
      </div>

      {/* Out of the foot, for LiveTile's reason. This one is secondary rather than
          primary -- there is nothing to bid on -- but a 36px bordered control inside a
          10px caption strip is the same category error at a smaller size. */}
      <div className="mt-4">
        <a href={roundHref(a)} className="btn btn-secondary">
          Open the round
          <ArrowRight />
        </a>
      </div>

      <p className="card-foot">
        reserve <span className="tnum text-ink-soft">{a.reserveBps}</span> · max{" "}
        <span className="tnum text-ink-soft">{a.maxBps}</span> bps
      </p>
    </div>
    {/* OUTSIDE the card, not inside it. `.card-foot` ends with `margin-bottom: -16px` so it
        can sit flush against the card's edge; anything placed after it inside the card is
        pulled up underneath it. This sentence is also genuinely ABOUT the tile rather than
        part of it -- the tile is a print, this is why there is no live round above it. */}
    <p className="mt-3 text-[0.8125rem] text-ink-faint">
      No round is open. Rounds open when the keeper runs; the last opened at block{" "}
      <span className="tnum">{num(lastOpened)}</span>.
    </p>
    </>
  );
}

export function OpenNow({ auctions, head }: { auctions: Auction[]; head: number }) {
  // STATE 3. No tile. The caller's own sentence card already says whether this is "nothing
  // has happened" or "we could not read it", and those are different claims.
  if (!auctions || auctions.length === 0) return null;

  const newestFirst = [...auctions].sort((x, y) => y.openedAtBlock - x.openedAtBlock);
  const live = newestFirst.filter((a) => livePhase(a, head) !== "open").slice(0, 3);

  if (live.length > 0) {
    // Exactly one primary, and only if there is genuinely something to bid on. `commit` is
    // the only window that accepts a new bid.
    const primaryHash = live.find((a) => livePhase(a, head) === "commit")?.orderHash ?? null;
    return (
      <div
        className={[
          "mt-6 grid gap-4",
          live.length === 1 ? "" : live.length === 2 ? "sm:grid-cols-2" : "sm:grid-cols-2 lg:grid-cols-3",
        ].join(" ")}
      >
        {live.map((a) => (
          <LiveTile key={a.orderHash} a={a} head={head} primary={a.orderHash === primaryHash} />
        ))}
      </div>
    );
  }

  // STATE 2. Quiet market, so show the last print. Prefer the newest SETTLED round -- that
  // is the one whose outcome is final on chain -- and fall back to the newest round we have
  // rather than drawing nothing, because "nothing" here would read as "no history".
  const last = newestFirst.find((a) => a.settled) ?? newestFirst[0];
  const lastOpened = newestFirst[0].openedAtBlock;

  return (
    <div className="mt-6">
      <LastPrintTile a={last} head={head} lastOpened={lastOpened} />
    </div>
  );
}

export default OpenNow;
