# Glasshouse documentation

Four documents, four different readers. If you only read one, read the HLD.

Everything that described a decision later reversed, plus the raw planning log, is in
[`archive/`](./archive/README.md). Nothing in there describes what shipped.

| Document | For | What it answers |
|---|---|---|
| [`design/HLD.md`](./design/HLD.md) | someone new to the project | What is this, why does it exist, how do the pieces fit, what are the trust boundaries |
| [`design/LLD.md`](./design/LLD.md) | someone about to change the code | Storage layout, function contracts, the top-2 algorithm, instruction encoding, error and event catalogues, bytecode budget |
| [`../DECISIONS.md`](../DECISIONS.md) | anyone who wants the short version | Every judgment call, in order, in plain language, with the reasoning behind it |
| [`design/subgraph-design.md`](./design/subgraph-design.md) | someone reading the indexer | The schema, what it derives, the settlement replay, and the list of things it refuses to compute |
| [`design/window-sizing.md`](./design/window-sizing.md) | anyone asking where the parameters came from | The simulation behind the commit/reveal window sizes, with a script that reproduces it |

The judgment calls in plain language are in [`../DECISIONS.md`](../DECISIONS.md).
Release history is in [`../CHANGELOG.md`](../CHANGELOG.md).
The planning log and the superseded UI design chain are in [`archive/`](./archive/README.md).

## How these stay honest

[`archive/run.md`](./archive/run.md) is the primary record and the others defer to it. Where a document is
superseded, the original reasoning is marked rather than deleted, so the trail can be
audited rather than taken on trust. Claims in the HLD and LLD cite the file and line they
came from; anything inferred rather than verified says so.

## Versioning

Design documents carry the version of the release they describe, in a status line at the
top. They are updated at release boundaries, not continuously - a document that drifts
between releases is worse than one that is honestly a version behind.
