"use client";

/**
 * ONE ADDRESS, TWO DESTINATIONS, AND THE IMPORTANT ONE IS FIRST.
 *
 * Every address in this app used to go straight to Basescan -- the receipt's winner, the
 * rounds table, the profile's round list, the timeline's bid ladder. Four places, one
 * destination, and it was off-site. So the indexed record of a bidder, which is the whole
 * point of running a subgraph and the only surface where `Account.provenance` and the
 * sealed-versus-opened count exist, was reachable only by knowing a URL and typing an
 * address into a form. Nothing in the product pointed at it, from the one place a person is
 * already looking at an address.
 *
 * The address text now opens that record. Basescan stays, as a separate arrow, because it
 * answers a different question -- "is this real on chain" -- and the answer to that must
 * always be one click away in a project whose whole claim is checkability. Two targets, two
 * hit areas, neither disguised as the other.
 *
 * WHY A PLAIN <a> AND NEVER next/link. `/profile/<addr>` is not a route in the exported app:
 * `output: "export"` cannot resolve a dynamic segment with no server to resolve it against,
 * so the path exists only as a rewrite onto `/account/?a=<addr>` -- served by vercel.json in
 * production, and by the dev-parity rewrite in next.config.mjs under `next dev`. next/link
 * routes on the CLIENT: it looks the path up in the routes this build produced, does not
 * find one, and renders 404 without ever making a request. A real navigation gets the
 * rewrite. components/StatusBar.tsx hit this exact bug and documents it; this is the same
 * rule, in the one place that now owns it for the whole app.
 */

const short = (a?: string | null) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "—");

export function recordHref(addr: string) {
  return `/profile/${encodeURIComponent(addr)}`;
}

export function basescanHref(addr: string) {
  return `https://basescan.org/address/${addr}`;
}

export function AddressLink({
  addr,
  className = "",
  label,
}: {
  addr?: string | null;
  /** Extra classes for the address text itself, so each call site keeps its own weight. */
  className?: string;
  /** Overrides the truncated hex, for a name the caller has already resolved. */
  label?: string | null;
}) {
  if (!addr) return <span className="text-ink-faint">{"—"}</span>;

  return (
    <span className="inline-flex items-baseline gap-1">
      <a
        href={recordHref(addr)}
        title={`${addr} — their record on this site`}
        className={`tnum text-glass underline decoration-rule underline-offset-2 hover:decoration-glass ${className}`}
      >
        {label ?? short(addr)}
      </a>
      <a
        href={basescanHref(addr)}
        target="_blank"
        rel="noopener noreferrer"
        title={`${addr} on Basescan`}
        aria-label="On Basescan"
        className="text-[0.7rem] leading-none text-ink-faint hover:text-glass"
      >
        {"↗"}
      </a>
    </span>
  );
}

export default AddressLink;
