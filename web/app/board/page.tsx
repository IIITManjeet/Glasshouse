"use client";

import Link from "next/link";
import { livePhase, type Auction } from "@/lib/useAuctions";
import { useBoard } from "@/components/BoardProvider";
import { PhaseTrack, BidCards, Stats, ReplayCheck } from "@/components/Auction";
import { WalletBar } from "@/components/WalletBar";
import { BidPanel, RevealStrip } from "@/components/BidPanel";
import { Loading, Swap } from "@/components/Loading";

const num = (n?: number | null) =>
  n === null || n === undefined || Number.isNaN(n) ? "—" : n.toLocaleString("en-US");

/**
 * The instrument, at its own URL.
 *
 * It used to be a section of the landing page, which forced one URL to be both the pitch
 * and the tool. That is why the landing page could not be short and the board could not be
 * deep: every addition to either made the other worse, and there was no link to send
 * somebody that meant "here is the thing running".
 *
 * Now /board is the tool. Everything a participant needs is here and nothing else is: the
 * phase track, the bids, the stats, the replay check and the panel that lets them join the
 * round they are watching. The argument lives at /evidence and the pitch at /.
 *
 * The source line is not repeated here -- it is in the layout's status bar, on every page,
 * which is what makes any screenshot of this page carry its own provenance.
 */
export default function BoardPage() {
  const { auctions, head, source, loading, error, demo, setDemo } = useBoard();

  const live = auctions.find((a) => livePhase(a, head) !== "open");
  const featured: Auction | undefined = live ?? auctions[0];

  return (
    <main>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="panel-id">GH 01 · Book 0xc4ea…FFbf · Base 8453</p>
          <h1 className="mt-2">The board</h1>
          {/* `lede` sets the prose face inside the .tape register. A terminal shows VALUES in
              monospace; its documentation is not set in monospace either, and this sentence
              is documentation. See DESIGN.md F-5 -- the register stays, prose leaves it. */}
          <p className="lede mt-3 max-w-xl text-ink-soft">
            The round happening right now, and the panel to join it. Phases are counted in
            blocks, because blocks are what the contract enforces — seconds are an estimate.
          </p>
        </div>
        <Link href="/rounds" className="text-sm text-glass underline underline-offset-2">
          Every round so far →
        </Link>
      </div>

      <WalletBar className="mb-4" />

      {loading && !featured && (
        <Loading
          what="Reading the Book"
          detail={<>One eth_call per round against Base&rsquo;s public endpoint, plus a log scan for the bidders. The public RPC rate-limits, so this backs off and retries rather than hammering it — if it fails entirely the page falls back to the checked-in snapshot and says so.</>}
        />
      )}

      {error && (
        <p className="mb-4 border-l-2 border-brick bg-brick-soft px-3 py-2 text-sm text-ink-soft">
          Could not reach the chain: {error}
        </p>
      )}

      {!loading && !featured && (
        <div className="border border-rule bg-raised rounded-card shadow-card p-6">
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
        <Swap showing={`${featured.orderHash}-${livePhase(featured, head)}`}>
        <article className="border border-rule bg-raised rounded-card shadow-card">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-rule px-4 py-2">
            <span className="panel-id">GH 02 · Live round</span>
            <span className="panel-id">Commit 30 / Reveal 30 / Exclusive 15</span>
          </div>
          <div className="p-4 sm:p-5">
          <header className="mb-4 flex flex-wrap items-baseline gap-3">
            <h2 className="tnum text-base font-medium">
              Round {featured.round ?? "—"} · {featured.orderHash.slice(0, 10)}…
            </h2>
            <PhaseChip phase={livePhase(featured, head)} settled={featured.settled} />
            {!live && <span className="text-xs text-ink-faint">most recent — nothing is live right now</span>}
          </header>

          <PhaseTrack a={featured} head={head} />
          <BidCards a={featured} />
          <Stats a={featured} head={head} />
          <ReplayCheck a={featured} />

          {/* Bidding is cut out entirely during the rehearsal: a commitment is
              hash(bps, salt, ORDER HASH), and a synthetic hash names no auction in the
              Book, so it would bind to nothing and could never be revealed. A disabled
              button still invites the click. */}
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
                <code className="font-mono">web/lib/simulate.ts</code>, stepping one scripted round
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
          </div>
        </article>
        </Swap>
      )}

      <nav className="mt-8 border-t border-rule pt-5 text-sm">
        <Link href="/evidence" className="text-glass underline underline-offset-2">
          Check the mechanism →
        </Link>
        {" · "}
        <Link href="/rounds" className="text-glass underline underline-offset-2">
          Every round
        </Link>
      </nav>

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
