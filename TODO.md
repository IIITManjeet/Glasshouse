# TODO

Working checklist. Kept in the repo rather than in someone's head, because things were
being dropped between sessions.

Convention: `[ ]` open · `[x]` done · `[~]` in progress · `[!]` blocked, with what on.
Findings referenced as F-n live in `DESIGN.md`.

---

## In progress

- [x] **The keeper survives an interruption, and skips a round it cannot ship.**
  Was: `nextRound` only advances after settle AND dock, so any interruption left the cursor
  on a partly-done round and the next run restarted it from `ship` -- which Aqua rejects for
  a strategy it already holds, permanently stranding the keeper on that round. Harmless on a
  fork; not harmless now that the mainnet balance is good for ~240 rounds and the run is
  meant to be left alone.

  Progress is recorded in the state file (`shipped`, written between ship and open) and
  confirmed against the Book, never inferred from the revert -- `0x879f237b` reads like a
  duplicate-strategy error but also fires for a missing allowance, so the selector cannot
  tell you which. Each step now asks what is already true: open skipped when `commitEnd` is
  set, commit when the Book holds ours, reveal when already revealed, settle when settled.
  A ship that fails for any reason SKIPS the round and advances, because retrying is what
  turned one bad round into a dead keeper.

  Verified on a fork both ways, after a regression the first version introduced: a round
  killed between commit and reveal resumes and reveals at the bps its state file recorded;
  a fresh round still seals, reveals and settles with a real winner. That regression --
  `hasCommitted` read into a const before the commit was sent, so every FRESH round settled
  at 0 bps with no winner -- was caught only by testing the path that looked least likely
  to break.

## Frontend — open

- [!] **F-5 the type rule — NEEDS YOUR DECISION, not a patch.** Mono on /board and /evidence
  is deliberate: `Theme.tsx` routes them into `.tape`, which sets the mono family on purpose
  ("a landing page persuades, a terminal reports"). The readability research says mono is
  wrong at paragraph length. Narrow option: keep the register, set only the explanatory
  paragraphs under each heading in the prose face. Left open rather than reversed silently.
- [x] **F-9 withdrawn** — the floating circle is the Next.js dev indicator, injected by
  `next dev` and absent from production. Verified against the deployed site and the built
  chunks. Second finding withdrawn for the same reason as F-8.
- [x] **F-7 withdrawn** — the CTA panel populates; the capture was taken mid-transition.
- [x] **The control system is complete.** Every label and control in the app now uses a
      primitive — a grep for the old ad-hoc class lists returns nothing. `.chip` gained
      `chip-live` / `chip-warn` tints so `SourceChip` keeps its semantic colour (mainnet vs
      fork/sim/snapshot) without a border; `.btn-toggle` drives its pressed look from
      `aria-pressed`, so the visible and announced states cannot drift.
      Two over-corrections caught by looking at the result: `refresh` was too quiet as
      tertiary when it is the only control on the page, and the rehearsal toggle lost the
      status bar's uppercase. Both fixed.
- [ ] Art overlays, at most three, per the art direction in `DESIGN.md`. Last, and safe to cut.

## Frontend — done

- [x] **"Where do I start?" had no answer.** The board could say what phase a round was in
      and never how a person takes part — most visibly when nothing is live and the panel
      correctly says there is nothing to bid on, leaving a visitor with no idea what they
      would have done. `components/HowToBid.tsx` is the missing half: four steps from the
      bidder's side, present whether or not a round is open, with a pointer to it from the
      page lede so it is not something you find only by scrolling past the whole instrument.
- [x] **The account page was a wall of zeros.** An address the indexer had seen but that had
      never bid rendered "0 of 0 sealed" above six tiles of 0 — every figure correct and the
      panel saying nothing, which reads as a page that failed to load rather than an account
      with no history. It now leads with a sentence and draws the tiles only when there is
      something in them.

- [x] F-0 `/profile/<addr>` 404 on localhost — dev-parity rewrite in `next.config.mjs`
- [x] F-1 record page had no nav entry — `Bidders` added
- [x] F-2 every address left the site — `components/Address.tsx`, in-app record first
- [x] F-3 chip vs button — `.chip` / `.btn` primitives in `globals.css`
- [x] F-4 no CTA hierarchy — `.btn-primary/secondary/tertiary/danger`, one primary per view
- [x] F-6 nav never marked the current page — `components/NavLink.tsx`, with `aria-current`
- [x] F-8 **withdrawn** — the 390px "clipping" was a headless-Chrome cropping artefact
- [x] Wallet not connecting — detection rewritten to ask connectors, not `window.ethereum`
- [x] Screenshot rig on CDP with real device emulation + overflow measurement
- [x] **Rounds page filter tabs** -- `components/RoundsFilter.tsx`, six filters with live
      counts, zero-count tabs disabled rather than hidden, `role="tablist"`. Rounds whose
      bids could not be READ are excluded from bid-based filters and named separately rather
      than being counted as having none, because "we could not read it" is not "nobody bid".
- [x] **The deployed /evidence page was rate limited the moment mainnet had a round.**
      Reported from the live site within an hour of the first keeper round settling. Cause
      in `web/lib/chain.js`: `newestOpenedRound` memoises the newest opened round so a poll
      confirms it in one or two `eth_call`s instead of binary-searching all 300, but the
      memo was guarded by `cursor > 0` -- and the remembered cursor for a chain holding
      exactly ONE auction is 0. The fast path never engaged, every poll paid the full
      ~10-call search, and `writeCursor(0)` stored a value that failed the same guard on the
      next tick, so the memo could never warm up. 10 calls per poll, every 12 s while a
      round is live, from every visitor's IP against Base's public endpoint.

      It was dormant for as long as mainnet was empty, because an unopened round 0 returns
      early after ONE call — so the code was cheapest precisely while it was untested, and
      became expensive at the moment the thing it guards started working. Fix is `>= 0`.

      `test/js/chain-call-budget.test.js` asserts the PRICE of a poll, not just its answer:
      10 calls before, 3 after. Its third case — "still finds the newest round when many are
      open" — passes under BOTH guards, which is the point. Correctness was never broken, so
      no correctness test could have caught this, and `chain.js` had no coverage at all.

## Backend — open

- [x] **The keeper now approves BOTH legs to Aqua.** Was USDC only (`scripts/keeper.ts:191` checks and
  approves only the USDC allowance). `ship` declares depth in BOTH tokens, so with a zero
  WETH allowance the very first round reverts — custom error `0x879f237b` carrying the router
  and the order hash, which reads like a duplicate-strategy error and is not one. Found on the
  fork, where the live-fill run had consumed the maker's WETH allowance; it would bite on
  mainnet exactly once, on the first keeper round, unless the maker happens to have approved
  WETH beforehand. Fix: approve both tokens in the same pre-flight block that already does USDC.

- [x] **The keeper has run against Base mainnet.** 2026-09-12, round 0, one round only.
  The two things that gated it are gone: `scripts/wrap-weth.ts` wraps through the Hardhat
  keystore (so the deployer key never leaves it for a `cast --interactive` paste), and
  0.0005 WETH now backs the 0.0004 of declared depth. The whole round -- approve, ship,
  open, commit, reveal, settle, dock -- cost 0.0000028 ETH.

  `verify-run` went from **3 passed / 2 failed / 3 n/a** to **6 passed / 1 failed / 1 n/a**:

  - `LIFECYCLE` and `REPLAY` flipped to pass. REPLAY is the one that matters -- the
    settlement re-derived from the raw reveals matches what `settle()` emitted, winner and
    clearing price both, without importing the contract's rule, the subgraph's copy of it,
    or the page's. It had never run against mainnet before.
  - `PHASE` went n/a -> pass, and `SITE_DERIVATION` now checks its clearing price against
    a real settled round instead of against zero of them.
  - `PRICE_SET_BY` went n/a -> **FAIL**, which is the honest move rather than a regression:
    there is now a settled auction with a winner, so the check can run, and it reports that
    the winner cleared at the reserve because the house was the only bidder. "Ran, and the
    second-price arm was not exercised" is a different claim from "nothing to run on", and
    the verifier is right to stop saying the second one.

  Snapshot regenerated and committed, so `/evidence` shows this rather than the old 3/2/3.

- [x] **A second bidder revealed above the reserve on mainnet, and the winner filled.**
  2026-09-12, order `0x58296d32…` via `scripts/run-live-fill.ts`. Winner 400 bps, rival 250,
  cleared at **250 — the rival's bid**. Filled inside the exclusive window: 0.00001 WETH in,
  24,096 USDC out, exactly what the preflight predicted. `fillPhase: EXCLUSIVE`,
  `fillByWinner: true`.

  `verify-run` is now **7 passed / 0 failed / 1 n/a**. `PRICE_SET_BY` passes and names both
  outcomes rather than only the good one: "1 of 2 settled auctions cleared at the RUNNER-UP's
  bid, 1 cleared at the reserve". The subgraph agrees independently —
  `settlementMatchesDerivation: true`, `competition: CONTESTED`, `thin: false`.

  No second wallet was needed: `run-live-fill.ts` generates and funds ephemeral bidders
  itself. That had been mis-scoped in this list as blocked on funding a second account.
- [x] **The subgraph is cross-checked against an independent replay, by script.**
  `scripts/cross-check-subgraph.mjs` (`npm run crosscheck`). It re-derives every auction
  from the Book's raw logs, asks the deployed subgraph about the same ones, and diffs them
  field by field: **45 comparisons across 3 auctions, all agreeing**, plus the mapping's own
  `settlementMatchesDerivation` asserted true on every settled round.

  The derivation is IMPORTED from `verify-run.mjs`, not rewritten — that file's whole value
  is that its replay imports none of the three implementations, and re-typing the top-2 walk
  would have made this a test of whether two copies of one mistake match. `readLogs` and
  `rebuild` are exported for it, and the CLI is now guarded by an `import.meta.url` check so
  importing them does not run the whole scan as a side effect.

  Verified non-vacuous: injecting an off-by-one into the replay side makes it report the
  disagreement on all three auctions with both values, and exit 1.

  This does NOT replace `TRANSLITERATION`, and does not fully retire it either: both sides
  here read the same chain, so this catches a mapping that computes the wrong thing, not a
  chain that emitted the wrong thing. The latter is `verify-run`'s `REPLAY`.
- [ ] ~~`web/lib/bid.js` and `chain.js` to TypeScript~~ — **recommend NOT doing this before
      submission.** 1,400 lines of wallet and signing code, nearly all of it untested (only
      `decodeAuction` and the poll's call budget are covered), on the path every bid takes. A type migration there is a large diff with no observable benefit to a
      judge and a real chance of breaking the one flow that must work live. It is the right
      thing to do the week after, not the day before.

- [ ] **Bonds have never been exercised, on any chain.** Every round the keeper and the live
  fill open uses `bond = 0`, so `claimBond`, `claimForfeit` and `claimUnrevealed` have never
  run and `verify-run`'s `BONDS` check is permanently n/a rather than passing. It is the last
  contract surface with no live evidence behind it. One bonded round would close it; saying so
  plainly is the alternative.
- [~] **Run the keeper so a visitor finds a round accepting bids.** Six mainnet rounds so
  far (0-5). Measured cost is 0.0000022/round, and the balance after the ephemeral-bidder
  sweep is 0.000534 ETH -- about 240 rounds, or 18 hours back to back.

  Deliberately NOT left running unattended before the demo. The board only needs a live
  round while someone is watching, and 2 rounds of demo cost ~1% of the balance, so the
  risk worth managing is arriving at judging with the money already spent -- not running
  out mid-round, which the gas floor now handles by stopping cleanly between rounds.
  Run a capped batch (`KEEPER_MAX_ROUNDS=5`) shortly before showing it.

## Backend — done

- [x] `npm test` red where `forge test` was green — `fsPermissions` in `hardhat.config.ts`
- [x] `npm test` hid two suites behind `&&` — `scripts/run-checks.mjs` runs all three
- [x] Snapshot generator broken by a tightened RPC log cap — both scans renegotiate the cap
- [x] Fork rehearsal could consume the round it was rehearsing — `DRY_RUN` keeps its own cursor
- [x] `scripts/verify-run.mjs` — independent replay, three outcome states, contract tie-break
- [x] Full fork end-to-end: keeper round, then a two-bidder live fill clearing at the
      runner-up's 250 bps, through the official Aqua inside the exclusive window

## Housekeeping

- [x] Committed and pushed as `4726856` on 2026-09-11.
- [x] Background anvil and dev server stopped.

> **The fork is gone, and with it the only settled rounds that existed.** Four keeper rounds
> and the two-bidder live fill that cleared at the runner-up's 250 bps lived only in that
> anvil process. To demo a populated receipt or the rounds filters against real data again,
> restart the fork and re-run: `anvil --fork-url https://mainnet.base.org --chain-id 8453
> --block-time 1`, then the keeper with `DRY_RUN=1`, then `run-live-fill.ts`. Budget about
> ten minutes. A fresh fork also clears the shipped-strategy collisions that stalled round
> generation, so this is the fix for that too.
