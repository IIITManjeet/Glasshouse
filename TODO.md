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
- [ ] **F-7 the landing page's only CTA can render empty.** Confirm in a real browser whether
  it is a genuine empty state or a capture artefact before changing anything.
- [ ] Apply `.btn` / `.chip` primitives to the remaining controls — `BidPanel`, `Reserve`'s
  copy button, `DemoMode`, the rehearsal toggle in `StatusBar`.
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

- [ ] **The keeper approves USDC to Aqua but never WETH** (`scripts/keeper.ts:191` checks and
  approves only the USDC allowance). `ship` declares depth in BOTH tokens, so with a zero
  WETH allowance the very first round reverts — custom error `0x879f237b` carrying the router
  and the order hash, which reads like a duplicate-strategy error and is not one. Found on the
  fork, where the live-fill run had consumed the maker's WETH allowance; it would bite on
  mainnet exactly once, on the first keeper round, unless the maker happens to have approved
  WETH beforehand. Fix: approve both tokens in the same pre-flight block that already does USDC.

- [!] **Run the keeper against Base mainnet.** BLOCKED on a go-ahead: it costs real gas.
  This is the single change that makes the whole product real — it flips `LIFECYCLE` and
  `REPLAY` in `verify-run`, exercises the subgraph mapping on real data, fills the Record
  page and gives the advisor a non-empty window. Mainnet still has 1 auction, 2 commits,
  **0 reveals, 0 fills, 0 settlements**.
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

- [ ] Commit and push everything since `0f49d1e` (wallet fix, dev rewrite, nav, Address,
      NavLink, primitives, DESIGN.md, TODO.md).
- [ ] Kill the background anvil and dev server when done. Anvil holds the only settled
      rounds that exist, so killing it loses the populated-receipt demo.
