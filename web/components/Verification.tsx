"use client";

import { useEffect, useState } from "react";

/**
 * THE INDEPENDENT VERIFIER'S LAST RUN, ON THE PAGE.
 *
 * `scripts/verify-run.mjs` is the strongest evidence this project has: it reads the Book's
 * logs, re-derives every auction outcome from the raw reveals without importing any of the
 * three implementations of the clearing rule, and reports whether they agree. It was also
 * completely invisible, because running it needs a terminal, a Node install and an RPC —
 * and nobody evaluating a hackathon project opens a terminal.
 *
 * So the run is emitted as an artifact (`scripts/verify-run.mjs --emit` writes
 * `site/data/verification.js`, which `web/scripts/sync-assets.mjs` copies into the app, the
 * same path `snapshot.js` already takes) and rendered here.
 *
 * IT IS A SNAPSHOT OF A RUN, NOT A LIVE CHECK, and everything about how it is presented has
 * to keep saying so. It prints the block it was taken at, the RPC it asked, and when. A
 * panel that implied it had just re-verified the chain on page load would be a more
 * sophisticated version of the exact lie this whole project is built to refuse.
 *
 * THE FAILURES ARE SHOWN FIRST AND IN FULL. Two of the eight checks currently fail on
 * mainnet, because the Book has never seen a reveal or a settlement. Hiding that would be
 * absurd here: the verifier's entire worth is that it reports what it could not confirm,
 * and a panel that showed only the passes would be advertising a tool while defeating it.
 */

type Check = { name: string; ok: boolean | null; detail: string };
type Payload = {
  generatedAt: string;
  rpc: string;
  book: string;
  fromBlock: string;
  head: string;
  auctions: number;
  logs: number;
  passed: number;
  failed: number;
  notApplicable: number;
  checks: Check[];
};

const num = (n: number | string) => Number(n).toLocaleString("en-US");

export function Verification() {
  const [data, setData] = useState<Payload | null>(null);

  useEffect(() => {
    // The artifact is a classic script assigning a global, loaded beforeInteractive in
    // app/layout.tsx. Read after mount so the static prerender and the first client render
    // agree — the same rule every other global-backed read on this site follows.
    setData((window as unknown as { GLASSHOUSE_VERIFICATION?: Payload }).GLASSHOUSE_VERIFICATION ?? null);
  }, []);

  if (!data) return null;

  const when = new Date(data.generatedAt);
  const ordered = [...data.checks].sort((a, b) => {
    // Failures first, then n/a, then passes. The order is the argument.
    const rank = (c: Check) => (c.ok === false ? 0 : c.ok === null ? 1 : 2);
    return rank(a) - rank(b);
  });

  return (
    <figure data-src="base" className="rounded-card border border-rule bg-raised shadow-card">
      <figcaption className="flex flex-wrap items-center justify-between gap-2 border-b border-rule px-4 py-2.5">
        <span className="font-mono text-[0.72rem] uppercase tracking-[0.14em] text-ink">
          What an independent replay found
        </span>
        <span className="chip">
          {data.passed} passed · {data.failed} failed · {data.notApplicable} n/a
        </span>
      </figcaption>

      <ul className="divide-y divide-rule">
        {ordered.map((c) => (
          <li key={c.name} className="flex gap-3 px-4 py-3">
            <span
              className={[
                "mt-0.5 shrink-0 font-mono text-[0.6875rem] uppercase tracking-[0.1em]",
                c.ok === false ? "text-brick" : c.ok === null ? "text-ink-faint" : "text-glass",
              ].join(" ")}
              style={{ minWidth: "3.2rem" }}
            >
              {c.ok === false ? "FAIL" : c.ok === null ? "n/a" : "pass"}
            </span>
            <div className="min-w-0">
              <div className="font-mono text-[0.74rem] text-ink">{c.name}</div>
              <p className="lede mt-0.5 text-[0.8rem] leading-relaxed text-ink-faint">{c.detail}</p>
            </div>
          </li>
        ))}
      </ul>

      <p className="border-t border-rule px-4 py-3 text-[0.78rem] leading-relaxed text-ink-faint">
        <strong className="font-medium text-ink-soft">What produced this:</strong>{" "}
        <code className="font-mono">scripts/verify-run.mjs</code>, reading{" "}
        {num(data.logs)} log{data.logs === 1 ? "" : "s"} from GlasshouseBook over{" "}
        <code className="font-mono">{data.rpc}</code> and re-deriving{" "}
        {num(data.auctions)} auction{data.auctions === 1 ? "" : "s"} from the raw reveals —
        without importing the contract&rsquo;s rule, the subgraph&rsquo;s copy of it, or this
        site&rsquo;s. <strong className="font-medium text-ink-soft">This is a recorded run,
        not a live check:</strong> it was taken at block {num(data.head)} on{" "}
        {when.toISOString().slice(0, 10)}, and nothing on this page re-ran it when you loaded
        it. Reproduce it with{" "}
        <code className="font-mono">node scripts/verify-run.mjs --from {data.fromBlock}</code>.
        {data.failed > 0 && (
          <>
            {" "}
            <span className="text-brick">
              The {data.failed} failing check{data.failed === 1 ? " is" : "s are"} shown first
              and in full.
            </span>{" "}
            A check with nothing to run on is reported as <code className="font-mono">n/a</code>{" "}
            with its reason rather than as a pass, because a vacuous check is the most
            flattering result and the least informative.
          </>
        )}
      </p>
    </figure>
  );
}

export default Verification;
