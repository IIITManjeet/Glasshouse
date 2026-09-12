"use client";

import { useEffect, useState } from "react";
import { useAccount, useConnect, useDisconnect } from "wagmi";
import { useAvailableConnectors } from "./WalletBar";
import { AddressMark, recordHref } from "./Address";

/**
 * CONNECT A WALLET, FROM ANYWHERE, WITHOUT BEING ASKED TO.
 *
 * The connect control lived only on /board, so on four of the five pages there was no way
 * to tell that bidding was even possible — and no way to do it without first finding the
 * board. This puts the affordance in the masthead where a visitor looks for it.
 *
 * IT IS DELIBERATELY NOT A GATE, and that is the whole point of the design.
 *
 * The proposal it answers was to put a wallet connect in front of the site and let people
 * in afterwards. That would contradict the product: this thing argues that you do not have
 * to trust it because you can check it yourself, and a page that says "connect first, then
 * I will show you the evidence" says the opposite in the one place a reader is deciding
 * whether to believe it. It also fails on the day — a judge with a list and ten minutes
 * does not sign anything to read a table.
 *
 * So the rule the site already had stands, and is now visible everywhere rather than only
 * where it was written down: READING NEEDS NO WALLET, BIDDING DOES. This is quiet, sits
 * after the nav, and never blocks anything.
 *
 * IT RENDERS NOTHING UNTIL MOUNTED. A static export has no wallet at HTML-generation time,
 * so anything account-dependent painted during the server render disagrees with the client
 * and React discards the tree. `mounted` is the standard fix and is the same one WalletBar
 * uses; the gap is invisible because this is chrome rather than content.
 *
 * IT IS NOW THE ONLY PLACE THE ADDRESS APPEARS, and that is a correction.
 *
 * This file used to say: "IT OFFERS NO CHAIN SWITCHING, no address copy, no balance. Those
 * live in WalletBar on the board, next to the bidding it serves. A second, subtly different
 * wallet UI is how two of them drift apart." The reasoning was right and the outcome was
 * the thing it warned about: WalletBar grew its own address disclosure with a copy control
 * and a disconnect, so a connected visitor saw their address TWICE on one screen -- once in
 * the masthead and once above the bid panel -- and only the lower one could reach their
 * profile. Two wallet UIs, drifted apart, exactly as predicted.
 *
 * So the menu moved up here rather than being deleted: identity belongs in the chrome,
 * where it is the same in every route. WalletBar keeps only what is contextual to bidding
 * -- the connect path and "Switch to Base" -- and renders nothing at all once you are
 * connected on the right chain.
 *
 * THE OLD CONNECTED STATE WAS ALSO A HAZARD. It was a bare button whose onClick called
 * `disconnect()` with `title="Disconnect"` as the only warning, so clicking your own
 * address -- the obvious thing to click to see your account -- silently dropped the wallet.
 * It is a menu now: your record, copy, disconnect.
 */
export function WalletChip() {
  const [mounted, setMounted] = useState(false);
  const [copied, setCopied] = useState(false);
  useEffect(() => setMounted(true), []);

  const { address, isConnected } = useAccount();
  const { connect, status } = useConnect();
  const { disconnect } = useDisconnect();
  const available = useAvailableConnectors();

  if (!mounted) return null;

  if (isConnected && address) {
    return (
      <details className="relative">
        <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 whitespace-nowrap text-[0.8125rem] text-ink-soft hover:text-glass [&::-webkit-details-marker]:hidden">
          <AddressMark addr={address} />
          <span className="tnum">
            {address.slice(0, 6)}…{address.slice(-4)}
          </span>
          <span aria-hidden="true" className="text-[0.6rem] text-ink-faint">
            ▾
          </span>
        </summary>
        <div className="card absolute right-0 z-30 mt-2 w-[17rem] p-2 text-left">
          <p className="tnum px-2 pt-2 pb-2 text-[0.7rem] leading-snug break-all text-ink-faint">
            {address}
          </p>
          <a
            href={recordHref(address)}
            className="block rounded-control px-2 py-1.5 text-[0.8125rem] text-ink hover:bg-glass-soft hover:text-glass"
          >
            Your record on this site →
          </a>
          <button
            type="button"
            className="block w-full rounded-control px-2 py-1.5 text-left text-[0.8125rem] text-ink hover:bg-glass-soft"
            onClick={() => {
              void navigator.clipboard?.writeText(address).then(() => setCopied(true));
            }}
          >
            {copied ? "Copied ✓" : "Copy address"}
          </button>
          <button
            type="button"
            className="block w-full rounded-control px-2 py-1.5 text-left text-[0.8125rem] text-brick hover:bg-brick-soft"
            onClick={() => disconnect()}
          >
            Disconnect
          </button>
          {/* EIP-1193 HAS NO DISCONNECT, and saying so is the difference between a control
              that works and one the visitor thinks has failed because their wallet still
              lists the site as connected. Carried over verbatim from WalletBar, which used
              to own this menu. */}
          <p className="mt-2 border-t border-rule px-2 pt-2 text-[0.7rem] leading-snug text-ink-faint">
            This forgets the account here; your wallet stays connected on its side.
          </p>
        </div>
      </details>
    );
  }

  // NO WALLET IS A STATE, NOT A FAILURE. Saying "no wallet" plainly beats a button that
  // looks clickable and does nothing, which is what this said before the connector
  // discovery in WalletBar was fixed.
  if (available.length === 0) {
    return (
      <span className="whitespace-nowrap text-[0.8125rem] text-ink-faint" title="Reading needs no wallet; only bidding does">
        no wallet
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={() => connect({ connector: available[0] })}
      disabled={status === "pending"}
      className="whitespace-nowrap text-[0.8125rem] font-medium text-glass hover:underline disabled:opacity-60"
    >
      {/* One word. The masthead is not where the offer gets explained -- the bid panel's own
          primary reads "Connect wallet to bid" and is the control that means it. Two
          controls a page apart both reading "Connect wallet", one of them the page's
          loudest element, is how the preamble ended up outranking the act. */}
      {status === "pending" ? "connecting…" : "Connect"}
    </button>
  );
}
