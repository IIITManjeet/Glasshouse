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

## 5. Auction parameters

Canonical set in [`config/auction.json`](./config/auction.json). None of these are guesses:

| Parameter | Value | Why |
|---|---|---|
| `commitBlocks` | 30 (60 s) | Total lockup budget of 150 s, against the 300 s ladder we attack |
| `revealBlocks` | 30 (60 s) | Same budget. Must be generous: the bond escrows at commit, so a bidder who misses the reveal forfeits it |
| `exclusiveBlocks` | 15 (30 s) | Simulated, see [`docs/design/window-sizing.md`](./docs/design/window-sizing.md). The window is a free option; the long end costs the maker and the short end is indifferent, so 30 s is what a human winner needs to sign |
| `reserveBps` | 50 | Covers the 44 bps of staleness risk the maker carries over the lockup on a volatile pair. Below that, running the auction is worse than posting a limit order |
| `maxBps` | 500 | The cap the maker signs. 10x the reserve leaves room for real competition |
| `bond` | `>= maxBps * notional / 10000` | Makes a winner no-show unprofitable |

## 6. Two live runs, in this order

**Run A - bonded, our own accounts.** Proves the parts that involve money changing hands:
`claimForfeit` after an evidenced no-show, and `claimUnrevealed` after a withheld reveal.
Use the `advocated` windows and a non-zero bond. Nobody outside the team can lose funds.

**Run B - unbonded, invited bidders.** The headline auction, with `bond = 0` and the
`humanDemo` windows. No approvals to sign, and nobody can lose money by being slow with a
wallet. State on the page that the advocated configuration is the shorter one.

For each run:

1. Ship a small strategy through the real Aqua, with `GlasshouseAuction(book, maxBps)`
   before the swap curve.
2. Open the auction from the maker:

   ```bash
   cast send $BOOK "open(bytes32,address,address,uint40,uint40,uint40,uint24,uint24,uint128)" $ORDER_HASH $ROUTER $TOKEN_IN 30 30 15 50 500 $BOND --rpc-url $BASE_RPC_URL --private-key $MAKER_KEY
   ```

3. Each bidder takes their commitment **from the contract**, never by hand-packing it. A
   wrongly packed commitment can never be revealed, and with a bond posted that loses it:

   ```bash
   COMMITMENT=$(cast call $BOOK "commitmentFor(address,uint24,bytes32)(bytes32)" $BIDDER $BPS $SALT --rpc-url $BASE_RPC_URL)
   cast send $BOOK "commit(address,bytes32,bytes32)" $MAKER $ORDER_HASH $COMMITMENT --rpc-url $BASE_RPC_URL --private-key $BIDDER_KEY
   ```

   With a bond, approve `tokenIn` to the Book first - `commit` pulls it.

4. After `commitEnd`, each bidder reveals with the same `bps` and `salt`:

   ```bash
   cast send $BOOK "reveal(address,bytes32,uint24,bytes32)" $MAKER $ORDER_HASH $BPS $SALT --rpc-url $BASE_RPC_URL --private-key $BIDDER_KEY
   ```

5. After `revealEnd`, read the result and fill as the winner:

   ```bash
   cast call $BOOK "outcome(address,bytes32)((uint8,address,uint24,uint40))" $MAKER $ORDER_HASH --rpc-url $BASE_RPC_URL
   ```

6. After the exclusive window, `settle`, then `claimBond` per bidder, and
   `claimForfeit` / `claimUnrevealed` where they apply.

Use dust amounts. The point is real events at a real address, not volume.

## 7. The keeper

Keeps a live round on the board. It opens each round from `config/rounds.json` in order,
places one house bid at index 0, reveals it, settles, and moves on.

```bash
# Rehearse first, on a fork. Never the first thing you point at mainnet.
DRY_RUN=1 BASE_RPC_URL=http://127.0.0.1:8545 npx hardhat run scripts/keeper.ts --network baseFork

# Then a bounded live session, and watch the board before going further.
KEEPER_MAX_ROUNDS=3 npx hardhat run scripts/keeper.ts --network base

# Paced, for the days after: one round roughly every 20 minutes.
KEEPER_PAUSE_BLOCKS=600 npx hardhat run scripts/keeper.ts --network base
```

| Variable | Default | What it does |
|---|---|---|
| `KEEPER_MAX_ROUNDS` | all remaining | Stop after N rounds. Use it for the first live run. |
| `KEEPER_PAUSE_BLOCKS` | `0` | Blocks to wait between rounds. `0` runs them back to back. |
| `DRY_RUN` | unset | Refuses to run unless the node reports itself as a fork. |

**`KEEPER_PAUSE_BLOCKS` exists because unpaced is wrong for anything but a live demo.**
A round is ~135 blocks, so 300 rounds back to back exhaust the table in about 22 hours —
start it on Friday and the board is dead by Sunday. At 2 s/block, `600` gives a round
every ~20 minutes and stretches the table over about five days.

**Check `.keeper-state.json` before a mainnet run.** It is gitignored and records
`nextRound`, so a file left behind by a fork rehearsal makes the keeper skip ahead. That
matters more than it sounds: `newestOpenedRound()` in `web/lib/chain.js` tests round 0 and
gives up if it is not open, so a keeper starting at round 4 leaves the board showing the
cold snapshot **permanently** while burning real rounds. Delete the file to start at 0.

**Do not let the machine sleep.** The keeper resumes from state on restart, but a reveal
window missed while it was asleep leaves a sealed house bid that never opens — the exact
behaviour the mechanism exists to punish, displayed on the board.

---

## Rollback

There is none, by design. `GlasshouseBook` has no owner, no admin and no upgrade path -
that is what makes the "nobody can change what `outcome()` returns" claim true. A mistake
means deploying a new Book and pointing new programs at it; existing auctions on the old
Book continue to resolve exactly as they were going to.
