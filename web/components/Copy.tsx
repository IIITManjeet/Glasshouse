"use client";

import { useState } from "react";

/**
 * ONE COPY CONTROL, BECAUSE TWO WOULD DRIFT.
 *
 * This was a private component inside `Receipt.tsx`, where it copied a winner's address.
 * The account header needs the same thing for the full 42 characters, and a second
 * hand-rolled clipboard button is how one of them quietly stops handling the failure case.
 * So it is lifted here, unchanged in behaviour, and both surfaces import it.
 *
 * THE FAILURE PATH IS THE REASON IT IS A COMPONENT AT ALL. `navigator.clipboard` throws on
 * an insecure origin and under a restrictive permissions policy. Showing a tick for a copy
 * that did not happen is a small lie of exactly the kind this site is built not to tell, so
 * the catch falls back to `window.prompt`, which puts the text somewhere a person can
 * select it by hand.
 *
 * A glyph rather than a `.btn`: it sits inline at the end of a value, and a bordered
 * control there would read as a second action competing with the page's one primary.
 */
export function Copy({
  text,
  label,
  className = "",
}: {
  text: string;
  label: string;
  className?: string;
}) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      aria-label={`Copy ${label}`}
      title={`Copy ${label}`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch {
          // Clipboard blocked (an insecure origin, or a permissions policy). Say so
          // rather than showing a check for something that did not happen.
          setDone(false);
          window.prompt("Copy this:", text);
        }
      }}
      className={`ml-1.5 align-middle font-mono text-[0.7rem] text-ink-faint hover:text-glass ${className}`}
    >
      {done ? "✓" : "⧉"}
    </button>
  );
}

export default Copy;
