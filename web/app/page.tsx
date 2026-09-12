"use client";

import Link from "next/link";
import { livePhase, type Auction } from "@/lib/useAuctions";
import { useBoard } from "@/components/BoardProvider";
import { pageBand } from "@/components/PageBand";
import { PhaseTrack, BidCards, Stats, ReplayCheck, Countdown } from "@/components/Auction";
import { WalletBar } from "@/components/WalletBar";
import { BidPanel, RevealStrip } from "@/components/BidPanel";
import { SettlementReel } from "@/components/SettlementReel";
import { AddressLink } from "@/components/Address";
import { Loading, Swap } from "@/components/Loading";

const num = (n?: number | null) =>
  n === null || n === undefined || Number.isNaN(n) ? "—" : n.toLocaleString("en-US");

/**
 * THE INSTRUMENT IS THE FRONT DOOR.
 *
 * What used to be here was a pitch: a hero image, a headline in two clauses, a lede, three
 * 48px numbers, a settlement chart, a READ-ONLY "pulse" card, the mechanism diagram and a
 * three-up grid of doors. Its own code comment gave the game away -- "the live strip here is
 * deliberately READ-ONLY -- a pulse, not a panel" -- and the pulse's only job was to say the
 * thing was alive and then send you one click away to the thing itself. A product whose
 * front page links to the product is a brochure.
 *
 * So /board's contents are now /. The countdown, the phases, the bids, the stats, the replay
 * check and the panel that lets a visitor join the round they are watching arrive on the URL
 * people are given. /board redirects here, so every shared link still works.
 *
 * ONE SENTENCE SURVIVES FROM THE PITCH, and it is deliberate rather than a leftover. The
 * first plan for this page deleted the headline outright, which goes too far: a stranger
 * would land on a live auction with a block countdown and no statement of what they are
 * looking at. One line says it. It is not a hero, it has no standfirst, and everything else
 * that was persuasion -- the mechanism section, the three doors, the three big bps numbers,
 * "New here? How to take part" -- moved to /faq, where an argument can be as long as it
 * needs to be without standing between a bidder and a deadline.
 *
 * WHAT IS NOT HERE, AND WHY. No "panel-id" eyebrows (GH 01 · Book 0xc4ea…): the layout's
 * status bar carries the Book, the chain and the head block on every page, which is what
 * makes a screenshot of this page carry its own provenance. No bottom nav: the masthead has
 * one. No explanation under a panel where a four-word link to the right /faq anchor does the
 * same job without competing with the act.
 */
export default function Home() {
  const { auctions, head, source, loading, error, demo, setDemo } = useBoard();

  const live = auctions.find((a) => livePhase(a, head) !== "open");
  const featured: Auction | undefined = live ?? auctions[0];

  // THE LAST PRINT. What every exchange shows when the market is quiet, and the right
  // opening shot when no round is open at all -- a venue between auctions is not a broken
  // page. A round with one bidder clears at the reserve and demonstrates nothing about
  // second price, so this wants a winner AND a clearing price; `SettlementReel` replays the
  // reveals of whichever round it gets and carries its own source chip and caption.
  const settledRounds = auctions.filter((a) => a.settled && a.bestBidder && a.clearingBps !== null);
  const lastSettled =
    settledRounds.find((a) => a.orderHash !== featured?.orderHash) ?? settledRounds[0] ?? null;

  const recent = auctions.slice(0, 5);

  return (
    <main className="relative" style={pageBand("/art/header-board.webp")}>
      {/* THE ONE LINE. Sans, and the largest type on the page after the countdown -- which
          outranks it on purpose: the sentence is what this is, the countdown is what is
          happening, and on a live venue the second one is why you are still reading. */}
      <h1 className="max-w-3xl text-[1.5rem] leading-[1.25] font-semibold text-ink sm:text-[1.875rem]">
        The right to fill an order, sold by sealed bid. The winner pays the runner-up&rsquo;s
        price.
      </h1>

      <WalletBar className="mt-5 mb-4" />

      {loading && !featured && (
        <Loading
          what="Reading the Book"
          detail={<>One eth_call per round against Base&rsquo;s public endpoint, plus a log scan for the bidders. The public RPC rate-limits, so this backs off and retries rather than hammering it — if it fails entirely the page falls back to the checked-in snapshot and says so.</>}
        />
      )}

      {/* TWO DIFFERENT FACTS, TWO DIFFERENT VOICES.
          A failed read with nothing to fall back on is a broken page and should look like
          one. A failed read that the checked-in snapshot covered is a page showing history
          instead of live data -- worth saying plainly, not worth a red bar. /rounds already
          made this distinction after e7a7c46; the board still shouted either way, which
          meant the loudest thing on screen was frequently the least important.

          NEITHER VOICE SAYS "NOBODY BID". A read that failed is not a round with no bids,
          and the two must never collapse into one sentence -- BidCards keeps the same
          distinction one level down, where `bids == null` means the log scan failed. */}
      {error && (
        <p
          className={[
            "mb-4 border-l-2 px-3 py-2 text-sm",
            featured
              ? "border-amber bg-amber-soft text-amber"
              : "border-brick bg-brick-soft text-ink-soft",
          ].join(" ")}
        >
          {featured
            ? `The live chain read failed, so this is the last state read rather than the chain right now: ${error}`
            : `Could not reach the chain: ${error}`}
        </p>
      )}

      {!loading && !featured && (
        <div className="card">
          <p className="text-ink-soft">No round has been opened on this Book yet.</p>
          <p className="mt-2 text-sm text-ink-faint">
            Rounds are opened by a keeper, and this page has no way to tell whether one is
            running right now. It says so rather than showing a spinner.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => setDemo(true)} className="btn btn-secondary">
              Watch a simulated round
            </button>
            <Link href="/faq#rehearsal" className="btn btn-tertiary">
              what a rehearsal is
            </Link>
          </div>
        </div>
      )}

      {featured && (
        <Swap showing={`${featured.orderHash}-${livePhase(featured, head)}`}>
          <div>
            {/* THE BIGGEST THING ON THE PAGE, and above the split rather than inside it.
                It is one fact about the whole round, so it spans the whole width; the two
                columns below it are the round and the way in. */}
            <Countdown a={featured} head={head} />

            {/* 1.4fr / 1fr: the round is wider because it holds four bid cards and a phase
                track, and the bid panel is a single column of controls. ON A PHONE THE BID
                PANEL COMES FIRST, which is the reason for the `order` classes rather than
                simply writing them in this sequence -- a visitor who has read the countdown
                should reach the act next, not scroll a phase track to find it. */}
            <div className="mt-4 grid gap-4 lg:grid-cols-[1.4fr_1fr]">
              <article className="card order-2 lg:order-1">
                <div className="card-head">
                  <span className="tnum">
                    Round {num(featured.round)} · {featured.orderHash.slice(0, 10)}…
                  </span>
                  <span className="flex flex-wrap items-center gap-2">
                    <PhaseChip phase={livePhase(featured, head)} settled={featured.settled} />
                    {!live && <span className="chip">most recent — nothing live</span>}
                  </span>
                </div>

                <PhaseTrack a={featured} head={head} />
                <BidCards a={featured} />
                <Stats a={featured} head={head} />
                <ReplayCheck a={featured} />

                {/* THE THESIS, AND THE LINT. Every figure on this site names what produced
                    it, and scripts/lint-provenance.mjs fails the build over a missing "What
                    produced this". It is also the whole claim of the product, so it is the
                    one caption the strip-the-explanation pass does not touch. */}
                <p className="card-foot">
                  <strong className="font-medium text-ink-soft">What produced this:</strong>{" "}
                  {demo ? (
                    <>
                      <code className="font-mono">web/lib/simulate.ts</code>, stepping one scripted
                      round forward a block every 0.4 s. The phase, the clearing price and the
                      winner are computed from the block shown by the same functions the live board
                      uses — the simulation supplies the reveals, not the rules.
                    </>
                  ) : (
                    <>
                      the <code className="font-mono">GlasshouseBook</code> contract on Base, read at
                      block <span className="tnum">{num(head)}</span>. The phase is computed here
                      against that same block — the contract stores no phase, it compares{" "}
                      <code className="font-mono">block.number</code> against boundaries written
                      when the round opened, so any honest reader has to do the same.
                    </>
                  )}
                </p>
              </article>

              <div className="order-1 lg:order-2">
                {/* Bidding is cut out entirely during the rehearsal: a commitment is
                    hash(bps, salt, ORDER HASH), and a synthetic hash names no auction in the
                    Book, so it would bind to nothing and could never be revealed. A disabled
                    button still invites the click. */}
                {demo ? (
                  <div className="card">
                    <div className="card-head">
                      <span>Your bid</span>
                      <span className="chip chip-warn">rehearsal</span>
                    </div>
                    <p className="text-sm text-ink-soft">
                      <strong className="font-medium text-amber">
                        Bidding is off during the rehearsal.
                      </strong>{" "}
                      A sealed bid commits to this round&rsquo;s <em>order hash</em>, and the
                      rehearsal&rsquo;s hashes name no auction in the Book.
                    </p>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setDemo(false)}
                        className="btn btn-secondary"
                      >
                        Switch to the real chain
                      </button>
                      <Link href="/faq#rehearsal" className="btn btn-tertiary">
                        what a rehearsal is
                      </Link>
                    </div>
                  </div>
                ) : (
                  <BidPanel auction={featured} head={head} />
                )}
              </div>
            </div>
          </div>
        </Swap>
      )}

      {/* ---- BELOW THE INSTRUMENT ------------------------------------------------------
          Two panels and one door, in the order a reader wants them: the last print, then
          the last five rounds, then everything. Nothing here explains the mechanism. */}

      {lastSettled ? (
        <section className="mt-10">
          <h2 className="text-base font-semibold text-ink">
            {featured ? "Last settled" : "The last round this Book settled"}
          </h2>
          {/* WHY THIS IS THE OPENING SHOT WHEN NOTHING IS LIVE. A venue between auctions
              shows the last print; it does not show an empty frame and hope. The reel is
              playback of reveals that genuinely happened, and it carries its own source
              chip and "what produced this" caption, so it is honest at any width. */}
          <div className="mt-3 max-w-3xl">
            <SettlementReel a={lastSettled} head={head} source={source} />
          </div>
        </section>
      ) : null}

      {recent.length > 0 ? (
        <section className="mt-10">
          <h2 className="text-base font-semibold text-ink">Recent rounds</h2>
          {/* A <table> has to sit inside a <figure data-src> whose body contains the words
              "What produced this" or scripts/lint-provenance.mjs fails the build. */}
          <figure data-src={source} className="mt-3">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-[0.82rem]">
                <thead>
                  <tr className="border-b border-rule">
                    <th className="px-3 py-2 font-mono text-[0.6875rem] font-normal uppercase tracking-[0.12em] text-ink-faint">
                      round
                    </th>
                    <th className="px-3 py-2 font-mono text-[0.6875rem] font-normal uppercase tracking-[0.12em] text-ink-faint">
                      phase
                    </th>
                    <th className="px-3 py-2 text-right font-mono text-[0.6875rem] font-normal uppercase tracking-[0.12em] text-ink-faint">
                      clearing
                    </th>
                    <th className="px-3 py-2 font-mono text-[0.6875rem] font-normal uppercase tracking-[0.12em] text-ink-faint">
                      winner
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {recent.map((a) => {
                    const p = livePhase(a, head);
                    return (
                      <tr key={a.orderHash} className="row-link border-b border-rule">
                        <td className="tnum px-3 py-2">
                          <a
                            href={`/r/${a.orderHash}`}
                            className="text-glass underline decoration-rule underline-offset-2 hover:decoration-glass"
                          >
                            {num(a.round)}
                          </a>
                        </td>
                        <td className="px-3 py-2 text-ink-soft">
                          {a.settled ? `${p} · settled` : p}
                        </td>
                        {/* NOT A ZERO. `clearingBps` is null before settle() runs, which is
                            a different fact from "cleared at 0", and an em dash is the only
                            honest rendering of a number that does not exist yet. */}
                        <td className="tnum px-3 py-2 text-right text-ink">
                          {a.clearingBps === null ? "—" : `${a.clearingBps} bps`}
                        </td>
                        <td className="px-3 py-2">
                          {a.bestBidder ? (
                            <AddressLink
                              addr={a.bestBidder}
                              role={
                                a.filled && a.filledBy?.toLowerCase() === a.bestBidder.toLowerCase()
                                  ? "filled"
                                  : a.settled
                                    ? "winner"
                                    : "leading"
                              }
                              mark={false}
                            />
                          ) : (
                            <span className="text-ink-faint">
                              {a.revealedCount == null ? "not read" : "no reveals"}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <figcaption className="mt-3 text-[0.78rem] leading-relaxed text-ink-faint">
              <span className="text-ink-soft">What produced this:</span>{" "}
              {source === "sim" ? (
                <>
                  <code className="font-mono">web/lib/simulate.ts</code> — a scripted rehearsal.
                  Nothing in this table was read from a chain.
                </>
              ) : (
                <>
                  the <code className="font-mono">GlasshouseBook</code> contract on Base, read at
                  block <span className="tnum">{num(head)}</span> by{" "}
                  <code className="font-mono">web/lib/chain.js</code>. Phase is computed here
                  against that block. <strong className="font-medium">Winner</strong> is the highest
                  revealed bid: it reads &ldquo;leading&rdquo; until the round settles, because a
                  later reveal can still displace it, and &ldquo;not read&rdquo; when the log scan
                  for that round failed — which is not the same as no reveals.
                </>
              )}
            </figcaption>
          </figure>
          <Link href="/rounds" className="btn btn-secondary mt-4">
            Every round so far
          </Link>
        </section>
      ) : null}

      {/* The round on screen already has a 44px reveal button of its own, so the strip would
          be the same act twice -- and two candidate primaries on one view. */}
      <RevealStrip
        head={head}
        auctions={demo ? [] : auctions}
        excludeOrderHash={featured?.orderHash ?? null}
      />
    </main>
  );
}

/**
 * `.chip` variants, not the hand-rolled `border px-2 py-0.5 font-mono text-[0.6875rem]
 * uppercase` span this used to be -- the exact shape DESIGN.md F-3 records as "a chip that
 * looked identical to a button". A phase is a label; it is not clickable and now does not
 * look it.
 */
function PhaseChip({ phase, settled }: { phase: string; settled: boolean }) {
  const tone =
    phase === "reveal" ? "chip-warn" : phase === "exclusive" ? "chip-live" : "";
  return (
    <span className="flex gap-2">
      <span className={`chip ${tone}`}>{phase}</span>
      {settled && <span className="chip chip-live">settled</span>}
    </span>
  );
}
