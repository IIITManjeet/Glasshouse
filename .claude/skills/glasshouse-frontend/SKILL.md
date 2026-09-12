---
name: glasshouse-frontend
description: Use when a maker, judge, or another agent is doing frontend, UI, design, styling or component work anywhere under web/ in this repo — adding or editing a button, chip, label, table, chart, figure, empty state, or anything in web/app/globals.css, or asked to review, screenshot or "fix" how a page looks. Enforces the house conventions that already exist in the code (primitives, one primary per view, the provenance lint, honest empty states, measured screenshots, the type/density split) instead of letting a fresh agent rediscover or violate them.
---

# Glasshouse frontend skill

## Why this file exists

`web/app/globals.css`, `DESIGN.md` and `docs/design-direction-2026-09.md` already record a
design language and the mistakes that produced it. A fresh agent reading only the component
it is about to touch cannot see that history and repeats it — an ad-hoc bordered `<span>`
that looks like a button (F-3), two primary buttons on one page (F-4), a figure with no
source, a screenshot "bug" that is a capture artefact. This file stands in for having read
all three.

## The primitives (`web/app/globals.css`) — every label and control uses one of these

- **`.chip`** — a label. Soft `glass`-tinted fill, no border, `cursor: default`, never
  focusable. For metadata: provenance, phase-adjacent tags, "indexed · GlasshouseBook
  subgraph". Never wire an `onClick` to a `.chip`. Variants `.chip-live` (glass text, for
  "read from Base mainnet") and `.chip-warn` (amber fill, for fork/sim/snapshot) carry the
  one distinction a screenshot can do the most damage by losing — see `SourceChip`.
- **`.btn` + one of `.btn-primary` / `.btn-secondary` / `.btn-tertiary` / `.btn-danger`** —
  a control. Same fixed size across all four; hierarchy is fill, never scale.
  - `.btn-primary`: filled `glass`, `color-ground` text. The only filled thing on a view —
    **one per view, no exceptions** (see next section).
  - `.btn-secondary`: bordered, inverts on hover. The workhorse — a real action that isn't
    the page's one primary.
  - `.btn-tertiary`: bare text, wash on hover ("invisible until reached for"). For actions
    that would crowd a dense view if bordered.
  - `.btn-danger`: bordered `brick`, inverts to `brick` on hover.
- **`.btn-toggle`** — a *standing state*, not an action. Driven by `aria-pressed`, not a
  second boolean in a className, so the visible and announced state cannot drift. Quiet when
  off, `amber` fill when `aria-pressed="true"` (the rehearsal toggle).
- **`.tape`** — a **density** modifier only: tighter radii (`--radius-card: 4px` etc.),
  `font-size: 0.875rem`, `line-height: 1.55`. **No colour, no `font-family`.** It used to also
  set `font-family: var(--font-mono)` as the body face on `/board` and `/evidence`; that was
  deleted (`web/app/globals.css` around the "`.tape` — the density theme" block, and
  `TODO.md` "F-5 the type rule — RESOLVED BY DELETING THE RULE") because mono at paragraph
  length is slow to read. Do not reintroduce a colour or a font onto `.tape`.
- **`.tnum`** — `font-mono` + `tabular-nums`, global, for every number that came from a
  chain, a test or a computation, so a column of digits lines up and a changing digit does
  not shift its neighbours.
- **`.lede`** — the prose face (`font-sans`, looser leading) for the explanatory sentence
  under a heading, kept distinct from `.tape`'s density. **`.panel-id`** (scoped inside
  `.tape`) is the matching eyebrow-label style for panel headers.
- **`.hatch`** — a diagonal-stripe fill meaning "a value exists and cannot be read yet" (a
  sealed bid). Never use it for "loading" — that is a false claim; `<LoadingBar>` is for
  loading.
- **`.live-dot`** — the one thing that moves on its own: a 6px pulsing dot meaning "this is
  being read from the chain right now". Never the *only* signal of liveness — the word
  `BASE MAINNET` or `SNAPSHOT IN REPO` beside it must say the same thing.
- **`.nowrap-token`** — declared (exempted from `overflow-wrap: anywhere`, alongside `th` and
  `.chip`) but **not applied anywhere in `web/` today** (grep confirms zero call sites). It
  is reserved for a future single-token value that needs the exemption outside a `<th>` or
  `.chip`; do not assume it is already doing anything.

**The hard rule, and the grep that proves it.** Every label and control in the app uses one
of the primitives above — `TODO.md`: *"a grep for the old ad-hoc class lists returns
nothing."* The pattern that used to exist and no longer does:

```
grep -rn "border border-glass px-2 py-0.5 font-mono" web/components web/app
```

returns nothing (verified 2026-09-12). If you are about to write
`className="border border-glass px-2 py-0.5 font-mono text-[0.64rem] uppercase ..."` by
hand, stop — that exact shape is the regression DESIGN.md F-3 fixed (a chip that looked
identical to a button), and it is a `.chip` or a `.btn-*` instead.

## The CTA hierarchy rule

One `.btn-primary` per view, full stop (`globals.css`: *"ONE PRIMARY PER VIEW... two of them
on one page means neither is primary"*). Everything else that acts is `.btn-secondary`
(a real, non-primary action) or `.btn-tertiary` (invisible until reached for, for actions
that would crowd the view).

**The recorded over-correction, worth internalizing before you default to tertiary:**
`web/app/rounds/page.tsx` gives `refresh` `.btn-secondary`, with the reasoning inline —

```tsx
<button
  type="button"
  onClick={refresh}
  // Secondary, not tertiary: this is the only control on the page, and the
  // "invisible until reached for" treatment is for actions that crowd a view.
  // One quiet action in an empty corner just looks like text.
  className="btn btn-secondary"
>
  refresh
```

`TODO.md` confirms this was a caught mistake: *"`refresh` was too quiet as tertiary when it
is the only control on the page."* The lesson: tertiary is for decluttering a view that
already has controls competing for attention, not a default weight for "minor" actions —
judge it against what else is on the page, not against the verb.

## The provenance rule (the most important one)

Every figure on the page must name what produced it, and `scripts/lint-provenance.mjs`
**fails the build** if one does not — run as `node scripts/lint-provenance.mjs`, and wired
into `npm run lint:page` (root `package.json`) and into `scripts/run-checks.mjs` (`npm
test`). It scans `site/index.html` always, and the exported `web/out/*.html` pages whenever
they exist (build first with `npm --prefix web run build`, since `output: "export"` in
`web/next.config.mjs` produces `web/out/`). It also computes WCAG contrast for every token
pair in `globals.css`'s light/dark/`.tape` blocks and fails below 4.5:1.

**How a new number must be tagged**, exactly as `scripts/lint-provenance.mjs` checks it —
every `<table>`, `<svg>` (unless `aria-hidden="true"`, meaning it is provably decorative), or
`class="stat"` must sit inside a `<figure data-src="...">` whose body contains the literal
words `"What produced this"`.

**A correct example, copied from `web/app/rounds/page.tsx`:**

```tsx
<figure data-src={source} className="mt-8">
  {/* ...table, chips, loading/error states... */}
  <figcaption className="mt-3 text-[0.78rem] text-ink-faint">
    <span className="text-ink-soft">What produced this:</span> {caption}
  </figcaption>
</figure>
```

`web/components/Record.tsx` is a second worked example — `<figure data-src="base" ...>` with
a closing paragraph that starts `<strong>What produced this:</strong>` and names the exact
subgraph entity, the mapping file, and what each number does and does not mean (a count, not
a rate or share). Follow that shape, not a shorter one — the lint checks the words are
present, but the house style is that the sentence also says *which* file or contract path
produced the number, per `subgraph/README.md`'s refusals list (no ratio without both
numbers, no rate presented as one).

## Honest empty states

**"We could not read it" is not "nobody bid."** Two recorded instances to match, not
reinvent:

1. **The account page wall of zeros** — `web/components/Record.tsx`. An address the indexer
   had seen but that had never bid used to render "0 of 0 sealed" above six tiles of `0`:
   every figure correct, the panel saying nothing, reading as a broken page rather than an
   account with no history. The fix (`const neverBid = ...`) collapses that case to one or
   two sentences and **does not draw the zero tiles at all** — see the `neverBid` branch and
   its comment *"NOTHING TO SHOW IS A SENTENCE, NOT A GRID OF ZEROS."*
2. **The rounds filters** — `web/components/RoundsFilter.tsx`. `revealedCount` is `null`
   when the chain read for that round failed, which is different from reading it and finding
   zero reveals. Scoring a null as "no reveals" would put a round in the "Nobody opened" tab
   on the strength of a network error — and that tab is an accusation about bidders. The
   `readable()` predicate and `unreadableCount()` keep unreadable rounds **named separately**
   rather than swept into a bucket that looks like a real zero.

The rule for new code: before you render a `0`, ask whether you actually read a `0` or
whether the read failed — and if a read can fail, carry that as a third state (not-yet-read
/ read-as-zero / read-failed), never collapse the last two.

## Measure before believing a screenshot

Three recorded incidents in `DESIGN.md`, each a capture artefact mistaken for a product bug,
each withdrawn once measured:

- **F-8**: `chrome --headless --window-size=390,1600 --screenshot=` clamps Chrome's window to
  a platform minimum (~500px on Windows), lays out at that width, and crops the PNG to what
  was asked for — every page "clipped" identically at 390px and nothing was actually
  overflowing.
- **F-9**: a floating circle seen covering content on `/board` and `/rounds` was the Next.js
  dev-tools indicator that `next dev` injects — absent from a production build.
- **F-7**: the landing page's CTA panel appeared to render empty; the capture had simply been
  taken mid cross-fade transition (`<Swap>`).

`DESIGN.md`'s own rule from the F-8 writeup: **a screenshot is evidence of what a tool
produced, not of what a browser rendered.** A layout claim needs a measurement taken inside
the page, not an eyeballed image.

**The tool**: `node scripts/shoot-screens.mjs` (optional `--base <url>`, `--only
board,evidence`, `--scheme light`). It drives the DevTools Protocol with
`Emulation.setDeviceMetricsOverride` (a real layout viewport, not a clamped OS window) and
prints `document.documentElement.scrollWidth` vs `window.innerWidth` beside every capture —
that number, not the image, is what proves or disproves an overflow. Shoot production when
judging a capture-vs-render question, per the F-9 correction: *"shoot production before
recording a visual defect, or say in the finding that you did not."*

**A suspected visual defect must be measured before it is fixed** — reproduce it with the
scroll-width check above, or a real browser, before changing CSS to "fix" it. **Withdrawn
findings get written down in `DESIGN.md`, not deleted** — see the "⚪ WITHDRAWN" F-7/F-8/F-9
entries: each keeps the wrong symptom, the evidence, how it was caught, and what was kept (a
still-correct `overflow-wrap: anywhere` rule survived F-8 even though the overflow it was
chasing never existed).

- **F-11**: the fourth, and the one to have in mind on any route that reads the chain. The
  first captures of `/rounds` showed an empty table under a populated header — exactly what a
  `RoundsTable` that never receives rows looks like. The capture had beaten a 2.3-second chain
  read. Worse than the other three, because it looked like a data-layer failure on the page
  whose whole job is to show the Book has history, and it would have been "fixed" by adding a
  retry to a component with no bug. `useAuctions.ts` has loading states for exactly this, and
  the rig waits a fixed `--settle 3500`ms — raise it for a route whose read is slower than
  that, and never record a defect from a capture you did not give time to settle.

## The type and density rule

One register, one voice, across all five routes (`docs/design-direction-2026-09.md` §3.2,
already implemented in `globals.css`):

> Mono if it is a value, an identifier or a command — something you could copy and paste and
> have it still mean the same thing. Sans if it is a sentence or a label.

`.tape` is density only — radii, `font-size`, `line-height` — **no colour, no
`font-family`**; do not add either back to it. **11px (`0.6875rem`) is the floor** for any
provenance caption, chip or column-head label; nothing on the site goes smaller. Uppercase +
letter-spacing + mono is *not* an interactivity signal on its own (this is the trap DESIGN.md
F-3/F-4 fell into) — the border, the pointer, the hover-invert and the focus ring are what
mark a control; type treatment marks a register, not affordance.

## Verify your change

In order, before claiming frontend work is done — commands copied verbatim from
`web/package.json` and the root `package.json`:

```
npm --prefix web run build        # static export -> web/out/  (next.config.mjs: output: "export")
node scripts/lint-provenance.mjs  # fails the build if a figure has no source/caption, or a contrast pair regresses
npm --prefix web run lint         # next lint
npm test                          # scripts/run-checks.mjs: test:solidity + test:js + lint:page, all three run and report even if one fails
```

`npm test` at the root already runs `lint:page` as one of its three suites (see
`scripts/run-checks.mjs`'s comment on why `&&` was the wrong operator — a red Solidity test
used to hide the provenance lint from ever running). If you only touched `web/`, running
`npm --prefix web run build` then `node scripts/lint-provenance.mjs` directly is the fast
path; run the full `npm test` before calling the change done.
