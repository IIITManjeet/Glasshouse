"use client";

import Link from "next/link";
import { useAccount } from "wagmi";
import { useBoard } from "./BoardProvider";
import { useDemoMode } from "@/lib/useAuctions";
import { useIdentity } from "./Identity";

/**
 * The provenance line, promoted to page chrome.
 *
 * The source chip used to live inside each figure, which meant a visitor learned where the
 * numbers came from only on the pages that had figures, and a screenshot of any other page
 * carried no provenance at all. DESIGN.md section 2 wants every number labelled; this makes
 * the label a property of the PAGE, so it is in every screenshot by construction.
 *
 * THE REHEARSAL TOGGLE LIVES HERE, not in the nav, and that placement is the argument: it
 * is not a destination, it is a statement about where the numbers come from. Putting the
 * control that changes the source on the line that names the source means the two can never
 * be read apart -- and when it is on, the whole bar turns amber, so the page cannot look
 * live while showing simulated data.
 *
 * The connected address lives here too, and IS the link to its own profile. That single
 * placement fixes the bug the user hit: there was no way to reach /account from anywhere in
 * the product.
 */

const num = (n: number) => n.toLocaleString("en-US");
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export function StatusBar() {
  const { head, source, isFork, loading } = useBoard();
  const { demo, setDemo } = useDemoMode();
  const { address, isConnected } = useAccount();
  const { name } = useIdentity(isConnected ? address : null);

  const where =
    source === "sim"
      ? "SIMULATED"
      : source === "chain"
        ? isFork
          ? "LOCAL FORK"
          : "BASE MAINNET"
        : source === "snapshot"
          ? "SNAPSHOT IN REPO"
          : loading
            ? "READING…"
            : "NO SOURCE";

  return (
    <div
      className={[
        "mb-8 flex flex-wrap items-center gap-x-5 gap-y-2 border-y px-3 py-2",
        "font-mono text-[0.6875rem] tracking-[0.1em] uppercase",
        demo ? "border-amber bg-amber-soft text-amber" : "border-rule bg-sunk text-ink-faint",
      ].join(" ")}
    >
      <span className={demo ? "" : source === "chain" && !isFork ? "text-glass" : "text-amber"}>
        {where}
      </span>

      {head > 0 && (
        <span className="tnum">
          head <span className={demo ? "" : "text-ink-soft"}>{num(head)}</span>
          {source === "sim" && <span className="ml-1 normal-case">(synthetic)</span>}
        </span>
      )}

      <span className="hidden sm:inline">
        phase computed here, against that block
      </span>

      <span className="ml-auto flex items-center gap-4">
        <button
          type="button"
          onClick={() => setDemo(!demo)}
          aria-pressed={demo}
          // A standing mode, not an action, so .btn-toggle rather than a button variant.
          // The pressed look is driven by aria-pressed above, so the visible state and the
          // announced state cannot drift apart.
          className="btn btn-toggle" 
        >
          Rehearsal {demo ? "on" : "off"}
        </button>

        {isConnected && address ? (
          // A PLAIN <a>, NOT next/link, and that distinction is the whole bug.
          //
          // /profile/<addr> is a Vercel edge rewrite onto /account/?a=<addr>. It is not a
          // route in the exported app, because `output: "export"` cannot resolve a dynamic
          // segment with no server to resolve it against. next/link routes on the CLIENT:
          // it looks the path up in the routes this build produced, does not find one, and
          // renders 404 without ever making a request.
          //
          // curl, which makes a real request, gets 200 from the rewrite. That gap is
          // exactly why this shipped broken and tested clean, and why the check for a
          // rewritten path has to be a browser navigation rather than a status code.
          <a
            href={`/profile/${address}`}
            title={address}
            className={demo ? "underline underline-offset-2" : "text-glass underline underline-offset-2"}
          >
            {name ?? short(address)}
          </a>
        ) : (
          <Link
            href="/account"
            className={demo ? "underline underline-offset-2" : "hover:text-glass"}
          >
            Accounts
          </Link>
        )}
      </span>
    </div>
  );
}
