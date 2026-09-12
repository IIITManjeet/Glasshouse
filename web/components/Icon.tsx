/**
 * NINE ICONS, HAND-WRITTEN, AND THE RULE THAT DECIDES WHERE THEY GO.
 *
 * No icon library. Not a size or a build-time argument -- a dependency here would be the
 * fourth font-shaped decision this project has already got wrong once (app/layout.tsx
 * records the two faces that were named in a stack and never fetched), and an icon set
 * ships hundreds of glyphs so that nine of them can be used. These are nine paths.
 *
 * THE RULE: AN ICON EARNS ITS PLACE ONLY WHEN IT NAMES THE ACTION.
 *
 * `Place sealed bid` gets a closed padlock because sealed is the whole mechanism and the
 * padlock is the one picture of it. `Reveal` gets an eye for the same reason, pointing the
 * other way. `Copy` gets two sheets and swaps to a tick when the clipboard actually
 * accepted it -- the tick is a state, not decoration, and Copy.tsx's own comment is about
 * exactly that lie. `Look up` gets a lens. `refresh` gets the arrow that means re-read.
 *
 * And then it stops. A `.btn-tertiary` that reads `why blocks, not seconds` and is already
 * underlined does not get a glyph: globals.css's F-3/F-4 history is a record of this design
 * signalling with the wrong vocabulary, and an icon beside four words of prose is the
 * decoration half of that mistake rather than the affordance half. There are eleven
 * tertiary links on this site and none of them takes an icon.
 *
 * WHY THEY WORK IN EVERY VARIANT AND BOTH THEMES FOR FREE. `stroke="currentColor"` and no
 * fill, so the glyph is whatever colour the button's text is -- which means a primary
 * (ground-on-glass), a secondary (glass, inverting to ground on hover), a tertiary
 * (ink-soft) and a disabled control (ink-faint) each get a correct icon from one path, in
 * light and dark, with no second declaration anywhere. `.btn` is already
 * `inline-flex; align-items: center; gap: 0.4rem`, so no layout comes with them either.
 *
 * WHY THEY REPLACE THE LITERAL ARROW. Six labels ended in a `→` character. A text arrow
 * takes the font's own metrics: it does not scale with the label, it sits on the baseline
 * rather than on the optical centre, and at 15px sans it is a different weight from every
 * other stroke on the button. A 16px path at 1.5 stroke centred by the flexbox is the same
 * mark at every size. The ONE `↗` deliberately left as text is `components/Address.tsx`'s
 * -- that one is a separate, tiny hit area on purpose, not a label ornament.
 *
 * EVERY ONE IS `aria-hidden`. The label beside it already says the verb, so a screen reader
 * that announced the glyph too would hear the action twice. It is also what keeps
 * `scripts/lint-provenance.mjs` from demanding a `<figure data-src>` around each of them:
 * that lint requires a source for every `<svg>` on the page *unless* it is provably
 * decorative, and `aria-hidden="true"` is how a mark declares it carries no data. These
 * genuinely carry none -- every number on this site is text.
 */

/** The shared frame. 16x16 at `h-4 w-4`, which is the size that sits inside a 32px tertiary
 *  without crowding it and inside a 44px primary without looking lost. */
function Svg({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      className={`h-4 w-4 shrink-0 ${className}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

type IconProps = { className?: string };

/** Forward: "Bid in this round", "Open the round", "Every round so far". */
export function ArrowRight({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M2.75 8h10.5" />
      <path d="M9.25 4 13.25 8l-4 4" />
    </Svg>
  );
}

/** Leaves the site. Replaces the `↗` character where the link is a button. */
export function ExternalLink({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M9.5 2.5h4v4" />
      <path d="M13.5 2.5 8 8" />
      <path d="M12 9.5v2.75A1.25 1.25 0 0 1 10.75 13.5h-7A1.25 1.25 0 0 1 2.5 12.25v-7A1.25 1.25 0 0 1 3.75 4H6.5" />
    </Svg>
  );
}

/** Two sheets. Pairs with `Check`, which replaces it for ~1.5s once the clipboard has
 *  actually taken the text -- never before, for Copy.tsx's reason. */
export function Copy({ className }: IconProps) {
  return (
    <Svg className={className}>
      <rect x="5.5" y="5.5" width="8.5" height="8.5" rx="1.5" />
      <path d="M2.75 10.5A1.25 1.25 0 0 1 1.5 9.25v-6.5A1.25 1.25 0 0 1 2.75 1.5h6.5A1.25 1.25 0 0 1 10.5 2.75" />
    </Svg>
  );
}

/** It happened. The confirmation half of Copy, and of a completed reveal. */
export function Check({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M3.25 8.5 6.25 11.5 12.75 4.75" />
    </Svg>
  );
}

/** Read it again. Not a spinner: this is the control, not the state. */
export function Refresh({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M14 8A6 6 0 1 1 8 2c1.68 0 3.29.67 4.49 1.83L14 5.33" />
      <path d="M14 2v3.33h-3.33" />
    </Svg>
  );
}

/** A CLOSED padlock, for `Place sealed bid`. Closed is the claim: the commitment is a hash
 *  of the bid, a salt and the order, and nobody -- maker included -- can read it until the
 *  reveal window opens. An open shackle would say the opposite of the mechanism. */
export function Seal({ className }: IconProps) {
  return (
    <Svg className={className}>
      <rect x="3" y="7" width="10" height="6.75" rx="1.5" />
      <path d="M5.5 7V5.25a2.5 2.5 0 0 1 5 0V7" />
    </Svg>
  );
}

/** For `Reveal`. The other half of the padlock: the number becomes public and countable. */
export function Eye({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M1.5 8S3.9 3.5 8 3.5 14.5 8 14.5 8 12.1 12.5 8 12.5 1.5 8 1.5 8Z" />
      <circle cx="8" cy="8" r="1.75" />
    </Svg>
  );
}

/** For `Connect wallet to bid`. The one place on the site that asks for a signature. */
export function Wallet({ className }: IconProps) {
  return (
    <Svg className={className}>
      <rect x="2" y="3.75" width="12" height="8.5" rx="1.75" />
      <path d="M14 6.75h-2.75a1.25 1.25 0 0 0 0 2.5H14" />
    </Svg>
  );
}

/** For `Look up` on /account: a lens over an address. */
export function Search({ className }: IconProps) {
  return (
    <Svg className={className}>
      <circle cx="7" cy="7" r="4.25" />
      <path d="M10.25 10.25 13.5 13.5" />
    </Svg>
  );
}
