"use client";

/**
 * The hero's background. Depth without a single image file.
 *
 * The brief was "make it feel like a product", and the honest constraint is that this
 * project has no photography, no licence to any, and no business implying it is something
 * it is not. So the atmosphere is generated: two drifting fields of sealed-envelope glyphs
 * over a soft colour mesh, all of it SVG and CSS.
 *
 * That is not a compromise, it is the better answer here. It themes itself from the
 * palette in both light and dark, it weighs nothing, there is no asset to licence or lose,
 * and the motif is the product's own -- a sealed envelope is what a commitment IS, which
 * is more than a stock photograph of a trading floor would have said.
 *
 * DECORATION, AND ONLY DECORATION. It is `aria-hidden`, `pointer-events-none`, sits behind
 * everything at a low opacity, and carries no number. That matters on this page in
 * particular: every other mark here is accountable to a source, and the way this one stays
 * honest is by saying nothing at all.
 *
 * The drift is CSS keyframes rather than JS. The tiles are sized so the translation loops
 * seamlessly at exactly one tile, so nothing ever jumps, and `prefers-reduced-motion` in
 * globals.css already flattens every animation on the page including these.
 */
export function Atmosphere() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 -z-10 overflow-hidden"
    >
      {/* The colour field. Two very faint pools -- teal where the page's own accent lives,
          amber where its "provisional" state does -- so the ground is not flat white. */}
      <div className="atmo-mesh absolute inset-0" />

      {/* aria-hidden on the <svg> ITSELF, not only on the wrapper. The wrapper already
          hides it from assistive tech, but scripts/lint-provenance.mjs reads the element's
          own opening tag when deciding whether a graphic is decoration -- deliberately, so
          that an attribute on some ancestor can never grant the exemption by accident. */}
      <svg
        aria-hidden="true"
        className="absolute inset-0 h-full w-full"
        preserveAspectRatio="xMidYMid slice"
      >
        <defs>
          {/* A sealed envelope: the body, and the flap folded down over it. The same thing
              the bid cards hatch and the icon abstracts. */}
          <pattern id="atmo-near" width="72" height="72" patternUnits="userSpaceOnUse">
            <g className="stroke-glass" strokeWidth="1" fill="none">
              <rect x="10" y="14" width="20" height="14" />
              <path d="M 10 14 L 20 22 L 30 14" />
              <rect x="46" y="46" width="14" height="10" />
              <path d="M 46 46 L 53 52 L 60 46" />
            </g>
          </pattern>

          <pattern id="atmo-far" width="104" height="104" patternUnits="userSpaceOnUse">
            <g className="stroke-glass" strokeWidth="1" fill="none">
              <rect x="62" y="20" width="16" height="11" />
              <path d="M 62 20 L 70 26.5 L 78 20" />
              <rect x="18" y="70" width="24" height="16" />
              <path d="M 18 70 L 30 79 L 42 70" />
            </g>
          </pattern>
        </defs>

        {/* Oversized and offset so the drift never exposes an edge. Two layers at
            different sizes and speeds read as depth without a shadow anywhere. */}
        <rect
          className="atmo-drift-far opacity-[0.10]"
          x="-120"
          y="-120"
          width="200%"
          height="200%"
          fill="url(#atmo-far)"
        />
        <rect
          className="atmo-drift-near opacity-[0.14]"
          x="-120"
          y="-120"
          width="200%"
          height="200%"
          fill="url(#atmo-near)"
        />
      </svg>

      {/* The field fades out downward so it never competes with the instrument below. */}
      <div className="atmo-fade absolute inset-0" />
    </div>
  );
}
