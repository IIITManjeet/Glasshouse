# AI disclosure

ETHGlobal permits AI tooling and requires that its use be documented, including spec
files and prompts. This file is that disclosure, and it is kept honest rather than
minimal.

## Tooling used

**Claude Code** (Anthropic), interactively, throughout. Used for:

- **Research.** The sponsor-track analysis, prize-eligibility rules, prior-art survey of
  the 1inch Aqua/SwapVM hackathon corpus, and the MEV/auction landscape review. All of it
  is recorded with sources in [`run.md`](./run.md) §3, fact by fact, with the URL each
  claim was verified against. Claims that could not be verified at source are marked
  `[UNVERIFIED]` or logged as open questions rather than asserted.
- **Adversarial review.** Three independent review passes over the design — originality,
  feasibility, track fit — recorded in `run.md` §4 as Consensus-2 with their verdicts
  (`MAJOR REWORK` / `DESCOPE` / `QUALIFIES WITH FIXES`) and the corrections they forced.
  Several load-bearing assumptions were falsified this way and the corrections are
  retained inline rather than edited out.
- **Architecture.** [`ARCHITECTURE.md`](./ARCHITECTURE.md) was drafted and then reviewed
  against a local clone of `1inch/swap-vm@08089a1`. That review caught a mechanism flaw
  that would have made bidding strictly dominated (F-120).
- **Implementation.** Solidity, tests, and tooling in this repository were written with
  AI assistance and reviewed, compiled, and tested by the author.

## Spec files and prompts

The full working record is in the repository and is part of the submission, not internal
notes:

- [`run.md`](./run.md) — 133 numbered facts with sources, the decision log with the
  options considered and why each was chosen, the change log, and open questions.
- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — the design, including the constraints that
  shaped it and the alternatives rejected.
- [`DESIGN.md`](./DESIGN.md) — UI and product design.

Where a decision was reversed, the original reasoning is kept and marked superseded
rather than deleted, so the trail can be audited.

## Pre-existing work

**None.** Glasshouse was started for ETHOnline 2026. No pre-existing project-specific
code, designs, or assets are included.

1inch Aqua and SwapVM are consumed as **external dependencies** and are not vendored into
this repository. They are published under `LicenseRef-Degensoft-*-Source-1.1`, which is
source-available and not open source; all code in this repository is our own and is MIT
licensed.

## Human authorship

Design decisions, scope calls, track selection, and the mechanism itself were made by the
author. The demo video is narrated by a human voice.
