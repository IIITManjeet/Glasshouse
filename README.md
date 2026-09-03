# Glasshouse

**Taker priority allocated by sealed competitive bid — not by identity, not by clock.**

A custom SwapVM instruction for [1inch Aqua](https://github.com/1inch/aqua) /
[SwapVM](https://github.com/1inch/swap-vm), built for ETHOnline 2026.

---

## The problem

SwapVM already ships two ways to decide *who is allowed to fill an order*, and neither
of them allocates by what the fill is actually worth:

**By identity — `WhitelistSequential` (opcode `0x2d`).** A hardcoded ladder of
privileged takers, each with an exclusive time window. Read the upstream source
(`src/instructions/Whitelist.sol`): an unlisted taker does not merely lose priority, it
hits `require(timeLeft >= duration)` and **reverts** until the entire cumulative ladder
has elapsed. It is a cartel ladder written into the order.

**By clock — `DutchAuctionBalanceIn` / `Out` (opcodes `0x94` / `0x95`).** The price is a
pure function of `block.timestamp`:

```solidity
uint256 elapsed = block.timestamp - start;
ctx.swap.balanceIn = ctx.swap.balanceIn * uint256(decay).pow(elapsed, ONE) / ONE;
```

Every transaction in a block shares one timestamp, so **every bidder in that block faces
an identical price**. Valuation cannot break the tie. Allocation is decided purely by
intra-block transaction ordering — by priority fee and builder placement. The surplus
above the posted price is competed away into **priority fees paid to the builder**,
not returned to the maker or the user. The descending clock does not price the order;
it runs a latency auction whose proceeds leak out of the protocol.

This is not a theoretical complaint about auction design. It is what the two shipped
instructions do, and you can read it in ~40 lines of upstream Solidity.

## What Glasshouse adds

One instruction — **`Opcode._2e`**, the free slot immediately after
`WhitelistSequential` in the *Conditions & access guards* bank — that gates the fill on
a **sealed-bid, second-price (Vickrey) auction with a committed close**.

- The highest bidder wins, and pays `max(reserve, secondHighest)`.
- The winning bid is expressed as a **price improvement in basis points** applied to
  `balanceIn`, so ordinary SwapVM settlement delivers the surplus to the maker. No
  transfer, no custody, no fee router.
- The winner gets an **exclusive fill window**; afterwards the order opens at base price
  to anyone.
- Sealed rather than open, for a reason that survives Q&A: **shill resistance**. An open
  second-price auction lets the maker insert a bid just under the top.

### Why this is not "a Dutch auction in disguise"

Dutch auctions are strategically equivalent to first-price sealed-bid auctions — in a
*frictionless* model. On-chain, that equivalence breaks at two points, both visible in
the source above: `block.timestamp` is quantised to the block, and ordering inside the
block is sold to the highest priority fee. So the descending clock systematically awards
to the **lowest-latency** participant regardless of valuation. Glasshouse fixes the
allocation rule and the surplus recipient. That difference *is* the extractable value,
and it is measurable — which is what the comparison test demonstrates.

## Architecture

Three phases, disjoint in block space. This split exists to satisfy a hard SwapVM
constraint: `quote()` and `swap()` execute the same program in different static
contexts, so **an instruction that mutates state makes quote and swap diverge**.

| Phase | Where | Writes state? |
|---|---|---|
| Commit + reveal bids | `GlasshouseBook`, its own transactions | yes |
| Fill gate | `GlasshouseAuction` instruction, inside the VM | **no** — `STATICCALL` to `outcome()` only |
| Bond settlement | keeper transaction | yes |

`GlasshouseBook` has **no owner, no upgrade path, no admin**. Auction parameters are
immutable after `open()`. The answer to *"who can change what `outcome()` returns?"* is
*nobody*, which is what makes the quote/swap consistency argument airtight.

```
src/interfaces/IGlasshouseBook.sol    Outcome / AuctionStatus
src/lib/GlasshouseAuctionLib.sol      the mechanism, pure + view only
src/book/GlasshouseBook.sol           sealed-bid second-price book (the only stateful contract)
src/instructions/GlasshouseAuction.sol  opcode 0x2e
src/routers/GlasshouseRouter.sol      AquaSwapVMRouter + our opcode
scripts/size-check.mjs                EIP-170 guard, runs on every build
```

Full design rationale: [`ARCHITECTURE.md`](./ARCHITECTURE.md).
Research dossier and decision log: [`run.md`](./run.md).
UI and product design: [`DESIGN.md`](./DESIGN.md).

### The EIP-170 constraint that shapes everything

`SwapVMRouter` with the full opcode set compiles to **29,159 bytes** and cannot be
deployed — solc reports this as a *warning*, not an error, so it surfaces only when a
deploy reverts. `AquaSwapVMRouter` ships 16 opcodes because it has to, not by curation.
Glasshouse builds from `AquaSwapVMRouter` and lives in its ~4,200 bytes of headroom:

| Contract | Size | Headroom |
|---|---|---|
| `AquaSwapVMRouter` (upstream) | 20,376 | 4,200 |
| **`GlasshouseRouter`** | **21,108** | **3,468** |

Our opcode *plus* re-adding `WhitelistSequential` — which the deployed Aqua router omits,
and which the headline comparison needs — costs **732 bytes**. `scripts/size-check.mjs`
fails the build above 24,576.

## Extension pattern

Opcode sets in swap-vm HEAD are an `if`/`else` chain in
`_runOpcode(Context memory, uint256, bytes calldata) internal virtual`. Extension means
**overriding `_runOpcode`, handling the new opcode, and delegating the rest to `super`**
— exactly what upstream's own `AquaOpcodesDebug` does. Slot numbering comes from the
`Opcode` enum, whose 256 members are all already defined upstream, so **no 1inch file is
modified or vendored.**

> Note for anyone extending swap-vm from an older tutorial: the `_opcodes()` array API
> that earlier projects overrode **no longer exists at HEAD**.

## Build

Requires **Node ≥ 22.13.0** (Hardhat 3) and [Foundry](https://getfoundry.sh).

```bash
npm install
npx hardhat compile     # ~14s incremental
forge test              # instruction + encoding tests
node scripts/size-check.mjs
```

## Licence

Glasshouse's own code is MIT. **1inch Aqua and SwapVM are consumed as dependencies and
are not vendored into this repository** — they are published under
`LicenseRef-Degensoft-*-Source-1.1`, which is source-available, not open source.

## AI disclosure

Per ETHGlobal rules, AI assistance is documented in [`AI-DISCLOSURE.md`](./AI-DISCLOSURE.md).
