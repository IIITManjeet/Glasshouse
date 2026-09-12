"use client";

import { addressHues } from "@/lib/identity";
import { type Auction, type Source, livePhase, roundLabel } from "@/lib/useAuctions";

/**
 * THE MECHANISM, AS ONE PICTURE.
 *
 * Every bid on one shared vertical scale of basis points, in commit order, and the price
 * drawn as a horizontal line that settles at the SECOND mark from the top — never touching
 * the winner's column.
 *
 * WHY THIS AND NOT AN ILLUSTRATION. The art direction before this one decorated the NAME:
 * a glasshouse is a building, so it drew a building. The correction after that decorated
 * the WORD "sealed" — envelopes with wax — which is the same mistake one level down.
 * Envelopes say a bid is hidden. They say nothing whatever about the only surprising part
 * of this product, which is that the winner pays somebody else's number.
 *
 * This does. The gap between the winner's column top and the price line IS the maker's
 * surplus, and the line visibly originates at the runner-up. "What you bid decides whether
 * you win, not what you pay" stops being a sentence to be believed and becomes a line whose
 * source you can see.
 *
 * IT IS A FIGURE, NOT DECORATION, and that is the point. An abstract image that merely
 * resembles a chart is exactly what this project forbids — scripts/lint-provenance.mjs
 * exists so every figure names what produced it, and decoration shaped like data defeats
 * that at a glance. So this carries real values from a real round and says where they came
 * from, which a generated hero never could.
 *
 * COLOUR MEANS ONE THING EACH, and nothing else may borrow it:
 *   teal       a revealed, on-chain value
 *   ochre      money moving to the maker — the price line and the surplus above it
 *   terracotta a forfeit
 *   hatch      a value that exists and cannot be read
 * The winner is NOT given a colour. It is simply the tallest column, because colour here is
 * reserved for money and a crown would spend it on applause.
 *
 * COLUMNS NEVER REORDER. The x-axis is commit order and stays commit order through reveal
 * and settle. Sorting by value would be a lie about what the contract knows and when.
 */

const PAD = { top: 26, right: 140, bottom: 62, left: 48 };
const W = 760;
const H = 320;

const num = (n: number) => n.toLocaleString("en-US");
const short = (a?: string | null) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "—");

/**
 * THE ONLY THING THIS FIGURE'S VOCABULARY GAINS, AND IT IS DELIBERATELY TINY.
 *
 * A 6px two-hue square beside each column's `#n`, drawn from the bidder's own address bytes
 * -- the same two hues `.addr-mark` paints in the bid ladder, the rounds table and the
 * account header. It exists because this chart names its columns `#1 #2 #3` and the ladder
 * beneath names the same bids by address: matching them meant reading forty hex characters
 * twice. The square makes it one glance.
 *
 * WHAT IT MUST NOT BECOME. The colour rule for this figure (see the file header) is one
 * meaning per hue -- teal is a revealed value, ochre is money to the maker, terracotta a
 * forfeit -- and an address hue is arbitrary, so it is confined to a 6px axis swatch. It is
 * never a column, never the price line, and never text. Columns stay teal and the clearing
 * line stays exactly where it was.
 *
 * WHY THE LIGHTNESS IS 50% AND NOT 42/60. `.addr-mark` picks 42% on the light theme and
 * 60% on dark, which it can do because it is CSS and can see a media query. An SVG `fill`
 * cannot, and this file cannot add a token to globals.css, so it takes one value that is
 * legible on both grounds. The HUES -- the part that identifies the address -- are
 * identical to the mark's, which is what makes the match work.
 *
 * The diagonal split mirrors the mark's 135deg gradient: h1 is the upper-left triangle.
 */
function ColumnMark({ addr, x, y }: { addr?: string | null; x: number; y: number }) {
  if (!addr) return null;
  const { h1, h2 } = addressHues(addr);
  const s = 6;
  return (
    <g aria-hidden="true">
      <polygon points={`${x},${y + s} ${x},${y} ${x + s},${y}`} fill={`hsl(${h1} 58% 50%)`} />
      <polygon points={`${x + s},${y} ${x + s},${y + s} ${x},${y + s}`} fill={`hsl(${h2} 58% 50%)`} />
    </g>
  );
}

export function Settlement({ a, head, source }: { a: Auction; head: number; source: Source }) {
  // THE SOURCE IS A PROP BECAUSE THIS FIGURE CANNOT KNOW IT OTHERWISE, and getting that
  // wrong is the one mistake this project cannot afford. The first version of this file
  // hardcoded data-src="base" and told the reader the bids were "as the Book recorded
  // them". On the evidence page the honest empty state -- no mainnet round has settled --
  // invites a visitor to run the rehearsal, which feeds SIMULATED rounds straight into this
  // component. The chart then asserted that synthetic numbers were read from Base, on the
  // one page whose entire argument is that every figure names its true source.
  //
  // Every other panel there already switched on `source`; this one was added without it.
  const simulated = source === "sim";
  const bids = [...(a.bids ?? [])].sort((x, y) => x.commitIdx - y.commitIdx);
  if (bids.length === 0) return null;

  const phase = livePhase(a, head);
  const revealClosed = phase === "exclusive" || phase === "open";

  // The scale runs from the reserve to the max the maker allowed. Both are the contract's
  // own numbers, so the axis is not a presentation choice -- it is the range a bid was
  // permitted to occupy, which is why a column's height is meaningful at all.
  const lo = a.reserveBps;
  const hi = Math.max(a.maxBps, a.bestBps || 0, lo + 1);
  const plotH = H - PAD.top - PAD.bottom;
  const plotW = W - PAD.left - PAD.right;
  const y = (bps: number) => PAD.top + plotH * (1 - (Math.max(lo, Math.min(hi, bps)) - lo) / (hi - lo));

  const slot = plotW / bids.length;
  const colW = Math.min(54, slot * 0.56);
  // LABEL DENSITY FOLLOWS THE SLOT, because the labels do not shrink and the slot does.
  // `#n · blk 51,204,303` is ~110px of 10px mono; at six bids the slot is ~95px and adjacent
  // labels collide. Rather than truncate into ambiguity, whole facts are dropped in order of
  // how much they are needed here: the commit block is recoverable from the receipt below,
  // the bidder is recoverable from the ladder, the queue slot is what the price line points
  // at and is never dropped.
  const showBlock = slot >= 112;
  const showBidder = slot >= 74;
  const x = (i: number) => PAD.left + slot * i + (slot - colW) / 2;
  // One string, used twice: once to draw and once to measure, so the mark beside it cannot
  // drift from the label it belongs to.
  const slotLabel = (b: (typeof bids)[number]) =>
    `#${b.commitIdx}${showBlock ? ` · blk ${num(b.committedAtBlock)}` : ""}`;

  const winner = a.bestBidder?.toLowerCase() ?? null;
  const clearing = a.clearingBps;
  const hasPrice = winner !== null && clearing !== null;
  // Only claim a surplus once the reveal window has closed; before that a later reveal can
  // still move both numbers, and an animated "150 bps to the maker" that changes its mind
  // is worse than not saying it.
  const surplus = hasPrice && revealClosed ? Math.max(0, a.bestBps - (clearing as number)) : 0;

  // WHICH SLOT SET THE PRICE. "Set by the runner-up" is true and vague; naming the slot ties
  // the line to a column a reader can point at. When secondBps never cleared the reserve
  // there IS no runner-up -- the reserve set the price -- and saying so is the honest case,
  // not a fallback.
  const setByReserve = a.secondBps <= a.reserveBps;
  const runnerUp = setByReserve
    ? null
    : bids.find((b) => b.bps === a.secondBps && b.bidder?.toLowerCase() !== winner) ?? null;

  // The exclusive window is the one part of the mechanism with no room on either axis, so
  // the price line carries it: while it is open the line is the winner's alone; once it
  // lapses unfilled, the improvement is gone and anyone may fill at the base price.
  const inExclusive = phase === "exclusive" && !a.filled;
  const lapsed = phase === "open" && hasPrice && !a.filled;
  const blocksLeft = Math.max(0, a.exclusiveEnd - head);

  return (
    <figure data-src={simulated ? "sim" : "base"} className="rounded-card border border-rule bg-raised shadow-card">
      <figcaption className="flex flex-wrap items-center justify-between gap-2 border-b border-rule px-4 py-2.5">
        <span className="font-mono text-[0.72rem] uppercase tracking-[0.14em] text-ink">
          Where the price came from
        </span>
        <span className={simulated ? "chip chip-warn" : "chip"}>
          {simulated ? "Simulated · not a chain read" : `${roundLabel(a)} · block ${num(head)}`}
        </span>
      </figcaption>

      <div className="overflow-x-auto px-4 py-5">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full min-w-[44rem]"
          role="img"
          aria-label={
            hasPrice
              ? `Bids in commit order on a scale of basis points. The winning bid is ${a.bestBps} basis points, and the price is ${clearing}, taken from the runner-up rather than from the winner. The difference of ${surplus} goes to the maker.`
              : `Bids in commit order on a scale of basis points. No bid has been opened, so there is no price yet.`
          }
        >
          <defs>
            {/* A sealed bid is a value that EXISTS and cannot be read. Hatching says that;
                a grey block would say "nothing here", which is a different and false claim. */}
            <pattern id="seal" width="7" height="7" patternTransform="rotate(135)" patternUnits="userSpaceOnUse">
              <rect width="7" height="7" fill="transparent" />
              <line x1="0" y1="0" x2="0" y2="7" stroke="var(--color-ink-faint)" strokeWidth="2.5" opacity="0.42" />
            </pattern>
            <linearGradient id="sealFade" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="white" stopOpacity="0" />
              <stop offset="18%" stopColor="white" stopOpacity="1" />
            </linearGradient>
            <mask id="fadeTop">
              <rect x="0" y="0" width={W} height={H} fill="url(#sealFade)" />
            </mask>
          </defs>

          {/* The scale. Only two labelled marks -- the reserve and the ceiling -- because
              every other gridline would be a number nobody asked for. */}
          {[lo, hi].map((v) => (
            <g key={v}>
              <line x1={PAD.left - 6} y1={y(v)} x2={W - PAD.right} y2={y(v)} stroke="var(--color-rule)" strokeWidth="1" />
              <text x={PAD.left - 10} y={y(v) + 4} textAnchor="end" className="fill-[var(--color-ink-faint)] font-mono text-[11px]">
                {v}
              </text>
            </g>
          ))}
          <text x={PAD.left - 10} y={PAD.top - 12} textAnchor="end" className="fill-[var(--color-ink-faint)] font-mono text-[10px]">
            bps
          </text>

          {bids.map((b, i) => {
            const revealed = b.bps !== null && b.bps !== undefined;
            const isWinner = winner !== null && b.bidder?.toLowerCase() === winner;
            // Sealed after the window shut is not "still sealed" -- it is a bid that can
            // never be read now, and its bond is forfeit. Different fact, different colour.
            const forfeited = !revealed && revealClosed;
            const top = revealed ? y(b.bps as number) : PAD.top;
            const colH = PAD.top + plotH - top;

            return (
              <g key={`${b.bidder}-${b.commitIdx}`}>
                {revealed ? (
                  <rect x={x(i)} y={top} width={colW} height={colH} fill="var(--color-glass)" opacity={isWinner ? 0.92 : 0.55} />
                ) : (
                  <rect
                    x={x(i)}
                    y={PAD.top}
                    width={colW}
                    height={plotH}
                    fill="url(#seal)"
                    mask="url(#fadeTop)"
                    opacity={forfeited ? 0.45 : 1}
                  />
                )}
                {forfeited && (
                  <rect x={x(i)} y={PAD.top} width={colW} height={plotH} fill="var(--color-brick)" opacity="0.16" mask="url(#fadeTop)" />
                )}

                {/* The winner's cap is drawn in a LATER pass, after the price line. On a tie
                    -- two bidders at the same bps -- clearing equals bestBps, so the line lands
                    exactly on the cap and, being drawn later, painted it out. The one case
                    where this chart's whole claim is hardest to read was the one case it
                    erased its own mark in. */}

                {revealed && (
                  <text x={x(i) + colW / 2} y={top - 7} textAnchor="middle" className="fill-[var(--color-ink)] font-mono text-[12px]">
                    {b.bps}
                  </text>
                )}

                {/* Three lines, because the queue slot, the bidder and the state are three
                    different facts and collapsing them loses one. The slot comes first: it
                    is fixed at commit and is what the price line points back to. */}
                {/* The mark hangs off the LEFT EDGE of the slot label, which is why the
                    label's width is computed rather than guessed: the text is centred, so
                    there is no fixed edge to anchor to. 6px per character is the advance of
                    10px mono here -- the same figure the label-density note above uses to
                    predict a collision at ~110px, and it has held. */}
                <ColumnMark
                  addr={b.bidder}
                  x={x(i) + colW / 2 - (slotLabel(b).length * 6) / 2 - 9}
                  y={H - PAD.bottom + 11}
                />
                <text x={x(i) + colW / 2} y={H - PAD.bottom + 16} textAnchor="middle" className="fill-[var(--color-ink-faint)] font-mono text-[10px]">
                  {slotLabel(b)}
                </text>
                {showBidder && (
                  <text x={x(i) + colW / 2} y={H - PAD.bottom + 29} textAnchor="middle" className="fill-[var(--color-ink-faint)] font-mono text-[9px]">
                    {short(b.bidder)}
                  </text>
                )}
                <text
                  x={x(i) + colW / 2}
                  y={H - PAD.bottom + 42}
                  textAnchor="middle"
                  className={
                    forfeited
                      ? "fill-[var(--color-brick)] font-mono text-[9px]"
                      : isWinner && revealed
                        ? "fill-[var(--color-ink)] font-mono text-[9px]"
                        : "fill-[var(--color-ink-faint)] font-mono text-[9px]"
                  }
                >
                  {forfeited
                    ? "never revealed · bond forfeit"
                    : revealed
                      ? isWinner
                        ? "wins"
                        : "opened"
                      : "sealed"}
                </text>
              </g>
            );
          })}

          {/* THE LINE THAT CARRIES THE WHOLE IDEA. It is drawn at the clearing price and
              labelled with where that number came from. The winner's column passes through
              it untouched, which is the point: their own bid did not set their price. */}
          {hasPrice && (
            <g>
              <line
                x1={PAD.left - 6}
                y1={y(clearing as number)}
                x2={W - PAD.right + 6}
                y2={y(clearing as number)}
                stroke="var(--color-amber)"
                strokeWidth="2"
                strokeDasharray={revealClosed ? undefined : "5 4"}
              />
              <text x={W - PAD.right + 12} y={y(clearing as number) - 4} className="fill-[var(--color-amber)] font-mono text-[12px]">
                price {clearing} bps
              </text>
              <text x={W - PAD.right + 12} y={y(clearing as number) + 12} className="fill-[var(--color-ink-faint)] font-mono text-[10px]">
                {/* Name the slot when we can identify it, and fall back to the true-but-
                    vaguer phrasing when we cannot. `bids` comes from a log scan that can be
                    partial, so secondBps may be known from contract storage while the bid
                    that produced it is missing from the ladder. "set by #?" would look like
                    a rendering fault; the fallback is simply less specific. */}
                {setByReserve
                  ? "set by the reserve"
                  : runnerUp
                    ? `set by #${runnerUp.commitIdx}`
                    : "set by the runner-up"}
              </text>
              {/* The surplus is LABELLED HERE, beside the price, and only SHADED on the
                  column. Inside the band it collided with the price line the moment the
                  gap was small -- and a small gap is the common case, since it means the
                  runner-up bid close to the winner. An annotation that becomes unreadable
                  exactly when the auction was most competitive is the wrong way round. */}
              {surplus > 0 && (
                <text x={W - PAD.right + 12} y={y(clearing as number) + 26} className="fill-[var(--color-amber)] font-mono text-[10px]">
                  {surplus} bps → maker
                </text>
              )}
              {/* THE EXCLUSIVE WINDOW HAS NO AXIS OF ITS OWN, so the price line carries it.
                  While the window is open the improved price belongs to the winner alone.
                  Once it lapses unfilled the improvement is simply gone: a second, grey,
                  dashed line at the floor of the scale says anyone may now fill at the base
                  price, and the drop from one line to the other IS the thing that expired. */}
              {inExclusive && (
                <text x={W - PAD.right + 12} y={y(clearing as number) + 40} className="fill-[var(--color-ink)] font-mono text-[10px]">
                  winner only · {num(blocksLeft)} blk left
                </text>
              )}
              {a.filled && (
                <text x={W - PAD.right + 12} y={y(clearing as number) + 40} className="fill-[var(--color-glass)] font-mono text-[10px]">
                  filled at this price
                </text>
              )}
              {lapsed && (
                <g>
                  <line
                    x1={PAD.left - 6}
                    y1={PAD.top + plotH}
                    x2={W - PAD.right + 6}
                    y2={PAD.top + plotH}
                    stroke="var(--color-ink-faint)"
                    strokeWidth="1.5"
                    strokeDasharray="4 4"
                  />
                  <text x={W - PAD.right + 12} y={PAD.top + plotH + 4} className="fill-[var(--color-ink-faint)] font-mono text-[10px]">
                    open · base price
                  </text>
                  <text x={W - PAD.right + 12} y={y(clearing as number) + 40} className="fill-[var(--color-ink-faint)] font-mono text-[10px]">
                    window lapsed
                  </text>
                </g>
              )}
            </g>
          )}

          {/* THE WINNER'S CAP, LAST, so nothing can paint over it -- see the note above. */}
          {bids.map((b, i) => {
            if (b.bps === null || b.bps === undefined) return null;
            if (!winner || b.bidder?.toLowerCase() !== winner) return null;
            return (
              <line
                key="wincap"
                x1={x(i)}
                y1={y(b.bps)}
                x2={x(i) + colW}
                y2={y(b.bps)}
                stroke="var(--color-ink)"
                strokeWidth="2"
              />
            );
          })}

          {/* A TIE IS NOT A BUG AND MUST NOT LOOK LIKE ONE. When the runner-up matched the
              winner, the price IS the winning bid and there is no surplus -- the line sits on
              the cap and the gap is genuinely zero. Said out loud, because a reader who has
              understood the rest of the chart will otherwise assume the drawing failed. */}
          {hasPrice && revealClosed && surplus === 0 && !setByReserve && (
            <text x={W - PAD.right + 12} y={y(clearing as number) + 54} className="fill-[var(--color-ink-faint)] font-mono text-[10px]">
              tied — no surplus
            </text>
          )}

          {/* The surplus: the winner's column ABOVE the price line, in the colour reserved
              for money moving to the maker. */}
          {surplus > 0 &&
            bids.map((b, i) => {
              if (!winner || b.bidder?.toLowerCase() !== winner || b.bps === null) return null;
              const t = y(b.bps);
              const h = y(clearing as number) - t;
              return (
                <g key="surplus">
                  <rect x={x(i)} y={t} width={colW} height={h} fill="var(--color-amber)" opacity="0.3" />
                </g>
              );
            })}
        </svg>
      </div>

      <p className="border-t border-rule px-4 py-3 text-[0.78rem] leading-relaxed text-ink-faint">
        <strong className="font-medium text-ink-soft">What produced this:</strong>{" "}
        {simulated ? (
          <>
            a <strong className="font-medium text-amber">simulated</strong> round from
            web/lib/simulate.ts, replayed through the contract&rsquo;s own clearing rule. Nothing
            here was read from any chain and the block numbers are not Base blocks — the
            arithmetic is real, the round is not.
          </>
        ) : (
          <>
            the bids of {roundLabel(a)} as the Book recorded them, in commit order, read at
            block {num(head)}.
          </>
        )}{" "}
        Column height is the revealed bid; a hatched column is a bid that exists and cannot be
        read. The ochre line is <code className="font-mono">clearingBps</code> —{" "}
        <code className="font-mono">max(reserveBps, secondBps)</code> from
        GlasshouseBook.sol:229, not a figure computed here. Columns are in commit order and
        never re-sorted: their position is fixed when the bid is sealed, which is why bidding
        early cannot be punished.{" "}
        {hasPrice ? (
          <>
            It is drawn from the runner-up because that is where the number comes from: the
            winner&rsquo;s own bid of {a.bestBps} bps decided only that they won.
            {surplus > 0 && <> The {surplus} bps above the line is the maker&rsquo;s.</>}
          </>
        ) : (
          <>No bid has been opened in this round, so there is no price to draw.</>
        )}
      </p>
    </figure>
  );
}

export default Settlement;
