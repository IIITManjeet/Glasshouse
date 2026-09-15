# Changelog

All notable changes to Glasshouse are recorded here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Because this is an ETHOnline 2026 submission built inside the event window, releases are
cut at the project's own milestones rather than on a calendar. The decision record behind
each one is in [`run.md`](./docs/archive/run.md).

## [Unreleased]

### Changed
- `web/lib/bid.js` and `web/lib/chain.js` are now `bid.ts` and `chain.ts`. No behaviour
  change: same exports, same RPC calls, same sentences. The components that imported them
  lost the blocks of casts that restated every signature by hand.

### Added
- `test/js/bid.test.js` and `test/js/chain.test.js`: the wallet, signing and chain-reading
  code against a fake wallet and node, with every expected calldata, return value, event
  topic and revert encoded by viem from the compiled ABI, and the commitment checked
  against `GlasshouseBook.commitmentFor`'s `keccak256(abi.encodePacked(bidder, bps, salt))`.
  The same bid tests pass against the pre-migration `bid.js`. One is marked todo: the
  `ERC20InsufficientAllowance` sentence swaps the allowance and the amount needed.

### Planned
- `site/index.html` as a real route rather than a hand-written file synced into `public/`.
  It is the last thing keeping two palettes, two font strategies and two provenance
  conventions alive at once.
- The keeper running continuously, so a visitor always finds a round accepting bids. It has
  run repeatedly since — capped batches, run deliberately rather than left unattended — but
  never as a standing process; see `TODO.md` for the state-file race that keeps two
  processes from safely sharing one network today.
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

## [0.9.0] - 2026-09-13

The ETHOnline 2026 submission build. Everything since v0.7.0: the front end rebuilt around
one shared visual contract, every step of a round's lifecycle reachable from the browser
rather than from a terminal on one laptop, five defects an audit of roughly forty reachable
states found and fixed, and the mainnet evidence kept current with the chain instead of a
day behind it. **Stays 0.x on purpose:** the contracts are unaudited, the index is thin,
orders are dust-sized, and the bond on ordinary rounds is 0.

### Added
- **The instrument is the front door.** The live auction moves to `/`; the old landing page
  is gone. `/board` now 301s, so every link anyone already shared still resolves. (07066a3)
- **The FAQ and a real footer.** `/faq` carries twenty questions, each answer lifted — not
  rewritten — from existing prose, with a `// Lifted:` comment naming the file and lines it
  came from. A four-column footer now carries every link the site had scattered through it.
  (07066a3)
- **The card/button system.** `.card` / `.card-head` / `.card-foot`, `.row-link`,
  `.addr-mark`, `.prose-measure`, `.btn-danger-solid`. Primary actions are a 44px sans 600
  button and the chip is neutral, so the accent colour is spent only on the primary button
  and `.chip-live`. One spacing scale, icons that name the act, and a favicon that is
  actually visible at 16px — the first two attempts were not. (6755cd1, fdccd2b)
- **Rounds as a market.** `/rounds` is a promoted tile whose block countdown is the biggest
  thing on the page, a bid strip of one cell per commitment (hatched while sealed, solid
  once revealed), and — when nothing is open — the same tile becomes the last print, which
  is what every exchange shows when the market is quiet rather than an empty table.
- **Address identity, without invention.** A deterministic two-hue mark per address, real
  ENS where it resolves, and roles read from chain fields (`house`, `you`, `winner`,
  `leading`, `filled`, `maker`). No generated names, no faces; full hex stays visible and
  copyable everywhere.
- **A round can be opened, bid in, revealed and settled from the browser, by anyone.**
  `GlasshouseBook.open()` has no access control and keys each auction by
  `(msg.sender, orderHash)`, so a round was never something the deployment granted — only
  something the site had never used. `openRound()` and `settleRound()` are wired in; a
  browser-opened round is pinned to its `(hash, maker)` pair and reachable at
  `/r/<hash>/?m=<maker>` without touching the binary-search poll every other page depends
  on. Such a round has no SwapVM order behind it and can never be filled, and the round page
  says so plainly — "no order this site knows of" — rather than implying a fill that cannot
  happen. (333e945)
- A dedicated-RPC option for the deployed site (`NEXT_PUBLIC_RPC_URL`), documented in
  `DEPLOY.md` alongside which of the site's three consumers may see which key. (b90a5e4)
- `.claude/skills/glasshouse-frontend` — the house frontend conventions written down where
  an agent will read them, every command checked against `package.json`. (654bb8b)
- A **Future work** section collecting four deferred items — the maker-side bond, the
  TypeScript migration, the Messari-metrics divergence, and invite-only playgrounds — in one
  place with the constraint that settles each one, instead of scattered across four
  documents. (6948cd1, aeecf97)

### Fixed
- **Five edge cases from an audit of roughly forty reachable states**, driven in a real
  browser rather than reasoned about: `/r/<hash>` without `?m=` was a dead end for any round
  outside the board's six-round window — including the live-fill order the README leads
  with; `/round` rendered nothing at all when the log scan failed, collapsing "could not
  read the bids" into "nobody bid"; the settlement chart accused bidders of forfeiting bonds
  that were never escrowed on ordinary bond-0 rounds; `/rounds` with nothing loaded drew six
  filter tabs all reading 0, one of them phrased as an accusation; and the void-bid panel
  told a visitor to "bid again in the round now open" when usually none is. (44560c8)
- **The 24,096 USDC base-units overstatement.** The live-fill amount was being read, and in
  places spoken, as 24,096 USDC — a millionfold overstatement, since USDC has six decimals
  and the real amount is 0.024096 USDC. Every occurrence of the figure now carries the "base
  units" qualifier and the human amount beside it. (4d3a57b)
- The deployed `/evidence` page was rate limited within an hour of mainnet having its first
  round: `newestOpenedRound` in `web/lib/chain.js` memoised the newest opened round behind a
  `cursor > 0` guard, and the remembered cursor for a chain holding exactly one auction is
  `0` — so the fast path never engaged and every poll paid the full ~10-call search, from
  every visitor's IP. Guard is now `>= 0`; `test/js/chain-call-budget.test.js` asserts the
  *price* of a poll (10 calls before, 3 after), not just its answer. (102beed)
- The live fill checked only the USDC leg of the depth `ship` declares to Aqua; the WETH leg
  went unchecked, so a run could fund two ephemeral bidders and only then revert inside
  `ship`. Both legs are now checked before anything is spent. (5d7cd62)
- `/evidence` refreshed to the chain as it actually stands rather than a snapshot from the
  morning before; `verify-run` re-emitted and the cold-fallback snapshot regenerated to
  match. (3f03cb6)

### Recorded
- **No contract runs by itself.** No EVM contract executes unprompted, so "the contract
  keeps the board live" was never a buildable claim. `open()` having no access control
  closes half of that gap; the other half — a maker with a real order shipped to Aqua — is
  not automatable, and is recorded as such along with the two designs (`settle()` opening
  round N+1 itself; an incentivised `openNext()`) that would close the rest. (e8591d3)
- **Our own demonstration bidders render as strangers on our own site.** The ephemeral
  bidders `run-live-fill.ts` funds are not in `TEAM_ADDRESSES`
  (`subgraph/src/provenance.ts:19`), so they resolve to `UNKNOWN` on the contested round
  that carries this project's headline claim, with no chip distinguishing them from a real
  stranger. Nothing is concealed — the funding transactions are on chain — but the asymmetry
  is real and not fixable before the deadline, since `provenance.ts` is subgraph mapping
  code. Left open in `TODO.md`, with the interim: say it out loud. (92eab08)
- **The mainnet keeper round, a bonded round, and the second-price claim, all on Base.** The
  keeper's first mainnet round; a bonded round (`bond > 0`) carried through commit, reveal,
  settle and `claimBond`, taking `scripts/verify-run.mjs` to **8 passed, 0 failed, 0 not
  applicable** — every check it knows how to make now has something real to make it
  against; and a second-price fill on order `0x58296d32…`, where the winner's 400 bps lost
  to the rival's 250 and the auction cleared at the **rival's** bid, filled inside the
  exclusive window for 0.00001 WETH in against 24,096 USDC base units out (0.024096 USDC).
  `scripts/cross-check-subgraph.mjs` (`npm run crosscheck`) diffs the published index
  against an independent replay of the Book's own logs, field by field, and
  `scripts/sweep-bidders.mjs` returns the ephemeral bidders' unspent gas to the maker.
- **The demo.** A 2–4 minute, human-narrated recording of the mechanism, from the two
  existing SwapVM opcodes through the measured three-way comparison to the real mainnet
  fill. Kept out of version control — `Glasshouse-ETHOnline-2026-demo.mp4` is gitignored,
  because a binary that size in git history is permanent weight for every future clone; it
  belongs on the submission platform, not in the source.

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

[Unreleased]: https://github.com/IIITManjeet/Glasshouse/compare/v0.9.0...HEAD
[0.9.0]: https://github.com/IIITManjeet/Glasshouse/releases/tag/v0.9.0
[0.7.0]: https://github.com/IIITManjeet/Glasshouse/releases/tag/v0.7.0
[0.6.0]: https://github.com/IIITManjeet/Glasshouse/releases/tag/v0.6.0
[0.5.0]: https://github.com/IIITManjeet/Glasshouse/releases/tag/v0.5.0
[0.4.0]: https://github.com/IIITManjeet/Glasshouse/releases/tag/v0.4.0
[0.3.0]: https://github.com/IIITManjeet/Glasshouse/releases/tag/v0.3.0
[0.2.0]: https://github.com/IIITManjeet/Glasshouse/releases/tag/v0.2.0
[0.1.0]: https://github.com/IIITManjeet/Glasshouse/releases/tag/v0.1.0
