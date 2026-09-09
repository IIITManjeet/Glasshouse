# Archive

Planning artifacts and superseded design documents, frozen at the **10 Sep 2026** build
freeze and kept unedited. ETHOnline requires that spec files, prompts and planning
artifacts ship with the submission, and `AI-DISCLOSURE.md` names `run.md` as the primary
one — so these are here rather than deleted.

**Nothing in this directory describes what shipped.** For that, read:

| For | Read |
|---|---|
| What it is and how to run it | [`../../README.md`](../../README.md) |
| The judgment calls, in order | [`../../DECISIONS.md`](../../DECISIONS.md) |
| The contract design | [`../design/HLD.md`](../design/HLD.md), [`../design/LLD.md`](../design/LLD.md) |
| The subgraph | [`../design/subgraph-design.md`](../design/subgraph-design.md) |
| Where the auction parameters came from | [`../design/window-sizing.md`](../design/window-sizing.md) |

## What is here, in supersession order

The front-end design was decided across six documents, each overriding parts of the one
before it. That chain is why they are archived together: reading any one of them alone
gives you a view that a later file already changed.

1. **`DESIGN.md`** — the four jobs, and the rule that every number on screen says what
   produced it. That rule survived and is enforced by `scripts/lint-provenance.mjs`. Its
   stack decision did not: it specifies "a single static page, no framework, no build
   step", and the product shipped as a Next.js app.
2. **`ui-spec.md`** — the design language and screen inventory. Its decision W cut wallet
   bidding from the freeze; bidding shipped.
3. **`frontend-architecture.md`** — assumed `site/` stayed the shippable artifact.
4. **`cta-patterns.md`** — a survey of how other products label and sequence controls.
5. **`ux-pattern-research.md`** — the research behind that survey.
6. **`ui-flow.md`** — the last word in the chain. Still worth reading beside
   `web/lib/bid.js`, which cites its §6 for how a reveal secret is stored and why.

**`run.md`** is the working log: every finding, decision and dead end in the order they
happened, including the prize-track research that a hackathon plan contains. It is kept
unedited because editing it would contradict both its own maintenance rule and the reason
it exists.
