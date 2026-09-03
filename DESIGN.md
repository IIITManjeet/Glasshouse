# DESIGN.md — Glasshouse UI & product design

> **Status:** 🟡 Scaffold. Written 2026-09-04 so that design decisions have a home before
> the build starts. **Nothing here is locked.** Sections marked ⬜ are open.
>
> **Do not start the UI until the day-7 gate in `run.md` §D-004 has passed.** The
> submission is the mechanism and the comparison test; the UI is what makes it legible.
> Building it first is the classic way to lose this track.

---

## 1. Why this UI exists

It has to do three jobs at once. If a screen serves none of them, cut it.

| # | Job | Source |
|---|---|---|
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

## 6. Stack ⬜

Constraints, then the choice:

- Must consume the subgraph **via the Subgraph MCP** (§1, job 3).
- Must run offline for the video if the network fails on the day.
- Must be buildable in ~1.5 days by one person, including the recording.

Leaning **Vite + React + TypeScript**, static-deployable, no backend of its own. HHI and
any ratio maths happen **in the frontend, not the subgraph mapping** — AssemblyScript has
no floats, so the mapping emits components and the client divides.

⬜ Charting library undecided.

## 7. Build order (when the gate opens)

1. Comparison screen against recorded data — proves the layout carries the story.
2. Wire it to live execution.
3. Auction view.
4. Outcome/receipt.
5. Latency lens **only if** ≥1 day remains.
6. Record the video against the finished UI. Reserve **3–5 hours**; it is human-narrated
   and it is not optional.

## 8. Open questions

| ID | Question | Blocks |
|---|---|---|
| U-1 | Live execution or recorded replay on the comparison screen? | §3, day 6 |
| U-2 | How do we *show* latency-vs-valuation without faking a market? | §4.2 |
| U-3 | Light or dark primary; type stack | §5 |
| U-4 | Charting library | §6 |
| U-5 | Does the Subgraph MCP call happen client-side, or at build time into a static JSON? Client-side is a stronger Graph claim; build-time is safer for the demo. | §1 job 3 |
