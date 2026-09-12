"use client";

import { useEffect, useState } from "react";
import { useAccount, useConnect, useDisconnect } from "wagmi";
import { useAvailableConnectors } from "./WalletBar";

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
 * IT OFFERS NO CHAIN SWITCHING, no address copy, no balance. Those live in WalletBar on
 * the board, next to the bidding it serves. A second, subtly different wallet UI is how
 * two of them drift apart.
 */
export function WalletChip() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const { address, isConnected } = useAccount();
  const { connect, status } = useConnect();
  const { disconnect } = useDisconnect();
  const available = useAvailableConnectors();

  if (!mounted) return null;

  if (isConnected && address) {
    return (
      <button
        type="button"
        onClick={() => disconnect()}
        title="Disconnect"
        className="tnum whitespace-nowrap text-[0.8125rem] text-ink-soft hover:text-glass"
      >
        {address.slice(0, 6)}…{address.slice(-4)}
      </button>
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
      {status === "pending" ? "connecting…" : "Connect wallet"}
    </button>
  );
}
