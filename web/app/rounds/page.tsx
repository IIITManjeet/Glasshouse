"use client";

import { useMemo, useState } from "react";
import { useBoard } from "@/components/BoardProvider";
import { pageBand } from "@/components/PageBand";
import { SourceChip } from "@/components/Auction";
import { OpenNow } from "@/components/OpenNow";
import { RoundsTable } from "@/components/RoundsTable";
import {
  ROUND_FILTERS,
  RoundsFilterTabs,
  unreadableCount,
  type RoundFilterId,
} from "@/components/RoundsFilter";
import { Loading } from "@/components/Loading";

/**
 * The rounds/history view.
 *
 * A client component, not a server one reading data at build time: `next.config.mjs` sets
 * `output: "export"`, so there is no server to do that read on, and no `generateStaticParams`
 * / dynamic route either -- this whole page is one static shell that fetches after it loads
 * in the visitor's own browser, same as the live board.
 *
 * useBoard() already IS the "read history" path as well as the "watch live" path: its
 * only source today is a direct eth_call per round, falling back to the checked-in
 * snapshot. That is a CHOICE, not a limitation -- the subgraph has been published to The
 * Graph Network since 2026-09-11 and answers queries -- and the reason is in
 * useAuctions.ts: a phase that ticks needs the chain head, and an indexer is a block or
 * two behind it. This page does not invent a second data path -- it renders the same board
 * data as a table instead of cards, plus the provenance the live board doesn't need
 * repeated per-card.
 *
 * WHY THIS PAGE IS A TILE ON TOP OF A LEDGER, AND WHY IT STAYS SIX ROWS LONG.
 *
 * It used to be a table and nothing else, which made it read as an export rather than as a
 * venue -- the question a visitor arrives with ("can I bid right now?") was answerable only
 * by reading a phase word in row one. <OpenNow> answers it above the fold, at the size the
 * answer deserves, and the ledger below is what it should have been all along: history.
 *
 * THE ROW COUNT IS NOT A BUG AND MUST NOT BE "FIXED". useAuctions.ts reads `limit: 6`. Each
 * round costs an eth_call plus a log scan against Base's rate-limited public endpoint, and
 * BoardProvider.tsx records that -32016 "already cost this project a day". Six honest rows
 * beat twelve that sometimes fail to load, so the page is DESIGNED for six: one promoted
 * tile, a single strip of filter counts, and a line under the table that says plainly this
 * is the recent tail and where the rest lives. No chart, either -- six points is not a
 * series, and a chart drawn from six of them is the decoration-shaped-like-data DESIGN.md
 * calls worse than a wrong number.
 */

/** The count in words, so the line under the table reads as a sentence rather than as a
 *  variable. Digits past twelve, where the word stops being shorter than the number. */
const COUNT_WORDS = [
  "no", "one", "two", "three", "four", "five", "six",
  "seven", "eight", "nine", "ten", "eleven", "twelve",
];
const countWord = (n: number) => COUNT_WORDS[n] ?? n.toLocaleString("en-US");

/** Published to The Graph Network; the id is the one components/Footer.tsx links. */
const SUBGRAPH_ID = "FPQdiZTAnR8ac6grgAF2x49bWqwDh87RzqUgQxAvoY2y";
/** VERIFIED AGAINST README.md (line 26: "deployed at block 50,965,408") and against
 *  subgraph/subgraph.yaml's `startBlock: 50965408` and
 *  ignition/deployments/chain-8453/journal.jsonl's receipt blockNumber. All three agree. */
const DEPLOY_BLOCK = 50_965_408;
export default function RoundsPage() {
  const { auctions, head, source, isFork, loading, error, refresh } = useBoard();

  // The selected filter lives in state rather than the URL. A shareable /rounds?filter=
  // would be better and is a deliberate omission for now: `useSearchParams` forces a
  // Suspense boundary in a static export, and the one on /evidence already cost this
  // project six prerendered figures down to two before it was caught
  // (see the note at the top of app/evidence/page.tsx). Not worth re-learning that here
  // for a filter whose default shows everything.
  const [filterId, setFilterId] = useState<RoundFilterId>("all");
  const filter = ROUND_FILTERS.find((f) => f.id === filterId) ?? ROUND_FILTERS[0];
  const shown = useMemo(
    () => auctions.filter((a) => filter.match(a, head)),
    [auctions, head, filter],
  );
  const unreadable = unreadableCount(auctions);

  // The line under the table names its own source in four words, because that line is the
  // one a reader takes away and "read from the chain" is false in three of the four cases.
  const sourceClause =
    source === "chain"
      ? isFork
        ? "read from a local fork of Base, not mainnet"
        : "read from the chain"
      : source === "snapshot"
        ? "read from the checked-in snapshot, not live"
        : source === "sim"
          ? "replayed by the rehearsal and read from no chain at all"
          : "not read from anywhere yet";

  const caption =
    source === "chain"
      ? `useBoard() in web/lib/useAuctions.ts, reading GlasshouseBook (0xc4ea91Fe700918220423ac307C6B1c59650FFbfe) on Base directly over eth_call -- once per round listed in public/data/rounds.js -- as of block ${head.toLocaleString("en-US")}. Not the subgraph: it is published and served, but a phase that ticks needs the chain head, and an indexer is a block or two behind it.`
      : source === "snapshot"
        ? `public/data/snapshot.js, generated by scripts/make-snapshot.mjs from GlasshouseBook logs on Base, as of block ${head.toLocaleString("en-US")}. The live chain read that normally powers this page ${error ? "FAILED this session" : "returned nothing this session"}, so this is history rather than a live view -- the source chip above says so, not just this line.`
        : source === "sim"
          ? // The rehearsal reaches this page too, because it drives the same shared board.
            // Without this arm the caption below a table of simulated rounds read "nothing
            // has loaded yet", which is both wrong and the wrong KIND of wrong.
            `web/lib/simulate.js, replaying scripted rounds through the contract's own clearing rule at one block per 0.4 s. NOTHING HERE WAS READ FROM A CHAIN: the block numbers count from a chosen origin and are not Base blocks, and the addresses belong to no one. Turn the rehearsal off in the header to see the real rounds.`
          : "Nothing has loaded yet: no chain read has returned and this build carries no fallback snapshot.";

  return (
    <main className="relative mx-auto max-w-[62rem] px-4 py-10 sm:px-6" style={pageBand("/art/header-rounds.webp")}>
      {/* ONE LINE OF INTRO. The old three sentences plus a "← live board" link were doing
          the job the tile below now does properly, and the link is redundant twice over: the
          nav has it, and the tile's own call to action goes to the same place. */}
      <h1 className="font-display text-3xl text-ink">Rounds</h1>
      <p className="mt-1 text-sm text-ink-soft">
        Every round this Book has opened, newest first.
      </p>

      <figure data-src={source} className="mt-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SourceChip source={source} head={head} isFork={isFork} />
          <button
            type="button"
            onClick={refresh}
            // TERTIARY NOW, and this reverses a recorded correction rather than forgetting
            // it. TODO.md holds "`refresh` was too quiet as tertiary when it is the only
            // control on the page" -- true then, because the page had no other control and
            // a bare-text button in an empty corner just looked like text. Two things
            // changed: `.btn-tertiary` gained a hairline underline at rest precisely so it
            // stays discoverable in that situation, and this page now has a real primary in
            // the tile below. A 44px filled primary and a 36px outlined refresh in the same
            // eyeline is the "two of them on one page means neither is primary" failure that
            // globals.css forbids -- refresh is not the act this page exists for.
            className="btn btn-tertiary"
          >
            refresh
          </button>
        </div>

        {/* Loading and error are real states here, not a blank table. A skeleton or a
            spinner would claim data is imminent; neither claim is one this page can back --
            an RPC call can fail, and there may be nothing else to show. */}
        {loading && auctions.length === 0 ? (
          <Loading
            className="mt-4"
            what="Reading rounds from the chain"
            detail={<>One eth_call per round against Base&rsquo;s public endpoint, plus a log scan for the bidders. The public RPC rate-limits, so this backs off and retries rather than hammering it — if it fails entirely the page falls back to the checked-in snapshot and says so.</>}
          />
        ) : error && auctions.length === 0 ? (
          <p className="mt-4 border border-brick bg-brick-soft px-3 py-2 text-sm text-brick">
            Could not read any round: {error}
          </p>
        ) : (
          <>
            {/* THE PROMOTED TILE, above the ledger and below the source chip -- provenance
                first, always. It draws nothing when `auctions` is empty, which is why it
                sits in this branch: "we could not read the chain" is the branch above, and
                a last-print tile rendered over a failed read would turn a network error
                into a claim about a quiet market. */}
            <OpenNow auctions={auctions} head={head} />

          <div className="mt-6">
            {error && source === "snapshot" ? (
              <p className="mb-3 border border-amber bg-amber-soft px-3 py-2 text-[0.78rem] text-amber">
                The live chain read failed, so these rounds come from the checked-in
                snapshot rather than the chain: {error}
              </p>
            ) : null}
            <RoundsFilterTabs
              auctions={auctions}
              head={head}
              active={filterId}
              onChange={setFilterId}
            />
            <p className="mt-2 text-[0.78rem] text-ink-faint">
              {filter.blurb}{" "}
              <span className="tnum text-ink-soft">
                Showing {shown.length} of {auctions.length}.
              </span>
              {unreadable > 0 && (
                <>
                  {" "}
                  <span className="text-amber">
                    {unreadable} round{unreadable === 1 ? "" : "s"} could not be read, so
                    they are not counted in any bid-based filter rather than being counted
                    as having none.
                  </span>
                </>
              )}
            </p>

            {shown.length === 0 ? (
              // An empty result is a real answer about the chain, not a failure, and it
              // says which question it is the answer to.
              <p className="mt-4 border border-rule bg-raised rounded-card px-4 py-6 text-sm text-ink-soft">
                No round matches &ldquo;{filter.label}&rdquo; in the {auctions.length} round
                {auctions.length === 1 ? "" : "s"} this build can see.
              </p>
            ) : (
              <div className="mt-3">
                <RoundsTable auctions={shown} head={head} />
                {/* NOT A PAGINATION LINE, because there is no page two and pretending
                    otherwise would be a control that does nothing. This says what the six
                    rows ARE -- the recent tail, read live -- and points at the one place the
                    whole history exists. Raising `limit` to fill the table is the temptation
                    this line is here to remove. */}
                <p className="mt-3 text-[0.78rem] text-ink-faint">
                  The {countWord(auctions.length)} most recent round
                  {auctions.length === 1 ? "" : "s"} this Book has opened, {sourceClause}.
                  Every round since block{" "}
                  <span className="tnum">{DEPLOY_BLOCK.toLocaleString("en-US")}</span> is in
                  the{" "}
                  <a
                    href={`https://thegraph.com/explorer/subgraphs/${SUBGRAPH_ID}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={SUBGRAPH_ID}
                    className="text-glass underline decoration-rule underline-offset-2 hover:decoration-glass"
                  >
                    subgraph ↗
                  </a>
                  .
                </p>
              </div>
            )}
          </div>
          </>
        )}

        {/* An error alongside data that DID load is a different, quieter claim -- the rows
            below are real, but the last attempt to refresh them failed, so say that instead
            of silently swallowing it. */}
        {error && auctions.length > 0 ? (
          <p className="mt-3 text-[0.78rem] text-brick">
            Last refresh failed ({error}) -- showing the most recent successful read.
          </p>
        ) : null}

        <figcaption className="mt-3 text-[0.78rem] text-ink-faint">
          <span className="text-ink-soft">What produced this:</span> {caption}
        </figcaption>
      </figure>
    </main>
  );
}
