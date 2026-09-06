# Glasshouse documentation

Four documents, four different readers. If you only read one, read the HLD.

| Document | For | What it answers |
|---|---|---|
| [`design/HLD.md`](./design/HLD.md) | someone new to the project | What is this, why does it exist, how do the pieces fit, what are the trust boundaries |
| [`design/LLD.md`](./design/LLD.md) | someone about to change the code | Storage layout, function contracts, the top-2 algorithm, instruction encoding, error and event catalogues, bytecode budget |
| [`../ARCHITECTURE.md`](../ARCHITECTURE.md) | a reviewer | The design as it was reviewed, with the alternatives that were rejected |
| [`../DECISIONS.md`](../DECISIONS.md) | anyone who wants the short version | Every fact with its source, every decision with its options, and the corrections that superseded earlier conclusions |

Product and UI design lives in [`../DESIGN.md`](../DESIGN.md).
Release history is in [`../CHANGELOG.md`](../CHANGELOG.md).

## How these stay honest

`run.md` is the primary record and the others defer to it. Where a document is
superseded, the original reasoning is marked rather than deleted, so the trail can be
audited rather than taken on trust. Claims in the HLD and LLD cite the file and line they
came from; anything inferred rather than verified says so.

## Versioning

Design documents carry the version of the release they describe, in a status line at the
top. They are updated at release boundaries, not continuously - a document that drifts
between releases is worse than one that is honestly a version behind.
