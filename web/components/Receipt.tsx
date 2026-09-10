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

const BOOK = "0xc4ea91Fe700918220423ac307C6B1c59650FFbfe";

/**
 * The commands that re-derive this receipt from the chain, with this round's values in
 * them. Not a link to a block explorer -- the explorer is somebody else's rendering, and
 * "check it yourself" should mean the reader runs the query, not that they trust a second
 * website. Every number above comes out of these two calls.
 */
function castCommands(a: Auction): string {
  const from = a.openedAtBlock;
  const to = a.exclusiveEnd + 5;
  const RPC = "https://mainnet.base.org";
  // Written as single lines rather than with shell continuations: a backslash-newline that
  // survives a copy into one terminal and breaks in another is a worse experience than a
  // long line, and this is the one block on the page whose entire job is to be pasteable.
  return [
    "# the auction struct, exactly as the contract stores it",
    `cast call ${BOOK} "auctions(address,bytes32)" ${a.maker} ${a.orderHash} --rpc-url ${RPC}`,
    "",
    "# every commit and reveal on this round, in the order they landed",
    `cast logs --address ${BOOK} --from-block ${from} --to-block ${to} --rpc-url ${RPC}`,
  ].join("\n");
}

/** Text for sharing a round. The point of a second-price auction is that one bidder
 *  clears at the reserve and two make the mechanism visible -- so the share is an
 *  invitation to bid against someone, not a boast about a result. */
function inviteText(a: Auction, clearing: number | null): string {
  return a.bestBidder
    ? `Round ${a.round} on Glasshouse settled at ${clearing} bps — the winner bid higher and paid the runner-up's price. Sealed-bid, second-price, on Base.`
    : `Round ${a.round} on Glasshouse is open. Sealed bids, second price — the winner pays what the runner-up offered.`;
}

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
  // The winner's own reveal transaction, if the log scan saw it. The SETTLE transaction is
  // deliberately not linked: nothing scans for the Settled event, so the page does not have
  // it, and inventing a link to a transaction it never read is exactly the kind of
  // unchecked assertion the rest of this card exists to avoid.
  const winnerTx =
    a.bids?.find((b) => b.bidder?.toLowerCase() === a.bestBidder?.toLowerCase())?.revealTx ?? null;
  const margin = won && clearing !== null ? a.bestBps - clearing : null;
  const reserveBound = won && a.secondBps < a.reserveBps;

  return (
    <figure data-src={simulated ? "sim" : "chain"} className="border border-rule bg-raised rounded-card shadow-card">
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
        <Field label="winner">
          {won ? (
            <>
              <a
                href={`https://basescan.org/address/${a.bestBidder}`}
                target="_blank"
                rel="noopener"
                className="tnum text-glass hover:underline"
              >
                {short(a.bestBidder)}
              </a>
              <Copy text={a.bestBidder!} label="winner address" />
              {winnerTx && (
                <a
                  href={`https://basescan.org/tx/${winnerTx}`}
                  target="_blank"
                  rel="noopener"
                  className="ml-2 font-mono text-[0.72rem] text-glass hover:underline"
                >
                  reveal tx ↗
                </a>
              )}
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

      {!simulated && <CheckYourself a={a} />}
      <ShareRound a={a} clearing={clearing} simulated={simulated} />

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

/**
 * "Do not take our word for it" as a button.
 *
 * Every other panel on this page argues that the numbers are checkable. This is the only
 * one that hands you the means. It emits the two `cast` calls that produce everything
 * above -- the auction struct as the contract stores it, and every commit and reveal on the
 * round -- with this round's maker, order hash and block range already filled in.
 *
 * Hidden for the rehearsal: the simulator's order hashes name no auction in the Book, so
 * these commands would return an empty struct and the offer would be a lie.
 */
function CheckYourself({ a }: { a: Auction }) {
  const [copied, setCopied] = useState(false);
  const cmd = castCommands(a);
  return (
    <details className="border-t border-rule px-4 py-3">
      <summary className="cursor-pointer font-mono text-[0.68rem] uppercase tracking-[0.12em] text-glass">
        Check this yourself
      </summary>
      <p className="mt-2 max-w-2xl text-[0.8rem] text-ink-soft">
        Every figure above comes out of these two calls. They need{" "}
        <code className="font-mono">foundry</code> and nothing else — no key, no account, no
        permission from us.
      </p>
      <div className="mt-3 flex justify-end">
        <button
          type="button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(cmd);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            } catch {
              window.prompt("Copy this:", cmd);
            }
          }}
          className="rounded-control border border-rule px-2 py-1 font-mono text-[0.66rem] uppercase tracking-[0.12em] text-ink-soft hover:border-glass hover:text-glass"
        >
          {copied ? "Copied ✓" : "Copy"}
        </button>
      </div>
      <pre className="mt-1 overflow-x-auto bg-sunk p-3 font-mono text-[0.72rem] leading-relaxed text-ink-soft">
        {cmd}
      </pre>
    </details>
  );
}

/**
 * Invite a rival.
 *
 * The native growth loop of a second-price auction is not "look what I won" -- it is that
 * ONE bidder clears at the reserve and TWO make the mechanism visible. So the share is an
 * invitation to bid against somebody, and the copy says what the round is rather than
 * boasting about a result.
 *
 * Intent links only: no SDK, no tracking pixel, no third-party script. A link the visitor
 * clicks, on a page that loads nothing it did not author.
 */
function ShareRound({
  a,
  clearing,
  simulated,
}: {
  a: Auction;
  clearing: number | null;
  simulated: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const url =
    typeof window === "undefined"
      ? ""
      : `${window.location.origin}/evidence?round=${a.round}`;
  const text = inviteText(a, clearing);

  if (simulated) return null;

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-rule px-4 py-3">
      <span className="font-mono text-[0.66rem] uppercase tracking-[0.12em] text-ink-faint">
        Bring a rival
      </span>
      <a
        href={`https://warpcast.com/~/compose?text=${encodeURIComponent(text)}&embeds[]=${encodeURIComponent(url)}`}
        target="_blank"
        rel="noopener"
        className="font-mono text-[0.72rem] text-glass hover:underline"
      >
        Cast ↗
      </a>
      <a
        href={`https://x.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`}
        target="_blank"
        rel="noopener"
        className="font-mono text-[0.72rem] text-glass hover:underline"
      >
        Post ↗
      </a>
      <button
        type="button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(url);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          } catch {
            window.prompt("Copy this:", url);
          }
        }}
        className="font-mono text-[0.72rem] text-ink-soft hover:text-glass"
      >
        {copied ? "Link copied ✓" : "Copy link"}
      </button>
      <span className="text-[0.74rem] text-ink-faint">
        One bidder clears at the reserve. Two show what the mechanism does.
      </span>
    </div>
  );
}
