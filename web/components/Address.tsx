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

import { markStyle, ROLE_COPY, type AddressRole } from "@/lib/identity";

const short = (a?: string | null) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "—");

/**
 * THE MARK. Two hues derived from the address, and nothing else.
 *
 * `web/lib/identity.ts` carries the argument for why this is allowed on a site that refuses
 * identicons, so it is not repeated here. The mechanical points that matter at the call
 * site: the colour is computed in CSS from two custom properties, so there is no theme to
 * know and nothing to flash on first paint; and it is `aria-hidden`, because it carries no
 * information a screen reader could use and the address is right beside it.
 *
 * THE ONE EXCEPTION TO "ONE MEANING PER COLOUR" in this design language. Every other hue on
 * the site means something fixed -- teal is the act, amber is provisional, brick is wrong.
 * An address mark is an arbitrary hue, and it is permitted only at 40px or smaller, only on
 * a square, never on text, and never on a line or a column of a chart. Outside those bounds
 * it would start competing with the vocabulary that does carry meaning.
 */
export function AddressMark({
  addr,
  size = "sm",
  className = "",
}: {
  addr?: string | null;
  size?: "sm" | "lg";
  className?: string;
}) {
  if (!addr) return null;
  return (
    <span
      aria-hidden="true"
      style={markStyle(addr)}
      className={`addr-mark ${size === "lg" ? "addr-mark-lg" : ""} ${className}`}
    />
  );
}

/**
 * A ROLE IS READ, NEVER INFERRED. Every value here comes from a chain field or from the
 * connected wallet -- `house` is `bidder === maker`, `winner` is `settled && bidder ===
 * bestBidder`, and so on. The copy lives in `lib/identity.ts` so the table, the bid ladder
 * and the profile header cannot drift into three wordings for one fact.
 *
 * `you` is the only role that takes a colour, because it is the only one that is about the
 * reader rather than about the round.
 */
export function RoleChip({ role }: { role?: AddressRole | null }) {
  if (!role) return null;
  const copy = ROLE_COPY[role];
  return (
    <span className={`chip ${role === "you" ? "chip-live" : ""}`} title={copy.title}>
      {copy.short}
    </span>
  );
}

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
  role,
  mark = true,
}: {
  addr?: string | null;
  /** Extra classes for the address text itself, so each call site keeps its own weight. */
  className?: string;
  /** Overrides the truncated hex, for a name the caller has already resolved. */
  label?: string | null;
  /**
   * What this address IS in the round being rendered. Read from chain fields by the caller,
   * never guessed here -- this component has no idea which auction it is inside.
   */
  role?: AddressRole | null;
  /**
   * The colour mark. On by default, because the whole value of it is that one participant
   * looks the same everywhere. Turn it off only where a mark would be noise: inside a
   * sentence of prose, or in a dense column that already carries one.
   */
  mark?: boolean;
}) {
  if (!addr) return <span className="text-ink-faint">{"—"}</span>;

  return (
    <span className="inline-flex items-baseline gap-1.5">
      {mark ? <AddressMark addr={addr} /> : null}
      <a
        href={recordHref(addr)}
        title={`${addr} — their record on this site`}
        className={`tnum whitespace-nowrap text-glass underline decoration-rule underline-offset-2 hover:decoration-glass ${className}`}
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
      <RoleChip role={role} />
    </span>
  );
}

export default AddressLink;
