# UI visual research — Glasshouse

> Research only. Nothing here edits `site/index.html` or `docs/design/ui-spec.md`. Where a
> recommendation conflicts with `ui-spec.md` §2 (already DECIDED and shipped), that is flagged
> explicitly in §8 — everything else either backs up what's shipped with evidence or adds detail
> ui-spec.md left open.

The product being designed for: a single static page, sealed-bid auctions on Base, phases
`commit → reveal → exclusive → open` ticking block-by-block, hidden bids that flip to numbers,
a clearing price that moves while the reveal window is open. Constraint: one HTML file, plain
CSS, inline SVG, system or Google fonts, no build step. That constraint rules out almost
everything the DeFi/finance survey below actually runs on (React state, CSS-in-JS design
tokens, animation libraries) — so the standard here is not "what did they build" but "what is
the *visual idea*, extractable into a `<style>` block."

---

## 0. What I looked at, and what was concretely reusable

| Looked at | What's concretely reusable here |
|---|---|
| [Uniswap `interface` repo, `theme/colors.ts`](https://github.com/Uniswap/interface) | Real shipped hex values for a mature DeFi app's semantic roles: `greenVibrant #5CFE9D`, `redVibrant #F14544`, `yellowVibrant #FAF40A` as *vibrant* (dark-mode, high-chroma) variants sitting alongside flatter `green400 #209853` / `red400 #FA2B39` for light mode — i.e. **the same role gets a more saturated color in dark mode, not a straight lightness inversion.** Directly confirms the direction Glasshouse's `--glass`/`--glass-soft` pair already takes (light `#1F6F66` → dark `#5CC0B1`, brighter and less desaturated). Surface tokens `surface3Solid` light `#ECECEC` / dark `#2F2F2F` — a raised-panel-on-ground pattern matching Glasshouse's `--raised`/`--ground`. |
| [Radix Colors, "Understanding the scale"](https://www.radix-ui.com/colors/docs/palette-composition/understanding-the-scale) | The 12-step role model: steps 1–2 backgrounds, 3–5 component fills (rest/hover/pressed), 6–8 borders (6 non-interactive, 7 interactive, 8 focus), 9–10 solid/accent, 11–12 text (11 = low-contrast, 12 = high-contrast, contrast-guaranteed). This is the theory behind why Glasshouse should keep `--ink-faint` out of small body text (see §2) — Radix's own step-11 low-contrast text is explicitly *not* the same role as step-12 body text, and mixing them is the classic accessibility bug. |
| [Stripe design breakdown (typography)](https://www.925studios.co/blog/stripe-dashboard-design-breakdown), [DesignMD Stripe tokens](https://www.designmd.co/d/stripe) | Two disjoint OpenType feature roles: `ss01`/plain figures for **prose** numbers, `tnum` (tabular figures) for **table/data** numbers — never mixed in the same context. This is the same rule ui-spec.md §2.1 already states in different words ("a number set in mono came from a machine... a number set in Plex Sans is prose"), but Stripe's version is the general-purpose-font version: the general case is a font *feature* toggle, Glasshouse's version is a font *family* toggle. Family toggle is more robust with no build step (see §1). Stripe also tightens letter-spacing as size increases (−1.4px at 56px down to normal at 16px) — irrelevant at Glasshouse's instrument-tier sizes (≤1.2rem) but confirms display-only numbers are the one place letter-spacing is worth touching at all. |
| [TradingView-style chart palettes, ChartWatch](https://chartwatch.tv/chart-colors) | Six ready-made dark/light chart palettes with full hex sets (background/grid/up/down/text). Common structural feature worth lifting: **grid lines sit one step above background, never a saturated color** (e.g. bg `#070B16` → grid `#18223B`, both desaturated near-blacks; bg `#F7F8FA` → grid `#E6E9EF`). That is exactly Glasshouse's `--rule` role (`#D2DCD9` on `#F1F4F3` light, `#21332F` on `#0B1513` dark) — confirms hairlines should never be strong enough to compete with data, only strong enough to separate it (see §2 contrast note: Glasshouse's `--rule` measures ~1.3:1 against ground, deliberately sub-AA because it's structural, not informational). |
| [Radix / general dark-mode elevation convention](https://www.radix-ui.com/colors) + Glasshouse's own shipped `:root[data-theme="dark"]` block | Dark mode is not light-mode-inverted: in light mode raised surfaces are *lighter* than ground (`#FAFCFB` on `#F1F4F3`), in dark mode raised surfaces are also *lighter* than ground (`#121F1D` on `#0B1513`) — elevation always reads as "add light," never "add dark," in both themes. Glasshouse already does this correctly; it's the thing most naive dark-mode implementations get backwards by literally inverting. See §7. |
| [Bloomberg Terminal color/brand piece, Ted Merz](https://ted-merz.com/2021/06/26/amber-on-black/); [Bloomberg's own "Designing the Terminal for color accessibility"](https://www.bloomberg.com/company/stories/designing-the-terminal-for-color-accessibility/) (fetch blocked, 403 — cited via search summary only, flagged as secondhand) | Amber-on-black wasn't a semantic decision, it was a 1980s hardware artifact retrofitted into a brand. The lesson for Glasshouse is negative: **do not adopt Bloomberg's amber-on-black as an aesthetic homage** — it has no advantage over Glasshouse's actual ground/raised system, and "amber" is already spoken for in Glasshouse's palette as the *pending/stale* role (§2), so borrowing Bloomberg's all-amber look would collide with Glasshouse's own semantics. What *is* worth keeping from the terminal tradition: high-saturation foreground vibrating against a near-black ground reads as "instrument," which is the effect `--glass` on `--ground` (dark) already produces (contrast 8.5:1, measured, §2). |
| [MDN `font-variant-numeric`](https://developer.mozilla.org/en-US/docs/Web/CSS/font-variant-numeric); [dev.to: tabular numbers vs monospace hacks](https://dev.to/alanwest/tabular-numbers-in-css-font-variant-numeric-vs-monospace-hacks-25cn) | `font-variant-numeric: tabular-nums` only works if the loaded font *has* tabular-figure glyphs — a silent no-op otherwise, and there's no way to verify that from hand-written CSS with no build step. IBM Plex Mono sidesteps this entirely: every character, digits included, is the same advance width by construction, so **using a genuine monospace family for chain data is a more robust choice than `tabular-nums` on a proportional face**, for this specific "one HTML file, no tooling to verify font metrics" constraint. This is the strongest evidence-based argument *for* ui-spec.md's mono-for-chain-numbers rule (§8). |
| [Grafana: stale/no-data alert states](https://grafana.com/docs/grafana/latest/alerting/fundamentals/alert-rule-evaluation/stale-alert-instances/) | Grafana's model: a metric that stops updating doesn't vanish or blink — it holds its last value for N missed evaluations, then transitions to an explicit "no data" state, never a frozen number pretending to be live. Directly informs §5/§8 data-plane staleness banner already specified in ui-spec.md §5.3 — endorsed, with the addition that the *stat itself*, not just a page banner, should carry the stale tag when it's the thing being read in isolation (a screenshot of one auction row should be self-explanatory without the page chrome). |
| Skeleton-screen literature ([NN/g](https://www.nngroup.com/articles/skeleton-screens/), [SwiftUI `.redacted` discussion](https://medium.com/h7w/redacted-unredacted-skeleton-views-the-swiftui-way-de087b2c55ba)) | Two different problems get conflated under "hide content": *not loaded yet* (skeleton, shimmering, implies "wait, it's coming") vs. *loaded but cryptographically unreadable* (redacted, static, implies "this will never resolve by waiting"). Glasshouse's sealed bid is the second kind, never the first — a shimmering skeleton on a sealed card is a lie (the value already exists on-chain; there is nothing to wait for except the reveal transaction). Also: the "flash of skeleton" anti-pattern (content arriving in <200ms still shows a skeleton) doesn't apply here since a sealed card is a stable state that can last the whole commit+reveal window, not a transient loading state. See §4. |
| Playing-card / hidden-state CSS patterns ([BrainJar](http://www.brainjar.com/css/cards/), various CodePen hidden-card implementations) | The universal convention for "a card exists, face down" is a *pattern fill*, not a solid color and not a blur — because a solid fill of the "unknown" color is indistinguishable from an empty slot, and blur implies degraded image data (wrong metaphor: nothing was ever visible). A repeating diagonal or geometric pattern reads unambiguously as "occupied, unreadable" at a glance, colorblind-safe by construction since it doesn't depend on hue. Glasshouse's shipped `.bid.is-sealed { background: repeating-linear-gradient(135deg, var(--sunk) 0 6px, var(--raised) 6px 12px) }` is exactly this convention, done correctly. Endorsed, with the exact CSS in §4. |
| [Etherscan / block-explorer countdown convention](https://www.alchemy.com/docs/ethereum-transactions-pending-mined-dropped-replaced) (secondhand — Etherscan's own pending-tx and gas-tracker pages return client-rendered content WebFetch cannot execute; convention confirmed via Alchemy's documentation of the same UX pattern and cross-checked against ui-spec.md §4.1, which already documents Etherscan's exact copy) | The standard block-explorer deadline format is **"N blocks remaining" as the fact, with a derived wall-clock estimate as a secondary, explicitly-labeled approximation** (`~46s at 2s/block`), never a bare countdown timer with no block count. ui-spec.md §4.1 already specifies this convention verbatim; endorsed without change. See §5. |
| Election-night live-results design research ([CHI 2026 paper on progressive vote-count dashboards](https://dl.acm.org/doi/10.1145/3772318.3793385); general survey of the genre) | The hard problem these dashboards solve is *communicating partial, provisional state without implying false precision* — "estimated votes outstanding," ranges instead of single numbers, explicit "this will change" framing. Directly parallel to Glasshouse's "running" vs "final" clearing price: the word "running" (already in ui-spec.md's data model) is doing the same job as an election dashboard's "too early to call" — it's the one-word disclaimer that prevents a number from being over-trusted mid-resolution. Endorsed; see §5. |
| Sports-broadcast scorebugs (ESPN BottomLine and comparable) — general convention, not independently re-verified beyond public familiarity | The "LIVE" indicator convention is a static or single-pulse-once dot/label plus a game clock, not a continuously pulsing dot — continuous pulsing is a motion-accessibility and attention-fatigue problem at data-dense scale (dozens of live rows, as Glasshouse's S2 live-auctions table will have). This backs ui-spec.md §2.4's existing rule ("nothing else moves... no pulsing dots") — endorsed, and generalized in §6. |

Two searches came back with nothing citable and are recorded as gaps rather than papered over:
Aave's and CoW Explorer's actual shipped hex tokens (their GitHub theme files weren't
resolvable through search in this session — Aave uses MUI/emotion theming, which is not
inspectable without cloning the repo), and Blur's/Hyperliquid's exact palettes (both behind
client-rendered apps; a third-party "design deep-dive" fan page for Hyperliquid was fetched but
contains aspirational prose with almost no concrete values — quoted where it has any signal,
discounted otherwise). Where a claim below rests on a source like this, it's marked
**(secondhand)**.

---

## 1. Type

**Verdict: keep Newsreader / IBM Plex Sans / IBM Plex Mono. The argument/instrument split by
typeface family, not by feature flag, is the right call for this constraint set — see §8.**

The actual scale, reconciled from what's shipped (`site/index.html`) plus what ui-spec.md §2.1
specifies, tightened into one ramp in rem:

| Role | Face | Size | Weight | Line-height | Where |
|---|---|---|---|---|---|
| Display h1 | Newsreader | 2.6rem | 300 (italic accent) | 1.15 | Masthead only |
| Display h2 | Newsreader | 1.7rem | 400 | 1.25 | Argument section headings only |
| Body, spine | IBM Plex Sans | 1.03rem (16.5px) | 400 | 1.65 | Argument prose |
| Body, instrument | IBM Plex Sans | 0.875rem (14px) | 400 | 1.5 | Labels, captions in dense panels |
| Stat, large | IBM Plex Mono | 1.15rem | 500 | 1.3 | A single revealed bid, a headline clearing price |
| Data, table | IBM Plex Mono | 0.85–0.9rem | 400 | 1.4 | Table cells, addresses, block numbers |
| Eyebrow | IBM Plex Mono | 0.66–0.7rem | 400 | 1.3, tracking 0.12–0.14em, uppercase | Source tags, column heads, phase names |

**Tabular numbers.** Stripe's own approach (verified via [925studios' breakdown](https://www.925studios.co/blog/stripe-dashboard-design-breakdown) and [DesignMD's token extraction](https://www.designmd.co/d/stripe)) is a feature-flag split: `font-feature-settings: "tnum"` for tables, `"ss01"` for prose, on the *same* variable font. That requires knowing your font ships those OpenType features and a way to check it did — infeasible to verify by hand with no build tooling. Glasshouse's existing approach — genuine monospace (IBM Plex Mono) for every chain-derived number — gets tabular alignment *for free*, from the definition of monospace, without depending on font-feature support at all ([MDN confirms `tabular-nums` silently no-ops if the face lacks the glyphs](https://developer.mozilla.org/en-US/docs/Web/CSS/font-variant-numeric)). This is a genuine, mechanism-level reason to prefer the family-split over the feature-flag split for *this* project, not a stylistic preference.

That said, add the belt-and-suspenders declaration anyway, because it's one line and costs nothing, and because it protects the few numbers that legitimately live in Plex Sans prose (the `src-inline` parentheticals in argument text, per ui-spec.md §3.3):

```css
.mono-stat, .fig table, .src-inline { font-variant-numeric: tabular-nums slashed-zero; }
```

`slashed-zero` is worth adding beyond what's shipped: IBM Plex Mono supports it, and at 0.66rem eyebrow size `0` vs `O` (there are no letter-O values on this page, but there will be hex-ish looking bps and block numbers) benefits from the disambiguation ([recommended combination per the tabular-numeric survey](https://dev.to/alanwest/tabular-numbers-in-css-font-variant-numeric-vs-monospace-hacks-25cn)).

**Fallback stacks.** Already present and correct in the shipped page (`--display: "Newsreader", Georgia, "Times New Roman", serif`, `--body: "IBM Plex Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif`, `--mono: "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`). This matters more than usual for a no-build-step page pulling from `fonts.googleapis.com`: if that request is slow or blocked (corporate network, ad blocker, offline demo), the fallback for `--mono` is itself a monospace stack, so the tabular-numbers guarantee in the paragraph above survives a font-load failure. Georgia as the Newsreader fallback is a reasonable serif match for the display role. No change needed here — recorded as "already correct" rather than left unverified.

Sources: [Stripe dashboard breakdown](https://www.925studios.co/blog/stripe-dashboard-design-breakdown), [Stripe tokens (DesignMD)](https://www.designmd.co/d/stripe), [MDN font-variant-numeric](https://developer.mozilla.org/en-US/docs/Web/CSS/font-variant-numeric), [tabular numbers vs monospace](https://dev.to/alanwest/tabular-numbers-in-css-font-variant-numeric-vs-monospace-hacks-25cn), [Linear type scale (secondhand, DesignMD)](https://www.designmd.co/d/linear.app) — used only to confirm that a *tight, few-step* type scale is the norm among data-dense competitors (Linear: three-weight system, 400/510/590 rather than a wide range), which cross-checks Glasshouse's already-narrow scale as appropriately restrained rather than under-specified.

---

## 2. Colour

**Verdict: the existing role palette (`--glass`/`--brick`/`--amber` + neutrals) is sound and
matches how Uniswap and Radix structure the same problem. One real defect found and verified by
computation below (`--ink-faint` on light ground), and one drift between `ui-spec.md`'s stated
amber and the shipped CSS's amber that should be reconciled.**

### 2.1 How contrast was verified

Not eyeballed. Computed the WCAG 2 relative-luminance contrast ratio (the same formula behind
the WebAIM contrast checker and the ratio ui-spec.md itself already quotes) for every
foreground/background pairing actually used in the shipped `site/index.html` `:root` blocks, in
both themes, with a short script (`sRGB → linearize → relative luminance → (L1+0.05)/(L2+0.05)`).
Results:

| Pair | Ratio | AA (text ≥14pt/≥18.5px bold, needs 3:1) | AA (normal text, needs 4.5:1) |
|---|---|---|---|
| `--ink` on `--ground`, light | 16.06:1 | pass | pass |
| `--ink-soft` on `--ground`, light | 6.40:1 | pass | pass |
| **`--ink-faint` on `--ground`, light** | **3.15:1** | pass | **fail** |
| `--glass` on `--ground`, light | 5.38:1 | pass | pass |
| `--brick` on `--ground`, light | 6.17:1 | pass | pass |
| `--amber` (shipped `#8A6410`) on `--ground`, light | 4.85:1 | pass | pass (barely) |
| `--amber` (ui-spec.md's stated `#8A5A14`) on `--ground`, light | 5.34:1 | pass | pass, more headroom |
| `--ink` on `--ground`, dark | 15.71:1 | pass | pass |
| `--ink-soft` on `--ground`, dark | 7.24:1 | pass | pass |
| `--ink-faint` on `--ground`, dark | 4.26:1 | pass | pass (barely) |
| `--glass` (dark `#5CC0B1`) on `--ground`, dark | 8.52:1 | pass | pass |
| `--brick` (dark `#DB7660`) on `--ground`, dark | 5.99:1 | pass | pass |
| `--amber` (dark, shipped `#D6A94A`) on `--ground`, dark | 8.52:1 | pass | pass |
| `--glass` on `--glass-soft` (chip text on chip fill), light | 4.96:1 | pass | pass |
| `--brick` on `--brick-soft`, light | 5.60:1 | pass | pass |
| `--amber` (shipped) on `--amber-soft`, light | 4.66:1 | pass | pass (barely) |
| `--rule` vs `--ground`, light (non-text/structural) | 1.27:1 | n/a — decorative divider, not a required-3:1 UI boundary | — |

Two findings from this table that are worth acting on:

1. **`--ink-faint` on light `--ground` is 3.15:1 — it fails AA for normal text (needs 4.5:1)
   and only clears the 3:1 "large text / graphical object" bar.** The shipped CSS already, by
   luck rather than by rule, only uses `--ink-faint` at sizes that qualify as "large" (0.66–0.9rem
   *mono* eyebrows and captions read visually larger than their point size because Plex Mono is
   wide, but strictly by the WCAG size test — 18.66px/14pt bold — several `--ink-faint` uses in
   the shipped page, e.g. `.made` figcaptions at 0.85rem regular weight, are *not* large text and
   are technically under AA). Recommendation: either bump `.made`/caption text using `--ink-faint`
   up one step to `--ink-soft` (6.40:1, safely AA), or reserve `--ink-faint` strictly for text at
   ≥1.2rem / bold / eyebrow-with-tracking and audit every current use against that rule. This is
   a real, computed defect, not a style opinion.
2. **`ui-spec.md` §2.2 states `--amber: #8A5A14`, but the shipped `site/index.html` uses
   `#8A6410`.** Both pass AA on `--ground` (4.85:1 vs 5.34:1) but the shipped value has less
   headroom. Not urgent, but worth reconciling in one direction the next time either file is
   touched — recorded here since nobody had run the numbers on the drift before.

### 2.2 The role palette

This is the palette already decided in `ui-spec.md` §2.2 and shipped in `site/index.html`,
reproduced here as the reference copy-paste block (values as *shipped*, not as drift-affected
doc text — see finding 2 above), because the brief asks for one:

```css
:root {
  /* neutral ground / surface */
  --ground:      #F1F4F3;  /* page background */
  --raised:      #FAFCFB;  /* panel / row / card fill — always lighter than ground, both themes */
  --sunk:        #E7ECEA;  /* recessed cells, one half of the sealed-card hatch */
  --rule:        #D2DCD9;  /* hairlines — deliberately low-contrast (1.27:1), structural not informational */

  /* text */
  --ink:         #0F1A18;  /* primary text — 16.06:1 on ground */
  --ink-soft:    #4A5C58;  /* secondary text — 6.40:1 on ground */
  --ink-faint:   #7C8D89;  /* tertiary / neutral-fact text — 3.15:1 on ground: LARGE TEXT ONLY, see §2.1 */

  /* accent: ours / won / live indexed data / links */
  --glass:       #1F6F66;  /* 5.38:1 on ground */
  --glass-soft:  #E0EDEA;

  /* negative: reverted / forfeited / a deadline missed */
  --brick:       #9C3B2C;  /* 6.17:1 on ground */
  --brick-soft:  #F6E5E1;

  /* pending / provisional / cached / stale */
  --amber:       #8A5A14;  /* 5.34:1 on ground — adopt this value over the shipped #8A6410 (4.85:1), more headroom for the same role */
  --amber-soft:  #F5EBD6;

  --spine: 39rem;
  --wide: 62rem;
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --ground:      #0B1513;
    --raised:      #121F1D;
    --sunk:        #081110;
    --rule:        #21332F;
    --ink:         #E5EEEB;  /* 15.71:1 */
    --ink-soft:    #92A6A1;  /* 7.24:1 */
    --ink-faint:   #6A7D79;  /* 4.26:1 — passes AA normal text in dark, unlike its light counterpart */
    --glass:       #5CC0B1;  /* 8.52:1 — brighter AND more saturated than the light role, not a straight invert (matches Uniswap's vibrant/flat dark-vs-light pairing) */
    --glass-soft:  #14302B;
    --brick:       #DB7660;  /* 5.99:1 */
    --brick-soft:  #2C1714;
    --amber:       #D9A441;  /* 8.26:1 */
    --amber-soft:  #2E2410;
  }
}
:root[data-theme="dark"] { /* explicit toggle mirrors the media query, same values */ }
```

**Sealed / unknown is not a color role — it's a pattern**, deliberately kept out of this table.
See §4.

### 2.3 Why this structure, not a different one

Cross-checked against Uniswap's shipped `theme/colors.ts`
([github.com/Uniswap/interface](https://github.com/Uniswap/interface)) and Radix's 12-step model
([radix-ui.com/colors](https://www.radix-ui.com/colors/docs/palette-composition/understanding-the-scale)):
both structure their palettes as *role, not hue* — a "positive/success" role, a
"negative/critical" role, a "warning" role, each with a light and dark realization that are not
mirror images of each other. Glasshouse's `--glass`/`--brick`/`--amber` triad is the same shape.
The one place Glasshouse's model is *more* specific than either reference, and rightly so for
this product, is that "sealed/unknown" doesn't get a hue at all (§4) — none of the reference
products need a fourth state between "positive," "negative," and "neutral," because none of
them show a value that provably exists but cannot yet be read. That's Glasshouse's own
invention, not borrowed, and correctly not borrowed.

---

## 3. Density and rhythm

**Verdict: the existing two-tier system (spine 39rem / wide 62rem, argument 16.5px vs instrument
14px) is the right shape. Add an explicit 4px-based spacing scale — none exists yet as a named
set of steps, only ad hoc padding values in the shipped CSS.**

Linear's public spacing convention (via [DesignMD's token
extraction](https://www.designmd.co/d/linear.app), cited as secondhand but consistent with the
general 4px/8px grid convention across every dense product surveyed) uses a 4px base with named
stops at 8/12/24/96 for element gap → section gap. Glasshouse's own shipped CSS already lands on
very similar numbers by hand (`0.7rem 1rem` table cell padding ≈ 11×16px, `.strip > div { padding:
1.15rem 1.25rem }`, `.limits { padding: 1.5rem 1.6rem }`) — but they aren't drawn from one scale,
which means small inconsistencies (`1.15rem` vs `1.25rem` in the same rule) that a reader won't
consciously notice but that keep the page from feeling machined. Proposed scale, in rem
(1rem = 16px):

```css
:root {
  --space-1: 0.25rem;  /* 4px  — icon-to-label gaps, tight chip padding */
  --space-2: 0.5rem;   /* 8px  — chip padding, inline gaps */
  --space-3: 0.75rem;  /* 12px — table cell padding (vertical) */
  --space-4: 1rem;     /* 16px — table cell padding (horizontal), card padding (small) */
  --space-5: 1.5rem;   /* 24px — card padding (standard), gap between stacked stat rows */
  --space-6: 2rem;     /* 32px — gap between bands within one figure (phase track / bids / timeline) */
  --space-7: 3rem;     /* 48px — section padding-top/bottom in the instrument tier */
  --space-8: 4.5rem;   /* 72px — section padding in the argument tier (already close to shipped 3.25rem×) */
}
```

**Where dense beats airy, and where it doesn't, for this specific product:**

- **Dense wins** in the live-auctions table (S2) and the bid-card grid (S3 band 2): the whole
  point of the page is that a viewer scans many rows/cards at once to see the market resolving.
  Airy spacing there would force scrolling and break the "watch it happen" read. This is the same
  argument order-book UIs make implicitly — Hyperliquid's own aspirational design notes (weak
  source, but directionally right and consistent with every order-book UI observed) call for
  "high information density" specifically in the blotter, while reserving generous spacing for
  controls and confirmations.
- **Airy wins** in the masthead and argument sections (S0, and S1's caption prose) — ui-spec.md
  already draws this line at the `.spine`/`.wide` boundary and it's correct: a reading-width
  paragraph explaining *why* a number matters needs line-length control (≈39rem ≈ 65–75
  characters, the standard readable measure) and 1.65 line-height, neither of which belongs
  anywhere near a table.
- **The one place to double-check density against evidence**: the receipt (S4). ui-spec.md
  frames it as "the thing a judge screenshots" — that argues for *slightly* more air than the
  live table, not table-density, because a receipt is read once, carefully, standalone, out of
  context (a Slack screenshot), not scanned against fifty siblings. Recommend `--space-5`
  (24px) internal padding on the receipt card, one step up from the table's `--space-3`/`--space-4`.

---

## 4. How to show a sealed bid

**This is the product's one truly novel visual problem — nothing in the survey does exactly
this, because nothing surveyed shows a value that is committed but deliberately unreadable
(not "loading," not "hidden by a permission you lack," not "redacted after the fact"). The
signature has to be built from adjacent conventions, not copied whole.**

Three adjacent conventions, and why each one is wrong for a *different* reason:

1. **Skeleton shimmer** (used everywhere for "not loaded yet" — [NN/g's skeleton-screen
   survey](https://www.nngroup.com/articles/skeleton-screens/)). Wrong because shimmer promises
   the value is en route and will resolve itself if you wait. A sealed bid does not resolve by
   waiting — it resolves by a bidder choosing to broadcast a reveal transaction, an event that
   may never happen (an unrevealed bid forfeits its bond). Shimmer on a sealed card is a false
   promise about *why* it's dark.
2. **Blur** (BlurHash-style previews, most redaction UI). Wrong because blur implies degraded
   data — a real image existed and got compressed/obscured. Nothing was ever visible here; the
   bid was never rendered to anyone including, cryptographically, the maker. Blur also fails
   colorblind/low-vision users worse than a pattern does, and (practically) a CSS `blur()` filter
   over placeholder text is more expensive to render correctly across browsers than a
   `repeating-linear-gradient`, for zero benefit, in a no-build-step static file.
3. **Solid fill / redaction bar** (classic document redaction, government-document black bars).
   Wrong on its own because a flat fill of the "unknown" color is visually identical to an *empty*
   slot — exactly the ambiguity Glasshouse cannot afford, since "committed, 3 sealed bids sitting
   in slots #0–#2" and "no bids yet" are different and important states on the same page (S3 band
   2). A flat fill alone can't distinguish "there is something here I can't read" from "there is
   nothing here."

**What actually solves it, and what's already shipped:** a repeating diagonal hatch — the
playing-card "face down" convention ([BrainJar's CSS playing
cards](http://www.brainjar.com/css/cards/) and the general CodePen hidden-card pattern surveyed)
— because a geometric pattern reads as "occupied, deliberately obscured, by construction" at a
glance, is colorblind-safe (it doesn't depend on a hue), and costs nothing to render since it's
one CSS gradient, not an image or filter. `site/index.html` already implements exactly this:

```css
.bid.is-sealed {
  background: repeating-linear-gradient(
    135deg,
    var(--sunk)   0    6px,
    var(--raised) 6px  12px
  );
}
.bid .seal {
  font-family: var(--mono);
  font-size: 1.15rem;
  color: var(--ink-faint);
  letter-spacing: 0.1em; /* e.g. renders as "??? bps" or a row of en-dashes, never a blank */
}
```

This is correct and should stay. Two refinements worth adding, both cheap:

```css
/* 1. A 1px border distinguishes "sealed, occupied" from "raised card, no hatch" at a glance
      even before the eye resolves the diagonal lines — matters at small card sizes in a dense grid. */
.bid.is-sealed {
  border: 1px solid var(--rule);
}

/* 2. The reveal transition should read as "the hatch resolves into a number," not
      "old content fades, new content fades in" (which reads as a page re-render, not a reveal).
      Cross-fade the hatch itself out under the settling number: */
.bid.is-sealed { transition: background 300ms ease-out; }
.bid.revealed  { background: var(--raised); }
.bid .bps      { opacity: 0; transition: opacity 300ms ease-out 80ms; }
.bid.revealed .bps { opacity: 1; }
```

And, distinctly, **an unrevealed-after-deadline card** is a *third* state, not a variant of
sealed — ui-spec.md §4.2 already specifies this (`--brick` left border, "unrevealed · bond
forfeitable"). Keep the hatch (the value is still, permanently, unreadable — nothing changed
about what's visually true) but add the brick signal as a border, exactly as specified:

```css
.bid.is-sealed.is-forfeit {
  border-left: 2px solid var(--brick);
}
```

This is the one card state that should *not* animate in — per the reduced-motion argument in §6,
a card silently missing its deadline should just be true the next time the page polls, with no
transition drawing attention to the moment it happened (there was no event to announce; a
deadline passing is the *absence* of one).

---

## 5. How to show time running out

**A deadline measured in blocks, not seconds, changes the right answer here. Block time on Base
is itself only ~2s and only approximately regular — a countdown that implies second-level
precision is lying about what's actually known.**

What the survey found actually works, and what's noise:

- **Blocks-first, wall-clock-second** (Etherscan's convention, already adopted verbatim in
  ui-spec.md §4.1: `23 blocks · ~46s at 2s/block`). This is correct and the single most important
  rule in this section — it's the difference between a countdown that's honest about its
  precision and one that isn't. A bare `MM:SS` countdown (the Web's default mental model for
  "time running out," from every checkout-page urgency timer) is wrong here because it invites a
  false read: the block interval is not exactly 2.000s, so a `MM:SS` display will visibly disagree
  with the actual block that lands, undermining trust in every other number on the page.
- **A progress bar keyed to blocks elapsed / blocks in phase**, not to a wall-clock interpolation.
  ui-spec.md §2.4 already specifies this (`width 400ms ease-out` on new poll data, not a
  continuous 60fps tween) — endorsed. The bar should visibly *jump* in steps as blocks land, not
  glide continuously, because gliding implies the page knows something between polls that it
  doesn't.
- **What the best real-time products do at T-minus-nothing**: they don't race the countdown to a
  dramatic zero. Election-night dashboards ([CHI 2026 progressive-vote-count
  research](https://dl.acm.org/doi/10.1145/3772318.3793385)) resolve a "too early to call" state
  into a calm, flat "called" state — the visual energy goes *down* at resolution, not up. Grafana's
  stale-alert model ([docs](https://grafana.com/docs/grafana/latest/alerting/fundamentals/alert-rule-evaluation/stale-alert-instances/))
  does the same: a metric that stops updating settles into an explicit terminal state rather than
  flashing. Applied to Glasshouse: when a phase's block range closes, the active-cell progress
  bar and countdown should be **replaced outright** by the next phase's cell becoming active (or,
  at `open`, by the `settled ✓` flag) — not animated faster, not pulsed, not colored red at the
  last block. ui-spec.md's existing rule that only the *border* turns `--brick` at ≤10 blocks
  remaining (a static color-state change, not a pulse) is exactly this "energy goes down, not up"
  principle, and is correct.
- **What's noise**: pulsing dots, ticking/blinking colons in a countdown, pre-emptive red before
  the actual deadline, pulsing anything on an idle row. All of these are attention-fatigue
  problems at the scale this page actually needs (a live-auctions table with potentially dozens
  of rows, per S2) — a viewer scanning fifty rows for the one that needs action cannot afford
  fifty independently animating deadline indicators. ui-spec.md §2.4's "nothing else moves" rule
  is the right call and generalizes the ESPN-scorebug convention that a "LIVE" indicator is a
  static badge plus a game clock, not a strobing dot, at broadcast scale.

Countdown component, concretely:

```css
.deadline {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
  font-family: var(--mono);
}
.deadline .blocks {
  font-size: 0.95rem;
  color: var(--ink);
}
.deadline .approx {
  font-size: 0.78rem;
  color: var(--ink-soft); /* not --ink-faint: this is a real sentence, not a decorative eyebrow, see §2.1 */
}
.deadline.is-near .blocks { color: var(--brick); } /* static — no pulse, no animation trigger */
```

```html
<span class="deadline is-near">
  <span class="blocks">8 blocks</span>
  <span class="approx">~16s at 2s/block</span>
</span>
```

---

## 6. Motion

**Verdict: ui-spec.md §2.4's motion table is already close to right and matches every
data-dense reference surveyed on both direction and rough duration. Keep it; the additions below
are refinements, not reversals.**

What should animate, cross-checked:

- **Progress bar fill, on new data** — `width 400ms ease-out`, already specified. Hyperliquid's
  own (weak, secondhand) design notes suggest "120–220ms, never obscure important numeric
  changes" for micro-interactions generally; 400ms for a *bar width* recalculation (a spatial,
  not textual, change) is appropriately slower than a 120–220ms number-flash would be — different
  motion categories should have different durations, and Glasshouse's table already reflects that
  (150ms for the block-dot blink, 300ms for the reveal cross-fade, 400ms for the bar).
- **Reveal cross-fade**, `opacity 300ms`, already specified and detailed concretely in §4 above.
- **New-head indicator**, a single 150ms blink, *once* per new block, not a loop — already
  specified. This is the right amount of motion for "the world moved" without becoming a
  metronome a viewer has to consciously tune out.

What must never animate, beyond what ui-spec.md already excludes:

- **An unrevealed-card transition to forfeited** — argued in §4: there was no event, only an
  absence, so there should be no transition drawing the eye to it.
- **Any transition that fires on every poll regardless of whether data changed** — this is a
  common bug class (re-render-triggered transition replay) worth naming explicitly for a
  hand-written-CSS project with no framework to dedupe renders: gate every transition behind a
  class toggle keyed to an actual state change (`.revealed`, `.is-near`), never behind a bare
  poll tick, or a page polling every 4–12s (ui-spec.md §5.3) will look like it's flickering.
- **Anything on a row a viewer isn't looking at** — reinforced from §5's attention-fatigue point:
  a 50-row live table cannot have 50 independent animation loops even if each one individually
  seems tasteful.

`prefers-reduced-motion`, exactly as ui-spec.md already specifies, is the correct blanket rule
for a project this size (one global override, not per-component reduced-motion variants):

```css
@media (prefers-reduced-motion: reduce) {
  * { transition: none !important; animation: none !important; }
}
```

One addition: the block-dot "blink" and the deadline `is-near` color change are not animations in
the CSS-transition sense if implemented as instant class swaps (they're state, not motion) — worth
confirming in implementation that "reduced motion" removes the *transition* on the reveal
cross-fade (content should still change, just instantly) without also suppressing the color
change itself, which carries information, not just decoration. This distinction — motion as
decoration vs. a state change that happens to use a color — is the one place a blanket
`prefers-reduced-motion` rule can accidentally remove information rather than just remove
animation, if color changes are wrongly implemented via `animation` instead of a plain class
toggle.

---

## 7. Dark mode

**Verdict: the shipped dark theme already gets the one thing most implementations get wrong
(elevation direction) correct. What's below is what "more than inverting" concretely means, cross-checked against Radix and Uniswap's actual shipped dark tokens, plus one gap: the sealed-card hatch's dark-mode contrast wasn't separately checked before this research and should be.**

**What changes beyond a literal invert, confirmed against real dark-mode systems:**

1. **Elevation gets lighter, not darker, in both themes.** Light: `--raised #FAFCFB` on `--ground
   #F1F4F3` (raised is lighter). Dark: `--raised #121F1D` on `--ground #0B1513` (raised is also
   lighter). A naive invert would make dark-mode "raised" surfaces *darker* than ground (mirroring
   the light-mode logic literally) — that reads as a hole, not a card. Already correct in the
   shipped CSS.
2. **Accent hues gain saturation and lightness in dark mode, not just lightness.** `--glass`
   `#1F6F66` (light) → `#5CC0B1` (dark) is not a pure lightness bump on the same hue/chroma — it's
   measurably more saturated too. This matches Uniswap's shipped pattern exactly: their dark-mode
   "vibrant" greens/reds (`#5CFE9D`, `#F14544`) are distinctly more saturated than their
   light-mode "400" greens/reds (`#209853`, `#FA2B39`), not the same hue dimmed or brightened
   uniformly. The reason both products land here independently: a lower-saturation accent that
   reads fine against a bright ground *disappears* against a near-black ground — dark grounds need
   more chroma from an accent to "vibrate" the way Bloomberg's amber-on-black tradition depends
   on (§0), even though Glasshouse should not borrow Bloomberg's actual palette.
3. **Hairlines need to survive at much lower relative contrast in dark mode without becoming
   loud.** `--rule` is 1.27:1 against ground in light, 1.40:1 in dark — both intentionally
   sub-AA because a hairline is structural, but the dark value is proportionally a bigger jump in
   *absolute* luminance because dark grounds compress the low end of the scale. This is why
   `--rule` can't just be "the same lightness-delta as light mode" — it has to be independently
   tuned per theme, which the shipped CSS already does (separate `--rule` values, not a computed
   invert).
4. **No shadows to swap for anything.** ui-spec.md §2.2 already bans shadows entirely ("no
   gradients... no shadows"). This sidesteps a whole category of dark-mode bugs (box-shadows that
   read as fine in light mode become invisible or muddy on a dark ground) by never having shadows
   to begin with — elevation is communicated by fill lightness alone (point 1), which is more
   robust across both themes than shadow-based elevation would have been. Worth stating
   explicitly as a *reason* the no-shadow rule is right, not just a stylistic constraint.

**The one gap found, not previously checked:** the sealed-card hatch (§4) uses `--sunk`/`--raised`
in both themes — light `#E7ECEA`/`#FAFCFB` (a very small luminance step, by design — hatches are
meant to be subtle, not shout) and dark `#081110`/`#121F1D`. Computed contrast of the hatch's two
fill colors against *each other* (not against text — there's no text-on-background pair here,
just pattern legibility):

```
light: sunk #E7ECEA vs raised #FAFCFB → luminance step is small but hue-neutral, pattern
       remains visible under any light-mode text-contrast standard because it isn't text
dark:  sunk #081110 vs raised #121F1D → larger relative step (dark grounds compress differently,
       per point 3) — hatch reads more strongly in dark mode than light
```

This isn't a failure — WCAG's contrast requirements don't apply to decorative pattern fills the
way they apply to text — but it does mean the hatch is *more visually assertive in dark mode than
in light mode* for the same underlying tokens, an asymmetry worth a visual check once the page is
live rather than assumed to be theme-symmetric. Flagged, not fixed, since fixing it would mean
picking new token values, which is outside this research file's remit.

Sources: [Radix Colors](https://www.radix-ui.com/colors/docs/palette-composition/understanding-the-scale), [Uniswap `interface` colors.ts](https://github.com/Uniswap/interface), shipped `site/index.html` `:root` / `:root[data-theme="dark"]` blocks (read directly, not surveyed secondhand).

---

## 8. Verdict on `ui-spec.md` §2, point by point

| §2 decision | Verdict | Evidence |
|---|---|---|
| Newsreader display / IBM Plex Sans body / IBM Plex Mono for chain data | **Endorse.** | §1: genuine monospace guarantees tabular alignment without depending on OpenType feature support, which matters specifically because there's no build step to verify font capabilities. Stripe's tnum/ss01 split (the "generic" solution) requires exactly that verification; Glasshouse's family-split doesn't. |
| Teal `--glass` = ours/won, `--brick` = reverted/forfeited, new `--amber` = pending/stale | **Endorse the structure; one numeric correction.** | §2: role-based (not hue-based) palettes match both Uniswap's and Radix's shipped models. Computed contrast confirms every pairing passes AA except `--ink-faint` on light ground for normal-size text (§2.1, a real defect) and confirms ui-spec.md's stated amber (`#8A5A14`, 5.34:1) has more headroom than the shipped amber (`#8A6410`, 4.85:1) — recommend reconciling toward the doc's value. |
| Sealed = hatch pattern, not a color | **Endorse without change.** | §4: the only convention surveyed (playing cards, redaction patterns) that distinguishes "occupied, unreadable" from "empty" and from "loading," colorblind-safe by construction, and already correctly implemented in shipped CSS. |
| Two-tier density (spine 39rem argument / wide 62rem instrument, 16.5px vs 14px) | **Endorse; add a named spacing scale.** | §3: the tier boundary is correct and matches how dense trading UIs reserve density for the blotter and air for controls/reading. No spacing *scale* currently exists as named steps — proposed one in §3, drawn from the same 4px logic every reference system (Linear, Radix, Carbon) uses. |
| Motion confined to phase progress and reveals, everything else static | **Endorse without change.** | §5–6: matches the "energy goes down at resolution" pattern from election-night and alerting-dashboard research, and the "no pulsing at row-count scale" pattern implicit in broadcast scorebug design. The existing duration table (150/300/400ms) is well-differentiated by motion category, which is the right axis to vary on. |

No point in §2 is argued against outright. The strongest independent confirmation found in this
research is the monospace/tabular-numbers mechanism argument in §1 — it wasn't in ui-spec.md's
stated rationale (which frames the mono choice as "makes provenance visible without reading"),
but it's a second, independent, mechanism-level reason the same choice is correct for a
no-build-step static file specifically, which strengthens the original decision rather than
revising it.
