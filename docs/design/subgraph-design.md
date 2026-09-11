**Version 0.5.1 - 2026-09-08 - subgraph architecture.**

> **Corrected 2026-09-08 in six places**, marked inline with the date. The implementation
> was built from this document and diverged from it where it was wrong; an independent
> review then found seven defects, three of which this document had prescribed. The
> corrections below bring it back in line with `subgraph/src/`, which is the behaviour
> the tests pin. Where the two now disagree, the code is right and this file is stale.

# Glasshouse subgraph design

This document is the build spec for the subgraph that indexes the live `GlasshouseBook`
on Base, and for the two things that consume it: the explanation page and the reserve
advisor. It is written so that the implementers make no design decisions. Where a choice
was open, it is closed here and the reason is given; where it is genuinely the human's
call, it is in §11.

Ground truth, as of today:

| | Value | Source |
|---|---|---|
| Chain | Base mainnet, `8453` | `ignition/deployments/chain-8453/deployed_addresses.json` |
| `GlasshouseBook` | `0xc4ea91Fe700918220423ac307C6B1c59650FFbfe` | same |
| `GlasshouseRouter` | `0x5c3baE054e8b4915a13726B397b1AeA864247DBf` | same |
| Deploy block, and the subgraph `startBlock` | `50965408` | `ignition/deployments/chain-8453/journal.jsonl` |
| Block time | 2 s | `config/auction.json` `basis.blockSeconds` |
| Parameter sets | advocated 30/30/15/50/500, humanDemo 60/60/15/50/500 | `config/auction.json` |

The Book is immutable and has no owner (`src/book/GlasshouseBook.sol:17-18`). Nothing in
this document may assume an event that the deployed contract does not emit. §10 lists what
that costs.

Sections:

0. What is indexed, and what is not
1. The questions the subgraph answers, and the ones it refuses
2. Qualification: composition, and why not Messari conformance
3. Entity schema (`schema.graphql`)
4. Manifest (`subgraph.yaml`)
5. Mapping logic, handler by handler
6. Derived state: phase, clearing price, competition class
7. Competition as a control input to the reserve
8. Consumers and the composition story
9. Refused metrics
10. What the deployed contract makes harder than it should be
11. Open questions
12. Repository layout and test expectations

---

## 0. What is indexed, and what is not

One data source: the Book. Every state change in the mechanism is a Book transaction
that emits exactly one event, and the fill is reported to the Book by the router's maker
hook (`src/book/GlasshouseBook.sol:237-257`), so the Book's log stream is the complete
observable history of every auction.

Not indexed, deliberately:

- **The router.** `GlasshouseRouter` (`src/routers/GlasshouseRouter.sol`) is a SwapVM
  router; the fill is already reported to the Book via `postTransferIn`. Indexing the
  router would duplicate that and add 1inch's event surface to a subgraph that is about
  our mechanism.
- **Aqua** (`0x1111113ccf1426a8e30e2bff5e005d929bf6a90a`). Shared infrastructure; the
  `ship()` that creates the strategy is 1inch's business, and the order's program bytes
  never appear in any log we can read (§10).
- **Any price source.** No oracle, no USD. See §9.

### The LLD §8 gap list, re-checked against the deployed bytecode

`docs/design/LLD.md` §8 was written against an earlier Book. Against the deployed one:

| LLD §8 claim | Now |
|---|---|
| Seven events | **Eight.** `UnrevealedForfeited(maker, orderHash, bidder, amount)` was added with `claimUnrevealed` (`src/book/GlasshouseBook.sol:83`, `:329-342`). It names the bidder, so the "bidder reputation needs a second hop" complaint is closed for the unrevealed case. |
| Bond escrows at reveal | **At commit** (`:172`). `BidCommitted` therefore marks money moving; `BidRevealed` does not. The `bond` field on `BidRevealed` (`:78`) is redundant with `AuctionOpened.bond`. |
| `clearingBps` only emitted at settle | **Still true** (`:280`), and settle is permissionless and may never happen (`:262`). §6.2 resolves this by deriving it in the mapping. |
| `AuctionSettled.winner` not indexed | **Still true** (`:80`). Irrelevant to a subgraph, which decodes every field; it only limits raw log filtering. |
| `ForfeitClaimed` does not name the bidder | **Still true** (`:82`). The mapping closes the join from the auction's settled winner (§5.7). |
| Surplus per fill not computable from logs | **Still true.** `AuctionFilled` carries `amountIn`/`amountOut` (`:79`) but not the base price, and not even the order's token pair. §10. |
| `Auction.second` address, reveal-order dependent | **Removed.** Only `secondBps` survives (`:47`). |

Nothing in the current event set blocks the design below; three things make it more
work than it should be (§10).

---

## 1. The questions the subgraph answers, and the ones it refuses

Every entity in §3 exists because one of these questions is asked by the UI
(`DESIGN.md` §3, §4) or by a judge reading the mechanism.

| Question | Asked by | Answered by |
|---|---|---|
| What phase is auction X in right now, and how many blocks until the next boundary? | UI §4.1, testers | `Auction` boundaries + `_meta.block.number`, §6.1 |
| Who has committed, who has revealed, in what order, and what did the running top-2 look like after each reveal? | UI §4.1 ("commitments appearing, reveals resolving") | `Bid`, `BidRevealedEvent` with post-reveal snapshot |
| What is the clearing price, and did it come from competition or from the reserve? | UI §4.3 receipt, §7 | `Auction.clearingBps`, `reserveBound`, `competition` |
| Did the winner fill, in the window, at the improved price, or did someone else fill after it lapsed? | UI §4.3, judge | `Auction.fill*`, `fillPhase`, `fillByWinner` |
| Did the subgraph's replay of the clearing rule agree with what the contract emitted at settle? | judge, and us | `Auction.settlementMatchesDerivation` |
| Where did each bond go? | judge reading the bond argument | `Bid.bondStatus` |
| How many of these bidders are our own wallets? | `DESIGN.md` §2, F-114 | `Account.provenance`, `Auction.teamRevealed` etc. |
| Over this maker's recent auctions, has competition been thin enough that the reserve is what protects the maker? | §7, the advisor | `ReserveControl`, query Q3 |
| How much activity has the Book seen, day by day? | judge, Graph track | `UsageMetricsDailySnapshot` |

Refused, with reasons, in §9. The short version: nothing that is only meaningful across a
market we do not have.

---

## 2. Qualification: composition, and why not Messari conformance

The track text (fetched 2026-09-07 from `ethglobal.com/events/ethonline2026/prizes`):

> "Either compose two or more of The Graph's products, or build meaningfully on a
> standardized schema." ... "or layer the Subgraph MCP on top for cross-protocol
> analysis." ... "Simply querying one Subgraph with no composition or standardization
> does not qualify."

**Decision: qualify on composition. Do not claim Messari conformance.**

Why standardization is not honest here. Messari's schemas are per protocol type; the
generic one (`messari/subgraphs/schema-generic.graphql`, v3.0.0) requires on `Protocol`,
`Pool` and `FinancialsDailySnapshot` non-null `totalValueLockedUSD`,
`cumulativeSupplySideRevenueUSD`, `cumulativeProtocolSideRevenueUSD`,
`cumulativeTotalRevenueUSD`, and on `Token` a `lastPriceUSD`. Glasshouse has no pool, no
TVL (bonds are escrowed for minutes and are zero in the headline run), no revenue
accounting, and no price source. Filling those fields with zero to pass a schema check is
the kind of thing a judge spots, and the DEX-AMM schema is simply the wrong shape for a
sealed-bid auction book. `run.md` F-81 and `DESIGN.md` §1 say "Messari-conformant"; that
was written before anyone read the required fields against what we have. It is wrong and
this document supersedes it (§11, Q3).

What we take from Messari anyway, because it is true at any scale: the `Protocol` /
`Account` / `ActiveAccount` / `UsageMetricsDailySnapshot` shape and field names for
**counts** (`cumulativeTransactionCount`, `cumulativeUniqueUsers`, `dailyActiveUsers`,
`dailyTransactionCount`), `Token` with `name`/`symbol`/`decimals`, and the
`schemaVersion`/`subgraphVersion`/`methodologyVersion` triple. This is stated on the page
as "usage metrics follow the Messari common conventions; no financial schema is claimed".
It is a courtesy to tooling, not the qualification.

The qualification is two Graph products on the runtime path over one live deployment:

1. **The subgraph** (this document), published to The Graph Network from Studio.
2. **The Subgraph MCP** (`https://subgraphs.mcp.thegraph.com/sse`, graphops/subgraph-mcp),
   consumed by the reserve advisor and by the Glasshouse skill (§8.3, §8.4), calling
   `get_schema_by_deployment_id` and `execute_query_by_deployment_id` against that
   deployment.

Two facts about the MCP that bind the plan (from the graphops README, fetched today):

- It queries "Subgraphs available on The Graph Network" through the Gateway with a
  Gateway API key. **The subgraph must therefore be published, not only deployed to
  Studio.** Publishing is an Arbitrum One transaction (`run.md` F-83, U-b).
- The key is a bearer header. The Graph's own docs say not to expose keys in client-side
  apps. So the static page (`DESIGN.md` §6) cannot talk to the MCP directly without a
  proxy; the MCP consumer is the advisor and the skill, both Node-side. §8 and §11 Q4.

---

## 3. Entity schema (`schema.graphql`)

Conventions, fixed:

- Every `id` is `Bytes!`. Address ids are the 20-byte address; the auction id is the
  contract's own key; composite ids are concatenations, spelled out per entity.
- Solidity `uint24` becomes `Int` (graph-ts codegen maps it to `i32`). `uint40`,
  `uint128`, `uint256` become `BigInt`. Counters maintained by the mapping are `Int`.
  No `BigDecimal` anywhere: AssemblyScript has no floats and every ratio is divided by
  the consumer.
- Event entities are `@entity(immutable: true)`. Everything else is mutable.
- Field names on `Auction` that mirror contract storage keep the contract's names
  (`bestBps`, `secondBps`, `commitEnd`) so that `cast call auctions(...)` and a GraphQL
  result can be read side by side.

```graphql
# ---- enums -------------------------------------------------------------------

enum Network { BASE }
enum ProtocolType { GENERIC }

# Which row of config/auction.json the auction's parameters match. OTHER means the
# maker chose something else; it is a label, not a judgment.
enum ParameterSet { ADVOCATED HUMAN_DEMO OTHER }

# Mechanical classification of who set the price. Each value is one row of the
# ReserveMatrix test suite. See section 6.3. There is no "reserve bound with two or
# more reveals" class: reveal() rejects sub-reserve bids, so with two reveals the
# runner-up is always at or above the reserve.
enum CompetitionClass {
  NONE        # no reveal; no winner
  SOLE        # one reveal; secondBps is 0, the reserve is the price
  CONTESTED   # two or more reveals; the second-highest bid is the price
}

# Where in block space the first fill landed. BIDDING is an anomaly (an order that
# reported the fill to the Book but did not carry opcode 0x2e).
enum FillPhase { BIDDING EXCLUSIVE OPEN }

enum BondStatus {
  HELD                   # escrowed at commit (or zero bond), not yet claimed
  RETURNED               # claimBond
  FORFEITED_TO_MAKER     # claimForfeit, winner who did not fill
  UNREVEALED_FORFEITED   # claimUnrevealed, committed and never revealed
}

# Set from a constant list in src/provenance.ts. UNKNOWN means "not on our list",
# not "external"; the page must say so.
enum Provenance { TEAM INVITED UNKNOWN }

enum EventKind {
  AUCTION_OPENED BID_COMMITTED BID_REVEALED AUCTION_FILLED
  AUCTION_SETTLED BOND_CLAIMED FORFEIT_CLAIMED UNREVEALED_FORFEITED
}

# ---- protocol ------------------------------------------------------------------

type Protocol @entity {
  id: Bytes!                                # Book address
  name: String!                             # "Glasshouse"
  slug: String!                             # "glasshouse"
  schemaVersion: String!                    # "0.5.0"
  subgraphVersion: String!                  # from package.json of subgraph/
  methodologyVersion: String!               # "0.5.0"; bump when section 6 or 7 changes
  network: Network!
  type: ProtocolType!
  startBlock: BigInt!                       # 50965408

  cumulativeAuctionCount: Int!
  cumulativeCommitCount: Int!
  cumulativeRevealCount: Int!
  cumulativeFillCount: Int!
  cumulativeSettleCount: Int!
  cumulativeTransactionCount: Int!          # one per handled event
  cumulativeUniqueUsers: Int!               # distinct Account ids ever seen
  cumulativeUniqueMakers: Int!
  cumulativeUniqueBidders: Int!

  lastUpdateBlock: BigInt!
  lastUpdateTimestamp: BigInt!

  auctions: [Auction!]! @derivedFrom(field: "protocol")
  dailyUsageMetrics: [UsageMetricsDailySnapshot!]! @derivedFrom(field: "protocol")
}

# ---- token ---------------------------------------------------------------------

# The bond denomination. NOT the order's token pair; the Book never sees that.
type Token @entity {
  id: Bytes!                                # token address
  name: String
  symbol: String
  decimals: Int
  resolved: Boolean!                        # all three eth_calls succeeded
}

# ---- accounts ------------------------------------------------------------------

type Account @entity {
  id: Bytes!                                # address
  provenance: Provenance!

  auctionsOpened: Int!                      # as maker
  bidsCommitted: Int!
  bidsRevealed: Int!
  auctionsWon: Int!                         # incremented at AuctionSettled only
  fillsRecorded: Int!                       # as taker in AuctionFilled
  forfeits: Int!                            # settled as winner with winnerForfeited
  unrevealedForfeits: Int!                  # UnrevealedForfeited naming this bidder

  firstSeenBlock: BigInt!
  lastSeenBlock: BigInt!

  auctions: [Auction!]! @derivedFrom(field: "maker")
  bids: [Bid!]! @derivedFrom(field: "bidder")
  reserveControl: ReserveControl @derivedFrom(field: "maker")
}

# Per-day active-user helper, Messari convention.
type ActiveAccount @entity(immutable: true) {
  id: Bytes!                                # Bytes.fromI32(day) ++ address
}

# ---- auction -------------------------------------------------------------------

type Auction @entity {
  # keccak256(abi.encodePacked(maker, orderHash)), identical to GlasshouseBook.key()
  id: Bytes!
  protocol: Protocol!
  maker: Account!
  orderHash: Bytes!
  router: Bytes!
  bondToken: Token!
  bond: BigInt!                             # uint128, per bidder

  # immutable parameters, from AuctionOpened
  reserveBps: Int!
  maxBps: Int!
  commitBlocks: BigInt!                     # commitEnd - openedAtBlock
  revealBlocks: BigInt!                     # revealEnd - commitEnd
  exclusiveBlocks: BigInt!
  parameterSet: ParameterSet!

  # block-space boundaries. Phase is NOT stored; see section 6.1.
  openedAtBlock: BigInt!
  openedAtTimestamp: BigInt!
  openedTx: Bytes!
  commitEnd: BigInt!                        # last block of commit, inclusive
  revealEnd: BigInt!                        # last block of reveal, inclusive
  exclusiveEnd: BigInt!                     # revealEnd + exclusiveBlocks, inclusive

  # participation
  committedCount: Int!
  revealedCount: Int!
  unrevealedCount: Int!                     # committedCount - revealedCount, final at settle
  teamRevealed: Int!                        # reveals by TEAM accounts
  invitedRevealed: Int!
  unknownRevealed: Int!

  # running top-2, maintained exactly as GlasshouseBook.reveal() does (section 5.3).
  # Provisional while block <= revealEnd; frozen after. bestBidder null means no reveal.
  bestBidder: Account
  bestBps: Int!
  bestCommitIdx: BigInt!
  secondBps: Int!

  # derived clearing (section 6.2)
  clearingBps: Int!                         # max(reserveBps, secondBps) if bestBidder, else 0
  winnerMarginBps: Int!                     # bestBps - clearingBps
  reserveBound: Boolean!                    # bestBidder != null && secondBps < reserveBps
  competition: CompetitionClass!
  # SOLE, or CONTESTED with winnerMarginBps > clearingBps (the runner-up bid less than
  # half of what the winner bid). The thin-competition signal of section 7.
  thin: Boolean!

  # fill, from AuctionFilled (at most one per auction)
  filled: Boolean!
  filledBy: Account
  fillBlock: BigInt
  fillTimestamp: BigInt
  fillTx: Bytes
  fillAmountIn: BigInt                      # in the ORDER's tokens, which are not indexed
  fillAmountOut: BigInt
  fillPhase: FillPhase
  # "Did the winner fill?" Recomputed on every reveal after the fill and again at settle.
  # NOT the same field as AuctionFilledEvent.fillByWinner (corrected 2026-09-08).
  fillByWinner: Boolean!

  # settlement, from AuctionSettled
  settled: Boolean!
  settledAtBlock: BigInt
  settledTimestamp: BigInt
  settledTx: Bytes
  settledWinner: Bytes                      # as emitted; zero address if none
  settledClearingBps: Int                   # as emitted
  winnerForfeited: Boolean!
  settlementMatchesDerivation: Boolean      # null until settled; see section 6.2

  # bond disposition
  bondsReturnedCount: Int!
  forfeitClaimed: Boolean!
  forfeitAmount: BigInt
  unrevealedForfeitedCount: Int!
  unrevealedForfeitedAmount: BigInt!

  bids: [Bid!]! @derivedFrom(field: "auction")
  events: [AuctionEvent!]! @derivedFrom(field: "auction")
}

# ---- bid -----------------------------------------------------------------------

type Bid @entity {
  id: Bytes!                                # auction.id ++ bidder (52 bytes)
  auction: Auction!
  bidder: Account!
  commitIdx: BigInt!                        # the tie-break key
  committedAtBlock: BigInt!
  committedAtTimestamp: BigInt!
  committedTx: Bytes!
  bondAmount: BigInt!                       # auction.bond at commit

  revealed: Boolean!
  bps: Int                                  # null until revealed
  revealOrder: Int                          # 0-based position among this auction's reveals
  revealedAtBlock: BigInt
  revealedAtTimestamp: BigInt
  revealedTx: Bytes
  tookLead: Boolean!                        # this reveal displaced the previous best
  leading: Boolean!                         # currently bestBidder; final after revealEnd

  bondStatus: BondStatus!
  bondClaimedAtBlock: BigInt
  bondClaimedTx: Bytes
}

# ---- reserve control (section 7) -------------------------------------------------

# Facts about one maker's SETTLED auctions, as integers. The recommendation itself is
# not computed here; see section 7.2.
type ReserveControl @entity {
  id: Bytes!                                # maker address
  maker: Account!
  settledAuctions: Int!
  settledEmpty: Int!                        # competition NONE
  settledSole: Int!
  settledContested: Int!
  settledThin: Int!                         # rows with thin == true (overlaps SOLE)
  settledReserveBound: Int!                 # count with reserveBound
  revealedBidderSum: Int!                   # sum of revealedCount; mean is client-side
  clearingBpsSum: Int!                      # sum of clearingBps over auctions with a winner
  winnerMarginBpsSum: Int!
  # True once a settled auction with a winner has been counted; minBestBps/maxBestBps are
  # meaningless until it is.
  # ⚠️ Corrected 2026-09-08: this field did not exist and `minBestBps == 0` was the
  # "unset" sentinel. 0 is a LEGAL bestBps -- reveal() accepts bps == 0 when
  # reserveBps == 0 (src/book/GlasshouseBook.sol:187) and the empty-book arm (:196) makes
  # that bidder the winner -- so 0 cannot double as "unset" without silently discarding a
  # genuine zero-bid minimum.
  hasWinnerSeen: Boolean!
  minBestBps: Int!                          # min bestBps over settled auctions with a winner
  maxBestBps: Int!                          # max bestBps over the same set
  lastSettledAuction: Auction
  lastUpdateBlock: BigInt!
}

# ---- events, immutable, one per contract event ----------------------------------

interface AuctionEvent {
  id: Bytes!                                # tx hash ++ logIndex (i32)
  kind: EventKind!
  auction: Auction!
  blockNumber: BigInt!
  timestamp: BigInt!
  txHash: Bytes!
  logIndex: Int!
  actor: Bytes!                             # the address that acted; see per-type note
}

type AuctionOpenedEvent implements AuctionEvent @entity(immutable: true) {
  id: Bytes!
  kind: EventKind!
  auction: Auction!
  blockNumber: BigInt!
  timestamp: BigInt!
  txHash: Bytes!
  logIndex: Int!
  actor: Bytes!                             # maker
  reserveBps: Int!
  maxBps: Int!
  commitEnd: BigInt!
  revealEnd: BigInt!
  exclusiveBlocks: BigInt!
  bond: BigInt!
}

type BidCommittedEvent implements AuctionEvent @entity(immutable: true) {
  id: Bytes!
  kind: EventKind!
  auction: Auction!
  blockNumber: BigInt!
  timestamp: BigInt!
  txHash: Bytes!
  logIndex: Int!
  actor: Bytes!                             # bidder
  bid: Bid!
  commitIdx: BigInt!
}

type BidRevealedEvent implements AuctionEvent @entity(immutable: true) {
  id: Bytes!
  kind: EventKind!
  auction: Auction!
  blockNumber: BigInt!
  timestamp: BigInt!
  txHash: Bytes!
  logIndex: Int!
  actor: Bytes!                             # bidder
  bid: Bid!
  bps: Int!
  revealOrder: Int!
  tookLead: Boolean!
  # state of the auction AFTER this reveal was applied; lets the UI replay without
  # re-implementing the rule
  bestBpsAfter: Int!
  secondBpsAfter: Int!
  clearingBpsAfter: Int!
  revealedCountAfter: Int!
}

type AuctionFilledEvent implements AuctionEvent @entity(immutable: true) {
  id: Bytes!
  kind: EventKind!
  auction: Auction!
  blockNumber: BigInt!
  timestamp: BigInt!
  txHash: Bytes!
  logIndex: Int!
  actor: Bytes!                             # taker
  amountIn: BigInt!
  amountOut: BigInt!
  fillPhase: FillPhase!
  # "Was the taker the best bidder AT THIS BLOCK?" A fact about the fill block, immutable
  # and never revised. During BIDDING the best is provisional, so this can be true on an
  # auction whose Auction.fillByWinner ends up false (corrected 2026-09-08).
  fillByWinner: Boolean!
}

type AuctionSettledEvent implements AuctionEvent @entity(immutable: true) {
  id: Bytes!
  kind: EventKind!
  auction: Auction!
  blockNumber: BigInt!
  timestamp: BigInt!
  txHash: Bytes!
  logIndex: Int!
  actor: Bytes!                             # transaction.from (settle is permissionless)
  winner: Bytes!
  clearingBps: Int!
  winnerForfeited: Boolean!
  matchesDerivation: Boolean!
}

type BondClaimedEvent implements AuctionEvent @entity(immutable: true) {
  id: Bytes!
  kind: EventKind!
  auction: Auction!
  blockNumber: BigInt!
  timestamp: BigInt!
  txHash: Bytes!
  logIndex: Int!
  actor: Bytes!                             # bidder
  bid: Bid!
  amount: BigInt!
}

type ForfeitClaimedEvent implements AuctionEvent @entity(immutable: true) {
  id: Bytes!
  kind: EventKind!
  auction: Auction!
  blockNumber: BigInt!
  timestamp: BigInt!
  txHash: Bytes!
  logIndex: Int!
  actor: Bytes!                             # maker
  bid: Bid!                                 # the winner's bid, joined via settledWinner
  amount: BigInt!
}

type UnrevealedForfeitedEvent implements AuctionEvent @entity(immutable: true) {
  id: Bytes!
  kind: EventKind!
  auction: Auction!
  blockNumber: BigInt!
  timestamp: BigInt!
  txHash: Bytes!
  logIndex: Int!
  actor: Bytes!                             # maker
  bid: Bid!
  amount: BigInt!
}

# ---- usage, Messari common conventions, counts only ------------------------------

type UsageMetricsDailySnapshot @entity {
  id: Bytes!                                # Bytes.fromI32(day), day = timestamp / 86400
  day: Int!
  protocol: Protocol!
  dailyActiveUsers: Int!
  cumulativeUniqueUsers: Int!
  dailyTransactionCount: Int!
  cumulativeTransactionCount: Int!
  dailyAuctionsOpened: Int!
  dailyCommits: Int!
  dailyReveals: Int!
  dailyFills: Int!
  dailySettles: Int!
  timestamp: BigInt!                        # last update
  blockNumber: BigInt!
}
```

### 3.1 Why each entity exists

- **`Protocol`**: singleton; the Graph-side "about" record and the cumulative counters.
  Answers "how much has this Book done" without a table scan.
- **`Auction`**: the unit of everything. Its id is the contract's own key so a reader can
  `cast call $BOOK "key(address,bytes32)"` and paste the result into a query.
- **`Bid`**: one per `(auction, bidder)`, which is the contract's own cardinality
  (`src/book/GlasshouseBook.sol:63`). Carries the bond's fate, which is the part of the
  mechanism a sceptical judge asks about.
- **`Account`**: per address, with provenance. The provenance field is the F-114 defence
  made structural: the page cannot forget to label a wallet because the label travels
  with the data.
- **`ReserveControl`**: §7. Integer facts about one maker's settled auctions.
- **Event entities**: the immutable timeline. The auction view (`DESIGN.md` §4.1) is a
  replay of these ordered by `(blockNumber, logIndex)`; `BidRevealedEvent` carries the
  post-reveal top-2 so the UI animates the clearing price converging without
  re-implementing the rule in JavaScript.
- **`Token`**: bond denomination metadata, so the receipt can print "0.5 USDC bond"
  rather than an address. Nullable fields because a zero-bond auction can name any
  address as `tokenIn`.
- **`UsageMetricsDailySnapshot` / `ActiveAccount`**: counts by day. Honest at any scale
  and the one place the Messari conventions apply cleanly.

### 3.2 Id construction, exactly

| Entity | Id | graph-ts |
|---|---|---|
| `Protocol` | Book address | `event.address` |
| `Auction` | `keccak256(maker ++ orderHash)` | `Bytes.fromByteArray(crypto.keccak256(maker.concat(orderHash)))`; equals `GlasshouseBook.key()` (`src/book/GlasshouseBook.sol:102-104`) |
| `Bid` | auction id ++ bidder | `auctionId.concat(bidder)` |
| `Account`, `Token` | address | the address |
| `ReserveControl` | maker address | the address |
| any `*Event` | tx hash ++ logIndex | `event.transaction.hash.concatI32(event.logIndex.toI32())` |
| `UsageMetricsDailySnapshot` | day | `Bytes.fromI32(day)` |
| `ActiveAccount` | day ++ address | `Bytes.fromI32(day).concat(address)` |

---

## 4. Manifest (`subgraph.yaml`)

```yaml
specVersion: 1.3.0
description: Glasshouse - sealed second-price auctions for the right to fill a SwapVM order, on Base.
repository: https://github.com/IIITManjeet/Glasshouse
schema:
  file: ./schema.graphql
indexerHints:
  prune: auto            # no time-travel queries; history is replayed from event entities
dataSources:
  - kind: ethereum
    name: GlasshouseBook
    network: base
    source:
      address: "0xc4ea91Fe700918220423ac307C6B1c59650FFbfe"
      abi: GlasshouseBook
      startBlock: 50965408
    mapping:
      kind: ethereum/events
      apiVersion: 0.0.9
      language: wasm/assemblyscript
      file: ./src/book.ts
      entities:
        - Protocol
        - Token
        - Account
        - ActiveAccount
        - Auction
        - Bid
        - ReserveControl
        - AuctionOpenedEvent
        - BidCommittedEvent
        - BidRevealedEvent
        - AuctionFilledEvent
        - AuctionSettledEvent
        - BondClaimedEvent
        - ForfeitClaimedEvent
        - UnrevealedForfeitedEvent
        - UsageMetricsDailySnapshot
      abis:
        - name: GlasshouseBook
          file: ./abis/GlasshouseBook.json
        - name: ERC20
          file: ./abis/ERC20.json
      eventHandlers:
        - event: AuctionOpened(indexed address,indexed bytes32,address,address,uint40,uint40,uint40,uint24,uint24,uint128)
          handler: handleAuctionOpened
        - event: BidCommitted(indexed address,indexed bytes32,indexed address,uint40)
          handler: handleBidCommitted
        - event: BidRevealed(indexed address,indexed bytes32,indexed address,uint24,uint128)
          handler: handleBidRevealed
        - event: AuctionFilled(indexed address,indexed bytes32,indexed address,uint256,uint256)
          handler: handleAuctionFilled
        - event: AuctionSettled(indexed address,indexed bytes32,address,uint24,bool)
          handler: handleAuctionSettled
        - event: BondClaimed(indexed address,indexed bytes32,indexed address,uint128)
          handler: handleBondClaimed
        - event: ForfeitClaimed(indexed address,indexed bytes32,uint128)
          handler: handleForfeitClaimed
        - event: UnrevealedForfeited(indexed address,indexed bytes32,indexed address,uint128)
          handler: handleUnrevealedForfeited
```

Signatures are transcribed from `src/book/GlasshouseBook.sol:65-83`. The ABI file is the
`abi` array of `ignition/deployments/chain-8453/artifacts/Glasshouse#GlasshouseBook.json`,
copied verbatim; that file is the deployed artifact, not a recompile. `ERC20.json` is a
three-function ABI (`name()`, `symbol()`, `decimals()`), hand-written.

**No block handlers.** Considered and rejected: a `polling` block handler could stamp a
`phase` field every N blocks, but it would be stale by up to N blocks by construction,
it makes the subgraph noticeably slower to sync and costlier for network indexers, and
the contract itself does not store a phase, it computes one from `block.number`
(`src/book/GlasshouseBook.sol:20-25`, `:219-231`). The faithful design mirrors that: the
subgraph stores boundaries and the reader computes the phase against the indexed head
(§6.1). Time-travel queries are likewise not relied upon, hence `prune: auto`.

**No `callHandlers`.** They need the Parity tracing API and are unnecessary: every state
change emits.

---

## 5. Mapping logic, handler by handler

Shared helpers, in `src/helpers.ts`:

- `getOrCreateProtocol(address, block)`: creates with the constants of §3 and
  `startBlock = 50965408`; on every call sets `lastUpdateBlock`/`lastUpdateTimestamp`.
- `getOrCreateAccount(address, block) -> (Account, isNew)`: on creation sets
  `provenance = provenanceOf(address)` from `src/provenance.ts`, counters 0,
  `firstSeenBlock`; always updates `lastSeenBlock`. When `isNew`, the caller bumps
  `protocol.cumulativeUniqueUsers` -- and **only** that one.
- `isFirstAsMaker(account)` / `isFirstAsBidder(account)`: the per-role gates, read
  **before** the role's own counter is incremented. `cumulativeUniqueMakers` and
  `cumulativeUniqueBidders` are gated on these, never on `isNew`.
  > ⚠️ **Corrected 2026-09-08.** This said `isNew` gated the per-role counters too. It
  > cannot: `isNew` is first sighting in **any** role, so an address that opens an
  > auction and later bids is not new at its first commit and would never be counted as
  > a bidder. That undercounts every dual-role address -- including our own deployer,
  > who is the maker of the demo auctions and also bids in them, so the defect would
  > have fired on our own live data. `subgraph/src/helpers.ts:121-133`, used at
  > `src/book.ts:103` and `:229`.
- `getOrCreateToken(address)`: binds `ERC20` at the address and calls `try_name`,
  `try_symbol`, `try_decimals`; `resolved = !reverted` for all three; reverted fields
  stay null. Zero address: create with `resolved = false` and no calls.
- `touchUsage(event, actor: Bytes)`: `day = event.block.timestamp.toI32() / 86400`;
  get-or-create the snapshot; `dailyTransactionCount++`,
  `protocol.cumulativeTransactionCount++`, copy the cumulative into the snapshot; create
  `ActiveAccount(day ++ actor)` if absent and `dailyActiveUsers++` when created; set
  `timestamp`, `blockNumber`.
- `newEventId(event)`: `event.transaction.hash.concatI32(event.logIndex.toI32())`.
- `auctionId(maker, orderHash)`: §3.2.
- `classify(revealedCount) -> CompetitionClass`: `0 -> NONE`, `1 -> SOLE`, else
  `CONTESTED`.
- `isThin(competition, winnerMarginBps, clearingBps) -> bool`:
  `competition == SOLE || (competition == CONTESTED && winnerMarginBps > clearingBps)`.

Every handler that loads an `Auction` or `Bid` that does not exist logs with
`log.critical` and returns. The contract makes those states unreachable
(`src/book/GlasshouseBook.sol:158`, `:190`); if one appears, the ABI or `startBlock` is
wrong and the subgraph should fail loudly rather than fabricate.

### 5.1 `handleAuctionOpened`

Source: `open()`, `src/book/GlasshouseBook.sol:118-150`.

1. `protocol = getOrCreateProtocol`.
2. `id = auctionId(maker, orderHash)`. Create `Auction` (it cannot exist: `:131`).
3. `maker = getOrCreateAccount(params.maker)`; `maker.auctionsOpened++`.
4. `bondToken = getOrCreateToken(params.tokenIn)`.
5. Parameters: `reserveBps`, `maxBps` as `Int`; `bond`, `commitEnd`, `revealEnd`,
   `exclusiveBlocks` as `BigInt`.
   `commitBlocks = commitEnd - event.block.number` (the contract computes `commitEnd`
   as `block.number + commitBlocks`, `:137`);
   `revealBlocks = revealEnd - commitEnd` (`:138`);
   `exclusiveEnd = revealEnd + exclusiveBlocks`.
6. `parameterSet`: compare `(commitBlocks, revealBlocks, exclusiveBlocks, reserveBps,
   maxBps)` to `ADVOCATED = (30, 30, 15, 50, 500)` and `HUMAN_DEMO = (60, 60, 15, 50, 500)`
   from `src/constants.ts`, which mirrors `config/auction.json` with a comment saying so.
   Otherwise `OTHER`.
7. Initialise every counter to 0, every boolean to false, `bestBidder = null`,
   `bestBps = 0`, `bestCommitIdx = 0`, `secondBps = 0`, `clearingBps = 0`,
   `winnerMarginBps = 0`, `competition = NONE`, `fillByWinner = false`,
   `settlementMatchesDerivation = null`, `unrevealedForfeitedAmount = 0`.
8. Get-or-create `ReserveControl(maker)` with zeros (no change to its counters).
9. Create `AuctionOpenedEvent` with `actor = maker`.
10. `protocol.cumulativeAuctionCount++`; `touchUsage(event, maker)`;
    snapshot `dailyAuctionsOpened++`.

### 5.2 `handleBidCommitted`

Source: `commit()`, `:155-175`. Note the bond moves here (`:172`).

1. Load `Auction`. Load-or-create `Account(bidder)`; `bidsCommitted++`.
2. Create `Bid(auctionId ++ bidder)`: `commitIdx` (`BigInt`), `committedAt*`,
   `bondAmount = auction.bond`, `revealed = false`, `bps = null`, `revealOrder = null`,
   `tookLead = false`, `leading = false`, `bondStatus = HELD`.
3. `auction.committedCount++`; `auction.unrevealedCount = committedCount - revealedCount`.
4. `BidCommittedEvent` with `actor = bidder`, `bid`.
5. `protocol.cumulativeCommitCount++`; `touchUsage`; `dailyCommits++`.

### 5.3 `handleBidRevealed`

Source: `reveal()`, `:181-209`. This handler is a transliteration of lines 199-206 and
must not be "improved". Reveal order within a block is log order, and graph-node
delivers events in `(block, logIndex)` order, so the replay is exact.

1. Load `Auction`, `Bid`. `bidder = Account(bidder)`; `bidsRevealed++`.
2. `bid.revealed = true`; `bid.bps = params.bps`; `bid.revealOrder = auction.revealedCount`
   (before the increment); `revealedAt*`.
3. Top-2 update, with `prev = auction.bestBidder`:
   ```
   if (prev === null
       || bps > auction.bestBps
       || (bps == auction.bestBps && bid.commitIdx < auction.bestCommitIdx)) {
     if (prev !== null) { prevBid = Bid.load(auctionId ++ prev); prevBid.leading = false; save }
     auction.secondBps      = auction.bestBps          // displaced best becomes runner-up price
     auction.bestBidder     = bidder.id
     auction.bestBps        = bps
     auction.bestCommitIdx  = bid.commitIdx
     bid.tookLead = true; bid.leading = true
   } else if (bps > auction.secondBps) {
     auction.secondBps = bps
   }
   ```
   The `prev === null` arm must come first for the same reason the contract's does
   (`:196-198`): with `reserveBps == 0` a valid `bps == 0` satisfies neither comparison.
4. `auction.revealedCount++`; `unrevealedCount = committedCount - revealedCount`.
5. Derived clearing, §6.2: `clearingBps = max(secondBps, reserveBps)` (bestBidder is
   non-null here by construction); `winnerMarginBps = bestBps - clearingBps`;
   `reserveBound = secondBps < reserveBps`; `competition = classify(revealedCount)`;
   `thin = isThin(competition, winnerMarginBps, clearingBps)`.
6. Provenance tally: `teamRevealed`/`invitedRevealed`/`unknownRevealed` `++` by
   `bidder.provenance`.
7. `BidRevealedEvent` with `actor = bidder`, `bps`, `revealOrder`, `tookLead`, and the
   `*After` snapshot copied from the auction after step 5.
8. `protocol.cumulativeRevealCount++`; `touchUsage`; `dailyReveals++`.

### 5.4 `handleAuctionFilled`

Source: `postTransferIn()`, `:237-257`. Fires at most once per auction (`:253`), only if
the maker's signed order set the hook at this Book and the router named at `open()` is
the one that filled (`:251`, and the settle comment at `:269-276`).

1. Load `Auction`. `taker = getOrCreateAccount(params.taker)`; `fillsRecorded++`.
2. `filled = true`; `filledBy = taker`; `fillBlock`, `fillTimestamp`, `fillTx`,
   `fillAmountIn`, `fillAmountOut`.
3. `fillPhase`, from the block alone:
   `block <= revealEnd -> BIDDING`;
   else `bestBidder !== null && block <= exclusiveEnd -> EXCLUSIVE`;
   else `OPEN`. The `bestBidder` test mirrors `outcome()` returning
   `exclusiveUntil = revealEnd` when nobody revealed (`:222-225`).
4. `AuctionFilledEvent.fillByWinner = bestBidder !== null && taker == bestBidder`, as of
   this block. The event is immutable and keeps that as-of-the-fill meaning; it is never
   revised. `Auction.fillByWinner` answers a **different** question -- "did the winner
   fill" -- and is recomputed on every later reveal and again at settle, so it is right
   once `revealEnd` passes even if nobody ever calls `settle()`.
   > ⚠️ **Corrected 2026-09-08.** This step previously wrote `Auction.fillByWinner` once,
   > here, from whatever `bestBidder` was at the fill block. During `BIDDING` that is a
   > provisional best, so a later reveal displaces it and the stored value is then
   > permanently wrong. An auction could end up recording `bestBidder = B`,
   > `fillByWinner = true`, `filledBy = A` and `winnerForfeited = true` all at once.
   > `subgraph/src/book.ts:440-465`, recomputed at `:359` and `:523`.
5. `AuctionFilledEvent` with `actor = taker`.
6. `protocol.cumulativeFillCount++`; `touchUsage`; `dailyFills++`.

### 5.5 `handleAuctionSettled`

Source: `settle()`, `:262-281`. The only event carrying the contract's own `clearingBps`.

1. Load `Auction`. `settled = true`; `settledAt*`; `settledWinner = params.winner`;
   `settledClearingBps = params.clearingBps`; `winnerForfeited = params.winnerForfeited`.
2. `settlementMatchesDerivation =`
   `(bestBidder === null ? ZERO_ADDRESS : bestBidder) == params.winner`
   `&& clearingBps == params.clearingBps`.
   The contract emits `0` for a winnerless auction (`:280`); our `clearingBps` is `0` in
   that case (§6.2), so the comparison is exact. On mismatch, `log.error` with both
   values. This field is the subgraph's self-test: a judge can query
   `auctions(where: { settlementMatchesDerivation: false })` and should get nothing.
3. `unrevealedCount = committedCount - revealedCount`, now final.
4. If `params.winner != 0`: `Account(winner).auctionsWon++`; if `winnerForfeited`,
   `Account(winner).forfeits++`.
5. `ReserveControl(maker)`: `settledAuctions++`; increment `settledEmpty` /
   `settledSole` / `settledContested` by `competition`; `settledThin += thin ? 1 : 0`;
   `settledReserveBound += reserveBound ? 1 : 0`; `revealedBidderSum += revealedCount`;
   if `bestBidder !== null`: `clearingBpsSum += clearingBps`,
   `winnerMarginBpsSum += winnerMarginBps`,
   `minBestBps = hasWinnerSeen ? min(minBestBps, bestBps) : bestBps` then
   `hasWinnerSeen = true` (see the schema note on `hasWinnerSeen`; **corrected
   2026-09-08**, this used `minBestBps == 0` as the unset sentinel),
   `maxBestBps = max(maxBestBps, bestBps)`; `lastSettledAuction = auction`;
   `lastUpdateBlock`.
6. `AuctionSettledEvent` with `actor = event.transaction.from` (settle is permissionless,
   `:260-261`), `matchesDerivation`.
7. `protocol.cumulativeSettleCount++`; `touchUsage(event, transaction.from)`;
   `dailySettles++`.

Why the `ReserveControl` counters update at settle and nowhere else: no event fires when
`revealEnd` passes, so the mapping cannot know an auction's reveal set is final until a
later event for that auction arrives. `settle` is the one event that is guaranteed to be
after `exclusiveEnd` (`:266`). A fill is also after `revealEnd` in every non-anomalous
case, but not every auction fills. The counters are therefore labelled `settled*` and the
window statistics that the advisor needs come from a query, not from these counters
(§7.2).

### 5.6 `handleBondClaimed`

Source: `claimBond()`, `:284-298`.

1. Load `Auction`, `Bid(auctionId ++ bidder)`. `bid.bondStatus = RETURNED`;
   `bondClaimedAtBlock`, `bondClaimedTx`.
2. `auction.bondsReturnedCount++`.
3. `BondClaimedEvent`, `actor = bidder`, `amount`.
4. `touchUsage`.

### 5.7 `handleForfeitClaimed`

Source: `claimForfeit()`, `:306-320`. The event does not name the bidder (`:82`); the
contract charges `_bids[k][a.best]` (`:312`), and `a.best` is what `AuctionSettled`
emitted as `winner`.

1. Load `Auction`. `winner = auction.settledWinner` (must be non-null and non-zero:
   `claimForfeit` requires `settled && winnerForfeited`, `:309-310`). Load
   `Bid(auctionId ++ winner)`.
2. `bid.bondStatus = FORFEITED_TO_MAKER`; `bondClaimedAt*`.
3. `auction.forfeitClaimed = true`; `forfeitAmount = params.amount`.
4. `ForfeitClaimedEvent`, `actor = maker`, `bid`, `amount`.
5. `touchUsage(event, maker)`.

### 5.8 `handleUnrevealedForfeited`

Source: `claimUnrevealed()`, `:329-342`.

1. Load `Auction`, `Bid(auctionId ++ bidder)`. `bid.bondStatus = UNREVEALED_FORFEITED`;
   `bondClaimedAt*`.
2. `auction.unrevealedForfeitedCount++`; `unrevealedForfeitedAmount += amount`.
3. `Account(bidder).unrevealedForfeits++`.
4. `UnrevealedForfeitedEvent`, `actor = maker`, `bid`, `amount`.
5. `touchUsage(event, maker)`.

---

## 6. Derived state: phase, clearing price, competition class

### 6.1 Phase is computed by the reader, from the indexed head

The contract has no phase variable. `outcome()` compares `block.number` to two stored
boundaries (`src/book/GlasshouseBook.sol:219-231`) and the instruction compares it to a
third (`src/lib/GlasshouseAuctionLib.sol:62`). Nothing is emitted when a boundary passes.
So the subgraph stores the three boundaries and every consumer computes the phase against
a block number it obtained **in the same query**, via `_meta`:

```graphql
{
  _meta { block { number timestamp } }
  auction(id: "0x...") { commitEnd revealEnd exclusiveEnd bestBidder { id } settled }
}
```

The canonical function, to be implemented once in `site/phase.js` and imported by both
the page and the advisor (plain ESM, no build step):

```js
// n: the block the answer is "as of" (usually _meta.block.number). All values are
// BigInt-safe integers; compare as numbers only after Number() on values < 2^53.
export function phase(a, n) {
  if (n <= a.commitEnd) return "commit";                        // GlasshouseBook.sol:159
  if (n <= a.revealEnd) return "reveal";                        // :185-186, :219
  if (a.bestBidder !== null && n <= a.exclusiveEnd) return "exclusive"; // :231, Lib:62
  return "open";                                                // :224, Lib:76-77
}

// "settled" is a flag layered on "open", not a phase.
//
// ⚠️ Corrected 2026-09-08. This previously read as though "open" and "settle() would
// succeed" were one predicate. They are not, and a caller that treats them as one shows
// a button that reverts. settle() requires n > revealEnd + exclusiveBlocks
// unconditionally (:266), whereas phase() returns "open" from n > revealEnd onward when
// nobody revealed, because that is when the FILL opens (:222-225). For a winnerless
// auction at exclusiveBlocks = 15 the two differ for 15 blocks, about 30 s on Base.
// Use canSettle() for the settle predicate; never re-derive it from the phase.
export function canSettle(a, n) {
  if (a.settled === true) return false;
  return n > a.exclusiveEnd;   // :266. exclusiveEnd is stored as revealEnd + exclusiveBlocks
}
```

Rules for consumers:

- The phase is "as of block N" where N is `_meta.block.number`, and the page prints N.
  The indexed head can lag the chain head by a few blocks; a page that also reads
  `eth_blockNumber` from a public Base RPC may show both, labelled.
- "Blocks remaining" is `boundary - N`. A wall-clock estimate is `2 s` times that, and the
  label says "assuming Base's 2 s block time". The subgraph stores no estimated
  timestamps for future boundaries, because they would be guesses presented as data.
- Lists filtered by phase are two-step: read `_meta.block.number` once, then filter
  client-side over `auctions(where: { settled: false })`. At our scale that is a few
  dozen rows. For a server-side filter use the boundaries directly, e.g. auctions in
  reveal at block N: `where: { commitEnd_lt: N, revealEnd_gte: N }`.

### 6.2 Clearing price: derived from reveals, checked against settle

Two sources exist. `AuctionSettled.clearingBps` is the contract's own number
(`src/book/GlasshouseBook.sol:279-280`) but arrives only if someone calls the
permissionless `settle()`, and only after `exclusiveEnd`. The reveals, replayed with the
contract's own top-2 rule, give the same number from the first reveal onward, and are
frozen the moment `block > revealEnd` (`docs/design/LLD.md` §3).

**The schema trusts the derived value for display and keeps the emitted one for audit.**

- `Auction.clearingBps` is derived, updated on every reveal (§5.3 step 5). It is
  provisional while `phase == "reveal"` and the page labels it "running"; it is final in
  every later phase. It is `0` when `bestBidder` is null, matching `outcome()` (`:224`)
  and `settle()` (`:280`).
- `Auction.settledClearingBps` and `settledWinner` are the emitted values, null until
  settle.
- `Auction.settlementMatchesDerivation` is set at settle (§5.5). It is expected to be
  `true` for every settled auction; a `false` anywhere means the mapping and the contract
  disagree, which is a bug in the mapping, and it is left visible rather than patched over.

The rule itself, verbatim from the contract (`:229`, `:279`):

```
clearingBps = secondBps > reserveBps ? secondBps : reserveBps     // when a winner exists
```

`docs/design/LLD.md` §2.5 gives the three regimes: no reveal (no price), one reveal
(`secondBps == 0`, so the reserve is the price), two or more (every revealed bid is
`>= reserveBps` by `:187`, so `secondBps >= reserveBps` and the reserve is never binding).
The third regime's statement is slightly too strong when `secondBps == reserveBps`: both
branches give the same number, and `reserveBound` is defined as the strict `secondBps <
reserveBps` so that "the reserve raised the price above what competition set" is exactly
what it says.

### 6.3 Competition class, mechanically defined

`CompetitionClass` is not a judgment about a market. Each value is a row of
`test/ReserveMatrix.t.sol` and says which term of the clearing rule was active:

| Class | Definition | ReserveMatrix test |
|---|---|---|
| `NONE` | `revealedCount == 0` | `test_ZeroBidders_NoWinnerAtAnyReserve`, `test_ReserveAboveEveryBid_AuctionAccomplishesNothing` |
| `SOLE` | `revealedCount == 1` | `test_OneBidder_PaysExactlyTheReserve`; also `test_Thin_TheReserveIsWhatProtectsTheMaker` at reserves 50 and 200, see below |
| `CONTESTED` | `revealedCount >= 2` | `test_Competitive_SecondPriceDominatesTheReserve`; also `test_Thin_...` at reserves 0 and 10 |

There is deliberately no "two reveals and the reserve bound" class. `reveal()` rejects
any `bps < reserveBps` (`src/book/GlasshouseBook.sol:187`), so with two or more reveals
the runner-up is at or above the reserve and `reserveBound` is false. `reserveBound` is
therefore exactly `SOLE && reserveBps > 0`, and it is kept as a field because "the
reserve set the price" is the sentence the receipt prints.

This is also how thin competition looks in the event stream, and it is worth being
precise about because a judge will ask. In `test_Thin_TheReserveIsWhatProtectsTheMaker`
the ladder is 400/30/20. At reserve 0 or 10 all three reveal: `CONTESTED`, clearing 30,
`winnerMarginBps` 370. At reserve 50 or 200 the two weak bids cannot be revealed at all
(the test asserts `BidOutOfRange`): `SOLE`, clearing at the reserve, and the two weak
bidders end as `unrevealedCount` and, if the maker claims, `UNREVEALED_FORFEITED`. So
thinness has two signatures: a sole reveal, or a contested auction whose runner-up was
far below the winner. `Auction.thin` captures both:

```
thin = competition == SOLE
    || (competition == CONTESTED && winnerMarginBps > clearingBps)
```

The second clause says the winner bid more than twice what it paid, i.e. the
price-setting bidder valued the fill at less than half of what the winner did. The
competitive ladder (400 over 250: margin 150, price 250) is not thin; the thin ladder at
reserve 0 (400 over 30: margin 370, price 30) is. The factor of two is a threshold and is
labelled as one (§11, Q5).

---

## 7. Competition as a control input to the reserve

Scope change from the human decider: concentration monitoring is in, but strictly as a
control input to the reserve, never as a market claim. This section is the whole of it.

### 7.1 The claim, and what it rests on

The mechanism fact: the maker captures `max(reserveBps, secondBps)`. When competition is
real, `secondBps` exceeds the reserve and the reserve is inert; with five competitive
bidders `test/ReserveMatrix.t.sol` `test_Competitive_SecondPriceDominatesTheReserve`
clears at 250 bps at every reserve from 0 to 200. When competition is thin, the reserve
is the price: `test_Thin_TheReserveIsWhatProtectsTheMaker` shows one strong bidder and two
weak ones clearing at 30 with no reserve, 50 at reserve 50, 200 at reserve 200; and
`test_OneBidder_PaysExactlyTheReserve` shows a lone bidder paying exactly the reserve, so
`test_OneBidder_ZeroReserveReturnsNothingToTheMaker` is the number that appears on screen
if one person bids and the reserve is zero. The floor under all of it is staleness:
`docs/design/window-sizing.md` puts the mid's one-sigma move over the 150 s lockup at
about 44 bps on a volatile pair, which is why the deployed reserve is 50
(`config/auction.json` `basis.reserveBps`).

So: **when competition thins, the reserve does the work and should rise toward what
winners have been observed to bid; when competition is real, the reserve is inert and
should sit at the staleness floor.** That is provable from our own tests, it is about our
own auctions, and it needs no market.

One subtlety the data must respect: a reserve that binds does not appear in the events
as "two reveals, reserve above the second". It appears as a **sole reveal**, because the
Book refuses to reveal a sub-reserve bid (`src/book/GlasshouseBook.sol:187`), and the
excluded bidders appear as committed-but-unrevealed. §6.3 defines `Auction.thin` to
catch both that case and the contested-but-weak-runner-up case.

What it is not: a measure of solver concentration, market share, or anything about who
else is bidding on Base. The word "concentration" does not appear in the schema, the
page, or the skill. The entity is `ReserveControl`; the metric is "competitive thinness
of this maker's auctions"; every number carries the provenance split from §3.

### 7.2 Where each part is computed

**In the mapping (integers, facts only):**

- Per auction: `revealedCount`, `bestBps`, `secondBps`, `clearingBps`, `winnerMarginBps`,
  `reserveBound`, `competition`, and the provenance split (§5.3).
- Per maker, at settle: the `ReserveControl` counters of §3 (§5.5). Sums, counts, min,
  max. No division.

**In the consumer (page and advisor, the same code):** the recommendation. It is not in
the subgraph for two reasons. First, the mapping cannot maintain a "last K finished
auctions" window, because nothing fires when `revealEnd` passes (§5.5); the consumer can,
with one query against the indexed head. Second, the recommendation is a policy, not a
fact. Keeping the subgraph to facts is what makes it defensible: the subgraph records
what happened, the rule is open code the reader can argue with, and a judge can change
`K` or the floor and see the answer move.

The window query (Q3):

```graphql
query ReserveWindow($maker: Bytes!, $head: BigInt!, $k: Int!) {
  _meta { block { number } }
  auctions(
    where: { maker: $maker, revealEnd_lt: $head }
    orderBy: revealEnd, orderDirection: desc, first: $k
  ) {
    id reserveBps maxBps revealedCount unrevealedCount bestBps secondBps clearingBps
    winnerMarginBps reserveBound competition thin parameterSet
    teamRevealed invitedRevealed unknownRevealed
    bestBidder { id provenance }
  }
  reserveControl(id: $maker) {
    settledAuctions settledEmpty settledSole settledContested settledThin
    settledReserveBound revealedBidderSum clearingBpsSum winnerMarginBpsSum
    minBestBps maxBestBps
  }
}
```

`$head` is `_meta.block.number` from an immediately preceding query. `revealEnd_lt:
$head` is what makes every row's reveal set final.

**The rule**, in `site/reserve-rule.js`, integer-only, pure:

```
recommendReserve(window, { floorBps = 50, maxBps = 500, K = 8 })

  n         = window.length
  empty     = count(competition == NONE)
  weak      = count(thin == true)                   // SOLE, or CONTESTED with a weak runner-up
  strong    = count(competition == CONTESTED && thin == false)
  minBest   = min(bestBps over rows with bestBidder != null)   // undefined if none

  if n == 0:
      -> { bps: floorBps, band: [floorBps, floorBps], reason: NO_HISTORY }

  if strong * 2 > n:
      // competition sets the price; the reserve is inert (test_Competitive_...)
      -> { bps: floorBps, band: [floorBps, minBest - 1], reason: COMPETITION_PRICES }

  if empty * 2 > n:
      // the Book cannot tell an excluding reserve from no interest, and neither can we
      // (test_ReserveAboveEveryBid_...). Drop to the floor, never below it.
      -> { bps: floorBps, band: [floorBps, floorBps], reason: NO_REVEALS }

  // weak is at least half, or there is no majority; ties go to protecting the maker.
  // The reserve is the price (test_Thin_..., test_OneBidder_PaysExactlyTheReserve).
  hi = min(minBest - 1, maxBps)
  if hi < floorBps:
      -> { bps: floorBps, band: [floorBps, floorBps], reason: WINNER_BELOW_FLOOR }
  mid = (floorBps + hi) / 2            // integer division
  -> { bps: mid, band: [floorBps, hi], reason: THIN_COMPETITION }
```

Every result also returns `{ n, empty, weak, strong, minBest, unrevealed, provenance:
{ team, invited, unknown } }` summed over the window, so the display can say "over the
last 6 auctions, 4 of 9 revealed bids came from team wallets, and 3 commitments were
never revealed".

What the band means, stated on the page in these words: the low end is the staleness
floor, below which running the auction is worse than posting a limit order; the high end
is one below the lowest winning bid observed in the window, above which the reserve
would have excluded a winner we actually had. The point is the integer midpoint of that
band when competition is thin, and the floor otherwise. **This is a heuristic that splits
a known-safe value and a known-unsafe one. It is not an optimal-reserve computation; that
needs the bidders' value distribution, which a handful of auctions does not estimate.**
Say that sentence on the page.

Constants: `floorBps = 50` and `maxBps = 500` from `config/auction.json`; `K = 8`. The
floor is a constant, not computed from volatility, because the subgraph indexes no price
series and inventing one client-side would be the kind of number §9 refuses. §11, Q5.

### 7.3 How the recommendation reaches the maker

The maker sets the reserve once, as an argument to `open()`
(`src/book/GlasshouseBook.sol:125`). The Book is immutable; nothing on-chain can be
"retuned". The recommendation is therefore an input to the maker's next `open()`, and it
arrives by two routes that compute the same thing from the same file:

1. **The page.** A "next auction" panel under the receipt (`DESIGN.md` §4.3) runs Q3 for
   the maker, calls `recommendReserve`, prints the band, the reason, the provenance
   split, and the exact `cast send $BOOK "open(...)"` line from `DEPLOY.md` §6 step 2
   with the recommended reserve substituted. The maker copies it.
2. **The advisor**, `scripts/reserve-advisor.mjs` (§8.3). Reads the same window through
   the Subgraph MCP, calls the same `recommendReserve`, prints the same output. With
   `--send` and `MAKER_PRIVATE_KEY` in the environment it submits `open()` itself via
   `viem`. That is the closed loop of `run.md` F-101 ("adaptive reserve pricing"), and
   it is the only place the loop closes.

The two routes must agree to the basis point on the same head block. That is a test
(§12).

### 7.4 Does this qualify as "AI tooling or AI use case"? Plainly

The sub-track text (fetched today): it rewards "tooling that makes The Graph easier to
use from AI environments like Claude, Cursor, and ChatGPT (new or extended MCP servers,
**agent SKILLs**, ... client configs)" and "AI agents or apps that use The Graph as their
live source of blockchain data", requiring the project to "do meaningful work with the
data: reasoning, decisions, automation, or a natural-language interface" and to
"open-source the code with a clear README or SKILL.md".

Honest assessment:

- **As tooling, it qualifies, modestly.** A `SKILL.md` that teaches Claude or Cursor to
  read a live Glasshouse auction through the Subgraph MCP, compute the phase, and run
  the reserve rule is literally one of the named deliverable types, over live data, with
  the code open. That is real, cheap (the data plane is shared with the page), and not
  a stretch.
- **As an "AI use case" that makes decisions, it is a stretch, and we should not dress
  it up.** The reserve rule is integer arithmetic. If the only thing the model does is
  call a function and read its output aloud, calling it an AI decision is the F-101 error
  ("never call it an AI agent") in new clothes. The model earns its place only where it
  does something the rule does not: explain a specific auction's reveal pattern in
  words, notice that a window is dominated by team wallets and say so, answer "why is
  the reserve 50" from the window-sizing analysis. That is a natural-language interface
  over live data, which the track lists, and it is what the skill should be built to do.

Recommendation to the human: target sub-track 1 (composition) as the primary claim,
and sub-track 2 with the skill plus advisor framed as **tooling with a natural-language
interface**, not as an autonomous agent. Do not use "AI" as the noun for the reserve
rule anywhere. If that framing is not worth a sub-track entry to you, cut §8.4 and keep
§8.3; the composition claim does not depend on it.

---

## 8. Consumers and the composition story

Four consumers, one deployment. Deployment steps first, because the MCP depends on one.

### 8.1 Deploy and publish

1. Studio: create subgraph `glasshouse-base`. `graph auth`, `graph codegen`,
   `graph build`, `graph deploy glasshouse-base --version-label v0.5.0`. Record the
   **deployment id** (`Qm...`) and the Studio query URL
   `https://api.studio.thegraph.com/query/<user-id>/glasshouse-base/v0.5.0`.
2. **Publish to The Graph Network** from Studio (Arbitrum One transaction; `run.md`
   F-83, U-b). Record the **subgraph id** and the gateway URL. Without this step the
   Subgraph MCP cannot see the subgraph (§2).
3. Create a Gateway API key in Studio, restricted to this subgraph and with a monthly
   spend cap. It is used only by the advisor and the skill, from the environment
   variable `GRAPH_API_KEY`. Never in `site/`.
4. Record all four identifiers in `run.md` and in `subgraph/README.md`.

> **AS BUILT, 2026-09-11.** The Studio subgraph was created as **`glasshouse`**, not
> `glasshouse-base` as planned above, and the query URL is therefore
> `https://api.studio.thegraph.com/query/1758826/glasshouse/version/latest`. Step 1 is done
> (deployment `Qmc9Ah4ow5mXD7599hi3ewze7Fg77x1GivAqaCSAmmpK7E`, label `v0.5.1`); steps 2-3
> are not. The runbook that supersedes this list, including which consumer may see which
> URL, is in `subgraph/README.md`.

### 8.2 The page (`site/index.html`)

Talks **directly to the subgraph** over HTTP GraphQL, at the Studio query URL, which
needs no key and allows browser origins. This is live data from a Graph provider and it
is what `DESIGN.md` U-5 leaned against ("baked JSON"): baking would be exactly the
"static dataset" F-80 excludes. The 3,000 queries/day cap (F-83) is more than the page
needs: every page load is at most three queries, and the auction view polls Q2 every
10 s only while a phase is live.

Offline behaviour (`DESIGN.md` §6 "must render with the network unavailable"): every
successful response is written to `localStorage` under `glasshouse:q:<name>`; on fetch
failure the page renders the cached response with the banner "showing cached data as of
block N". A checked-in `site/data/snapshot.json`, produced by the advisor with
`--snapshot`, is the cold fallback for a judge opening the file with no network, and is
labelled the same way. Neither is the data source; both are labelled fallbacks.

Queries the page runs (names are the `localStorage` keys):

- **Q1 `auctions`**: `_meta`, `protocol`, and `auctions(orderBy: openedAtBlock,
  orderDirection: desc, first: 50)` with boundaries, counts, `competition`,
  `clearingBps`, `filled`, `settled`, `parameterSet`, `maker { id provenance }`,
  `bestBidder { id provenance }`. Drives the list and the phase chips.
- **Q2 `auction(id)`**: everything on one `Auction`, `bids(orderBy: commitIdx)`, and
  `events(orderBy: blockNumber, then logIndex)` with the `BidRevealedEvent` snapshots.
  Drives the auction view replay and the receipt.
- **Q3 `reserveWindow`**: §7.2. Drives the next-auction panel.

Ratios (share of reveals from team wallets, mean revealed bidders) are divided in the
page. The page shows the numerator and denominator next to every ratio.

### 8.3 The advisor (`scripts/reserve-advisor.mjs`)

An MCP client, and the runtime consumer that makes the Subgraph MCP the second Graph
product on the path:

1. Connects to `https://subgraphs.mcp.thegraph.com/sse` with
   `Authorization: Bearer $GRAPH_API_KEY` using `@modelcontextprotocol/sdk`'s `Client`
   and `SSEClientTransport`.
2. Calls `get_schema_by_deployment_id` for our deployment id and asserts the schema
   contains `ReserveControl` (proves the tool is pointed at the right thing, and the
   output is printed so the video shows it).
3. Calls `execute_query_by_deployment_id` with Q3 (after a `_meta` query for the head).
4. Runs `recommendReserve` from `site/reserve-rule.js`, prints the band, reason,
   counts, provenance split, and the `cast send` line.
5. Flags: `--maker <addr>` (default: the maker in `ignition/parameters/chain-8453.json`
   `owner`), `--k 8`, `--floor 50`, `--send` (submit `open()` via `viem`; requires
   `MAKER_PRIVATE_KEY`, `ORDER_HASH`, `BASE_RPC_URL`), `--snapshot` (write
   `site/data/snapshot.json` from Q1 and Q2 for every auction, via the MCP).

Dependencies to add: `@modelcontextprotocol/sdk`, `viem`. Node 22.

### 8.4 The skill (`.claude/skills/glasshouse-auction/SKILL.md`, plus `.mcp.json`)

`.mcp.json` at the repository root configures the hosted Subgraph MCP for Claude Code
with the README's `mcp-remote` invocation and `AUTH_HEADER` from the environment. The
skill tells the model: the deployment id; that every answer must state the `_meta` block
it is as of; the phase function of §6.1 in prose; the reserve rule of §7.2 and the
sentence about it being a heuristic; the provenance vocabulary and the rule that
`UNKNOWN` means "not on our list"; and the refusals of §9, verbatim, so that the model
declines to compute a market share when asked. It ships with three worked prompts:
"what phase is the latest auction in", "explain the receipt for auction X", "what
reserve should the next auction use, and why".

### 8.5 How this satisfies the either/or

Product one, the subgraph, is the live source. Product two, the Subgraph MCP, is layered
on it and is on the runtime path of the advisor (which can act on-chain) and the skill.
The page and the advisor compute the same recommendation from the same open rule over
the same deployment, and the video shows both agreeing on the same head block. "Make the
standards leverage clear": the page's footer states which Messari conventions are
followed (counts) and that no financial schema is claimed.

The residual risk, stated: a judge who opens only the page sees one product. Mitigation
is the demo video and the README, which is what the track asks to be judged from. A
stronger mitigation (the page itself calling the MCP through a tiny proxy) costs a
deployed worker and a place to keep the key; §11, Q4.

---

## 9. Refused metrics

Each is refused because it is either not computable from what the Book emits or only
meaningful across a market we do not have. The page and the skill repeat this list.

| Refused | Why |
|---|---|
| HHI, Gini, or any concentration index over bidders | Three to five wallets, some of them ours. A concentration index over that is a rounding error presented as a finding (`run.md` F-114). |
| "Solver concentration", "market share", "win share" as competitiveness | Same. `Account.auctionsWon` is a count and is shown as a count. |
| Anything in USD: TVL, volume, revenue, bond value | No price source is indexed. The Messari financial fields would be zero or invented. |
| Surplus per fill in token terms | `AuctionFilled` carries `amountIn`/`amountOut` but the base price lives in the order's program, which no log carries; the Book does not even know the order's token pair (§10). Improvement is reported in bps only. |
| Price improvement against an external benchmark | The Uniswap API comparison (`run.md` F-96) is a UI-side, labelled, at-the-time figure. It is not stored as if it were indexed data. |
| Latency, priority fee, or block-position data | Not in any event. The latency argument on the page is made from `DutchAuction.sol`, not from our auctions. |
| Estimated wall-clock for future boundaries | Client-side only, labelled "assuming 2 s blocks". Never stored. |
| Cross-maker aggregates presented as a population | One maker is us. `Protocol` counters are totals, labelled as totals. |
| An "optimal reserve" | Needs the value distribution. §7.2 is a heuristic and says so. |
| A stored `phase` | Stale by construction; §6.1. |

---

## 10. What the deployed contract makes harder than it should be

None of these block the design. All are unfixable without a redeploy and a resync.

1. **No boundary events.** Phase must be computed by every reader against `_meta`
   (§6.1). The contract's own design choice, and the right one for a `view` instruction,
   but it means a subgraph cannot answer "which auctions are in reveal" with a single
   server-side filter unless the caller already knows the head block.
2. **`clearingBps` and `winner` are emitted only at `settle()`**, which is permissionless
   and optional (`src/book/GlasshouseBook.sol:262-281`). The subgraph must re-implement
   the top-2 rule (§5.3) and can only cross-check it if someone settles. We settle our
   own auctions, and `settlementMatchesDerivation` is the evidence that the replay is
   faithful.
3. **The Book never learns the order's tokens.** `AuctionOpened.tokenIn` is the bond
   denomination (`:34`), not the order's input token, and `AuctionFilled.amountIn` /
   `amountOut` are in tokens the log does not name (`:79`). The receipt can print raw
   amounts with the order hash, or the page can carry the pair for the auctions we ran
   as a labelled constant; it cannot print a token-denominated surplus from indexed data.
4. **`AuctionFilled` fires only if the maker wired the hook** (`:251`, `:269-276`) and
   only for the first fill (`:253`). An auction whose order omitted the hook shows
   `filled = false` forever, and the subgraph cannot distinguish that from "nobody
   filled". Stated on the receipt as "no fill reported to the Book".
5. **`ForfeitClaimed` does not name the bidder** (`:82`). Closed by joining through
   `settledWinner` (§5.7); one extra load per event, never wrong.
6. **`commitBlocks` is not emitted**, only `commitEnd` (`:149`). Recovered as `commitEnd -
   event.block.number`, which is exact because both are set in the same transaction
   (`:137`).
7. **`uint40` block quantities** map to `BigInt` in graph-ts, so every block comparison in
   the mapping is `BigInt.lt/gt` rather than a native compare. Cosmetic.
8. **`BidRevealed.bond` is redundant** with `AuctionOpened.bond` (`:78`, `:208`). Ignored.
9. **The LLD's event catalogue is stale** (§0). The next LLD revision should list eight
   events, move escrow to commit, and drop G-2 and G-4, which the deployed code fixed.

---

## 11. Open questions for the human

| # | Question | My recommendation |
|---|---|---|
| Q1 | **Provenance list.** Which addresses go in `src/provenance.ts` as `TEAM`, and do invited bidders' addresses go in as `INVITED` at all? Publishing a friend's address in an open-source mapping is a choice they should be asked about. | Put team wallets in as `TEAM`. Ask each invited bidder; default to leaving them `UNKNOWN`, and have the page say "N reveals from wallets not on our list" rather than implying they are external. |
| Q2 | **Publish to the network.** The MCP needs it, and it needs ETH on Arbitrum One (F-83). Go, and by when? | Go, by Mon 08 evening, so the advisor can be tested against the real MCP on Tue 09. Studio-only means cutting §8.3 and §8.4, which is cutting the composition claim. |
| Q3 | **Messari.** This document says "conventions for counts, no conformance claimed" and supersedes the "Messari-conformant" wording in `run.md` F-93 and `DESIGN.md` §1 job 3. Agree? | Yes. Update those two lines when the subgraph lands. |
| Q4 | **Should the page itself call the MCP** via a small proxy (a worker holding the key), so a judge who only opens the page sees composition? | Not for the freeze. The video and README carry it. Revisit only if everything else is done by Wed 10. |
| Q5 | **Rule constants.** `K = 8`, `floorBps = 50`, the factor of two in `thin` (§6.3), and whether `--send` should exist at all. | Keep `K = 8`, the floor, and the factor of two, each printed next to the number it produced. Ship `--send` behind the explicit flag; the demo is stronger if the loop actually closes once on camera, and the flag is off by default. |
| Q6 | **Sub-track 2.** Enter it with the skill and advisor framed as tooling with a natural-language interface (§7.4), or skip it and keep §8.3 only? | Enter it, with that framing and no "AI decides the reserve" language anywhere. Half a day on top of the subgraph. |
| Q7 | **Token metadata calls.** Three `eth_call`s per new bond token at `open()`. Keep, or drop `Token` to a bare address? | Keep. It is one token, once. |
| Q8 | **Order token pair on the receipt.** Carry the pair for our own auctions as a labelled constant in the page (§10 item 3), or print raw amounts with the order hash? | Labelled constant, marked "from the order we signed, not from indexed data". |

---

## 12. Repository layout and test expectations

```
subgraph/
  subgraph.yaml
  schema.graphql
  package.json                # @graphprotocol/graph-cli, graph-ts, matchstick-as
  abis/GlasshouseBook.json    # abi array from ignition/deployments/chain-8453/artifacts/Glasshouse#GlasshouseBook.json
  abis/ERC20.json
  src/book.ts                 # the eight handlers, section 5
  src/helpers.ts
  src/constants.ts            # parameter sets, mirrors config/auction.json
  src/provenance.ts           # Q1
  tests/book.test.ts          # matchstick
  README.md                   # ids from 8.1, the three queries, the refusals
site/phase.js                 # section 6.1
site/reserve-rule.js          # section 7.2
site/data/snapshot.json       # labelled cold fallback, produced by the advisor
scripts/reserve-advisor.mjs   # section 8.3
.mcp.json                     # section 8.4
.claude/skills/glasshouse-auction/SKILL.md
```

Tests that must exist before the subgraph is deployed:

1. **Top-2 replay** (`tests/book.test.ts`, matchstick): feed the ReserveMatrix ladders
   through `handleAuctionOpened` and `handleBidRevealed` and assert `clearingBps`: the
   competitive ladder 400/250/100/60/30 clears at 250 at reserves 0, 10, 50, 200; the thin
   ladder 400/30/20 clears at 30, 30, 50, 200 at reserves 0, 10, 50, 200 (with sub-reserve
   bids omitted, as the contract would reject them), with `thin == true` in every row and
   `competition` `CONTESTED, CONTESTED, SOLE, SOLE`; the competitive ladder has
   `thin == false`; one bidder pays the reserve; a tie goes to the lower `commitIdx` in
   both reveal orders (`test/GlasshouseBook.t.sol`
   `test_Tie_EarliestCommitWins_RevealedInReverseOrder`).
2. **Settle agreement**: after any replay, a synthetic `AuctionSettled` with the
   contract's values sets `settlementMatchesDerivation = true`; a wrong value sets it
   `false` and does not throw.
3. **Phase function** (`site/phase.js`, node test): walk `C`, `C+1`, `R`, `R+1`, `X`,
   `X+1` for an auction with and without a winner and assert the phase at each,
   mirroring `test/GlasshouseBook.t.sol:284-300` as cited in `docs/design/LLD.md` §3.
4. **Rule agreement**: `reserve-rule.js` given a fixed window returns the same object in
   Node and in the browser; the advisor and the page print the same `bps` for the same
   head block against the live deployment (a manual check, recorded in `run.md`).
5. **Live self-check**, after deploy: `auctions(where: { settlementMatchesDerivation:
   false })` returns nothing.
