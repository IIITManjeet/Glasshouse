# AI disclosure

ETHOnline 2026 permits AI assistance on three conditions: that its use is documented
file by file, that the team's contribution is meaningful rather than nominal, and that
**all spec files, prompts and planning artifacts are included in the repository**. This
file covers the first. The second and third are covered by the documents it points at,
which are in the repository for exactly that reason.

## Tool

**Claude Code** (Anthropic), used interactively throughout.

## Where AI was used, by file

| Path | AI involvement |
|---|---|
| `src/**` | Written with AI assistance, then reviewed, compiled and tested by the author. Every design constraint they implement was decided first and recorded in `run.md` before the code existed. |
| `test/**` | Written with AI assistance. Two contract defects were found this way and are recorded in `CHANGELOG.md` under 0.1.0, and two more in the bond mechanism under 0.3.0. |
| `scripts/**` | Written with AI assistance. |
| `ignition/**` | Written with AI assistance. |
| `run.md` | The planning artifact. Research was carried out by AI agents against live sources; every fact carries the URL it was verified against, and superseded conclusions are marked rather than deleted. Decisions in the log were made by the author. |
| `docs/design/HLD.md`, `docs/design/LLD.md` | Written by AI agents reading the source directly. Both end with a section stating what they could not verify. The LLD's reading of the Book surfaced the bond-theft vector fixed in 0.3.0. |
| `README.md`, `DESIGN.md`, `CHANGELOG.md`, `DEPLOY.md` | Written with AI assistance. |
| Demo video narration | **Human.** No TTS. |

## Spec files, prompts and planning artifacts

These are in the repository because the rules require them, and they are the record of
how the AI was directed rather than a summary written afterwards:

- **[`run.md`](./run.md)** — the primary artifact. 140+ numbered facts, each with the
  source it was checked against; a decision log giving the options considered and why one
  was chosen; adversarial review rounds with their verdicts and the corrections they
  forced; and a change log. Where a conclusion was later falsified, the original is kept
  and marked superseded, so the reasoning can be audited rather than taken on trust.
- **[`DESIGN.md`](./DESIGN.md)** — product and UI design, including its open questions.
- **[`docs/design/`](./docs/design/)** — HLD and LLD.

## Meaningful contribution

Scope, track selection, the mechanism itself, and every decision in `run.md` §4 were the
author's. The research that informed them was AI-assisted and is cited to source
throughout, so a judge can check any of it independently.

## Pre-existing work

**None.** Glasshouse was started for ETHOnline 2026. No pre-existing project-specific
code, designs or assets are included.

1inch Aqua and SwapVM are consumed as **external dependencies** and are not vendored
into this repository. They are published under `LicenseRef-Degensoft-*-Source-1.1`,
which is source-available and not open source. All code here is our own and MIT licensed.
