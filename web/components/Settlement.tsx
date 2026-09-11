"use client";

import { type Auction, livePhase } from "@/lib/useAuctions";

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

const PAD = { top: 26, right: 132, bottom: 46, left: 48 };
const W = 720;
const H = 300;

const num = (n: number) => n.toLocaleString("en-US");
const short = (a?: string | null) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "—");

export function Settlement({ a, head }: { a: Auction; head: number }) {
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
  const x = (i: number) => PAD.left + slot * i + (slot - colW) / 2;

  const winner = a.bestBidder?.toLowerCase() ?? null;
  const clearing = a.clearingBps;
  const hasPrice = winner !== null && clearing !== null;
  // Only claim a surplus once the reveal window has closed; before that a later reveal can
  // still move both numbers, and an animated "150 bps to the maker" that changes its mind
  // is worse than not saying it.
  const surplus = hasPrice && revealClosed ? Math.max(0, a.bestBps - (clearing as number)) : 0;

  return (
    <figure data-src="base" className="rounded-card border border-rule bg-raised shadow-card">
      <figcaption className="flex flex-wrap items-center justify-between gap-2 border-b border-rule px-4 py-2.5">
        <span className="font-mono text-[0.72rem] uppercase tracking-[0.14em] text-ink">
          Where the price came from
        </span>
        <span className="chip">Round {a.round} · block {num(head)}</span>
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
                    opacity={forfeited ? 0.5 : 1}
                    stroke={forfeited ? "var(--color-brick)" : "none"}
                    strokeWidth={forfeited ? 1 : 0}
                  />
                )}

                {/* The winner gets a cap, not a colour. */}
                {revealed && isWinner && (
                  <line x1={x(i)} y1={top} x2={x(i) + colW} y2={top} stroke="var(--color-ink)" strokeWidth="2" />
                )}

                {revealed && (
                  <text x={x(i) + colW / 2} y={top - 7} textAnchor="middle" className="fill-[var(--color-ink)] font-mono text-[12px]">
                    {b.bps}
                  </text>
                )}

                <text x={x(i) + colW / 2} y={H - PAD.bottom + 16} textAnchor="middle" className="fill-[var(--color-ink-faint)] font-mono text-[10px]">
                  #{b.commitIdx}
                </text>
                <text x={x(i) + colW / 2} y={H - PAD.bottom + 29} textAnchor="middle" className="fill-[var(--color-ink-faint)] font-mono text-[9px]">
                  {forfeited ? "never opened" : revealed ? short(b.bidder) : "sealed"}
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
                {a.secondBps > a.reserveBps ? "set by the runner-up" : "set by the reserve"}
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
            </g>
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
        <strong className="font-medium text-ink-soft">What produced this:</strong> the bids of
        round {a.round} as the Book recorded them, in commit order, read at block {num(head)}.
        Column height is the revealed bid; a hatched column is a bid that exists and cannot be
        read. The ochre line is <code className="font-mono">clearingBps</code> —{" "}
        <code className="font-mono">max(reserveBps, secondBps)</code> from
        GlasshouseBook.sol:229, not a figure computed here.{" "}
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
