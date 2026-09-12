# Design direction, September 2026 — the venue, not the paper

**Status:** direction, not code. One author, one decision. Written 2026-09-12 against
`web/app/globals.css` at commit `e35dac5`, after reading DESIGN.md from "# Art direction"
to the end.

**The brief, verbatim:** "make the theme images website look alike something more of a
bidding system on crypto or eth whatever we are doing... complete revamp or polishing of our
theme color palettes and representation cause it is what that will all after matters."

**The decision in one paragraph.** Glasshouse currently renders as an essay with a terminal
appendix: a light-weight serif headline, long editorial prose, a warm green-grey botanical
palette, tiny tracked-out mono labels everywhere, and a second "tape" register bolted onto
two routes. A venue is one thing, in one register, on a neutral dark ground, with a single
saturated accent, numbers set large, and the chrome carrying a live signal. So: **one
register across all five routes, dark-first, cool-neutral surfaces, the teal accent kept but
cleaned, the serif retired, mono restricted to values, labels raised to a legible floor, and
the settlement chart promoted to the front door.** Every token name, every semantic, the
provenance system and the lint survive unchanged. The values change. That is what tokens
are for.

---

## 0. What this direction is not

Read this first, because the art direction on this project has failed twice in the same way
and the third failure is sitting in the codebase right now.

1. It decorated the **name** (palm house, ferns, terracotta). Rejected.
2. It decorated the **word** (envelopes, wax seals for "sealed"). Rejected.
3. **`components/Atmosphere.tsx` is the second mistake, still shipping.** It draws "two
   drifting fields of sealed-envelope glyphs" behind the hero and its own comment calls the
   envelope "the product's own motif". It is not. It illustrates the word "sealed" exactly
   as the wax seals did, and DESIGN.md already recorded that this says nothing about the
   only surprising thing the product does (the winner pays somebody else's number). It has
   to go, and this document says what replaces it (section 3.6).

This direction proposes **no illustrative imagery at all**. Not glowing orbs, not hexagons,
not a trading-floor photograph, not an abstract "chart-like" texture, not a stylised
glasshouse, not a stylised envelope. The one figure that carries the mechanism
(`Settlement.tsx`) is the imagery, because it is the only picture that is true.

---

## 1. Research — what makes an interface read as a real venue

I looked at the products a judge will have in their head when they hear "on-chain auction on
Base": Hyperliquid, CoW Swap, Uniswap, Coinbase/Base, Kraken Pro, Polymarket, and the
non-crypto references those products themselves copy (Bloomberg, Linear, Vercel). The
pattern is consistent enough to state as rules.

### 1.1 Dark, neutral, and one accent

- **Hyperliquid** — the canonical "serious on-chain venue" of 2025-26 — is a restrained
  dark palette (near-black with a very slight blue-green cast), a **single vivid mint-teal
  accent for primary actions**, and **green/red reserved strictly for P&L**. Motion is
  120-220 ms and "never obscures important numeric changes". Typography is a neutral sans
  with large bold price and position size, medium controls, small muted helper copy, on a
  24 px rhythm. Three-column desktop canvas, stacked on mobile. ([design deep
  dive](https://hyperliq-trade-us.pages.dev/), [Coin
  Bureau](https://coinbureau.com/review/hyperliquid-review))
- **Coinbase / Base** — "institutional calm": one brand colour (`#0052ff`) used
  *exclusively* for primary CTAs and the logo, never for text or non-interactive elements;
  white or near-black (`#0a0b0d`) surfaces; everything else greyscale.
  ([shadcn.io/design/coinbase](https://www.shadcn.io/design/coinbase),
  [mobbin](https://mobbin.com/colors/brand/coinbase))
- **Kraken Pro** — purple accent on dark, data-dense; the accent is a brand hue, *not* a
  P&L hue, so green and red keep their single meaning.
  ([mobbin](https://mobbin.com/colors/brand/kraken),
  [getdesign.md](https://getdesign.md/kraken/design-md))
- **Bloomberg** — orange `#f05143` "never paints a button or a background, only the Live
  pulse dot and editorial emphasis"; text is a **six-step neutral ladder** (`#000`,
  `#1c1c1c`, `#3c3c3c`, `#545454`, `#767676`, `#999`); red `#e51503` / green `#338736` are
  semantic only; radius 0-12 px; the primary CTA is deliberately square-cornered.
  ([shadcn.io/design/bloomberg](https://www.shadcn.io/design/bloomberg)). And the caution
  that matters most for us: "the most common mistake when applying Bloomberg Terminal style
  is treating it as a colour-scheme choice rather than a structural commitment. Applying a
  dark background and green text to an otherwise conventional interface produces an
  incoherent result." ([Curio](https://designbycurio.com/learn/bloomberg-terminal-green))
- **KlindrOS "Twilight Trading Floor"** — a written-down finance design system: `#020617`
  / `#0b1f3a` grounds, one interactive blue, green/amber/red strictly semantic, Inter with
  **numerals set one weight heavier than body so they "read as data rather than running
  text"**, size floor 11-12 px, "numbers positioned close to labels", "no onboarding
  animations, no gamification, no anthropomorphic empty states — the interface assumes you
  are here to work". ([klindros.com](https://klindros.com/blog/inside-the-twilight-trading-floor-the-design-system-behind-klindros))

**Rule extracted:** a venue has *one* accent that means "ours / interactive", a neutral
surface ladder, and semantic colours that never leak. Glasshouse already has this structure
in its tokens. What it lacks is a neutral ground — its ground is tinted green, so the accent
has nothing to be *the* colour against.

### 1.2 Numbers are the typography

- Every source agrees: **tabular figures, monospace or tabular-sans for columns, units set
  lighter than values, the headline number large and high-contrast, secondary metrics
  smaller and muted.** ([adminlte fintech
  analysis](https://adminlte.io/blog/fintech-dashboard-design-examples/), [Pixel Show
  trading journal](https://pixel-show.com/blog/designing-data-dense-dashboards))
- **Proportional faces for sentences.** Butterick is flat that monospace has no place in
  body text; fixed-width type costs 20-30 % more horizontal space and is slower to scan.
  ([Practical Typography](https://practicaltypography.com/monospaced-fonts.html)). Geist
  and IBM Plex both split their families on exactly this line. This settles F-5 (section
  3.2).
- Character distinction matters in a venue: a zero that reads as O is a trap. Plex Mono has
  a dotted zero. ([madegooddesigns](https://madegooddesigns.com/best-programming-fonts-2026/))

### 1.3 Depth from surfaces, not from blur

- **Vercel / Geist** treats dark as canonical, builds depth with a *border-in-the-shadow
  layer* (`0 0 0 1px rgba(0,0,0,.08)`) plus a 1 px inner highlight so "cards feel built, not
  floating". ([designsystems.one](https://www.designsystems.one/design-systems/vercel-geist))
- Hyperliquid, Kraken, Bloomberg: panels are separated by a 1 px hairline and a one-step
  surface change. Soft drop shadows are a consumer-app signal; on a dark ground they are
  invisible anyway.

### 1.4 What "student project" and "generic web3" look like

- Glowing orbs, aurora gradients, conic-border shimmer, gradient-filled buttons: by 2025 a
  cliché so universal that generators exist for it.
  ([gradients.design](https://gradients.design/orb-gradient),
  [trishalim](https://trishalim.com/blog/css-tricks-to-create-that-dark-futuristic-web3-look),
  [webstacks](https://www.webstacks.com/blog/web-3-design)). None of the venues above use
  any of it. **We will not either.** The owner's "crypto" ask is answered by density, live
  signals, numerals and a clean dark ground — the things Hyperliquid does — not by glow.
- The other failure mode is ours: serif headlines, long prose, hairline boxes, everything
  small and uppercase. That reads as a working paper.

---

## 2. Diagnosis — why Glasshouse reads academic

Specific, and in order of how much each one costs us.

1. **The headline face.** `Newsreader` at weight 300, 60 px, with an italic clause, is the
   typography of a literary magazine or a thesis. It is the single loudest element on the
   landing page and it says "read me", not "trade here". No venue uses a light serif
   display; Bloomberg's own display tier is a grotesk.
2. **The ground is green.** `#0b1513` / `#f1f4f3` are tinted toward the accent. Because the
   whole page is already teal-ish, the teal accent (`#5cc0b1`, itself desaturated) cannot
   read as *the* colour. Everything is the same temperature. DESIGN.md correctly called the
   palette "botanical". That is the part that has to change.
3. **Surfaces do not separate.** `raised` vs `ground` is 1.08:1 on dark today. A card is
   only distinguishable by its hairline border, so the page is a wireframe of boxes. Venues
   step surfaces by roughly 1.2-1.4 : 1 *and* use the hairline.
4. **Everything is a footnote.** Labels run at 0.58-0.66 rem (9-10.5 px), uppercase,
   tracked 0.12-0.16 em, mono. That is annotation typography. At the same time the numbers
   a venue would set at 40-60 px (blocks left, clearing price) sit at 0.78-1.125 rem. The
   size hierarchy is inverted: the argument is huge and the data is tiny.
5. **Two registers.** `/` is editorial (10 px radius, soft shadows, serif), `/board` and
   `/evidence` are "tape" (3 px radius, mono body, amber labels). The comment in
   `Theme.tsx` argues this is meaning. In practice it is the visual signature of a paper
   with an appendix, and it means a visitor who lands on `/rounds` (editorial) then clicks
   to `/board` (tape) sees two products. Hyperliquid's landing page and app are the same
   system; so are Coinbase's.
6. **Mono at paragraph length** on the tape routes (F-5). Slow to read, and it flattens the
   one distinction the site most needs: sentence vs value.
7. **No live signal.** The status bar prints `BASE MAINNET head 51,204,303` in 10.5 px
   uppercase grey. Nothing on the page moves, pulses, or ticks to say the chain is being
   read right now. A venue's chrome is alive even when the user is idle.
8. **The countdown is a sentence.** `17 blocks · ~34s` at 0.78 rem inside one of four
   identical grey cells. This is the single most important number on `/board` and it has
   no visual rank.
9. **The hero decoration illustrates a word** (section 0). Drifting envelope glyphs plus
   two radial gradient "pools" — the closest thing on the site to the web3 cliché, and the
   only element with no provenance. It is quiet enough not to be ugly and loud enough to
   be wrong.
10. **No wordmark.** The masthead is `Glasshouse / 1inch SwapVM / opcode 0x2e` in 11 px
    uppercase grey. Nothing on any page says the product's name at more than caption size.
11. **Scroll-reveal fades** (`Reveal.tsx`) on the landing page. Venues do not fade sections
    in; it reads as a template, and DESIGN.md already records that it blanks the screenshot
    rig.

None of these are craft failures. Each was a defensible decision for an essay. The product
is not an essay.

---

## 3. The direction

### 3.1 Colour

#### Engaging with the rubric

DESIGN.md criterion 3 says the existing palette "is one of the better things about the
current design" and "a direction needing a new palette is a rewrite". I half agree.

- **What is good, and kept in full:** the token *structure* — `ground / raised / sunk /
  ink / ink-soft / ink-faint / rule / glass / brick / amber / label`, plus `*-soft` tints;
  the one-meaning-per-colour vocabulary; the discipline that nothing decorative may share
  a semantic hue; the lint that measures every pair.
- **What is replaced:** the *values*. The rubric was written when the alternative was
  "install Radix and restyle every component". A value swap in one `@theme` block is not
  that. It is the exact operation the token system exists to make cheap, and the lint
  exists to make safe. Every `text-glass`, `bg-raised`, `border-rule` in every component
  keeps working.
- **What is removed:** the `.tape` palette overrides. One palette, so `amber` can go back to
  meaning one thing.

#### The palette

Dark is canonical. Light is the alternate and is fully specified, not derived.

**Dark (`@media (prefers-color-scheme: dark)`)** — every text/ground pair below is
verified ≥ 4.5 : 1 against `ground`, `raised` *and* `lifted`; the numbers are in the
appendix.

| Token | Now | **Proposed** | Why |
|---|---|---|---|
| `ground` | `#0b1513` | **`#0a0c10`** | Neutral near-black with a cool cast. The tape already uses this; it is the right ground and it was hiding on two routes. |
| `raised` | `#121f1d` | **`#12161c`** | One visible step up (1.08 → 1.10 : 1 luminance, but hue-neutral so the step reads). |
| `sunk` | `#081110` | **`#06080b`** | Table heads, inputs, the status bar. |
| `lifted` *(new)* | — | **`#1a2029`** | Third surface: panel headers, hover rows, popovers. Two surfaces cannot express "header of a card". |
| `ink` | `#e5eeeb` | **`#e8ecf1`** | Cool white, not green-white. |
| `ink-soft` | `#92a6a1` | **`#a3adb8`** | 8.0 : 1 on raised. |
| `ink-faint` | `#7b8f8a` | **`#7f8896`** | 5.1 : 1 on raised, 4.6 : 1 on lifted. This is the provenance-caption colour and it stays AA everywhere. |
| `rule` | `#21332f` | **`#262d37`** | Slightly stronger hairline so panels read without shadows. |
| `glass` | `#5cc0b1` | **`#3ecfb2`** | The teal, kept. Cleaner and higher-chroma so it is *the* colour on a neutral ground. 9.3 : 1 on raised. Close to the mint-teal Hyperliquid owns, which is a feature: it reads "on-chain venue" instantly. |
| `glass-soft` | `#14302b` | **`#0e2a26`** | Tint fill for active phase cell, won row. |
| `brick` | `#db7660` | **`#ff6b5b`** | Forfeit / revert. 6.5 : 1 on raised. |
| `brick-soft` | `#2c1714` | **`#2c1512`** | |
| `amber` | `#d6a94a` | **`#e6b345`** | Provisional / pending / money-to-maker (the ochre price line). 9.4 : 1. |
| `amber-soft` | `#33280f` | **`#2b2210`** | |
| `label` | `#e9b036` | **`#7f8896`** (= `ink-faint`) | **Labels become neutral.** See below. |

**Light (`@theme` base block)**

| Token | Now | **Proposed** | Notes |
|---|---|---|---|
| `ground` | `#f1f4f3` | **`#f4f5f7`** | Cool neutral, not mint-white. |
| `raised` | `#fafcfb` | **`#ffffff`** | |
| `sunk` | `#e7ecea` | **`#e9ecf0`** | |
| `lifted` *(new)* | — | **`#ffffff`** | On light, lifted = raised; depth comes from the hairline and a contact shadow. |
| `ink` | `#0f1a18` | **`#0f1216`** | |
| `ink-soft` | `#4a5c58` | **`#454c57`** | |
| `ink-faint` | `#5a6b67` | **`#5b6470`** | 5.5 : 1 on ground, 6.0 : 1 on white. |
| `rule` | `#d2dcd9` | **`#d5dae0`** | |
| `glass` | `#1f6f66` | **`#0c7a68`** | 4.8 : 1 on ground, 5.25 : 1 on white. Same hue family as dark so the brand is one colour in both themes. |
| `glass-soft` | `#e0edea` | **`#e3f4ef`** | `glass` on it: 4.6 : 1. |
| `brick` | `#9c3b2c` | **`#b42318`** | |
| `brick-soft` | `#f6e5e1` | **`#fbe4e1`** | |
| `amber` | `#8a5a14` | **`#8a5a00`** | |
| `amber-soft` | `#f7eedc` | **`#f7edd6`** | |
| `label` | `#6b5300` | **`#5b6470`** (= `ink-faint`) | |

**Hover / active accent** (not a token today; use `color-mix` as `btn-primary:hover` already
does): dark `#62dfc6`, light `#0a6a5a`. Both verified.

#### Semantics — one meaning per colour, unchanged except one

| Colour | Means | Unchanged? |
|---|---|---|
| `glass` teal | ours · won · a revealed on-chain value · interactive | yes |
| `amber` ochre | provisional / pending / not-live source · money moving to the maker (price line, surplus) | yes |
| `brick` | forfeit · revert · disagreement | yes |
| hatch | a value that exists and cannot be read | yes |
| ink cap, no colour | the winner | yes |
| `label` | column heads, panel ids, eyebrows | **now neutral, not amber** |

**Why labels go neutral.** DESIGN.md records the conflict itself: "amber means *label*
inside `.tape` and *provisional* outside it, and one page cannot be both." With one
register there is one page, so it has to be resolved, and the resolution every venue uses
is that column heads are grey. Amber panel-ids were a Bloomberg quotation; quoting a
terminal is exactly the "colour-scheme choice rather than structural commitment" Curio
warns about. Amber now means only what the chart already uses it for. This *removes* a rule,
which is how DESIGN.md says ties should break.

#### What is explicitly rejected

- **Green as the accent.** The tape's `#3fd18f` is a P&L green. Glasshouse has no
  up/down; making the brand colour "profit green" invites the "number go up" reading and
  collides with every trading convention the judges carry. Teal is distinct, ours, and
  already in the icon.
- **Base blue `#0052ff`.** Tempting for "on Base", but it is Coinbase's brand and we would
  look like a Coinbase property. Mention Base in copy and in the status bar; do not wear
  its colour.
- **Any gradient on any surface.** The `atmo-mesh` radial pools go with the envelopes.
- **Alpha-tint fills for controls** (Radix-style). Already rejected in DESIGN.md for
  contrast; still rejected.

### 3.2 Typography

**Faces.** IBM Plex Sans (400/500/600) and IBM Plex Mono (400/500), both already loaded by
`next/font`. **Newsreader is retired from the UI.** Remove it from `layout.tsx` (one fewer
font fetch at build) and change `--font-display` to the sans stack. Plex was designed as a
sans/mono pair with matching x-height and the mono has a dotted zero and true tabular
figures; it is the right family for a venue and it is the one we have. No new dependency.

**The one rule, applied everywhere, resolving F-5:**

> Mono if it is a value, an identifier or a command — something you could copy and paste
> and have it still mean the same thing. Sans if it is a sentence or a label.

That means:

- `.tape { font-family: var(--font-mono) }` is **deleted**. Body on every route is sans.
  The "a terminal reports" claim is carried by mono *values*, density, and the live status
  line — the same way Hyperliquid's app reads as an instrument in Inter. Mono paragraphs
  did not make it a terminal; they made it a README.
- `.lede` becomes unnecessary and can be deleted once `.tape` is sans.
- `.tnum` stays and is applied to every chain value, as now.
- Column heads, panel-ids, eyebrows and chips move from mono to **sans 500, 11-12 px,
  uppercase, tracking 0.08 em**. Uppercase sans at 500 is how Bloomberg, Kraken and Linear
  set metadata; uppercase *mono* is how a README sets it.
- Headings are **sans 600, tracking −0.01 to −0.02 em**. No light weights above 24 px.

**Scale** (rem, base 16 px; the tape's 14 px body is kept for `/board`, `/rounds`,
`/evidence`, `/account` via a density class, see 3.3):

| Role | Size | Face / weight | Notes |
|---|---|---|---|
| Hero headline (`/` only) | `clamp(2.25rem, 5vw, 3.5rem)` | sans 600, −0.02 em, lh 1.05 | Down from 60 px light serif. Shorter copy, heavier weight. |
| Hero numbers (400 / 250 / 150 bps) | `3rem`–`3.75rem` | **mono 500**, tabular | These are the pitch. Make them the biggest thing after the headline. Unit `bps` at 1rem `ink-faint`. |
| Page title (`/board` etc.) | `1.5rem` | sans 600 | Was 2.6 rem light serif. |
| Section heading | `1.125rem` | sans 600 | |
| **Instrument headline number** (blocks left, clearing price) | `2.75rem`–`3.25rem` | mono 500, tabular | New role; the countdown and the price get it. |
| Body / prose | `0.9375rem` (15 px) landing, `0.875rem` (14 px) instrument | sans 400, lh 1.55 | |
| Table cell | `0.875rem` | sans; values mono | 36 px row height. |
| Label / column head / chip | **`0.6875rem` (11 px) minimum**, `0.75rem` default | sans 500 uppercase 0.08 em | Nothing below 11 px anywhere. Today's 0.58 rem chips (9.3 px) are gone. |
| Provenance caption | `0.8125rem` (13 px) | sans 400, `ink-faint`, lh 1.5 | Up from 0.78 rem. The honest layer should not be the smallest. |
| Address / hash | inherit | mono 400 | |

**Numerals in prose** (e.g. "cleared at 250 bps"): sans with `tabular-nums` and weight 500,
not a switch to mono. Mono is for the value standing alone or in a column.

### 3.3 Density, grid, spacing, elevation

- **Container.** `/` stays `max-w-6xl`. `/board`, `/rounds`, `/evidence`, `/account` go to
  `max-w-7xl` (80 rem). Instruments use the width they are given.
- **One register, two densities.** Keep `Theme.tsx` and the `.tape` class, but `.tape`
  becomes a *density modifier only*: `font-size: 0.875rem; --radius-card: 4px;
  --radius-control: 4px; --radius-chip: 3px; --shadow-card: none`. No colours, no
  font-family. Extend `TAPE_ROUTES` to include `/rounds` and `/account` — they are
  instruments too and the table page in editorial radius is the current inconsistency.
- **Radius.** Landing: card 8 px, control 6 px, chip 4 px. Instrument: 4 / 4 / 3. Nothing
  pill-shaped; the square-ish corner is the venue signal.
- **Spacing scale.** 4 / 8 / 12 / 16 / 24 / 32 / 48. Panel padding 16 px (was 16-20).
  Table cell padding `8px 12px`. Card gap 12 px. Section gap on landing 64 px (was 56-64).
- **Elevation is a surface step plus a hairline, not a shadow.** Dark: `--shadow-card:
  inset 0 1px 0 rgb(255 255 255 / .04)` only (the top-edge catch light Vercel uses);
  `--shadow-lift` (popovers, the bid panel while a tx is pending) `0 12px 32px -12px rgb(0
  0 0 / .6)`. Light: `0 0 0 1px rgb(15 18 22 / .06), 0 1px 2px rgb(15 18 22 / .06)` — the
  border-in-the-shadow technique so corners never clip. The panel header strip (where
  `panel-id` lives) sits on `lifted`, so a card visibly has a head and a body.
- **Panel anatomy** (every `<figure>` and every card, so a screenshot of any one is
  self-describing): header strip on `lifted` — left: title in sans 600 13 px; right: the
  chip. Body on `raised`. Footer: the "What produced this" caption on `raised` above a
  hairline, 13 px `ink-faint`. This is the existing structure; only the header surface and
  the sizes change.
- **Masthead.** `GLASSHOUSE` as a wordmark in sans 600, 15 px, tracking 0.16 em, `ink`,
  with the small teal chart glyph from `icon.svg` at 18 px to its left. Then the four nav
  items in sans 500 13 px, active item `ink` with a 2 px teal underline, inactive
  `ink-soft`. The `/ 1inch SwapVM / opcode 0x2e` string moves to the footer.
- **Status bar becomes the ticker.** Same content, but: sans 500 12 px, on `sunk`, with a
  **6 px teal dot that pulses** (2 s ease) beside `BASE MAINNET` while `source === "chain"`
  and the head is advancing; amber and static for snapshot/fork; amber whole-bar for
  rehearsal exactly as now. Head number in mono 500. This is the "the venue is alive"
  signal and it costs one keyframe.

### 3.4 Data display

**Tables (`RoundsTable`, `Leaderboard`, `Comparison`).**
- Numeric columns right-aligned, mono, tabular. Text columns left. Never centre.
- Header row on `sunk`, sticky (`position: sticky; top: 0`), sans 500 11 px uppercase.
- Row height 36 px; hover `lifted`; no zebra striping (zebra is a spreadsheet, not a venue).
- Units in `ink-faint` after the value (`250` `bps`), never a second column.
- The won row keeps `glass-soft` tint. The forfeit note keeps `brick`.
- Round number column: mono 500 `ink`, the row's anchor. Opened block: mono 400 `ink-soft`.

**Numerals.** Value in `ink` (or the semantic colour), unit one step fainter and one step
smaller. Sign only on deltas (`+150 bps` in the receipt's over-reserve line). Never
animate a number counting up; a count-up is a claim about intermediate values that never
existed.

**The countdown and the phase track (`PhaseTrack`, `Stats`).** This is the biggest single
change on `/board` and the one a judge will look at first.
- The live-round panel opens with a **two-column header**: left, the phase name (sans 600
  20 px, teal for commit/reveal/exclusive, `ink-soft` for open) with the **blocks-left
  number at 3 rem mono 500** below it and `blocks left · ~34 s at 2 s/block` at 13 px
  `ink-faint`; right, the round number, the order hash short form, and the settled/running
  chip.
- Below that, the phase track becomes a **segmented bar**, one row, full width: four
  segments with widths proportional to their block lengths (30 / 30 / 15 / remainder
  fixed at 15 for display). Past segments filled teal at 40 %, the active segment filled
  teal with a 2 px `ink` head marker at the current block, future segments outlined `rule`.
  Each segment carries its label above (sans 500 11 px) and its block range below (mono 11
  px). The `exclusive` segment goes hatched when it is void ("collapses if nobody
  reveals"), reusing `.hatch`.
- The bar is data — every boundary is a contract-written block — so it lives inside the
  existing figure and inherits the panel caption. The head it is computed against is the
  one in the ticker, which is on every page.

**Phase states**, one treatment everywhere (`PhaseChip` in `/rounds`, the board header,
the landing pulse):

| Phase | Chip |
|---|---|
| commit | outline `rule`, text `ink-soft` |
| reveal | `amber-soft` fill, text `amber` |
| exclusive | `glass-soft` fill, text `glass` |
| open (quiescent) | no fill, text `ink-faint` |
| settled | `glass-soft` fill, text `glass`, with a filled 6 px dot |
| live (any of the first three) | prefix a 6 px teal dot; pulsing only on the board |

**The settlement chart (`Settlement.tsx`).** Unchanged in structure and vocabulary — it is
the decision that was right. Under the new tokens: columns in `glass`, price line in
`amber`, forfeit tint in `brick`, hatch in `sunk`/`raised`, all labels sans 11 px, values
mono. Increase the value-at-cap size to 13 px mono 500. The chart also becomes the landing
hero (3.6).

**Bid cards (`BidCards`).** Keep the hatch for sealed. The revealed value goes to 1.5 rem
mono 500. The `house · the maker` tag becomes a neutral chip (sans, `sunk` fill,
`ink-soft`), not amber — it is a label, and amber now means provisional.

**Receipt.** Label column sans 500 11 px `ink-faint`, value column mono `ink`; the
`DISAGREES` state stays `brick` 500. Line height 40 px per row so it reads as a ledger.

### 3.5 Motion

**What moves:**
- The ticker's live dot: 2 s opacity pulse `1 → .35 → 1`, teal, only while a chain read is
  live. Killed by `prefers-reduced-motion`.
- The head marker on the phase bar: `left` transitions 300 ms ease when the head advances.
  Digits themselves never animate (tabular figures mean they do not shift).
- `Swap` cross-fade on phase change: keep, 200 ms.
- A new bid card entering: 150 ms opacity + 4 px rise. Nothing else on the card moves.
- Hover / focus on controls: 120 ms, as now.
- Pending-transaction state on the bid panel: a 1 px indeterminate bar (the existing
  `LoadingBar`), never a spinner over the numbers.

**What must not move:**
- Background fields (`atmo-drift-*`) — deleted.
- Section scroll-reveal (`Reveal.tsx`) — deleted. Content is present on load.
- Any number, ever (no count-up, no ticker-tape scroll).
- Gradient shimmer, skeleton shimmer, glow on hover.

Every duration stays under 300 ms. Hyperliquid's rule stands: motion never obscures a
numeric change.

### 3.6 Imagery

**None, in the illustrative sense.** Delete `Atmosphere.tsx`, the `.atmo-*` rules, and the
envelope motif everywhere it appears. Justification is in section 0.

**What takes its place on the landing page — and why it is not decoration:** the hero's
right half (or, on mobile, the block directly under the headline) is `<Settlement>` rendered
from the most recently settled mainnet round with a winner, inside its own `<figure
data-src>` with its "What produced this" caption. DESIGN.md's "Still open" item asked for
exactly this. It is the one picture that shows the claim (winner bids 400, pays 250, the
line comes from the runner-up), it has real values, and the lint checks it like every other
figure. A visitor sees a chart of real money in the first viewport. That is what a venue
puts in its hero, and it is the only imagery this project is allowed.

If no settled round with a winner is available (it is — round with the 250 bps fill), the
hero shows the `Mechanism` diagram with its `data-src="config"` caption instead. Never a
placeholder.

**Icon and social card:** `icon.svg` recolours to the new `glass`/`amber`. `opengraph-image.tsx`
takes the new dark palette (it is hard-coded; update the constants) and sets the mechanism
line in sans, the numbers in mono — the card should look like the product, and the product
is now dark.

---

## 4. What is preserved, and how this upholds it

- **Every figure keeps its `<figure data-src>`, its source chip and its "What produced
  this" caption.** No component's structure changes; the caption gets *bigger* (13 px) and
  its colour (`ink-faint`) stays ≥ 5 : 1 on every surface it can sit on, including the new
  `lifted`.
- **`scripts/lint-provenance.mjs` passes without modification.** It reads the `@theme`
  block, the dark media block, and the `.tape` blocks by regex and checks `ink / ink-soft /
  ink-faint / glass / amber / brick / label` against `ground` and `raised` at 4.5 : 1. The
  appendix lists every ratio for the proposed values; the lowest is light `glass` on
  `ground` at 4.81. Once `.tape` carries no colour tokens, the lint's `tokensIn` finds no
  `ground` in it and skips that block — by design, the code already handles that path.
  **Add `lifted` to the lint's background list** so the third surface is measured too; one
  string in an array.
- **Nothing decorative can be mistaken for data.** There is now nothing decorative. The
  phase bar and the live dot are both derived from chain state and sit inside captioned
  panels or beside the source line.
- **Both themes work at the smallest size used.** The smallest size is now 11 px, up from
  9.3 px, and every text colour is verified on both grounds at 4.5 : 1 with margin. The
  light theme is specified value by value, not derived.
- **Colour stays strictly semantic**, with one *fewer* meaning (labels are neutral).
- **No new dependency; one fewer font.** Plex Sans + Plex Mono, self-hosted as now.
- **The mainnet numbers are untouched.** 8 auctions, 1 fill at 250 bps — the point of the
  redesign is to make those legible from across a room, not to add anything.

---

## 5. Prioritised implementation

Cheapest-highest-impact first. Effort is for one engineer who knows the codebase. Run
`node scripts/lint-provenance.mjs` and `node scripts/shoot-screens.mjs` after each block;
shoot production, per DESIGN.md's own rule.

### The first two hours — the site looks like a venue

| # | Change | Where | Effort | Why first |
|---|---|---|---|---|
| 1 | **Token swap.** Paste the appendix values into `@theme` and the dark block; add `--color-lifted`; delete the colour tokens from `.tape` and its light media block; set `label` = `ink-faint`. Add `lifted` to the lint's bg array. | `globals.css`, `lint-provenance.mjs` | 25 min | Every component re-skins itself. This alone removes "botanical". |
| 2 | **Type rule.** Delete `font-family` from `.tape`; set `--font-display` to the sans stack; remove Newsreader from `layout.tsx`; `.tape h1` → sans 600 1.5 rem; landing `h1` → sans 600 `clamp(2.25rem,5vw,3.5rem)` tracking −0.02 em; hero bps numbers to 3.5 rem mono 500. Raise every `text-[0.58rem]`–`text-[0.66rem]` to `text-[0.6875rem]` and every mono-uppercase label class to sans (grep `font-mono text-[0.6` and `uppercase tracking`). | `globals.css`, `layout.tsx`, `page.tsx`, ~10 components | 40 min | Kills the essay reading; fixes F-5 by removing a rule rather than adding one. |
| 3 | **Delete the decoration.** Remove `<Atmosphere />` and `Atmosphere.tsx`, the `.atmo-*` CSS, and `<Reveal>` wrappers (keep the component file if anything else imports it). | `page.tsx`, `globals.css` | 10 min | Removes the third instance of the documented mistake and the only gradient on the site. |
| 4 | **Landing hero figure.** Render `<Settlement>` for the newest settled round with a winner in the hero's right column (`lg:grid-cols-[1fr_1.1fr]`), full width under the headline on mobile. Fall back to `<Mechanism>`. | `page.tsx` | 30 min | Real money in the first viewport; the "Still open" item closed. |
| 5 | **Masthead + ticker.** Wordmark `GLASSHOUSE` + icon glyph; nav to sans 13 px with teal active underline; status bar to sans 12 px on `sunk` with the pulsing live dot; head in mono 500. | `layout.tsx`, `StatusBar.tsx`, `NavLink.tsx`, one keyframe | 25 min | The chrome says the name and says it is alive. |

At the end of block one every page is dark-neutral, teal-accented, sans-with-mono-values,
free of decoration, and led by a real chart. That is roughly 80 % of the perceived change.

### The next six hours — the instrument reads as an instrument

| # | Change | Where | Effort |
|---|---|---|---|
| 6 | **Countdown + segmented phase bar** on `/board` per 3.4: two-column panel header with the 3 rem block count; `PhaseTrack` rewritten as a proportional bar with head marker and hatched void segment. | `Auction.tsx`, `board/page.tsx` | 90 min |
| 7 | **Panel anatomy.** Header strip on `lifted` for every `<figure>`/card; caption to 13 px; `.tape` becomes density-only (radius 4, no shadow) and `TAPE_ROUTES` gains `/rounds` and `/account`; instrument routes to `max-w-7xl`. | `globals.css`, `Theme.tsx`, `layout.tsx`, figures | 45 min |
| 8 | **Tables.** Right-aligned numerics, sticky `sunk` header, 36 px rows, `lifted` hover, units faint, no zebra. | `RoundsTable.tsx`, `Leaderboard.tsx`, `Comparison.tsx` | 45 min |
| 9 | **Phase chips unified** per the 3.4 table; `PhaseChip` in `/rounds` and the board header share one component; house-bid tag goes neutral. | `RoundsTable.tsx`, `board/page.tsx`, `Auction.tsx`, `page.tsx` | 30 min |
| 10 | **Bid panel and receipt** sizes: revealed value 1.5 rem; receipt as a 40 px-row ledger; pending state uses the bar not a spinner. | `BidPanel.tsx`, `Receipt.tsx` | 40 min |
| 11 | **Icon + OG card** recoloured and dark; sans/mono split in the card. | `icon.svg`, `opengraph-image.tsx` | 25 min |
| 12 | **Light-theme pass.** Force `prefers-color-scheme: light` in the shoot rig, walk all five routes, fix anything that only worked dark. | rig + spot fixes | 45 min |
| 13 | **Motion audit.** Confirm only the items in 3.5 move; `prefers-reduced-motion` kills the dot. | `globals.css` | 15 min |

Total: ~2 h + ~6 h. If time runs out, stop after 9; 10-13 are polish, and 12 is the one to
do first if any of the tail gets done, because a judge on a light-mode laptop is not rare.

### Explicitly not doing

- No component library, no new font, no new package.
- No touching the reserve rule, the verifier output, the subgraph, or any number.
- No redesign of the `/account` record beyond the token and type changes it inherits.

---

## Appendix A — the token block, ready to paste

```css
@theme {
  --color-ground: #f4f5f7;
  --color-raised: #ffffff;
  --color-sunk: #e9ecf0;
  --color-lifted: #ffffff;
  --color-ink: #0f1216;
  --color-ink-soft: #454c57;
  --color-ink-faint: #5b6470;
  --color-rule: #d5dae0;
  --color-glass: #0c7a68;
  --color-glass-soft: #e3f4ef;
  --color-brick: #b42318;
  --color-brick-soft: #fbe4e1;
  --color-amber: #8a5a00;
  --color-amber-soft: #f7edd6;
  --color-label: #5b6470;

  --radius-card: 8px;
  --radius-control: 6px;
  --radius-chip: 4px;
  --shadow-card: 0 0 0 1px rgb(15 18 22 / 0.06), 0 1px 2px rgb(15 18 22 / 0.06);
  --shadow-lift: 0 0 0 1px rgb(15 18 22 / 0.06), 0 12px 32px -12px rgb(15 18 22 / 0.18);

  --font-display: var(--font-plex-sans), "IBM Plex Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
  --font-sans: var(--font-plex-sans), "IBM Plex Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
  --font-mono: var(--font-plex-mono), "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}

@media (prefers-color-scheme: dark) {
  :root {
    --color-ground: #0a0c10;
    --color-raised: #12161c;
    --color-sunk: #06080b;
    --color-lifted: #1a2029;
    --color-ink: #e8ecf1;
    --color-ink-soft: #a3adb8;
    --color-ink-faint: #7f8896;
    --color-rule: #262d37;
    --color-glass: #3ecfb2;
    --color-glass-soft: #0e2a26;
    --color-brick: #ff6b5b;
    --color-brick-soft: #2c1512;
    --color-amber: #e6b345;
    --color-amber-soft: #2b2210;
    --color-label: #7f8896;

    --shadow-card: inset 0 1px 0 rgb(255 255 255 / 0.04);
    --shadow-lift: inset 0 1px 0 rgb(255 255 255 / 0.06), 0 12px 32px -12px rgb(0 0 0 / 0.6);
  }
}

/* Density only. No colour, no font-family. */
.tape {
  --radius-card: 4px;
  --radius-control: 4px;
  --radius-chip: 3px;
  --shadow-card: inset 0 1px 0 rgb(255 255 255 / 0.03);
  font-size: 0.875rem;
  line-height: 1.55;
}
```

## Appendix B — verified contrast (WCAG, same formula as the lint)

Dark: `ink` 16.5 / 15.3 / 13.8 · `ink-soft` 8.6 / 8.0 / 7.2 · `ink-faint` 5.5 / 5.1 / 4.6 ·
`glass` 10.0 / 9.3 / 8.4 · `amber` 10.2 / 9.4 / 8.5 · `brick` 7.0 / 6.5 / 5.9 · `label` =
`ink-faint` (on `ground` / `raised` / `lifted`). `ground` on `glass` (primary button text)
10.0. Tints: `glass` on `glass-soft` 7.8, `amber` on `amber-soft` 8.1, `brick` on
`brick-soft` 6.1. Hover `#62dfc6` on ground 12.0.

Light: `ink` 17.2 / 18.8 · `ink-soft` 7.9 / 8.7 · `ink-faint` 5.5 / 6.0 · `glass` 4.8 / 5.3 ·
`amber` 5.4 / 5.9 · `brick` 6.0 / 6.6 · `label` = `ink-faint` (on `ground` / `raised`;
`lifted` = `raised`). `ground` on `glass` 4.8. Tints: `glass` on `glass-soft` 4.6, `amber`
on `amber-soft` 5.1, `brick` on `brick-soft` 5.4. Hover `#0a6a5a` on white 6.5.

Every pair the lint measures is ≥ 4.5 : 1. The script that produced these numbers used the
lint's own luminance and contrast functions.

## Appendix C — sources

- Hyperliquid design deep dive — https://hyperliq-trade-us.pages.dev/
- Hyperliquid review (Coin Bureau) — https://coinbureau.com/review/hyperliquid-review
- Coinbase design system analysis — https://www.shadcn.io/design/coinbase ; https://mobbin.com/colors/brand/coinbase
- Kraken palette and system — https://mobbin.com/colors/brand/kraken ; https://getdesign.md/kraken/design-md
- Bloomberg tokens — https://www.shadcn.io/design/bloomberg ; Bloomberg Terminal style — https://designbycurio.com/learn/bloomberg-terminal-green
- KlindrOS Twilight Trading Floor — https://klindros.com/blog/inside-the-twilight-trading-floor-the-design-system-behind-klindros
- Vercel Geist elevation — https://www.designsystems.one/design-systems/vercel-geist
- Fintech dashboard analysis — https://adminlte.io/blog/fintech-dashboard-design-examples/ ; https://pixel-show.com/blog/designing-data-dense-dashboards
- Butterick on monospace — https://practicaltypography.com/monospaced-fonts.html
- Mono font character distinction — https://madegooddesigns.com/best-programming-fonts-2026/
- The web3 cliché, documented — https://gradients.design/orb-gradient ; https://trishalim.com/blog/css-tricks-to-create-that-dark-futuristic-web3-look ; https://www.webstacks.com/blog/web-3-design
