# DESIGN.md — UI and UX findings

A running log of interface problems found while actually using the thing, and what was
done about each. Newest first.

**This is not the planning document.** `docs/archive/DESIGN.md` is the original UI plan
written before the build; it says what the interface was meant to be. This file says what
it turned out to be like to use, which is a different question and only answerable after
there is something to use.

**House rule for this file:** every finding names the file and line, says what a person
actually experienced, and separates *the symptom* from *why it matters*. "The button is
ugly" is not a finding. "A non-clickable chip and a clickable button share one visual
treatment, so people do not know what is clickable" is.

| Status | Meaning |
|---|---|
| 🔴 open | agreed, not yet done |
| 🟡 partial | fixed in one place, not everywhere |
| 🟢 fixed | done, with the commit or the file that did it |
| ⚪ won't fix | decided against, with the reason |

---

## F-9 ⚪ WITHDRAWN — the floating circle is the Next.js dev indicator (see the corrections at the end)

**Symptom.** On mobile the round "N" control pinned to the lower left overlaps the phase
grid, covering the first letter of `EXCLUSIVE`. It is pinned to the viewport, so on a long
scrolling page it sits over whatever happens to be behind it.

**Evidence.** `design-shots/02-board.mobile.png` — the toggle covers the E of the
`EXCLUSIVE` card.

**Why it matters.** It obscures real content at the one width where there is least room to
spare, and an unlabelled circle floating over a data panel reads as a rendering fault
rather than as a control.

---

## F-8 ⚪ WITHDRAWN — "the page clips on a 390px phone" was a measuring error, not a bug

**This finding was wrong, and the way it was wrong is worth keeping.**

It was originally recorded here as the most serious item in the file: at 390px every screen
appeared to clip on the right — the hero headline cut mid-word, the status bar losing its
last control, the footer cut. A width ladder appeared to confirm it: 390 broken, 480 clean.
It was reported as outranking every other finding.

**It was an artefact of how the screenshots were taken.** `chrome --headless
--window-size=390,1600 --screenshot=x.png` does not do what it appears to do on Windows.
Chrome clamps the window to a platform minimum of roughly 500px, lays the page out at that
clamped width, and then writes a PNG cropped to the size that was asked for. Every page
therefore "clipped" identically, which should itself have been the clue: a real overflow
caused by one wide element does not reproduce uniformly across pages with different content.

**How it was caught.** A control page — a `width:100vw` bar with a right-floated marker —
rendered at `--window-size=390`. The marker was missing from the capture and present at 600.
Nothing about that page can overflow, so the cropping was in the tool.

**What is actually true.** Re-shot through the DevTools Protocol with
`Emulation.setDeviceMetricsOverride` (a real 390px layout viewport, `mobile: true`,
2x DPR), and measuring `document.documentElement.scrollWidth` against `window.innerWidth`
on every page at every width: **no horizontal overflow anywhere**. The mobile layout is
sound — the phase grid folds to 2x2, the bid cards stack, the stats row wraps, the footer
addresses wrap.

**What was kept from the false alarm.** One line, `overflow-wrap: anywhere` on `html` in
`web/app/globals.css`. It fixed nothing that was broken, and it is kept only because a
42-character hex address genuinely has a min-content width wider than a phone, so it is
correct defensively — the footer addresses now wrap rather than relying on the layout never
getting narrower. The comment in that file has been corrected so it does not claim to have
fixed an overflow that never existed.

**The rule this leaves behind, which is the actual value of the entry.** A screenshot is
evidence of what a tool produced, not of what a browser rendered. Any layout claim made
from an image must be backed by a measurement taken inside the page —
`scrollWidth` vs `innerWidth` — and `scripts/shoot-screens.mjs` now prints exactly that
number beside every capture, so the next person cannot make this mistake quietly.

---

## F-7 🔴 The landing page's only call to action can render empty

**Symptom.** In capture, the panel between the bps figures and the "One round, end to end"
diagram is an empty bordered box with a caption under it and nothing inside. That box is
the landing page's *only* CTA — it contains "Open the board →"
(`web/app/page.tsx:108-110`) and, when no round is live, "Watch a simulated one"
(`:116-121`).

**Evidence.** `design-shots/01-landing.desktop.png`, `01-landing.mobile.png`.

**Why it matters.** With that panel blank, the landing page has **no action of any kind**.
It makes its argument and then offers nothing to do, so the only way forward is the nav.
An empty bordered box also reads as a loading failure rather than as a state.

**Not yet established:** whether this is a real empty state or an artefact of the
screenshot's virtual-time budget catching `<Swap>` mid-transition. Confirm by loading
`/` in a real browser and watching that box before changing anything.

---

## F-6 🔴 The navigation never says which page you are on

**Symptom.** `Board / Rounds / Evidence / Bidders` render identically on every page. On
`/board`, "Board" is not marked. There is no active state, no underline, no colour change.

**Evidence.** `web/app/layout.tsx` — every nav `Link` carries the same
`hover:text-glass` and nothing else. Visible in every desktop capture.

**Why it matters.** It is the cheapest orientation cue there is, and its absence is felt
most by exactly the person this site is for: someone who arrived from a link, does not know
the structure, and is deciding where to go next.

---

## F-5 🟡 REFRAMED — monospace on the tool routes is deliberate (see the corrections at the end)

**Symptom.** Body paragraphs are set in monospace — the board's intro, the status line, most
captions. Only headings use the serif display face.

**Evidence.** `design-shots/02-board.desktop.png`: *"The round happening right now, and the
panel to join it…"* is mono at a full measure. Compare the landing hero
(`01-landing.desktop.png`), where the serif paragraph under the headline reads easily.

**Why it matters.** Monospace is right for the things that *are* code — addresses, block
numbers, bps, the `cast send` line — and it earns the project's tone. At paragraph length it
slows reading and flattens the difference between prose and data, which is the one
distinction this interface most needs to preserve. The landing page already does this
correctly; the app pages do not.

**Suggested rule:** mono for anything that is a value, an identifier or a command; the sans
or serif face for anything that is a sentence. That single rule would also resolve much of
F-3, because "is it mono" would start to mean something.

---

## F-4 🔴 Buttons do not read as buttons, and no call to action outranks another

**Symptom.** Nothing on screen announces itself as pressable, and the primary action on a
page looks exactly like the least important control next to it.

**Evidence.**

- The whole app has **one** filled, primary-looking button, and it is on the error page:
  `web/app/error.tsx:55` — `border border-glass bg-glass-soft px-4 py-2 … hover:bg-glass
  hover:text-raised`. Every action a visitor is actually meant to take — *Connect wallet*,
  placing a bid, copying the `cast send` line, turning the rehearsal on — uses a thin
  outline instead.
- `web/components/WalletBar.tsx:15` defines the shared button as
  `border px-3 py-1.5 font-mono text-[0.75rem]`, with `BTN_IDLE` adding only
  `border-glass text-glass`. On `/board`, *Connect wallet* — the single most important
  control on the page — is visually identical in weight to the *Rehearsal on/off* toggle
  beside it in the status bar.
- The deliberate rule behind this is written at `WalletBar.tsx:14`: *"No brand colour, no
  filled buttons except where urgency is the message."* The restraint is defensible; the
  result is that urgency is never the message anywhere, so nothing is ever emphasised.

**Why it matters.** Visual hierarchy is how a first-time visitor decides what to do next.
With every control at the same weight, the page has no answer to "what am I supposed to do
here", and a tester has to read every label to find the one that matters. This is a
usability score, and usability is scored in both judging rounds
(`docs/archive/run.md` F-100).

**Not yet decided:** whether to introduce a filled primary style, or to keep the outline
language and create hierarchy by size and spacing instead. The second is more in keeping
with the rest of the design and is probably the right answer; it needs one pass over every
control rather than a token change to one.

---

## F-3 🔴 Clickable and non-clickable things share a visual treatment

**Symptom.** A provenance chip that does nothing looks like a button.

**Evidence.** The source chip is a `<span>`:
`border border-glass px-2 py-0.5 font-mono text-[0.64rem] uppercase tracking-[0.12em]
text-glass` — `web/components/Record.tsx:94` and `web/components/Timeline.tsx:125`. The
wallet button is a `<button>` at `border-glass … text-glass` with slightly larger padding.
Same border colour, same text colour, same mono-caps type, same box. The only difference is
2px of padding.

**Why it matters.** This is worse than the hierarchy problem in F-4, because it is not a
matter of emphasis but of category: people will try to click the chip, and will not know
the button is a button. Every bordered mono box on the page currently means *either*
"press this" *or* "this is a label", and there is no rule to tell them apart.

**Related:** F-4. These should be fixed together in one pass, because the fix for both is
the same decision — what does "interactive" look like in this design language.

---

## F-2 🟢 Every address on the site sent you away from the site

**Symptom.** Clicking any bidder or winner opened Basescan in a new tab. Nothing anywhere
linked to that address's own record on this site.

**Evidence.** Four components, one destination: `Receipt.tsx` (the winner),
`RoundsTable.tsx`, `Profile.tsx`, and `Timeline.tsx` (the bid ladder) all pointed at
`basescan.org/address/…`.

**Why it mattered.** The record page is the only surface where the subgraph's own fields
exist — `Account.provenance`, and the sealed-versus-opened reliability count. It is the
visible evidence for the Graph track. Nothing in the product pointed at it, from the exact
place a person is already looking at an address and wondering who they are.

**Fixed.** `web/components/Address.tsx` — the address text now opens that address's record
here; Basescan moves to a separate ↗ with its own hit area, because "is this real on chain"
is a different question and must stay one click away. All four call sites use it.

---

## F-1 🟢 The record page had no entry in the navigation

**Symptom.** The nav was `Board / Rounds / Evidence`. There was no way to reach the account
page except by knowing the URL, or by finding a link labelled "Accounts" inside the status
bar — the provenance line — next to the rehearsal toggle.

**Why it mattered.** The status bar's stated job is to say where the numbers came from; an
address lookup is navigation, not provenance, so it was both in the wrong place and
invisible. A judge would have had to guess a URL to see the subgraph-backed page.

**Fixed.** `Bidders` added to the header nav in `web/app/layout.tsx`.

**Known wrinkle, accepted deliberately:** the label says *Bidders*, but the page accepts any
address and the maker has a record too, so the label is narrower than the page. Chosen over
`Record` and `Accounts` on 2026-09-11 with that trade-off understood.

---

## F-0 🟢 `/profile/<address>` returned 404 on localhost while working in production

**Symptom.** The pretty profile URL worked on the deployed site and 404'd under `next dev`
— including from the app's own address form, which navigates to it
(`web/app/account/page.tsx:32`). A form that is broken only on localhost is how a real bug
gets dismissed as "just the dev server".

**Cause.** `/profile/:address` is not a route. There is no `app/profile/` directory; the
path exists only as a rewrite onto `/account/?a=<address>`. In production Vercel applies it
from `vercel.json`; `next dev` reads `next.config.mjs` and has never heard of `vercel.json`.
Underneath that, `output: "export"` cannot resolve a dynamic segment with no server, and
cannot apply rewrites either — the export build says so in three warnings.

**Fixed.** A dev-only `rewrites()` in `web/next.config.mjs`, documented as dev-only, with
the build warnings acknowledged there as expected rather than accidental.

**Standing trap this leaves:** `/profile/<addr>` must always be reached with a plain `<a>`,
never `next/link`. next/link routes on the client, does not find the path among the routes
the build produced, and renders 404 without making a request — while `curl` gets 200 from
the rewrite. That gap is why this shipped broken and tested clean.
`web/components/Address.tsx` and `web/components/StatusBar.tsx:85` both document it.

---

# Art direction — sketch and watercolour overlays

## Why the site reads as austere rather than modern

Be clear about the diagnosis before adding images, because imagery is not the whole fix.

The page currently has **one texture and one density**. Almost everything is monospace, at
roughly one size, inside a thin rectangular border, on a flat ground. That is a coherent
look and it earns the project's tone of engineering honesty — but uniformity is what makes
it read as a research artefact rather than a product. Nothing advances, nothing recedes,
nothing is quiet, nothing is loud.

So the imagery below works **with** F-3, F-4 and F-5, not instead of them. Art gives the
page depth and warmth; hierarchy is what makes it usable. Adding watercolour to a page where
a chip and a button still look identical produces a prettier version of the same problem.

## The palette is already botanical

From `web/app/globals.css`:

| Token | Light | Dark | Reads as |
|---|---|---|---|
| `ground` | `#f1f4f3` | `#0b1513` | whitewash / night glass |
| `glass` | `#1f6f66` | `#5cc0b1` | deep viridian / verdigris |
| `brick` | `#9c3b2c` | `#db7660` | terracotta |
| `amber` | `#8a5a14` | — | ochre, raking light |

Terracotta, ochre, viridian and whitewash, under a name that is literally a building made
of glass for growing things. The art direction is not a decision to invent; it is already
in the tokens. **A Victorian palm house** — panes, condensation, cast iron ribs, ferns,
clay pots, light coming through — is the honest visual for this project, and it carries the
mechanism's meaning too: a glasshouse is a place where everything inside is visible.

## Rules any generated image must obey here

1. **No text, letters, numerals or glyphs anywhere in the image.** Generators hallucinate
   lettering, and a page whose entire thesis is that every figure names its source cannot
   carry invented words it did not write.
2. **Nothing that could be mistaken for data.** No charts, graphs, axes, plots, dashboards,
   candlesticks, gauges, arrows implying a trend. `scripts/lint-provenance.mjs` exists to
   ensure every figure declares what produced it; an illustration that *looks* like a figure
   defeats that at a glance, which is worse than a wrong number because nobody thinks to
   check it.
3. **No crypto iconography.** No coins, no chains, no gavels, no glowing hexagons, no
   circuit boards. The project's whole pitch is that it is not that.
4. **Composition must leave the text area empty.** These sit behind or beside copy. Generate
   with the interest at one edge and open space across the middle.
5. **Low contrast, by design.** Anything behind text renders at 6-12% opacity. Ask for a
   pale wash, not a finished painting — a bold image at 8% just looks like dirt.
6. **Two versions of each, or one that inverts cleanly.** The site has real light and dark
   themes, and a wash tuned for `#f1f4f3` will disappear or muddy on `#0b1513`.

## The images to generate

Each is: where it goes, the aspect ratio, then the prompt.

### 1. Hero wash — landing page, behind the headline

Behind "Who fills your order should be decided by what it is worth". 16:9, wide.

> Loose watercolour and ink wash study of the interior of a Victorian glasshouse, seen from
> below looking up at the glazing bars converging toward a ridge. Thin nervous ink linework
> for the cast iron ribs, soft translucent washes of viridian and pale grey-green for the
> glass, a faint ochre warmth where light enters at the top right. Wet-in-wet pigment blooms
> and visible cold-pressed paper grain. Large areas of untouched paper across the lower left
> two thirds. Botanical illustration sensibility, restrained, unfinished at the edges. No
> text, no letters, no numbers, no people, no charts or diagrams. Muted palette limited to
> deep viridian #1f6f66, ochre #8a5a14, warm grey and off-white #f1f4f3. Flat off-white
> background, no vignette, no border.

### 2. Sealed — the commit phase

Beside the commit column of the "one round, end to end" diagram. 1:1 or 4:5.

> Three plain sealed envelopes lying overlapped on a pale surface, painted in loose
> watercolour with sparse ink outline. Each closed, each with a small dab of terracotta
> #9c3b2c wax at the flap. Soft shadows, wet edges, granulating pigment. Deliberately
> unfussy and quick, like a page from a working sketchbook. Off-white #f1f4f3 background
> with generous empty space at the right. No text, no writing, no monograms, no numbers on
> the envelopes. No hands, no desk clutter, no crypto or financial imagery.

### 3. Opened — the reveal phase

The reveal column, and the receipt panel. Same size and same hand as 2.

> The same three envelopes in loose watercolour and ink, now two of them opened with the
> flaps lifted and the paper inside showing as a blank pale rectangle, the third still
> sealed with terracotta wax. Viridian #1f6f66 wash pooling in the shadows beneath. Quick
> confident brushwork, visible paper texture, unfinished edges. Off-white #f1f4f3
> background, empty space at the right. The papers inside must be completely blank — no
> text, no letters, no numbers, no marks of any kind.

### 4. Terracotta pots — section divider

Between major sections, small and wide. 3:1 banner.

> A row of empty terracotta plant pots of slightly different heights on a shelf, painted in
> quick loose watercolour, terracotta #9c3b2c and ochre #8a5a14 against whitewash. Minimal
> ink linework, plenty of dry brush, pigment settling at the rims. Horizontal composition
> with wide empty space above. Botanical field-notes feeling. No text, no labels, no plants,
> no soil detail, no people.

### 5. Fern marginalia — small accents

Beside pull quotes and at the end of sections. 1:2 tall, transparent.

> A single fern frond, botanical watercolour study, unfurling from the lower edge. Viridian
> #1f6f66 with grey-green shadow, painted wet and loose with fine ink detail only at the
> tip. Isolated on a fully transparent background. Vertical composition, the frond occupying
> the lower third and thinning to nothing at the top. No pot, no soil, no text, no labels,
> no frame.

### 6. Condensation — full-bleed texture

Behind the whole page at very low opacity. 16:9, tileable.

> Abstract close-up of condensation and water droplets running down a pane of old glass,
> painted in pale watercolour washes with almost no linework. Cool grey-green and
> off-white, a few larger droplets catching faint ochre light. Very low contrast, delicate,
> mostly empty. Even distribution with no focal point, suitable for tiling. Cold-pressed
> paper texture visible throughout. No text, no reflections of objects, no people, no
> horizon.

### 7. Social card — the link preview

Replaces or sits behind `opengraph-image`. 1200x630 exactly.

> Wide watercolour and ink study of a Victorian glasshouse seen in three-quarter view from
> outside at dusk, its panes lit warm ochre from within against a deep viridian-black sky.
> Loose confident brushwork, ink linework for the glazing bars, pigment blooming in the sky.
> The building sits in the right third; the left two thirds are near-empty dark wash for
> overlaid type. Muted, atmospheric, painterly. No text, no letters, no signage, no people,
> no logo.

### 8. Dark-theme variants

Regenerate 1, 6 and 7 with the ground inverted rather than filtering the light versions — a
darkened watercolour goes muddy and loses the paper, which is the thing that makes it read
as paint at all.

> ...as above, but painted on a deep blue-green ground #0b1513 in the manner of gouache on
> toned paper: pigment lifting toward the light rather than washing down from white.
> Highlights in pale verdigris #5cc0b1 and warm ochre. Retain visible paper tooth. No text,
> no letters, no numbers.

## How to use them once generated

- **Export PNG with alpha** for 2, 3 and 5; a flat background is fine for 1, 4, 6 and 7.
- **Behind text: 6-12% opacity**, and check the contrast of the smallest type over the
  busiest part of the image, not the average.
- **Never place one behind a figure that carries a number.** Rule 2 above; the receipt, the
  reserve panel and the record are all off-limits.
- **Ship at most three.** The restraint is the aesthetic. One hero wash, one divider and one
  social card would change how the site feels; eight would make it a scrapbook.
- Put the files in `web/public/art/` and reference them from CSS backgrounds, so no
  component has to know they exist and any one of them can be removed in a line.
- Re-shoot `node scripts/shoot-screens.mjs` after adding each one. An overlay that looks
  right in isolation and ruins the smallest caption is the normal outcome, not the unlucky
  one.

---

# Choosing a design direction — the rubric, written before the options

Four research passes were commissioned on 2026-09-11: control hierarchy on dark grounds,
interactive-versus-label affordances, prose-and-data typography, and free sources of ideas
and assets. Each returns several candidate systems.

**This rubric is written before any of them reported back.** Scoring criteria invented after
seeing the options are not criteria, they are a justification for whichever option you
already liked. Weights sum to 100.

| # | Criterion | Weight | What full marks looks like |
|---|---|---|---|
| 1 | **Fixes the diagnosed faults** | 30 | Directly resolves F-4 (no CTA hierarchy), F-3 (chip indistinguishable from button) and F-5 (mono doing prose work). A system that is merely handsome scores zero here. |
| 2 | **Ships in under a day, no new dependencies** | 20 | Expressible in the Tailwind classes and CSS variables already present. No new package, no font swap that needs a licence check, no component library adopted wholesale. The build froze on 10 Sep; this is the constraint that kills most good ideas. |
| 3 | **Fits the existing tokens** | 15 | Uses `ground / raised / ink / ink-soft / rule / glass / brick / amber` as they are. A direction needing a new palette is a rewrite, and the palette is one of the better things about the current design. |
| 4 | **Preserves the provenance thesis** | 15 | Nothing decorative can be misread as data; every figure keeps its source tag and "what produced this" caption; `scripts/lint-provenance.mjs` still passes. An emphasis system that makes a *number* look more important than its provenance line actively damages the argument. |
| 5 | **Both themes genuinely work** | 10 | Not "the dark one works and the light one is untested". Contrast checked on both grounds, at the smallest type size actually used. |
| 6 | **Accessible** | 10 | Visible focus ring on every control, AA contrast for text and for the focus indicator, interactive semantics on interactive things and not on labels, hit targets that survive a phone. |

## How ties break

If two directions score within 5 points, prefer the one that **removes** rules rather than
adds them. The current design's problem is not too few ideas; it is that one idea (bordered
mono box) is used for everything. A system that says "mono means value, prose means
sentence, fill means primary" is better than one that adds six new component variants,
because the first can be applied by anyone editing any file and the second needs a document
nobody will read at 2am on submission day.

## What is out of scope regardless of score

- Any font change that is not free for commercial use, or that adds a render-blocking
  request on a page whose whole selling point is that it cannot fall over.
- Motion and animation beyond what already exists. It is the first thing to look cheap when
  done in a hurry and the first thing a judge on a slow laptop resents.
- A component library adopted wholesale. Borrowing token values and documented rules from
  Radix, Primer or Carbon is free and sensible; installing one two days out is not.
- Anything that touches the receipt, the reserve panel or the record while the mainnet index
  is still empty. Those screens have no real data to design against yet, so redesigning them
  now is designing against a placeholder.

## Order of work, once a direction is chosen

F-8 first regardless — the 390px clipping outranks every aesthetic question here, because a
phone visitor currently sees a broken page before they see any design at all.

Then, in this order, because each makes the next cheaper:

1. **The type rule** (F-5). Mono for values, prose face for sentences. It is one decision
   applied file by file, it needs no new tokens, and it makes F-3 mostly solve itself —
   once mono means "this is a value", a mono box stops being the default wrapper for
   everything and starts carrying meaning.
2. **The affordance rule** (F-3). Interactive versus label, as a documented pair.
3. **The emphasis rule** (F-4). Primary, secondary, tertiary, destructive.
4. **The nav active state** (F-6) and the empty-CTA panel (F-7), which are small once the
   above exist.
5. Art overlays last, and at most three, per the art direction above. They are the only item
   here that is purely additive, so they are the only one safe to cut entirely if time runs
   out.

---

# The decision, scored against the rubric above

Four research passes reported on 2026-09-11. What follows is the scoring, then what was
chosen. Scores are out of the weights fixed before the options were seen.

## Where the four independently agreed

Convergence between passes that did not see each other's work is the strongest signal here,
so it is recorded first.

1. **Fill is the mechanism, not hue.** Every hierarchy system studied reserves a 100%-opacity
   background for exactly one class of action and expresses everything else as border or bare
   text. None of them builds hierarchy by making buttons bigger, which reads as clumsy against
   a monospace grid.
2. **Uppercase, letter-spacing, weight and size are NOT interactivity signals.** Not in
   Primer, Carbon, Polaris, Atlassian or Radix. This is the precise trap this project fell
   into: mono caps read as "engineering aesthetic", never as "clickable".
3. **Monospace is for literal, copy-pasteable, machine-verifiable text only.** Butterick puts
   it flatly; IBM Plex and Geist both split their families on exactly that line. A number
   inside a sentence gets tabular figures in the prose face, not a mono block.
4. **Semantics does the accessibility work for free.** A `span` cannot be tabbed to or
   announced as a control; a `button` is focusable and announced. Getting the element right
   produces most of the visual rule as a consequence.

## Scoring

| Direction | Fixes faults /30 | Ships in a day /20 | Fits tokens /15 | Provenance /15 | Both themes /10 | Accessible /10 | **Total** |
|---|---|---|---|---|---|---|---|
| **Carbon read-only Tag + Primer button** | 30 | 20 | 15 | 15 | 10 | 10 | **100** |
| **Primer restraint + shadcn token mapping** | 28 | 19 | 15 | 14 | 9 | 9 | **94** |
| **Plex type split (mono = values only)** | 27 | 20 | 15 | 15 | 9 | 8 | **94** |
| shadcn variants adopted wholesale | 24 | 14 | 11 | 12 | 9 | 9 | 79 |
| Radix Themes alpha scale | 22 | 10 | 8 | 12 | 10 | 10 | 72 |
| FT / OWID serif-and-sans systems | 18 | 8 | 9 | 13 | 7 | 7 | 62 |

**Radix scored worst on fit despite being the most rigorous system**, and the reason is
specific rather than a matter of taste: its soft and ghost variants are accent-at-low-alpha
fills, and alpha tints need saturated colour to bloom against. A muted teal at 15% over
`#0b1513` is very close to invisible. Its scale-based *organisation* is worth borrowing; its
alpha fills are not.

**The editorial systems scored low on shipping cost, not on quality.** FT's Financier/Metric
and OWID's Playfair/Lato are both better-resolved than anything here, and both would mean a
font change two days out. Their *rules* transfer for nothing, which is what was taken.

## Chosen

**1. Affordance (F-3) — Carbon's read-only Tag for the chip, Primer's button for the button.**
The one system that addresses this exact case: Carbon's read-only Tag is purpose-built for
metadata labelling and is specified as non-focusable, not in the tab order, no hover state.
The chip loses its border and its accent text and becomes a soft tinted label; the button
keeps a border, gains a real hover inversion and a focus ring. Five redundant signals — fill,
border, verb-vs-noun, cursor, hover — replacing zero.

**2. Emphasis (F-4) — Primer's scarcity rule, mapped onto the existing tokens the way
shadcn maps its variants.** Primary is a filled accent and there is never more than one in a
view. Secondary is a bordered surface. Tertiary is bare text that gains a wash on hover.
Destructive borrows the brick token at the same three weights. The governance rule — one
primary per view — is doing as much work as the CSS, and it is the part most likely to be
ignored, so it is written here rather than only in a comment.

**3. Type (F-5) — the Plex split, which costs nothing because the fonts are already loaded.**
`IBM Plex Sans`, `IBM Plex Mono` and `Newsreader` are all already in `app/layout.tsx`, and
`html` already defaults to sans. Prose is monospace only because components opt in with
`font-mono`. So the fix is removing classes, not adding a font:

> **Mono if it is a value, an identifier, or a command — something you could copy and paste
> and have it still mean the same thing. Prose face if it is a sentence.**

A number inside a sentence stays in the prose face with `tabular-nums` and a weight step, not
a switch to mono.

## Deliberately rejected

- **Adopting shadcn or Radix wholesale.** Borrowing their documented values is free; installing
  a component library two days from submission is not, and it would mean restyling every
  component that already exists to match it.
- **Any font change.** Three faces are already loaded and they are the pairing the research
  recommended anyway.
- **Radix's soft/ghost alpha fills**, for the contrast reason above.
- **Making primary actions bigger.** Every system studied keeps size constant and varies fill.

## Order, and what is done

F-8 turned out to be a measuring error and is withdrawn, so the order in the rubric starts at
the type rule. Done so far: the address link consolidation (F-2), the nav entry (F-1), the dev
routing parity (F-0), and the capture rig now reports `scrollWidth` vs `innerWidth` beside
every shot so a layout claim can never again rest on an image alone.

Next, cheapest first: the chip/button pair, the nav active state (F-6), then the type rule
applied file by file, then the floating toggle overlap (F-9), then the empty-CTA panel (F-7).
Art overlays last and at most three.

---

# Two corrections at wrap-up, 2026-09-11

Both are cases of a finding recorded from a screenshot and then disproved by checking what
actually ships. Kept because the pattern matters more than either finding.

## F-9 ⚪ WITHDRAWN — the floating circle is the Next.js dev indicator

Recorded as "a floating theme toggle overlaps content on mobile", seen covering the `E` of
`EXCLUSIVE` on `/board` and a table row on `/rounds`. It was noted as confirmed on two pages
and therefore positional rather than incidental, which was true and still wrong.

**It is not our component.** There is no floating toggle in this codebase —
`components/Theme.tsx` is a route-driven register with no control at all. The circle is the
Next.js dev-tools indicator, which `next dev` injects and a production build does not.

**Checked rather than argued:** the built chunks in `web/out` contain no dev-tools reference,
and a capture of the deployed site at a 390px viewport has no circle anywhere.

This is the second finding in this file withdrawn for the same reason as F-8 — a screenshot
of a development server is not evidence about the product. The rule now stands for both the
tool and the environment: **shoot production before recording a visual defect, or say in the
finding that you did not.**

## F-5 🟡 REFRAMED — mono on the tool routes is a deliberate register, not an oversight

Recorded as "monospace is doing work it is bad at", with the readability research behind it:
Butterick is flat that monospace has no good reason to appear in body text, and IBM Plex and
Geist both split their families so mono carries only code and technical detail.

**But `/board` and `/evidence` are monospace on purpose.** `components/Theme.tsx` routes
them into `.tape`, and `globals.css` sets `.tape { font-family: var(--font-mono) }` along
with a tighter radius scale and flatter shadows. The intent is written down: "a landing page
persuades, a terminal reports", and "moving between them should feel like moving between two
different kinds of thing, because it is." The landing page already uses the prose face
correctly, which is the same decision seen from the other side.

So this is not a bug to fix; it is a trade-off between a documented design decision and a
readability finding, and reversing it silently at the end of a session would be the wrong
way to resolve it.

**The narrow recommendation, if it is taken at all:** keep the register, and exempt only
*prose paragraphs* from it — the two or three explanatory sentences under each page heading.
A terminal shows values in monospace; its documentation is not set in monospace either. That
is a handful of `font-sans` class additions, it leaves every value, address, block number
and command exactly as it is, and it does not touch the register that carries the meaning.

**Left open deliberately.** It needs a decision, not a patch.
