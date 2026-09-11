# TODO

Working checklist. Kept in the repo rather than in someone's head, because things were
being dropped between sessions.

Convention: `[ ]` open · `[x]` done · `[~]` in progress · `[!]` blocked, with what on.
Findings referenced as F-n live in `DESIGN.md`.

---

## In progress

- [~] **Fork round generation is partly stuck.** Four rounds exist (0-3: three settled, one
  live in reveal), which is enough to exercise the filters. Further rounds fail at `ship`
  with custom error `0x879f237b(router, orderHash)` -- Aqua rejecting an already-shipped
  strategy. The keeper's `nextRound` cursor and Aqua's ledger of shipped strategies have
  drifted apart across restarts, so it retries hashes Aqua has already seen. The keeper is
  not wrong and neither is Aqua; nothing reconciles them after a crashed run. Either restart
  anvil for a clean fork, or have the keeper skip a round whose strategy Aqua already holds.

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
- [x] `.btn-tertiary` applied to the three ad-hoc controls (`rounds` refresh, `Receipt`,
      `Reserve`). `BidPanel` and the `StatusBar` rehearsal toggle still carry bespoke styles;
      both are stateful toggles rather than plain buttons, so they want a `.btn-toggle`
      variant rather than being forced into an existing one.
- [ ] Art overlays, at most three, per the art direction in `DESIGN.md`. Last, and safe to cut.

## Frontend — done

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

## Backend — open

- [x] **The keeper now approves BOTH legs to Aqua.** Was USDC only (`scripts/keeper.ts:191` checks and
  approves only the USDC allowance). `ship` declares depth in BOTH tokens, so with a zero
  WETH allowance the very first round reverts — custom error `0x879f237b` carrying the router
  and the order hash, which reads like a duplicate-strategy error and is not one. Found on the
  fork, where the live-fill run had consumed the maker's WETH allowance; it would bite on
  mainnet exactly once, on the first keeper round, unless the maker happens to have approved
  WETH beforehand. Fix: approve both tokens in the same pre-flight block that already does USDC.

- [!] **Run the keeper against Base mainnet — BLOCKED ON YOU, twice over.**

  1. **The private key is in Hardhat's production keystore**, which prompts for a password
     interactively. A non-interactive shell cannot decrypt it, so this command has to be run
     by a human at a terminal. Nothing else in this list has that property.
  2. **The maker holds 0 WETH on mainnet** and the keeper declares 0.0004 WETH of depth per
     round, so `ship` reverts before anything else happens. Checked 2026-09-11: ETH
     0.001364, WETH 0 (allowance 0), USDC 2.239349 (allowance 200).

  Minimum-spend recipe, in order. Total cost is Base gas for about eight transactions, which
  is cents, plus wrapping 0.0005 ETH that stays yours as WETH:

  ```
  # 1. wrap a little ETH so the maker can back one round's declared depth
  cast send 0x4200000000000000000000000000000000000006 "deposit()"     --value 0.0005ether --rpc-url https://mainnet.base.org --interactive

  # 2. one round only. The keeper approves both legs itself now.
  KEEPER_MAX_ROUNDS=1 npx hardhat run scripts/keeper.ts --network base

  # 3. prove it from the logs, independently of the subgraph
  node scripts/verify-run.mjs --from 50965408
  ```

  After step 2, `LIFECYCLE` and `REPLAY` in verify-run flip from FAIL to pass, the subgraph
  mapping runs on real data for the first time, the Record page has something to show and the
  advisor gets a non-empty window. `PRICE_SET_BY` stays n/a until a second bidder reveals
  above the reserve, which needs a second funded wallet.

  Keep 0.0008 ETH or so unspent for gas; the wrap in step 1 comes out of the same balance.
- [ ] **A second bidder revealing above the reserve on mainnet**, so `PRICE_SET_BY` has
  something to confirm. The fork proves the second-price arm works; mainnet has never seen it.
- [ ] Cross-check the live subgraph's `Auction` entity against `verify-run`'s independent
  derivation for the same auction. Only way to exercise the AssemblyScript mapping on real
  data; replaces the regex drift guard with a real one.
- [ ] `web/lib/bid.js` and `chain.js` to TypeScript (1,400 lines of wallet code, no tests).

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
