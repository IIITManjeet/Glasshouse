"use client";

import { mainnet } from "wagmi/chains";
import { useEnsAvatar, useEnsName } from "wagmi";
import { normalize } from "viem/ens";

import { AddressMark, RoleChip } from "./Address";
import { Copy } from "./Copy";
import type { AddressRole } from "@/lib/identity";

/**
 * Who an address is, as far as anyone can honestly say.
 *
 * A profile page needs an identity, and this project has no database to keep one in --
 * `output: "export"` means there is no server, so a bio we stored would live in one
 * browser's localStorage and be invisible to everybody else, which is the opposite of a
 * profile. ENS is the answer that needs no backend: the name and the avatar are records
 * the address's owner set themselves, on chain, and we only read them.
 *
 * RESOLVED AGAINST ETHEREUM MAINNET, because that is where the registry is. An address
 * that trades on Base still has its name on L1, and asking Base would return nothing for
 * everyone. The mainnet transport in app/providers.tsx exists for exactly this and is
 * never used for a transaction.
 *
 * IT DEGRADES TO THE TRUTH. No name, a failed lookup, or a lookup still in flight all
 * render the same truncated address a table would show. The one thing it must never do is
 * imply an identity it did not resolve, so there is no placeholder name, no generated
 * pseudonym and no identicon standing in for a person.
 *
 * The avatar is NOT trusted as an image source beyond being displayed: ENS avatar records
 * are attacker-controlled URLs, so it is rendered at a fixed size, with no layout
 * influence, and it simply fails to render if the URL is unreachable.
 */

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

const eq = (a?: string | null, b?: string | null) =>
  Boolean(a && b && a.toLowerCase() === b.toLowerCase());

/**
 * WHAT ONE ADDRESS IS, IN ONE ROUND, READ FROM FIELDS AND NEVER GUESSED.
 *
 * `lib/identity.ts` defines the roles and their copy; this decides which of them apply to
 * an address given what a component already holds. It lives here rather than at five call
 * sites because the PRECEDENCE is the part that would drift: the bid ladder, the
 * leaderboard, the receipt and the profile each render the same participant, and three
 * views disagreeing about one address is worse than any single one being wrong -- the same
 * reasoning `components/Auction.tsx` records for "winner" versus "leading".
 *
 * THE ORDER, AND WHY IT IS THAT ORDER.
 *
 *  1. `house` first, always. The maker bidding in its own round is the single disclosure
 *     this site cannot afford to bury, and it stays first even when the reader IS the
 *     maker -- a label about the round outranks a label about the viewer.
 *  2. `you`, because past that point the reader's own position is the most useful fact on
 *     the row.
 *  3. `winner` only when the round has SETTLED; `leading` for the identical position
 *     before settlement, because a later reveal can still take it away. Never both.
 *  4. `filled`, then `maker` -- the two that describe something the address did after, or
 *     outside, the bidding.
 *
 * Returns every role that applies, in that order. A dense table renders `roles[0]` and a
 * header with room renders them all; both read the same list, so they cannot contradict
 * each other about which fact came first.
 */
export function rolesOf(o: {
  addr?: string | null;
  /** The connected wallet, from wagmi's `useAccount()`. */
  you?: string | null;
  /** `Auction.maker` -- the address that opened the round being rendered, when there is one. */
  maker?: string | null;
  /**
   * True when this address is on the row BECAUSE it bid in that round. It is what separates
   * `house` from `maker`: the maker's address printed beside "opened" is the maker, and the
   * same address sitting in the bid ladder of its own round is the house.
   */
  bidder?: boolean;
  /** `Auction.bestBidder`: the best REVEALED bid so far, or the winner once settled. */
  bestBidder?: string | null;
  /** `Auction.settled`. Undefined is treated as not settled, which under-claims on purpose. */
  settled?: boolean | null;
  /** `Auction.filledBy`. */
  filledBy?: string | null;
  /** This address has opened at least one round. For a profile header, which has no round. */
  opened?: boolean | null;
}): AddressRole[] {
  const { addr } = o;
  if (!addr) return [];
  const roles: AddressRole[] = [];
  if (o.bidder && eq(addr, o.maker)) roles.push("house");
  if (eq(addr, o.you)) roles.push("you");
  if (eq(addr, o.bestBidder)) roles.push(o.settled ? "winner" : "leading");
  if (eq(addr, o.filledBy)) roles.push("filled");
  if ((!o.bidder && eq(addr, o.maker)) || o.opened) {
    if (!roles.includes("house")) roles.push("maker");
  }
  return roles;
}

export function useIdentity(address?: string | null) {
  const enabled = Boolean(address && /^0x[0-9a-fA-F]{40}$/.test(address));
  const { data: name, isLoading: nameLoading } = useEnsName({
    address: enabled ? (address as `0x${string}`) : undefined,
    chainId: mainnet.id,
    query: { enabled },
  });
  const { data: avatar } = useEnsAvatar({
    name: name ? normalize(name) : undefined,
    chainId: mainnet.id,
    query: { enabled: Boolean(name) },
  });
  return { name: name ?? null, avatar: avatar ?? null, loading: nameLoading };
}

/** An address with its ENS name if it has one. Inline, for tables and captions. */
export function Identity({
  address,
  className,
  showAvatar = false,
}: {
  address?: string | null;
  className?: string;
  showAvatar?: boolean;
}) {
  const { name, avatar } = useIdentity(address);
  if (!address) return <span className={className}>—</span>;

  return (
    <span className={`inline-flex items-center gap-2 ${className ?? ""}`}>
      {showAvatar && avatar && (
        // eslint-disable-next-line @next/next/no-img-element -- next/image is unavailable
        // under `output: "export"` with the default loader, and this is a third-party URL
        // from an ENS record rather than an asset in this repo.
        <img
          src={avatar}
          alt=""
          width={20}
          height={20}
          className="h-5 w-5 shrink-0 border border-rule object-cover"
        />
      )}
      {name ? (
        <>
          <span className="font-medium text-ink">{name}</span>
          <span className="tnum text-[0.82em] text-ink-faint">{short(address)}</span>
        </>
      ) : (
        <span className="tnum">{short(address)}</span>
      )}
    </span>
  );
}

/**
 * THE LARGER TREATMENT, FOR THE TOP OF A PROFILE -- AND THE ONE HEADER ON THIS SITE WHOSE
 * SUBJECT IS AN ADDRESS.
 *
 * It used to be a 56px box holding two hex characters (`address.slice(2, 4)`) beside the
 * raw 42 characters. Two characters of an address identify nothing, and the header read as
 * a value rather than as a subject. What replaced them is the deterministic mark from
 * `lib/identity.ts` -- still a rendering of the address and still inventing nothing, but
 * the same square this address wears in the rounds table, the bid ladder and the settlement
 * figure, so arriving here confirms you are looking at the participant you clicked.
 *
 * WHAT IS SHOWN, IN THIS ORDER, AND WHY IT ENDS WITH THE WHOLE ADDRESS. The ENS name if the
 * owner set one; otherwise the short hex, as the heading. Then the FULL 42 characters in
 * mono with a copy control, because this is the page a person came to in order to get the
 * address -- a truncated identifier is useless to paste into a block explorer or a `cast`
 * call, and the short form is a convenience, never the record. Then the roles, read from
 * chain fields by the caller.
 *
 * The avatar still wins over the mark when ENS resolves one: real data the owner published
 * beats a rendering we derived, always.
 */
export function IdentityCard({
  address,
  roles = [],
}: {
  address: string;
  /**
   * What this address is, from `rolesOf()` -- computed by the caller, which is the only
   * thing holding the rounds these labels are read from. A header has room for all of
   * them, unlike a table cell.
   */
  roles?: AddressRole[];
}) {
  const { name, avatar, loading } = useIdentity(address);

  return (
    <div className="flex flex-wrap items-start gap-4">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center">
        {avatar ? (
          // eslint-disable-next-line @next/next/no-img-element -- see above
          <img src={avatar} alt="" width={40} height={40} className="h-10 w-10 rounded-[8px] object-cover" />
        ) : (
          // Not an identicon. A generated picture is a face this address never chose, and
          // on a page about provenance an invented identity is the wrong kind of decoration.
          // The mark is not one: it is two hues computed from the address's own bytes, which
          // claims nothing about anybody -- the argument is in lib/identity.ts.
          <AddressMark addr={address} size="lg" />
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <h1 className="font-sans text-2xl font-semibold text-ink">{name ?? short(address)}</h1>
          {roles.map((r) => (
            <RoleChip key={r} role={r} />
          ))}
        </div>

        <div className="mt-1 flex flex-wrap items-baseline">
          <span className="tnum text-sm break-all text-ink-soft">{address}</span>
          <Copy text={address} label="this address" className="shrink-0" />
        </div>

        {!name && (
          <p className="mt-1.5 text-[0.8rem] text-ink-faint">
            {loading
              ? "Looking for an ENS name…"
              : "No ENS name. That is not a judgement — most addresses do not have one."}
          </p>
        )}
      </div>
    </div>
  );
}
