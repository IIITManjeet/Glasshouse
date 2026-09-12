"use client";

import { mainnet } from "wagmi/chains";
import { useEnsAvatar, useEnsName } from "wagmi";
import { normalize } from "viem/ens";

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

/** The larger treatment, for the top of a profile. */
export function IdentityCard({ address }: { address: string }) {
  const { name, avatar, loading } = useIdentity(address);

  return (
    <div className="flex flex-wrap items-center gap-4">
      <div className="flex h-14 w-14 shrink-0 items-center justify-center border border-rule bg-sunk">
        {avatar ? (
          // eslint-disable-next-line @next/next/no-img-element -- see above
          <img src={avatar} alt="" width={56} height={56} className="h-14 w-14 object-cover" />
        ) : (
          // Not an identicon. A generated picture is a face this address never chose, and
          // on a page about provenance an invented identity is the wrong kind of decoration.
          <span className="font-mono text-[0.6875rem] uppercase tracking-[0.12em] text-ink-faint">
            {address.slice(2, 4)}
          </span>
        )}
      </div>
      <div className="min-w-0">
        {name ? (
          <>
            <div className="font-display text-2xl font-semibold text-ink">{name}</div>
            <div className="tnum mt-0.5 text-sm break-all text-ink-faint">{address}</div>
          </>
        ) : (
          <>
            <div className="tnum text-lg break-all text-ink">{address}</div>
            <div className="mt-0.5 text-[0.8rem] text-ink-faint">
              {loading
                ? "Looking for an ENS name…"
                : "No ENS name. That is not a judgement — most addresses do not have one."}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
