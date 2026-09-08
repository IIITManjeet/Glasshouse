"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAccount, useWaitForTransactionReceipt } from "wagmi";
import { base } from "wagmi/chains";
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
const num = (n: number) => n.toLocaleString("en-US");
const short = (a?: string | null) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "—");

/** Blocks are the fact; seconds are an estimate and are labelled as one. Never a clock time. */
function gloss(blocks: number) {
  const b = Math.max(0, blocks);
  return `${b} block${b === 1 ? "" : "s"} · ~${b * BLOCK_SECONDS}s at ${BLOCK_SECONDS}s/block`;
}

const BTN = "border px-3 py-2 text-left font-mono text-[0.78rem] leading-snug tracking-[0.02em] transition-colors";
const BTN_IDLE = "border-glass text-glass hover:bg-glass-soft";
const BTN_URGENT = "border-brick bg-brick-soft text-brick hover:bg-brick hover:text-raised";
const BTN_LAST = "border-brick bg-brick text-raised";
const BTN_OFF = "cursor-not-allowed border-rule bg-sunk text-ink-faint";
const LABEL = "font-mono text-[0.66rem] uppercase tracking-[0.12em] text-ink-faint";

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
      <button type="button" onClick={copy} className="font-mono text-[0.74rem] text-glass underline underline-offset-2">
        {copied ? "Copied ✓" : "Copy bid secret"}
      </button>
      <p className="mt-1 text-[0.72rem] leading-snug text-ink-faint">
        Stored in this browser only. Copy it if you might reveal from another one — a sealed bid
        can only be opened with its secret, by anyone, including us.
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

  let label: string;
  let cls: string;
  let disabled = false;

  if (stage === "done" || st.revealed) {
    label = "Revealed ✓";
    cls = BTN_OFF;
    disabled = true;
  } else if (stage === "sent" && tx) {
    label = `Revealing · ${short(tx)}${headUnknown ? "" : ` · ${Math.max(0, left)} block${left === 1 ? "" : "s"} left`}`;
    cls = BTN_OFF;
    disabled = true;
  } else if (stage === "wallet") {
    label = `Confirm in wallet…${headUnknown ? "" : ` · ${Math.max(0, left)} block${left === 1 ? "" : "s"} left`}`;
    cls = BTN_OFF;
    disabled = true;
  } else if (!isConnected) {
    label = `Connect ${short(record.bidder)} to reveal this bid`;
    cls = BTN_OFF;
    disabled = true;
  } else if (wrongAccount) {
    // Revealing from the wrong account is a guaranteed NoCommitment revert, so this one is
    // safe to disable: the contract would not accept it from this wallet under any head.
    label = `Sealed from ${short(record.bidder)} — switch to that account to reveal`;
    cls = BTN_OFF;
    disabled = true;
  } else if (chainId !== undefined && chainId !== base.id) {
    label = "Switch to Base to reveal";
    cls = BTN_OFF;
    disabled = true;
  } else if (closed) {
    label = `Reveal closed at block ${num(record.revealEnd ?? 0)} — the bid is void`;
    cls = BTN_OFF;
    disabled = true;
  } else if (headUnknown) {
    // No head means no proof the window has closed, and an unattempted reveal is the only
    // outcome guaranteed to fail. The label says exactly why it is offering anyway.
    label = `Reveal ${record.bps} bps — block height not read, sending anyway`;
    cls = BTN_URGENT;
  } else if (left <= 1) {
    label = `Reveal ${record.bps} bps · ${Math.max(0, left)} block${left === 1 ? "" : "s"} left · may not land`;
    cls = BTN_LAST;
  } else {
    label = `Reveal ${record.bps} bps · ${left} blocks left`;
    cls = left <= 10 ? BTN_URGENT : BTN_IDLE;
  }

  return (
    <div className={compact ? "" : "mt-3"}>
      <button type="button" disabled={disabled} onClick={onClick} className={`${BTN} ${cls} w-full`}>
        {label}
      </button>
      {!compact && !disabled ? (
        <p className={`tnum mt-1 text-[0.74rem] ${left <= 10 && !headUnknown ? "text-brick" : "text-ink-faint"}`}>
          {headUnknown
            ? "the chain head has not been read yet — the contract, not this page, decides whether it is late"
            : left <= 10
              ? `Reveal closes at block ${num(record.revealEnd ?? 0)} — sign now`
              : `closes at block ${num(record.revealEnd ?? 0)} · ${gloss(left)}`}
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
        Paste the bps and salt you copied when you bid. Nothing is validated here — the
        contract checks the pair at reveal, and a wrong one is rejected without costing the bid.
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <input
          inputMode="numeric"
          value={bps}
          onChange={(e) => setBps(e.target.value.replace(/[^0-9]/g, ""))}
          placeholder="bps"
          className="tnum w-24 border border-rule bg-raised px-2 py-1 text-[0.78rem]"
        />
        <input
          value={salt}
          onChange={(e) => setSalt(e.target.value.trim())}
          placeholder="0x… (32 bytes)"
          className="tnum min-w-0 flex-1 border border-rule bg-raised px-2 py-1 text-[0.78rem]"
        />
        <button
          type="button"
          className={`${BTN} ${BTN_IDLE}`}
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

  let label: string;
  let cls = BTN_IDLE;
  let disabled = true;

  if (stage === "done") {
    label = `Sealed ✓ · reveal opens at block ${num(auction.commitEnd + 1)}`;
    cls = BTN_OFF;
  } else if (stage === "sent" && tx) {
    label = `Sealing · ${short(tx)}`;
    cls = BTN_OFF;
  } else if (stage === "wallet") {
    label = "Secret saved · confirm in wallet…";
    cls = BTN_OFF;
  } else if (stage === "checking") {
    label = "Checking the round…";
    cls = BTN_OFF;
  } else if (noWallet) {
    label = "No wallet found — bidding needs one, the board does not";
    cls = BTN_OFF;
  } else if (!isConnected) {
    label = "Connect wallet to bid";
    cls = BTN_OFF;
  } else if (chainId !== undefined && chainId !== base.id) {
    label = "Switch to Base to bid";
    cls = BTN_OFF;
  } else if (!headUnknown && st.blocksToCommitEnd < 0) {
    label = `Commit closed at block ${num(auction.commitEnd)}`;
    cls = BTN_OFF;
  } else if (tooLateToSign) {
    label = `Closing — ${Math.max(0, st.blocksToCommitEnd)} block${st.blocksToCommitEnd === 1 ? "" : "s"} is too few to sign`;
    cls = BTN_OFF;
  } else if (parsed === null) {
    label = `Enter a bid between ${auction.reserveBps} and ${auction.maxBps} bps`;
    cls = BTN_OFF;
  } else if (!inRange) {
    // `commit()` does not range-check; `reveal()` does. A bid outside the range would seal
    // cleanly and could then never be opened, so the page refuses before the contract can.
    label = `${parsed} bps cannot be revealed — this round accepts ${auction.reserveBps} to ${auction.maxBps}`;
    cls = BTN_OFF;
  } else {
    label = `Place sealed bid · ${parsed} bps`;
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
          className="tnum mt-1 block w-32 border border-rule bg-raised px-2 py-1 text-base"
          placeholder={String(auction.reserveBps)}
        />
      </label>
      <p className="tnum mt-1 text-[0.74rem] text-ink-faint">
        between {auction.reserveBps} (reserve) and {auction.maxBps} (max)
      </p>

      <button type="button" disabled={disabled} onClick={submit} className={`${BTN} ${cls} mt-3 w-full`}>
        {label}
      </button>

      <p className="tnum mt-1 text-[0.74rem] text-ink-faint">
        {headUnknown
          ? "chain head not read yet — the commit window is judged by the contract, not by this page"
          : `commit closes at block ${num(auction.commitEnd)} · ${gloss(st.blocksToCommitEnd)}`}
      </p>
      <p className="mt-1 text-[0.74rem] leading-snug text-ink-faint">
        Your number is hashed with a random salt and only the hash is sent. You come back in the
        reveal window and open it — if nothing signs that second transaction, the bid is void.
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
  const anyRecord = useMemo<BidRecord | null>(
    () => (mounted && auction ? pendingBid(auction.orderHash) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mounted, auction?.orderHash, tick],
  );

  const onChain = onChainBidFor(auction, me);
  const st: Derived | null =
    mounted && auction ? bidState({ auction, record: mine, onChain, head }) : null;

  if (!auction) {
    return (
      <Shell round={null}>
        <p className="text-sm text-ink-soft">No round is open on the Book right now.</p>
        <p className="mt-2 text-[0.78rem] leading-snug text-ink-faint">
          The keeper opens a fresh round every couple of minutes when it is running. There is
          nothing to bid on until it does, and this says so rather than showing a form that
          would fail.
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

  // --- a bid of ours exists, on chain or in this browser ------------------------------
  if (st.committed || mine) {
    const record = mine ?? anyRecord;

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
            Your number is public now and counted by the contract. The board&rsquo;s clearing price is
            the runner-up&rsquo;s bid, so revealing is what makes the second price real.
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
            Nothing was taken from your wallet beyond gas. The bid simply does not count, and the
            round cleared without it — which is exactly the cost of silence the bond exists to price.
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
          The keeper opens a new round every couple of minutes. The next one takes bids for its
          whole commit window.
        </p>
      </Shell>
    );
  }

  if (!isConnected) {
    return (
      <Shell round={auction.round}>
        <p className="text-sm text-ink-soft">
          Connect a wallet on Base to place a sealed bid between {auction.reserveBps} and{" "}
          {auction.maxBps} bps.
        </p>
        <p className="tnum mt-1 text-[0.74rem] text-ink-faint">
          commit closes at block {num(auction.commitEnd)} · {gloss(st.blocksToCommitEnd)}
        </p>
        <p className="mt-2 text-[0.78rem] leading-snug text-ink-faint">
          Everything above is read straight from the contract and needs no wallet. Only bidding does.
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

function Shell({ round, children }: { round: number | null; children: React.ReactNode }) {
  return (
    <section className="border border-rule bg-raised p-4">
      <header className="mb-3 flex flex-wrap items-baseline justify-between gap-2 border-b border-rule pb-2">
        <span className={LABEL}>your bid</span>
        {round !== null ? <span className="tnum text-[0.72rem] text-ink-faint">round {num(round)}</span> : null}
      </header>
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
 */
export function RevealStrip({ head, auctions = [] }: { head: number; auctions?: Auction[] }) {
  const mounted = useMounted();
  const tick = useRecordTick();
  const { address } = useAccount();
  const me = address?.toLowerCase() ?? null;
  const headUnknown = !Number.isFinite(head) || head <= 0;

  const due = useMemo(() => {
    if (!mounted || !me) return [] as { record: BidRecord; st: Derived }[];
    const rows: { record: BidRecord; st: Derived }[] = [];
    for (const record of listBids(me)) {
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
  }, [mounted, me, head, headUnknown, auctions, tick]);

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
