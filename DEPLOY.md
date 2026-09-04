# Deploying Glasshouse

Target: **Base mainnet (chain 8453)**. That is where the real Aqua lives, and there is
no public Aqua testnet, so a testnet deployment cannot exercise the Aqua path at all.
Base gas is cents, and a live address is what the subgraph and the demo both need.

Base Sepolia (84532) is available as a fallback in **signature mode** - `useAquaInsteadOfSignature`
is a MakerTraits bit handled in SwapVM core rather than an opcode, so the router runs
with no Aqua at all. That fallback cannot satisfy The Graph's live-data rule against real
Aqua activity, so it is a fallback and not the plan.

## 0. Before anything

Hardhat 3 does **not** auto-load `.env`. Provide configuration variables as environment
variables of the same name, or through the encrypted keystore:

```bash
npx hardhat keystore set BASE_RPC_URL
npx hardhat keystore set DEPLOYER_PRIVATE_KEY
npx hardhat keystore set ETHERSCAN_API_KEY
```

Then set the deployer address as `owner` in `ignition/parameters/chain-8453.json`. It is
the zero address on purpose, so that preflight fails rather than deploying a router whose
`rescueFunds` nobody can call.

> `owner` governs `rescueFunds` only. The router holds no user balances in normal
> operation - Aqua keeps maker tokens in the maker's own wallet - so this is a recovery
> path for stuck tokens, not custody. `GlasshouseBook` has no owner at all.

## 1. Build and check

```bash
npm run build          # ~7 min cold, ~14 s warm; viaIR is on
npm run size           # EIP-170 guard
npx hardhat test solidity
```

## 2. Preflight

```bash
node scripts/preflight.mjs 8453
```

This verifies the RPC is actually on the chain you think it is, that `owner` is set and
funded, that WETH has code, and **that the Aqua address in the parameter file has code on
Base**. That last one matters: the Aqua address is a deterministic address carried from
research notes, not something the npm package ships. A router pointed at an address with
no code would deploy successfully, cost real gas, and fail later when a swap tried to
source balances.

Do not proceed if anything says FAIL.

## 3. Deploy

```bash
npx hardhat ignition deploy ignition/modules/Glasshouse.ts \
  --network base \
  --parameters ignition/parameters/chain-8453.json
```

Deploys `GlasshouseBook` and `GlasshouseRouter`. There is no ordering constraint between
them: a maker's program references the Book by address, and the router does not know
about it.

Record both addresses in `run.md` immediately. The subgraph, the UI and the demo all key
off them.

## 4. Verify

```bash
npx hardhat verify --network base <router> \
  <aqua> <weth> <owner> "GlasshouseRouter" "1.0.0"
npx hardhat verify --network base <book>
```

Verified source is not optional here. The whole argument is that anyone can read what the
gate does; an unverified contract undercuts it.

## 5. First live auction

1. Ship a small strategy through the real Aqua, with a program of
   `GlasshouseAuction(book, maxBps)` before the swap curve.
2. `book.open(orderHash, router, tokenIn, ...)` from the maker.
3. Two or three bidders `commit`, then `reveal` after `commitEnd`.
4. The winner fills inside the exclusive window.
5. `settle`, then bond claims.

Use dust amounts. The point is real events at a real address, not volume.

## Rollback

There is none, by design. `GlasshouseBook` has no owner, no admin and no upgrade path -
that is what makes the "nobody can change what `outcome()` returns" claim true. A mistake
means deploying a new Book and pointing new programs at it; existing auctions on the old
Book continue to resolve exactly as they were going to.
