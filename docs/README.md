# Glasshouse documentation

One screen, in the order worth reading it. If you only read one document, read
`DECISIONS.md` — it is the short version, in plain language.

| # | Document | For | What it answers |
|---|---|---|---|
| 1 | [`../DECISIONS.md`](../DECISIONS.md) | anyone who wants the short version | Every judgment call, in order, in plain language — what the demo video is narrated from |
| 2 | [`../DESIGN.md`](../DESIGN.md) | anyone judging the UI | What using the shipped interface turned out to be like: findings, fixes, and the two withdrawn-from-a-screenshot corrections kept because the pattern matters |
| 3 | [`design/HLD.md`](./design/HLD.md) | someone new to the project | What this is, why it exists, how the pieces fit, the trust boundaries |
| 4 | [`design/LLD.md`](./design/LLD.md) | someone about to change the contract code | Storage layout, function contracts, the top-2 algorithm, instruction encoding, error and event catalogues, bytecode budget |
| 5 | [`design/subgraph-design.md`](./design/subgraph-design.md) | someone reading the indexer | The schema, what it derives, the settlement replay, and the list of things it refuses to compute |
| 6 | [`design/window-sizing.md`](./design/window-sizing.md) | anyone asking where the auction parameters came from | The Monte Carlo simulation behind the commit/reveal/exclusive window sizes, with a script that reproduces it |
| 7 | [`../DEPLOY.md`](../DEPLOY.md) | anyone running or redeploying this | What is already live and where, environment variables, the build/verify/deploy steps, the keeper |
| 8 | [`../FEEDBACK.md`](../FEEDBACK.md) | the Uniswap track | Developer feedback from two real integration runs against Base mainnet |
| 9 | [`../CHANGELOG.md`](../CHANGELOG.md) | anyone tracking what shipped when | Release history by version, newest first |
| 10 | [`../AI-DISCLOSURE.md`](../AI-DISCLOSURE.md) | the event's AI-use rules | Named files and the human/AI division of labour. Not owned by this index — read it directly |
| 11 | [`../subgraph/README.md`](../subgraph/README.md) | someone reading or redeploying the indexer implementation | What is indexed, what is deliberately not computed, the three consumers and which may see which key, the publish steps and their status |
| 12 | [`archive/`](./archive/README.md) | someone checking how the work was directed | Every planning document, kept unedited, including the ones a later decision overrode |

`../TODO.md` holds what is still genuinely open after submission — not a reading-order
document, but worth a look if you are asking "what would the next session do first."

## How these stay honest

[`archive/run.md`](./archive/run.md) is the primary decision record; the others defer to
it. Where a document is superseded, the original reasoning is marked rather than deleted,
so the trail can be audited rather than taken on trust. Claims in the HLD and LLD cite the
file and line they came from; anything inferred rather than verified says so.

## Versioning

Design documents carry the version of the release they describe, in a status line at the
top. They are updated at release boundaries, not continuously — a document that is honestly
a version behind is worth more than one that drifts silently between releases.
