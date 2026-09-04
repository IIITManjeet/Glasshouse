# run.md — ETHOnline 2026 Project Run Log

> **Purpose.** Single source of truth for this project's context. Any model or human
> picking up this repo should be able to read *only this file* and know what we're
> building, why, what's decided, what's open, and what's next.
>
> **Maintenance rules**
> 1. Major decisions → **§4 Decision Log** with a `D-nnn` id, options, choice,
>    rationale, and consensus result.
> 2. Major code/architecture changes → **§6 Change Log** with date and verification.
> 3. Facts → **§3** with a source URL. Unverified claims are marked `[UNVERIFIED]`
>    and live in **§7 Open Questions** until confirmed.
> 4. Never delete history. Supersede instead (`SUPERSEDED BY D-nnn`).

---

## 0. Status

| Field | Value |
|---|---|
| Event | ETHGlobal ETHOnline 2026 |
| Hacking window | **2026-09-04 → 2026-09-16** |
| Submission deadline | **2026-09-13, 12:00 EDT** (= 21:30 IST) ⚠️ **8 days left** |
| Today | **2026-09-05 — day 2 of 10** |
| Phase | **P3 — Building. Contracts drafted, Book unproven.** Roadmap in §9. |
| Repo | **https://github.com/IIITManjeet/Glasshouse** — own repo, 7 incremental commits, ⚠️ **still PRIVATE** |
| **Name** | **Glasshouse** ✅ *(user, 2026-09-03)* |
| Category | **DeFi + Infrastructure** — market microstructure, not a consumer app |
| Strategy | ✅ **Prize-aligned pivot, novel mechanism, infra-deep** (D-001) |
| Thesis | ✅ **"Taker priority is allocated by identity or by clock, never by bid"** — D-004 |
| Target tracks | 1inch $7K · The Graph $15K · Chainlink $2.5K *(max 3, F-42)* |
| Dropped | ❌ EigenLayer ❌ Sui/Move — no sponsor, no prize path (F-4) |

> ⚠️ **Hard gate:** no project code may be written before **Sep 4** (F-38), and the
> repo must show **real incremental commit history** (F-40).
> ⚠️ **Demo video must be narrated by a human — AI voiceover is an auto-reject** (F-43).

---

## 1. Objective

Build a standout ETHOnline 2026 project around **MEV + a bidding/auction mechanism**,
originally scoped to EigenLayer and optionally Sui/Move.

Success = (a) technically novel, (b) buildable in ~10 days, (c) eligible for real
sponsor tracks, (d) demoable end-to-end.

---

## 2. Constraints

- `C-1` Submission deadline **2026-09-13 12:00 EDT**. Effective build window ~9 days.
- `C-2` Must be demoable — a live demo beats a whitepaper at ETHGlobal.
- `C-3` Scope must fit the window. Depth on one novel mechanism > breadth.
- `C-4` **Originality is a hard requirement from the user.** An idea that already
  exists as a shipped product is disqualified unless materially advanced.
- `C-5` **Prize money at ETHOnline 2026 exists only inside sponsor tracks** (F-2).
  Novelty outside a sponsor track wins recognition, not money.
- `C-6` 🔴 **NO COMMITS BEFORE SEP 4** *(user instruction, 2026-09-03)*. No project
  code, and **no git commits at all**, until the event opens. Reinforces F-38/F-40:
  the repo must show genuine incremental history dated inside the event window.
  Current state: **0 commits.** `run.md` and `ARCHITECTURE.md` are uncommitted
  planning documents.

---

## 3. Verified Facts

Each entry: claim — source — date verified. All live-fetched **2026-09-03**.

### 3.1 Event rules & tracks
> **Independently confirmed by two separate research agents.** ✅ Consensus-1.

- **F-1** ETHOnline 2026 runs **Sep 4 – Sep 16, 2026**; **submissions due Sep 13,
  12:00 EDT**.
- **F-2** Prize pool **$79,500 — 100% sponsor bounties. There is NO general prize
  pool.** You win money only by qualifying for a specific sponsor track.
  https://ethglobal.com/events/ethonline2026/prizes
- **F-3** Sponsors & amounts: The Graph $15K · Hedera $15K · Arc/Circle $10K ·
  World $7K · **1inch $7K** · ENS $5K · Uniswap Foundation $5K · Ledger $5K ·
  Privy $5K · Bazantic $3K · Chainlink $2.5K.
  Thematic centre of gravity: **AI agents, x402 agentic payments, tokenization**;
  ~half the pool sits in "Continuity" tracks.
- **F-4** ❌ **EigenLayer is NOT a sponsor.** ❌ **No MEV / Flashbots / auction
  track.** ❌ **Sui / Mysten is NOT a sponsor.** ❌ No privacy-infra track.
- **F-5** **Flashbots' ETHGlobal sponsorship ended after London 2024.**
  `?partners=flashbots` returns exactly 4 events (Paris 2023, Waterloo/NY 2023,
  Istanbul 2023, London 2024) and nothing since. Nethermind carried the MEV track
  at London & Singapore 2024. **MEV has had no ETHGlobal sponsor for ~2 years.**
- **F-6** **EigenLayer's entire ETHGlobal footprint is one event** — Agentic
  Ethereum (Feb 2025), the $20K "Eigen Agents" track. Exactly four EigenLayer prize
  winners exist (Synapze, AiVS, WeAi, Keyring) and **all four are agent-shaped,
  not infrastructure-shaped.**
- **F-7** Precedent: Sui has sponsored other ETHGlobal events and Sui projects have
  won (HackMoney 2026 had a $10K Sui track — SuiFlow, ONSUI, **Suiquencer**;
  New Delhi — SuiVerify). Not at ETHOnline 2026.
- **F-8** Closest MEV-adjacent money at this event: **1inch Aqua/SwapVM ($7,000)** —
  solver/execution-layer work, explicitly permits modifying SwapVM opcodes, and
  SwapVM entries are scored higher.

### 3.2 Submission rules & judging (VERBATIM — these bind us)
- **F-38** ⚠️ **Classic track:** *"your project must be started and developed during
  the hackathon. You may use public libraries or boilerplate, but pre-existing
  project-specific code, designs, or assets are not allowed."*
  **→ We must NOT write project code before Sep 4. Research and design docs only.**
- **F-39** **Continuity tracks** (≈half the pool) may build on an existing codebase,
  but must *"clearly document what work existed before the hackathon"* and include
  *"substantive new features… developed during the event"*; all new parts must be
  open source.
- **F-40** *"Any repositories with single commits of large files without proper
  history will be default assumed to be unqualified."*
  **→ Commit incrementally, with real history, starting Sep 4.**
- **F-41** Penalty for undisclosed pre-existing work: disqualification, prize
  revocation, ban.
- **F-42** Team size **up to 5**. **Max 3 partner prizes selectable per submission.**
  IP stays with us. A refundable ETH stake is required, returned ~3 weeks after.
- **F-43** **Video: 2–4 min, ≥720p.** Auto-reject triggers: sped-up footage,
  music-with-text instead of narration, phone recordings, and **AI voiceover/TTS**.
  **→ The demo must be narrated by a human voice.**
- **F-44** **AI tools are permitted, but we must document where AI assisted and
  include all spec files and prompts.** → `run.md` and the design docs are part of
  the submission, not just internal notes.
- **F-45** **Judging criteria (5, no published weights):** Technicality, Originality,
  Practicality, Usability (UI/UX/DX), WOW Factor. Two rounds — async screening, then
  live judging where **only the top 20% advance** (7 min: 4 demo + 3 Q&A).
- **F-46** Deployment (testnet vs mainnet) is **not** set globally — it's per sponsor
  track. Known: ENS → **ENSv2 on Sepolia**, no hard-coded values. Hedera → **Hedera
  testnet** + HashScan-verified contracts. Arc → **mainnet-ready by Sep 30** +
  architecture diagram. The Graph → **no mocked/static data**. Uniswap → requires a
  **`FEEDBACK.md`** + Developer Feedback Form.
- **F-47** **No rule anywhere requires an EVM chain** (verified directly against
  `/rules`, `/info/details`, `/info/start` — NOT STATED). But every one of the 11
  tracks requires a specific EVM/EVM-compatible integration, so **a Sui-only project
  has no prize path here**; Sui can only ride along as an extra component.
- **F-48** Ledger's $5K is *"Prize details coming soon"* and Chainlink's criteria are
  unpublished. **Both drop at kickoff Sep 4 — re-check them.**

### 3.3 ETHGlobal judging signal (historical)
- **F-9** **Deep MEV infra reliably places when a track exists.** Every project
  touching the real builder/relay/auction stack won something: FairArbooors
  (Nethermind MEV 1st), BlobPreconf Auction (2nd), IntegrityProof (Flashbots Best
  Innovation), PEPC-REP, SUClave, Searcher Auction Spec.
- **F-10** **MEV projects that lost were consumer-facing wrappers** — Protect
  frontends, dashboards, analytics. Infrastructure wins; UI over infrastructure doesn't.
- **F-11** White space across six years of ETHGlobal submissions: **nothing on
  encrypted mempools** (zero results), **nothing on EigenDA**, and exactly **one**
  preconfirmation project ever.

### 3.3b EigenLayer / EigenCloud stack
> ⚠️ **HISTORICAL — EigenLayer is OUT OF SCOPE** per D-001. Retained only to record
> why the original premise was abandoned.
- **F-12** Official AVS tooling is **decaying**: `hourglass-monorepo` ARCHIVED
  2026-03-02, `hourglass-avs-template` ARCHIVED, `devkit-cli` still
  `v0.1.0-preview` (unaudited, ~10mo stale), `incredible-squaring-avs` frozen >1yr,
  `eigenlayer-middleware` 8mo stale. **Docs still recommend DevKit/Hourglass; the
  repos contradict the docs.**
- **F-13** ~148 hackathon AVS repos exist, mostly 0–15★. "We built an AVS" is not
  itself a differentiator.
- *(Agent 2 — slashing / redistribution status — still running.)*

### 3.4 MEV landscape
- **F-14** Production-grade, do not compete: `flashbots/mev-boost` (1,438★),
  `flashbots/rbuilder` (565★), `mev-boost-relay` (497★), `cowprotocol/services`
  (314★), `FastLane-Labs/atlas` (165★), `flashbots/mev-share` (145★),
  `SorellaLabs/angstrom` (84★), `primev/mev-commit` (53★).
- **F-15** **`flashbots/suave-geth` is ARCHIVED (2025-05-12). SUAVE is not live.**
  Note: 7 of the historical ETHGlobal MEV winners were SUAVE projects — that entire
  category is now unbuildable, which is *why* the space looks empty.
- **F-16** Encrypted mempools actually live: **Shutter** (Gnosis mainnet since
  Jul 2024, `rolling-shutter` 40★) and **Espresso** (191★, live with
  Arbitrum/Celo/ApeChain/Morph). Radius & Fairblock are testnet-framed.
- **F-17** TEE builders are the most mature anti-MEV category: Unichain TEE block
  builder (Uniswap + Flashbots) on mainnet since May 2025; BuilderNet live;
  `Dstack-TEE/dstack` 540★. `taiko/raiko` ARCHIVED Aug 2026.
- **F-18** MEV redistribution is mostly vapour: **MEV burn has no code, no EIP, no
  testnet**; **Smoothly Protocol shut down** ("RIP 2023–2026"); `cowprotocol/cow-amm`
  archived. **Jito on Solana is the one thriving redistribution system.**

### 3.5 Sui / Move
- **F-19** Sui has **no public mempool and no fee auction**. Two paths: owned-object
  fast path (no consensus, ~250–400ms) and shared-object consensus path. **All MEV
  lives on the shared-object path** — every DEX pool, every DeepBook `Pool`, and
  anything reading `Clock` (0x6).
- **F-20** **Mysticeti ordering bias** — arXiv 2607.13378 (Mirzaei & Amiri,
  2026-07-15). Both the consensus linearizer sort and the post-consensus gas re-sort
  are *stable* sorts, so validator index leaks through as ordering priority.
  Lower-indexed validator wins same-round ordering **~89%** of the time;
  "strategic silence" pushes it **>94%**; the attacker **pays no gas premium**.
  Measured extraction **~$18K/day (~$6M/yr)** on Sui mainnet.
  **No public implementation, detector, or mitigation exists. Fix not shipped.**
  https://arxiv.org/abs/2607.13378
- **F-21** **Shio — Sui's only MEV auction — SHUT DOWN 12 May 2026.** Lifetime
  ~$1.6M MEV distributed, 38M bundle submissions. `docs.getshio.com` no longer
  resolves; no GitHub org survives. https://www.getshio.com/
  **→ Sui today has an active MEV problem and ZERO MEV protection in production.**
- **F-22** **SIP-19 soft bundles survive Shio and remain Final in-protocol**: max 4
  certificates, 64KB, all must touch shared objects, all must have identical gas
  price. **The bundling primitive exists with no operator using it.**
  https://github.com/sui-foundation/sips/blob/main/sips/sip-19.md
- **F-23** SIP-45 (Final) raised max gas price to 1T MIST with an amplification
  factor — priority gas auctions do exist on Sui, designed for CEX-DEX arb.
- **F-24** **Seal** (https://github.com/MystenLabs/seal, 408★, mainnet-live) —
  threshold IBE where **a Move access policy you write** gates decryption. Its own
  `tle.move` doc comment names **"MEV resilient trading"** as a use case.
  **No auction pattern ships in the repo**; the three community Seal-auction repos
  total 5★.
- **F-25** **`sui::nitro_attestation` is MAINNET-live** — a Move contract can parse
  *and verify* an AWS Nitro Enclave attestation on-chain. **Ethereum has no native
  equivalent.** Paired with **Nautilus** (MystenLabs TEE off-chain compute, 74★).
- **F-26** Sui Move crypto stdlib (read from source): `bls12381`, `ecdsa_k1`/`_r1`,
  `ecvrf`, `ed25519`, `groth16` (bn254 + bls12381, **max 8 public inputs**),
  `group_ops` (pairing, hash-to-curve, MSM), `hash` (**keccak256**), `hmac`,
  `nitro_attestation`, `poseidon`, `rangeproofs`, `ristretto255`, `random` (mainnet),
  `clock`. ⚠️ **`vdf` is DEVNET-ONLY. `zklogin_verified_id` functions are DISABLED.**
- **F-27** **`ecdsa_k1::secp256k1_ecrecover` accepts a KECCAK256 constant** — the
  exact Ethereum `ecrecover` construction. **Sui can natively verify an
  Ethereum-signed attestation with no bridge at all.** Lowest-latency cross-chain path.
- **F-28** **Sui Bridge cannot pass generic messages** (verified from
  `bridge/sources/message_types.move`: tokens + governance only). For real messaging
  use **Wormhole** (`vaa::parse_and_verify` works in Sui Move, 1,890★) or **Axelar GMP**.
- **F-29** Sui MEV prior art: `fuzzland/sui-mev` (783★, Rust arb bot, dominant by
  50×). Sui auction repos are all toys (≤4★). No auction example in `MystenLabs/sui`.

### 3.6 🔑 The trusted-auctioneer problem — our best hook
> This is the sharpest finding in the whole research. **Every production MEV/order-flow
> auction has a trusted or capital-gated auctioneer, and in the two cases where the
> operator has publicly addressed it, they admit it in their own words.**

- **F-49** **Flashbots on MEV-Share, verbatim:** the matchmaker is *"a trusted role,
  run by Flashbots"*, and the 90%-payback rule is *"enforced only by **social
  convention**, trusting that builders will respect them."*
  https://collective.flashbots.net/t/mev-share-programmably-private-orderflow-to-share-mev-with-users/1264
- **F-50** **CoW DAO on its own Autopilot, verbatim (Sep 2025):** it is *"a single
  point of failure for the entire CoW protocol,"* with censorship and regulatory
  exposure. Proposed fix (solver auctions on Pod Network) was **still pre-CIP,
  "more research needed."** https://forum.cow.fi/t/decentralising-cow-solver-auctions-using-pod-network/3173
- **F-51** 🔥 **The one live attempt to fix this by mechanism design made it worse.**
  CoW's **CIP-74** solver-reward reform (live 2025-12-08): volume-weighted **HHI
  concentration ROSE 0.176 → 0.241**. 3 solvers handle >50% of CoW volume; top
  solver Barter ~28.2% and *bought a rival's solver codebase*.
  https://arxiv.org/abs/2607.21955
  **→ Strongest empirical hook available: the reform entrenched the incumbent.**
- **F-52** **MEV-Share hints leak more than intended** — even *aggregated* hints
  permit inference attacks on individual users. https://arxiv.org/pdf/2508.14284
- **F-53** **1inch Fusion is stake-gated**: only whitelisted resolvers in the top 10
  by staked-1INCH "Unicorn Power" can fill. Criticised as a capital barrier
  reproducing bridge-style trust. **This is a sponsor's own documented pain point.**
- **F-54** **The OFA layer is consolidating into incumbents.** Atlas → **acquired by
  Chainlink 2026-01-22** (IP + personnel from FastLane; now exclusively serves
  **Chainlink SVR**). MEV Blocker → **Consensys Special Mechanisms Group, Jan 2026**.
  ETHGas → $12M Polychain seed, **ether.fi committed ~$3B ETH (~40% of its stake)
  under a 3-year exclusive**. **→ Competing on market share is hopeless. Competing
  on *verifiability of the auctioneer* is wide open.**
- **F-55** Restaking-backed slashing in this space barely exists: **Primev's real
  slashing lives on Symbiotic, not EigenLayer** (its `eigen-operator-cli` is stale
  since 2024-11-24), its **Oracle is owner-key restricted**, and **validators are
  not slashed directly**. **Puffer UniFi has NO slashing enforcement** until Phase 3.
  **Bolt was formally archived 2026-02-23.**
- **F-56** Directly on-point papers to read before designing:
  **"Open vs. Sealed: Auction Format Choice for MEV"** https://arxiv.org/abs/2603.16333 ·
  "Failure Costs for permissionless OFAs" https://arxiv.org/abs/2503.05338 ·
  "PROF: Protected Order Flow in a Profit-Seeking World" https://arxiv.org/abs/2408.02303
- **F-57** ⚠️ **Adjacent competitor to check:** PropellerHeads' **Turbine** — a
  TEE-based P2P batch solver on Phala Cloud explicitly aiming to eliminate
  latency-priority auctions and LVR. `propeller-heads/tycho` pushed 2026-09-02.

### 3.6b 🔥 Chainlink SVR / Atlas — live production MEV auction, open to us
- **F-58** **Atlas acquisition CONFIRMED.** chain.link press release **2026-01-22**,
  *"Chainlink Acquires Atlas by FastLane"*; PRNewswire wire copy same day; The Block
  covered it. It was an **IP acquisition + acqui-hire, not a company acquisition** —
  *"FastLane will continue to operate independently."* The press page carries
  `<meta name="robots" content="noindex">` and is absent from the sitemap, which is
  why it is unfindable by search.
  - **Atlas → only SVR: TRUE.** The Atlas RedStone deployment was deprecated.
  - **SVR → only Atlas: FALSE.** *"The Ethereum mainnet deployment of Chainlink SVR
    continues to use Flashbots MEV-Share, while Atlas enables the expansion of SVR
    to additional blockchain ecosystems."*
  - ⚠️ Atlas licence is **BUSL-1.1** (change date 2027-07-01 → GPLv2+) —
    **source-available, NOT open source.**
- **F-59** 🎯 **The Atlas solver gateway is OPEN AND UNAUTHENTICATED.**
  `wss://svr-bid-endpoint.chain.link/ws/solver` ·
  `{"jsonrpc":"2.0","id":1,"method":"solver_subscribe","params":["userOperations"]}`
  A 90-second capture pulled **47 live SVR auctions (~31/min)** across six chains
  (BNB 26, Arbitrum 11, Monad 5, Base 4, plus **Ink and HyperEVM — both
  undocumented**). Each message carries `auction_id`, `deadline`, and `hints`
  (`aggregator`, `medianPrice`, `forwardData`, `rawReport`) — **which feed is about
  to update and at what price, before it lands on-chain.** No key, no signup.
  **→ A free, live, real-time feed of a *production* MEV auction to demo against.**
- **F-60** SVR scale: **~$877.6M liquidation volume, $21.3M gross, $13.9M to the
  Aave DAO, 245 unique searchers.** Recapture ~89% on Base/Arbitrum vs ~52% on
  Ethereum. Dashboard: `svr.llamarisk.com`. Searcher onboarding is **permissionless**
  (*"does not require communication with Chainlink Labs"*).
- **F-61** ⚠️ **Zero SVR feeds on any testnet** (verified across six). Mainnet fork
  or nothing. Feed metadata naming is **inverted**: `secondaryProxyAddress` is the
  actual SVR proxy; `proxyAddress` is the standard opt-out one.
- **F-62** 🔑 **BOTH incumbents we'd demo against are permissioned:**
  **1inch Fusion caps resolvers at 10 slots requiring ≥5% of Unicorn Power**, and
  **Chainlink's Atlas reserves one of two bid slots for a high-reputation set.**
  **→ This is the opening slide. Chainlink bought MEV-auction infrastructure in
  January and runs a reputation-gated auction on it.**
- **F-63** **Chainlink CRE is viable in hackathon time** (revises an earlier doubt):
  `cre workflow simulate --broadcast` sends **real transactions to Sepolia/Base
  Sepolia** via the real KeystoneForwarder path; only consensus is single-node.
  Chainlink ran **"Convergence," a $120K+ all-CRE hackathon Feb 6 – Mar 8 2026**,
  with dozens of small-team winners — including one named `maskbid---the-dark-auction`.
  CLI v1.31.0, Windows PowerShell supported, self-service signup.
- **F-64** **Confidential Workflows need no early access** — *"Do not wait for early
  access. Simulate confidential workflows in minutes."* Confidential HTTP **GA since
  2026-02-25**; `handlerInTee`/`TeeRuntime` shipped in SDK **v1.18.0 on 2026-08-06**
  (four weeks old → thin field).
  ⚠️ **Honest limit:** *"Your handler's source code and compiled binary are not
  confidential just because part of its logic runs inside an enclave."* Data is
  hidden from node operators; **logic is public. Do not claim private business logic.**
- **F-65** ⚠️ **CRE structurally cannot win an MEV auction** — 30s minimum cron and
  5-minute timeout. It can monitor, decide and defend; it cannot race. Pitch accordingly.
- **F-66** Free win regardless of third track: point SwapVM's `OraclePriceAdjuster`
  at a Base `-shared-svr-2` proxy (ETH/USD `0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70`).
  Reading an SVR feed is permissionless; revenue share is BD-gated.

### 3.6c Project name — availability check (2026-09-03)
Checked via GitHub API search + DefiLlama protocol list. **Not exhaustive** — no
domain, ENS, npm, or trademark check performed; WebSearch budget was exhausted.

| Name | GitHub | DefiLlama | Verdict |
|---|---|---|---|
| **Candle** | No blockchain protocol found; all hits are candlestick-chart utilities | No match | ✅ Free as a protocol name, but ⚠️ heavy namespace noise ("candle" = candlestick charts) and **`huggingface/candle` is a well-known Rust ML crate** |
| **Gavel** | Only `Prasannaverse13/gavelguard-aiagent` (0★), descriptive use | No match | ✅ Clear |
| **Witness** | No protocol named Witness | No match | ✅ Clear, but ⚠️ "witness" is an overloaded ZK term (the private input) |
| **Glasshouse** | No match | No match | ✅ Cleanest |
| Vitrine / Aletheia | — | No match | ✅ Clear |

### 3.6d 1inch Aqua / SwapVM — decision-grade detail
- **F-67** **Track text (verbatim).** *"💧 Build an Aqua App — $5,000"* (🥇$2,500 /
  🥈$1,500 / 🥉$1,000) and *"💦 Build an Aqua App - Continuity Track — $2,000"*
  (🥇$1,500 / 🥈$500). **$7,000 total; $5,000 addressable if we are not Continuity.**
  Description, identical in both:
  > *"Create a custom Aqua app that implements a sophisticated DeFi position. If you
  > use SwapVM, you may modify SwapVM opcodes and define your own instructions. The
  > final positions must be demonstrated through tests scripts or a UI."*
  > *"Projects that utilize SwapVM will be scored higher during the final judging."*
- **F-68** **Qualification requirements (verbatim, complete list of three):**
  > - *"Official Aqua/SwapVM contracts must be used (**redeployments of a modified
  >   SwapVM contract is allowed**)"*
  > - *"Onchain execution of token transfers should be presented during the final
  >   demo (**local forks are ok**)"*
  > - *"Proper Git commit history (no single-commit entries on the final day)"*
  **→ Modifying opcodes is blessed in the description AND redeployment is blessed in
  the requirements. No video, no docs, no diagram required — lightest burden on the board.**
- **F-69** **Aqua** = shared liquidity layer / allowance registry, **not** an AMM or
  vault. Tokens stay in the LP's wallet; only virtual balances are tracked.
  `src/Aqua.sol` is **81 lines**, four verbs: `ship` / `dock` / `pull` / `push`.
  Build by inheriting `AquaApp` (69 lines). Reference app `XYCSwap.sol` = a full
  constant-product AMM in **184 lines**. Repo `1inch/aqua` 108★, Solidity 0.8.30,
  **Foundry**, created 2025-10-27. ⚠️ Licence `LicenseRef-Degensoft-Aqua-Source-1.1`
  — **source-available, NOT open source.** ⚠️ **No working docs site** — the READMEs
  and two whitepaper PDFs are the documentation.
- **F-70** ⚠️ *(register list CORRECTED by F-121: **four** registers, no `amountNetPulled`.)*
  **SwapVM** = *"A virtual machine for programmable token swaps."*
  Repo `1inch/swap-vm` 36★, **Hardhat 3**, created 2025-11-13, **pushed 2026-09-01**.
  Encoding `[opcode:1][args_len:1][args:N]`. Five mutable registers
  (`balanceIn, balanceOut, amountIn, amountOut, amountNetPulled`). Interpreter
  `ContextLib.runLoop()` ~35 lines, and **instructions can re-enter `ctx.runLoop()`**
  to execute the rest of the program then post-process — the hook that makes
  wrapping-style auction logic expressible.
- **F-71** **Opcode space: 256-entry enum, banked by family, `0xd0–0xef` = 32 FREE
  SLOTS.** Auction-relevant existing opcodes:
  - **`WhitelistSequential` (0x2d)** — `[start, nextPC, (duration, allowedTaker)[N]]`.
    A time-phased **cartel ladder**; the k-th taker unlocks at `start + Σdurations`;
    open fall-through after exhaustion. **This is the thing we are attacking.**
  - `WhitelistCoequal` (0x2c), `PrivateOrder` (0x2b) — flat list / single taker.
  - `DutchAuctionBalanceIn/Out` (0x94/0x95) — exponential decay.
  - `PiecewiseLinearScaleBalanceIn/Out` (0x98/0x99) — Fusion-shaped.
  - **`FeeProtocol` (0x80)** — flat **and surplus** fees, pluggable via
    `IProtocolFeeProvider`. *"Surplus fee is payed by maker… the difference is
    subject to surplus fee."* **→ A native price-improvement capture-and-route hook.
    Our MEV redistribution layer already exists in the VM.**
  - **`OraclePriceAdjuster` (0xb2)** — `IPriceOracle` is verbatim the **Chainlink
    `AggregatorV3Interface`**. **→ Free, genuine Chainlink integration.**
  - `ValidateSeriesEpoch` (0x48) — per-maker monotonic epoch. **Auction-round semantics.**
  - `Decay` (0x9c) — anti-sandwich; worsens the price of an immediate counter-swap.
- **F-72** ⚠️ *(reading REVISED by F-108: the 16-opcode set is **forced by EIP-170**, not
  a curation choice — `SwapVMRouter` at 29,159 B is undeployable.)*
  **The constraint that decides the architecture.** Three routers expose
  three opcode sets, and the deployed one is the most restricted:
  | Router | Set | Dutch | Whitelist | Oracle |
  |---|---|---|---|---|
  | `SwapVMRouter` | `Opcodes` (~40) | ✅ | ✅ | ✅ |
  | `LimitSwapVMRouter` | `LimitOpcodes` | piecewise only | ✅ | ❌ |
  | **`AquaSwapVMRouter`** ← **deployed at `0x1111…C0De`** | `AquaOpcodes` (**16**) | ❌ | ❌ | ❌ |
  **→ You cannot build an auction on the deployed Aqua router. That is exactly why
  the qualification text pre-authorises redeployment.**
- **F-73** **Three paths, ranked:**
  - **Path A (recommended, highest scoring):** deploy `MyRouter is Simulator, SwapVM,
    MyOpcodes` with the full `Opcodes` set **plus our auction opcode**. Aqua mode
    still works — it's a MakerTraits bit (254, `useAquaInsteadOfSignature`) handled in
    `SwapVM.sol` core, **not an opcode** — so our router still sources balances from
    the real deployed Aqua. Official liquidity + our opcodes.
  - **Path B (no redeploy):** **`Extruction` (0x04) is in EVERY opcode set including
    `AquaOpcodes`.** One interface, read of the full query, write to all registers,
    control of the program counter. Arbitrary auction logic **inside the officially
    deployed router.**
  - **Path C:** pure `AquaApp`, no SwapVM. Don't — SwapVM scores higher.
- **F-74** 🔴 **Mainnet only. No public testnet/devnet for Aqua.** Broadcasts cover
  chain IDs 1, 10, 56, 100, 130, 137, 146, 324, 4663, 8453, 42161, 43114, 59144 —
  **no Sepolia.** Deterministic addresses: **Aqua `0x1111113ccf1426a8e30e2bff5e005d929bf6a90a`**,
  **SwapVM router `0x111111338c5091e8440b67b168bae16a668ac0de`**.
  **→ Use a pinned Base mainnet fork** (the method `subvisual/sluice` documents).
  `swap-vm/DEPLOY.md` does ship a Sepolia Ignition config, so we can deploy *our*
  router to Sepolia — we just won't find Aqua there.
- **F-75** ❌ **PARTLY SUPERSEDED BY F-103** — the "10 slots" figure is help-centre
  policy and is **NOT in the contract source**. Do not put it on a slide.
  **Fusion's gate, verbatim:** *"you need a balance of staked 1INCH (st1INCH)
  tokens, meeting the minimum requirement of **5% of the total supply of Unicorn
  Power (UP)**… The **maximum limit of listed resolvers is 10**."*
  **→ Not "top 10 by stake" — a hard cap of 10 slots each requiring ≥5% of total UP,
  mathematically bounding eligibility at ≤20 entities.** Auction type is a **Dutch
  auction**. ⚠️ **NOT VERIFIED:** the production Fusion `Settlement`/registry contract
  that enforces this. It is documented as *policy* in the help centre. **Verify against
  Fusion settlement source before putting the code-level claim in the pitch.**
- **F-76** 🔴 **Build-time warning:** `viaIR` is on — **~7 min cold compile**, ~10s warm.
  Run `yarn build` on day 1. **Two toolchains:** `aqua` is Foundry (`forge test`),
  `swap-vm` is Hardhat (`npx hardhat test`).
- **F-77** **Judged against seven invariants** (from `PROGRAMS.md`): exact-in/out
  symmetry; **subadditivity** (splitting must gain nothing); quote/swap consistency;
  price monotonicity; rounding-favours-maker; balance sufficiency; strategy liveness.
  Asks for *"analytical proof (or strong formal/empirical evidence) of model stability."*
  ⚠️ **The cited `test/invariants/DutchAuctionLimitSwapInvariants.t.sol` was NOT found
  in the repo tree — see F-107. Do not assume a fork-ready Dutch harness exists.**
- **F-78** ❌ **CORRECTED — SUPERSEDED BY F-85.** Originally recorded `river-swap`
  as an ignorable 0★ repo. **That was wrong and nearly fatal.** See F-85.

### 3.6e 🚨 Consensus-2 / Reviewer A (originality) — corrections & surviving angle
> Verdict: **MAJOR REWORK.** Reviewer A read the repos and the ETHGlobal showcase
> directly. Two of our recorded facts were wrong.

- **F-85** 🚨 **CORRECTION TO F-78. `matcha-bros/river-swap` WON A 1INCH PRIZE.**
  It is listed on the ETHGlobal showcase under **ETHGlobal New York 2026** with a
  prize badge: *"Auction-Managed AMMs: market for liquidity provider optimization."*
  Not a 0★ curiosity — 529KB, three auction managers, 30 Forge scripts, full React
  frontend, Playwright e2e, built in a ~23-hour sprint.
  **→ `M-3` (am-AMM) is STRUCK. Building it means rebuilding a project that already
  took 1inch money at an ETHGlobal event three months ago, in front of the same
  judges.** `ProaqctiveMM` (Buenos Aires, prize badge) is the same pattern again.
- **F-86** 🚨 **The 1inch track is MATURE, not fresh — it has run at ≥3 prior events.**
  Catalogued corpus (15+): ArcBook, KSwap-VM, Agora Markets, Aquapilot, Sluice,
  Superpose, QilinSwap, Baywatch, ScubaSwap, wave, Votive, Aqua Prime, RiverSwap,
  ProaqctiveMM, Aqua0, `yellowBirdy/aqua-propAMM`, `skyMetaverse/1inch-aqua`.
  ⚠️ **Bytecode-composition tooling is triple-mined** (Aquapilot, QilinSwap, wave,
  Sluice) — do not go near it.
- **F-87** 🔴 **The objection that would destroy us in Q&A.** *"We remove the
  auctioneer by making the auction BE the settlement program"* is **already true of
  stock SwapVM** — 1inch wrote `DutchAuctionBalanceIn/Out` (0x94/0x95) and
  `PiecewiseLinearScale` (0x98/0x99) themselves, with a fork-ready invariant suite.
  Worse, the auction-theory version: **a Dutch auction is strategically equivalent to
  a first-price sealed-bid auction** (textbook). A plain first-price sealed-bid taker
  auction is **isomorphic to opcode 0x94**. And `KSwap-VM` — formal semantics and
  verification of swap-vm — **won a badge**, so 1inch sends judges who reward exactly
  that kind of rigour. **They will make this objection.**
- **F-88** ✅ **THREE GAPS SURVIVE across the whole 15+ project corpus:**
  1. ❌ **FALSIFIED BY F-104 — `mcmoodoo/baywatch` shipped three custom opcodes.**
     This is NOT a differentiator; it is table stakes. *(Original claim retained below
     for the record.)* RiverSwap *planned* one
     (`docs/plans/05-accounted-dynamic-fee-opcode.md`) and explicitly deferred it:
     *"This plan only covers the opcode… It does not integrate the opcode into DAMM
     contracts, SDK pool modes, app flows, or rent distribution."* Its router is a
     stock wrapper (`contract LocalAquaSwapVMRouter is AquaSwapVMRouter`) with **no
     `_runOpcode` or `_dispatch` override**. Sluice handles opcodes via
     `config/opcodes.8453.json` — **configuration only**.
     **→ A shipped, tested custom opcode is the thing every team plans and nobody
     finishes. That alone differentiates, and the track text pre-authorises it.**
  2. **Every existing auction on Aqua is MAKER-side** — RiverSwap auctions the
     *manager role* per epoch, off the swap path, rent-based ascending
     (`require(rentAmount > currentBid.amount, BidTooLow(...))`). ProaqctiveMM and
     `aqua-propAMM` are the same family. **Auctioning *who gets to take this order*
     is a different axis and is empty.**
  3. **Nobody has touched `WhitelistSequential`.** The permissioned-taker problem is
     **unattacked in the entire corpus.**
- **F-89** ✅ **THE SURVIVING PITCH — use this wording, not the old thesis:**
  > *SwapVM allocates taker priority two ways: by **identity** (`WhitelistSequential`
  > — a hardcoded cartel ladder) or by **clock** (`DutchAuctionBalanceIn` — a
  > descending price). Neither allocates by **bid**. The clock version has the worse
  > problem: a descending auction is won by whoever is **fastest**, not whoever values
  > it most — and that latency race **is** the MEV. Glasshouse adds the missing
  > opcode: taker priority allocated by **sealed competitive bid with a committed
  > close**, so the winner is the highest bidder, not the fastest bot.*

  **Why this dodges the Dutch-equivalence trap:** Dutch ≡ first-price only in a
  *frictionless* model. Once latency exists, the descending clock systematically
  awards to the lowest-latency participant **regardless of valuation**; a sealed-bid
  batch with a committed close does not. **That difference IS the extractable value,
  and it is measurable** — which supplies both the demo and the subgraph metric.
- **F-90** ⚠️ **Two hard constraints that follow from F-89:**
  1. **The mechanism must NOT be plain first-price sealed-bid.** Build the
     **committed / randomised close** (i.e. a candle auction), or go **second-price**
     (equivalent to English, not Dutch).
  2. **Benchmark against `DutchAuctionBalanceIn` (0x94) directly**, not a strawman.
     Same order under 0x94 vs. our opcode, with a **latency-differentiated bidder
     set**. **If we cannot beat 0x94 on user price, we have nothing.**
- **F-91** ⚠️ Reviewer A's own caveats: it did not verify *which* sub-prize RiverSwap's
  badge was for (showcase shows counts, not names) — worth one fetch. And GitHub
  code-search returned 401 unauthenticated, so *"nobody shipped a custom opcode"*
  rests on reading repos directly — **strong but not airtight.**

### 3.6f The Graph — track detail
- **F-79** **$15,000 = three sub-tracks of $5,000 each** (🥇$2,500/🥈$1,500/🥉$1,000).
  **All equal — there is no "largest" sub-track.**
  1. *Best Use of Composable or Standardized Graph Products* — **$5,000**
  2. *Best AI Tooling or AI Use Case — From Scratch* — **$5,000**
  3. *Best AI Tooling or AI Use Case — Continuity* — **$5,000**
- **F-80** **The no-mock rule, identical in all three (verbatim):**
  > *"Consume live data from a Graph provider… **Mocked, local-only, or static
  > datasets do not qualify.**"*
  ⚠️ This collides with F-74 (Aqua is mainnet-only, we demo on a fork). **The subgraph
  must index a real deployed contract on a supported live network, not our fork.**
- **F-81** **Composable track disqualifier (verbatim):** *"Simply querying one Subgraph
  with no composition or standardization does not qualify."* **→ Minimum is two Graph
  products on the runtime path, or one standardized schema.** Cheapest qualifying
  combo: **a Messari-schema-conformant subgraph + the Subgraph MCP over it** — satisfies
  both halves of the either/or at once.
  ⚠️ `messari/subgraphs` is 557★ but **last pushed 2025-03-25 (~17mo stale)**. Use its
  `.graphql` files as a **spec** in a fresh `graph init`; don't build inside that repo.
- **F-82** Networks (registry v0.7.118, updated 2026-09-02): mainnet, sepolia, base,
  base-sepolia, arbitrum-one, unichain all support subgraphs with `issuanceRewards:
  true`. **Traps:** `unichain-sepolia` is only an alias — real id `unichain-testnet`,
  and it **cannot be published** (`issuanceRewards: false`). **Base Sepolia has no
  `sps`.** **Recommended: Base Sepolia** — publishable, and pairs with the Base
  mainnet fork we already need for Aqua.
- **F-83** ⚠️ **Studio limits that bite on deadline day:** dev query URL capped at
  **3,000 queries/day**; **max 3 deployed unpublished subgraphs** per account;
  publishing is an **on-chain tx on Arbitrum One** — hold ETH there before Sep 13.
- **F-133** ✅ **KICKOFF RE-PULL (2026-09-04) — both pending sponsors now published.**
  - **Ledger — $5,000:** *"🤖 AI Agents x Ledger"* **$3,500** (🥇$2,000/🥈$1,000/🥉$500)
    + *"🛣️ Continuity"* $1,500. Requires building on the **Ledger Agent Stack**
    (*"Ledger Key Ring CLI (wallet-cli ring)"*), with *"device-backed security central
    to the product."* ❌ **Not a fit for Glasshouse — skip.**
  - **Chainlink — "Best Confidential Workflow" $2,500** (up to 2 teams @ $1,250; note
    this is $2,500 not the $2,000 earlier estimated) + *"Best Chainlink-Powered
    Upgrade"* $500 (Continuity only). Requires: *"Build a CRE Workflow that uses the
    Confidential Workflows"*, *"must register and use a confidential TEE handler"*,
    and process *"at least one sensitive input… inside the enclave."*
    ❌ **CONFIRMS F-96 — our `OraclePriceAdjuster` integration does NOT qualify.
    Third track stays UNISWAP.**
  - ✅ **1inch and The Graph verified UNCHANGED** — "Build an Aqua App" $5,000 +
    Continuity $2,000; Graph three × $5,000.
- **F-84** 🚩 *(RESOLVED at kickoff — see F-133.)* **Was unpublished:** Chainlink's *Best Confidential Workflow* ($2,000)
  reads *"Coming soon…"* — **80% of Chainlink's pool has zero published criteria.**
  Ledger ($5,000) is entirely *"Prize details coming soon."* **Re-pull Sep 4.**
  1inch's and The Graph's text is **final** and quoted above.

### 3.6g 🚨 Consensus-2 / Reviewer C (track fit) — QUALIFIES WITH FIXES
- **F-92** 🔴 **OUR GRAPH PLAN WAS DISQUALIFIED AS DESIGNED.** *"Mocked, local-only,
  or static datasets do not qualify."* **A pinned Anvil fork cannot be indexed by
  Subgraph Studio** — Studio indexes real networks from the registry. There is no
  path where a local fork produces a live subgraph.
  ✅ **FIX (non-negotiable, and better than what it replaces): deploy to Base
  MAINNET for real.** Aqua is live on Base at the deterministic address; Base gas is
  cents. Deploy our modified router, `ship()` a small strategy through the real Aqua,
  run real auctions with dust amounts, point the subgraph at `base`. This satisfies
  1inch's on-chain-execution requirement **more strongly** than the fork concession,
  and satisfies The Graph's live-data rule exactly. *"This is running on Base mainnet
  right now"* also beats *"here's a fork"* as a demo line.
  *Fallback (strictly worse):* deploy the router to Base Sepolia in **EIP-712
  signature mode** — Aqua is opt-in via MakerTraits bit 254, so the router runs
  without it — and keep the fork only for the Aqua-integrated 1inch demo.
- **F-93** 🔴 **Second Graph failure:** a single bespoke subgraph computing HHI is
  **exactly** what *"Simply querying one Subgraph with no composition or
  standardization does not qualify"* excludes.
  ✅ **FIX (non-negotiable): Messari-schema-conformant subgraph + Subgraph MCP over
  it** — hits both halves of the either/or at once. ~half a day.
- **F-94** ✅ 🔑 **THE PARTNER-PRIZE CAP IS RESOLVED — and we were under-counting.**
  From `/events/ethonline2026/info/details`, verbatim:
  > *"select up to **3 Partner Prizes** to apply for"*
  > *"**If a partner has multiple tracks, you can be eligible for all of them while
  > only counting as 1 Partner Prize**"*
  **→ The cap is on partner ORGANISATIONS, not sub-tracks. The Graph's three
  sub-tracks consume ONE slot and we are eligible for all of them.**
- **F-95** ✅ 🔑 **Reframes the whole top-20% anxiety.** Same page, verbatim:
  > *"the majority of prizes are paid out to projects that **do not** advance"*
  **→ Not advancing to live judging is not losing. Optimise for per-track
  qualification over global wow factor.**
- **F-96** ✅ **Third track = UNISWAP, not Chainlink, and it isn't close.**
  Our `OraclePriceAdjuster` → Chainlink feed integration **does not qualify for
  "Best Confidential Workflow"** (that needs a CRE confidential workflow — separate
  work, and CRE's 30s cron floor means it structurally cannot participate in an
  auction). Chainlink's $500 track that our oracle work *would* fit is **Continuity —
  closed to us as net-new.** Chainlink's money is unreachable without ~2 days of
  unrelated work against criteria we cannot read until Sep 4.
  Uniswap, verbatim: *"Build on or integrate any part of the Uniswap stack, including
  the **Uniswap API**, the Uniswap AMM (v2, v3, or v4), CCA, or any other Uniswap
  protocol."* **→ Use the Uniswap API as the benchmark price against which we
  demonstrate price improvement.** Coherent, ~half a day, and it strengthens the core
  demo. Requires `FEEDBACK.md` + Developer Feedback Form + README pointing at
  specific contracts/lines.
- **F-97** ⚠️ **Wildcard to check Sep 4, not plan around: Arc ($10,000)** — *"DeFi,
  agentic, and mainnet deployment"*, twice Uniswap's size. But **Aqua is not deployed
  on Arc**, so the "official Aqua contracts" requirement cannot be met there.
  World / Privy / ENS / Hedera / Bazantic are poor fits. World's Selfie Check
  ($3,500) is more coherent than it looks (permissionless entry genuinely needs sybil
  resistance) but **identity fights the pseudonymity that makes searcher markets
  work** — skip.
- **F-98** 🎯 **RECOMMENDED STACK: 1inch ($5,000) + The Graph ($10,000) + Uniswap
  ($3,000) = $18,000 addressable.** (Continuity sub-pools are closed to us as net-new.)
- **F-99** ⚠️ **MORE PRIOR ART — our exact three-track stack already exists.**
  **`mcmoodoo/baywatch`** — *"prices cross-protocol toxic flow into on-chain defense
  — **The Graph standardized subgraphs + 1inch Aqua/SwapVM + Uniswap v4**"*. Also
  `ander-deran-arteaga/vortex`, `yellowBirdy/aqua-propAMM`, `virajbhartiya/turing-pool`
  (Aqua + Graph + World). All 0★ hackathon entries — **but 1inch likely judges this
  track with the same people who judged Lisbon.**
  **→ Never pitch "auction-managed AMM." They have seen it three times.**
- **F-100** 📊 **Honest scoring vs. the five criteria:**
  | Criterion | Score | Note |
  |---|---|---|
  | Technicality | **8.5** | Custom opcode, seven invariants — our strongest axis |
  | Originality | **6** | ⚠️ downgraded by F-85/F-99 prior art |
  | Practicality | **6.5** | Real named problem |
  | **Usability** | **3** | 🔴 **WEAKEST — scored in BOTH rounds** |
  | WOW | **7.5** | The A/B bytecode-diff demo is genuinely strong |
  🔴 **Usability fix (~1.5 days): a minimal dashboard** — live HHI concentration chart
  from the subgraph, live auction view, A/B price comparison. **Pays for itself three
  times:** lifts Usability 3 → ~7, *is* the Subgraph-MCP consumer that satisfies F-93's
  two-product rule, and becomes the demo video instead of a screen recording of
  `forge test`.
- **F-101** ⚠️ **The AI agent question, answered.** Because of F-94 we can target
  Composable **and** AI-From-Scratch in one slot — so it is no longer a trade-off.
  Genuine version: an agent that reads auction outcomes from the subgraph, detects
  rising solver concentration, and **automatically retunes auction parameters**
  (reserve price, duration, whether to open the ladder) — closed-loop automation,
  qualifies as *"reusable infrastructure, not a single end-user app."*
  ⚠️ **But removing it does not break the product, so it IS a bolt-on.** Build it
  **only if ≥2 days remain**, and **never call it an "AI agent"** — call it
  **adaptive reserve pricing driven by live concentration data.** Same code, reads as
  mechanism design rather than prize-chasing.

### 3.6h Direct verification (main agent, 2026-09-03) — two load-bearing claims
- **F-102** 🔴 **RiverSwap's prize CONFIRMED at source, and it is worse than feared.**
  `https://ethglobal.com/showcase/riverswap-bat5v` — **"1inch - Build an Aqua App
  1st place"**, ETHGlobal New York 2026. Repo `github.com/matcha-bros/river-swap`.
  Description: *"auction-managed automated market maker built on 1inch SwapVM and
  Aqua… uses auctions to determine trading fees and leverages Aqua's shared liquidity
  layer to keep LP assets in self-custodial wallets."*
  **→ It won FIRST PLACE in the exact track we are entering. `M-3` (am-AMM) is
  definitively struck, and "auction determines fees on Aqua" is now a *losing* pitch:
  the judges awarded it first place already.** Confirms F-85; upgrades its severity.
- **F-103** ⚠️ **The Fusion gate — PARTIALLY verified, and the "10 slots" claim does
  NOT hold up.** Read `1inch/limit-order-settlement/contracts/WhitelistRegistry.sol`
  at source. Contract inventory: `WhitelistRegistry.sol`,
  `CrosschainWhitelistRegistry.sol`, `Settlement.sol`, `SimpleSettlement.sol`,
  `PowerPod.sol`, `KycNFT.sol`.
  - ✅ **VERIFIED — the capital threshold is real and on-chain:**
    `uint256 public resolverPercentageThreshold;` ·
    `uint256 public constant BASIS_POINTS = 10000;` · enforced as
    **`balance * BASIS_POINTS >= totalSupply * resolverPercentageThreshold`** ·
    registration reverts unless `_isValidBalance(...)` passes.
  - ❌ **NOT FOUND — there is NO max-resolver constant in this contract.** No
    `MAX_WHITELISTED`, no `whitelistLimit`, no 10-slot cap. The help-centre's *"maximum
    limit of listed resolvers is 10"* (F-75) is **not present in the current source** —
    likely stale docs or a removed mechanism.
  - ⚠️ The contract reads `TOKEN.balanceOf(msg.sender)` and **contains no "Unicorn
    Power" naming**; UP is the off-chain name for that token balance (see `PowerPod`).
  - 🎯 **PITCH RULE:** claim *"resolver eligibility is gated on-chain by a
    percentage-of-total-supply capital threshold — `resolverPercentageThreshold`,
    enforced in `WhitelistRegistry.sol`"*. **Do NOT claim a hard-coded 10-slot cap.**
    The verified version is cleaner anyway: a capital barrier we can point at in code.

- **F-104** ⚠️ *(extension pattern SUPERSEDED by F-123: the `_opcodes()` array API is
  GONE at HEAD — override `_runOpcode` instead. The falsification below still stands.)*
  🔴 **REVIEWER A's GAP #1 IS FALSIFIED. `mcmoodoo/baywatch` DID ship
  custom SwapVM opcodes.** Read at source, 2026-09-03:
  - `src/opcodes/SharedOpcodes.sol` **overrides `_opcodes()`** (not `_runOpcode`)
    and appends **three instructions at indices 34, 35, 36** to the base AquaOpcodes
    table (0–33), using assembly to adjust array length — the same pattern as upstream.
  - `src/instructions/`: `ParamLoad.sol` (op 34), **`ToxicFlowToll.sol` (op 35)**,
    `DepegCircuitBreaker.sol` (op 36). Plus `src/routers/SharedAquaRouter.sol`.
  - `ToxicFlowToll._toxicFlowToll(Context memory ctx, bytes calldata args)` validates
    pre-swap, staticcalls an oracle for taker-specific toll, adjusts amount with
    **`Math.ceilDiv` (rounding favours maker)**, then **re-enters `ctx.runLoop()`** —
    exactly the wrapping pattern we planned to use.
  - Its README *says* it "composes existing opcodes"; **the source says otherwise.**
  - Tracks targeted: **The Graph** (*"Composes two Graph products (a Standardized
    Subgraph + the Subgraph MCP) over live data"*) + **1inch** (*"Custom SwapVM
    opcodes power an advanced AMM"*) + a **Uniswap v4 hook** (`src/v4/BaywatchV4Hook.sol`).
  - ⚠️ **No `subgraph.yaml` in the repo** — they satisfied The Graph by *consuming*
    a Messari standardized subgraph + MCP, not authoring one. Cheaper than our plan.

  🚨 **CONSEQUENCES — this is our exact stack and our exact technique:**
  1. ❌ **We CANNOT claim "first/only custom SwapVM opcode."** It is table stakes on
     this track, not a differentiator. Striking that from F-88 gap #1.
  2. ❌ **We cannot claim novelty for the re-entrant `runLoop()` wrapping pattern.**
  3. ❌ **1inch + Graph(Messari+MCP) + Uniswap v4 is a stack a prior team already ran.**
  4. ✅ **What SURVIVES, and it is now our ONLY differentiator:** Baywatch's opcodes
     are **maker-side defensive pricing** — they *toll* and *penalise* flow by
     identity. **Allocating taker priority BY BID is untouched**, and
     **`WhitelistSequential` remains unattacked by anyone.**
  **→ The differentiator narrows to exactly one claim: priority by sealed bid rather
  than by identity or by clock. Everything else about our plan has precedent.**
  ⚠️ Two viable extension patterns now confirmed: override `_opcodes()` (Baywatch) or
  override `_runOpcode`/`_dispatch` (the docs' `*Debug` pattern). Baywatch appended at
  34–36 rather than using the free `0xd0–0xef` bank.

### 3.6i 🎯 Source-verified core — the two opcodes our pitch stands on
Read from `1inch/swap-vm@main` source, 2026-09-03. Instruction libraries are grouped
by family: `src/instructions/Whitelist.sol`, `DutchAuction.sol`, `Balances.sol`,
`PiecewiseLinearScale.sol`, `FeeProtocol.sol`, `Extruction.sol`, `OraclePriceAdjuster.sol`,
`Decay.sol`, `SeriesEpochManager.sol`. Core: `src/libs/OpcodeList.sol`,
`src/opcodes/{Opcodes,AquaOpcodes,LimitOpcodes}.sol`,
`src/routers/{SwapVM,LimitSwapVM,AquaSwapVM}Router.sol`.

- **F-105** **`WhitelistSequential` — full source.** Args
  `[uint40 start, uint16 nextPC, (uint16 duration, uint80 allowedTaker)[N]]`.
  ```solidity
  function exec(Context memory ctx, bytes calldata args) internal view {
      uint80 sender = uint80(uint160(ctx.query.taker));
      uint256 timeLeft = block.timestamp;
      uint40 start = parseStart(args);
      require(timeLeft >= start, WhitelistSequentialTimeViolation());
      unchecked { timeLeft -= start; }
      uint256 count = parseTakersCount(args);
      for (uint256 i; i < count; i++) {
          (uint16 duration, uint80 allowedTaker) = parseTaker(args, i);
          if (sender == allowedTaker) { ctx.setNextPC(parseNextPC(args)); return; }
          require(timeLeft >= duration, WhitelistSequentialTimeViolation());
          unchecked { timeLeft -= duration; }
      }
  }
  ```
  Three things worth naming on stage:
  1. **Identity is a truncated address** — only the **low 80 bits** are compared.
  2. **The ladder is exclusionary, not merely preferential**: a non-listed taker hits
     `require(timeLeft >= duration)` and **reverts** until the *entire cumulative*
     ladder has elapsed. Privileged takers get exclusive early windows.
  3. **Open fall-through**: if the loop completes with no match, execution continues
     normally — anyone may fill, but only after serving the full ladder.
  `internal view`; no state, no `runLoop`.
- **F-106** 🔥 **`DutchAuction` — and this is our strongest technical argument.**
  Args `[uint40 start, uint16 duration, uint64 decay]`, `ONE = 1e18`.
  ```solidity
  uint256 elapsed = block.timestamp - start;
  ctx.swap.balanceIn  = ctx.swap.balanceIn * uint256(decay).pow(elapsed, ONE) / ONE;   // In
  ctx.swap.balanceOut = ctx.swap.balanceOut * ONE / uint256(decay).pow(elapsed, ONE);  // Out
  ```
  `require(block.timestamp <= start + duration, DutchAuctionExpired(...))`;
  `require(decay < ONE, DutchAuctionWrongDecayFactor(decay))` at build.
  **`internal view`. Does NOT call `ctx.runLoop()`.**

  🎯 **THE ARGUMENT, now provable from source rather than asserted:**
  > The auction price is a **pure function of `block.timestamp`**. Every transaction
  > in a block shares one timestamp, so **every bidder in that block faces an
  > identical price.** Valuation therefore cannot break the tie — **allocation is
  > decided purely by intra-block transaction ordering**, i.e. by priority fee and
  > builder placement. The surplus above the posted price is competed away into
  > **priority fees paid to the builder/validator**, not returned to the maker or the
  > user. **The descending clock does not price the order; it runs a latency auction
  > whose proceeds leak out of the protocol.**

  **→ That is precisely what a sealed-bid batch with a committed close fixes: price
  is set by the bids, so the surplus lands with the maker/user instead of the builder.**
  **→ It also defeats the Dutch-≡-first-price objection (F-87) at the code level**,
  not just in theory: the equivalence assumes a continuous clock and no ordering
  externality; `block.timestamp` granularity plus builder-controlled ordering breaks
  both assumptions.
- **F-107** ❌ **WRONG — SUPERSEDED BY F-122.** `DutchAuctionLimitSwapInvariants.t.sol`
  DOES exist at HEAD and IS our harness. *(Original, mistaken, below.)*
  Invariant tests actually present: `test/invariants/{CoreInvariants,
  MinRateInvariants, PeggedSwapInvariants, TWAPLimitSwapInvariants,
  XYCFeesInvariants}.t.sol`. **The `DutchAuctionLimitSwapInvariants.t.sol` cited
  earlier was NOT in the tree listing** (listing may have been truncated) —
  **verify before relying on it as a fork-ready harness.**

### 3.6j 🚨 Consensus-2 / Reviewer B (feasibility) — DESCOPE. It compiled the repo.
- **F-108** 🔴🔴 **PATH A AS SPECIFIED IS PHYSICALLY IMPOSSIBLE — EIP-170.**
  Measured deployed bytecode vs. the 24,576-byte limit:
  | Router | Size | Status |
  |---|---|---|
  | `SwapVMRouterDebug` | 32,586 | over by 8,010 |
  | **`SwapVMRouter`** (full `Opcodes`) | **29,159** | 🔴 **over by 4,583 — NOT DEPLOYABLE** |
  | `LimitSwapVMRouterDebug` | 24,136 | ok (440) |
  | `AquaSwapVMRouterDebug` | 23,805 | ok (771) |
  | `LimitSwapVMRouter` | 20,712 | ok (3,864) |
  | **`AquaSwapVMRouter`** | **20,376** | ✅ **ok (4,200 headroom)** |
  solc says so directly: *"Warning: Contract code size is 29159 bytes and exceeds
  24576 bytes (a limit introduced in Spurious Dragon)… may not be deployable"* →
  `src/routers/SwapVMRouter.sol:16`. **It compiles — it's a warning, not an error — so
  this would not surface until a deploy reverts on day 7.**
  **→ `AquaSwapVMRouter` ships 16 opcodes because it HAS to, not by curation (revises
  F-72's reading).**
  **→ Only viable Path A: start from `AquaSwapVMRouter` (4,200 B headroom). But our
  headline demo needs `WhitelistSequential`, which is NOT in `AquaOpcodes` — so those
  4,200 bytes must absorb BOTH `WhitelistSequential` AND our auction opcode.** A
  ~150-LOC instruction library is 1–3 KB. It fits, barely, with no room for the
  Dutch-auction or oracle opcodes.
  **→ This is the single strongest argument for Path B (`Extruction`), which puts
  logic in a separate contract and sidesteps the size budget entirely.**
- **F-109** 🔴 **Environment blocks us twice before any code is written** (reproduced):
  - Node **18.17.0** → `yarn install` fails: *"@metamask/eth-sig-util@8.0.0: The engine
    'node' is incompatible… Expected '^18.18 || ^20.14 || >=22'"*
  - Node **22.11.0** → *"You are using Node.js 22.11.0 which is not supported by
    Hardhat. Please upgrade to Node.js 22.13.0 or later."*
  **→ Need Node ≥ 22.13.0. Foundry is NOT installed** (`aqua` is Foundry-only, but it
  can be consumed as a dependency).
- **F-110** **Realistic opcode cost: 18–35 h ≈ 2.5–4.5 solo days**, not "a few hours."
  Instruction libraries are 46–272 LOC (median ~130); `Whitelist.sol` is 225 LOC for
  three opcodes. Router wiring is trivial. **The real sink is the encoding layer** —
  `MemoryPtr`/`InstructionBuilder`/`InstructionArgs`, `pushHeader`, `patchLength`,
  `.at(offset).asU80()`, hand-computed offsets like `uint256 shift = (5 + 2) + n * 12;`.
  **Off-by-one byte-offset bugs are SILENT — garbage values, not reverts.**
- **F-111** ✅ **THE INVARIANTS FEAR IS UNFOUNDED — drop it.** `CoreInvariants.t.sol`
  ships explicit skip flags: `skipAdditivity` *(for non-AMM orders)*,
  `skipMonotonicity` *(for flat rate orders)*, `skipSpotPrice`, `skipSymmetry`.
  `PROGRAMS.md` scopes invariants per category and names auctions as first-class:
  *"Static balances: fixed-rate, stateless execution; typically used for 1D strategies
  (limit orders, **auctions**, RFQ-like flows)."* Monotonicity carries *"unless
  explicitly intended."* A gating opcode is **category 4, Conditional Flow**, whose
  focus is *"Authorization/gating correctness."* `TWAPLimitSwapInvariants` already
  ships TODOs saying *"TWAP violates standard invariants due to time and state
  dependencies"* — in-tree precedent for skipping.
- **F-112** 🔴 **THE REAL TRAP: `quote()` vs `swap()` static context.** `quote()` sets
  `isStaticContext: true`, `swap()` sets `false`, **both run the same program**.
  `Extruction` documents it: *"in swap mode extruction target may update storage
  affecting future executions while in quote mode storage could be only read."*
  **→ If our auction opcode mutates state, quote and swap diverge and we break
  quote/swap consistency — an invariant named in every category.**
  **→ MANDATE: the opcode must be strictly READ-ONLY. All mutation happens in a
  separate settlement transaction.**
- **F-113** ✅ **We are NOT forced onto a fork** (corrects the premise behind F-92).
  `useAquaInsteadOfSignature` is MakerTraits **bit 254, handled in `SwapVM.sol` core —
  not an opcode** — so our router runs in signature mode with no Aqua at all.
  `PROGRAMS.md`: *"SwapVM strategy composition works both with Aqua-backed settlement
  and without Aqua."* Ranked: **(1) deploy our router to Base mainnet — real Aqua,
  real events, publishable subgraph, one environment satisfies both tracks, costs a
  few dollars of L2 gas**; (2) Base Sepolia signature mode; (3) fork only — **fails
  The Graph outright**.
- **F-114** 🔴 **THE GRAPH PROBLEM NOBODY ELSE RAISED.** Our subgraph would index
  **our own auction with our own synthetic bidders**. *"Live solver-concentration HHI"*
  over three wallets we control **is not a finding, it is a rounding error**, and a
  judge sees that instantly. **→ Either index a real production dataset for the
  analysis, or drop the HHI story and index our mechanism honestly. Do not present a
  toy market as a market.**
- **F-115** 🎯 **THE MVP, and it is cheap:** *one Solidity test running the same
  program twice — once with `WhitelistSequential` (cartel ladder), once with our
  auction opcode — printing the two prices the user receives.* That is the entire
  thesis as a bytecode diff, it satisfies *"tests scripts or a UI"*, and it needs **no
  frontend, no subgraph, no deployment. Build it FIRST.**
- **F-116** **Cut order (drop in this sequence):**
  | # | Component | Why first to go |
  |---|---|---|
  | 1 | Chainlink `OraclePriceAdjuster` | Costs bytecode headroom we don't have; criteria unpublished |
  | 2 | HHI / concentration analytics | F-114 makes it unconvincing anyway |
  | 3 | Subgraph MCP (2nd Graph product) | Cutting it = **cutting The Graph entirely** (F-93) |
  | 4 | Sealed bids / commit–reveal | Ship a public-bid auction and say so honestly |
  | **∞** | **Two-run comparison test + opcode + deployed router** | **NEVER CUT — this is the submission** |
- **F-117** 🔴 **LICENCE TRAP — real disqualification risk.** Aqua and SwapVM are
  `LicenseRef-Degensoft-*-Source-1.1` — **source-available, NOT open source.** The
  Graph's AI tracks require *"Open-source the code"*; ETHGlobal requires new work be
  open source. **→ Do NOT vendor 1inch source into our repo under a permissive
  licence. Consume as dependencies; licence only our own code.**
- **F-118** ⚠️ **`M-1` (zkVM) and `M-2` (threshold crypto) are BOTH OUT OF SCOPE at
  this timeline.** Ship a public-bid or commit–reveal auction.
- **F-119** **Other verified time sinks:** viaIR cold compile (~7 min documented;
  B's measurement was `src`-only and *optimistic* — 97 test files uncompiled, and
  `yarn snapshot` runs `hardhat clean` forcing a full rebuild) · **Hardhat 3 does not
  auto-load `.env`** (config vars or encrypted keystore only) · **Base is not in
  `hardhat.config.ts`** (`localhost`/`sepolia`/`mainnet` only — must add network +
  Ignition params) · **events must be designed day 1** (retrofitting = redeploy +
  full resync) · **HHI in AssemblyScript has no floats** (compute components in the
  mapping, divide in the frontend) · the human-narrated video is **3–5 h**.

### 3.6l Defects found by testing (2026-09-05)
- **F-134** 🔴 **Two real defects in `GlasshouseBook`, both found by writing tests, neither
  caught by three rounds of design review.**
  1. **The running top-2 dropped a legitimate winner.** A maker may set `reserveBps = 0`,
     which makes `bps = 0` a valid bid. On an empty book that satisfied neither
     `bps > a.bestBps` (0 > 0) nor `bps > a.secondBps`, so the only revealed bidder
     silently failed to become the winner and the auction closed with **no winner at
     all** — the bidder's bond returns, but the maker loses the fill. Fixed by seeding
     explicitly on `a.best == address(0)`.
  2. **`open()` accepted `exclusiveBlocks = 0`**, which reintroduces F-120 exactly: with
     no exclusive window an outsider fills at the base price in the same block the
     winner would fill at the improved one, so **bidding is strictly dominated by not
     bidding**. The mechanism now refuses the configuration.
  **→ Lesson worth keeping: F-120 was caught by review, but the *configuration* that
  recreates it was not. Design review checks the mechanism; only tests check the
  parameter space around it.**

### 3.6k 🏗️ Architecture review (Fable, 2026-09-03) — source corrections
> Read from `1inch/swap-vm@08089a1` (main, 2026-09-01), local clone. Files read in full:
> `SwapVM.sol`, `VM.sol`, `LimitSwap.sol`, `Balances.sol`, `DutchAuction.sol`,
> `Whitelist.sol`, `Extruction.sol`, `InstructionArgs.sol`, `OpcodeList.sol`,
> `AquaOpcodes.sol`, `AquaOpcodesDebug.sol`, `AquaSwapVMRouter.sol`, `IMakerHooks.sol`,
> `hardhat.config.ts`, `MakerTraits.sol`, `PROGRAMS.md`, `CoreInvariants.t.sol`,
> `DutchAuctionLimitSwapInvariants.t.sol`.

- **F-120** 🔴 **THE MECHANISM HOLE NOBODY ELSE CAUGHT — bidding was strictly dominated.**
  The v1 design let non-winners **fall through to the base price at any time**. That means
  the winner pays *more* for the same fill an outsider gets *cheaper in the same block* —
  so **rational agents never bid, and the auction has no bidders.** The "permissionless by
  construction" framing was economically self-defeating.
  ✅ **FIX:** the winner buys an **exclusive window** (`revealEnd + exclusiveBlocks`);
  outsiders **revert** inside it (the same gate `WhitelistSequential` applies), and the
  order opens at base price afterwards. Bids have value, liveness is preserved, and the
  winner-no-show case is exactly what bond forfeiture is for.
- **F-121** ❌ **CORRECTS F-70. `SwapRegisters` has FOUR fields, not five** —
  `balanceIn, balanceOut, amountIn, amountOut`. **`amountNetPulled` is not in HEAD.**
- **F-122** ❌ **CORRECTS F-77 / F-107 — I was wrong in the pessimistic direction.**
  **`test/invariants/DutchAuctionLimitSwapInvariants.t.sol` DOES exist at HEAD**, next to
  `DutchAuctionLimitSwapFeesInvariants.t.sol`, `ExactInOutSymmetry.t.sol` and
  `RoundingInvariants.sol`; PROGRAMS.md names it as the 1D reference.
  **→ It IS our invariant harness. Clone it; do not rebuild one.**
- **F-123** ❌ **CORRECTS F-104's extension pattern — the `_opcodes()` array API is GONE
  at HEAD.** Opcode sets are an **`if/else` chain** in
  `_runOpcode(Context memory, uint256, bytes calldata) internal virtual`, which the
  router's `_dispatch` calls. **Extension = override `_runOpcode`, handle the new opcode,
  else `super._runOpcode(...)`** — exactly what `AquaOpcodesDebug` does. Baywatch's
  append-at-34–36 (F-104) describes an **older API**.
  **Slot numbering is the `Opcode` enum (all 256 members already defined), not array
  indices — so no 1inch file is modified.** Our opcode is **`Opcode._2e`**, the free slot
  immediately after `WhitelistSequential` (0x2d) in the *Conditions & access guards* bank,
  per the enum's own allocation rule.
- **F-124** ✅ **CONFIRMS F-72's count** — the HEAD `AquaOpcodes` chain dispatches **16
  arms**: `Jump, JumpIfTokenIn, JumpIfTokenOut, Deadline, OnlyTaker×3, XYCSwap,
  XYCConcentrateSwap, Decay, Salt, FeeFlatIn, FeeProtocol, PeggedSwap, Extruction,
  OnlyTxOriginTokenBalanceNonZero`. Note **`Deadline` IS present** (a time gate on the
  deployed router); no whitelist, no Dutch, no `StaticBalances` (Aqua supplies balances).
- **F-125** 🔑 **The EIP-170 constraint is narrower than F-108 implied.** The repo's own
  Solidity tests **deploy the 29,159-byte `SwapVMRouter` in-test**
  (`DirectSwapVMHelper`, `DutchAuctionLimitSwapInvariants`) — **the test EVM does not
  enforce EIP-170.** **→ The full-opcode router is viable for TESTING; only the router we
  DEPLOY is budget-bound.** This is what makes the three-way comparison test possible.
- **F-126** ⚠️ **CORRECTS F-119** — `hardhat.config.ts` at HEAD defines **only
  `localhost`**, not `localhost/sepolia/mainnet`. Base must be added regardless.
- **F-127** ⚠️ **The instruction CANNOT emit events** — `LOG` reverts under `STATICCALL`.
  Fill recording instead uses **1inch's own `IMakerHooks.postTransferIn`** (MakerTraits
  **bit 251**, target = the Book), which `swap()` calls after `tokenIn` lands and
  `quote()` never calls. Hooks live outside the program, so they cannot affect quote/swap
  consistency — this is precisely what 1inch built them for.
- **F-128** ✅ **Surplus mechanism VERIFIED against `LimitSwap.sol`, all four branches.**
  Price is `balanceIn/balanceOut` in both directions: exact-in
  `amountOut = amountIn*balanceOut/balanceIn`; exact-out
  `amountIn = ceil(amountOut*balanceIn/balanceOut)`. **Scaling `balanceIn` by `(1+b)`
  raises the taker's price by exactly `b` everywhere** — the mirror of
  `DutchAuctionBalanceIn`. Ordering constraint: **after balances, before `LimitSwap`.**
- **F-129** ⚠️ **The randomised close is DROPPED, and the Q&A framing changed.**
  A randomised close defends *open* auctions against sniping; **a sealed commit–reveal has
  no sniping to defend against.** It bought nothing and cost weak randomness, the
  256-block `blockhash` bound, and a real quote/swap divergence across that bound.
  F-90 offers *candle **or** second-price* — we take second-price.
  🔴 **The real Q&A weapon is Revenue Equivalence, not the Dutch isomorphism.** Do **not**
  claim second-price beats Dutch on revenue — RET says it doesn't, and a formal-methods
  judge will say so. **Claim instead: RET's *allocation premise* fails on-chain for 0x94
  (allocation is by tx order at a quantised clock, not by valuation); we fix the
  allocation and the surplus recipient.** Sealed bids are retained for a reason that
  survives Q&A: **shill resistance** — an open second-price auction lets the maker insert
  a bid just under the top.
- **F-130** ✅ **R-3 (Vickrey with one bidder) RESOLVED:**
  `clearing = max(reserveBps, secondHighest)`. One bidder pays the maker's reserve
  (textbook Vickrey-with-reserve); **zero eligible bids → no winner, no window, order
  opens at base.** Ties → **earliest commit** (fixed before anyone knew they were tying,
  so no latency race). `outcome()` is **O(1)** via a running top-2 — the "cap 32 bidders"
  scan is gone.
- **F-131** **Bytecode estimate now has an anchor:**
  `AquaSwapVMRouterDebug − AquaSwapVMRouter = 3,429 B` for seven Debug instructions
  ≈ **490 B each**, and those include console formatting. **Projected 1,400–2,100 B
  against 4,200 B free.** Size knobs if it bites: lower `optimizer.runs` (HEAD uses 700),
  pack `outcome()`'s return, drop `WhitelistSequential` from the *deployed* router only.
- **F-132** 🎯 **Deployment strategy inverted, and it is strictly better.** The auction
  math becomes a **`pure` library with two thin wrappers** (opcode + `Extruction` target),
  so Path B is a **2-hour add-on, not a mid-build pivot**. **The mainnet demo runs via
  `Extruction` on the OFFICIAL, undeployed-by-us router first** — zero bytecode risk and
  the strongest possible *"official Aqua/SwapVM contracts must be used"* compliance
  (F-68). `GlasshouseRouter` deploys afterwards if time allows.

### 3.7 Originality — done to death, avoid
- **F-30** FHE sealed-bid / Vickrey auctions (a literal Zama bounty exercise, ≥4
  ETHGlobal teams). Commit-reveal auctions in Solidity (dozens of tutorial repos).
  Anti-sandwich Uniswap v4 hooks (≥5 independent teams 2025–26). Sui↔EVM 1inch
  Fusion+ atomic swaps (~10 near-identical entries). "We built an AVS" (148 repos).
  Rebuilding mev-boost / a relay / a builder.

### 3.8 Originality — verified open gaps
- **F-31** 🔴 Sui's post-Shio MEV vacuum (F-21 + F-22) — strongest verified gap found.
- **F-32** 🔴 Seal `tle.move` names "MEV resilient trading" and nobody built it (F-24).
- **F-33** 🟡 Mysticeti ordering bias has no public detector or mitigation (F-20).
- **F-34** 🟡 Threshold-MPC sealed-bid auctions: **zero dedicated repos**.
- **F-35** 🟡 zkVM auctions (RISC Zero / SP1 / Halo2 / Circom): **essentially zero repos**.
- **F-36** 🟡 am-AMM: heavily discussed in research, **no dominant open implementation**.
- **F-37** 🟡 On-chain TEE attestation verification is an asymmetric Sui capability
  almost nobody exploits (8 small repos total).

---

## 4. Decision Log

### D-001 — Original premise is misaligned with the event
**Date** 2026-09-03 · **Status** ⏳ Awaiting user decision

**Finding.** "MEV bidding layer on EigenLayer, optionally Sui" maps to **$0** of
available prize money at ETHOnline 2026 (F-4). EigenLayer, Flashbots/MEV, and Sui
are all absent from the sponsor list, and there is no general prize pool (F-2).

**Consensus check ✅ Consensus-1.** Two independent research agents, given different
briefs and searching independently, reached the same conclusion on the sponsor list
and the absence of EigenLayer/MEV/Sui tracks. A third agent corroborated via the
ETHGlobal showcase `?partners=` endpoint (F-5, F-6). **Agreement: 2/2 direct, 1
corroborating. No dissent.**

**Options.**
- **A — Prize-optimised.** Re-express the MEV/auction core through sponsor tech,
  primarily 1inch Aqua/SwapVM ($7K, F-8), stacking Uniswap Foundation ($5K) and
  Chainlink ($2.5K). Keeps the intellectual core, wins money.
- **B — Novelty-optimised.** Build the Sui post-Shio MEV protection layer (F-31,
  F-32). Genuinely novel and verified-open, but **$0 at this event**; better aimed
  at a Sui-sponsored event (HackMoney) or a grant.
- **C — Hybrid.** Build the auction mechanism so its core is novel *and* its
  surface qualifies for 1inch + Uniswap + Chainlink tracks.

**Decision (2026-09-03, user):** ✅ **Option A — Prize-aligned pivot.**
Keep the MEV/auction intellectual core; express it through sponsor tech.
**EigenLayer and Sui are DROPPED from scope for this event.**

**Companion decision — risk posture (user):** ✅ **Novel mechanism, infra-deep.**
Go after a verified gap rather than a safe integration. Backed by F-9/F-10: every
ETHGlobal project touching real builder/relay/auction infrastructure won something;
the losers were consumer wrappers, dashboards and analytics.

---

### D-002 — Project thesis
**Date** 2026-09-03 · **Status** ⬅️ **SUPERSEDED BY D-004.** Retained for the reasoning
trail. Its `M-1`/`M-2` are out of scope (F-118) and `M-3` is struck (F-85/F-102).

**Thesis.** *Every production MEV/order-flow auction has a trusted or capital-gated
auctioneer. Flashbots says so (F-49). CoW says so (F-50). The one live attempt to
fix it by mechanism design made concentration worse (F-51). Meanwhile the whole
layer is consolidating into incumbents (F-54). Nobody can compete on market share —
but nobody has made the auction itself **verifiable**.*

**Why it fits the pivot.** The three target sponsors line up with this unusually well:
- **1inch ($7K)** — Aqua/SwapVM is the sponsor's own execution layer, and Fusion's
  stake-gated resolver set (F-53) is a documented instance of exactly this problem.
- **Chainlink ($2.5K)** — Chainlink *now owns Atlas* and runs SVR (F-54), so it is
  literally in the MEV-auction business as of Jan 2026.
- **The Graph ($15K)** — forbids mocked data (F-46); an auction emits real,
  continuously-generated competition data. Indexing solver concentration (the HHI
  metric from F-51) is a genuine, non-token use of a subgraph.

**Candidate mechanisms for the novel core** (all verified near-zero prior art):
- `M-1` **zkVM-proved auction execution** — prove the auctioneer selected the true
  winner over the true bid set. zkVM auctions: **essentially zero repos** (F-35).
- `M-2` **Threshold-encrypted sealed bids** — no auctioneer ever sees plaintext bids.
  Threshold-MPC sealed-bid auctions: **zero dedicated repos** (F-34).
- `M-3` **am-AMM** (auctioning pool-manager rights) — no dominant open
  implementation (F-36). ⚠️ But F-57 and the crowded v4-hook LVR lane are a risk.

**Open before lock:** what Aqua/SwapVM actually *are* (agent in flight), and which of
`M-1`/`M-2`/`M-3` is buildable in 9 days.

**Consensus:** ✅ **Consensus-2 COMPLETE — 3 independent adversarial reviewers.**

| Reviewer | Brief | Verdict |
|---|---|---|
| A | Originality | **MAJOR REWORK** |
| B | Feasibility (compiled the repo) | **DESCOPE** |
| C | Track fit | **QUALIFIES WITH FIXES** |

**Nobody said KILL. The core survives; the framing and the scope do not.**

**Where all three agreed:**
- ✅ Never pitch this as an auction-managed AMM / fee auction. That won 1st place on
  this exact track already (F-102).
- ✅ The differentiator is the **taker axis** — who may fill — not the maker axis.
- ✅ Scope must come down. Three tracks + custom opcode + auction + subgraph + oracle
  + analytics does not fit 9 days.

**Genuine disagreement — track count:**
- **C:** three tracks, 1inch + Graph + Uniswap = $18K addressable.
- **B:** two tracks, 1inch primary + Graph stretch; a half-landed Graph integration
  scores nothing.
- **RESOLUTION (main):** **1inch is the committed submission. The Graph is a stretch
  behind a hard gate. Uniswap is opportunistic** (~half a day via the Uniswap API as
  the price benchmark, which strengthens the core demo anyway) **and is attempted only
  if days 4–9 all land.** This respects B's cut-line discipline while keeping C's
  upside. Note F-94: The Graph's 3 sub-tracks cost only ONE partner slot.

---

### D-003 — Project name
**Date** 2026-09-03 · **Status** ✅ **LOCKED (user)**

**Decision: `Glasshouse`.** Category **DeFi + Infrastructure** (market microstructure,
not a consumer app).

**Rationale.** Availability-checked against GitHub and DefiLlama (§3.6c): no protocol
collision. Rejected alternatives: **Candle** — free as a protocol name, but permanently
fights "candlestick chart" in search and collides with `huggingface/candle`;
**Witness** — clean, but "witness" is an overloaded ZK term (the private input);
**Gavel** — clear, but least distinctive.
⚠️ **Not checked:** domain, ENS, npm, trademark. WebSearch budget was exhausted.

---

### D-004 — Locked design
**Date** 2026-09-03 · **Status** ✅ **LOCKED** — supersedes the D-002 draft

**Name:** Glasshouse · **Category:** DeFi + Infrastructure

**One-line pitch (use this wording — F-89, sharpened by F-105/F-106):**
> *SwapVM allocates taker priority by **identity** (`WhitelistSequential` — a cartel
> ladder that literally reverts on outsiders) or by **clock** (`DutchAuctionBalanceIn`
> — whose price is a pure function of `block.timestamp`, so every bidder in a block
> faces the same price and the winner is decided by intra-block ordering, i.e. by
> priority fee paid to the builder). **Neither allocates by bid.** Glasshouse adds the
> missing instruction: taker priority by competitive bid, with the surplus routed to
> the maker instead of leaking to the builder.*

**Mechanism:** public-bid or commit–reveal auction. **NOT zkVM, NOT threshold crypto**
(F-118). If time allows, a committed/randomised close (candle-style) to defeat the
Dutch-equivalence objection (F-90); otherwise ship public-bid and say so honestly.

**Architecture constraints — all non-negotiable:**
1. 🔴 **Build from `AquaSwapVMRouter` (4,200 B headroom), NEVER `SwapVMRouter`** — the
   full-`Opcodes` router is 29,159 B and **undeployable** (F-108). Measure bytecode on
   **every commit**. Prefer **Path B (`Extruction`)** if the budget gets tight.
2. 🔴 **The opcode must be strictly READ-ONLY** — `quote()` and `swap()` run the same
   program in different static contexts; state mutation breaks quote/swap consistency
   (F-112). All mutation goes in a separate settlement tx.
3. 🔴 **Deploy to Base mainnet** (F-113) — real Aqua, real events, publishable
   subgraph, one environment satisfies both tracks for a few dollars of gas.
4. 🔴 **Do NOT vendor 1inch source** — it is source-available, not open source (F-117).
   Consume as dependencies; licence only our own code.
5. 🔴 **Design events on day 1** — retrofitting means redeploy + full resync (F-119).
6. ⚠️ **Drop the HHI/solver-concentration story** unless we index real production
   data. A concentration metric over wallets we control is a rounding error (F-114).

**MVP (build FIRST, days 4–7):** one Solidity test running the same program twice —
`WhitelistSequential` vs. our opcode — printing the two prices the user receives.
Satisfies *"tests scripts or a UI"*; needs no frontend, subgraph, or deployment (F-115).
**Day 7 is a HARD GATE: if this doesn't work, cut everything else and polish it.**

**Cut order:** Chainlink oracle → HHI analytics → Subgraph MCP (= cutting The Graph) →
sealed bids. **Never cut:** the two-run comparison + the opcode + a deployed router.

**Known accepted weaknesses:**
- Usability scores ~3/10 without a dashboard (F-100); ~1.5 days buys it back and
  doubles as the demo video — attempt only after the day-7 gate.
- "Custom opcode" is **not** a novelty claim (F-104, Baywatch shipped three).
- Environment blocks first: **Node ≥ 22.13.0 required**, Foundry not installed (F-109).

---

## 5. Architecture

✅ **Written: [`ARCHITECTURE.md`](./ARCHITECTURE.md)** (2026-09-03).

⚠️ **Authored by the main agent, not Fable.** Fable was dispatched as intended but hit a
session rate limit (resets 03:30 IST) before writing the file. **Fable should review and
refine `ARCHITECTURE.md` once the limit clears** — the user's standing instruction is
that Fable owns architecture.

**Design summary** (full detail in the file):
- **Three-phase split solves the read-only constraint (F-112):** bidding writes state in
  its own txs → the VM instruction only **STATICCALLs** the outcome → bond settlement is
  a separate keeper tx. The instruction never writes.
- **Surplus needs no transfer.** The winning bid is a **price improvement in bps**
  applied to `balanceIn`; normal SwapVM settlement delivers it to the maker.
- **Second-price (Vickrey) + randomised close.** Vickrey is equivalent to the *English*
  auction, **not** the Dutch — which structurally defeats the F-87 equivalence objection
  instead of arguing around it. The randomised close kills last-moment sniping.
- **Falls through instead of reverting** on a non-winner — the deliberate inverse of
  `WhitelistSequential`. Permissionless by construction, and one line of contrast on the
  demo slide.
- **Bytecode:** build from `AquaSwapVMRouter`; projected ~1,600 B headroom of 4,200.
  **Path B (`Extruction`) trigger: free space < 1,000 B, decided by end of day 6.**
- **Day-7 hard gate:** `ComparisonTest.t.sol` running the same order three ways —
  `WhitelistSequential` (outsider reverts) vs `DutchAuctionBalanceIn` (one price per
  block, winner = first in block) vs Glasshouse (highest bidder wins, pays second price).

**New risks raised there, not previously in this file:** `blockhash` returns zero beyond
256 blocks (bounds auction length to ~8.5 min on Base) · `outcome()` staticcall gas needs
an O(1) running-max rather than a scan · **Vickrey is ill-posed with a single bidder — a
reserve price must be defined explicitly** · the arg-packing round-trip test must come
before any logic (silent byte-offset bugs, F-110).

---

## 6. Change Log

| Date | Change | Verified by |
|---|---|---|
| 2026-09-03 | Repo initialised; `run.md` created | n/a |
| 2026-09-03 | Research agent "Sui/Move + GitHub originality survey" landed | live WebFetch + GitHub API + Sui framework source |
| 2026-09-03 | Research agent "ETHOnline 2026 rules + past winners" landed | live WebFetch of ethglobal.com prizes + showcase |
| 2026-09-03 | F-1…F-37 recorded; D-001 opened; Consensus-1 logged | two independent agents agreeing |
| 2026-09-03 | Full rules/judging report landed; F-38…F-48 recorded; Q-7 resolved (no pre-event code) | direct WebFetch of ethglobal.com/rules, /info/details, /info/start |
| 2026-09-03 | User directive: **Opus for all research/consensus agents; Fable for architecture only** | user instruction |
| 2026-09-03 | Research agent "EigenLayer + MEV landscape" landed; F-49…F-57 recorded | live WebFetch of Flashbots forum, CoW forum, arXiv, mainnet contract addrs |
| 2026-09-03 | **D-001 CLOSED** — user chose prize-aligned pivot + infra-deep risk posture. EigenLayer & Sui dropped from event scope. | user decision |
| 2026-09-03 | **D-002 opened** — "verifiable auctioneer" thesis drafted | derived from F-49…F-57 |
| 2026-09-03 | 1inch/Graph/Chainlink track deep-dive landed; F-58…F-84 recorded | prizes-page raw DOM + both 1inch repos cloned and read at source |
| 2026-09-03 | **D-003: name = `Glasshouse`**, category DeFi + Infrastructure | user decision; availability checked vs GitHub + DefiLlama (§3.6c) |
| 2026-09-03 | **Consensus-2 COMPLETE** — 3 adversarial reviewers: MAJOR REWORK / DESCOPE / QUALIFIES WITH FIXES. No KILL. | F-85…F-119 |
| 2026-09-03 | Main agent verified 4 load-bearing claims at source: RiverSwap prize, Fusion gate, Baywatch opcodes, `Whitelist.sol` + `DutchAuction.sol` | F-102…F-107 |
| 2026-09-03 | **D-004 LOCKED** — Glasshouse design, tracks, mechanism, cut order | consensus of 3 reviewers + main synthesis |
| 2026-09-03 | **`ARCHITECTURE.md` written** (main agent; Fable rate-limited) | §5 |
| 2026-09-03 | **Fable architecture review → `ARCHITECTURE.md` v2** (698 lines). Caught F-120: fall-through made bidding **strictly dominated**. Dropped the randomised close; resolved R-3; inverted the deploy strategy to `Extruction`-first. | read from `1inch/swap-vm@08089a1` local clone |
| 2026-09-03 | F-120…F-132 logged; F-70 / F-104 / F-107 marked superseded inline | Fable §13 |
| 2026-09-04 | Own repo established at **github.com/IIITManjeet/Glasshouse**; 7 incremental commits; README, `DESIGN.md`, `AI-DISCLOSURE.md` written | `git log`, F-40/F-44 |
| 2026-09-05 | **§9 roadmap** written; status reconciled against the tree | direct inspection |
| 2026-09-05 | **D2 — Book test suite: 41 tests, 48 total green.** Fuzz checks the O(1) top-2 against a reference scan under rotated reveal orders. **Two defects found and fixed** (see F-134). | `npx hardhat test solidity` |

---

## 7. Open Questions

| ID | Question | Blocking? | Status |
|---|---|---|---|
| Q-1 | Is EigenLayer a sponsor at ETHOnline 2026? | Yes | ✅ **No** (F-4) — confirmed ×2 |
| Q-2 | Is Sui/Move a sponsor at ETHOnline 2026? | Yes | ✅ **No** (F-4) — confirmed ×2 |
| Q-3 | What exists combining restaking + MEV auctions? | Yes | ⏳ agent 2 running |
| Q-4 | Is redistributable slashing live on EigenLayer? | Med | ⏳ agent 2 running |
| Q-5 | Submission deadline? | Yes | ✅ **2026-09-13 12:00 EDT** (F-1) |
| Q-6 | **Optimise for prize money, or for a standout novel project?** | **YES — blocks D-001** | ❓ **asked user** |
| Q-7 | Do ETHOnline rules forbid pre-event code? | Yes | ✅ **YES, forbidden** (F-38). No project code before Sep 4. |
| Q-8 | Is there genuinely no finalist/general prize pool? | Med | ⚠️ Absent from the prizes page; canonical event page returned **HTTP 500**, so not confirmable from source. Treat as "no general pool" but re-check Sep 4. |
| Q-9 | Ledger $5K + Chainlink criteria | Med | ⏳ unpublished — **re-check at kickoff Sep 4** (F-48) |

---

## 8. Next Actions

- [x] Research: event rules / tracks / past winners
- [x] Research: Sui/Move + GitHub originality survey
- [x] Research: EigenLayer + MEV landscape
- [x] Resolve Q-6 → **D-001 closed** (prize-aligned pivot, infra-deep)
- [x] Resolve Q-7 → **no pre-event code**
- [ ] Research: exact 1inch Aqua/SwapVM + The Graph + Chainlink track requirements *(agent in flight)*
- [x] Pick the novel core → **second-price sealed bid + randomised close** (`M-1`/`M-2` out of scope per F-118; `M-3` struck per F-85)
- [x] **Consensus-2** — 3 adversarial reviewers, no KILL
- [x] Architecture doc → `ARCHITECTURE.md` *(⚠️ Fable to review when rate limit clears)*

### Before Sep 4 (tonight — NO CODE, F-38)
- [x] **User:** ETHOnline registration confirmed ✅ (2026-09-03)
- [x] **Node ≥ 22.13.0 — DONE.** `nvm use 22.20.0`; verified **node v22.20.0 / npm
      10.9.3** active in both PowerShell and bash. nvm-windows 1.1.10 persists the
      switch globally. Clears both F-109 failures.
      ⚠️ Other nvm entries (19.8.1, 18.17.0, 18.16.0, 16.18.0, 14.19.0, 13.14.0) all
      fail — **if a shell ever reports one of these, re-run `nvm use 22.20.0`.**
- [ ] **User:** hold ETH on **Base** (deploy) and **Arbitrum One** (subgraph publish, F-83)
- [x] **Foundry — DONE** (2026-09-03). `foundryup` → **v1.8.1**, native win32 binaries
      at `C:\Users\manje\.foundry\bin`: `forge` `cast` `anvil` `chisel` `solar`
      (all attestation-verified). **Appended to persistent User PATH.**
      ⚠️ **Git Bash may need `export PATH="$PATH:/c/Users/manje/.foundry/bin"` until a
      shell restart** — the User PATH change only applies to newly-spawned shells.
      → Unblocks `forge test` on `aqua`, and gives us **`anvil` for the pinned Base
      fork** used to benchmark against `DutchAuctionBalanceIn`.
- [ ] Optional: Fable reviews `ARCHITECTURE.md` after 03:30 IST

### Sep 4 — day 1
- [ ] Re-pull prizes page: **Ledger $5K + Chainlink criteria** land at kickoff (F-48/F-84)
- [ ] Clone, install, **cold compile (~7 min)**, run stock tests → **green build gate**
- [ ] Add **Base** to `hardhat.config.ts` (only localhost/sepolia/mainnet ship — R-5)
- [ ] Arg-packing round-trip test **before any logic** (R-4)
- [ ] First commit — **incremental history required** (F-40)

### Standing
- [ ] Measure router bytecode **every commit**; CI fail above 24,576 (F-108)
- [ ] Reserve: human-narrated video 3–5 h (F-43), `AI-DISCLOSURE.md` (F-44), licence
      hygiene — **never vendor 1inch source** (F-117)

---

## 9. Roadmap — 2026-09-05 → 2026-09-13

> Written day 2. Ordered by the **cut order** in D-004, not by what is fun to build.
> Every day ends in something demonstrable. Gates are hard: a failed gate reallocates
> the remaining days, it does not get "caught up later".

### Where we actually are (verified today, not assumed)

| | State |
|---|---|
| ✅ | 7 commits, own repo, incremental history (F-40 satisfied) |
| ✅ | `GlasshouseRouter` **21,108 B**, 3,468 under EIP-170. Opcode + re-added `WhitelistSequential` = **732 B**. Path B (`Extruction`) is now a *bonus*, not a fallback. |
| ✅ | 7/7 tests green, incl. 256-run fuzz on arg encoding (R-4 closed) |
| ✅ | Node 22.20.0, Foundry 1.8.1, Base networks in `hardhat.config.ts` |
| 🔴 | **`GlasshouseBook` — 316 lines, 9 external functions, ZERO tests.** Largest risk in the repo. |
| 🔴 | **Nothing has ever run through the VM.** `applyOutcome` is untested against a real `Context`. |
| 🔴 | **quote/swap consistency — the invariant the whole design rests on — is unproven.** |
| 🔴 | No deployment, no subgraph, no UI, no video, no `FEEDBACK.md` |

### The plan

| Day | Date | Deliverable | Ends with |
|---|---|---|---|
| ✅ **D2** | Fri 05 | **DONE — 48 tests green.** Book test suite. commit/reveal, phase boundaries, second-price + reserve, tie→earliest commit, bond forfeit/claim, `postTransferIn` auth. Fuzz the running top-2. | Book trustworthy |
| **D3** | Sat 06 | **First execution through the VM.** Deploy `GlasshouseRouter` in-test, run a real program with `0x2e`. Prove **`quote() == swap()`**. Exclusive window enforced; fall-through after expiry. | Mechanism works end-to-end |
| **D4** | Sun 07 | 🎯 **`ComparisonTest.t.sol`** — one order, three ways: `0x2d` outsider reverts · `0x94` one price per block, first-in-block wins · `0x2e` highest bidder wins, pays second price. Latency-differentiated bidders. | **G1 — the submission exists** |
| **D5** | Mon 08 | **Base mainnet.** Ignition module, deploy Book + Router, `ship()` a strategy through real Aqua, run one real auction with dust. Clone `DutchAuctionLimitSwapInvariants` harness (F-122). | **G2 — 1inch track qualified** |
| **D6** | Tue 09 | **The Graph.** Messari-conformant subgraph over the Base deployment + Subgraph MCP (both halves of F-81's either/or). | **G3 — Graph viable or cut** |
| **D7** | Wed 10 | 🚨 **HARD GATE.** Everything above green, or cut per F-116 and spend the rest polishing what survives. | Scope frozen |
| **D8** | Thu 11 | **UI** per `DESIGN.md` §7: comparison screen first, then live wiring, then auction view. | Demo-able |
| **D9** | Fri 12 | UI finish · Uniswap API price benchmark + `FEEDBACK.md` + feedback form · **record the video (3–5 h, human-narrated)** | **G4 — video in hand** |
| **D10** | Sat 13 | Repo public · README final · submit by **21:30 IST**. Buffer only — nothing new gets built. | Submitted |

### Gates

- **G1 (end D4) — non-negotiable.** If the three-way comparison is not green, everything
  from D5 on is cancelled and D5–D9 go into making it green. It *is* the submission (F-115).
- **G2 (end D5).** Base deployment is what turns "a test passes" into *"this is running on
  Base mainnet right now"*, and it satisfies 1inch's on-chain-execution requirement (F-68).
- **G3 (end D6).** If the subgraph is not indexing live data by end of D7, **cut The Graph
  entirely** (F-116 rank 3) and move D8–D9 forward a day. A half-landed Graph integration
  scores zero and costs two days.
- **G4 (D9).** Video is mandatory and human-narrated; AI voiceover is an auto-reject (F-43).
  It does not slip to D10.

### Needed from the user (blocking, flagged early on purpose)

| # | What | Needed by | Why |
|---|---|---|---|
| U-a | **ETH on Base** (~$5 is plenty) | **D5, Mon 08** | Deploy Book + Router; blocks G2 |
| U-b | ETH on **Arbitrum One** | D6, Tue 09 | Subgraph *publishing* is an on-chain tx (F-83). Only if we publish rather than staying on the Studio dev endpoint. |
| U-c | **Human narration** for the video | D9, Fri 12 | F-43 — TTS is an auto-reject |
| U-d | **Make the repo public** | D10, Sat 13 | Judges must read it; new work must be open source |

### Standing rules for every day

- `npm run size` on every commit; CI fails above 24,576 (F-108).
- The instruction stays **`view`**. Any state write breaks quote/swap consistency (F-112).
- Never vendor 1inch source — dependencies only (F-117).
- Commit incrementally with real messages (F-40).
- Never pitch this as an auction-managed AMM or a fee auction — that won 1st place on this
  exact track already (F-102).

