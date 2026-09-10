"use client";

/**
 * The latency lens. ui-spec.md section S6.
 *
 * The sharpest claim in the project, drawn once: the same three bidders, the same three
 * points, plotted the same way in both panels. Only the winner changes. A clock gate picks
 * the LOWEST point — the one that arrived first — and the x-axis, which is what the fill is
 * worth to them, does not enter the decision at all. A bid gate picks the RIGHTMOST point,
 * and the y-axis does not enter.
 *
 * Static, hand-placed, no animation and no chart library. ui-spec.md U-2: the subgraph has
 * no latency data and refuses to invent any, so no axis here pretends to be measured
 * latency. Arrival order is ASSIGNED, in a unit test, and the caption says so before it
 * says anything else.
 */

const AXIS = "stroke-rule";
const TICK = "fill-ink-faint font-mono text-[9px]";

/** valuation bps -> x, arrival place -> y. The same scale in both panels, deliberately. */
const X = { 100: 110, 250: 190, 400: 270 } as const;
const Y = { first: 190, second: 135, third: 80 } as const;

function Panel({
  x,
  eyebrow,
  rule,
  winner,
}: {
  x: number;
  eyebrow: string;
  rule: string;
  winner: "cyd" | "ada";
}) {
  const byBid = winner === "ada";
  return (
    <g transform={`translate(${x},0)`}>
      <text x={0} y={14} className="fill-ink font-mono text-[11px] tracking-[0.12em] uppercase">
        {eyebrow}
      </text>

      {/* The axis that does not enter the decision is drawn faint and labelled as such,
          rather than removed: the point is that the information IS there and the gate
          ignores it. */}
      <g className={byBid ? "opacity-35" : ""}>
        <text x={0} y={40} className="fill-ink-faint font-mono text-[9px]">
          arrival in block{byBid ? " · does not enter" : ""}
        </text>
        <line x1={60} y1={50} x2={60} y2={220} className={AXIS} strokeWidth={1} />
        <text x={52} y={Y.third + 3} textAnchor="end" className={TICK}>3rd</text>
        <text x={52} y={Y.second + 3} textAnchor="end" className={TICK}>2nd</text>
        <text x={52} y={Y.first + 3} textAnchor="end" className={TICK}>1st</text>
      </g>

      <g className={byBid ? "" : "opacity-35"}>
        <line x1={60} y1={220} x2={310} y2={220} className={AXIS} strokeWidth={1} />
        <text x={X[100]} y={236} textAnchor="middle" className={TICK}>100</text>
        <text x={X[250]} y={236} textAnchor="middle" className={TICK}>250</text>
        <text x={X[400]} y={236} textAnchor="middle" className={TICK}>400</text>
        <text x={310} y={252} textAnchor="end" className="fill-ink-faint font-mono text-[9px]">
          valuation, bps{byBid ? "" : " · does not enter"}
        </text>
      </g>

      {/* The clock panel's whole argument in one dashed line: the price is a function of
          time, so it is the same horizontal value for every bidder, and valuation cannot
          break the tie. */}
      {!byBid && (
        <>
          <line
            x1={60}
            y1={112}
            x2={310}
            y2={112}
            className="stroke-brick"
            strokeWidth={1}
            strokeDasharray="4 4"
          />
          <text x={186} y={106} textAnchor="middle" className="fill-brick font-mono text-[9px]">
            identical for all three
          </text>
        </>
      )}

      {/* The three points. Same coordinates in both panels — that is the entire device,
          so the labels sit on the same side in both too, even where only one panel needs
          it. Ada's is on the left because on the right she is up against the panel edge
          and, in the bid panel, against the second-price bracket. */}
      <Point cx={X[100]} cy={Y.first} label="Cyd 100" win={!byBid} />
      <Point cx={X[250]} cy={Y.second} label="Bram 250" win={false} />
      <Point cx={X[400]} cy={Y.third} label="Ada 400" win={byBid} side="left" />

      {/* Second price, drawn: the winner is up and to the right, the price comes from the
          runner-up's x. */}
      {byBid && (
        <>
          <path
            d="M 282 80 H 300 V 150 H 204"
            className="stroke-glass"
            strokeWidth={1}
            fill="none"
          />
          <path d="M 204 150 l 6 -3 v 6 z" className="fill-glass" />
          <text x={252} y={166} textAnchor="middle" className="fill-glass font-mono text-[9px]">
            pays 250 — the runner-up&rsquo;s bid
          </text>
        </>
      )}

      <text x={0} y={278} className="fill-ink-soft font-mono text-[9.5px]">
        {rule}
      </text>
    </g>
  );
}

function Point({
  cx,
  cy,
  label,
  win,
  side = "right",
}: {
  cx: number;
  cy: number;
  label: string;
  win: boolean;
  side?: "left" | "right";
}) {
  const left = side === "left";
  return (
    <g>
      {win ? (
        <>
          <circle cx={cx} cy={cy} r={6} className="fill-none stroke-glass" strokeWidth={1.5} />
          <circle cx={cx} cy={cy} r={2} className="fill-glass" />
        </>
      ) : (
        <circle cx={cx} cy={cy} r={3.5} className="fill-ink-faint" />
      )}
      <text
        x={left ? cx - 11 : cx + 11}
        y={cy + 3}
        textAnchor={left ? "end" : "start"}
        className={`font-mono text-[9.5px] ${win ? "fill-glass" : "fill-ink-faint"}`}
      >
        {label}
        {win ? " · wins" : ""}
      </text>
    </g>
  );
}

export function LatencyLens() {
  return (
    <figure data-src="test" className="border border-rule bg-raised rounded-card shadow-card">
      <figcaption className="flex flex-wrap items-center justify-between gap-2 border-b border-rule px-4 py-2.5">
        <span className="font-mono text-[0.72rem] uppercase tracking-[0.14em] text-ink">
          The same three bidders, two gates
        </span>
        <span className="border border-ink-faint px-2 py-0.5 font-mono text-[0.64rem] uppercase tracking-[0.12em] text-ink-faint">
          Source · Foundry test · valuations and arrival order assigned
        </span>
      </figcaption>

      <div className="overflow-x-auto px-4 py-5">
        <svg
          viewBox="0 0 700 292"
          role="img"
          aria-label="Two panels plotting the same three bidders by valuation and arrival order. Under a clock gate the winner is the earliest arrival, Cyd, who values the fill least. Under a bid gate the winner is the highest valuation, Ada, who pays the runner-up Bram's 250 basis points."
          className="w-full min-w-[42rem]"
        >
          <Panel
            x={0}
            eyebrow="By clock · 0x94"
            rule="the winner is the lowest point, whatever x"
            winner="cyd"
          />
          <Panel
            x={370}
            eyebrow="By bid · 0x2e"
            rule="the winner is the rightmost point, whatever y"
            winner="ada"
          />
        </svg>
      </div>

      <p className="border-t border-rule px-4 py-3 text-[0.78rem] leading-relaxed text-ink-faint">
        <strong className="font-medium text-ink-soft">What produced this:</strong> the three participants of{" "}
        <code className="font-mono">test_Comparison_AllThreeGatesOnTheSameOrder</code> in{" "}
        <code className="font-mono">test/Comparison.t.sol</code>, at their assigned valuations — Ada 400 bps,
        Bram 250, Cyd 100 — and their assigned arrival order, with Cyd first. Both panels plot the same three
        points at the same coordinates; only the rule for choosing among them differs. Arrival order is
        assigned in the test, not measured; on chain it is sold to whoever pays the builder most, which is the
        point. No axis here is a measured latency, and no point on it came from a live auction.
      </p>
    </figure>
  );
}
