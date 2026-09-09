"use client";

import { useState } from "react";
import type { Auction, Source } from "@/lib/useAuctions";

/**
 * The receipt. ui-spec.md section S4 -- "the thing a judge screenshots".
 *
 * Every other panel on this page is about a round in motion. This one is about a round
 * that finished, and it exists because the finished state is where the claim lives: the
 * winner bid X, paid Y, and Y is the RUNNER-UP's number. A phase track cannot say that. A
 * table of rounds says it in a cell nobody reads.
 *
 * Explorer field order, because a receipt is a genre and people already know how to read
 * one: what happened, then when, then who, then how much. The improvement line is in bps
 * and only bps -- never a token amount and never a dollar figure, which the subgraph
 * refuses for the same reason (subgraph/README.md): the Book is told an amountIn and an
 * amountOut and knows nothing about what either is worth.
 */

const num = (n?: number | null) =>
  n === null || n === undefined || Number.isNaN(n) ? "—" : n.toLocaleString("en-US");
const short = (a?: string | null) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "—");

function Copy({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      aria-label={`Copy ${label}`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch {
          // Clipboard blocked (an insecure origin, or a permissions policy). Say so
          // rather than showing a check for something that did not happen.
          setDone(false);
          window.prompt("Copy this:", text);
        }
      }}
      className="ml-1.5 align-middle font-mono text-[0.7rem] text-ink-faint hover:text-glass"
    >
      {done ? "✓" : "⧉"}
    </button>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-rule py-2.5 first:border-t-0 sm:first:border-t">
      <div className="font-mono text-[0.66rem] uppercase tracking-[0.12em] text-ink-faint">{label}</div>
      <div className="mt-1 text-[0.86rem] text-ink">{children}</div>
    </div>
  );
}

export function Receipt({ a, source }: { a: Auction; source: Source }) {
  // A receipt for a round that has not settled would be a receipt for a transaction that
  // has not happened. The caller decides which round to pass; this decides whether there
  // is anything honest to print about it.
  if (!a.settled) return null;

  const simulated = source === "sim";
  const won = Boolean(a.bestBidder);
  const clearing = a.clearingBps;
  // What the auction moved the price by, against the reserve that would have applied had
  // nobody competed. This is the maker's side of the mechanism and the only number on the
  // page that is a "gain", so it is stated as a difference of two bps figures that are
  // both printed beside it -- never as a lone improvement figure with nothing to check.
  const overReserve = won && clearing !== null ? clearing - a.reserveBps : null;
  const margin = won && clearing !== null ? a.bestBps - clearing : null;
  const reserveBound = won && a.secondBps < a.reserveBps;

  return (
    <figure data-src={simulated ? "sim" : "chain"} className="border border-rule bg-raised">
      <figcaption className="flex flex-wrap items-center justify-between gap-2 border-b border-rule px-4 py-2.5">
        <span className="font-mono text-[0.72rem] uppercase tracking-[0.14em] text-ink">
          Receipt · round {num(a.round)}
        </span>
        <span
          className={`border px-2 py-0.5 font-mono text-[0.64rem] uppercase tracking-[0.12em] ${
            simulated ? "border-amber text-amber" : "border-glass text-glass"
          }`}
        >
          {simulated ? "Simulated · not a chain read" : "Base mainnet · read from the contract"}
        </span>
      </figcaption>

      <div className="grid gap-x-8 px-4 py-1 sm:grid-cols-2">
        <Field label="settled">
          <span className="tnum">after block {num(a.revealEnd)}</span>
          <span className="ml-2 text-ink-faint">reveal window closed</span>
        </Field>
        <Field label={won ? "winner" : "winner"}>
          {won ? (
            <>
              <span className="tnum">{short(a.bestBidder)}</span>
              <Copy text={a.bestBidder!} label="winner address" />
            </>
          ) : (
            <span className="text-ink-faint">none — nobody opened their envelope</span>
          )}
        </Field>

        <Field label="opened">
          <span className="tnum">block {num(a.openedAtBlock)}</span>
          <span className="ml-2 text-ink-faint">by {short(a.maker)}</span>
        </Field>
        <Field label="winning bid">
          {won ? <span className="tnum">{num(a.bestBps)} bps</span> : <span className="text-ink-faint">—</span>}
        </Field>

        <Field label="parameters">
          <span className="tnum">
            {num(a.commitEnd - a.openedAtBlock)} / {num(a.revealEnd - a.commitEnd)} /{" "}
            {num(a.exclusiveEnd - a.revealEnd)}
          </span>
          <span className="ml-2 text-ink-faint">
            commit / reveal / exclusive · reserve {num(a.reserveBps)} · max {num(a.maxBps)}
          </span>
        </Field>
        <Field label="clearing price">
          {won ? (
            <>
              <span className="tnum text-glass">{num(clearing)} bps</span>
              <span className="ml-2 text-ink-faint">
                {reserveBound ? "the reserve set it — sole reveal" : "the runner-up's bid"}
              </span>
            </>
          ) : (
            <span className="text-ink-faint">—</span>
          )}
        </Field>

        <Field label="reveals">
          <span className="tnum">
            {a.revealedCount === null ? "not read" : `${a.revealedCount} of ${a.committedCount}`}
          </span>
          <span className="ml-2 text-ink-faint">
            {a.revealedCount === null
              ? "the log scan failed; this is not a claim that nobody revealed"
              : `${a.committedCount - (a.revealedCount ?? 0)} sealed and never opened`}
          </span>
        </Field>
        <Field label="what the maker gained">
          {overReserve === null ? (
            <span className="text-ink-faint">nothing — there was no winner to pay</span>
          ) : (
            <>
              <span className="tnum text-glass">{overReserve > 0 ? "+" : ""}{num(overReserve)} bps</span>
              <span className="ml-2 text-ink-faint">
                {num(clearing)} cleared − {num(a.reserveBps)} reserve
              </span>
            </>
          )}
        </Field>

        <Field label="fill">
          {a.filled ? (
            <>
              <span className="tnum text-glass">filled by {short(a.filledBy)}</span>
              <span className="ml-2 text-ink-faint">
                {a.filledBy?.toLowerCase() === a.bestBidder?.toLowerCase()
                  ? "the winner, inside the exclusive window"
                  : "NOT the winner — check the phase this landed in"}
              </span>
            </>
          ) : (
            <span className="text-ink-faint">no fill reported to the Book</span>
          )}
        </Field>
        <Field label="what the winner kept">
          {margin === null ? (
            <span className="text-ink-faint">—</span>
          ) : (
            <>
              <span className="tnum">{num(margin)} bps</span>
              <span className="ml-2 text-ink-faint">
                bid {num(a.bestBps)} − paid {num(clearing)}; the reason bidding true is safe
              </span>
            </>
          )}
        </Field>

        <Field label="bonds">
          <span className="tnum">{a.bond ?? "0"}</span>
          <span className="ml-2 text-ink-faint">
            {(a.bond ?? "0") === "0" ? "none escrowed on this round" : "escrowed"}
          </span>
        </Field>
        <Field label="replay check">
          {a.settlementMatchesDerivation === true ? (
            <span className="text-glass">
              settlement matches an independent replay of the reveals ✓
              {simulated && <span className="ml-1 text-ink-faint">(simulated: same arithmetic both sides)</span>}
            </span>
          ) : a.settlementMatchesDerivation === false ? (
            <span className="font-medium text-brick">settlement DISAGREES with the replay — shown, not hidden</span>
          ) : (
            <span className="text-ink-faint">
              not run — the replay is the subgraph&rsquo;s, and it is not published yet
            </span>
          )}
        </Field>
      </div>

      <p className="border-t border-rule px-4 py-3 text-[0.78rem] leading-relaxed text-ink-faint">
        <strong className="font-medium text-ink-soft">What produced this:</strong>{" "}
        {simulated ? (
          <>
            <code className="font-mono">web/lib/simulate.js</code>, replaying one scripted round
            through the contract&rsquo;s own clearing rule. No chain was read; the block numbers
            count from a chosen origin. Every figure would be laid out identically from a real
            round, which is the point of rehearsing it here.
          </>
        ) : (
          <>
            the <code className="font-mono">GlasshouseBook</code> contract on Base, read over{" "}
            <code className="font-mono">eth_call</code> at the block the chip above names, plus one{" "}
            <code className="font-mono">eth_getLogs</code> scan across this round&rsquo;s blocks for the
            bidders. Clearing, margin and the maker&rsquo;s gain are computed here from those raw
            fields — the contract stores <em>clearing</em> but not the differences, so they are
            arithmetic you can redo from the numbers printed above.
          </>
        )}{" "}
        No token amounts and no dollar figure appear here: the Book is handed an amount in and an
        amount out and knows nothing about what either is worth.
      </p>
    </figure>
  );
}
