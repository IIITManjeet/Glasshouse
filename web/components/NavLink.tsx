"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * A nav link that knows whether you are already on it.
 *
 * The header carried four identical links and marked none of them, so a visitor arriving
 * from a shared link had no way to tell where they had landed (DESIGN.md F-6). It is the
 * cheapest orientation cue there is, and it was missing.
 *
 * THE MARK IS NOT COLOUR ALONE. Colour carries it for most people, but `aria-current` is
 * what a screen reader announces, and the underline is what someone who cannot separate the
 * accent from the faint ink still sees. Three signals for one fact, which is the same rule
 * the chip-versus-button pair follows.
 *
 * WHY `usePathname` AND NOT A PROP. This is a static export, so there is no server to hand
 * the layout a current route; the client router is the only thing that knows. Trailing
 * slashes are normalised because `trailingSlash: true` means every real URL has one while
 * the hrefs here do not.
 */
export function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  const pathname = usePathname() ?? "";
  const norm = (s: string) => (s.length > 1 ? s.replace(/\/+$/, "") : s);
  const active = norm(pathname) === norm(href);

  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={
        active
          ? "text-glass underline decoration-glass underline-offset-[6px]"
          : "hover:text-glass"
      }
    >
      {children}
    </Link>
  );
}

export default NavLink;
