"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useAccount, useConnect, useWaitForTransactionReceipt } from "wagmi";
import { base } from "wagmi/chains";
import { useAvailableConnectors } from "@/components/WalletBar";
import { type Auction } from "@/lib/useAuctions";
// Plain ESM, deliberately untyped: bid.js is the same file the static page and the Node
// tests load, and adding a .d.ts would create a second place for the shape to drift.
// `allowJs` lets TypeScript infer it rather than a suppression -- but inference reads
// `function pendingBid(orderHash, bidder = null)` as "bidder is of type null", which is
// narrower than the function actually is. The typed surface below is the one place those
// signatures are stated; the alternative was a cast at every call site.
import {
  adoptSecret as adoptSecretJs,
  bidState as bidStateJs,
  classifyRevert as classifyRevertJs,
  configure as configureJs,
  explainRevert as explainRevertJs,
  exportSecret as exportSecretJs,
  hasProvider as hasProviderJs,
  listBids as listBidsJs,
  pendingBid as pendingBidJs,
  placeBid as placeBidJs,
  revealBid as revealBidJs,
} from "@/lib/bid.js";

/*
 * THE BIDDING SURFACE.
 *
 * Everything money-touching in here is bid.js's. This file decides what a person sees and
 * when; it does not decide what gets signed, what gets stored, or whether a deadline has
 * passed. That separation is the point:
 *
 *   * `placeBid` generates the salt, reads the commitment from the contract on two
 *     independent nodes, writes the secret to localStorage AND READS IT BACK, and only then
 *     offers a transaction to the wallet. A commit whose salt exists only in a variable in
 *     a dead tab is unrevealable by anyone, so that ordering is the single most important
 *     thing in the product and it is not reimplemented here with wagmi's `useWriteContract`.
 *   * `revealBid` contains no check against `revealEnd`, on purpose. Our head is a poll old
 *     at best and the contract compares `block.number` at inclusion; a reveal we refuse to
 *     send because our clock says it is late costs the bid, and a reveal that lands one
 *     block late costs a cent of gas.
 *   * `bidState` is the one place (auction, record, on-chain bid, head) becomes a button
 *     state, so this panel and the sticky strip below can never disagree about a deadline.
 *
 * wagmi is used for what it is genuinely better at: the account, the chain, and
 * `useWaitForTransactionReceipt` for the hash bid.js hands back.
 */

// --- the typed surface of bid.js ------------------------------------------------------
// Asserted, not re-declared: every signature here is read off the exported function it
// names, and nothing about behaviour is expressed in this block.

type Bounds = {
  commitEnd: number;
  revealEnd: number;
  exclusiveEnd: number;
  bestBidder: string | null;
  reserveBps: number;
  maxBps: number;
};
type OnChainBid = { committed: boolean; commitIdx: number; revealed: boolean } | null;
type Classified = { kind: string; name: string | null; selector: string | null; raw: string | null };

const adoptSecret = adoptSecretJs as (args: {
  maker: string;
  orderHash: string;
  bidder: string;
  bps: number;
  salt: string;
  revealEnd?: number | null;
  commitEnd?: number | null;
}) => BidRecord;
const bidState = bidStateJs as (args: {
  auction: Bounds;
  record?: BidRecord | null;
  onChain?: OnChainBid;
  head: number;
}) => Derived;
const classifyRevert = classifyRevertJs as (e: unknown) => Classified;
const configure = configureJs as (next: { rpc?: string; book?: string; explorer?: string }) => unknown;
const explainRevert = explainRevertJs as (e: unknown) => string;
const exportSecret = exportSecretJs as (orderHash: string, bidder?: string | null) => string | null;
const hasProvider = hasProviderJs as () => boolean;
const listBids = listBidsJs as (bidder?: string | null) => BidRecord[];
const pendingBid = pendingBidJs as (orderHash: string, bidder?: string | null) => BidRecord | null;
const placeBid = placeBidJs as (
  args: { maker: string; orderHash: string; bps: number },
  options?: { acceptUnstoredSecret?: boolean; skipPreflight?: boolean },
) => Promise<{ txHash: string; salt: string; bps: number; record: BidRecord }>;
const revealBid = revealBidJs as (
  args: { maker: string; orderHash: string; bps?: number | null; salt?: string | null },
  options?: { skipPreflight?: boolean; gas?: string },
) => Promise<{ txHash: string; bps: number }>;

// The board's `?rpc=` override (a local Anvil fork of Base -- see app/providers.tsx) has to
// reach bid.js as well. Its pre-flight `eth_call`, its `auctions()` read and its `bids()`
// read all go through `cfg.rpc`; pointing those at mainnet while the wallet signs on a fork
// would simulate against a chain the transaction never touches, which is worse than not
// simulating at all. Done at module scope rather than in an effect so it is true before the
// first render, and guarded because the static export evaluates this file in Node too.
// The Book address is bid.js's own default and is deliberately not duplicated here.
const RPC_OVERRIDE =
  typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("rpc");
if (RPC_OVERRIDE) configure({ rpc: RPC_OVERRIDE });

// A Basescan link is only true on mainnet. On a fork the hash exists but the explorer has
// never heard of it, so the hash is shown as plain text rather than as a link that 404s.
const IS_FORK = !!RPC_OVERRIDE && /127\.0\.0\.1|localhost/.test(RPC_OVERRIDE);

const BLOCK_SECONDS = 2;
const num = (n?: number | null) =>
  n === null || n === undefined || Number.isNaN(n) ? "—" : n.toLocaleString("en-US");
const short = (a?: string | null) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "—");

/**
 * Blocks are the fact; seconds are an estimate and are labelled as one. Never a clock time.
 *
 * The trailing "at 2s/block" is gone. It appeared beside every deadline on the page -- four
 * times on one screen at the worst -- to make a point the countdown's tilde already makes
 * and /faq#blocks now argues properly. What a bidder needs at the moment of bidding is the
 * block count and a rough feel for how long that is.
 */
function gloss(blocks: number) {
  const b = Math.max(0, blocks);
  return `${b} block${b === 1 ? "" : "s"} · ~${b * BLOCK_SECONDS} s`;
}

/* THE FIVE BUTTON CONSTANTS THAT USED TO LIVE HERE ARE GONE, and their deletion is the
   whole point of this pass.

   The base and the idle variant together came to `border px-3 py-2 font-mono text-[0.78rem]
   border-glass text-glass` -- a 12px monospace outline in the accent colour. So "Place
   sealed bid · 250 bps" and
   "Reveal 250 bps · 23 blocks left", the only two acts this product exists for, rendered at
   exactly the weight of the inert provenance chips beside them, while the one FILLED button
   on the site was `Connect wallet`. The site filled the preamble and outlined the act, and
   the owner's report was blunt: the CTAs are not visible.

   Everything here now uses the shared primitives in app/globals.css, which own the size,
   the face and the fill (`.btn-primary` is 44px sans 600 filled; `.btn .tnum` keeps a chain
   value monospace inside a sans sentence). The four states this panel walks through --
   connect, place, reveal, last call -- are ONE control in ONE slot changing its label, so
   there is never a second primary on the page and the target never moves out from under a
   cursor already travelling towards it. `.btn-danger-solid` shares `.btn-primary`'s exact
   geometry for that reason and REPLACES it rather than joining it.

   The disabled labels are untouched. They are not decoration: "Closing — 2 blocks is too
   few to sign" and "350 bps cannot be revealed — this round accepts 50 to 500" are the
   explanation, stated at the moment it applies, and they now arrive as `disabled` on a real
   button instead of as a dead bordered span. */
const LABEL = "font-mono text-[0.6875rem] uppercase tracking-[0.12em] text-ink-faint";

/** The one FAQ link shape this panel uses: four words, tertiary, never a paragraph. */
function FaqLink({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <Link href={`/faq#${to}`} className="btn btn-tertiary">
      {children}
    </Link>
  );
}

/** Records live in localStorage, which React cannot subscribe to. This is the nudge. */
const RECORDS_CHANGED = "glasshouse:records-changed";
const announceRecords = () => {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(RECORDS_CHANGED));
};

function useRecordTick() {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const bump = () => setTick((t) => t + 1);
    window.addEventListener(RECORDS_CHANGED, bump);
    // `storage` fires when ANOTHER tab writes. Two tabs of this page both hold the same
    // record, and a reveal signed in one must stop the other from still saying "reveal now".
    window.addEventListener("storage", bump);
    return () => {
      window.removeEventListener(RECORDS_CHANGED, bump);
      window.removeEventListener("storage", bump);
    };
  }, []);
  return tick;
}

/**
 * `mounted` is not ceremony. This is a static export: the prerendered HTML has no
 * `localStorage` and no wallet, so reading either during the first render would make the
 * client disagree with the server and React would throw away the tree.
 */
function useMounted() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted;
}

type BidRecord = {
  orderHash: string;
  maker: string;
  bidder: string;
  bps: number;
  salt: string;
  commitEnd: number | null;
  revealEnd: number | null;
  exclusiveEnd: number | null;
  reserveBps?: number;
  maxBps?: number;
  txHash: string | null;
  revealTx: string | null;
  source: string;
  state: string;
};

type Derived = {
  phase: string;
  state: string;
  canCommit: boolean;
  canReveal: boolean;
  committed: boolean;
  revealed: boolean;
  blocksToCommitEnd: number;
  blocksToRevealEnd: number;
  urgent: boolean;
  lastCall: boolean;
};

/**
 * The wallet's own row, taken from the board's poll rather than a second RPC round trip.
 * `useAuctions` builds `bids` from BidCommitted/BidRevealed logs at the same head as the
 * rest of the card, so this cannot be a block out of step with the countdown beside it.
 *
 * It is a LOWER BOUND, never a denial: a commit the log scan has not reached yet reads as
 * "not committed" here, and `bidState` ORs it with the local record's `txHash`. If both miss
 * it, `placeBid` still refuses -- it reads `bids()` from the contract itself before
 * generating a salt, precisely so a stale view cannot destroy a live secret.
 */
function onChainBidFor(a: Auction | null | undefined, who: string | null) {
  if (!a || !who) return null;
  const row = a.bids?.find((b) => b.bidder?.toLowerCase() === who);
  if (!row) return null;
  return { committed: true, commitIdx: row.commitIdx, revealed: row.bps !== null && row.bps !== undefined };
}

/**
 * A record carries the round's boundaries, copied at commit time. That makes the sticky
 * strip work for a round that has scrolled off the board entirely -- which is exactly the
 * case where a visitor is about to miss a reveal.
 */
function boundsFromRecord(r: BidRecord) {
  if (r.commitEnd == null || r.revealEnd == null) return null;
  return {
    commitEnd: r.commitEnd,
    revealEnd: r.revealEnd,
    exclusiveEnd: r.exclusiveEnd ?? r.revealEnd,
    bestBidder: null,
    reserveBps: r.reserveBps ?? 0,
    maxBps: r.maxBps ?? 0,
  };
}

/** One sentence, plus the raw material a bug report needs, and never a bare selector. */
function describe(e: unknown) {
  const sentence = explainRevert(e);
  const c = classifyRevert(e) as { name: string | null; selector: string | null; raw: string | null };
  const err = e as { code?: unknown; revert?: { name?: string } } | null;
  const code = typeof err?.code === "string" ? err.code : null;
  return {
    sentence,
    // A BidError's own `code` (STORAGE_BLOCKED, ALREADY_SEALED, …) if it has one; the
    // decoded contract error name (AlreadyRevealed, RevealClosed, …) otherwise.
    code,
    revertName: err?.revert?.name ?? c.name,
    detail: c.raw ?? c.selector ?? null,
  };
}

function TxLine({ hash, verb }: { hash: string; verb: string }) {
  return (
    <span className="tnum">
      {verb} · {short(hash)}
      {IS_FORK ? (
        <span className="text-ink-faint"> · local fork, not on Basescan</span>
      ) : (
        <>
          {" "}
          <a
            href={`https://basescan.org/tx/${hash}`}
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-2"
          >
            ↗
          </a>
        </>
      )}
    </span>
  );
}

function Sentence({ text, detail, tone = "brick" }: { text: string; detail?: string | null; tone?: "brick" | "amber" }) {
  const border = tone === "brick" ? "border-brick bg-brick-soft" : "border-amber bg-amber-soft";
  return (
    <div className={`mt-2 border-l-2 ${border} px-3 py-2 text-[0.78rem] leading-snug text-ink-soft`} role="status">
      {text}
      {detail ? (
        <details className="mt-1">
          <summary className="cursor-pointer text-[0.72rem] text-ink-faint">raw</summary>
          <code className="tnum block break-all pt-1 text-[0.7rem] text-ink-faint">{detail}</code>
        </details>
      ) : null}
    </div>
  );
}

/**
 * `Copy bid secret` -- the escape hatch, and the reason a lost tab is not a lost bid.
 *
 * Rendered from the instant the record exists, which `placeBid` guarantees is before the
 * wallet prompt has opened. If the clipboard is unavailable (it is gated on a secure context
 * and on permission) the secret is put on screen instead: failing to copy must never mean
 * failing to show.
 */
function CopySecret({ orderHash, bidder }: { orderHash: string; bidder: string }) {
  const [shown, setShown] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const copy = useCallback(() => {
    const secret = exportSecret(orderHash, bidder);
    if (!secret) return;
    const fallback = () => setShown(secret);
    try {
      const clip = navigator.clipboard;
      if (!clip?.writeText) return fallback();
      clip.writeText(secret).then(
        () => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1800);
        },
        fallback,
      );
    } catch {
      fallback();
    }
  }, [orderHash, bidder]);

  return (
    <div className="mt-2">
      <div className="flex flex-wrap items-center gap-1">
        <button type="button" onClick={copy} className="btn btn-tertiary">
          {copied ? "Copied ✓" : "Copy bid secret"}
        </button>
        <FaqLink to="secret">what the secret is</FaqLink>
      </div>
      <p className="mt-1 text-[0.72rem] leading-snug text-ink-faint">
        Stored in this browser only. Copy it if you might reveal from another one.
      </p>
      {shown ? (
        <textarea
          readOnly
          rows={7}
          value={shown}
          onFocus={(e) => e.currentTarget.select()}
          className="tnum mt-2 w-full border border-rule bg-sunk p-2 text-[0.7rem]"
        />
      ) : null}
    </div>
  );
}

/**
 * THE REVEAL CONTROL. One component, used by the card and by the sticky strip, so the two
 * can never show different deadlines for the same bid.
 *
 * THE DISABLED RULE, which is the whole reason this component is separate:
 *
 *   enabled  ⟺  committed ∧ ¬revealed ∧ (our head is unknown ∨ head ≤ revealEnd)
 *
 * It is deliberately weaker than "the reveal window is open". It stays live at one block
 * left; it stays live when the RPC has stopped answering and we have no head at all; it
 * stays live after a reverted attempt while the window can still be open. The asymmetry is
 * the point -- a reveal that lands late reverts and costs cents of gas, a reveal never
 * attempted costs the bid and, on a round with a bond, the bond. The only thing that turns
 * it off is our head being PAST `revealEnd`, and that head came from the chain, so it is the
 * chain's answer and not a timer of ours.
 */
function RevealButton({
  record,
  st,
  headUnknown,
  head,
  compact = false,
}: {
  record: BidRecord;
  st: Derived;
  headUnknown: boolean;
  head: number;
  compact?: boolean;
}) {
  const { address, isConnected, chainId } = useAccount();
  const me = address?.toLowerCase() ?? null;
  const [stage, setStage] = useState<"idle" | "wallet" | "sent" | "done">("idle");
  const [tx, setTx] = useState<string | null>(null);
  const [err, setErr] = useState<{ sentence: string; detail: string | null } | null>(null);

  const receipt = useWaitForTransactionReceipt({
    hash: (tx ?? undefined) as `0x${string}` | undefined,
    query: { enabled: !!tx },
  });

  useEffect(() => {
    if (!tx || receipt.status !== "success") return;
    if (receipt.data?.status === "reverted") {
      // Simulation passed and the state moved underneath it. Do NOT latch to a terminal
      // state: if the window can still be open the button goes back to idle so a second
      // attempt is one click, which is the only thing that can still save the bid.
      setStage("idle");
      setTx(null);
      setErr({
        sentence:
          "The reveal was sent but the chain rejected it, so the bid is still sealed. If the window is still open, try again.",
        detail: receipt.data.transactionHash ?? null,
      });
      return;
    }
    setStage("done");
    announceRecords();
  }, [tx, receipt.status, receipt.data]);

  const left = st.blocksToRevealEnd;
  const wrongAccount = !!me && record.bidder !== me;
  const closed = !headUnknown && !st.canReveal && head > (record.revealEnd ?? Number.MAX_SAFE_INTEGER);

  const onClick = useCallback(async () => {
    setErr(null);
    setStage("wallet");
    try {
      // At one or two blocks left a 1.5 s simulation costs a block, and the simulation is
      // worth less than the block: bid.js sends anyway on anything it cannot decode, so the
      // only thing skipping it loses is a decoded error we would show after the fact.
      const res = await revealBid(
        { maker: record.maker, orderHash: record.orderHash },
        { skipPreflight: !headUnknown && left <= 2 },
      );
      setTx(res.txHash);
      setStage("sent");
      announceRecords();
    } catch (e) {
      const d = describe(e);
      // A second tab already opened this bid. That is a success, not a failure, and saying
      // "failed" here would send someone hunting for a problem that does not exist.
      if (d.revertName === "AlreadyRevealed") {
        setStage("done");
        announceRecords();
        return;
      }
      setStage("idle");
      setErr({ sentence: d.sentence, detail: d.detail });
    }
  }, [record.maker, record.orderHash, left, headUnknown]);

  // THE LABEL IS A SENTENCE WITH ONE MONO VALUE IN IT. `bps` is a chain number and has to
  // line up with the same figure in the table above, so it is wrapped in `.tnum` inside the
  // sans button rather than dragging the whole label into monospace (globals.css `.btn .tnum`).
  let label: React.ReactNode;
  // The live variants only. Every disabled state falls through to `btn btn-primary` plus
  // `disabled`, which globals.css paints as "not now" while keeping the 44px slot -- so the
  // control does not resize as the round moves through its states.
  let cls = "btn btn-primary";
  let disabled = false;

  if (stage === "done" || st.revealed) {
    label = "Revealed ✓";
    disabled = true;
  } else if (stage === "sent" && tx) {
    label = `Revealing · ${short(tx)}${headUnknown ? "" : ` · ${Math.max(0, left)} block${left === 1 ? "" : "s"} left`}`;
    disabled = true;
  } else if (stage === "wallet") {
    label = `Confirm in wallet…${headUnknown ? "" : ` · ${Math.max(0, left)} block${left === 1 ? "" : "s"} left`}`;
    disabled = true;
  } else if (!isConnected) {
    label = `Connect ${short(record.bidder)} to reveal this bid`;
    disabled = true;
  } else if (wrongAccount) {
    // Revealing from the wrong account is a guaranteed NoCommitment revert, so this one is
    // safe to disable: the contract would not accept it from this wallet under any head.
    label = `Sealed from ${short(record.bidder)} — switch to that account to reveal`;
    disabled = true;
  } else if (chainId !== undefined && chainId !== base.id) {
    label = "Switch to Base to reveal";
    disabled = true;
  } else if (closed) {
    label = `Reveal closed at block ${num(record.revealEnd ?? 0)} — the bid is void`;
    disabled = true;
  } else if (headUnknown) {
    // No head means no proof the window has closed, and an unattempted reveal is the only
    // outcome guaranteed to fail. The label says exactly why it is offering anyway.
    label = (
      <>
        Reveal <span className="tnum">{record.bps} bps</span> — block height not read, sending anyway
      </>
    );
  } else if (left <= 1) {
    // THE LAST BLOCK, and the one case on the site where urgency outranks one-primary-per-
    // view. Filled brick at the same 44px geometry, so it replaces the primary in place.
    label = (
      <>
        Reveal <span className="tnum">{record.bps} bps</span> ·{" "}
        <span className="tnum">
          {Math.max(0, left)} block{left === 1 ? "" : "s"}
        </span>{" "}
        left · may not land
      </>
    );
    cls = "btn btn-danger-solid";
  } else {
    label = (
      <>
        Reveal <span className="tnum">{record.bps} bps</span> · <span className="tnum">{left} blocks</span> left
      </>
    );
  }

  // COMPACT IS NEVER PRIMARY. The sticky strip is a second surface, showing a reveal for a
  // round that is NOT the one on screen, and a primary there would put two filled buttons on
  // / at the same time -- the exact thing the CTA rule forbids. It carries its deadline in
  // words instead, and still escalates to the filled brick in the last block, which globals
  // .css explicitly allows to replace the primary rather than join it.
  if (compact && cls === "btn btn-primary") cls = "btn btn-secondary";

  return (
    <div className={compact ? "" : "mt-3"}>
      <button type="button" disabled={disabled} onClick={onClick} className={`${cls} w-full`}>
        {label}
      </button>
      {!compact && !disabled ? (
        <p className={`mt-1 flex flex-wrap items-center gap-1 text-[0.74rem] ${left <= 10 && !headUnknown ? "text-brick" : "text-ink-faint"}`}>
          <span className="tnum">
            {headUnknown
              ? "block height not read — the contract decides whether it is late"
              : left <= 10
                ? `Reveal closes at block ${num(record.revealEnd ?? 0)} — sign now`
                : `closes at block ${num(record.revealEnd ?? 0)} · ${gloss(left)}`}
          </span>
          <FaqLink to="reveal">what reveal does</FaqLink>
        </p>
      ) : null}
      {err ? <Sentence text={err.sentence} detail={err.detail} /> : null}
      {stage === "sent" && tx && !compact ? (
        <p className="mt-1 text-[0.74rem] text-ink-faint">
          <TxLine hash={tx} verb="reveal sent" />
        </p>
      ) : null}
    </div>
  );
}

/** `Enter secret` — the counterpart to `Copy bid secret`, for a reveal from another browser. */
function EnterSecret({ maker, orderHash, bidder, bounds }: { maker: string; orderHash: string; bidder: string; bounds: { commitEnd: number; revealEnd: number } }) {
  const [bps, setBps] = useState("");
  const [salt, setSalt] = useState("");
  const [err, setErr] = useState<string | null>(null);

  return (
    <details className="mt-3 border-t border-rule pt-2">
      <summary className="cursor-pointer font-mono text-[0.74rem] text-glass">Enter secret</summary>
      <p className="mt-1 text-[0.74rem] leading-snug text-ink-faint">
        Paste the bps and salt you copied when you bid. <FaqLink to="secret">what the secret is</FaqLink>
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <input
          inputMode="numeric"
          value={bps}
          onChange={(e) => setBps(e.target.value.replace(/[^0-9]/g, ""))}
          placeholder="bps"
          className="tnum w-24 border border-rule bg-raised rounded-card shadow-card px-2 py-1 text-[0.78rem]"
        />
        <input
          value={salt}
          onChange={(e) => setSalt(e.target.value.trim())}
          placeholder="0x… (32 bytes)"
          className="tnum min-w-0 flex-1 border border-rule bg-raised rounded-card shadow-card px-2 py-1 text-[0.78rem]"
        />
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => {
            setErr(null);
            try {
              adoptSecret({
                maker,
                orderHash,
                bidder,
                bps: Number(bps),
                salt,
                commitEnd: bounds.commitEnd,
                revealEnd: bounds.revealEnd,
              });
              announceRecords();
            } catch (e) {
              setErr(describe(e).sentence);
            }
          }}
        >
          Use this secret
        </button>
      </div>
      {err ? <Sentence text={err} /> : null}
    </details>
  );
}

/**
 * The bid form. The commit is the one place a stricter-than-the-contract gate is correct,
 * and it is the opposite of the reveal's rule: `commit()` would accept a bid two blocks
 * before `commitEnd`, but a human cannot read a wallet prompt and sign in four seconds, and
 * a commit that misses costs nothing but the chance to bid. Missing a REVEAL costs the bid,
 * which is why nothing like this appears in RevealButton.
 */
function BidForm({ auction, st, head, headUnknown }: { auction: Auction; st: Derived; head: number; headUnknown: boolean }) {
  const { address, isConnected, chainId } = useAccount();
  const me = address?.toLowerCase() ?? null;
  const [raw, setRaw] = useState("");
  const [stage, setStage] = useState<"idle" | "checking" | "wallet" | "sent" | "done">("idle");
  const [tx, setTx] = useState<string | null>(null);
  const [err, setErr] = useState<{ sentence: string; detail: string | null } | null>(null);
  const [secretReady, setSecretReady] = useState(false);
  const watcher = useRef<ReturnType<typeof setInterval> | null>(null);

  const receipt = useWaitForTransactionReceipt({
    hash: (tx ?? undefined) as `0x${string}` | undefined,
    query: { enabled: !!tx },
  });

  useEffect(() => {
    if (!tx || receipt.status !== "success") return;
    if (receipt.data?.status === "reverted") {
      setStage("idle");
      setTx(null);
      setErr({
        sentence:
          "The commit was sent but the chain rejected it, so no bid was placed and nothing was escrowed. The round may have closed while you were signing.",
        detail: null,
      });
      return;
    }
    setStage("done");
    announceRecords();
  }, [tx, receipt.status, receipt.data]);

  useEffect(() => () => { if (watcher.current) clearInterval(watcher.current); }, []);

  const parsed = /^\d+$/.test(raw) ? Number(raw) : null;
  const inRange = parsed !== null && parsed >= auction.reserveBps && parsed <= auction.maxBps;
  const tooLateToSign = !headUnknown && st.blocksToCommitEnd <= 2;
  const noWallet = !hasProvider();

  const submit = useCallback(async () => {
    if (parsed === null) return;
    setErr(null);
    setSecretReady(false);
    setStage("checking");

    // The ladder's second rung is driven by a FACT, not a timer. bid.js writes the secret
    // and reads it back before it constructs any transaction, so the moment a record appears
    // the salt is durable and the only thing left is the pre-flight and the wallet prompt.
    // Polling for it lets the label say something true ("secret saved") instead of guessing
    // when the wallet opened, and it puts `Copy bid secret` on screen at the same instant.
    if (watcher.current) clearInterval(watcher.current);
    watcher.current = setInterval(() => {
      if (me && pendingBid(auction.orderHash, me)) {
        setSecretReady(true);
        setStage((s) => (s === "checking" ? "wallet" : s));
        if (watcher.current) clearInterval(watcher.current);
      }
    }, 120);

    try {
      const res = await placeBid({ maker: auction.maker, orderHash: auction.orderHash, bps: parsed });
      setTx(res.txHash);
      setStage("sent");
      announceRecords();
    } catch (e) {
      const d = describe(e);
      setStage("idle");
      setErr({ sentence: d.sentence, detail: d.detail });
      // STORAGE_BLOCKED means nothing was sent and nothing was escrowed -- bid.js refused.
      // It is surfaced as-is and NOT paired with a "copy this, then send anyway" button:
      // a retry mints a fresh salt, so any secret shown beside such a button would not be
      // the one that ended up committed. The only honest fix is to allow site storage.
      announceRecords();
    } finally {
      if (watcher.current) clearInterval(watcher.current);
    }
  }, [parsed, auction.maker, auction.orderHash, me]);

  // Every label below is the one that was here before. Only the rendering changed: one 44px
  // slot, `disabled` where it used to be a dead bordered span, and the bps value kept in
  // monospace inside the sans sentence.
  let label: React.ReactNode;
  let disabled = true;

  if (stage === "done") {
    label = `Sealed ✓ · reveal opens at block ${num(auction.commitEnd + 1)}`;
  } else if (stage === "sent" && tx) {
    label = `Sealing · ${short(tx)}`;
  } else if (stage === "wallet") {
    label = "Secret saved · confirm in wallet…";
  } else if (stage === "checking") {
    label = "Checking the round…";
  } else if (noWallet) {
    label = "No wallet found — bidding needs one, the board does not";
  } else if (!isConnected) {
    label = "Connect wallet to bid";
  } else if (chainId !== undefined && chainId !== base.id) {
    // The enabled control for this lives in WalletBar, directly above, as `Switch to Base`.
    label = "Switch to Base to bid";
  } else if (!headUnknown && st.blocksToCommitEnd < 0) {
    label = `Commit closed at block ${num(auction.commitEnd)}`;
  } else if (tooLateToSign) {
    label = `Closing — ${Math.max(0, st.blocksToCommitEnd)} block${st.blocksToCommitEnd === 1 ? "" : "s"} is too few to sign`;
  } else if (parsed === null) {
    label = `Enter a bid between ${auction.reserveBps} and ${auction.maxBps} bps`;
  } else if (!inRange) {
    // `commit()` does not range-check; `reveal()` does. A bid outside the range would seal
    // cleanly and could then never be opened, so the page refuses before the contract can.
    label = `${parsed} bps cannot be revealed — this round accepts ${auction.reserveBps} to ${auction.maxBps}`;
  } else {
    label = (
      <>
        Place sealed bid · <span className="tnum">{parsed} bps</span>
      </>
    );
    disabled = false;
  }

  return (
    <div className="mt-3">
      <label className="block">
        <span className={LABEL}>bid, bps</span>
        <input
          inputMode="numeric"
          pattern="[0-9]*"
          value={raw}
          // Keystrokes outside 0-9 are dropped rather than flagged: `.`, `-` and `e` are all
          // things uint24 cannot hold, and rejecting them at the keystroke is quieter than a
          // validation message after the fact.
          onChange={(e) => setRaw(e.target.value.replace(/[^0-9]/g, ""))}
          className="tnum mt-1 block w-32 border border-rule bg-raised rounded-card shadow-card px-2 py-1 text-base"
          placeholder={String(auction.reserveBps)}
        />
      </label>
      <p className="tnum mt-1 text-[0.74rem] text-ink-faint">
        between {auction.reserveBps} (reserve) and {auction.maxBps} (max)
      </p>

      <button type="button" disabled={disabled} onClick={submit} className="btn btn-primary mt-3 w-full">
        {label}
      </button>

      <p className="tnum mt-1 text-[0.74rem] text-ink-faint">
        {headUnknown
          ? "chain head not read — the contract judges the commit window, not this page"
          : `commit closes at block ${num(auction.commitEnd)} · ${gloss(st.blocksToCommitEnd)}`}
      </p>
      {/* ONE SENTENCE, WHERE THERE WERE TWO. Both were true and the second repeated the
          first's second half; what a bidder has to know in the four seconds before they sign
          is that this transaction is not the bid and that a missing reveal voids it. The rest
          of the mechanism -- why a hash, why a salt, why two transactions -- is an argument,
          and an argument belongs behind the link rather than between a person and a button. */}
      <p className="mt-1 text-[0.74rem] leading-snug text-ink-faint">
        Only a hash is sent now. You must come back and reveal it in the reveal window, or the
        bid is void. <FaqLink to="round">how it works</FaqLink>
      </p>

      {/* Beside the button from the instant the record exists, which is before the wallet
          prompt. This is ENS 2017's "store your salt somewhere safe" turned into a control. */}
      {secretReady && me ? <CopySecret orderHash={auction.orderHash} bidder={me} /> : null}
      {stage === "sent" && tx ? (
        <p className="mt-2 text-[0.74rem] text-ink-faint">
          <TxLine hash={tx} verb="commit sent" />
        </p>
      ) : null}
      {err ? <Sentence text={err.sentence} detail={err.detail} /> : null}
    </div>
  );
}

/**
 * THE FIRST RUNG OF THE LADDER, and the reason `Connect wallet` in the status bar above is
 * no longer the one filled button on the site.
 *
 * The panel used to answer "no wallet connected" with a paragraph and no control, so the
 * only way into the product was to find a separate button somewhere else on the page. That
 * button was primary, which meant the site's single loudest element was its PREAMBLE while
 * the two acts it exists for -- seal a bid, open a bid -- were outlined 12px monospace.
 *
 * This is the same 44px slot the bid button and the reveal button occupy, in the same place,
 * so the primary never moves as the round walks through connect -> place -> reveal. It
 * connects; it does not gate. Nothing above it needs a wallet and nothing above it is hidden
 * until one arrives.
 *
 * The `available`/`status` handling is `useAvailableConnectors`'s, imported rather than
 * rewritten: a second, simpler copy of "is there a wallet" is how EIP-6963 wallets end up
 * told they do not exist (see the comment on that hook).
 */
function ConnectPrimary() {
  const mounted = useMounted();
  const { connect, status } = useConnect();
  const available = useAvailableConnectors();

  if (!mounted) {
    return (
      <button type="button" disabled className="btn btn-primary mt-3 w-full">
        Reading wallet state…
      </button>
    );
  }
  if (available.length === 0) {
    return (
      <button
        type="button"
        disabled
        className="btn btn-primary mt-3 w-full"
        title="Bidding needs a browser wallet on Base. Everything else on this page is read from the chain and works without one."
      >
        No wallet found — bidding needs one, the board does not
      </button>
    );
  }
  return (
    <button
      type="button"
      disabled={status === "pending"}
      onClick={() => connect({ connector: available[0] })}
      className="btn btn-primary mt-3 w-full"
    >
      {status === "pending" ? "Confirm in wallet…" : "Connect wallet to bid"}
    </button>
  );
}

/**
 * The bidding panel for one round.
 *
 * Branching is `bidState`'s, not this component's: it is the tested function that turns
 * (auction, record, on-chain row, head) into a state, and re-deriving any of it here would
 * be a second opinion about a deadline that forfeits money when it is wrong.
 */
export function BidPanel({ auction, head }: { auction: Auction | null; head: number }) {
  const mounted = useMounted();
  const tick = useRecordTick();
  const { address, isConnected } = useAccount();
  const me = address?.toLowerCase() ?? null;

  // `head` is 0 until the first poll answers, and it stays frozen if the RPC stops. Either
  // way we do not know what block it is, and the page says so rather than counting down from
  // a number it made up. Nothing is ever disabled on the strength of an unknown head.
  const headUnknown = !Number.isFinite(head) || head <= 0;

  const mine = useMemo<BidRecord | null>(
    () => (mounted && auction && me ? pendingBid(auction.orderHash, me) : null),
    // `tick` is a deliberate dependency: localStorage is not reactive.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mounted, auction?.orderHash, me, tick],
  );
  // THE WALK-AWAY CASE. A visitor who sealed a bid, closed the tab and came back has no
  // connected account until the wallet re-authorises, which may be never -- and their reveal
  // deadline is running the whole time. With no account to key on, the unambiguous record
  // this browser holds for the round IS theirs in the only sense that matters, so it is
  // shown and the control tells them which account to connect. When an account IS connected
  // this falls back to null, because another account's record is not theirs to reveal and
  // `pendingBid(hash, me)` has already said so.
  const browserRecord = useMemo<BidRecord | null>(
    () => (mounted && auction && !me ? pendingBid(auction.orderHash) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mounted, auction?.orderHash, me, tick],
  );

  const record = mine ?? browserRecord;
  const onChain = onChainBidFor(auction, me);
  const st: Derived | null =
    mounted && auction ? bidState({ auction, record, onChain, head }) : null;

  if (!auction) {
    return (
      <Shell round={null}>
        <p className="text-sm text-ink-soft">No round is open on the Book right now.</p>
        <p className="mt-2 text-[0.78rem] leading-snug text-ink-faint">
          Nothing to bid on until a keeper opens one. <FaqLink to="keeper">who opens rounds</FaqLink>
        </p>
      </Shell>
    );
  }

  if (!mounted || !st) {
    return (
      <Shell round={auction.round}>
        <p className="text-sm text-ink-faint">Reading this browser for a sealed bid…</p>
      </Shell>
    );
  }

  const bounds = { commitEnd: auction.commitEnd, revealEnd: auction.revealEnd };

  // A RECORD IS NOT A BID.
  //
  // bid.js writes the secret BEFORE opening the wallet, deliberately -- a secret that
  // exists only after confirmation is a secret you lose by closing the tab. But that means
  // a record also exists after the user presses Cancel, and after a commit that reverts.
  // Branching on `record` alone showed those users "Sealed - reveal opens at block N",
  // unmounted the form, and left them unable to bid at all in a round they have nothing in.
  //
  // So a record only counts as a bid once the chain agrees (st.committed) or it at least
  // reached the chain (txHash). Everything else is a dead secret, and bid.js will happily
  // let them try again.
  const reachedChain = Boolean(record && (record as { txHash?: string | null }).txHash);
  const haveBid = st.committed || (record != null && reachedChain);

  // --- a bid of ours exists, on chain or in this browser ------------------------------
  if (haveBid) {
    // Committed on chain, but the secret is not in this browser. The bid is not lost -- it
    // is one browser away -- and the sentence says which browser and offers the way back.
    if (!record) {
      return (
        <Shell round={auction.round}>
          <p className="text-sm text-ink-soft">
            The Book has a sealed bid from {short(address)} in this round, and this browser has no
            secret for it.
          </p>
          <p className="mt-2 text-[0.78rem] leading-snug text-ink-faint">
            Reveal it from the browser you bid in, or paste the bps and salt you copied. Without
            the salt nobody can open this bid, including us.
          </p>
          {me ? (
            <EnterSecret maker={auction.maker} orderHash={auction.orderHash} bidder={me} bounds={bounds} />
          ) : null}
        </Shell>
      );
    }

    const notMine = !!me && record.bidder !== me;

    if (st.revealed || record.state === "revealed") {
      return (
        <Shell round={auction.round}>
          <p className="tnum text-sm text-glass">Revealed ✓ · {record.bps} bps</p>
          <p className="mt-2 text-[0.78rem] leading-snug text-ink-faint">
            Your number is public now and counted by the contract.{" "}
            <FaqLink to="reveal">why reveal matters</FaqLink>
          </p>
        </Shell>
      );
    }

    if (!headUnknown && st.state === "missed") {
      return (
        <Shell round={auction.round}>
          <p className="tnum text-sm text-brick">
            Reveal closed at block {num(auction.revealEnd)} · this bid is void
          </p>
          <p className="mt-2 text-[0.78rem] leading-snug text-ink-soft">
            Nothing was taken from your wallet beyond gas. The bid does not count and the round
            cleared without it. <FaqLink to="reveal">why reveal matters</FaqLink>
          </p>
          <p className="mt-1 text-[0.78rem] text-ink-faint">Bid again in the round now open.</p>
        </Shell>
      );
    }

    // Sealed, reveal not open yet by our reckoning.
    if (!st.canReveal && !headUnknown && head <= auction.commitEnd) {
      return (
        <Shell round={auction.round}>
          <p className="tnum text-sm text-ink">
            Sealed · {record.bps} bps · reveal opens at block {num(auction.commitEnd + 1)}
          </p>
          <p className="tnum mt-1 text-[0.74rem] text-ink-faint">{gloss(st.blocksToCommitEnd + 1)}</p>
          {/* The one sentence the page owes anyone who has committed. Stated once, here,
              where they are waiting -- not as a toast that a person can miss. */}
          <p className="mt-2 border-l-2 border-amber bg-amber-soft px-3 py-2 text-[0.78rem] leading-snug text-ink-soft">
            Keep this tab open. This page cannot reveal for you; if nothing signs the reveal
            between blocks {num(auction.commitEnd + 1)} and {num(auction.revealEnd)}, the bid is void.
          </p>
          {notMine ? (
            <p className="mt-2 text-[0.78rem] text-ink-faint">
              Sealed from {short(record.bidder)} — switch to that account to reveal it.
            </p>
          ) : null}
          {/* Our head is a poll old, so the reveal window can already be open while this
              still says it is not. The primary control stays honest about what we know; this
              secondary one costs a click and gas if it is early (bid.js sends through
              RevealNotOpen rather than aborting) and saves the bid if we are the stale one. */}
          {st.blocksToCommitEnd <= 3 && !notMine ? (
            <details className="mt-2">
              <summary className="cursor-pointer font-mono text-[0.74rem] text-ink-faint">
                our block height is a poll old — reveal anyway?
              </summary>
              <RevealButton record={record} st={st} headUnknown={headUnknown} head={head} />
            </details>
          ) : null}
          <CopySecret orderHash={record.orderHash} bidder={record.bidder} />
        </Shell>
      );
    }

    // Reveal is due (or we cannot prove that it is not).
    return (
      <Shell round={auction.round}>
        <p className="tnum text-sm text-ink">Sealed · {record.bps} bps · #{onChain?.commitIdx ?? "—"}</p>
        <RevealButton record={record} st={st} headUnknown={headUnknown} head={head} />
        <CopySecret orderHash={record.orderHash} bidder={record.bidder} />
      </Shell>
    );
  }

  // --- no bid of ours ------------------------------------------------------------------
  if (st.phase !== "commit" || !st.canCommit) {
    return (
      <Shell round={auction.round}>
        <p className="text-sm text-ink-soft">
          {st.phase === "reveal"
            ? `This round stopped taking bids at block ${num(auction.commitEnd)}. Bidders are opening their sealed numbers now.`
            : st.phase === "exclusive"
              ? "This round is decided. The winner has an exclusive window to fill at the improved price."
              : "This round is finished."}
        </p>
        <p className="mt-2 text-[0.78rem] leading-snug text-ink-faint">
          {/* WAS AN UNCONDITIONAL PROMISE: "The keeper opens a new round every couple of
              minutes." It is not a property of the system, it is a property of whether a
              process happens to be running -- and it was not running for most of today,
              so the panel told every visitor to expect something that was not coming.
              The hedge survives the trim, because dropping it is how the promise came back:
              "a keeper opens the rounds" says nothing about whether one is running now. */}
          A keeper opens the rounds, and nothing here can tell you whether one is running now.{" "}
          <FaqLink to="keeper">who opens rounds</FaqLink>
        </p>
      </Shell>
    );
  }

  if (!isConnected) {
    return (
      <Shell round={auction.round}>
        <p className="tnum text-sm text-ink-soft">
          between {auction.reserveBps} (reserve) and {auction.maxBps} (max) bps
        </p>
        <p className="tnum mt-1 text-[0.74rem] text-ink-faint">
          commit closes at block {num(auction.commitEnd)} · {gloss(st.blocksToCommitEnd)}
        </p>
        <ConnectPrimary />
        {/* The rule the whole site is built on, in four words and a link rather than the
            two sentences that used to sit here. Nothing above this panel needed a wallet
            and nothing above it was withheld until one arrived. */}
        <p className="mt-1 text-[0.74rem] leading-snug text-ink-faint">
          Reading needs no wallet. Only bidding does. <FaqLink to="real">is this real money</FaqLink>
        </p>
      </Shell>
    );
  }

  return (
    <Shell round={auction.round}>
      <BidForm auction={auction} st={st} head={head} headUnknown={headUnknown} />
    </Shell>
  );
}

/**
 * `.card` and `.card-head`, not the hand-composed `border border-rule bg-raised rounded-card
 * shadow-card` recipe this used to spell out. That recipe existed at fifteen call sites on
 * inert figures and clickable tiles alike, which is exactly why nobody could tell which
 * boxes on the site did something (globals.css, "A CONTAINER IS NOT A CONTROL").
 */
function Shell({ round, children }: { round: number | null; children: React.ReactNode }) {
  return (
    <section className="card">
      <div className="card-head">
        <span>Your bid</span>
        {round !== null ? <span className="tnum text-[0.72rem] text-ink-faint">round {num(round)}</span> : null}
      </div>
      {children}
    </section>
  );
}

/**
 * THE STICKY STRIP.
 *
 * A reveal the visitor cannot see is a reveal they will miss, and missing it forfeits the
 * bid. So this is the only fixed element on the page, it appears the moment a reveal is due
 * for the connected wallet, and it has no dismiss control -- there is nothing to dismiss
 * once the deadline has passed, and until then hiding it is the one thing that costs money.
 *
 * Its deadlines come from each RECORD's own copy of the round's boundaries, not from the
 * board, so a round that has scrolled out of the board's six-round window still counts down
 * correctly. When the board does have the round, its bid rows are used as well, so a reveal
 * signed in another browser stops the strip nagging here.
 *
 * `excludeOrderHash` IS A CTA RULE, NOT A TIDY-UP. The instrument is now the front page, so
 * the round whose reveal is due is frequently the round already on screen with its own 44px
 * reveal button -- and the same bid appearing twice, once filled and once outlined, is two
 * controls for one act and two candidate primaries on one view. The page passes the round it
 * is showing; anything else, including a round that has scrolled out of the board entirely,
 * still gets its strip. The premise of this component is "a reveal the visitor cannot see",
 * and a reveal with a button in the panel above is one they can.
 */
export function RevealStrip({
  head,
  auctions = [],
  excludeOrderHash = null,
}: {
  head: number;
  auctions?: Auction[];
  /** The round the page is already showing a reveal control for, if any. */
  excludeOrderHash?: string | null;
}) {
  const mounted = useMounted();
  const tick = useRecordTick();
  const { address } = useAccount();
  const me = address?.toLowerCase() ?? null;
  const headUnknown = !Number.isFinite(head) || head <= 0;

  const skip = excludeOrderHash?.toLowerCase() ?? null;

  const due = useMemo(() => {
    if (!mounted) return [] as { record: BidRecord; st: Derived }[];
    const rows: { record: BidRecord; st: Derived }[] = [];
    // Keyed to the connected account when there is one. When there is not -- a reload during
    // the reveal window, before the wallet has re-authorised the origin -- every record in
    // this browser is shown instead, because the deadline does not wait for a reconnect and
    // a strip that appears only after connecting is a strip that appears too late. The
    // button in each row names the account that has to sign.
    for (const record of listBids(me)) {
      if (skip && record.orderHash?.toLowerCase() === skip) continue;
      const board = auctions.find((a) => a.orderHash?.toLowerCase() === record.orderHash);
      const auction = board ?? boundsFromRecord(record);
      if (!auction) continue; // a typed secret with no boundaries: the card handles it
      const st = bidState({ auction, record, onChain: onChainBidFor(board, me), head });
      if (st.revealed) continue;
      // "Reveal due" here is the same weak predicate the button uses: due when the chain
      // could still accept it, plus the case where we have no head to judge with at all.
      const isDue = st.state === "reveal-due" || (headUnknown && st.committed);
      if (isDue) rows.push({ record, st });
    }
    // Most urgent first: the one with the fewest blocks left is the one about to be lost.
    return rows.sort((a, b) => a.st.blocksToRevealEnd - b.st.blocksToRevealEnd);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted, me, head, headUnknown, auctions, skip, tick]);

  if (due.length === 0) return null;

  return (
    <div
      role="region"
      aria-label="reveals due"
      className="fixed inset-x-0 bottom-0 z-40 border-t-2 border-brick bg-raised/95 backdrop-blur-sm"
    >
      <div className="mx-auto max-w-5xl px-4 py-2">
        {due.map(({ record, st }) => (
          <div
            key={`${record.orderHash}:${record.bidder}`}
            className="flex flex-wrap items-center justify-between gap-3 py-1"
          >
            <span className="tnum min-w-0 text-[0.76rem] text-ink-soft">
              <span className="text-brick">▌</span> sealed {record.bps} bps ·{" "}
              {headUnknown
                ? "block height not read — reveal while you can"
                : `reveal closes at block ${num(record.revealEnd ?? 0)} · ${gloss(st.blocksToRevealEnd)}`}
            </span>
            <span className="min-w-[16rem] flex-1 sm:max-w-sm">
              <RevealButton record={record} st={st} headUnknown={headUnknown} head={head} compact />
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default BidPanel;
