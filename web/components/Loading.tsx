"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";

/**
 * Loading states that say what is actually happening.
 *
 * THE RULE THIS OBEYS. ui-spec.md 2.4 bans skeleton shimmer, and Auction.tsx puts the
 * reason plainly: "a spinner would say 'loading', which is a different and false claim".
 * A skeleton draws the shape of data that has not arrived and may never -- an RPC call can
 * fail, and Base's public endpoint rate-limits. Drawing four grey bars where four rows will
 * go is a promise the page cannot keep.
 *
 * So: a sentence naming the actual operation, and a 1px INDETERMINATE bar. Indeterminate is
 * the honest bar here -- an eth_call has no measurable progress, so a percentage would be a
 * number with nothing behind it, which is the one thing this project refuses everywhere
 * else. ui-spec 2.4 already allows exactly this shape for a pending CTA.
 *
 * The transition matters more than the loader. Data that snaps in re-lays out the page under
 * whatever the reader was looking at; a cross-fade of a few hundred milliseconds makes the
 * arrival legible without pretending it took longer than it did.
 */

/** The bar. One pixel, indeterminate, and it never claims a percentage. */
export function LoadingBar({ className }: { className?: string }) {
  const reduced = useReducedMotion();
  return (
    <div className={`relative h-px w-full overflow-hidden bg-rule ${className ?? ""}`}>
      {reduced ? (
        <div className="absolute inset-y-0 left-0 w-1/3 bg-glass" />
      ) : (
        <motion.div
          className="absolute inset-y-0 w-1/3 bg-glass"
          initial={{ left: "-33%" }}
          animate={{ left: ["-33%", "100%"] }}
          transition={{ duration: 1.1, repeat: Infinity, ease: "easeInOut" }}
        />
      )}
    </div>
  );
}

/**
 * A named operation in flight.
 *
 * `what` is the operation in the product's own words -- "Reading the Book", not "Loading".
 * `detail` is the sentence a reader needs if it takes longer than they expected: which
 * endpoint, why it might be slow, what happens if it fails.
 */
export function Loading({
  what,
  detail,
  className,
}: {
  what: string;
  detail?: ReactNode;
  className?: string;
}) {
  const reduced = useReducedMotion();
  return (
    <motion.div
      role="status"
      aria-live="polite"
      className={`border border-rule bg-raised rounded-card shadow-card ${className ?? ""}`}
      initial={reduced ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2 }}
    >
      <LoadingBar />
      <div className="px-4 py-4">
        <p className="font-mono text-[0.72rem] uppercase tracking-[0.12em] text-ink-soft">
          {what}
          <Ellipsis />
        </p>
        {detail && <p className="mt-2 max-w-xl text-sm text-ink-faint">{detail}</p>}
      </div>
    </motion.div>
  );
}

/** Three dots that arrive one at a time. Static when reduced motion is asked for -- and
 *  static means all three shown, not none, so the sentence still reads as unfinished. */
function Ellipsis() {
  const reduced = useReducedMotion();
  if (reduced) return <span>…</span>;
  return (
    <span aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          initial={{ opacity: 0.2 }}
          animate={{ opacity: [0.2, 1, 0.2] }}
          transition={{ duration: 1.4, repeat: Infinity, delay: i * 0.18, ease: "easeInOut" }}
        >
          .
        </motion.span>
      ))}
    </span>
  );
}

/**
 * Cross-fade between a loading state and what replaces it.
 *
 * `mode="wait"` so the outgoing state finishes before the incoming one starts. Overlapping
 * them makes the page height jump twice, and a layout that moves while somebody is reading
 * is worse than one that takes 200 ms longer to settle.
 */
export function Swap({ showing, children }: { showing: string; children: ReactNode }) {
  const reduced = useReducedMotion();
  if (reduced) return <>{children}</>;
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={showing}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -6 }}
        transition={{ duration: 0.22, ease: [0.22, 0.61, 0.36, 1] }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
