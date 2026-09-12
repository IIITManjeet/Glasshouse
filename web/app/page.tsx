"use client";

import Link from "next/link";
import { livePhase } from "@/lib/useAuctions";
import { useBoard } from "@/components/BoardProvider";
import { Mechanism } from "@/components/Mechanism";
import { Settlement } from "@/components/Settlement";
import { LoadingBar, Swap } from "@/components/Loading";

const num = (n?: number | null) =>
  n === null || n === undefined || Number.isNaN(n) ? "—" : n.toLocaleString("en-US");

/**
 * The front door, and only the front door.
 *
 * It used to be the landing page AND the live board AND four feature bands AND the
 * mechanism, which meant neither job could be done properly: the pitch could not be short
 * because the tool was inside it, and the tool could not be deep because the pitch was on
 * top of it. There was also no URL that meant "here is the thing running".
 *
 * Now: the claim, proof that it is alive, how it works, and three doors. The instrument is
 * at /board, the evidence at /evidence, the history at /rounds.
 *
 * The live strip here is deliberately READ-ONLY -- a pulse, not a panel. It exists to show
 * a stranger the mechanism is running before asking them to care, and it links to the board
 * rather than trying to be one. Bidding, phase tracks and reveal deadlines belong where a
 * participant is, not where a visitor arrives.
 */
export default function Home() {
  const { auctions, head, source, loading, demo, setDemo } = useBoard();

  const live = auctions.find((a) => livePhase(a, head) !== "open");
  const featured = live ?? auctions[0];
  const phase = featured ? livePhase(featured, head) : null;

  // THE ROUND THE HEADLINE IS ABOUT.
  //
  // The three numbers below used to be the string literals "400 bps", "250 bps" and
  // "150 bps" -- correct, because they describe the real mainnet fill, and unsourced,
  // because nothing connected them to it. On a site that fails its own build when a figure
  // lacks a "what produced this" line, the first three numbers a visitor sees were the
  // only ones exempt. They were an illustration that happened to be true.
  //
  // This finds a settled round with a winner AND a runner-up, because a round with one
  // bidder clears at the reserve and demonstrates nothing about second price. The fill at
  // 250 is that round. If none is available the static example is shown and SAYS it is an
  // example, rather than quietly implying a chain read.
  const demonstration =
    auctions.find(
      (a) => a.settled && a.bestBidder && a.clearingBps !== null && (a.bids?.length ?? 0) > 1,
    ) ?? null;
  const shown = demonstration
    ? {
        best: demonstration.bestBps,
        clearing: demonstration.clearingBps as number,
        toMaker: demonstration.bestBps - (demonstration.clearingBps as number),
      }
    : null;

  return (
    <main>
      <section className="relative -mx-5 px-5 pt-10 pb-16 sm:pt-16 sm:pb-20">

        <p className="font-mono text-[0.7rem] uppercase tracking-[0.14em] text-ink-faint">
          A custom 1inch SwapVM instruction · live on Base
        </p>

        <h1 className="mt-5 max-w-4xl font-display text-4xl leading-[1.1] font-semibold sm:text-5xl lg:text-6xl">
          Who fills your order should be decided by{" "}
          <em className="text-glass">what it is worth</em>, not by who is fastest.
        </h1>

        <p className="mt-6 max-w-2xl text-lg leading-relaxed text-ink-soft">
          SwapVM ships two ways to allocate the right to fill an order. One asks who you are.
          The other asks what time it is. Glasshouse asks what you will pay — a sealed-bid,
          second-price auction, settled on chain.
        </p>

        <div className="mt-10 flex flex-wrap gap-x-12 gap-y-6">
          {(
            [
              ["highest bid", shown ? `${shown.best} bps` : "400 bps", "wins the right to fill", "text-glass"],
              ["pays", shown ? `${shown.clearing} bps` : "250 bps", "the runner-up's bid", "text-amber"],
              ["to the maker", shown ? `${shown.toMaker} bps` : "150 bps", "the difference", "text-ink"],
            ] as const
          ).map(([label, value, note, tone]) => (
            <div key={label}>
              <div className="font-mono text-[0.66rem] uppercase tracking-[0.12em] text-ink-faint">
                {label}
              </div>
              <div className={`tnum mt-1.5 text-4xl sm:text-5xl ${tone}`}>{value}</div>
              <div className="mt-1 text-[0.82rem] text-ink-faint">{note}</div>
            </div>
          ))}
        </div>
        <p className="mt-3 text-[0.78rem] text-ink-faint">
          {shown && demonstration
            ? source === "sim"
              ? "From the simulated round below. Nothing here was read from a chain."
              : `From ${
                  demonstration.round === null || demonstration.round === undefined
                    ? `order ${String(demonstration.orderHash).slice(0, 10)}…`
                    : `round ${num(demonstration.round)}`
                } on Base, settled and filled. The chart below is that round.`
            : "An example of the rule, not a round. The chart below carries the real numbers when a settled round is loaded."}
        </p>

        {/* THE ONE PICTURE THIS PROJECT IS ALLOWED.
            Not an illustration of the word "auction" -- the two previous art directions
            were exactly that and both were withdrawn (art-prompts/README.md). This is the
            round itself: every bid on one scale of basis points in commit order, with the
            clearing price drawn at the RUNNER-UP's height, passing through the winner's
            column without touching it. It carries its own source chip and caption and is
            linted like every other figure. DESIGN.md asked for this under "Still open". */}
        {demonstration ? (
          <div className="mt-10 max-w-3xl">
            <Settlement a={demonstration} head={head} source={source} />
          </div>
        ) : null}

        {/* The pulse. Read-only by design: it says "this is running", then gets out of the
            way and sends you to the tool. */}
        <div className="mt-11 max-w-2xl border border-rule bg-raised rounded-card shadow-card">
          <Link href="/board" className="group block px-5 py-4">
            <Swap showing={loading && !featured ? "loading" : featured ? "live" : "empty"}>
            {loading && !featured ? (
              <span className="flex flex-col gap-2">
                <span className="font-mono text-[0.7rem] uppercase tracking-[0.12em] text-ink-faint">
                  Reading the Book
                </span>
                <LoadingBar className="max-w-[14rem]" />
              </span>
            ) : featured ? (
              <span className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <span
                  className={[
                    "border px-2 py-0.5 font-mono text-[0.64rem] uppercase tracking-[0.12em]",
                    phase === "commit" ? "border-rule bg-sunk text-ink-soft"
                      : phase === "reveal" ? "border-amber bg-amber-soft text-amber"
                        : phase === "exclusive" ? "border-glass bg-glass-soft text-glass"
                          : "border-rule text-ink-faint",
                  ].join(" ")}
                >
                  {phase}
                </span>
                <span className="tnum text-sm text-ink">
                  Round {num(featured.round)}
                </span>
                <span className="tnum text-sm text-ink-faint">
                  {featured.committedCount} sealed
                  {featured.revealedCount !== null && ` · ${featured.revealedCount} opened`}
                  {featured.clearingBps !== null && (
                    <span className="text-glass"> · clearing {featured.clearingBps} bps</span>
                  )}
                </span>
                <span className="ml-auto text-sm text-glass group-hover:underline">
                  Open the board →
                </span>
              </span>
            ) : (
              <span className="flex flex-wrap items-center gap-3 text-sm">
                <span className="text-ink-soft">No round is open right now.</span>
                <button
                  type="button"
                  onClick={(e) => { e.preventDefault(); setDemo(true); }}
                  className="text-glass underline underline-offset-2"
                >
                  Watch a simulated one
                </button>
              </span>
            )}
            </Swap>
          </Link>
          <p className="border-t border-rule px-5 py-2.5 text-[0.74rem] text-ink-faint">
            {source === "sim"
              ? "Simulated — the status line above says so on every page."
              : "Read from the GlasshouseBook contract on Base. Phase computed here, against the block in the status line."}
          </p>
        </div>
      </section>

      <div>
        <section className="border-t border-rule py-14 sm:py-16">
          <p className="font-mono text-[0.68rem] uppercase tracking-[0.14em] text-glass">
            End to end
          </p>
          <h2 className="mt-3 mb-8 max-w-2xl font-display text-2xl leading-snug font-semibold sm:text-3xl">
            One round, from sealed to paid.
          </h2>
          <Mechanism />
        </section>
      </div>

      <div>
        <section className="border-t border-rule py-14">
          <h2 className="max-w-2xl font-display text-2xl leading-snug font-semibold sm:text-3xl">
            Three ways in.
          </h2>
          <div className="mt-8 grid gap-px border border-rule bg-rule sm:grid-cols-3">
            {[
              ["/board", "The board", "Watch a round run, and bid in it if one is open."],
              ["/evidence", "The evidence", "A finished receipt, the three gates compared, the reserve advisor."],
              ["/rounds", "The history", "Every round this Book has opened, newest first."],
            ].map(([href, title, note]) => (
              <Link key={href} href={href} className="group bg-raised p-5 hover:bg-glass-soft">
                <div className="font-display text-xl font-semibold text-ink group-hover:text-glass">
                  {title}
                </div>
                <p className="mt-2 text-sm text-ink-soft">{note}</p>
                <div className="mt-4 font-mono text-[0.66rem] uppercase tracking-[0.12em] text-glass">
                  Open →
                </div>
              </Link>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
