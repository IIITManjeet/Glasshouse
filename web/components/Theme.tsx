"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/**
 * Two registers, chosen by route.
 *
 * The site read as the same page four times because it WAS the same page four times: one
 * set of tokens, one type scale, one panel treatment everywhere. But / is an argument and
 * /board is an instrument, and those are not the same kind of object -- a landing page
 * persuades, a terminal reports.
 *
 * So the tool routes render inside `.tape` (app/globals.css): dark-first, mono-primary,
 * amber labels, green for ours, red for revert. The landing keeps the quiet editorial
 * register. Moving between them should feel like moving between two different kinds of
 * thing, because it is.
 *
 * IT WRAPS THE CHROME TOO, not just the page body. The status bar and the nav are part of
 * the instrument when you are in the instrument -- a terminal with a light-mode masthead
 * bolted on top is two designs stapled together, which is the problem this is fixing.
 *
 * Route-driven rather than a user setting on purpose: this is not a theme switcher. Nobody
 * should be able to put the landing page in terminal colours, because the register carries
 * meaning here -- amber means "label" inside `.tape` and "provisional" outside it, and one
 * page cannot be both.
 */
const TAPE_ROUTES = ["/board", "/evidence"];

export function Theme({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "/";
  // startsWith, not equality: trailingSlash: true means the real path is "/board/", and an
  // exact match would silently never fire in production while working in development.
  const tape = TAPE_ROUTES.some((r) => pathname === r || pathname.startsWith(`${r}/`));

  return <div className={tape ? "tape min-h-screen" : undefined}>{children}</div>;
}
