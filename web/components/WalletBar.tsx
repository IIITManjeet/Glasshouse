"use client";

import { useEffect, useState } from "react";
import { useAccount, useChainId, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { base } from "wagmi/chains";
// Plain ESM, deliberately untyped: bid.js is the same file the static page and the Node
// tests load, and adding a .d.ts would create a second place for the shape to drift.
// `allowJs` lets TypeScript infer it, so no suppression is needed or wanted here.
import { explainRevert } from "@/lib/bid.js";

const short = (a?: string | null) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "—");

// The visual idiom is Auction.tsx's: mono, small caps tracking, a rule border, theme tokens
// only. No brand colour, no filled buttons except where urgency is the message.
const BTN = "border px-3 py-1.5 font-mono text-[0.75rem] tracking-[0.02em] transition-colors";
const BTN_IDLE = "border-glass text-glass hover:bg-glass-soft";
const BTN_WARN = "border-brick text-brick hover:bg-brick-soft";
const BTN_OFF = "cursor-not-allowed border-rule bg-sunk text-ink-faint";

/**
 * The wallet surface: connect, the connected address, and the wrong-chain switch.
 *
 * THREE RULES THIS COMPONENT EXISTS TO KEEP.
 *
 * 1. NO WALLET IS A NORMAL STATE. Every number on the board is read from the chain over
 *    plain eth_call and needs no wallet at all, so a visitor without an extension is not
 *    having a problem -- they are having the ordinary experience of the page minus one
 *    feature. It gets one quiet, disabled control that says so, and nothing else: no
 *    modal, no banner, no install link, no repetition.
 *
 * 2. NEVER PROMPT ON LOAD. `eth_requestAccounts` is only ever reached from a click.
 *    wagmi's own reconnect-on-mount is the silent `eth_accounts` path (it asks the wallet
 *    what it already authorises for this origin) and never opens a prompt, which is why it
 *    is left alone; what would be wrong is calling `connect()` from an effect.
 *
 * 3. EVERY FAILURE IS A SENTENCE. Wallet errors go through bid.js's `explainRevert`, which
 *    is the same decoder the bidding panel uses, so a 4001 or a -32002 reaches the screen
 *    as something a person can act on and never as a code or the bare word "error".
 *
 * On the chain switch: wagmi's `switchChain` is used here because this is the wallet
 * surface, but nothing about correctness rests on it. bid.js re-reads `eth_chainId` at the
 * moment it is about to write and refuses to send off Base (`requireConnectedOnBase`), so a
 * wallet that resolves `wallet_switchEthereumChain` before the switch has actually taken
 * effect -- several do -- cannot cause a transaction to land on the wrong chain.
 */
export function WalletBar({ className = "" }: { className?: string }) {
  const [mounted, setMounted] = useState(false);
  const [hasInjected, setHasInjected] = useState(false);
  const [copied, setCopied] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const { address, isConnected, chainId: walletChainId } = useAccount();
  const { connect, connectors, status: connectStatus, error: connectError, reset: resetConnect } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain, status: switchStatus, error: switchError, reset: resetSwitch } = useSwitchChain();
  // The config's chain, used only as a fallback when the connector has not reported one
  // yet. `useAccount().chainId` is the wallet's actual chain and is the one that matters.
  const configChainId = useChainId();

  useEffect(() => {
    setMounted(true);
    // Whether an injected provider exists is a browser fact, so it is read after mount:
    // this app is a static export, the prerendered HTML has no `window`, and reading it
    // during render would make the first client render disagree with the server's.
    setHasInjected(typeof window !== "undefined" && !!(window as { ethereum?: unknown }).ethereum);
  }, []);

  // Errors become a sentence and then clear themselves; a wallet error that stays on screen
  // after the visitor has fixed it is noise. The wagmi hook's own error is reset with it so
  // a second attempt starts clean.
  useEffect(() => {
    const err = connectError ?? switchError;
    if (!err) return;
    setNote(explainRevert(err));
    const t = setTimeout(() => {
      setNote(null);
      resetConnect();
      resetSwitch();
    }, 6000);
    return () => clearTimeout(t);
  }, [connectError, switchError, resetConnect, resetSwitch]);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);

  const chainId = walletChainId ?? (isConnected ? configChainId : undefined);
  // Only claimed when the wallet has actually told us a chain. If it has not, no claim is
  // made here -- bid.js will refuse the write with its own sentence, which is the honest
  // place for that judgement.
  const wrongChain = isConnected && chainId !== undefined && chainId !== base.id;

  const injected = connectors[0];

  function body() {
    // Before mount the answer is genuinely unknown, and a disabled control has to say why
    // it is disabled, so it says that rather than showing a dead `Connect wallet`.
    if (!mounted) {
      return <span className={`${BTN} ${BTN_OFF} inline-block`}>Reading wallet state…</span>;
    }

    if (!hasInjected || !injected) {
      return (
        <button
          type="button"
          disabled
          className={`${BTN} ${BTN_OFF}`}
          title="Bidding needs a browser wallet on Base. Everything else on this page is read from the chain and works without one."
        >
          No wallet found — the board reads fine without one
        </button>
      );
    }

    if (!isConnected) {
      if (connectStatus === "pending") {
        return (
          <button type="button" disabled className={`${BTN} ${BTN_OFF}`}>
            Confirm in wallet…
          </button>
        );
      }
      return (
        <button type="button" className={`${BTN} ${BTN_IDLE}`} onClick={() => connect({ connector: injected })}>
          Connect wallet
        </button>
      );
    }

    if (wrongChain) {
      if (switchStatus === "pending") {
        return (
          <button type="button" disabled className={`${BTN} ${BTN_OFF}`}>
            Confirm in wallet…
          </button>
        );
      }
      return (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={`${BTN} ${BTN_WARN}`} onClick={() => switchChain({ chainId: base.id })}>
            Switch to Base
          </button>
          <span className="tnum text-[0.72rem] text-ink-faint">
            wallet is on chain {chainId} · the Book is on Base (8453)
          </span>
        </div>
      );
    }

    return (
      <details className="relative">
        <summary
          className={`${BTN} ${BTN_IDLE} inline-block cursor-pointer list-none [&::-webkit-details-marker]:hidden`}
        >
          <span className="tnum">{short(address)}</span> · Base
        </summary>
        <div className="absolute right-0 z-30 mt-1 w-72 border border-rule bg-raised rounded-card shadow-card p-2 text-[0.75rem] shadow-sm">
          <button
            type="button"
            className="block w-full px-2 py-1 text-left font-mono text-ink hover:bg-glass-soft"
            onClick={() => {
              if (address) void navigator.clipboard?.writeText(address).then(() => setCopied(true));
            }}
          >
            {copied ? "Copied ✓" : "Copy address"}
          </button>
          <button
            type="button"
            className="block w-full px-2 py-1 text-left font-mono text-brick hover:bg-brick-soft"
            onClick={() => disconnect()}
          >
            Disconnect
          </button>
          {/* EIP-1193 has no disconnect. Saying so is the difference between a control that
              works and one the visitor thinks has failed when the wallet still shows the
              site as connected. */}
          <p className="mt-1 border-t border-rule px-2 pt-1 text-[0.7rem] leading-snug text-ink-faint">
            This forgets the account here; your wallet stays connected on its side.
          </p>
        </div>
      </details>
    );
  }

  return (
    <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 ${className}`}>
      {body()}
      {note ? (
        <span role="status" className="max-w-prose font-mono text-[0.72rem] leading-snug text-brick">
          {note}
        </span>
      ) : null}
    </div>
  );
}

export default WalletBar;
