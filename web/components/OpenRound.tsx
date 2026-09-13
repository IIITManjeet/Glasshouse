"use client";

import { useEffect, useState } from "react";
import { useAccount, useConnect, useWaitForTransactionReceipt } from "wagmi";
import { useAvailableConnectors } from "@/components/WalletBar";
import { Wallet } from "./Icon";
// Plain ESM, deliberately untyped: bid.js is the same file the static page and the Node
// tests load, and a .d.ts would be a second place for the shape to drift.
import { openRound as openRoundJs, explainRevert as explainRevertJs } from "@/lib/bid.js";

/**
 * OPEN A ROUND FROM THE WEBSITE.
 *
 * WHY THIS BUTTON CAN EXIST. `GlasshouseBook.open()` is `external` with no access control
 * (GlasshouseBook.sol:118) and keys the auction by `key(msg.sender, orderHash)`. A round is
 * therefore not something this deployment grants anybody -- whoever pays the gas becomes its
 * maker. That was true from the first commit and nothing on the site used it: every round
 * this Book has ever seen was opened from a terminal, which is a strange property for a
 * product whose front door is supposed to be the instrument.
 *
 * WHAT IT DOES NOT DO, SAID BEFORE THE WALLET OPENS AND NOT AFTER. `openRound` calls
 * `open()` and nothing else. It ships no SwapVM order to Aqua, approves no token and moves
 * no funds, so NOTHING OPENED HERE CAN BE FILLED -- `bid.js` returns `unfillable: true`
 * unconditionally for exactly that reason, and its own comment records that making the flag
 * conditional on who chose the hash would have been a flattering lie. The auction is real in
 * every other respect: real sealed commits, a real reveal window, real second-price
 * clearing, a real receipt.
 *
 * The sentence below is rendered ALWAYS, above the control, before any prompt exists. That
 * is the same ordering rule the bid secret follows in bid.js -- the thing a person needs in
 * order to decide is on screen before the decision, never in a toast afterwards.
 */

type OpenResult = {
  txHash: string;
  maker: string;
  orderHash: string;
  unfillable: boolean;
  generatedHash: boolean;
};

const openRound = openRoundJs as (
  args?: Record<string, unknown>,
  options?: Record<string, unknown>,
) => Promise<OpenResult>;
const explainRevert = explainRevertJs as (e: unknown) => string;

// A Basescan link is only true on mainnet. On a fork the hash exists and the explorer has
// never heard of it, so the hash is shown as plain text rather than as a link that 404s.
// Same test BidPanel makes, from the same parameter.
function isFork(): boolean {
  if (typeof window === "undefined") return false;
  const rpc = new URLSearchParams(window.location.search).get("rpc");
  return !!rpc && /127\.0\.0\.1|localhost/.test(rpc);
}

const short = (h: string) => `${h.slice(0, 10)}…${h.slice(-6)}`;

export function OpenRound({
  variant = "secondary",
  className = "",
}: {
  /** `primary` only where this is the page's one filled control. globals.css: one per view. */
  variant?: "primary" | "secondary";
  className?: string;
}) {
  const [mounted, setMounted] = useState(false);
  const [stage, setStage] = useState<"idle" | "wallet" | "sent">("idle");
  const [tx, setTx] = useState<string | null>(null);
  const [opened, setOpened] = useState<OpenResult | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const { isConnected } = useAccount();
  const { connect, status: connectStatus } = useConnect();
  const available = useAvailableConnectors();
  const injected = available[0];

  const receipt = useWaitForTransactionReceipt({
    hash: (tx ?? undefined) as `0x${string}` | undefined,
    query: { enabled: !!tx },
  });

  useEffect(() => {
    setMounted(true);
  }, []);

  // THE NAVIGATION WAITS FOR THE RECEIPT, and that is not politeness. `/r/<hash>?m=<maker>`
  // reads the auction straight out of the Book; arriving there before the transaction is
  // mined would show "the Book has no auction for this maker and hash", which is true at
  // that instant and reads as a failure of the thing that just succeeded.
  useEffect(() => {
    if (!tx) return;
    // A WATCHER THAT FAILED IS NOT A TRANSACTION THAT FAILED, and the difference has to
    // reach the screen: the round may well be open. The hash stays on screen with its
    // Basescan link, which is the one thing that settles the question.
    if (receipt.status === "error") {
      setStage("idle");
      setNote(
        "The transaction was sent and this page lost track of it — that is a failure of the watch, not necessarily of the round. Open the hash below to see whether it landed.",
      );
      return;
    }
    if (!opened || receipt.status !== "success") return;
    if (receipt.data?.status === "reverted") {
      setStage("idle");
      setTx(null);
      setOpened(null);
      setNote(
        "The transaction was sent and the chain rejected it, so no round was opened and nothing was spent beyond gas.",
      );
      return;
    }
    // A plain assignment, never `next/link`: `/r/<hash>` is a Vercel rewrite, and the
    // router would try to resolve a route this static export does not contain.
    window.location.assign(`/r/${opened.orderHash}/?m=${opened.maker}`);
  }, [tx, opened, receipt.status, receipt.data]);

  async function go() {
    setNote(null);
    setStage("wallet");
    try {
      const res = await openRound();
      setOpened(res);
      setTx(res.txHash);
      setStage("sent");
    } catch (e) {
      setStage("idle");
      setNote(explainRevert(e));
    }
  }

  const cls = `btn btn-${variant}`;

  function control() {
    // Before mount the answer is genuinely unknown, and a disabled control has to say why
    // it is disabled. Matching WalletBar, which learned this the same way.
    if (!mounted) {
      return (
        <span className="btn btn-secondary" aria-disabled="true">
          Reading wallet state…
        </span>
      );
    }

    if (!injected) {
      return (
        <button
          type="button"
          disabled
          className="btn btn-secondary"
          title="Opening a round needs a browser wallet on Base. Everything else on this page is read from the chain and works without one."
        >
          No wallet found — opening a round needs one
        </button>
      );
    }

    if (!isConnected) {
      return (
        <button
          type="button"
          className="btn btn-secondary"
          disabled={connectStatus === "pending"}
          onClick={() => connect({ connector: injected })}
        >
          <Wallet />
          {connectStatus === "pending" ? "Confirm in wallet…" : "Connect a wallet to open one"}
        </button>
      );
    }

    if (stage === "sent") {
      return (
        <span className="btn btn-secondary" aria-disabled="true">
          Waiting for the block…
        </span>
      );
    }

    return (
      <button
        type="button"
        className={cls}
        disabled={stage === "wallet"}
        onClick={go}
      >
        {stage === "wallet" ? "Confirm in wallet…" : "Open a practice round from this wallet"}
      </button>
    );
  }

  return (
    <div className={className}>
      {/* ALWAYS, AND ABOVE THE CONTROL. Not a disclosure, not a tooltip, not a line that
          appears after the wallet has already asked for a signature. */}
      <p className="max-w-prose text-[0.78rem] leading-snug text-ink-soft">
        A real sealed-bid auction on Base, with real second-price clearing and no order behind
        it: nothing can be filled. Bond 0. You pay the gas to open.
      </p>

      <div className="mt-3">{control()}</div>

      {tx ? (
        <p className="mt-2 text-[0.74rem] text-ink-faint">
          {isFork() ? (
            <span className="tnum">open sent · {short(tx)}</span>
          ) : (
            <a
              href={`https://basescan.org/tx/${tx}`}
              target="_blank"
              rel="noopener"
              className="tnum text-glass hover:underline"
            >
              open sent · {short(tx)} ↗
            </a>
          )}
          <span className="ml-2">
            {receipt.status === "success"
              ? "mined — opening the round page"
              : "waiting for the block that includes it"}
          </span>
        </p>
      ) : null}

      {note ? (
        <p role="status" className="mt-2 max-w-prose text-[0.74rem] leading-snug text-brick">
          {note}
        </p>
      ) : null}
    </div>
  );
}

export default OpenRound;
