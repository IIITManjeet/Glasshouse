# Glasshouse

**Taker priority allocated by sealed competitive bid — not by identity, not by clock.**

A custom SwapVM instruction — opcode `0x2e` — for [1inch Aqua](https://github.com/1inch/aqua) /
[SwapVM](https://github.com/1inch/swap-vm), deployed on Base mainnet, with a live board you
can watch it run on. ETHOnline 2026.

---

## Thirty seconds

**1. The contracts, right now, no setup.**

| | Address |
|---|---|
| `GlasshouseBook` | [`0xc4ea91Fe700918220423ac307C6B1c59650FFbfe`](https://basescan.org/address/0xc4ea91Fe700918220423ac307C6B1c59650FFbfe) |
| `GlasshouseRouter` | [`0x5c3baE054e8b4915a13726B397b1AeA864247DBf`](https://basescan.org/address/0x5c3baE054e8b4915a13726B397b1AeA864247DBf) |

Both on Base mainnet (8453), deployed at block 50,965,408. The router points at the real
Aqua, `0x1111113CCf1426A8E30e2bfF5E005d929bF6a90a`.

**2. The board.**

```bash
cd web && npm install && npm run dev      # http://localhost:3000
```

It reads `GlasshouseBook` directly over `eth_call` against Base's public RPC — no server,
no indexer, no API key, no wallet needed to look. Every figure carries the block it was read
at. Point it anywhere with `?rpc=` (`web/lib/useAuctions.ts:54-56`). Against mainnet it will
show the one round that has been opened there and say so; rounds only keep arriving while the
keeper is running, and the keeper is a script, not a hosted service.

**3. Watch a round open, seal, unseal and resolve** — [run it on a local fork](#run-it-locally),
three terminals, below. That is the demo: sealed bids appear as hatched cards, the reveal
window opens them, the second-highest becomes the clearing price, and the winner fills inside
an exclusive window.

**4. The one number.** `forge test --match-test test_Comparison_AllThreeGatesOnTheSameOrder -vv` —
the same order, the same three participants, the same curve, under all three gates:

```
gate                        winner values   maker gives up (bps of base)
identity  WhitelistSequential  0x2d   100    10000
clock     DutchAuctionBalIn    0x94   100    10618
bid       GlasshouseAuction    0x2e   400     9756
```

Base price is 10000; lower is better for the maker. `test/Comparison.t.sol:456-458`.

---

## The problem

SwapVM ships two ways to decide *who is allowed to fill an order*, and neither allocates by
what the fill is actually worth.

**By identity — `WhitelistSequential` (`0x2d`).** A hardcoded ladder of privileged takers,
each with an exclusive window. An unlisted taker does not merely lose priority: it hits
`require(timeLeft >= duration, WhitelistSequentialTimeViolation())` and **reverts** until the
entire cumulative ladder has elapsed
(`node_modules/@1inch/swap-vm/src/instructions/Whitelist.sol:221`). It is a cartel ladder
written into the order.

**By clock — `DutchAuctionBalanceIn` / `Out` (`0x94` / `0x95`).** The price is a pure
function of `block.timestamp` (`.../instructions/DutchAuction.sol:60-62`):

```solidity
uint256 elapsed = block.timestamp - start;
ctx.swap.balanceIn = ctx.swap.balanceIn * uint256(decay).pow(elapsed, ONE) / ONE;
```

Every transaction in a block shares one timestamp, so **every bidder in that block faces an
identical price**. Valuation cannot break the tie. Allocation is decided by intra-block
ordering — by priority fee and builder placement — and the surplus above the posted price is
competed away into **priority fees paid to the builder**, not returned to the maker. The
descending clock does not price the order; it runs a latency auction whose proceeds leak out
of the protocol.

That is not a theoretical complaint. It is what the two shipped instructions do, in ~40 lines
of upstream Solidity you can read at the paths above.

## What Glasshouse adds

One instruction — **`Opcode._2e`**, the free slot immediately after `WhitelistSequential` in
the *Conditions & access guards* bank (`.../libs/OpcodeList.sol:67-68`) — gating the fill on a
**sealed-bid, second-price (Vickrey) auction with a committed close**.

- The highest bidder wins and pays `max(reserve, secondHighest)`.
- The winning bid is a **price improvement in basis points** applied to `balanceIn`, so
  ordinary SwapVM settlement delivers the surplus to the maker. No transfer, no custody, no
  fee router.
- The winner gets an **exclusive fill window**; afterwards the order opens at base price to
  anyone.
- Sealed rather than open, for **shill resistance**: an open second-price auction lets the
  maker insert a bid just under the top.

> **The demo maker bids in its own auctions, and it is labelled on the board.** The keeper
> that keeps a live round on the page also places one bid per round, from the maker's own
> address, so that a lone visitor sees a second price rather than the reserve — a
> second-price auction with one bidder clears at the reserve and demonstrates nothing.
> It commits at index 0, before any visitor can have acted; it cannot read a sealed rival;
> it never reveals early; and its bond is 0. So it behaves as a randomised hidden reserve
> drawn from 60–200 bps, well under `maxBps`, and any real bidder can outbid it. It is
> marked `house · the maker` on its own bid card rather than explained away here. A
> production maker would set `reserveBps` and not bid at all.

**"Why not just omit the instruction?"** A maker who does not want an auction leaves `0x2e`
out of the program, and nothing here applies to them — that is the point of it being an
opcode rather than a protocol rule. The question only bites if you assume someone else
composes the order; but the maker authors it, so omission is the maker choosing not to sell
priority, which is a preference this design has no opinion about. What Glasshouse changes is
the option available to a maker who *does* want the fill allocated by value: before, the
only gates SwapVM shipped were identity and a clock.

**Why this is not "a Dutch auction in disguise."** Dutch auctions are strategically
equivalent to first-price sealed-bid auctions — in a *frictionless* model. On chain that
equivalence breaks at exactly the two points visible in the source above: `block.timestamp`
is quantised to the block, and ordering inside the block is sold to the highest priority fee.
The descending clock therefore awards to the **lowest-latency** participant regardless of
valuation. Glasshouse changes the allocation rule and the surplus recipient, and the
difference is the 10618 → 9756 in the table.

## Architecture

Three phases, disjoint in block space. The split exists to satisfy a hard SwapVM constraint:
`quote()` and `swap()` execute the same program in different static contexts, so **an
instruction that mutates state makes quote and swap diverge**.

| Phase | Where | Writes state? |
|---|---|---|
| Commit + reveal bids | `GlasshouseBook`, its own transactions | yes |
| Fill gate | `GlasshouseAuction` instruction, inside the VM | **no** — `STATICCALL` to `outcome()` only |
| Bond settlement | keeper transaction | yes |

`GlasshouseBook` has **no owner, no upgrade path, no admin**. Auction parameters are immutable
after `open()`. The answer to *"who can change what `outcome()` returns?"* is *nobody*, which
is what makes the quote/swap consistency argument airtight.

```
src/interfaces/IGlasshouseBook.sol      Outcome / AuctionStatus
src/lib/GlasshouseAuctionLib.sol        the mechanism, pure + view only (77 lines)
src/book/GlasshouseBook.sol             the only stateful contract (356 lines)
                                        open:118  commit:155  reveal:181  outcome:213
                                        settle:262  claimBond:284  claimForfeit:306
                                        claimUnrevealed:329  auctions:344
src/instructions/GlasshouseAuction.sol  opcode 0x2e (52 lines)
src/routers/GlasshouseRouter.sol        AquaSwapVMRouter + our opcode
web/                                    the product: board, bidding, rounds, accounts
scripts/keeper.ts                       opens rounds and bids as the house
scripts/run-live-fill.ts                one auction on mainnet, ending in a real fill
scripts/uniswap-benchmark.mjs           external price anchor, Uniswap v3 QuoterV2 on Base
subgraph/                               history and the settlement replay
site/index.html                         the written argument (no build step, opens from file://)
```

**Extension pattern.** Opcode sets at swap-vm HEAD are an `if`/`else` chain in
`_runOpcode(Context memory, uint256, bytes calldata) internal virtual`. Extension means
**overriding `_runOpcode`, handling the new opcode, delegating the rest to `super`** — exactly
what upstream's own `AquaOpcodesDebug` does. Slot numbering comes from the `Opcode` enum,
whose 256 members are already defined upstream, so **no 1inch file is modified or vendored.**
(If you are following an older tutorial: the `_opcodes()` array API it overrode no longer
exists at HEAD.)

**The EIP-170 constraint that shapes everything.** `SwapVMRouter` with the full opcode set
compiles to 29,159 bytes and cannot be deployed — solc reports this as a *warning*, so it
surfaces only when a deploy reverts. `AquaSwapVMRouter` ships 16 opcodes because it has to, not
by curation, and Glasshouse lives in its headroom: **21,108 bytes against upstream's 20,376,
leaving 3,468 under the 24,576 limit** (`node scripts/size-check.mjs`; the Book is 6,149). Our
opcode *plus* re-adding `WhitelistSequential` — which the deployed Aqua router omits, and which
the comparison above needs — costs **732 bytes**. The check fails the build above the limit.

## The product

`web/` is a Next.js 16 + Tailwind app that builds as a **static export** (`output: 'export'`,
`web/next.config.mjs`). There is no server, which means there is nowhere to hide a secret:
every read is a call the visitor could make themselves.

- **The board** (`web/app/page.tsx`) — the live round, its phase track against the current
  block, sealed cards that open when the reveal window does, the clearing price, and what
  produced each figure.
- **Bidding** (`web/components/BidPanel.tsx`) — connect, seal a bid, reveal it in the window,
  fill. The salt is written to `localStorage` *before* the wallet opens: a commit whose salt
  exists only in a dead tab is unrevealable by anyone.
- **Rounds** (`web/app/rounds/page.tsx`) and **accounts** (`web/app/account/page.tsx`).
- Everything that *computes* — `phase`, the reserve rule, the chain reader — is plain ESM in
  `web/lib/`, shared with the Node tests. `web/` renders; it never re-implements.

**The keeper** (`scripts/keeper.ts`) opens a fresh round every 60 blocks with the `humanDemo`
windows — commit 60 / reveal 60 / exclusive 15 (`:53-55`) — so the board is never empty. It is
**also the house bidder**: one blind bid of 60–200 bps (`:69-70`), always the *first* commit of
the round (`commitIdx 0`, `:229-235`), so it cannot react to anyone, and it is labelled as the
house on the page rather than hidden. Without it a lone visitor is the only bidder, a
second-price auction with one bidder clears at the reserve, and the mechanism never does the
one thing that makes it interesting. Bond is 0 on keeper rounds — a stranger cannot be asked to
escrow an ERC-20 to try a demo — which means the *silence-costs-something* property is
specified and tested but **not demonstrated live**.

The keeper is a script you run. It is not a hosted service, and it is not running right now.

## What is proven, and what is not

**Verified by `forge test` — 97 tests, 9 suites, 0 failures.** Plus `npm run test:js`, 50
tests, 0 failures, over the shared ESM (`phase`, the reserve rule, the advisor, and the
call budget one poll of the board is allowed to spend).

- **A real fill through the official Aqua, on a fork of Base.**
  `test/fork/AquaBaseFork.t.sol::test_Fork_RealFillThroughOfficialAqua`: 0.01 WETH in,
  38.986354 USDC out, gated by `0x2e`, priced at the second bid, through
  `0x1111113CCf1426A8E30e2bfF5E005d929bF6a90a`. The 1inch track requires *"onchain execution
  of token transfers … (**local forks are ok**)"*.
- **The improvement is measured, not asserted.** `test_Fork_MeasuredImprovementOnTheXYCCurve`
  prints 243 bps measured against 250 nominal. The gap is real and explained: `AquaOpcodes`
  has no `LimitSwap`, so the deployed router prices with `XYCSwap`, where scaling `balanceIn`
  by (1 + b) moves the price by *approximately* b. The exact result holds only for `LimitSwap`.
- **Upstream's own invariants hold with the gate attached.**
  `test/invariants/GlasshouseInvariants.t.sol` runs `CoreInvariants` over `0x2e` in every
  auction phase: nothing fills during bidding, not even for the eventual winner; symmetry,
  additivity, monotonicity and rounding survive the improvement inside the window; and
  afterwards the order prices as though no auction were attached.

**What the mainnet deployment does *not* prove, stated plainly.** The contracts are live on
Base and behave: `AQUA()` returns the real Aqua, `commitmentFor()` on the deployed Book is
byte-identical to a local `keccak256(abi.encodePacked(...))`, and `outcome()` on an unopened
auction returns status `None`, so an order carrying the gate with no auction open stays
fillable as a plain limit order.

But **no complete auction has run on mainnet.** As of block 51,055,377 the Book has exactly one
`AuctionOpened` (block 51,008,611) with two `BidCommitted` and **zero** `BidRevealed`, zero
`AuctionSettled`, zero `AuctionFilled` — check it yourself:

```bash
cast logs --from-block 51008600 --to-block 51008700 \
  --address 0xc4ea91Fe700918220423ac307C6B1c59650FFbfe --rpc-url https://mainnet.base.org
```

That round's order hash is `0x…01a07d2dfab2`, which is not the hash of any real order, so no
SwapVM program ever ran against it and no fill was ever possible. `scripts/run-live-fill.ts`
closed that gap on 2026-09-12: one auction against `router.hash(order)` for an order really
shipped to Aqua, with every byte of the encoding taken from `test/fork/LiveFillPreflight.t.sol`
rather than re-derived, and the on-chain `router.hash(order)` asserted equal to the preflight's
before anything was spent.

**Order `0x58296d32…`, on Base mainnet.** Two bidders committed sealed. The winner revealed
400 bps, the rival 250, and the auction cleared at **250 — the rival's bid, not the winner's**.
The winner then filled inside the exclusive window: 0.00001 WETH in, 24,096 USDC out, the exact
amounts the preflight predicted. `fillPhase` is `EXCLUSIVE` and `fillByWinner` is true, so the
window did the thing it exists to do. That is the whole claim of this project happening once,
with real money, on a public chain.

**Also honest:**

- **The subgraph is published to The Graph Network, and the index is nearly empty.** Subgraph
  id `FPQdiZTAnR8ac6grgAF2x49bWqwDh87RzqUgQxAvoY2y`, deployment
  `Qmc9Ah4ow5mXD7599hi3ewze7Fg77x1GivAqaCSAmmpK7E`, label `v0.5.1`, indexing the Book from
  block 50,965,408; an indexer has allocated to it, so it is served rather than merely listed
  (`subgraph/README.md` step 3 verifies this from the GNS logs on Arbitrum rather than from the
  Studio UI). The MCP composition path is operational — `scripts/reserve-advisor.mjs` runs
  against it end to end. What the index *holds* is the honest part: as of block 51,208,917,
  **nine auctions, eleven commits, nine reveals, eight settlements and one fill**.
  Everything but the first of those landed on 2026-09-12. The index is still small, and
  every figure drawn from it says so.

  **`scripts/verify-run.mjs` reports 8 passed, 0 failed, 0 not applicable.** Every check it
  knows how to make now has something real to make it against — including `BONDS`, which
  read "n/a" for the life of the project until a round was opened with a bond on
  2026-09-12 and the bond was committed, revealed against and reclaimed.

  Those rounds are where three independent implementations of the clearing rule met real
  data and agreed. The subgraph's own replay reports `settlementMatchesDerivation: true` on
  both settled auctions; `scripts/verify-run.mjs`, which re-derives the outcome from the raw
  reveals without importing any of the three, reports `REPLAY` pass against what `settle()`
  emitted; and `web/lib/reserve-window.ts` agrees with that replay on competition class,
  thinness and winner margin.

  The two settled rounds are deliberately different, and the contrast is the point.
  `0x50d52b02…` had one bidder — the disclosed house bid — and a second-price auction with
  one bidder clears at the reserve by definition: `bestBps` 168, `secondBps` 0, cleared at
  50, `competition: SOLE`, `thin: true`. `0x58296d32…` had two, and cleared at the
  **runner-up's 250 rather than the winner's 400**: `competition: CONTESTED`, `thin: false`,
  `reserveBound: false`. `verify-run`'s `PRICE_SET_BY` check names both — "1 of 2 settled
  auctions cleared at the RUNNER-UP's bid, 1 cleared at the reserve" — rather than reporting
  only the flattering one. The board still reads the chain directly, which
  is the right long-run source for a ticking card (polling an indexer every 12 s is 7,200
  queries/day/tab against a 3,000/day cap), so the subgraph's derived history is not what you
  see live.
- **The settlement replay runs off chain.** `settlementMatchesDerivation`
  (`subgraph/src/book.ts:503-506`, and `scripts/make-snapshot.mjs:168`) re-derives the
  contract's own top-2 rule from the raw reveals and compares it against what `settle()`
  emitted — a check, never an echo. The direct-chain reader cannot do this and reports `null`
  rather than `false` (`web/lib/chain.js:207-209`): *not checked* and *checked and disagreed*
  are very different claims.
- **Messari conformance is not claimed.** Its generic schema wants non-null USD TVL and revenue
  fields an auction book does not have and that we would have to fabricate.
- **A real asymmetry, and it is ours.** Bidders post bonds; the maker posts nothing. A maker
  can open an auction against an order they never ship. The contract already refuses to mark a
  winner forfeited without positive evidence someone else filled (`GlasshouseBook.sol:262-277`)
  precisely because it cannot distinguish a no-show from a misconfigured hook. A maker-side
  bond is the fix, and it is v2: the Book has no upgrade path by design, so it means a new
  deployment.

## Why not an AVS / restaking?

Because there is nothing here to secure. An off-chain auction committed by a signed operator
quorum is an *unverifiable assertion*, and assertions need economic backing plus a challenge
window — that design is correct for problems forced by latency. LVR is per-block, and a
commit-reveal auction cannot resolve inside one block, so those auctions *must* run off chain.

Taker priority on a resting order is not per-block. Glasshouse can afford 150 seconds, and for
that price the winner is computed **on chain** from revealed bids: `outcome()` is a view
function over state written permissionlessly by `commit` and `reveal`, with no owner, no admin
and no upgrade path. **Nobody makes a claim, so there is no claim to challenge.** Adding an AVS
would mean introducing a trusted party in order to then buy machinery to constrain it.

The general rule: verify on chain when you can afford the latency; secure economically off
chain when you cannot. Where defection *is* possible we already use capital at risk —
`claimForfeit` (`:306`), `claimUnrevealed` (`:329`), `claimBond` (`:284`).

Two things a challenge window does not give you. It is a **liveness assumption**: someone must
be watching and willing to pay gas, and an unchallenged bad commitment simply stands. And it
has a **deadline** — miss it and the bad commitment is final forever. Our replay is a pure
function of permanent public data, so anyone can recompute it at any time, indefinitely.

## Run it locally

Requires **Node ≥ 22.13.0** (Hardhat 3) and [Foundry](https://getfoundry.sh).

```bash
npm install
forge test                    # 97 tests; the fork suites need internet
npm run test:js               # 50 tests
node scripts/size-check.mjs   # EIP-170 guard, runs on every build
```

**The live board, against a local fork of Base** — three terminals:

```bash
# 1. a fork of Base at the same chain id, so every address resolves to the real contract
anvil --fork-url https://mainnet.base.org --chain-id 8453

# 2. the keeper, opening rounds and bidding as the house.
#    DRY_RUN=1 refuses to run unless the node reports anvil/hardhat.
DRY_RUN=1 BASE_RPC_URL=http://127.0.0.1:8545 \
  npx hardhat run scripts/keeper.ts --network baseFork

# 3. the board, pointed at the fork
cd web && npm install && npm run dev
#    then open  http://localhost:3000/?rpc=http://127.0.0.1:8545
```

The board detects a localhost RPC and says so in an amber banner: *real contracts and real
state, but the money is not real.* On PowerShell the `VAR=x cmd` prefix is a parse error — set
`$env:DRY_RUN="1"` and `$env:BASE_RPC_URL="http://127.0.0.1:8545"` first.

Deployment to mainnet is [`DEPLOY.md`](./DEPLOY.md).

## Tracks

| Track | What we submit |
|---|---|
| **1inch** | Opcode `0x2e` on a redeployed `AquaSwapVMRouter` against the official Aqua, with a fill demonstrated on a fork (`test/fork/AquaBaseFork.t.sol`) — both explicitly permitted by the requirements. No 1inch source vendored. |
| **The Graph** | `subgraph/` over `GlasshouseBook`: all eight events, plus the independent settlement replay. **Published to The Graph Network** (`FPQdiZTAnR8ac6grgAF2x49bWqwDh87RzqUgQxAvoY2y`) and served by an allocated indexer, so the Subgraph MCP composition path is live: `scripts/reserve-advisor.mjs` and `.claude/skills/glasshouse-auction` are two consumers of it. The index is nearly empty (see above). |
| **Uniswap** | `scripts/uniswap-benchmark.mjs` quotes the deployed v3 `QuoterV2` on Base as an *external* anchor for the price-improvement claim, which is otherwise measured only against SwapVM's own instructions. `scripts/get-usdc.ts` buys the maker's fill inventory through `SwapRouter02`. [`FEEDBACK.md`](./FEEDBACK.md) is the developer feedback, including a real struct-incompatibility bug we hit between `SwapRouter` and `SwapRouter02`. |

## Documentation

**Start here:** [`DECISIONS.md`](./DECISIONS.md) — every judgment call, in order, in plain
language. Then [`docs/design/HLD.md`](./docs/design/HLD.md) — components, trust boundaries,
lifecycle flows.

Also: [`LLD.md`](./docs/design/LLD.md) — storage layout, encoding, error and event
catalogues · [`subgraph-design.md`](./docs/design/subgraph-design.md) — the schema, the
settlement replay, and what it refuses to compute ·
[`window-sizing.md`](./docs/design/window-sizing.md) — where the auction windows came from ·
[`CHANGELOG.md`](./CHANGELOG.md) · index at [`docs/`](./docs/README.md).

The raw planning log and the superseded UI design chain are in
[`docs/archive/`](./docs/archive/README.md), kept because the event rules require planning
artifacts to ship. Nothing in there describes what shipped.

## Licence and AI disclosure

Glasshouse's own code is MIT. **1inch Aqua and SwapVM are consumed as npm dependencies and are
never vendored** — they are published under `LicenseRef-Degensoft-*-Source-1.1`, which is
source-available, not open source. Nothing under `node_modules/@1inch/` is copied, modified or
redistributed here; `src/` extends it by inheritance only.

Per ETHGlobal rules, AI assistance is documented in [`AI-DISCLOSURE.md`](./AI-DISCLOSURE.md).
