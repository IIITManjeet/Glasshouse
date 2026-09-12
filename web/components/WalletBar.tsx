"use client";

import { useEffect, useState } from "react";
import { useAccount, useChainId, useConnect, useDisconnect, useSwitchChain, type Connector } from "wagmi";
import { base } from "wagmi/chains";
// Plain ESM, deliberately untyped: bid.js is the same file the static page and the Node
// tests load, and adding a .d.ts would create a second place for the shape to drift.
// `allowJs` lets TypeScript infer it, so no suppression is needed or wanted here.
import { explainRevert } from "@/lib/bid.js";

const short = (a?: string | null) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "—");

// These now come from the shared control primitives in app/globals.css (DESIGN.md F-3/F-4)
// rather than being defined here. The old rule -- "no filled buttons except where urgency is
// the message" -- produced a page where urgency was never the message and nothing was ever
// emphasised, while a non-clickable provenance chip wore the same border and the same accent
// text as this button. Connect wallet is the primary action of /board and now looks like it.
const BTN = "btn";
const BTN_IDLE = "btn-primary";
const BTN_WARN = "btn-danger";
const BTN_OFF = "";

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
/**
 * WHICH CONNECTORS CAN ACTUALLY CONNECT, asked of the connectors rather than of
 * `window.ethereum`.
 *
 * Lifted out of WalletBar so the header control can ask the same question and get the same
 * answer. It is the one piece of this file that must not be reimplemented: a second,
 * simpler copy would reintroduce both bugs described below, and it would do so only for
 * people whose wallet setup differs from the developer's -- which is the worst possible
 * distribution for a bug.
 *
 * This used to be a single synchronous read of `window.ethereum` in a mount effect, wrong
 * in two ways that both present as "the button says no wallet found and cannot be clicked"
 * while a wallet sits right there in the toolbar.
 *
 *   1. EXTENSIONS INJECT LATE. A one-shot read at mount can run before the extension has
 *      written to `window`, and nothing ever re-read it, so the answer stayed false for
 *      the life of the page.
 *   2. EIP-6963 WALLETS NEED NOT SET `window.ethereum` AT ALL. That is the point of the
 *      standard -- it replaced the single global wallets used to fight over. Rabby, and
 *      MetaMask with "use as default wallet" off, announce by event and may leave the
 *      global undefined. wagmi already discovers these and puts them in `connectors`.
 *
 * So: ask each connector for its provider, and re-ask whenever a wallet announces itself.
 */
export function useAvailableConnectors(): readonly Connector[] {
  const { connectors } = useConnect();
  const [available, setAvailable] = useState<readonly Connector[]>([]);

  useEffect(() => {
    let cancelled = false;

    const probe = async () => {
      const found: Connector[] = [];
      for (const c of connectors) {
        try {
          if (await c.getProvider()) found.push(c);
        } catch {
          // A connector with no provider throws rather than returning undefined in some
          // versions. Not an error worth showing: it is the answer "this one is absent".
        }
      }
      if (!cancelled) setAvailable(found);
    };

    // Asking is what makes EIP-6963 wallets announce; they reply with an announce event.
    try {
      window.dispatchEvent(new Event("eip6963:requestProvider"));
    } catch {
      /* pre-6963 browser; the probe still finds a legacy injected provider */
    }
    void probe();

    const onAnnounce = () => void probe();
    window.addEventListener("eip6963:announceProvider", onAnnounce);
    // One late sweep for a legacy extension that injects after first paint and announces
    // nothing, which no event can tell us about.
    const t = setTimeout(() => void probe(), 1000);

    return () => {
      cancelled = true;
      window.removeEventListener("eip6963:announceProvider", onAnnounce);
      clearTimeout(t);
    };
  }, [connectors]);

  return available;
}

export function WalletBar({ className = "" }: { className?: string }) {
  const [mounted, setMounted] = useState(false);
  const available = useAvailableConnectors();
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

  // The first connector that actually reported a provider. With EIP-6963 discovery on,
  // `connectors[0]` was whichever wallet announced first -- including, when no wallet is
  // installed at all, the bare injected() connector that can never connect.
  const injected = available[0];
  const hasInjected = available.length > 0;

  function body() {
    // Before mount the answer is genuinely unknown, and a disabled control has to say why
    // it is disabled, so it says that rather than showing a dead `Connect wallet`.
    if (!mounted) {
      return <span className={`${BTN}`} aria-disabled="true">Reading wallet state…</span>;
    }

    if (!hasInjected || !injected) {
      return (
        <button
          type="button"
          disabled
          className={`${BTN}`}
          title="Bidding needs a browser wallet on Base. Everything else on this page is read from the chain and works without one."
        >
          No wallet found — the board reads fine without one
        </button>
      );
    }

    if (!isConnected) {
      if (connectStatus === "pending") {
        return (
          <button type="button" disabled className={`${BTN}`}>
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
          <button type="button" disabled className={`${BTN}`}>
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
