# Changelog

All notable changes to Glasshouse are recorded here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Because this is an ETHOnline 2026 submission built inside the event window, releases are
cut at the project's own milestones rather than on a calendar. The decision record behind
each one is in [`run.md`](./run.md).

## [Unreleased]

### Planned
- Base mainnet deployment of `GlasshouseBook` and `GlasshouseRouter`
- Messari-conformant subgraph over the Base deployment, read through the Subgraph MCP
- Explanation page and comparison UI

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

[Unreleased]: https://github.com/IIITManjeet/Glasshouse/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/IIITManjeet/Glasshouse/releases/tag/v0.2.0
[0.1.0]: https://github.com/IIITManjeet/Glasshouse/releases/tag/v0.1.0
