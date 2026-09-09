"use client";

/**
 * Sketch art for the feature sections.
 *
 * Minimal line drawings, hand-placed, in the palette. They exist because a wall of prose
 * and instrument panels reads as a spreadsheet, and a section that opens with a drawing
 * reads as a product -- which was the whole complaint.
 *
 * EVERY ONE OF THEM IS DECORATION AND SAYS SO. `aria-hidden`, no numbers, no axes, no
 * data. scripts/lint-provenance.mjs exempts an aria-hidden <svg> from needing a source
 * tag precisely on that basis, so putting a figure inside one of these would be smuggling
 * an unlabelled chart past the rule that exists to stop exactly that. If one of these ever
 * needs to carry a value, it stops being a sketch and becomes a figure.
 *
 * Drawn at a common 200x140 viewBox so they sit on one baseline across sections, with
 * `stroke-glass` at 1.25 and no fill except where a shape must read as solid.
 */

const BOX = "0 0 200 140";

/** A sealed envelope: the body, the flap, hatching across it, and a seal. */
export function SketchSealed({ className }: { className?: string }) {
  return (
    <svg viewBox={BOX} aria-hidden="true" className={className} fill="none">
      <defs>
        <pattern id="sk-hatch" width="7" height="7" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
          <line x1="0" y1="0" x2="0" y2="7" className="stroke-rule" strokeWidth="3" />
        </pattern>
      </defs>
      <rect x="36" y="38" width="128" height="80" fill="url(#sk-hatch)" className="stroke-glass" strokeWidth="1.25" />
      <path d="M 36 38 L 100 86 L 164 38" className="stroke-glass" strokeWidth="1.25" />
      {/* The seal. A commitment is a hash, so the mark is closed and cannot be read. */}
      <circle cx="100" cy="96" r="13" className="fill-raised stroke-glass" strokeWidth="1.25" />
      <path d="M 94 96 h 12 M 100 90 v 12" className="stroke-glass" strokeWidth="1.25" />
      <line x1="26" y1="128" x2="174" y2="128" className="stroke-rule" strokeWidth="1" />
    </svg>
  );
}

/** Two bars and a price line drawn at the LOWER one: the whole second-price idea. */
export function SketchSecondPrice({ className }: { className?: string }) {
  return (
    <svg viewBox={BOX} aria-hidden="true" className={className} fill="none">
      <line x1="30" y1="118" x2="174" y2="118" className="stroke-rule" strokeWidth="1" />
      {/* The winner: tallest, ringed, and NOT where the price is drawn. */}
      <rect x="58" y="34" width="30" height="84" className="stroke-glass" strokeWidth="1.25" />
      <circle cx="73" cy="26" r="5" className="stroke-glass" strokeWidth="1.25" />
      {/* The runner-up: shorter, and the line comes off its top. */}
      <rect x="112" y="72" width="30" height="46" className="fill-glass-soft stroke-glass" strokeWidth="1.25" />
      <path
        d="M 142 72 H 168"
        className="stroke-amber"
        strokeWidth="1.25"
        strokeDasharray="4 3"
      />
      <path d="M 58 72 H 112" className="stroke-amber" strokeWidth="1.25" strokeDasharray="4 3" />
      <path d="M 62 66 l -4 6 l 4 6" className="stroke-amber" strokeWidth="1.25" />
    </svg>
  );
}

/** Two documents laid over each other, and a tick: the settlement, re-derived. */
export function SketchReplay({ className }: { className?: string }) {
  return (
    <svg viewBox={BOX} aria-hidden="true" className={className} fill="none">
      <rect x="34" y="26" width="86" height="94" className="fill-raised stroke-rule" strokeWidth="1.25" />
      <rect x="62" y="40" width="86" height="94" className="fill-raised stroke-glass" strokeWidth="1.25" />
      {[56, 68, 80, 92].map((y) => (
        <line key={y} x1="76" y1={y} x2="134" y2={y} className="stroke-rule" strokeWidth="1.25" />
      ))}
      <path d="M 78 110 l 10 10 l 20 -22" className="stroke-glass" strokeWidth="1.75" />
    </svg>
  );
}

/** A descending line and a crowd of arrows arriving at once: the clock gate's tie. */
export function SketchClock({ className }: { className?: string }) {
  return (
    <svg viewBox={BOX} aria-hidden="true" className={className} fill="none">
      <line x1="30" y1="118" x2="174" y2="118" className="stroke-rule" strokeWidth="1" />
      <line x1="30" y1="118" x2="30" y2="24" className="stroke-rule" strokeWidth="1" />
      {/* The price, falling with time. */}
      <path d="M 30 34 L 174 104" className="stroke-brick" strokeWidth="1.25" />
      {/* Three arrivals at the same instant: the price cannot separate them. */}
      {[0, 1, 2].map((i) => (
        <g key={i}>
          <line x1={100 + i * 4} y1={118} x2={100 + i * 4} y2={78 - i * 2} className="stroke-ink-faint" strokeWidth="1.25" />
          <path d={`M ${96 + i * 4} ${84 - i * 2} l ${4} ${-6} l 4 6`} className="stroke-ink-faint" strokeWidth="1.25" />
        </g>
      ))}
      <circle cx="108" cy="83" r="15" className="stroke-brick" strokeWidth="1.25" strokeDasharray="3 3" />
    </svg>
  );
}
