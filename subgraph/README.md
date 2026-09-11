# Glasshouse subgraph

Indexes `GlasshouseBook` — sealed-bid, second-price auctions for the right to fill a
SwapVM order — on **Base mainnet**.

| | |
|---|---|
| Chain | Base mainnet, `8453` (manifest network `base`) |
| `GlasshouseBook` | `0xc4ea91Fe700918220423ac307C6B1c59650FFbfe` |
| `startBlock` | `50965408` (deploy block) |
| Spec / API / schema version | `1.3.0` / `0.0.9` / `0.5.0` |

The build spec is `docs/design/subgraph-design.md`. This directory implements it; where
the two disagree, the design document is the one to fix.

## What it indexes

One data source: the Book. Every state change in the mechanism is a Book transaction
that emits exactly one event, and the fill is reported to the Book by the router's maker
hook, so the Book's log stream is the complete observable history of every auction. All
eight events are handled:

`AuctionOpened`, `BidCommitted`, `BidRevealed`, `AuctionFilled`, `AuctionSettled`,
`BondClaimed`, `ForfeitClaimed`, `UnrevealedForfeited`.

Deliberately **not** indexed: the router (`GlasshouseRouter` — the fill already reaches
the Book through `postTransferIn`), Aqua, and any price source.

Entities: `Protocol`, `Token`, `Account`, `ActiveAccount`, `Auction`, `Bid`,
`ReserveControl`, `UsageMetricsDailySnapshot`, and one immutable `*Event` entity per
contract event, all implementing the `AuctionEvent` interface so an auction's timeline
is a single ordered query.

Three things the mapping derives rather than reads, because the contract does not emit
them:

- **The clearing price.** `AuctionSettled.clearingBps` is the contract's own number but
  arrives only if someone calls the permissionless `settle()`. `Auction.clearingBps` is
  instead a replay of the contract's own top-2 rule over the reveals
  (`clearingBps = secondBps > reserveBps ? secondBps : reserveBps`), updated on every
  reveal and frozen once `block > revealEnd`.
- **`Auction.settlementMatchesDerivation`** is the self-test on that replay: at settle,
  the derived winner and clearing price are compared with the emitted ones. It should be
  `true` for every settled auction, so `auctions(where: { settlementMatchesDerivation:
  false })` should return nothing. A `false` is left visible rather than patched over.
- **`commitBlocks`**, which is not emitted — only `commitEnd` is. Recovered as
  `commitEnd - block.number`, exact because both are set in the same transaction.

**No stored `phase`.** The contract has no phase variable; it compares `block.number` to
stored boundaries. The subgraph stores the three boundaries (`commitEnd`, `revealEnd`,
`exclusiveEnd`) and the reader computes the phase against a head block obtained in the
same query via `_meta` (`site/phase.js`). A stored phase would be stale by construction.

## What it refuses to compute

Each of these is either not computable from what the Book emits, or only meaningful
across a market Glasshouse does not have. The page and the skill repeat this list.

- HHI, Gini, or any concentration index over bidders; "solver concentration", "market
  share", "win share" as competitiveness. `Account.auctionsWon` is a count and is shown
  as a count.
- Anything in USD — TVL, volume, revenue, bond value. No price source is indexed.
- Surplus per fill in token terms. `AuctionFilled` carries `amountIn`/`amountOut`, but
  the base price lives in the order's program, which no log carries; the Book does not
  even know the order's token pair. Improvement is reported in bps only.
- Price improvement against an external benchmark; latency, priority fee or block
  position; estimated wall-clock for future boundaries; an "optimal reserve"; a stored
  `phase`.

`ReserveControl` is a control input to one maker's own reserve, and nothing else. It is
not a market claim.

**Messari:** the usage metrics follow the Messari common conventions for **counts** only
(`cumulativeTransactionCount`, `cumulativeUniqueUsers`, `dailyActiveUsers`,
`dailyTransactionCount`, plus the `schemaVersion`/`subgraphVersion`/`methodologyVersion`
triple). **No financial schema is claimed** — Glasshouse has no pool, no TVL, no revenue
accounting and no price source, so the required USD fields would be zero or invented.

## Provenance labels

`Account.provenance` is `TEAM`, `INVITED` or `UNKNOWN`, from the constant list in
`src/provenance.ts`. **`UNKNOWN` means "not on our list", not "external"**, and every
consumer must say so — the page says "N reveals from wallets not on our list".

## Build

```sh
cd subgraph
npm install
npx graph codegen     # regenerates ./generated from schema.graphql + abis/
npx graph build       # compiles ./src to build/GlasshouseBook/GlasshouseBook.wasm
```

`abis/GlasshouseBook.json` is generated, not hand-written: it is the `abi` array of the
compiled artifact, cross-checked between `artifacts/src/book/GlasshouseBook.sol/GlasshouseBook.json`
and the deployed `ignition/deployments/chain-8453/artifacts/Glasshouse#GlasshouseBook.json`
(the two are byte-identical, so the ABI provably matches the bytecode live on Base).
`abis/ERC20.json` is a three-function ABI (`name`, `symbol`, `decimals`) used only to
resolve bond-token metadata.

## Tests

```sh
cd subgraph
npx graph codegen     # tests import ./generated, so codegen must run first
npx graph test        # matchstick, tests/book.test.ts
```

`tests/book.test.ts` covers the top-2 replay in `handleBidRevealed`, which is the one
piece of this directory that reimplements contract logic rather than recording it: ties
at two and three bidders in both reveal orders, a bid of `0` under `reserveBps == 0`,
and ascending and descending ladders that must reach the same winner and runner-up. It
also pins the three mapping defects fixed against this schema: the corrected
`Auction.fillByWinner`, the per-role unique counters, and `ReserveControl.hasWinnerSeen`.

Matchstick ships no Windows binary. On Windows run `npx graph test -d` (Docker) or the
same command inside WSL; `graph test` says so itself when it cannot find a binary for
the platform.

## Deploy and publish

Three consumers, and they do **not** all need the same thing. Getting this wrong is how a
billable key ends up in a public bundle, so the split is stated before the steps.

| Consumer | Endpoint | Secret | Needs publishing? |
|---|---|---|---|
| `/account` in the browser | Studio query URL, via `NEXT_PUBLIC_SUBGRAPH_URL` | none | **no** |
| `scripts/reserve-advisor.mjs` | Gateway, via `GRAPH_API_KEY` | yes, server-side | **yes** |
| The `glasshouse-auction` skill (Subgraph MCP) | Gateway | yes, server-side | **yes** |

The site is a static export (`web/next.config.mjs`, `output: "export"`). There is no server,
so anything in a `NEXT_PUBLIC_*` variable is inlined into JavaScript every visitor can read.
A Gateway URL carries the API key in its path, so it **must never** be the value of
`NEXT_PUBLIC_SUBGRAPH_URL`. The Studio URL carries only the Studio account id, which is not
a secret. That is why the page reads Studio and the two server-side tools read the Gateway,
rather than all three sharing one URL.

### Step 1 — deploy to Studio (done; repeat only if the mappings change)

```sh
npx graph auth <deploy-key>
npx graph codegen && npx graph build
npx graph deploy glasshouse --version-label v0.5.1
```

`schema.graphql`, `src/` and `subgraph.yaml` have not changed since `40120fd` (2026-09-07),
which is the commit the current Studio deployment was built from. **A redeploy is therefore
not required before publishing** — verified by rebuilding at `571ae53` and getting a clean
compile from the same sources.

### Step 2 — wire the page (no publishing, no funding, no wallet)

Set `NEXT_PUBLIC_SUBGRAPH_URL` in the Vercel project to the Studio query URL:

```
https://api.studio.thegraph.com/query/1758826/glasshouse/version/latest
```

`version/latest` is a moving pointer: deploy a new version to Studio and the page follows
it without a rebuild. That is what we want while the round data is still changing, and it
is the reason the value is not pinned to `v0.5.1`.

Unset, `web/lib/subgraph.ts` reports `state: "off"` and `Record.tsx` renders nothing at all
rather than an empty shape. Set, the account record goes live on the next deploy. Studio is
a development endpoint and is rate-limited; that is the accepted cost of not shipping a key.

### Step 3 — publish to The Graph Network — DONE 2026-09-11

Published from Studio by `0xeebf737f92c8f0d9070f35a7d9baf416923becdf`, which was funded on
Arbitrum One first. Verified from the chain rather than from the Studio UI, by reading the
GNS logs on Arbitrum and checking the deployment hash in them against ours:

| | |
|---|---|
| Publish tx | `0x14abd788bd19dffe372270a6d4ca4ec4fd72b81f0270183340da7d625d3b597c` |
| GNS | `0xec9a7fb6cbc2e41926127929c2dce6e9c5d33bec`, Arbitrum block 504080832 |
| Subgraph id | `FPQdiZTAnR8ac6grgAF2x49bWqwDh87RzqUgQxAvoY2y` |
| Deployment in the event | `0xcd128c4faa5567a6cde0dd66f8a463ffc9a56750510c2d185f4493fe74dd4d49` |
| Reserve ratio | 1000000 ppm |

That deployment hash is `Qmc9Ah4ow5mXD7599hi3ewze7Fg77x1GivAqaCSAmmpK7E` with its `0x1220`
multihash prefix stripped, which is how the published subgraph is tied to the deployment we
built rather than to some other one. The subgraph id above is the same 32 bytes as the GNS
event's first indexed argument, base58 of the raw value with no prefix — 44 characters,
where an IPFS deployment id is 46.

**An indexer allocated to it 117 blocks later** — `AllocationCreated` on the staking
contract `0xb2bb92d0de618878e438b55d5846cfecd9301105` at block 504080949. Published and
actually served are different things, and this is the evidence for the second.

### Step 4 — the Gateway key, server-side only

Create a Gateway API key in Studio, restricted to this subgraph and with a monthly spend
cap. Export it as `GRAPH_API_KEY`, alongside the deployment id the advisor also wants:

```sh
export GRAPH_API_KEY=<gateway-key>
export GLASSHOUSE_DEPLOYMENT_ID=Qmc9Ah4ow5mXD7599hi3ewze7Fg77x1GivAqaCSAmmpK7E
```

Never in `web/`, never in a `NEXT_PUBLIC_*` name, never in `site/`. `reserve-advisor.mjs`
checks both and names each missing one rather than falling back to a cached number
(`checkPrerequisites`).

The `Qm…` form above is the one to use. The MCP's own deployment tools want the 32-byte
hash, and the script converts (`normalizeDeploymentId`) so that the id printed in these
documents is the id that works. Passing `Qm…` straight through used to fail with
`Schema not found in the response`, which names neither the id nor the format it expected.

**The key must be set before Claude Code starts.** An MCP server reads its environment once,
at startup, so `setx` followed by a query in the same session still fails — `.mcp.json`
resolves `${GRAPH_API_KEY}` to nothing and the Gateway answers `auth error: malformed API
key`. Restart, then check with:

```sh
node scripts/reserve-advisor.mjs
```

Verified working end to end on 2026-09-11: MCP connect, schema fetch, `_meta`, the reserve
window query, and a printed recommendation, all against the published subgraph through the
Gateway.

### Status, as of 2026-09-11

| | |
|---|---|
| Deployment id (`Qm…`) | `Qmc9Ah4ow5mXD7599hi3ewze7Fg77x1GivAqaCSAmmpK7E` ✅ |
| Version label | `v0.5.1` ✅ |
| Mappings match the repo | ✅ unchanged since `40120fd`; rebuilt clean at `571ae53` |
| Studio query URL | `.../query/1758826/glasshouse/version/latest` ✅ answering; 6 blocks behind head |
| `NEXT_PUBLIC_SUBGRAPH_URL` | ✅ set on Vercel production, deployed, live in the bundle |
| Subgraph id (network) | `FPQdiZTAnR8ac6grgAF2x49bWqwDh87RzqUgQxAvoY2y` ✅ published 2026-09-11 |
| Indexer allocation | ✅ one, Arbitrum block 504080949 |
| Gateway query URL | `https://gateway.thegraph.com/api/<key>/subgraphs/id/FPQdiZTAnR8ac6grgAF2x49bWqwDh87RzqUgQxAvoY2y` |
| `GRAPH_API_KEY` | ✅ created and verified against the Gateway |
| `reserve-advisor.mjs` | ✅ runs end to end through the MCP |

All four consumers now work: the page on Studio, the advisor and the skill on the Gateway.
The only operational catch left is startup order — a session that began before
`GRAPH_API_KEY` was set cannot see it, because an MCP server reads its environment once.

⚠️ **A nearly empty index is the expected state, not a fault.** The Book emitted nothing at
all until 2026-09-08, and as of 2026-09-11 the whole of recorded history is:

```
cumulativeAuctionCount  1     cumulativeRevealCount  0
cumulativeCommitCount   2     cumulativeFillCount    0
                              cumulativeSettleCount  0
```

That one auction is `parameterSet: ADVOCATED` on 30/30 windows with a placeholder
`orderHash` of `0x00…01a07d2dfab2`, so it is a manual open from `DEPLOY.md` section 6 and
**not** the keeper's: the keeper hardcodes the `humanDemo` 60/60/15 windows and draws real
order hashes from `config/rounds.json`, none of which appear on chain. The keeper has never
run against Base mainnet.

Both of that auction's commits went **unrevealed** and its reveal window closed on 2026-09-07,
so the only reliability record the index holds is two bidders at `bidsRevealed 0` of
`bidsCommitted 1`. That is a real result and the page prints it rather than hiding it, but it
is worth knowing before showing the account record to anyone.
