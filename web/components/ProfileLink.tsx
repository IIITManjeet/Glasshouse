"use client";

import Link from "next/link";
import { useAccount } from "wagmi";
import { useIdentity } from "./Identity";

/**
 * The way to your own profile, which the nav did not have.
 *
 * There was no link to /account anywhere in the product. The page existed, took an address,
 * and rendered a full profile -- and the only way to reach it was to know the URL and type
 * the query parameter by hand. A feature nobody can navigate to is a feature that is not
 * shipped, and the user found this by clicking around for it and failing.
 *
 * WHAT IT POINTS AT DEPENDS ON WHETHER A WALLET IS CONNECTED, because "my profile" is not a
 * meaningful destination until the page knows whose it is:
 *   connected  -> /profile/<your address>, and it shows your ENS name if you have one
 *   otherwise  -> /account, which is the lookup form for any address
 *
 * It never says "Profile" while pointing at a form that cannot know who you are. The label
 * changes with the destination, so the link and what it does always agree.
 */
export function ProfileLink({ className }: { className?: string }) {
  const { address, isConnected } = useAccount();
  const { name } = useIdentity(isConnected ? address : null);

  if (isConnected && address) {
    return (
      <Link href={`/profile/${address}`} className={className} title={address}>
        {name ?? `${address.slice(0, 6)}…${address.slice(-4)}`}
      </Link>
    );
  }

  return (
    <Link href="/account" className={className}>
      Accounts
    </Link>
  );
}
