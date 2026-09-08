# ui-spec.md — Glasshouse UI, decided

> **Status:** DECIDED (architect, D-007 role), 2026-09-08. Closes `DESIGN.md` §5 and
> U-1, U-2, U-5, U-6. Binding on the Tue 09 / Wed 10 build. Freeze is Wed 10 Sep.
>
> Read `DESIGN.md` §1–§3 first; nothing here overrides the four jobs or the §2 rule.
> This file says *how*, in enough detail that nobody needs to ask.

---

## 0. The two defects this fixes, and the one-line answer to each

| Defect | Answer |
|---|---|
| The comparison table reads as a measurement of the world. It is `test/Comparison.t.sol`: `TokenMock` TKI/TKJ, valuations *assigned* to three addresses, the clock read once at `vm.warp(start + 60)`, decay `0.999e18`/s. | Every figure on the page carries a **source tag** as its first child and a **"what produced this"** line as its last (§3). The comparison gets `TEST`. No figure ships without one; a lint refuses the build. |
| The page consumes nothing, so job 3 (the UI is the Graph consumer) is unmet. | The page reads the Studio query URL directly over HTTP GraphQL, prints the `_meta` block on every number it derives, caches to `localStorage`, and falls back to a checked-in snapshot — each state labelled (§5). |

---

## 1. Decisions

| # | Decision | Rationale |
|---|---|---|
| **DL** | Design language: **the shipped page's language, ratified and extended** — Newsreader display, IBM Plex Sans body, IBM Plex Mono for anything that came from a chain; light and dark from system, no toggle; teal `glass` = ours / won / surplus-to-maker, `brick` = reverted / forfeited / missed deadline, **new** `amber` = pending / provisional / stale; density is two-tier (argument spine, instrument wide); motion is confined to phase progress and reveals. | Two days to freeze; the existing page is already "instrument, not dashboard". Inventing a second language now costs a day and produces two pages. |
| **U-1** | Comparison panel is the **recorded Foundry result, labelled `TEST`**, not live execution. | 0x2d and 0x94 orders exist only in the test harness; the live Base runs do open/commit/reveal/settle without a fill. Live three-way execution on mainnet is not a two-day job. The §2 violation is a labelling defect and is fixed by labelling. |
| **U-2** | Latency lens ships as a **static hand-drawn SVG** from the test's three assigned points, tagged `TEST`. No axis pretends to be measured latency. | The subgraph refuses latency data and has none. The argument is made from `DutchAuction.sol`, not from our auctions (subgraph-design §9). |
| **U-5** | **Client-side** fetch from the Studio query URL (no key, browser origins allowed). `localStorage` cache, then `site/data/snapshot.js`. | Baking JSON is the "static dataset" F-80 excludes. Design doc §8.2 already says this; ratified. |
| **U-6** | **Hosted on GitHub Pages from `site/`**, URL handed to testers. Fallback: the file in the repo. | Job 0 implies a URL. No build step, so Pages serves the directory as-is. |
| **W** | **Wallet bidding from the page is cut from the freeze** (§8). Specified in full in §7 so it can be built after Wed 12:00 if Tier 1 and 2 land, and after the event regardless. | A tester handed a URL will almost never find a 120 s commit window open; a browser-held reveal secret with a block deadline is the 2017 ENS failure mode; five hours buys the receipt, the reserve panel and the lens, which every tester sees. |
| **N** | No maker UI. The page prints the `cast send … open(...)` line with the recommended reserve; the maker copies it. | Maker is us. The advisor is the maker's tool. |

---

## 2. Design language — decided

### 2.1 Type

| Role | Face | Size / weight | Use |
|---|---|---|---|
| Display | Newsreader | h1 300 italic-accent, h2 400 | Argument headings only. Never inside an instrument panel. |
| Body | IBM Plex Sans | 16.5px / 1.65 in the spine; **14px / 1.5 in instrument panels** | Prose, labels, captions. |
| Chain | IBM Plex Mono | 0.83–0.95rem, `font-variant-numeric: tabular-nums` | **Every value that came from a chain, a test or a computation:** addresses, tx hashes, block numbers, bps, counts, opcodes, phase names, source tags. |
| Eyebrow | IBM Plex Mono 0.66–0.7rem, 0.12–0.14em tracking, uppercase | Column heads, phase names, source tags, section nav. |

**The number rule.** A number set in mono came from a machine and carries a source tag or an inline source. A number set in Plex Sans is prose and carries its source in the same sentence. There is no third kind. This is what makes provenance visible without reading.

Thousands are space-separated (`51 204 118`, `10 000`), as the page already does. Never commas.

### 2.2 Colour

Existing tokens stay. Two are added.

| Token | Light | Dark | Meaning — and nothing else |
|---|---|---|---|
| `--glass` / `--glass-soft` | `#1F6F66` / `#E0EDEA` | `#5CC0B1` / `#14302B` | Ours (0x2e), the winning row, surplus to the maker, live indexed data, links. |
| `--brick` / `--brick-soft` | `#9C3B2C` / `#F6E5E1` | `#DB7660` / `#2C1714` | Revert, forfeit, a deadline missed or about to be, an error state. |
| **`--amber`** / **`--amber-soft`** | `#8A5A14` / `#F5EBD6` | `#D9A441` / `#2E2410` | Pending, provisional ("running" clearing price), cached or snapshot data, indexer lag. |
| `--ink-faint` | as is | as is | Neutral facts: test data, config constants, simulation. |

Contrast checked: `#8A5A14` on `#F1F4F3` ≈ 5.3:1; `#D9A441` on `#0B1513` ≈ 7.8:1.

**Sealed** is a pattern, not a colour: `repeating-linear-gradient(135deg, var(--sunk) 0 4px, var(--raised) 4px 8px)` with a 1px `--rule` border. A sealed commitment is hatched; a revealed one is flat `--raised` with the bps in mono. Colour-blind safe by construction.

No gradients elsewhere, no shadows, no rounded corners above 2px, no icons except three inline SVG glyphs: external-link (↗ 10px), copy (two squares), and check.

### 2.3 Density

Two tiers, already present in the CSS as `.spine` (39rem) and `.wrap` (62rem):

- **Argument tier** — the masthead and sections 1, 3, 4 of the shipped page. Reading width, 16.5px, generous vertical rhythm. Unchanged.
- **Instrument tier** — everything that shows indexed or computed data: comparison, live auctions, auction view, receipt, next-auction. Full `--wide`, 14px, 1px `--rule` grids with `--raised` cells (the `.strip` / `.track` pattern), no cell padding above `0.9rem 0.85rem`. Tables are `overflow-x: auto` in a `.measure` wrapper; the body never scrolls sideways.

A one-line mono **section nav** sits under the masthead strip: `argument · comparison · live auctions · receipt · next auction · limits`. Anchor links, no sticky bar, no hamburger.

### 2.4 Motion

| Where | What | Duration | Reduced motion |
|---|---|---|---|
| Phase track, active cell | A 2px bar at the cell's bottom edge, width = blocks elapsed / blocks in phase, updated per poll | `width 400ms ease-out` | Instant |
| Reveal | Hatched card cross-fades to flat card with the bps | 300ms opacity | Instant |
| "as of block N" | The block number's 2px leading dot blinks **once** when a poll returns a new head | 150ms | Off |
| Pending CTA (if built) | Text ellipsis animates `…` and a 1px indeterminate bar under the button | 1.2s loop | Static "…" |

Nothing else moves. No pulsing dots, no skeleton shimmer, no scroll-triggered anything. `@media (prefers-reduced-motion: reduce) { * { transition: none !important; animation: none !important } }`.

---

## 3. The provenance system

This is the concrete treatment that satisfies `DESIGN.md` §2. It is a component, a vocabulary, a placement rule, and a lint.

### 3.1 The source tag

A mono uppercase chip, `0.66rem`, tracking `0.12em`, 1px border, `0.15rem 0.5rem` padding, no fill. It is **always the first child of a figure** (`<figure class="fig" data-src="…">`) and reads left to right as `SOURCE · <kind> · <detail>`.

| `data-src` | Chip text | Border / text colour | When |
|---|---|---|---|
| `test` | `SOURCE · FOUNDRY TEST · test/Comparison.t.sol` | `--ink-faint` | Any number produced by a unit test: the comparison table, the latency lens, the 244/243 bps figures. |
| `base` | `SOURCE · BASE MAINNET · INDEXED · AS OF BLOCK 51 204 118` | `--glass` | Data from the subgraph, fresh this session. The block is `_meta.block.number` from the query that produced the figure. |
| `chain` | `SOURCE · BASE MAINNET · RPC · BLOCK 51 204 121` | `--glass` | Chain head read from `eth_blockNumber` (countdowns only). |
| `cache` | `SOURCE · CACHED · AS OF BLOCK 51 198 002 · FETCHED 14:02 UTC` | `--amber` | Fetch failed; rendering the last successful response from `localStorage`. |
| `snapshot` | `SOURCE · SNAPSHOT IN REPO · AS OF BLOCK 51 190 776` | `--amber` | No network and no cache; rendering `site/data/snapshot.js`. |
| `rule` | `SOURCE · COMPUTED HERE · reserve-rule.js OVER 6 AUCTIONS · AS OF BLOCK …` | `--glass` | A figure the page derived client-side from indexed rows. Names the file and the window size. |
| `sim` | `SOURCE · SIMULATION · docs/design/window-sizing.md` | `--ink-faint` | Monte Carlo numbers: exclusive window, option value. |
| `config` | `SOURCE · CONFIG · config/auction.json "advocated"` | `--ink-faint` | Parameter values the page repeats. |
| `const` | `SOURCE · CARRIED BY THE PAGE · NOT INDEXED` | `--ink-faint` | Constants the subgraph cannot know, e.g. the order's token pair on the receipt (subgraph-design Q8). |

### 3.2 The "what produced this" line

The **last child of every figure** is `<figcaption class="made">` beginning with the words *What produced this:* and stating, in one or two sentences, every input a sceptic would ask about. For the comparison it is, verbatim:

> **What produced this:** `test_Comparison_AllThreeGatesOnTheSameOrder` in `test/Comparison.t.sol`, run with `npx hardhat test solidity`. Two mock tokens (`TokenMock` "Token I"/"Token J"), static balances 1000 / 2000, swap 1. Three test addresses with **assigned** valuations — Ada 400 bps, Bram 250, Cyd 100 — where Cyd is also assigned the first position in the block and the first rung on the ladder. The clock row is read once, 60 s after start, with decay 0.999 per second over a 600 s window (the slowest factor in upstream's own tests, i.e. the one kindest to the clock). Auction parameters in the test are 5 / 5 / 10 blocks, reserve 10, max 500, not the deployed 30 / 30 / 15. Nothing here was observed on a network.

The rule for writing one: name the file, the command, every mock, every assigned value, every warp, every constant that differs from production, and end with what the figure is *not*.

### 3.3 Inline provenance in prose

Numbers inside argument paragraphs carry their source in the same sentence, in words: "…the price actually moves 244 bps *(the same test)*", "…worth about 4.7 bps *(simulation, `window-sizing.md`)*". Mark the parenthetical `<span class="src-inline">` — mono, `--ink-faint`, 0.8em. Five places in the shipped page need this: the 244/243 bps sentence, the 4.7/15.6 bps sentence, the 79→124 / 75.7→67.2 sentence, the 44 bps sentence, and "150 seconds on Base".

### 3.4 Bidder provenance

Every address rendered from the subgraph carries an `Account.provenance` chip after it: `TEAM`, `INVITED`, or **`UNLISTED`**. The legend, printed once under the live-auctions list and once under the reserve panel:

> *Unlisted* means not on our list of team and invited wallets. It does not mean external, and we do not know who it is.

The word "external" never appears next to an address. Ratios show numerator and denominator: `4 of 9 reveals from TEAM wallets`, never `44%`.

### 3.5 Placement rules

1. A `<table>`, `<svg>`, or `.stat` (a single large number) must be inside a `<figure data-src>`. No exceptions, including the parameter table and the phase track in the argument sections (`config`), and the honest-limits box (numbers there are prose, §3.3).
2. One figure, one source. A figure that mixes indexed data with a page constant (the receipt's token pair) shows the `base` tag and a `const` mini-tag on the specific cell.
3. Data-state tags (`cache`, `snapshot`) also raise a page-top banner: `Showing cached data as of block N — the subgraph did not answer.` in `--amber-soft`. The banner is not dismissible; it disappears when a fetch succeeds.
4. The tag is not a tooltip and not hidden behind hover. It is text, in the document, in the screenshot.

### 3.6 The lint

`scripts/lint-provenance.mjs` (≈30 lines, no dependencies): parse `site/index.html` as text, assert every `<table`, `<svg` and `class="stat` occurrence is preceded by an unclosed `<figure` carrying `data-src=` and followed by a `class="made"` before `</figure>`. Runs in `npm run size`'s neighbour script; fails the commit. This is what makes §2 a property rather than a habit.

---

## 4. Conventions: adopted, and where Glasshouse has to invent

### 4.1 Adopt as-is (users already know these; do not redesign)

From the survey (§10 sources): Uniswap's locale strings, RainbowKit/ConnectKit locales, Aave's `messages.po`, Etherscan/Blockscout field order, ENS v3's register flow, CoW's competition rules and explorer.

| Convention | Exact form we use |
|---|---|
| Wallet button | `Connect wallet`, top-right of the **instrument tier only** (not in the masthead — the argument is a document, not a dapp). Connected: `0xc4ea…FFbf · Base` in mono. Wrong chain: button turns `--brick` outline, reads `Switch to Base`. |
| Wallet step copy | `Confirm in wallet…` (RainbowKit, ConnectKit, Uniswap, Aave all use this phrase). |
| Tx ladder | idle → `Confirm in wallet…` → `Pending · 0x3f9a…` → `Done ↗` (explorer link) / `Failed — Try again`. Explorers' pill colours: green done, red failed, amber pending. |
| Multi-tx flow | Vertical numbered stepper that stays visible with completed steps checked (Aave Approve→Supply, ENS Commit→Wait→Register). |
| Address | `0x` + 4 + `…` + 4, mono, `title` = full address, click copies, `Copied` for 1.5 s, Basescan ↗ after it. |
| Block deadline | Blocks are the fact, seconds the estimate, in that order: `23 blocks · ~46 s at 2 s/block` (Etherscan's *Remaining Blocks* + *Estimated Target Date*). |
| Relative time | `8 s ago` next to the indexed head; absolute UTC in `title`. |
| Explorer field order on the receipt | Hash, Status, Block, Timestamp, From, To, then the domain fields. |
| Competition | A ranked table (rank, bidder, bid, winner row highlighted, others faint) — CoW Explorer's batch view. We show *every* revealed bid, which CoW does too; we do not show a single "you got X surplus" callout because the taker is not the user here. |
| Auction lifecycle words | Gnosis's three prices, adopted as **running** (during reveal) → **clearing** (reveal closed) → **settled** (after `settle()`). |
| Provenance placement | `Last updated` / `as of block` in the figure (LlamaRisk, Dune) — but we put it *on every figure*, not once in the footer (§3). |
| Danger acknowledgement | Aave's explicit checkbox before a dangerous action. Used once: before `Place sealed bid` when the bond is non-zero. |

### 4.2 Where there is no convention and Glasshouse decides

The survey found no modern product with a sealed-bid-plus-reveal-deadline state model for end users; the only precedent (ENS 2017) is the cautionary tale — users downloaded a JSON, forgot the 48 h window, and forfeited. Nobody shows a block-granular phase bar; nobody distinguishes *committed, unrevealed* from *pending*; nobody shows the losing bidders their rank. These are ours to define:

| Gap | Glasshouse's answer |
|---|---|
| Phase as a first-class state | The four-cell **phase track** already on the page becomes live: the active cell carries the block countdown and the progress bar; past cells show their actual block range; future cells show their planned range. Phase names are the contract's: `commit`, `reveal`, `exclusive`, `open`; `settled` is a flag drawn as a check on the `open` cell, never a fifth cell (phase.js). |
| A commitment that is not yet a bid | The **sealed card**: hatched, mono `#3 · 0x91ab…04ce · TEAM · sealed at block 51 204 090`. It is not "pending" — the transaction succeeded; the *bid* is unknown. On reveal the hatch cross-fades to the bps. After `revealEnd`, an unrevealed card gets a `--brick` left border and the word `unrevealed · bond forfeitable`. |
| Running vs final clearing price | The stat `clearing 250 bps` carries a mono suffix: `running` in `--amber` while `phase == reveal`, `final` in `--ink` afterwards, `settled ✓` after settle with `settlementMatchesDerivation` shown as `subgraph replay = contract` or, if false, `⚠ replay ≠ contract` in `--brick`, never hidden. |
| The reveal deadline for a bidder (if built) | The deadline is on the button itself: `Reveal 250 bps · 23 blocks left`. The secret is stored in this browser *before* the commit transaction is sent, and offered as `Copy bid secret`. At ≤10 blocks the button border turns `--brick`. Missing it is spelled out in the disabled state: `Reveal closed at block N · your bond is claimable by the maker`. |
| Losing bidders | The ranked reveal table shows every bid with its rank and the winner's *paid* price marked on the runner-up's row: `250 bps ← sets the price`. A losing bidder sees exactly why they lost. |
| Dutch price decay | Not shown live (we have no live 0x94 auction). Shown once, static, in the latency lens as a horizontal line: "at t+60 s every bidder sees 10 618". |

---

## 5. Data plane

### 5.1 Sources and precedence

1. **Subgraph** — Studio query URL, constant `SUBGRAPH_URL` at the top of `site/app.js`. Queries Q1, Q2, Q3 exactly as `docs/design/subgraph-design.md` §8.2 / §7.2. Every query includes `_meta { block { number timestamp } }`.
2. **Chain head** — `eth_blockNumber` against `https://mainnet.base.org` (CORS-open, uncapped by Studio). Used only for countdowns and CTA gating.
3. **Cache** — each successful subgraph response written to `localStorage["glasshouse:q:<name>"]` with `{ at: Date.now(), head, data }`. Read on fetch failure. Wrapped in try/catch; a throwing accessor means "no cache".
4. **Snapshot** — `site/data/snapshot.js`, a classic script assigning `window.GLASSHOUSE_SNAPSHOT = { producedAt, head, q1, q2: { [auctionId]: … } }`, produced by `scripts/reserve-advisor.mjs --snapshot`. **A `.js` file, not `.json`**, because `fetch()` of a sibling file fails on `file://`.

Precedence: live → cache → snapshot, each with its tag (§3.1). Never silently.

### 5.2 The head-block rule

Two heads can exist: the indexed head `H_i` (`_meta`) and the chain head `H_c` (RPC).

- **Phase is computed against `H_i`** with `phase(a, H_i)` from `site/phase.js`, and the figure says `AS OF BLOCK H_i`. This is the design doc's rule and the reason the function exists.
- **Countdowns use `max(H_i, H_c)`**, labelled `chain head` when `H_c` wins. Time only moves forward; a countdown must be pessimistic.
- If `H_c − H_i > 3`, the auction view shows `indexer 5 blocks behind chain` in `--amber` next to the head.
- Wall-clock estimates are `2 s × blocks`, and the text says `at 2 s/block` every time. Never stored, never shown without the blocks.

### 5.3 Polling and the Studio cap

The dev URL is capped at 3 000 queries/day (F-83). Budget:

| Condition | Subgraph poll | RPC head poll |
|---|---|---|
| Any listed auction in `commit` / `reveal` / `exclusive` and tab visible | Q1 + Q2 every **12 s** | every **4 s** |
| No live phase, tab visible | Q1 every **120 s** | none |
| `document.hidden` | none | none |
| Manual | none — there is no refresh button; the head's "N s ago" is the affordance | |

A 150 s auction costs ≈ 26 queries. An idle open tab costs 720/day. Three idle testers stay under the cap; the page also stops polling after 4 h of no interaction and shows `paused · click to resume` on the head.

### 5.4 Script loading

`phase.js` and `reserve-rule.js` are ESM and stay untouched (the advisor and tests import them). `site/app.js` is `<script type="module">` and imports both. Module scripts do not run from `file://` in Chrome, so: the argument tier, the comparison, the phase track and the parameter table are **plain HTML and need no script**; the instrument sections contain a static `<div class="needs-http">` reading *Open this page over http to see indexed data — hosted at ‹URL›* which `app.js` removes on start. The video is recorded against the hosted URL. "Network unavailable" is the cache/snapshot path, not the `file://` path.

---

## 6. Screen inventory

One page, seven anchored sections. "Screen" means an anchored section. Order on the page is the order below.

### S0 · Masthead and argument (exists)

**Job:** 0. **Shows:** the thesis, the three opcodes, the source excerpt. **Changes:** add the section nav (§2.3); add `src-inline` to the five prose numbers (§3.3); wrap the phase track and parameter table in `config` / `sim` figures. **Must never show:** a wallet button, a live number, anything from the subgraph. The argument is stable and does not depend on the network.

### S1 · Comparison (exists; provenance fix)

**Job:** 1, 2. **Shows:** the three-row table as today, inside `<figure data-src="test">`, with the §3.2 caption verbatim. The `Reproduce with …` sentence moves into the caption. **Adds** a fourth column, `Who won`, with the assigned valuation in mono: `Cyd · valued 100 · fastest`, `Cyd · valued 100 · fastest`, `Ada · valued 400 · slowest` — the table then says in words what the lens says in a picture. **Must never show:** a Base block number, a token symbol other than the mocks, a percentage without the base it is of.

### S2 · Live auctions (new)

**Job:** 3, 1. **Data:** Q1. **Shows:** a `base` figure with a table, newest first, max 50:

```
SOURCE · BASE MAINNET · INDEXED · AS OF BLOCK 51 204 118 · 8 s ago      ● 

#   opened        phase      reveals   clearing        winner                       settled
7   51 204 090    reveal     1 / 2     50 bps running  0x91ab…04ce  TEAM  leading   —
6   51 199 812    open ✓     2 / 2     250 bps final   0x3c0d…88e1  TEAM             ✓ 51 199 902
5   51 197 004    open       0 / 0     —               no reveals                   ✓ 51 197 101
…
What produced this: the GlasshouseBook subgraph (deployment Qmc9Ah…pK7E) over
Book 0xc4ea…FFbf on Base, read by this page at the block shown. Phase is computed
here, by site/phase.js, against that block. "Unlisted" means not on our list of
team and invited wallets; it does not mean external.
```

Phase chip styles: `commit` on `--sunk`; `reveal` on `--amber-soft`; `exclusive` on `--glass-soft`; `open` on `--raised` with a `--rule` border; the `✓` is `settled`. `reveals` is `revealedCount / committedCount`. Clicking a row loads S3 for that auction (`#auction=<id>` in the hash; the newest live auction is selected by default). **Must never show:** win share, any ratio without its numerator and denominator, USD, "market", "solver".

### S3 · Auction view (new)

**Job:** 2, 3, 1. **Data:** Q2 for the selected auction, polled per §5.3. **Layout:** one `base` figure, three stacked bands.

**Band 1 — phase track (live).** The existing four-cell `.track`, now populated:

```
commit                    reveal                   exclusive          open
blocks 51 204 061–090     51 204 091–120           51 204 121–135     from 51 204 136
done                      ▮▮▮▮▮▮▮▮▮▯▯▯ 22 of 30    winner fills       anyone, base price
                          8 blocks · ~16 s at 2 s/block
```

The active cell has the progress bar (§2.4) and the countdown; `exclusive` is drawn dashed and labelled `collapses if nobody reveals` while `bestBidder` is null, because the contract skips it (phase.js comment). After settle, the `open` cell carries `settled ✓ block N ↗`.

**Band 2 — bids.** A row of cards in `commitIdx` order, hatched until revealed:

```
#0 ▨▨▨▨▨▨▨▨  0x91ab…04ce TEAM      #1 ▨▨▨▨▨▨▨▨  0x3c0d…88e1 TEAM
   sealed · block 51 204 071            sealed · block 51 204 074
```
becomes, on reveal:
```
#0  400 bps  0x91ab…04ce TEAM  leading     #1  250 bps  0x3c0d…88e1 TEAM  ← sets the price
```
Under the cards, the stat line: `clearing 250 bps · running` (→ `final` → `settled ✓`), `winner margin 150 bps`, `competition CONTESTED · not thin`, `reserve 50 · max 500 · bond 0`. When `reserveBound`: `clearing 50 bps · the reserve set the price (sole reveal)`.

**Band 3 — timeline.** `events(orderBy: blockNumber, logIndex)` as a mono list: `51 204 061 · opened · maker 0x… TEAM ↗`, `… · committed #0 · 0x… ↗`, `… · revealed #1 · 250 bps · took lead: no ↗`, `… · settled · winner 0x… · 250 bps · replay = contract ↗`. Each line links to the tx on Basescan.

**Must never show:** an estimated wall-clock without its block count; a stored phase; the word "pending" for a sealed card; anything from RPC other than the head.

### S4 · Receipt (new)

**Job:** 1 ("the thing a judge screenshots"). **Data:** the selected auction from Q2, shown only when `settled` or `filled`. A bordered `--raised` card, three columns, explorer field order first:

```
RECEIPT · auction 6 · SOURCE · BASE MAINNET · INDEXED · AS OF BLOCK 51 204 118

settled     block 51 199 902 · 0x7be1…c33a ↗        winner        0x3c0d…88e1 TEAM
opened      block 51 199 812 by 0x5f…e2 TEAM        winner bid    400 bps
parameters  ADVOCATED · 30 / 30 / 15 · reserve 50   clearing      250 bps  (runner-up's bid)
reveals     2 of 2 committed · 0 unrevealed          improvement   250 bps on balanceIn → maker
fill        no fill reported to the Book             replay check  subgraph = contract ✓
bonds       0 (none escrowed)                        pair          WETH / — · carried by the page, not indexed
```

Rules: `fill` is one of `no fill reported to the Book` (the hook may not have been wired — say so in `title`), or `block N · phase EXCLUSIVE · by winner ✓ · amountIn/amountOut raw`. Amounts are raw integers with the token pair cell tagged `const` (Q8). `improvement` is in bps only — never a token amount, never USD (subgraph-design §9). **Must never show:** surplus in tokens, a benchmark price, "saved $".

### S5 · Next auction — reserve control (new)

**Job:** 3 (second Graph sub-track), 1. **Data:** Q3 for the deployed maker (`ignition/parameters/chain-8453.json` owner), `recommendReserve()` from `site/reserve-rule.js` with `K = 8, floor 50, max 500`. A `rule` figure:

```
SOURCE · COMPUTED HERE · site/reserve-rule.js OVER 6 SETTLED AUCTIONS · AS OF BLOCK 51 204 118

recommended reserve   50 bps          reason   COMPETITION_PRICES
band                  50 – 249 bps    window   last 6 of K = 8 · 4 contested · 1 thin · 1 empty
                                       reveals  9 · 7 TEAM · 0 INVITED · 2 UNLISTED · 3 never revealed

The low end is the staleness floor, below which running the auction is worse than
posting a limit order. The high end is one below the lowest winning bid in the window,
above which the reserve would have excluded a winner we actually had. This is a
heuristic that splits a known-safe value from a known-unsafe one. It is not an optimal-
reserve computation; that needs the bidders' value distribution, which a handful of
auctions does not estimate.

cast send $BOOK "open(bytes32,address,address,uint40,uint40,uint40,uint24,uint24,uint128)" \
  $ORDER_HASH $ROUTER $TOKEN_IN 30 30 15 50 500 $BOND --rpc-url $BASE_RPC_URL --private-key $MAKER_KEY
[ Copy ]
```

The two sentences in italics above are mandatory text (subgraph-design §7.2). The reason codes are printed as the constants, with a one-line gloss each: `NO_HISTORY` "no settled auctions yet", `COMPETITION_PRICES` "competition set the price; the reserve was inert", `NO_REVEALS` "most auctions had no reveal; the Book cannot tell no interest from an excluding reserve", `WINNER_BELOW_FLOOR` "every winner bid under the floor", `THIN_COMPETITION` "the reserve is doing the work". **Must never show:** "concentration", "HHI", "market", "solver", "AI", "optimal".

### S6 · Latency lens (new, static SVG) — the §4.2 sketch

**Job:** 2 (the sharpest claim, on camera). **Data:** the test's three assigned points. `test` figure. Inline SVG, `viewBox 0 0 640 300`, both themes via `currentColor` and the tokens.

```
SOURCE · FOUNDRY TEST · test/Comparison.t.sol · valuations and arrival order ASSIGNED

  BY CLOCK · 0x94                               BY BID · 0x2e
  arrival                                       arrival
  in block                                      in block   (greyed: does not enter)
  3rd │                     ● Ada 400           3rd │                     ◎ Ada 400  wins
      │                                             │                     │ pays 250 ┐
  2nd │           ● Bram 250                    2nd │           ● Bram 250 ◄──────────┘
      │                                             │
  1st │  ◎ Cyd 100  wins                        1st │  ● Cyd 100
      └──────┼──────────┼──────────┼──                └──────┼──────────┼──────────┼──
           100        250        400  valuation, bps       100        250        400
  ─ ─ ─ price at t+60 s: 10 618 for all three ─ ─ ─        maker receives 9 756 (250 bps off base)
  the winner is the lowest point, whatever x            the winner is the rightmost point, whatever y
```

Drawing rules: the same three points at the same coordinates in both panels; the winner is a `--glass` ring (◎), the others `--ink-faint` dots; in the clock panel a dashed horizontal `--brick` rule at the price with the label "identical for all three — valuation cannot break the tie"; in the bid panel the y-axis and its labels are drawn at 35% opacity with the caption "does not enter", and a bracket from Ada down to Bram's x carries "pays 250 (Bram's bid)". No animation. Under it, the §3.2 caption and one sentence: *Arrival order is assigned in the test, not measured; on chain it is sold to whoever pays the builder most, which is the point.*

**Must never show:** a measured latency, a priority fee, more than three points, any point from a live auction.

### S7 · Limits and footer (exists)

Unchanged except: the footer gains the two lines *Subgraph: GlasshouseBook on Base, deployment Qmc9Ah…pK7E, Messari common conventions for counts only; no financial schema claimed* and *Page data: Studio query URL over HTTP GraphQL; the reserve advisor reads the same subgraph through the Subgraph MCP.*

---

## 7. CTAs

Every interactive control on the page, its exact label, what it does, and its states. **Tier** refers to §8. The wallet-bound CTAs (7.4–7.8) are specified so they can be built exactly, and are cut from the freeze (decision W).

### 7.1 Section nav — Tier 1
Six anchor links (§2.3). States: none beyond `:focus-visible` outline. Leads to the section.

### 7.2 Copy address / copy tx / copy cast line — Tier 1
Label: the copy glyph, `aria-label="Copy"`. On click: `navigator.clipboard.writeText`, glyph swaps to the check and a mono `Copied` appears for 1.5 s. Error (clipboard blocked): `Select and copy` and the text becomes a selected `<input readonly>`. Leads nowhere.

### 7.3 Basescan link — Tier 1
Label: `↗` after the value, `aria-label="View on Basescan"`, `target="_blank" rel="noopener"`. Idle only. Leads to `https://basescan.org/{address|tx}/…`.

### 7.4 `Connect wallet` — Tier 3 (cut)
Top-right of S2. Uses `window.ethereum` (EIP-1193) directly; no library.

| State | Label | Behaviour |
|---|---|---|
| no provider | `No wallet found` (disabled) | `title`: "Bidding needs a browser wallet on Base. Everything else on this page works without one." |
| idle | `Connect wallet` | `eth_requestAccounts` |
| pending | `Confirm in wallet…` (disabled, ellipsis) | |
| connected, Base | `0x91ab…04ce · Base` | Click → menu: `Copy address`, `Disconnect` (forgets the account locally; EIP-1193 has no disconnect) |
| connected, other chain | `Switch to Base` (`--brick` outline) | `wallet_switchEthereumChain` `0x2105`; on 4902 `wallet_addEthereumChain` with the public RPC |
| rejected (4001) | back to idle, inline mono `Connection cancelled` for 3 s | |

### 7.5 `Approve bond` — Tier 3 (cut); hidden when `bond == 0`
Step 1 of a two-step stepper (Aave pattern) shown only when `Auction.bond > 0`. Label: `Approve N SYMBOL for the Book`. Sends `approve(BOOK, bond)` on `bondToken`. States as 7.7's ladder. Success checks step 1 and enables 7.6. The human-demo parameter set has `bond = 0`, so this never renders in the freeze demo.

### 7.6 `Place sealed bid` — Tier 3 (cut)
The commit. Input: a mono number field `bid, bps` with the range printed under it: `between 50 (reserve) and 500 (max)`. Below: `bond 0 — nothing is escrowed` or `bond N SYMBOL — escrowed now, returned after settle if you reveal`. When bond > 0, an Aave-style checkbox: `I understand: if I do not reveal before block ‹revealEnd› the bond is forfeitable.` Sequence on click:

1. `salt = crypto.getRandomValues(32 bytes)`.
2. `eth_call` `commitmentFor(bidder, bps, salt)` on the Book — **no keccak in the browser**; the contract is the hash function (F-144).
3. **Write** `localStorage["glasshouse:bid:<auctionId>:<bidder>"] = { bps, salt, commitEnd, revealEnd, at }` **before** sending. Show `Copy bid secret` (the JSON) beside the button. This is the ENS-2017 lesson applied.
4. `eth_sendTransaction` `commit(maker, orderHash, commitment)`; calldata hand-encoded with the selector pinned as a constant and asserted against the ABI in a test.
5. Poll `eth_getTransactionReceipt`.

| State | Label / text | Condition |
|---|---|---|
| disabled | `Connect wallet to bid` | no account |
| disabled | `Switch to Base` | wrong chain |
| disabled | `Commit closed at block N` | `max(H_i,H_c) > commitEnd` |
| disabled | `Closing — 2 blocks left is too few to sign` | `commitEnd − H_c ≤ 2` |
| disabled | `Already sealed from this wallet` | a `Bid` row for this address exists |
| disabled | `Enter a bid between 50 and 500` | input out of range |
| idle | `Place sealed bid · 14 blocks left` | |
| pending wallet | `Confirm in wallet…` | |
| pending chain | `Sealing · 0x3f9a… ↗` | receipt not yet mined |
| success | `Sealed · #2 · reveal opens at block 51 204 091` — the sealed card appears in S3 band 2 tagged `you` | receipt status 1 |
| error 4001 | idle again; `Cancelled in wallet` inline | |
| error revert `CommitClosed` | `Commit closed at block N while you were signing` (`--brick`) | decode by 4-byte selector |
| error revert `AlreadyCommitted` | `Already sealed from this wallet` | |
| error other | `Failed — Try again` with the raw message in a `<details>` | |

Leads to: the same card, now sealed, and the stepper's step 2 armed.

### 7.7 `Reveal` — Tier 3 (cut). The one with the block deadline.
Enabled only if a stored secret exists for `(auction, account)`. Otherwise the slot shows `No sealed bid found in this browser for this wallet` and an `Enter secret` disclosure with two mono fields, `bps` and `salt`, for a secret copied elsewhere.

| State | Label / text | Condition |
|---|---|---|
| disabled | `Reveal opens at block 51 204 091 · 6 blocks · ~12 s at 2 s/block` | `phase == commit` |
| idle | `Reveal 250 bps · 23 blocks left` | `phase == reveal`, `revealEnd − max(H_i,H_c) > 10` |
| idle, urgent | same text, `--brick` border, `Reveal closes at block N — sign now` under it | `≤ 10` blocks left |
| pending wallet | `Confirm in wallet… · 9 blocks left` (the countdown keeps running on the disabled button) | |
| pending chain | `Revealing · 0x… ↗` | |
| success, leading | `Revealed · you lead at 250 bps` | `tookLead` on our event |
| success, not leading | `Revealed · runner-up at 250 bps · your bid sets the price` or `Revealed · 3rd of 3` | |
| disabled | `Reveal closed at block N · your bond is claimable by the maker` (`--brick`) | `phase ∉ {commit, reveal}` and not revealed; text says `no bond was escrowed` when bond is 0 |
| disabled | `Revealed ✓ at block N ↗` | already revealed |
| error `BadReveal` | `The secret does not match the sealed bid. Check bps and salt.` | |
| error `BidOutOfRange` | `Reveal rejected: bid must be between 50 and 500` (cannot happen with a stored secret; only with a typed one) | |
| error `RevealClosed` | as the closed state | |

Leads to: the card unsealing in band 2; the stat line updating to `running`.

### 7.8 `Settle auction` — Tier 3 (cut)
Permissionless, low risk, low value. Label `Settle auction`; enabled iff `canSettle(a, max(H_i,H_c))` from `phase.js` — **never derived from the phase** (the two differ by 15 blocks for a winnerless auction, phase.js comment). Disabled labels: `Settles after block N · k blocks` / `Settled ✓`. Ladder as 7.6. Success: the `open` cell gets `settled ✓`, the receipt (S4) appears.

### 7.9 `Claim bond` — Tier 3 (cut); hidden when `bond == 0`
Label `Claim bond · N SYMBOL`. Enabled iff `settled && bid.revealed && bondStatus == HELD` for this account. Ladder as 7.6.

### 7.10 `Replay reveals` — Tier 3
On a settled auction in S3: re-seals every card and unseals them in `revealOrder` at 600 ms intervals, updating the stat line from each `BidRevealedEvent.*After` field (the subgraph carries them so the page does not re-implement the rule). Label `Replay reveals` → `Replaying…` → back. No scrubber. Reduced motion: renders the final state and the button is hidden.

### 7.11 `paused · click to resume` — Tier 1
On the head after 4 h without interaction (§5.3). Click restarts polling.

There is **no** Refresh, no theme toggle, no filter, no search, no pagination beyond the 50-row cap, no maker `Open auction` button, no `Claim forfeit` / `Claim unrevealed` (maker-only, done with `cast`).

---

## 8. What is cut — the line, drawn

Budget: Tue 09 full day + Wed 10 morning ≈ **12 implementation hours** for the UI. (Wed afternoon is the Uniswap benchmark and `FEEDBACK.md`, owned by `run.md` §9, and the freeze review.) Ranked by value per hour; hours are for one implementer who has read this file.

| Rank | Item | Hours | Value | Tier |
|---|---|---|---|---|
| 1 | Provenance system: `.src` chip, `.made` captions, `src-inline` ×5, `config`/`sim` wrappers on the two argument figures, the comparison caption verbatim, the `Who won` column, the lint script | 1.5 | Fixes the §2 violation the adversary found; the cheapest thing on the list and the only one that is a *defect* | **1** |
| 2 | Data plane: `app.js` module, `SUBGRAPH_URL`, Q1/Q2/Q3, `_meta`, RPC head, cache, snapshot loader, banner, polling schedule, `needs-http` fallback | 2.5 | Job 3 goes from unmet to met; everything below depends on it | **1** |
| 3 | S2 live auctions list with phase chips from `phase.js` | 1.5 | First live number on the page; the demo's opening shot | **1** |
| 4 | S3 auction view: live phase track, sealed/revealed cards, stat line, timeline | 3 | The phase transitions are "the interesting part" (`DESIGN.md` §4.1); the demo's second and third minute | **1** |
| 5 | Section nav + footer lines | 0.25 | Wayfinding for testers | **1** |
| | **Tier 1 subtotal** | **8.75** | | |
| 6 | S4 receipt | 1.5 | The screenshot | **2** |
| 7 | S5 reserve control panel (wires the already-tested `reserve-rule.js`) | 1.5 | The second Graph sub-track's on-page evidence, and the closed loop's other half | **2** |
| 8 | S6 latency lens, static SVG | 2 | Highest-value unbuilt idea (`DESIGN.md` §4.2); the video's thesis frame | **2** |
| | **Tier 2 subtotal** | **5 → cumulative 13.75** | | |
| ——— | **THE LINE. Tier 2 finishes Wed by 12:00 or the last of it is cut, lens first.** | | | |
| 9 | Wallet + `Place sealed bid` + `Reveal` + `Settle` (7.4–7.8) | 5–6 | Real, but a URL-handed tester meets a 120 s window by appointment only; the risk profile (browser-held secret, block deadline) is the worst thing to hand a stranger during a test week | **3** |
| 10 | `Replay reveals` | 1 | Nice on camera; the live sequence is better on camera | 3 |
| 11 | "Two routes, one answer" panel: advisor output via the Subgraph MCP next to the page's own S5 numbers on the same head block | 1 | Blocked on publishing to the network (Arbitrum ETH, U-b) and a Gateway key; the video and README carry composition (subgraph-design §8.5) | 3 |
| — | Maker `Open auction` UI; theme toggle; timeline scrubber; interactive lens; MCP proxy so the page calls the MCP (Q4); pagination; search | — | No job served, or explicitly deferred by the design doc | cut |

**If Tier 1 slips past Tue night, cut in this order: 8, 7, 6.** Tier 1 is not cut; if it cannot land, the page ships with items 1 and 5 only and the honest limit "live data: not wired" — which is `run.md` §9's cut-order step 3 and is still a labelled page.

**Un-cut trigger for item 9:** Tier 1 and 2 done and reviewed by Wed 12:00. Otherwise the Thu–Sat tester sessions run auctions with `scripts/run-auction.ts` while testers watch S2–S4 live, which exercises every built screen and none of the risk.

---

## 9. Acceptance — what the freeze reviewer checks

1. `node scripts/lint-provenance.mjs` passes; every `<table>`, `<svg>`, `.stat` sits in a `figure[data-src]` with a `.made` caption.
2. The comparison caption matches §3.2 verbatim, including "Nothing here was observed on a network."
3. Open the hosted URL with the network blocked in devtools: the banner reads `Showing cached data as of block N` and every instrument figure carries the `cache` tag; then clear site data and reload: `snapshot` tag and banner.
4. Open `site/index.html` from `file://`: the argument, comparison, phase track and parameter table render; instrument sections show the `needs-http` notice; no console errors.
5. During a live auction run with `run-auction.ts`, S3 shows: sealed cards appearing within one poll of the commit tx; the phase cell flipping at `commitEnd + 1` against the indexed head; cards unsealing on reveal; `running` → `final` at `revealEnd + 1`; `settled ✓` and the receipt after `settle()`.
6. Every address on the page carries a `TEAM` / `INVITED` / `UNLISTED` chip **when the data source can actually say**, and the legend appears under S2 and S5. The word "external" is never a claim ABOUT an address; it may appear only inside the legend that denies it.

   > ⚠️ **Corrected 2026-09-09.** This item used to read *"The string \"external\" does not occur in `site/`"*, which contradicts §3.4 of this same document four hundred lines above: the legend §3.4 mandates verbatim is *"It does not mean external, and we do not know who it is."* An honest denial has to name the thing it denies, so a blanket grep forbids the correct text. What actually matters is that we never assert an address IS external, which is what this now says.

   > A second correction in the same area: a chip is rendered only when the source carried a provenance value. `chain.js` and the snapshot return bare addresses — provenance is a subgraph-computed field the contract does not store — so defaulting to `UNLISTED` would claim *"we checked our list and this is not on it"* when the truth is *"this source cannot say"*. Those are different statements and only one of them is true.
7. `grep -ci "HHI\|market share\|solver\|concentration\|USD\|\$" site/index.html site/app.js` returns 0 (the `$` in the `cast` line is the one permitted match; assert it is the only one).
8. Both themes: every tag, chip and the hatch pattern are legible; the lens SVG uses tokens only.
9. Tab hidden → no requests in the network panel. Idle tab → Q1 every 120 s, nothing else.
10. `prefers-reduced-motion: reduce` → no transitions; `Replay reveals` (if built) is hidden.

---

## 10. Sources consulted

Product conventions (fetched 2026-09-08 by the survey agent; label strings quoted from these):

- Uniswap interface locale — `github.com/Uniswap/interface/…/i18n/locales/source/en-US.json`; UniswapX overview — `developers.uniswap.org/…/uniswapx/overview`
- CoW Swap locale — `github.com/cowprotocol/cowswap/…/en-US.po`; orderbook OpenAPI — `github.com/cowprotocol/services/…/openapi.yml`; competition rules — `docs.cow.fi/cow-protocol/reference/core/auctions/competition-rules`; explorer issue #95
- 1inch Fusion — `help.1inch.com/en/articles/6796085`, `…/6800254`
- Aave interface — `github.com/aave/interface/…/messages.po`, `…/HealthFactorNumber.tsx`; `aave.com/help/borrowing/liquidations`
- Morpho — `morpho.org/blog/our-vision-for-morphos-interface`
- Etherscan tx and block-countdown pages; Blockscout transaction-fields docs and swap walkthrough
- Flashbots Protect status API — `docs.flashbots.net/flashbots-protect/additional-documentation/status-api`
- LlamaRisk SVR dashboard — `dashboard.llamarisk.com/protocols/aave/svr`
- Gnosis Auction mechanism guide (blockcast.cc); Zora Auction House docs — `ourzora.gitbook.io/zoraos/dev/zdk/auction-house`
- ENS v3 register flow — `docs.ens.domains/registry/eth/`, `support.ens.domains/en/articles/7882582`, `github.com/ensdomains/ens-app-v3/…/locales/en/register.json`; ENS 2017 registrar — `veox-ens.readthedocs.io/en/latest/userguide.html`, ENSIP-2
- Penumbra Dutch auctions blog; Shutter shielded trading page
- RainbowKit locale and connect-button docs; ConnectKit `en-US.ts`; Reown AppKit `w3m-connect-button`; wagmi send-transaction guide
- Dune data-freshness docs; DefiLlama docs; The Graph blog on Messari standardized subgraphs

Not reachable at survey time (behaviour described from general knowledge, marked as such in §4): Uniswap support pages, Zora/Foundation help centre, the Gnosis Auction app itself.

Internal: `DESIGN.md`; `site/index.html`, `site/phase.js`, `site/reserve-rule.js`; `docs/design/subgraph-design.md` §6–§9, §11; `subgraph/README.md` "What it refuses to compute"; `subgraph/schema.graphql`; `src/book/GlasshouseBook.sol` (`open`, `commit`, `reveal`, `settle`, `claimBond`, `commitmentFor`, the revert names); `test/Comparison.t.sol` (constants at lines 49–80); `config/auction.json`; `scripts/run-auction.ts`; `DEPLOY.md` §6; `run.md` §9, F-83, F-114, F-116, F-144, D-006, D-007.
