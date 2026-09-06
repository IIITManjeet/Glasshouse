# Changelog

All notable changes to Glasshouse are recorded here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Because this is an ETHOnline 2026 submission built inside the event window, releases are
cut at the project's own milestones rather than on a calendar. The decision record behind
each one is in [`run.md`](./run.md).

## [Unreleased]

### Planned
- Base mainnet deployment of `GlasshouseBook` and `GlasshouseRouter` (module and preflight
  are ready; needs ETH and a deployer address)
- Subgraph over the Base deployment, published to The Graph Network and read through the
  Subgraph MCP. Messari conformance is deliberately not claimed: its generic schema wants
  non-null USD TVL and revenue fields an auction book does not have.
- Explanation page and comparison UI

---

## [0.5.0] - 2026-09-07

Live on Base mainnet.

### Deployed
| Contract | Address | Size |
|---|---|---|
| `GlasshouseBook` | `0xc4ea91Fe700918220423ac307C6B1c59650FFbfe` | 6,149 B |
| `GlasshouseRouter` | `0x5c3baE054e8b4915a13726B397b1AeA864247DBf` | 21,108 B |

Cost 0.000037 ETH against 0.000039 estimated. Both sizes match the local artifacts, and
the router is 3,468 B under EIP-170.

### Added
- `test/invariants/GlasshouseInvariants.t.sol` - upstream's own `CoreInvariants` harness
  applied to opcode 0x2e in every auction phase. Nothing fills during bidding, not even
  for the eventual winner; symmetry, additivity, monotonicity and rounding all survive the
  improvement inside the window; and afterwards the order prices as though no auction were
  attached.
- `test/fork/AquaBaseFork.t.sol` - a real fill through the official Aqua on forked Base:
  0.01 WETH in, 38.986354 USDC out, gated by 0x2e and priced at the second bid. This is
  the 1inch track's on-chain-execution requirement, which permits local forks.
- `site/index.html` - the explanation page. Single static file, no build step.
- `DECISIONS.md` - every judgment call in order, written to be spoken from.
- `scripts/check-key.mjs` - verifies a deployer key without revealing it.

### Fixed
- `BASE_RPC_URL` now defaults to the public endpoint in both `hardhat.config.ts` and
  preflight. Requiring it meant the deploy command needed an inline env assignment, which
  is bash syntax and a parse error in PowerShell.

### Learned
- `AquaOpcodes` has no `LimitSwap`, so the deployed router prices with `XYCSwap`, where
  scaling `balanceIn` by (1 + b) moves the price by *approximately* b rather than exactly
  b. Measured 243 bps against a nominal 250. The exact result holds only for `LimitSwap`.
- Aqua mode requires `useTransferFromAndAquaPush`, or the router's post-push balance check
  reverts.

---

## [0.4.0] - 2026-09-05

Parameters stop being guesses.

### Added
- `scripts/simulate-window.mjs` - Monte Carlo sizing of the exclusive window, seeded and
  dependency-free. The window is a free American call granted to the winner, so a longer
  one raises bids and simultaneously lets the winner exercise only when the market has
  moved against the maker. On a volatile pair, 2s to 300s raises the clearing price from
  79 to 124 bps while the maker's net falls from 75.7 to 67.2. Analysis in
  `docs/design/window-sizing.md`.
- `test/ReserveMatrix.t.sol` - sweeps reserve against bidder count, including the
  degenerate cases the suite had no coverage for: zero bidders must leave no winner and
  open the order immediately, and one bidder means the reserve is the price.
- `GlasshouseBook.commitmentFor(bidder, bps, salt)` - hand-packing the commitment wrong
  produces one that can never be revealed, and since the bond escrows at commit that loses
  it. Fuzzed against the packing `reveal()` checks.
- `config/auction.json`, and a two-run deployment plan in `DEPLOY.md`.

### Changed
- `exclusiveBlocks = 15` (30s), from the simulation rather than by choice.
- `reserveBps = 50`, derived: the mid moves ~44 bps over the 150s lockup at 200% annual
  volatility, and a reserve below the staleness cost makes running the auction worse than
  posting a limit order.

### Verified
- 82 tests. `GlasshouseBook` 6,149 B, `GlasshouseRouter` 21,108 B.

---

## [0.3.0] - 2026-09-05

Two defects in the bond mechanism, both found while writing the LLD, both fixed before
deployment because `GlasshouseBook` has no upgrade path.

### Fixed
- **Bond theft.** `filledBy` is written only by `postTransferIn`, which fires only if the
  maker's *signed order* sets the post-transfer-in hook at this Book and `a.router` is
  the router that filled. The Book never sees the order and cannot check either
  condition, so a maker who omitted the hook or named the wrong router guaranteed
  `filledBy == address(0)` - and the old rule read that as a no-show. Every honest winner
  forfeited and the maker collected: the winner paid the improved price and lost the bond
  as well. Forfeiture now requires positive evidence that someone else filled.
- **Free silence.** The bond escrowed at `reveal()`, so refusing to reveal cost nothing -
  and refusing to reveal is the cheapest attack on a second-price auction, since a
  runner-up who stays silent drops the clearing price to the reserve and hands the winner
  a near-free fill. The bond is now taken at `commit()`.

### Added
- `claimUnrevealed(orderHash, bidder)` - forfeits the bond of a bidder who committed and
  never revealed. Unlike `claimForfeit` this needs no hook and no trust in the maker's
  configuration: whether a commitment was revealed is something the Book observed.
- `UnrevealedForfeited` event.
- Ignition deployment module, `scripts/preflight.mjs`, and `DEPLOY.md`.
- `docs/design/HLD.md` (790 lines) and `docs/design/LLD.md` (1,436 lines).

### Changed
- **Breaking:** `Auction.second` removed. Which address held the runner-up price is
  reveal-order dependent on ties, and exposing an order-dependent value would contradict
  the property the mechanism is built on. `secondBps` is order-independent and is what
  the clearing rule reads.
- Source comments trimmed from 877 to 567 lines with no behaviour change.
- `AI-DISCLOSURE.md` now names specific files, as the event rules require.

### Verified
- Aqua is live on Base at `0x1111113ccf1426a8e30e2bff5e005d929bf6a90a` (5,619 B), and the
  official `AquaSwapVMRouter` at `0x111111338c5091e8440b67b168bae16a668ac0de` (20,541 B).
  Both were assumptions carried from research notes until now. Note the deployed router is
  165 B larger than a local compile of the same contract.
- 72 tests. `GlasshouseBook` 5,936 B, `GlasshouseRouter` 21,108 B.

---

## [0.2.0] - 2026-09-05

The argument is demonstrated rather than asserted. G1 in the roadmap.

### Added
- `test/Comparison.t.sol` - one order, one latency-differentiated bidder set, three
  allocation rules. Identical balances and swap curve in all three programs, so the only
  variable is how taker priority is decided.

  | gate | winner values | maker gives up (bps of base) |
  |---|---|---|
  | identity `WhitelistSequential` 0x2d | 100 bps | 10000 |
  | clock `DutchAuctionBalanceIn` 0x94 | 100 bps | 10618 |
  | **bid `GlasshouseAuction` 0x2e** | **400 bps** | **9756** |

  Identity excludes the highest valuation outright, as a revert rather than a worse
  price, and pays the maker nothing for the privilege. The clock gives every bidder in a
  block an identical price, so valuation cannot break the tie and the fastest participant
  takes it; a 256-run fuzz confirms that holds across the auction's whole duration and
  that the clock never returns more to the maker than the base price. Only the bid gate
  allocates to the highest valuation, and the improvement it delivers is exactly the
  second-highest bid.
- `docs/design/HLD.md` and `docs/design/LLD.md`
- `CHANGELOG.md`, `docs/README.md`, and release tagging

### Changed
- `GlasshouseTestRouter` moved to `test/helpers/` so both suites share one harness

### Fixed
- README build instructions named `forge test`; the suite runs under
  `npx hardhat test solidity`

---

## [0.1.0] - 2026-09-05

First working version: the mechanism executes inside a real SwapVM program, and the
invariant the design rests on is demonstrated rather than argued.

### Added
- `GlasshouseAuction` instruction at opcode `0x2e`, the free slot immediately after
  `WhitelistSequential` (0x2d) in the conditions and access-guards bank. No upstream file
  is modified or vendored.
- `GlasshouseAuctionLib` - the mechanism as a `view`-only library, wrapped by the opcode
  and reusable by an `Extruction` target.
- `GlasshouseBook` - sealed-bid, second-price auction book. The only stateful contract,
  and it has no owner, no upgrade path and no admin.
- `GlasshouseRouter` - `AquaSwapVMRouter` plus the auction gate and a re-added
  `WhitelistSequential`. 21,108 bytes, 3,468 under the EIP-170 limit.
- `GlasshouseTestRouter` - the full upstream opcode set plus `0x2e`. Never deployed; it
  exists because the test EVM does not enforce EIP-170, which is what allows the
  three-way comparison to run in one router.
- `scripts/size-check.mjs` - fails the build above 24,576 bytes. solc reports that
  overflow as a warning, not an error, so without this it surfaces when a deploy reverts.
- 57 tests: instruction encoding with a 256-run fuzz, the Book's full lifecycle, and
  execution inside a real SwapVM program.
- `README.md`, `DESIGN.md`, `AI-DISCLOSURE.md`, and the `run.md` decision log.

### Fixed
- The Book's O(1) top-2 dropped a legitimate winner. A maker may set `reserveBps = 0`,
  which makes `bps = 0` a valid bid; on an empty book that satisfied neither
  `bps > bestBps` nor `bps > secondBps`, so the only revealed bidder silently failed to
  win and the auction closed with no winner at all.
- `open()` accepted `exclusiveBlocks = 0`, which reintroduces the flaw the exclusive
  window exists to prevent: with no window an outsider fills at the base price in the
  same block the winner would fill at the improved one, so bidding is strictly dominated
  by not bidding.

### Verified
- `quote() == swap()` for the same order, taker and block, with transferred balances
  matching the quote. The instruction is `view`, so the two contexts cannot diverge.
- Fills record through `IMakerHooks.postTransferIn`, which `swap()` calls and `quote()`
  does not - the instruction itself cannot emit, since `LOG` reverts under `STATICCALL`.

[Unreleased]: https://github.com/IIITManjeet/Glasshouse/compare/v0.5.0...HEAD
[0.5.0]: https://github.com/IIITManjeet/Glasshouse/releases/tag/v0.5.0
[0.4.0]: https://github.com/IIITManjeet/Glasshouse/releases/tag/v0.4.0
[0.3.0]: https://github.com/IIITManjeet/Glasshouse/releases/tag/v0.3.0
[0.2.0]: https://github.com/IIITManjeet/Glasshouse/releases/tag/v0.2.0
[0.1.0]: https://github.com/IIITManjeet/Glasshouse/releases/tag/v0.1.0
