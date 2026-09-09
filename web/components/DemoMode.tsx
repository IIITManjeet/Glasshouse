"use client";

import { useDemoMode } from "@/lib/useAuctions";

/**
 * The control and the warning for the rehearsal.
 *
 * The banner, and only the banner. The switch that used to live beside it moved into
 * components/StatusBar.tsx, because it is not a destination -- it is a statement about
 * where the numbers come from, and it belongs on the line that names the source.
 *
 * This is the piece of UI that exists to tell a visitor the page is lying to them on
 * purpose. It is written to be impossible to miss and impossible to dismiss.
 */

export function DemoBanner() {
  const { demo, setDemo } = useDemoMode();
  if (!demo) return null;
  return (
    <div
      role="status"
      className="mb-6 border-l-2 border-amber bg-amber-soft px-4 py-3 text-sm text-ink-soft"
    >
      <p>
        <strong className="font-medium text-amber">
          Rehearsal — every number below is simulated.
        </strong>{" "}
        Nothing here was read from Base or from any chain. A round on Base takes 75 blocks,
        about two and a half minutes, and the keeper only opens one while it is running — so
        this replays the full lifecycle at{" "}
        <span className="tnum">1 block / 0.4 s</span> against the same components, using the
        contract&rsquo;s own arithmetic over assigned bids.
      </p>
      <p className="mt-2 text-[0.82rem] text-ink-faint">
        Produced by <code className="font-mono">web/lib/simulate.js</code>. The block numbers
        below count from a chosen origin and are not Base blocks. Bidding is disabled: a
        commitment signed against a synthetic order hash could never be revealed.{" "}
        <button
          type="button"
          onClick={() => setDemo(false)}
          className="text-glass underline underline-offset-2"
        >
          Show the real chain instead
        </button>
        .
      </p>
    </div>
  );
}
