import type { ReactNode } from "react";

/**
 * ONE REGISTER. NOT TWO.
 *
 * This file used to hold a `TAPE_ROUTES = ["/board", "/evidence"]` list and pick a register
 * by route, on the reasoning that "/ is an argument and /board is an instrument, and those
 * are not the same kind of object". That reasoning was wrong, and the evidence is in
 * `docs/design-direction-2026-09.md`:9-14 -- "a second 'tape' register bolted onto two
 * routes... A venue is one thing, in one register" -- and again at :149-154, where the
 * recorded symptom is that a visitor moving from `/` to `/board` "sees two products".
 *
 * It was the single clearest signal of the problem the whole redesign is fixing: the site
 * read as an essay with an appendix, because two of five routes were literally set in a
 * different register from the other three.
 *
 * WHAT `.tape` IS NOW, and why applying it everywhere is safe rather than sweeping: it is a
 * DENSITY modifier only -- `--radius-card`, `--radius-control`, `--radius-chip`,
 * `--shadow-card`, `font-size`, `line-height` (see `app/globals.css`, the `.tape` block).
 * The colour tokens and the `font-family` that used to live on it were deleted. So there is
 * no longer a second palette or a second face for this to switch between, and the class
 * that used to mean "a different product" now means "the venue's radius and body size".
 *
 * WHY THE WRAPPER SURVIVES AT ALL. Two reasons, both small and both real. The tokens are
 * declared on `.tape` rather than on `:root`, so something has to carry the class; and
 * `min-h-screen` on it is what keeps the ground colour painted to the bottom of a short
 * page. Folding it into `<body>` is a `globals.css` change, and this agent does not own
 * that file.
 *
 * IT IS NO LONGER A CLIENT COMPONENT. `usePathname` was the only thing forcing "use client"
 * here, and it wrapped every route's chrome -- so the header, the status bar and the nav
 * were inside a client boundary for the sole purpose of reading a route this no longer
 * cares about.
 */
export function Theme({ children }: { children: ReactNode }) {
  return <div className="tape min-h-screen">{children}</div>;
}
