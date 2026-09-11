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
npx graph deploy glasshouse-base --version-label v0.5.1
```

`schema.graphql`, `src/` and `subgraph.yaml` have not changed since `40120fd` (2026-09-07),
which is the commit the current Studio deployment was built from. **A redeploy is therefore
not required before publishing** — verified by rebuilding at `571ae53` and getting a clean
compile from the same sources.

### Step 2 — wire the page (no publishing, no funding, no wallet)

Set `NEXT_PUBLIC_SUBGRAPH_URL` in the Vercel project to the Studio query URL:

```
https://api.studio.thegraph.com/query/<studio-account-id>/glasshouse-base/v0.5.1
```

Unset, `web/lib/subgraph.ts` reports `state: "off"` and `Record.tsx` renders nothing at all
rather than an empty shape. Set, the account record goes live on the next deploy. Studio is
a development endpoint and is rate-limited; that is the accepted cost of not shipping a key.

### Step 3 — publish to The Graph Network (an Arbitrum One transaction)

Publish from Studio with the wallet that owns the subgraph. It needs ETH on **Arbitrum
One** — a few dollars is enough, and as of 2026-09-11 the Base deployer
`0xeebf737f92c8f0d9070f35a7d9baf416923becdf` holds `0`, so check the balance before
opening Studio rather than after connecting a wallet.

Publishing is what the Gateway serves from, and the Subgraph MCP queries only the Gateway.
Until this step lands, the composition claim does not hold and the skill stays off.

### Step 4 — the Gateway key, server-side only

Create a Gateway API key in Studio, restricted to this subgraph and with a monthly spend
cap. Export it as `GRAPH_API_KEY`, alongside the deployment id the advisor also wants:

```sh
export GRAPH_API_KEY=<gateway-key>
export GLASSHOUSE_DEPLOYMENT_ID=Qmc9Ah4ow5mXD7599hi3ewze7Fg77x1GivAqaCSAmmpK7E
```

Never in `web/`, never in a `NEXT_PUBLIC_*` name, never in `site/`. `reserve-advisor.mjs`
checks both and names each missing one rather than falling back to a cached number
(`checkPrerequisites`, `scripts/reserve-advisor.mjs:64`).

### Status, as of 2026-09-11

| | |
|---|---|
| Deployment id (`Qm…`) | `Qmc9Ah4ow5mXD7599hi3ewze7Fg77x1GivAqaCSAmmpK7E` ✅ |
| Version label | `v0.5.1` ✅ |
| Mappings match the repo | ✅ unchanged since `40120fd`; rebuilt clean at `571ae53` |
| Studio query URL | deployed; not recorded here, it carries the Studio account id |
| `NEXT_PUBLIC_SUBGRAPH_URL` | ❌ not set — step 2, and nothing blocks it |
| Subgraph id (network) | ❌ not published — needs ETH on Arbitrum One |
| Gateway query URL | ❌ not published |
| `GRAPH_API_KEY` | ❌ not created |

`@modelcontextprotocol/sdk` is installed as of 2026-09-08, so the two remaining blockers for
`scripts/reserve-advisor.mjs` are the published subgraph and the Gateway key.

⚠️ **The Book had emitted no events at all until 2026-09-08**, so a healthy, fully synced
subgraph over an empty contract is the expected state, not a fault. The first live auction
run put `AuctionOpened` and two `BidCommitted` into the index.
