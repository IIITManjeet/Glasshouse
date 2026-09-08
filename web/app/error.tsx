"use client";

import { useEffect } from "react";

/**
 * The route-level error boundary.
 *
 * WHY THIS EXISTS. Without one, a single component throwing takes the whole page to a
 * blank screen with the error only in the console -- which is exactly what happened: one
 * `undefined.toLocaleString()` from a field that existed on one data path and not the
 * other, and the entire board vanished.
 *
 * A board that reads live chain data will hit malformed or missing data eventually. The
 * honest response is to say what broke and offer a way forward, not to disappear. Nothing
 * here pretends the error did not happen, and nothing retries silently.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Kept in the console in full: the sentence below is for the reader, the stack is for
    // whoever has to fix it.
    console.error("[glasshouse] render failed:", error);
  }, [error]);

  return (
    <main className="mx-auto max-w-2xl py-16">
      <h1 className="font-display text-2xl font-light">Something on this page failed to render.</h1>
      <p className="mt-4 text-ink-soft">
        The contracts are unaffected — this is a fault in the page, not on chain. Every auction
        is readable directly from{" "}
        <a
          className="text-glass underline underline-offset-2"
          href="https://basescan.org/address/0xc4ea91Fe700918220423ac307C6B1c59650FFbfe"
          target="_blank"
          rel="noopener"
        >
          the Book on Basescan
        </a>{" "}
        whatever this page does.
      </p>

      <pre className="tnum mt-5 overflow-x-auto border border-rule bg-sunk p-3 text-[0.78rem] text-ink-soft">
        {error.message}
        {error.digest ? `\n\ndigest: ${error.digest}` : ""}
      </pre>

      <div className="mt-6 flex flex-wrap gap-3">
        <button
          onClick={reset}
          className="border border-glass bg-glass-soft px-4 py-2 font-mono text-[0.8rem] text-glass hover:bg-glass hover:text-raised"
        >
          Try again
        </button>
        <a
          href="/"
          className="border border-rule px-4 py-2 font-mono text-[0.8rem] text-ink-soft hover:border-glass hover:text-glass"
        >
          Back to the board
        </a>
      </div>

      <p className="mt-6 text-sm text-ink-faint">
        If it keeps failing, the page may be reading a chain it does not expect. Check the{" "}
        <code className="font-mono">?rpc=</code> parameter, or open{" "}
        <a className="text-glass underline underline-offset-2" href="/">
          the board with no parameters
        </a>{" "}
        to read Base mainnet.
      </p>
    </main>
  );
}
