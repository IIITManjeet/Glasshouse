"use client";

import { motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";

/**
 * Scroll-triggered entrance, in one place.
 *
 * ui-spec.md section 2.4 previously said "no scroll-triggered anything", written when the
 * page was an essay and every moving thing competed with reading. The product is a
 * different object: it is handed to people cold, and a section that arrives has a rhythm
 * that a section which is simply already there does not. The spec is updated rather than
 * quietly broken.
 *
 * What has NOT changed is the rule underneath it: motion never carries information here.
 * Nothing fades in that you would miss if it did not, nothing is hidden until it animates,
 * and no number arrives late. If every animation on this page were deleted the page would
 * say exactly the same things -- which is the test a decorative animation has to pass.
 *
 * `once: true` because a section that re-animates every time you scroll past it is a
 * section you cannot re-read. `useReducedMotion` collapses it to a plain render rather
 * than a fast one: someone who asked for no motion wants no motion, not brief motion.
 */
export function Reveal({
  children,
  delay = 0,
  className,
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  const reduced = useReducedMotion();
  if (reduced) return <div className={className}>{children}</div>;

  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 14 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.15, margin: "0px 0px -80px 0px" }}
      transition={{ duration: 0.45, delay, ease: [0.22, 0.61, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}
