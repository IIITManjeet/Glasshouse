---
name: glasshouse-auction
description: Use when a Glasshouse maker or a judge asks "what reserve should I set for my next auction", "what phase is auction X in", or "explain the receipt for auction X". Answers by querying the live Glasshouse subgraph through the Subgraph MCP and running the integer reserve rule in site/reserve-rule.js — it never estimates a number from memory. NOT YET OPERATIONAL as of 2026-09-09: the subgraph is deployed to Studio but not published to The Graph Network, so the Subgraph MCP cannot see it yet. See "Current status" below before doing anything else.
---

# Glasshouse auction skill

## Why this file exists

Glasshouse's Graph-track qualification argument (`docs/design/subgraph-design.md` §2, §8,
`run.md` F-81) is composition, not a single query: the subgraph is product one, and the
**Subgraph MCP** (`https://subgraphs.mcp.thegraph.com/sse`, `graphops/subgraph-mcp`)
consuming it is product two. This skill and `scripts/reserve-advisor.mjs` are the two
places that MCP is actually on the runtime path. Read `docs/design/subgraph-design.md`
§7.2, §7.3, §8.1–§8.5 for the full spec this file summarizes; where the two disagree, the
design doc is the one to trust and this file is stale.

## Current status: this cannot work yet

**Say this plainly, first, whenever this skill is invoked, before attempting anything:**

- The subgraph is **deployed to Studio** (deployment id
  `Qmc9Ah4ow5mXD7599hi3ewze7Fg77x1GivAqaCSAmmpK7E`, version `v0.5.1`,
  `subgraph/README.md`) but **not published to The Graph Network**.
- The Subgraph MCP only queries subgraphs "available on The Graph Network" through the
  Gateway (`docs/design/subgraph-design.md` §2). A Studio-only deployment is invisible to
  it, full stop — there is no fallback query path from the MCP to the Studio dev URL.
- Publishing is an on-chain transaction on **Arbitrum One** and needs ETH there
  (`run.md` F-83, U-b). After publishing, a **Gateway API key** restricted to this
  subgraph must be created in Studio (Studio → API Keys) and exported as `GRAPH_API_KEY`.
  Neither step has happened yet (`subgraph/README.md` "Deploy and publish" status table).
- Until both are done, do not guess a reserve, a phase, or anything else from general
  knowledge or from a stale local snapshot and present it as live. Report the missing
  prerequisites and stop, exactly as `scripts/reserve-advisor.mjs` already does — see
  "How this fails honestly" below.

## Setup a maker must complete once (outside this repo, never committed)

1. Publish the subgraph to The Graph Network from Studio (needs ETH on Arbitrum One).
2. Create a Gateway API key in Studio, restricted to `glasshouse-base`, with a spend cap.
3. `export GRAPH_API_KEY=<the key>` in the shell that launches Claude Code (or set it in
   `~/.claude/settings.json`'s `env` block). **Never put the key in `.mcp.json` or any
   other committed file** — this repository is public, and `.mcp.json` references
   `${GRAPH_API_KEY}` for exactly this reason.
4. Restart Claude Code (or reconnect the MCP server) so it picks up the new tools.
5. `scripts/reserve-advisor.mjs` reads the same `GRAPH_API_KEY`, plus either
   `--deployment <id>` or `GLASSHOUSE_DEPLOYMENT_ID` for the network-side identifier —
   which does not exist until step 1 completes. Do not reuse the Studio deployment id
   above as a stand-in; confirm the real one from Studio after publishing.

## What this skill does, and does not, compute

The skill's job is to fetch facts through the Subgraph MCP and read them aloud correctly.
The one piece of arithmetic it performs — the reserve recommendation — is not something
the model computes itself: it is `recommendReserve()` in `site/reserve-rule.js`, integer
arithmetic over indexed rows, unit-tested in `test/js/reserve-rule.test.js`. **Per
`run.md` F-155: never call this rule, or its output, "AI" or an "AI decision".** The
model's contribution is orchestration and plain-language explanation of a fact the rule
already computed — not the decision itself.

## Steps

### "What reserve should I set for my next auction?"

Drive `scripts/reserve-advisor.mjs` rather than re-implementing its query or its call to
`recommendReserve` by hand — it already connects to the Subgraph MCP, asserts the schema
at the deployment id contains `ReserveControl`, runs the Q3 window query below, calls the
exact same rule the page uses, and reports precisely which prerequisite (subgraph
publish, `GRAPH_API_KEY`, or `@modelcontextprotocol/sdk`) is missing if any is:

```
node scripts/reserve-advisor.mjs --maker <maker address>
```

(omit `--maker` to use the default owner from `ignition/parameters/chain-8453.json`).
Report back, in this order: the `_meta` block number the answer is as of; the window size
`n` and the empty/weak/strong split; the recommended `bps` and its `band`; the `reason`
code translated to a sentence (see the table below); the provenance split (team / invited
/ unknown reveals); and the one-sentence caveat the script already prints — "this is a
heuristic that splits a known-safe floor from a known-unsafe ceiling, not an
optimal-reserve computation." Do not paraphrase the number away from what the script
printed, and do not average it with anything else.

| `reason` | What it means, in a sentence |
|---|---|
| `NO_HISTORY` | No settled auctions yet for this maker; the floor is returned because there is nothing to learn from. |
| `COMPETITION_PRICES` | A strict majority of the window was contested and not thin — competition, not the reserve, has been setting the price, so the reserve stays at the floor. |
| `NO_REVEALS` | A strict majority of the window had zero reveals; the rule cannot tell "nobody was interested" from "the reserve excluded everyone", so it does not raise the reserve on a guess. |
| `WINNER_BELOW_FLOOR` | Competition is thin, but the lowest winning bid seen was already at or below the floor — there is no room to raise it. |
| `THIN_COMPETITION` | Competition is thin or split — the reserve is doing the protecting — so the recommendation is the midpoint between the floor and one bps below the lowest winning bid this window actually saw. |

### "What phase is auction X in?" / "Explain the receipt for auction X"

Query the subgraph directly through the Subgraph MCP tools (named
`mcp__subgraph-mcp__get_schema_by_deployment_id` and
`mcp__subgraph-mcp__execute_query_by_deployment_id` once `.mcp.json` is connected — look
them up with the tool search if they are not yet loaded). Deployment id: see "Current
status" above; do not query against any other id.

1. Call `get_schema_by_deployment_id` once per session and confirm the schema contains
   `ReserveControl` — this is the same self-check `reserve-advisor.mjs` does, and it
   proves the tool is pointed at the right deployment before anything is reported.
2. Run this query (Q1, `docs/design/subgraph-design.md` §8.2) for a list, or the
   single-auction query below (Q2) for one auction:

   ```graphql
   query Auctions {
     _meta { block { number timestamp } }
     auctions(orderBy: openedAtBlock, orderDirection: desc, first: 50) {
       id commitEnd revealEnd exclusiveEnd
       committedCount revealedCount unrevealedCount
       competition clearingBps filled settled parameterSet
       maker { id provenance }
       bestBidder { id provenance }
     }
   }
   ```

   ```graphql
   query AuctionDetail($id: Bytes!) {
     _meta { block { number } }
     auction(id: $id) {
       id maker { id provenance } orderHash bondToken { id symbol decimals }
       reserveBps maxBps commitEnd revealEnd exclusiveEnd
       committedCount revealedCount unrevealedCount
       teamRevealed invitedRevealed unknownRevealed
       bestBidder { id provenance } bestBps secondBps
       clearingBps winnerMarginBps reserveBound competition thin
       filled filledBy { id } fillBlock fillPhase fillByWinner
       settled settledWinner settledClearingBps winnerForfeited settlementMatchesDerivation
       bids(orderBy: commitIdx) {
         bidder { id provenance } commitIdx revealed bps revealOrder tookLead leading bondStatus
       }
       events(orderBy: blockNumber) { id kind blockNumber logIndex actor }
     }
   }
   ```

3. State the block the answer is as of — `_meta.block.number` from the *same* query
   response, never a number from an earlier call (`docs/design/subgraph-design.md` §6.1).
   Every answer this skill gives must carry that number.
4. Compute the phase from the boundaries and that block number, in prose, using exactly
   this rule (`site/phase.js`, `docs/design/subgraph-design.md` §6.1) — do not invent a
   different one:
   - `n <= commitEnd` → **commit**
   - `commitEnd < n <= revealEnd` → **reveal**
   - `revealEnd < n <= exclusiveEnd` **and** `bestBidder` is not null → **exclusive**
   - otherwise → **open**
   - "settled" is a flag on top of "open", not a fifth phase — an auction can be `open`
     and unsettled at the same time, and `settle()` only succeeds once
     `n > exclusiveEnd` regardless of whether anyone revealed.
   - Label any blocks-remaining or wall-clock estimate as "assuming Base's 2 s block
     time" — the subgraph stores no estimated timestamps for future boundaries.
5. When explaining a receipt, state whether `Auction.clearingBps` is still provisional
   (`phase == reveal`) or final, and separately whether `settlementMatchesDerivation` is
   `true`/`false`/`null` (null = not settled yet). A `false` there is a real
   subgraph-vs-contract disagreement and must be reported as one, not smoothed over.

## What this skill must never claim (refused, verbatim — `subgraph/README.md`, `docs/design/subgraph-design.md` §9)

Each of these is refused because it is either not computable from what `GlasshouseBook`
emits, or only meaningful across a market Glasshouse does not have. If a user asks for
one of these, say plainly that it is refused and why — do not compute an approximation.

- **No HHI, Gini, or any concentration index over bidders.** Three to five wallets, some
  of them ours — a concentration index over that is a rounding error presented as a
  finding (`run.md` F-114).
- **No "solver concentration", "market share", or "win share" as a competitiveness
  claim.** `Account.auctionsWon` is a count and must be shown only as a count.
- **Nothing in USD** — no TVL, volume, revenue, or bond value. No price source is
  indexed; any USD figure would be zero or invented.
- **No surplus per fill in token terms.** `AuctionFilled` carries `amountIn`/`amountOut`,
  but the base price lives in the order's program, which no log carries, and the Book
  does not even know the order's token pair. Improvement is bps only.
- **No price-improvement claim against an external benchmark.** Any Uniswap-style
  comparison is a UI-side, labelled, at-the-time figure elsewhere in the project — not
  something this skill computes or treats as indexed data.
- **No latency, priority-fee, or block-position claims.** Not in any event this subgraph
  indexes.
- **No estimated wall-clock time for a future block boundary**, beyond "assuming Base's
  2 s block time" stated as an assumption, never stored or presented as data.
- **No cross-maker aggregate presented as a population.** One maker is us; `Protocol`
  counters are totals, and must be labelled as totals, not as market statistics.
- **No "optimal reserve".** `recommendReserve()` is a heuristic that splits a known-safe
  floor from a known-unsafe ceiling; it needs the bidders' value distribution to be
  optimal, and a handful of auctions does not estimate that. Say so every time the number
  is reported.
- **No ratio without both numbers next to it.** Every percentage or mean this skill
  states (e.g. share of reveals from team wallets) must show its numerator and
  denominator alongside it.

## Vocabulary this skill must get right

- `Account.provenance` is `TEAM`, `INVITED`, or `UNKNOWN`. **`UNKNOWN` means "not on our
  address list", not "external" or "independent"** — say "N reveals from wallets not on
  our list", never "N reveals from outside participants."
- `CompetitionClass` (`NONE` / `SOLE` / `CONTESTED`) and `Auction.thin` are mechanical
  classifications of which term of the clearing rule was active, not judgments about a
  market (`docs/design/subgraph-design.md` §6.3). A `SOLE` auction is not evidence of low
  demand in general — it may just mean the reserve excluded weaker bidders, which reveals
  as `unrevealedCount`, not as a comparison to a market.

## How this fails honestly

If the subgraph is not published, `GRAPH_API_KEY` is unset, or the MCP tools are
otherwise unreachable, the correct behavior is to say so and stop — the same behavior
`scripts/reserve-advisor.mjs`'s `checkPrerequisites()` already implements:

```
reserve-advisor: cannot reach the Subgraph MCP yet.
  - GRAPH_API_KEY is not set. ...
  - No deployment id. ...
  - @modelcontextprotocol/sdk is not installed. ...
```

Relay whichever of those apply, verbatim or near-verbatim, rather than inventing a
number "for demo purposes" or falling back to `site/data/snapshot.json` and presenting it
as live. The snapshot is a labelled, offline fallback for the static page only
(`docs/design/subgraph-design.md` §8.2); this skill's whole point is to be a live
consumer of the Subgraph MCP, so a stale-and-unlabelled answer from it defeats the
purpose. If an MCP call itself errors (deployment not found, unauthorized, schema
missing `ReserveControl`), report the error text and which of the three prerequisites it
most likely indicates — do not retry silently into a different, wrong deployment id.

## Worked prompts this skill should handle once the setup above is complete

1. "What phase is the latest auction in?"
2. "Explain the receipt for auction `0x...`."
3. "What reserve should the next auction use, and why?"
