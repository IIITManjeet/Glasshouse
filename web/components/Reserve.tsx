"use client";

import { useMemo, useState } from "react";
import type { Auction, Source } from "@/lib/useAuctions";
import { reserveWindow } from "@/lib/reserve-window";
import { recommendReserve } from "@/lib/reserve-rule";

/**
 * The next auction's reserve. ui-spec.md section S5.
 *
 * There is no maker UI in this product and there should not be one: the maker is us, and
 * a form that wraps a `cast send` in three buttons is a worse tool than the `cast send`.
 * So this is an ADVISOR. It reads the rounds already on the board, runs the same pure
 * function the offline advisor runs (`lib/reserve-rule.js`, byte-identical, imported not
 * copied), and prints the command with the number filled in.
 *
 * The two italic sentences below are mandatory text from docs/design/subgraph-design.md
 * section 7.2. They are the honest boundary of the recommendation and they are not
 * optional decoration: the number is a heuristic splitting a known-safe value from a
 * known-unsafe one, and a maker who reads it as an optimal reserve has been misled by
 * this panel.
 */

const num = (n?: number | null) =>
  n === null || n === undefined || Number.isNaN(n) ? "—" : n.toLocaleString("en-US");

/** The reason codes, glossed. ui-spec.md S5 prints the constant AND the sentence. */
const REASONS: Record<string, string> = {
  NO_HISTORY: "no settled auctions yet",
  COMPETITION_PRICES: "competition set the price; the reserve was inert",
  NO_REVEALS:
    "most auctions had no reveal, and the Book cannot tell no interest from a reserve that excluded everyone",
  WINNER_BELOW_FLOOR: "every winner bid under the floor",
  THIN_COMPETITION: "the reserve is doing the work, not competition",
};

const BOOK = "0xc4ea91Fe700918220423ac307C6B1c59650FFbfe";
const ROUTER = "0x5c3baE054e8b4915a13726B397b1AeA864247DBf";

export function ReservePanel({ auctions, source, head }: { auctions: Auction[]; source: Source; head: number }) {
  const [copied, setCopied] = useState(false);
  const simulated = source === "sim";

  // `head` is passed in rather than read here so the window and the block this panel names
  // are the same number. The filter is `revealEnd < head` -- the design doc's Q3 window
  // (subgraph-design.md section 7.2) -- which is what the advisor uses too.
  const { rec, window: win } = useMemo(() => {
    const w = reserveWindow(auctions, head);
    return { rec: recommendReserve(w.rows, { floorBps: 50, maxBps: 500, K: 8 }), window: w };
  }, [auctions, head]);

  const cast =
    `cast send ${BOOK} \\\n` +
    `  "open(bytes32,address,address,uint40,uint40,uint40,uint24,uint24,uint128)" \\\n` +
    `  $ORDER_HASH ${ROUTER} $TOKEN_IN 30 30 15 ${rec.bps} 500 0 \\\n` +
    `  --rpc-url $BASE_RPC_URL --private-key $MAKER_KEY`;

  return (
    <figure data-src={simulated ? "sim" : "rule"} className="border border-rule bg-raised rounded-card shadow-card">
      <figcaption className="flex flex-wrap items-center justify-between gap-2 border-b border-rule px-4 py-2.5">
        <span className="font-mono text-[0.72rem] uppercase tracking-[0.14em] text-ink">
          Next auction · reserve
        </span>
        <span
          className={`border px-2 py-0.5 font-mono text-[0.64rem] uppercase tracking-[0.12em] ${
            simulated ? "border-amber text-amber" : "border-glass text-glass"
          }`}
        >
          Computed here · lib/reserve-rule.js over {num(rec.n)} settled{" "}
          {simulated ? "· simulated rounds" : "rounds"}
        </span>
      </figcaption>

      <div className="grid gap-x-8 gap-y-4 px-4 py-4 sm:grid-cols-3">
        <div>
          <div className="font-mono text-[0.66rem] uppercase tracking-[0.12em] text-ink-faint">
            recommended reserve
          </div>
          <div className="tnum mt-1 text-2xl text-glass">{num(rec.bps)} bps</div>
        </div>
        <div>
          <div className="font-mono text-[0.66rem] uppercase tracking-[0.12em] text-ink-faint">band</div>
          <div className="tnum mt-1 text-[0.9rem] text-ink">
            {num(rec.band[0])} – {num(rec.band[1])} bps
          </div>
          <div className="mt-1 text-[0.76rem] text-ink-faint">
            {rec.band[0] === rec.band[1]
              ? "the window supports only the floor"
              : "floor to one below the lowest winner seen"}
          </div>
        </div>
        <div>
          <div className="font-mono text-[0.66rem] uppercase tracking-[0.12em] text-ink-faint">reason</div>
          <div className="mt-1 font-mono text-[0.8rem] text-ink">{rec.reason}</div>
          <div className="mt-1 text-[0.76rem] text-ink-faint">{REASONS[rec.reason] ?? ""}</div>
        </div>
      </div>

      <div className="border-t border-rule px-4 py-3 text-[0.8rem] text-ink-soft">
        <span className="font-mono text-[0.66rem] uppercase tracking-[0.12em] text-ink-faint">window</span>{" "}
        <span className="tnum">
          {num(rec.n)} of K = 8 · {num(rec.strong)} contested · {num(rec.weak)} thin · {num(rec.empty)} with no
          reveal · {num(rec.unrevealed)} envelopes never opened
        </span>
        {rec.minBest !== null && (
          <>
            {" · "}
            <span className="tnum">lowest winning bid seen {num(rec.minBest)} bps</span>
          </>
        )}
        {win.unreadable > 0 && (
          <div className="mt-1 text-amber">
            {num(win.unreadable)} settled round{win.unreadable === 1 ? "" : "s"} left out: their reveals could
            not be read. Not counted as zero-reveal rounds, which would have pushed this recommendation on the
            strength of a network error.
          </div>
        )}
        <div className="mt-1 text-ink-faint">
          Bidder breakdown (team / invited / unknown) is not shown: that list is ours and lives in the
          subgraph, which this panel does not read — its rows come from the board&rsquo;s chain read, and a
          chain read cannot answer it. <code className="font-mono">scripts/reserve-advisor.mjs</code> queries
          the published subgraph and does report the split.
        </div>
      </div>

      <p className="border-t border-rule px-4 py-3 text-[0.82rem] leading-relaxed text-ink-soft italic">
        The low end is the staleness floor, below which running the auction is worse than posting a limit
        order. The high end is one below the lowest winning bid in the window, above which the reserve would
        have excluded a winner we actually had. This is a heuristic that splits a known-safe value from a
        known-unsafe one. It is not an optimal-reserve computation; that needs the bidders&rsquo; value
        distribution, which a handful of auctions does not estimate.
      </p>

      <div className="border-t border-rule px-4 py-3">
        <div className="mb-2 flex items-center justify-between gap-3">
          <span className="font-mono text-[0.66rem] uppercase tracking-[0.12em] text-ink-faint">
            open the next round
          </span>
          <button
            type="button"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(cast);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              } catch {
                window.prompt("Copy this:", cast);
              }
            }}
            className="rounded-control border border-rule px-2 py-1 font-mono text-[0.66rem] uppercase tracking-[0.12em] text-ink-soft hover:border-glass hover:text-glass"
          >
            {copied ? "Copied ✓" : "Copy"}
          </button>
        </div>
        <pre className="overflow-x-auto bg-sunk p-3 font-mono text-[0.74rem] leading-relaxed text-ink-soft">
          {cast}
        </pre>
      </div>

      <p className="border-t border-rule px-4 py-3 text-[0.78rem] leading-relaxed text-ink-faint">
        <strong className="font-medium text-ink-soft">What produced this:</strong>{" "}
        <code className="font-mono">recommendReserve()</code> in{" "}
        <code className="font-mono">web/lib/reserve-rule.js</code>, the same pure function{" "}
        <code className="font-mono">scripts/reserve-advisor.mjs</code> runs offline, over the settled rounds
        on this board — at most the newest K = 8, floor 50 bps, ceiling 500. The window rows are derived from
        raw contract fields by <code className="font-mono">web/lib/reserve-window.js</code>, which
        transliterates the subgraph&rsquo;s own mapping (<code className="font-mono">subgraph/src/helpers.ts</code>)
        because this panel&rsquo;s rows come from the board&rsquo;s chain read rather than from the index.{" "}
        {simulated
          ? "The rounds it read are simulated, so this number is a rehearsal of the advice, not advice."
          : "The three regime thresholds come from test/ReserveMatrix.t.sol, not from a guess."}
      </p>
    </figure>
  );
}
