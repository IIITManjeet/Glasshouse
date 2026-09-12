"use client";

/**
 * How a round works, in one picture.
 *
 * The page had no answer to "what actually happens" above the fold. It had a live board,
 * which shows a round in ONE of its phases -- whichever phase happens to be running when
 * you arrive -- and an essay a click away. A visitor who lands during `commit` sees three
 * hatched cards and a countdown and has no way to know what they are counting down to.
 *
 * So this draws the whole round at once: sealed, opened, paid. It is the only element on
 * the page that shows all three phases simultaneously, which is exactly why it belongs
 * next to the headline and not inside the instrument.
 *
 * IT IS A DIAGRAM OF THE CONTRACT, not of a round that happened. The numbers are the ones
 * the argument uses throughout (400 bid, 250 paid) and the block counts are the advocated
 * configuration from config/auction.json. That makes it `config`, not `base` -- it carries
 * a source tag like everything else, and the caption says it is a drawing of a rule rather
 * than a record of an auction.
 */

const CARD = { w: 108, h: 62 };

/** A sealed commitment. Hatching says "this value exists and cannot be read yet"; a
 *  spinner would say "loading", which is a different and false claim. */
function Sealed({ x, y, label }: { x: number; y: number; label: string }) {
  return (
    <g transform={`translate(${x},${y})`}>
      <rect
        width={CARD.w}
        height={CARD.h}
        className="fill-[url(#glasshatch)] stroke-rule"
        strokeWidth={1}
      />
      <text x={10} y={22} className="fill-ink-faint font-mono text-[10px]">
        {label}
      </text>
      <text x={10} y={44} className="fill-ink-faint font-mono text-[15px] tracking-[0.18em]">
        ▨▨▨▨
      </text>
    </g>
  );
}

/** An opened bid. Flat, legible, and the number is finally readable. */
function Opened({
  x,
  y,
  label,
  bps,
  tone,
  note,
}: {
  x: number;
  y: number;
  label: string;
  bps: number;
  tone: "win" | "price" | "plain";
  note?: string;
}) {
  const stroke = tone === "win" ? "stroke-glass" : tone === "price" ? "stroke-amber" : "stroke-rule";
  const fill = tone === "win" ? "fill-glass" : tone === "price" ? "fill-amber" : "fill-ink";
  return (
    <g transform={`translate(${x},${y})`}>
      <rect
        width={CARD.w}
        height={CARD.h}
        className={`fill-raised ${stroke}`}
        strokeWidth={tone === "plain" ? 1 : 1.5}
      />
      <text x={10} y={22} className="fill-ink-faint font-mono text-[10px]">
        {label}
      </text>
      <text x={10} y={44} className={`${fill} font-mono text-[17px]`}>
        {bps} bps
      </text>
      {note && (
        <text x={10} y={CARD.h + 15} className={`${fill} font-mono text-[9.5px]`}>
          {note}
        </text>
      )}
    </g>
  );
}

function Arrow({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x},${y})`} className="stroke-rule">
      <line x1={0} y1={0} x2={22} y2={0} strokeWidth={1} />
      <path d="M 22 0 l -6 -3.5 v 7 z" className="fill-rule stroke-none" />
    </g>
  );
}

function StageLabel({ x, n, title, blocks }: { x: number; n: string; title: string; blocks: string }) {
  return (
    <g transform={`translate(${x},0)`}>
      <text x={0} y={12} className="fill-glass font-mono text-[10px] tracking-[0.14em]">
        {n}
      </text>
      <text x={0} y={30} className="fill-ink font-mono text-[11.5px] tracking-[0.12em] uppercase">
        {title}
      </text>
      <text x={0} y={46} className="fill-ink-faint font-mono text-[9.5px]">
        {blocks}
      </text>
    </g>
  );
}

export function Mechanism() {
  return (
    <figure data-src="config" className="border border-rule bg-raised rounded-card shadow-card">
      <figcaption className="flex flex-wrap items-center justify-between gap-2 border-b border-rule px-4 py-2.5">
        <span className="font-mono text-[0.72rem] uppercase tracking-[0.14em] text-ink">
          One round, end to end
        </span>
        <span className="chip">
          Source · the contract&rsquo;s rule · config/auction.json
        </span>
      </figcaption>

      <div className="overflow-x-auto px-4 py-4">
        <svg
          viewBox="0 0 900 250"
          role="img"
          aria-label="Three stages of a round. First, commit: three sealed bids arrive, unreadable. Second, reveal: two are opened, showing 400 and 250 basis points, while the third is never opened. Third, settle: the 400 bidder wins but pays 250, the runner-up's price, and the 150 basis point difference goes to the maker."
          className="w-full min-w-[52rem]"
        >
          <defs>
            {/* A sealed commitment is hatched, not greyed. Colour-blind safe by
                construction, and it is the same pattern the live bid cards use. */}
            <pattern id="glasshatch" width="8" height="8" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
              <rect width="8" height="8" className="fill-raised" />
              <line x1={0} y1={0} x2={0} y2={8} className="stroke-sunk" strokeWidth={5} />
            </pattern>
          </defs>

          {/* ---- 1 · COMMIT ---------------------------------------------------- */}
          <StageLabel x={0} n="1" title="Commit" blocks="30 blocks · ~60 s at 2 s/block" />
          <Sealed x={0} y={70} label="#0" />
          <Sealed x={0} y={140} label="#1" />
          <Sealed x={118} y={105} label="#2" />
          <text x={0} y={228} className="fill-ink-faint font-mono text-[9.5px]">
            a bid is a hash of the bid, a salt and the order
          </text>

          <Arrow x={244} y={140} />

          {/* ---- 2 · REVEAL ---------------------------------------------------- */}
          <StageLabel x={288} n="2" title="Reveal" blocks="30 blocks · the envelopes open" />
          <Opened x={288} y={70} label="#0" bps={400} tone="win" note="highest — wins the right to fill" />
          <Opened x={288} y={155} label="#1" bps={250} tone="price" note="runner-up — sets the price" />
          <Sealed x={406} y={112} label="#2" />
          <text x={406} y={192} className="fill-ink-faint font-mono text-[9.5px]">
            never opened
          </text>

          <Arrow x={532} y={140} />

          {/* ---- 3 · SETTLE ---------------------------------------------------- */}
          <StageLabel x={576} n="3" title="Settle" blocks="15 blocks · winner fills, exclusively" />

          <rect x={576} y={70} width={300} height={120} className="fill-glass-soft stroke-glass" strokeWidth={1} />
          <text x={594} y={96} className="fill-ink-faint font-mono text-[10px] tracking-[0.12em] uppercase">
            winner pays
          </text>
          <text x={594} y={132} className="fill-glass font-mono text-[30px]">
            250 bps
          </text>
          <text x={594} y={154} className="fill-ink-soft font-mono text-[10px]">
            the runner-up&rsquo;s bid, not their own
          </text>
          <text x={594} y={176} className="fill-ink font-mono text-[10.5px]">
            the 150 bps difference → the maker
          </text>

          {/* Kept short on purpose: at 9.5px mono the full sentence runs past the 900-unit
              viewBox and clips. The longer form is in the caption below the figure. */}
          <text x={576} y={228} className="fill-ink-faint font-mono text-[9.5px]">
            your bid decides IF you win, not what you pay
          </text>
        </svg>
      </div>

      <p className="border-t border-rule px-4 py-3 text-[0.78rem] leading-relaxed text-ink-faint">
        <strong className="font-medium text-ink-soft">What produced this:</strong> a drawing of the rule in{" "}
        <code className="font-mono">src/book/GlasshouseBook.sol</code> — the winner is the highest revealed
        bid and the price is <code className="font-mono">max(second, reserve)</code> — at the advocated
        window sizes in <code className="font-mono">config/auction.json</code> (30 / 30 / 15 blocks, seconds
        estimated at 2 s per block). The three bids are the same illustrative values the argument uses
        throughout. Paying the runner-up rather than your own bid is what makes bidding your true value
        safe: what you bid decides <em>whether</em> you win, not what you pay for it.{" "}
        <strong className="font-medium text-ink-soft">It is not a record of an auction</strong>: no round
        on Base produced these numbers, and the board below shows the real ones.
      </p>
    </figure>
  );
}
