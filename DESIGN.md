# DESIGN.md — Glasshouse UI & product design

> **Status:** 🟢 **Required deliverable.** Replanned 2026-09-05: the build freezes
> **Wed 10 Sep** and the explanation page is what real testers are handed on Thu 11.
> It is no longer downstream of anything.
>
> **Build window: Mon 08 (page) → Tue 09 (comparison + auction UI) → Wed 09 polish.**
> Earlier if the Base deploy and subgraph land ahead of schedule.

---

## 1. Why this UI exists

It has to do four jobs at once. If a screen serves none of them, cut it.

| # | Job | Source |
|---|---|---|
| 0 | **Be what a tester is handed.** The Sep 10 freeze exists so real people can use this for three days. A page that needs a walkthrough from the author has failed job 0. It must stand alone. | user, 2026-09-05 |
| 1 | **Lift the Usability score.** It is our weakest axis at ~3/10, and it is scored in *both* judging rounds. ~1.5 days of dashboard buys 3 → ~7. | `run.md` F-100 |
| 2 | **Be the demo video.** A human-narrated 2–4 min video is mandatory; AI voiceover is an auto-reject. A screen recording of `forge test` is a weak 4 minutes. This UI replaces it. | F-43, F-100 |
| 3 | **Be the second Graph product on the runtime path.** *"Simply querying one Subgraph with no composition or standardization does not qualify."* The dashboard consuming a Messari-conformant subgraph **through the Subgraph MCP** is what satisfies the either/or. | F-81, F-93 |

Job 3 is the one people forget: **the UI is not decoration on the Graph track, it is the
qualifying component.** Cutting the UI cuts The Graph entirely.

## 2. The one thing this UI must never do

> **Do not present a toy market as a market.** — F-114

Our subgraph indexes *our own auction* with *our own synthetic bidders*. A
"live solver-concentration HHI" computed over three wallets we control is not a finding,
it is a rounding error, and a judge sees that in one second. Any chart that implies
market-wide measurement is a liability.

**Rule:** every number on screen is labelled with what produced it — `demo bidders`,
`Base mainnet`, `historical, external`. Honest framing of a small dataset reads as rigour.
Dressing it up as market data reads as a lie you didn't notice you told.

## 3. The core screen — Comparison

This is the product. Everything else is supporting cast.

The same order, executed three ways, side by side, with the price the user receives:

| Column | Instruction | What the audience should see |
|---|---|---|
| **Identity** | `WhitelistSequential` (0x2d) | Outsider **reverts**. The ladder is exclusionary. |
| **Clock** | `DutchAuctionBalanceIn` (0x94) | Every bidder in the block gets the **same price**; the winner is whoever landed first. Surplus → builder. |
| **Bid** | **`Glasshouse` (0x2e)** | Highest bidder wins, pays second price. Surplus → maker. |

⬜ **Open:** whether the three run live in-browser against a local node, or replay a
recorded run from the subgraph. Live is more convincing; replay is more reliable at 3am
on submission day. *Decide by day 6.* Leaning: **live against a pinned fork, with a
recorded run as the fallback path behind a flag.**

Design intent: the reader should be able to look at this screen for five seconds with no
narration and know which column they'd rather be the user in.

## 4. Supporting screens

**4.1 Auction view (live).** One auction, its phase (`commit` / `reveal` / `fill`),
the block boundaries, sealed commitments appearing, then reveals resolving into a
clearing price. The phase transitions are the interesting part — they are *why* the
instruction can stay read-only.

**4.2 Latency lens.** ⬜ The argument that the Dutch clock rewards speed over valuation
is our sharpest technical claim, and it is the hardest to *show*. Some visual that plots
bidder valuation against who actually won, under 0x94 vs 0x2e. **Highest-value unbuilt
idea in this document; also the easiest to get wrong.** Needs a sketch before any code.

**4.3 Outcome / receipt.** Per fill: winner, clearing price, price improvement in bps,
where the surplus went. Small, boring, and the thing a judge screenshots.

## 5. Design language ⬜

Not decided. Direction, not a decision:

- **Instrument, not dashboard.** This is market microstructure, not a consumer DeFi app.
  Dense, typographic, quiet. Closer to a Bloomberg panel or a protocol explorer than to a
  swap widget with a gradient.
- **The name is the metaphor.** Glasshouse — everything visible, nothing hidden, the
  mechanism on display rather than a black box with a price coming out of it. Sealed bids
  that become transparent on reveal is a nice literal reading of that.
- **Monochrome + one accent.** Colour carries meaning only: reverted, won, surplus.
- **Charts follow the `dataviz` skill** when we get there — accessible in both themes,
  one visual system across every panel.

⬜ Open: light or dark as primary; type stack; whether we ship a landing section above
the tool or go straight to the instrument.

## 6. Stack — DECIDED

**A single static page. No framework, no build step, no bundler.**

Why this and not Vite + React:

- **It can be handed to a tester as a URL in seconds.** That is the entire point of
  freezing on Sep 10, and a build pipeline is friction between finishing and sharing.
- **It cannot break on deadline day.** No install, no lockfile, no node version, no
  toolchain that decides to fail at 3am. The failure modes of a `.html` file are
  understood.
- **It deploys anywhere** — static host, GitHub Pages, or straight into the repo for a
  judge to open locally.
- Nothing on the page needs a virtual DOM. It is a document with a few interactive
  panels; hand-written DOM updates are less code here than the framework that would
  manage them.

Constraints that still hold:

- Consumes the subgraph **via the Subgraph MCP** (§1, job 3). ⚠️ `U-5` decides whether
  that call is client-side or baked to static JSON at build time.
- Must render correctly with the network unavailable, for the video and for a judge
  opening it cold.
- HHI and any ratio maths happen **client-side** — AssemblyScript has no floats, so the
  subgraph mapping emits components and the page divides.

Charts: hand-rolled inline SVG. The chart count here is small and specific; a charting
library is more weight than the two or three figures actually need.

## 7. Build order

**Mon 08 — the page itself.** The argument, told to someone who has never seen SwapVM:
identity gate → clock gate → why neither prices the order → what a sealed second-price
bid changes. Static, complete, shareable at the end of the day. **This alone satisfies
job 0.**

**Tue 09 — the comparison panel**, wired to real data from the Base auction, then the
auction view (phases, commitments appearing, reveals resolving into a clearing price).

**Wed 10 — polish and freeze.** Outcome/receipt panel if it fits. Latency lens only if
everything else is done, per §4.2.

**Fri 12 — record the video against the finished page.** Reserve 3–5 hours; it is
human-narrated and it is not optional (F-43).

## 8. Open questions

| ID | Question | Status |
|---|---|---|
| U-1 | Live execution or recorded replay on the comparison panel? | ⏳ Decide Tue 09. Leaning **live against the Base deployment, recorded run behind a flag** as the fallback. |
| U-2 | How do we *show* latency-vs-valuation without faking a market? | ⏳ Open. Highest-value unbuilt idea; also the easiest to get wrong. Needs a sketch before code. |
| U-3 | Light or dark primary; type stack | ✅ Resolved with §6: theme-aware, both supported, system default. |
| U-4 | Charting library | ✅ Resolved: none. Inline SVG. |
| U-5 | Subgraph MCP client-side or baked to static JSON? | ⏳ Decide Sun 07 with the subgraph. Client-side is the stronger Graph claim; baked is safer for the video. |
| U-6 | Where does the page live — repo only, or also a hosted URL for testers? | ⏳ Decide Mon 08. Job 0 implies a URL. |
