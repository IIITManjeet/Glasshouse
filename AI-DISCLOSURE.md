# AI disclosure

ETHOnline 2026 permits AI assistance on three conditions: that its use is documented file by
file, that the team's contribution is meaningful rather than nominal, and that **all spec
files, prompts and planning artifacts are included in the repository**. This file covers the
first, states the second plainly, and points to the third.

Updated 2026-09-13 for the submission build. An earlier version, last revised on 2026-09-10,
did not list the frontend (`web/`), the subgraph (`subgraph/`), the generated images, or the
work of the final three days. This version does.

---

## Tools

- **Claude Code** (Anthropic) — used interactively throughout development, including
  subagents working in parallel on separate files.
- **Google Gemini** — image generation, for two atmospheric background images only.

No other AI tools were used.

---

## What the developer did

The developer set the direction and made the product decisions: the problem Glasshouse
addresses, the sealed-bid second-price mechanism, the choice of tracks and partner prizes, and
what shipped and what was cut. They reviewed the AI's output against the running product and
rejected what did not work.

Several defects were found by the developer using the live site, not by the AI:

- round links that rendered nothing (`/r/<hash>` never read its hash);
- a connected wallet address shown twice, with only one copy reaching the profile;
- an address look-up box that reloaded the page it was already on;
- and the fact that a round could only be started from a terminal, which led to rounds being
  opened, bid in, revealed and settled from the website.

**Every mainnet operation was performed by the developer with their own keys:** deploying the
contracts, running the keeper, funding wallets, and placing, revealing and settling the live
bids shown in the demo video. **The AI never held a private key and never signed a
transaction.** When it attempted to sign with the project's own demonstration wallets, and
later to stop running processes, both attempts were blocked, and those actions stayed with the
developer.

**The demo narration is the developer's own voice.**

---

## Where AI was used, by file

| Path | AI involvement |
|---|---|
| `src/**` — Solidity contracts | Written with AI assistance, then reviewed, compiled and tested by the developer. Design constraints were decided and recorded in `docs/archive/run.md` before the code existed. |
| `test/**` — Solidity and JS tests | Written with AI assistance. Contract defects found this way are recorded in `CHANGELOG.md`. |
| `scripts/**` — keeper, live fill, verifier, cross-check, lint | Written with AI assistance. Every mainnet run of these scripts was started by the developer. |
| `ignition/**` — deployment modules | Written with AI assistance. The deployment itself was run by the developer. |
| `subgraph/**` — schema and AssemblyScript mappings | Written with AI assistance. Published to The Graph Network by the developer. |
| `web/**` — the Next.js frontend | Written with AI assistance. The page structure, the button and card system, the address identity marks, the FAQ, and the ability to open and settle rounds from the browser were proposed by the AI in response to the developer's requirements; the developer chose what to adopt and tested it on the live site. |
| `web/public/art/hero-field.webp`, `web/public/art/social-card.jpg` | **Generated with Google Gemini**, then cropped. Prompts and art direction are in `art-prompts/README.md`. |
| `web/app/icon.svg`, `web/app/favicon.ico` | Designed and generated with AI assistance. |
| `README.md`, `DESIGN.md`, `DECISIONS.md`, `CHANGELOG.md`, `DEPLOY.md`, `TODO.md`, `docs/**` | Written with AI assistance. `docs/design/HLD.md` and `LLD.md` were written by AI agents reading the source, and each ends with a section stating what could not be verified. |
| `DECISIONS.md` — "In your words" sections | Reserved for the developer's own words, and not written by AI. |
| `.claude/skills/**` | Instructions written for the AI agents. Included as planning artifacts — see below. |
| Demo video | **Narration: the developer's own voice. No text-to-speech, no AI voiceover.** The developer recorded the screen capture and the voice memos. The AI assembled them into the final edit, captured still screens of the site, designed the title and end cards, and cleaned up audio noise and levels with ffmpeg. |

---

## Spec files, prompts and planning artifacts

These are in the repository because the rules require them. They are the record of how the AI
was directed, not a summary written afterwards.

- **[`docs/archive/run.md`](./docs/archive/run.md)** — the primary planning artifact: numbered
  facts each checked against a source, a decision log with the options considered, adversarial
  review rounds and the corrections they forced. Superseded conclusions are marked, not deleted.
- **[`DECISIONS.md`](./DECISIONS.md)** — every judgment call, in order, in plain language.
- **[`DESIGN.md`](./DESIGN.md)** — the design findings log, including findings that were
  withdrawn and why.
- **[`docs/design/`](./docs/design/)** — the high-level and low-level designs.
- **[`art-prompts/README.md`](./art-prompts/README.md)** — the image prompts and art direction.
- **[`.claude/skills/`](./.claude/skills/)** — the instructions given to AI agents working on
  this repository.

---

## Pre-existing work

**None.** Glasshouse was started for ETHOnline 2026. No pre-existing project-specific code,
designs or assets are included.

1inch Aqua and SwapVM are consumed as **external dependencies** and are not vendored into this
repository. They are published under `LicenseRef-Degensoft-*-Source-1.1`, which is
source-available and not open source. All code here is our own and MIT licensed.
