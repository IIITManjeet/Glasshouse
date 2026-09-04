# Changelog

All notable changes to Glasshouse are recorded here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Because this is an ETHOnline 2026 submission built inside the event window, releases are
cut at the project's own milestones rather than on a calendar. The decision record behind
each one is in [`run.md`](./run.md).

## [Unreleased]

### Planned
- `ComparisonTest.t.sol` - one order under `WhitelistSequential` (0x2d),
  `DutchAuctionBalanceIn` (0x94) and Glasshouse (0x2e)
- Base mainnet deployment of `GlasshouseBook` and `GlasshouseRouter`
- Messari-conformant subgraph over the Base deployment, read through the Subgraph MCP
- Explanation page and comparison UI

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

[Unreleased]: https://github.com/IIITManjeet/Glasshouse/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/IIITManjeet/Glasshouse/releases/tag/v0.1.0
