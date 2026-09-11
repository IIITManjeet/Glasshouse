# Changelog

All notable changes to Glasshouse are recorded here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Because this is an ETHOnline 2026 submission built inside the event window, releases are
cut at the project's own milestones rather than on a calendar. The decision record behind
each one is in [`run.md`](./docs/archive/run.md).

## [Unreleased]

### Added
- **The keeper's first mainnet round.** 2026-09-12, round 0 of `config/rounds.json`, one
  round only: approve, ship, open, commit, reveal, settle, dock, for 0.0000028 ETH of Base
  gas. Everything the project previously called "end to end" was demonstrated on an anvil
  fork of Base; this is the same lifecycle on the chain itself.

  `scripts/verify-run.mjs` moves from **3 passed / 2 failed / 3 n/a** to **6 / 1 / 1**.
  `REPLAY` is the one worth having: the settlement re-derived from the raw reveals matches
  what `settle()` emitted, winner and clearing price both, without importing the contract's
  rule, the subgraph's copy of it, or the page's. It had never run against mainnet.
  `PRICE_SET_BY` moves n/a → **FAIL**, which is the honest direction — there is now a
  settled auction with a winner, so the check can *run*, and it reports that the house was
  the only bidder and cleared at the reserve. That is a different claim from "nothing to run
  on" and the verifier should stop making the second one.

  The AssemblyScript mapping also ran on a real settlement for the first time and reports
  `settlementMatchesDerivation: true`, so three independent implementations of the clearing
  rule now agree on real data rather than on a fork.
- `scripts/wrap-weth.ts` — wraps the ETH that backs the keeper's declared depth, through the
  Hardhat keystore, so the mainnet deployer key is never pasted into a `cast --interactive`.
  `get-usdc.ts` wraps too, but wraps in order to swap the WETH away again and refuses below a
  0.002 ETH floor; both wrong for this.
- `test/js/chain-call-budget.test.js` — asserts how many RPC calls one poll of the board is
  allowed to cost, not just what it returns. First coverage of `web/lib/chain.js` beyond
  `decodeAuction`.

- **The second-price claim, on Base mainnet.** Order `0x58296d32…`, 2026-09-12, via
  `scripts/run-live-fill.ts`. Two bidders committed sealed; the winner revealed 400 bps and
  the rival 250; the auction cleared at **250 — the rival's bid, not the winner's** — and the
  winner filled inside the exclusive window for 0.00001 WETH in, 24,096 USDC out, the exact
  amounts `test/fork/LiveFillPreflight.t.sol` predicted. `fillPhase: EXCLUSIVE`,
  `fillByWinner: true`.

  `scripts/verify-run.mjs` now reads **7 passed / 0 failed / 1 n/a**. `PRICE_SET_BY` passes
  and reports both settled rounds rather than only the flattering one: "1 of 2 settled
  auctions cleared at the RUNNER-UP's bid, 1 cleared at the reserve." The subgraph agrees
  independently, with `settlementMatchesDerivation: true` on both.

  The one check still n/a is `BONDS`: every round so far runs with `bond = 0`, so
  `claimBond` / `claimForfeit` / `claimUnrevealed` remain unexercised, and the verifier says
  so rather than counting them as passing.
- `scripts/sweep-bidders.mjs` — returns the ephemeral bidders' unspent gas to the maker.
  `run-live-fill.ts` had always called those keys "sweepable if this run dies", but nothing
  could sweep them, so the word was an assertion rather than a capability. It matters on a
  successful run too: the bidders are deliberately over-funded so neither can run dry between
  commit and reveal, and 0.000296 ETH was left behind after the first live fill — more than
  the maker had remaining.

### Fixed
- **The live fill checked one leg of the depth it declares.** `ship` declares
  `[WETH, USDC] = [0.0008, 2.0]` to Aqua, and only the USDC side was checked for balance or
  approved. The maker held 0.0005 WETH, so the run would have funded two ephemeral bidders and
  only then reverted inside `ship` — the exact waste the order-virginity check twenty lines
  above exists to prevent, reached from the side it does not cover, and the same omission as
  the keeper's USDC-only approval fixed earlier. Both legs are now checked before anything is
  spent; the refusal prints the command that fixes it, so `wrap-weth.ts` gained a
  `WRAP_TARGET_WETH` override rather than a second hard-coded copy of a number that lives in
  `run-live-fill.ts`.
- **The deployed `/evidence` page was rate limited within an hour of mainnet having a round.**
  `newestOpenedRound` in `web/lib/chain.js` memoises the newest opened round so a poll costs
  one or two `eth_call`s instead of binary-searching all 300 — but the memo was guarded by
  `cursor > 0`, and the remembered cursor for a chain holding exactly one auction is `0`. The
  fast path never engaged, every poll paid the full ~10-call search, and `writeCursor(0)`
  stored a value that failed the same guard on the next tick, so the memo could never warm
  up. Ten calls every 12 s, from every visitor's IP, against Base's public endpoint.

  It was dormant for as long as mainnet was empty, because an unopened round 0 returns early
  after ONE call — the code was cheapest exactly while it was untested, and became expensive
  at the moment the thing it guards started working. Ten calls per poll before, three after.

### Planned
- `web/lib/bid.js` and `web/lib/chain.js` to TypeScript. `bid.js` is 1,400 lines of wallet
  and signing code with no test coverage and deserves its own pass.
- `site/index.html` as a real route rather than a hand-written file synced into `public/`.
  It is the last thing keeping two palettes, two font strategies and two provenance
  conventions alive at once.
- A bonded round. Every auction so far opens with `bond = 0`, so `claimBond`,
  `claimForfeit` and `claimUnrevealed` have never run on any chain and `BONDS` in
  `scripts/verify-run.mjs` is n/a rather than passing. It is the last contract surface with
  no live evidence.
- The keeper running continuously, so a visitor always finds a round accepting bids. It has
  run one round and stopped.
- The reserve panel reading the index rather than re-deriving. `web/lib/reserve-window.ts`
  is still a transliteration of `subgraph/src/helpers.ts`; the subgraph is published now, so
  the condition its header made deletion conditional on has arrived.
- The landing page and the evidence page teach the mechanism in two different visual
  vocabularies. `components/Mechanism.tsx` draws a three-panel commit/reveal/settle
  diagram; `components/Settlement.tsx` draws the shared basis-point scale with the price
  line. Same idea, learned twice. The settlement vocabulary should absorb the other, as a
  static worked example on the landing page.
- The 300 ms reveal animation from the design decision. Deliberately unbuilt for now: the
  chart renders a state from data rather than a transition between states, so animating it
  means tracking a previous render purely to have something to animate from.

## [0.7.0] - 2026-09-12

The session that made the product legible: an independent verifier, a navigable record,
controls that look like controls, and the mechanism drawn as one picture. Also the session
in which three findings were recorded from screenshots and all three withdrawn, which is
written down in `DESIGN.md` because the pattern cost more than any single bug.

### Added
- **A per-event timeline on the receipt** (`web/components/Timeline.tsx`), reading
  `AuctionEvent` and the full `Bid` ladder from the index. It recomputes nothing: the price
  after each reveal is `clearingBpsAfter`, which the mapping records at the moment that
  reveal is applied precisely so a UI need not become a fourth copy of the clearing rule.
  This is the one panel with no chain fallback, and it says so — an `eth_call` returns
  storage as it is now, never the order it became that way.
- **`scripts/verify-run.mjs`**, which re-derives every auction outcome from the raw logs
  without importing any of the three implementations of the clearing rule, then asks whether
  each agrees. It reports three states, not two: a check with nothing to run on is `n/a`
  with the reason, never a pass, because "6 of 8 passed" about a chain with zero reveals is
  the flattering answer and the useless one. Against a fork carrying a full keeper round and
  a live fill: 7 passed, 0 failed, 1 n/a. Against mainnet: 3 passed, 2 failed, 3 n/a.
- **`scripts/run-checks.mjs`** behind `npm test`, running all three suites instead of
  `&&`-chaining them. A red Solidity test used to hide both the JS tests and the provenance
  lint — the lint being the thing that checks every figure still names its source.

- **The subgraph is published to The Graph Network** (2026-09-11), subgraph id
  `FPQdiZTAnR8ac6grgAF2x49bWqwDh87RzqUgQxAvoY2y`, and an indexer allocated to it 117 blocks
  later, so it is served rather than merely listed. Verified by decoding the GNS logs on
  Arbitrum and matching the deployment hash in them to `Qmc9Ah…pK7E`, rather than by
  trusting the Studio UI. The method is written down in `subgraph/README.md` step 3.
- **The reserve advisor runs end to end**, which is the first time the composition claim is
  demonstrated rather than asserted: `scripts/reserve-advisor.mjs` connects to the Subgraph
  MCP, authenticates to the Gateway, fetches the schema, reads `_meta`, runs the reserve
  window query against the published subgraph and prints a recommendation from the same
  `recommendReserve()` the page uses.
- **The account record reads the indexer in production.** `NEXT_PUBLIC_SUBGRAPH_URL` points
  at the Studio endpoint, deliberately not the Gateway: the site is `output: "export"`, so
  that value is inlined into a public chunk, and a Gateway URL carries its API key in the
  path. `subgraph/README.md` now tabulates which of the three consumers may see which URL.

### Fixed
- **The page and the advisor recommended reserves from different windows** while
  `reserve-rule.ts` claimed they "can never quietly disagree". `reserveWindow()` filtered on
  `settled`; the advisor queries the design doc's Q3 (`revealEnd_lt: $head`,
  `subgraph-design.md` §7.2). `settled` is that property plus an unrelated event — somebody
  calling the permissionless `settle()` — so with a live keeper they would have disagreed on
  every round for the fifteen-plus blocks each spends past its reveal window and unsettled.
  On mainnet today the advisor said `n=1, NO_REVEALS` and the page said `n=0, NO_HISTORY`.
  The page now uses `revealEnd < head` and both say `n=1, 50 bps, NO_REVEALS`.
- **`npm test` was red where `forge test` was green.** Hardhat's Solidity runner does not
  read `foundry.toml`, so `GenerateRounds.t.sol` failed on a write permission that
  `fs_permissions` had already granted. `hardhat.config.ts` now grants it too, narrower: the
  one file, not the directory.
- **The snapshot generator had stopped working.** `mainnet.base.org` tightened its
  `eth_getLogs` cap from 10,000 blocks to 2,000; `make-snapshot.mjs` asked for 9,000 and
  failed the whole scan. Both it and the verifier now take the cap out of the error and
  continue at that size.
- **The fork rehearsal could consume the round it was rehearsing.** The keeper's
  `nextRound` cursor lived in one file for both mainnet and the fork, which run at the same
  chain id against the same Book address. `DRY_RUN=1` now keeps its own.
- **Eleven places still said the subgraph was unpublished**, four of them visible on the
  page and one the Graph track row in `README.md`. Corrected to what is now true, including
  why each consumer still reads the chain where it does.
- **`Profile.tsx` declared a provenance value that does not exist** (`UNLISTED`; the mapping
  emits `UNKNOWN`) — the same fault fixed in `subgraph.ts` earlier, harmless only until
  something subgraph-backed fed that component, which now exists.

- The advisor could not use the deployment id its own documentation gave you. Every file
  names the deployment as `Qmc9Ah…pK7E`, but the MCP's deployment tools take the 32-byte
  hash, and passing the documented value failed with `Schema not found in the response` --
  an error naming neither the id nor the expected format, and reading like the subgraph was
  unpublished when it was published and serving. `normalizeDeploymentId()` converts, so the
  id in the docs is the id that works.
- The advisor called auctions "settled" that the chain says are not. Its window query
  selects on `revealEnd_lt: head`, which is correct -- the derived clearing price freezes at
  `revealEnd` and does not wait for anyone to call the permissionless `settle()` -- but it
  printed "1 settled auction(s)" against a Book with zero settlements. The count was right
  and the noun was wrong.
- The account record labelled almost every visitor wrong. `web/lib/subgraph.ts` declared
  `Provenance` as `TEAM | INVITED | UNLISTED | OTHER`, but the mapping emits
  `TEAM | INVITED | UNKNOWN` (`subgraph/src/provenance.ts`). `UNKNOWN` is what an address
  not on our list gets -- which is nearly everyone, including every judge -- and with no
  entry for it the caption fell through to "unclassified", dropping the one sentence that
  makes the label honest: that it does not mean external and we do not know who it is. The
  union and the label table now match the only file that produces these values. Caught
  before the endpoint was wired, so it was never visible on the live site.

---

## [0.6.0] - 2026-09-10

The product. An indexer, a keeper that keeps a round on the board, and a front end that is
a thing you use rather than a page about a thing.

### Added
- **The subgraph** (`subgraph/`) over the Base deployment, with the settlement re-derived
  from the raw reveals and compared to what the contract emitted. That independent replay
  is why this design needs no operator set and no challenge window: there is no off-chain
  claim to challenge, and unlike a challenge period the check has no deadline.
- **The keeper** (`scripts/keeper.ts`) opens a fresh round continuously so a visitor
  arriving at any moment finds one accepting bids. It is also the house bidder, at
  commitIdx 0 of every round, and that is disclosed on the page rather than hidden -- a
  second-price auction with one bidder clears at the reserve and demonstrates nothing.
- **A live fill through the official Aqua**, rehearsed on a pinned Base fork before any
  real money moved (`scripts/run-live-fill.ts`, `test/fork/`).
- **The reserve advisor** (`web/lib/reserve-rule.ts`, `scripts/reserve-advisor.mjs`) -- one
  pure function, run by both the page and the offline tool, with its own limits printed
  next to its number. It is a heuristic splitting a known-safe value from a known-unsafe
  one, not an optimal reserve, and it says so.
- **The front end** rebuilt as Next.js + Tailwind, static-exported: wallet connect, sealed
  bidding, reveal, rounds, accounts, the receipt, the comparison, the latency lens, the
  leaderboard and the mechanism diagram.
- **A rehearsal** (`web/lib/simulate.ts`) that replays a full round lifecycle at one block
  per 0.4 s through the same components. The Book holds one auction with zero reveals, so
  without it the central claim -- the winner pays the runner-up's price -- was never
  visible on screen. Labelled as simulated by a source chip, an undismissable banner and
  every caption, and bidding is cut out entirely while it runs.
- **The provenance system made a property, not a habit.** Every figure carries a source tag
  and a "What produced this" caption, and `scripts/lint-provenance.mjs` fails the build if
  one does not -- across the essay and the exported app, with WCAG AA checked on both
  palettes.
- **The Uniswap benchmark** (`scripts/uniswap-benchmark.mjs`) quotes the same QuoterV2 to
  answer "what would this trade have got on Uniswap", including the case where Uniswap's
  quote is better, which at the live fill's real size it is. Plus `FEEDBACK.md`.

### Changed
- The front page is a landing page: a hero, the product working, one claim per band with a
  drawing beside it. The evidence moved to `/proof` and the argument to `/why`. Six
  full-width figures stacked in one column read as a wall, not a product.
- One typed source for the rules. `site/phase.js` and `site/reserve-rule.js` were
  byte-identical duplicates of the `web/lib` copies, and consumers had split across them --
  the advisor and two tests read one, the app read the other.

### Fixed
- The type system was named but never loaded: `globals.css` listed Newsreader and IBM Plex
  and nothing fetched them, so every visitor got Georgia, the system sans and Consolas.
  `tabular-nums` -- the reason a countdown does not shuffle the digits beside it -- was
  holding by accident of Consolas being fixed-width.
- The frontend crashed on first load and had no error boundary. Two data paths produced
  different fields; the dangerous half was a missing `maker`, which builds a commitment
  against the wrong auction key -- a bid that seals fine and can never be revealed.
- The essay linked to Basescan, to Google Fonts and to GitHub, and never once to the
  product it argues for.
- A swap that died on RPC replica lag, not on a bad transaction, and rate limiting from
  hammering a single public endpoint.

### Learned
- `SwapRouter02` on Base has a struct-incompatible `ExactInputSingleParams` -- no
  `deadline` field -- and copying the original `SwapRouter`'s struct is a silent ABI
  mismatch, because struct tuples are positional.
- `TransferHelper`'s two-character revert strings (`STF`) name the symptom and say nothing
  about the cause, which is expensive when the real fault is upstream RPC consistency.
- Node 22 strips TypeScript natively, so `.js` tests and a `.mjs` script can import `.ts`
  modules with no loader and no build step.
- `tsc --noEmit` does not catch a stale `./x.js` specifier: TypeScript resolves it to
  `x.ts` and Turbopack does not. Only the real build does.

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

[Unreleased]: https://github.com/IIITManjeet/Glasshouse/compare/v0.7.0...HEAD
[0.7.0]: https://github.com/IIITManjeet/Glasshouse/releases/tag/v0.7.0
[0.6.0]: https://github.com/IIITManjeet/Glasshouse/releases/tag/v0.6.0
[0.5.0]: https://github.com/IIITManjeet/Glasshouse/releases/tag/v0.5.0
[0.4.0]: https://github.com/IIITManjeet/Glasshouse/releases/tag/v0.4.0
[0.3.0]: https://github.com/IIITManjeet/Glasshouse/releases/tag/v0.3.0
[0.2.0]: https://github.com/IIITManjeet/Glasshouse/releases/tag/v0.2.0
[0.1.0]: https://github.com/IIITManjeet/Glasshouse/releases/tag/v0.1.0
