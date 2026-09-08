# ui-flow.md — Glasshouse as a product: the flow, decided

> **Status:** DECIDED (architect, D-007 role), 2026-09-08 evening. Binding on the Tue 09 /
> Wed 10 build. Freeze is Wed 10 Sep.
>
> **Supersedes** `ui-spec.md` decision **W** (wallet cut), `ui-spec.md` §8 (the tier
> table), `frontend-architecture.md` §8 ("wallet-bound CTAs are built only in the Next
> app"), and `cta-patterns.md` §5.5 (reconcile against the subgraph). Everything else in
> those three files stands unless a section below says otherwise, and each such place says
> so by name. `DESIGN.md` §2 (every number says what produced it) is untouched and applies
> to every new surface here.
>
> Written from: `src/book/GlasshouseBook.sol`, `src/lib/GlasshouseAuctionLib.sol`,
> `site/app.js`, `site/phase.js`, `site/reserve-rule.js`, `site/index.html`,
> `config/auction.json`, `scripts/run-live-fill.ts`, `test/fork/LiveFillPreflight.t.sol`,
> `subgraph/schema.graphql`, `subgraph/README.md`, `docs/design/subgraph-design.md` §6–§8,
> `node_modules/@1inch/aqua/src/Aqua.sol`, `node_modules/@1inch/swap-vm/src/libs/MakerTraits.sol`.

---

## 0. What changed, in one paragraph

The user's instruction: *"do not take it as some project. We need to make a product out of
it."* `DESIGN.md` and `ui-spec.md` designed an explanation page whose jobs were set by what
a judge needs to be told; that produced a 530-line essay with no live number, nothing
moving, and nothing to do. A product is the other way round: **the instrument is the front
door, and the argument is what you read while you wait for your reveal window.** Three
things the user has already decided make that possible and are not re-litigated here: (a)
the live board ships, (b) wallet bidding ships (connect, sealed bid, reveal on deadline,
win, fill), (c) a keeper opens a fresh round every couple of minutes so the board is never
empty. The keeper is what dissolves every reason decision W gave for cutting the wallet: a
tester no longer meets a 120-second window by appointment; they meet one by arriving.

---

## 1. Decisions

| # | Decision | Rationale |
|---|---|---|
| **P-1** | **The board is the hero.** Above the fold: one line of headline, one sentence of why, then two live cards — *NOW BIDDING* (where the wallet flow lives) and *RESOLVING* (the previous round, unsealing in front of you). The essay moves below. | User decision 2. A visitor decides in five seconds whether this is real; a live countdown and a card that changes state while they watch is the only thing that answers "is this real". |
| **P-2** | **The keeper runs a two-slot pipeline**: a new round opens every 60 blocks with the `humanDemo` windows (60/60/15, `config/auction.json:10-17`), so at every instant exactly one round is accepting sealed bids and one is past commit. | Commit lasts 60 blocks; opening every 60 blocks makes the "accepting bids" state contiguous. Steady state is at most three live rounds, which fits on one screen. §3. |
| **P-3** | **The keeper is also the house bidder**: one sealed bid per round, committed at `open + 1` (always `commitIdx 0`), drawn uniformly from `[reserveBps, 200]`, revealed at `commitEnd + 2`, labelled `TEAM · house` on its card and disclosed in a sentence on the board. | Without it a lone visitor always pays the reserve and never sees a second price. Sealed *before* any visitor can commit, it cannot react to them (`:155-175`), so it is a blind bid, not the shill the contract's own comment warns about (`:153-154`). The skew to ≤ 200 means a visitor who bids sensibly usually wins and reads "you paid what the house bid". §3.3. |
| **P-4** | **Bond is 0 on every keeper round.** The bond > 0 path (approve, checkbox, claim bond) is kept in the spec (`cta-patterns.md` §4.6, §4.10) and **not built**. | A stranger cannot be asked to escrow an ERC-20 to try a demo. With bond 0 a missed reveal loses the bid and nothing else (`:171-172` pulls nothing; `claimUnrevealed` transfers 0, `:338-339`). The page says so in exactly those words. The mechanism's silence-costs-something property is therefore *not* demonstrated live, and the honest-limits box says that. |
| **P-5** | **Live rounds are read from the chain, history from the subgraph.** The two cards are driven by `eth_call` on `Book.auctions()` (`:344`) at a pinned head block, plus `eth_getLogs` for their `BidCommitted` / `BidRevealed`. The rounds list, receipts and the reserve window stay on the subgraph. | An always-live board polling the subgraph every 12 s (`site/app.js:311`) is 7,200 queries per tab per day against a 3,000/day cap (F-83). The public RPC is uncapped, has no indexer lag, and reads the same block the contract will judge a reveal against. The head-block rule (`ui-spec.md` §5.2) survives: every figure still says which block it is as of, and the source tag is `chain` rather than `base`. §4. |
| **P-6** | **The wallet flow is built in `site/`, plain ESM, `window.ethereum` only, calldata hand-encoded.** No viem, no WalletConnect, no build. | User decision 3. The four Book calls the page sends have static-typed arguments (`commit(address,bytes32,bytes32)`, `reveal(address,bytes32,uint24,bytes32)`, `approve`, `deposit`); the one dynamic call (the fill) is a byte splice of on-chain data, §7.3. The Next app comes after, alongside, and imports these modules (`frontend-architecture.md` §7 no-fork rule). |
| **P-7** | **The secret lives in `localStorage`, is written before the wallet opens, is exportable, and the page holds the user on it with the browser's own leave-page dialog.** The reveal countdown is driven by the RPC head at 2 s while a reveal is due. | §6, the centre of this document. |
| **P-8** | **The fill is pre-armed during the reveal wait** (wrap 0.00001 ETH, approve the router for exactly that) so that the exclusive window needs one signature. The order bytes come from Aqua's `Shipped` log; the taker data is the preflight's 42 bytes with the recipient spliced in. | 15 exclusive blocks is 30 s (`config/auction.json:14`). Three signatures do not fit; one does. Keeping `exclusiveBlocks` at the derived value means the live board does not contradict the "parameters are derived" section. §7. |
| **P-9** | **If the winner does not fill, the keeper fills at the base price once the window opens**, and the receipt says `filled by the house at base price · the winner did not fill`. | Every round ends in a fill on the receipt; a no-show is recorded as what it is (`settle` sets `winnerForfeited`, `:277`). With bond 0 nothing is forfeited, and the receipt says that too. |
| **P-10** | **Cut:** the latency lens (S6), `Replay reveals`, `Settle auction` and `Claim bond` as visitor CTAs, the Next app before freeze, mobile wallets. §10. | Twelve implementation hours. The keeper makes a live reveal happen every two minutes, which is what the lens and the replay were substitutes for. |

---

## 2. The front door

### 2.1 Above the fold, desktop (≥ 900px)

```
GLASSHOUSE · 1INCH SWAPVM · LIVE ON BASE                              [ Connect wallet ]

The right to fill this order goes to the highest sealed bid.
SwapVM's other two gates hand the fill to whoever is on a list or whoever is fastest.
This one hands it to whoever values it most — and charges them what the runner-up bid.

┌─ NOW BIDDING ──────────────────────────────┐ ┌─ RESOLVING ─────────────────────────────┐
│ SOURCE · BASE MAINNET · RPC · BLOCK 51 204 118│ │ SOURCE · BASE MAINNET · RPC · BLOCK 51 204 118│
│ round opened 51 204 090 · order 0x58…dfd9  │ │ round opened 51 204 030 · order 0x1c…a04e │
│                                            │ │                                           │
│ commit ▮▮▮▮▮▮▮▮▮▯▯▯▯▯▯▯▯▯▯▯  32 of 60      │ │ reveal ▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▯▯▯▯  49 of 60     │
│ closes at block 51 204 150 · 28 blocks     │ │ closes at block 51 204 150 · 11 blocks    │
│ ~56 s at 2 s/block                         │ │ ~22 s at 2 s/block                        │
│                                            │ │                                           │
│ #0 ▨▨▨▨▨▨  0x5f…e2 TEAM · house · sealed   │ │ #0  120 bps  0x5f…e2 TEAM · house  ← sets │
│ #1 ▨▨▨▨▨▨  0x91…4c UNLISTED · sealed       │ │ #1  300 bps  0x3c…e1 UNLISTED  leading    │
│                                            │ │ #2 ▨▨▨▨▨▨  0xa1…09 UNLISTED · sealed      │
│ bid, bps  [ 250 ]  between 50 and 500      │ │                                           │
│ [ Place sealed bid · 250 bps ]             │ │ clearing 120 bps · running                │
│ commit closes at block 51 204 150          │ │ winner pays the runner-up's bid            │
│ · 28 blocks · ~56 s at 2 s/block           │ │                                           │
│ nothing is escrowed · a missed reveal      │ │ What produced this: …                     │
│ voids the bid                              │ └───────────────────────────────────────────┘
│ What produced this: …                      │
└────────────────────────────────────────────┘
The house opens a round every 60 blocks and seals one bid of its own before anyone else
can, drawn at random between the reserve and 200 bps. It cannot see your bid.

bid · rounds · how a round works · why · the numbers · limits
```

Mobile stacks the two cards, NOW BIDDING first. The wallet button moves into the NOW
BIDDING card's header. Nothing else changes.

**The headline is the one string in this document the user may reword.** Constraints on
the rewrite: one sentence, states what the mechanism does, no adjective that is a claim
("fair", "efficient"). The standfirst carries the "why the alternatives are worse" in one
sentence and names neither opcode; the opcodes are one scroll down.

### 2.2 Which round goes in which slot

- **NOW BIDDING** = the round with the largest `commitEnd` whose phase is `commit`
  (`phase.js:50`) *and* whose `commitEnd − H_c > 2`. The 2-block cutoff is the commit
  button's own disabled threshold (`cta-patterns.md` §4.7); the slot flips to the next
  round at the same moment the button would have gone grey, so the visitor never sees a
  disabled bid button on the hero. If no round qualifies: the keeper-down state, §5.1.
- **RESOLVING** = the most recently opened round whose phase is not `commit`. It stays
  until the next round leaves commit, so a round is on screen through reveal, exclusive,
  open and settle — the whole show. **If this browser holds a bid record in any round**
  (§6.2), that round is pinned into RESOLVING for as long as the record needs the user
  (`sealed` → `revealed`/`closed`, then `won` → `filled`/`window closed`); a round the
  user is in is never pushed off screen by the keeper's rhythm.
- A third live round (the previous RESOLVING, now in `open` and waiting for settle) is a
  one-line row directly under the cards: `51 204 030 · open · 300 bps final · settles
  after block 51 204 165`. It becomes a row in the rounds list the moment it settles.

### 2.3 The phase progress bar is the only animation on the fold

`ui-spec.md` §2.4 stands: a 2px bar, width = blocks elapsed / blocks in phase, updated per
poll. Sealed cards cross-fade to bps on reveal. Nothing pulses.

---

## 3. The keeper

`scripts/keeper.ts`, assembled from `scripts/run-live-fill.ts` (which already does every
transaction below once). It runs on the maker's key, from a machine we control, for the
whole test window Thu 11 → Sat 13, and is started before the freeze review.

### 3.1 One cycle, every 60 blocks

| Step | Tx | Block (relative to open at `O`) | Cites |
|---|---|---|---|
| 1 | `Aqua.ship(ROUTER, abi.encode(order_k), [WETH, USDC], [0.0008 WETH, 2 USDC])` | `O − 1` | `Aqua.sol:40-52`; balances are virtual, nothing moves at ship |
| 2 | `Book.open(orderHash_k, ROUTER, WETH, 60, 60, 15, 50, 500, 0)` | `O` | `:118-150`; `commitEnd = O + 60` (`:137`), `revealEnd = O + 120` (`:138`) |
| 3 | `Book.commit(maker, orderHash_k, commitmentFor(house, b_k, salt_k))` from the house wallet | `O + 1` | `:155-175`; `commitIdx 0` (`:165`) |
| 4 | `Book.reveal(maker, orderHash_k, b_k, salt_k)` | `O + 62` | `:181-209`; window is `O + 61 … O + 120` (`:185-186`) |
| 5 | If the house is `best` at `O + 121`: `Router.swap(order_k, 0.00001 WETH, takerData(house))` | `O + 122` | exclusive window is `O + 121 … O + 135` (`:231`; Lib `applyOutcome`) |
| 6 | If nobody filled by `O + 136` (`auctions().filledBy == 0`, `:253`): the same swap from the house wallet at the base price | `O + 137` | after `exclusiveUntil` anyone may fill (Lib `applyOutcome`, last branch) |
| 7 | `Book.settle(maker, orderHash_k)` | `O + 137` or later | `:262-281`; requires `block > revealEnd + 15 = O + 135` (`:266`) |

Steps 1–2 for round `k + 1` run at `O + 59` / `O + 60`, so round `k + 1` is in commit
one block before round `k` leaves it. That is the pipeline.

**A fresh order hash per round.** `Aqua.ship` refuses a strategy hash it has seen
(`StrategiesMustBeImmutable`, `Aqua.sol:48`) and `Book.open` refuses an order hash it has
seen (`AlreadyOpened`, `:131`); `run-live-fill.ts:43-47` treats that as "one shot, ever".
The keeper varies `postTransferInData` (`MakerTraits.sol:97`), setting it to the
big-endian round counter. The Book receives that data as the unnamed `bytes calldata` in
`postTransferIn` (`:246`) and ignores it, the program bytes are unchanged, and
`router.hash(order)` differs per round. `LiveFillPreflight.t.sol` gains one test that
builds `order_k` for `k = 0, 1, 2`, asserts the three hashes differ, and asserts each
fills — the same proof the current single order has, times three. **Every byte of the
order still comes from Solidity**: the keeper takes the encoded `order_k` from the
preflight's printed output for a fixed range of `k` (say 0–2,000, one line each in
`scripts/lib/orders.json`), never from a TypeScript encoder. At 720 rounds a day, 2,000
covers the test window with margin.

**Float.** Per fill, Aqua pulls the USDC leg from the maker with `safeTransferFrom`
(`Aqua.sol:63-69`): 24,096 units, i.e. $0.024, to whoever filled (`run-live-fill.ts:95`).
At one fill per round that is under $20/day, and most of it goes to the house wallet.
Gas: ~6 transactions per 120 s ≈ 4,300/day; at Base's sub-gwei gas that is on the order
of $10/day. The keeper refuses to start if the maker holds < 5 USDC or < 0.01 ETH, and
stops (rather than opening rounds it cannot settle) when either drops below a quarter of
that. The board's keeper-down state (§5.1) is what a visitor then sees, and it is honest.

### 3.2 What "always ~1 minute from a commit window" buys

A sporadic board is a document with a live number on it. A rolling one is an instrument
you can use, and four things follow that could not be designed before:

1. **Zero-appointment testing.** The reason decision W cut the wallet was that a tester
   handed a URL would "almost never find a 120 s commit window open". Now they always do.
   Every state in §5 is reachable by a stranger with a wallet and no coordination with us.
2. **The mechanism demonstrates itself before the visitor does anything.** Within two
   minutes of arriving, without connecting, they watch a sealed card unseal into a number
   and a "leading" tag move. The argument below the fold can be a third the length,
   because it no longer has to describe what the top of the page is showing.
3. **Second price is always visible.** The house bid guarantees a runner-up. A visitor who
   wins reads "you bid 300, you pay 120 — what the house bid". A visitor who loses reads
   "your 90 bps set the price the house pays". Neither sentence exists on a board where a
   lone bidder pays the reserve.
4. **The Graph loop closes on real rows.** The reserve advisor (`site/reserve-rule.js`)
   needs a window of settled rounds with reveals. Two days of keeper rounds is ~1,400 of
   them, with a UNLISTED-provenance share that is a real observation about who came to
   the page. The S5 panel stops being a heuristic over three auctions.

What it does **not** buy, and the page says so: the house's bids are ours, every round's
maker is us, and the order is a $0.04 dust order. The board is a live mechanism, not a
market. `DESIGN.md` §2 applies to the keeper as much as to a chart.

### 3.3 The house bid, disclosed

The sentence under the cards (§2.1) is mandatory text. On the house's card the provenance
chip reads `TEAM · house`. The draw is `reserveBps + randomInt(0, 150)`, from
`crypto.randomBytes`, and the keeper logs `(round, bps, salt)` to its own file only.
`test/js/keeper.test.js` asserts the draw is in range and that the house commit is
always `commitIdx 0` in a fixture — the second property is what makes "it cannot see
your bid" a checkable statement rather than a promise.

---

## 4. Data plane for a live board

`ui-spec.md` §5.1's precedence (live → cache → snapshot, each labelled) stays for the
subgraph queries. Added on top:

| Surface | Source | Cadence, tab visible | Cadence, tab hidden | Source tag |
|---|---|---|---|---|
| Discover live rounds | `eth_getLogs` Book, topic `AuctionOpened`, `fromBlock = H_c − 200` | on load, then every 30 s | none | — |
| The two cards + third-row | one batched JSON-RPC request: `eth_blockNumber`, then `eth_call Book.auctions(maker, orderHash)` for each live round **at that block** | every 4 s; every 2 s while this browser has a reveal or fill due | none | `SOURCE · BASE MAINNET · RPC · BLOCK N` |
| Bid cards on a live round | `eth_getLogs` Book, topics `BidCommitted` / `BidRevealed` filtered by `(maker, orderHash)` from `openedAtBlock` | only when the struct's `commitCount`, `best`, `bestBps` or `secondBps` changed since the last read | none | same figure |
| This wallet's own bid | `eth_call Book.bids(maker, orderHash, account)` (`:348`) | with the cards, while a record exists | none | same figure |
| Rounds list, receipts | subgraph Q1 / Q2 (`subgraph-design.md` §8.2) | every 120 s | none | `SOURCE · BASE MAINNET · INDEXED · AS OF BLOCK H_i` |
| Reserve window (S5) | subgraph Q3 | on load, then every 10 min | none | `SOURCE · COMPUTED HERE · …` |

Rules that carry over unchanged: phase is computed by `phase(a, n)` against the block the
data was read at (`phase.js:45-60`); the block count is the fact and the seconds are an
estimate, printed as `at 2 s/block` every time; seconds may tick down locally between
polls, **blocks never do**. Two heads still exist — `H_c` for the cards, `H_i` for the
list — and if `H_c − H_i > 3` the list says `indexer N blocks behind chain` in `--amber`.

Provenance chips on RPC-sourced bidders: the page carries the TEAM / INVITED list as a
constant (`site/provenance.js`) mirrored from `subgraph/src/provenance.ts`, and
`test/js/provenance.test.js` asserts the two arrays are identical. The chip's tag is
`const`; the legend under the cards is the one from `ui-spec.md` §3.4, and the word
"external" still never appears.

**Failure states are states, not errors.** RPC unreachable → the cards keep their last
read, the source tag turns `--amber` and reads `RPC · LAST READ BLOCK N · 14 s AGO`, the
countdown freezes at the last block count with `~` removed from the seconds, and every
wallet button reads `Base RPC did not answer — Try again`. The subgraph failing does what
it does today (`app.js:260-273`). Use the endpoint list and back-off already in
`scripts/lib/chain.ts`; do not hammer one URL.

---

## 5. The state machine

Three orthogonal dimensions. A visitor is always in exactly one state of each.

```
BOARD    keeper-down │ commit │ reveal │ exclusive │ open │ settled          (per slot; from chain)
WALLET   no-provider │ disconnected │ connecting │ wrong-chain │ connected   (from window.ethereum)
BIDDER   none │ arming │ secret-written │ sealing │ sealed │ reveal-due │ revealing
         │ revealed(leading | sets-price | outbid) │ missed │ won(arming-fill) │ filling
         │ filled │ window-closed │ lost                                     (from localStorage ⨯ chain)
```

For every state: what is on screen, the primary action, and what happens if they do
nothing. Labels are the ones from `cta-patterns.md` §4 unless restated; the rules there
(disabled label = the reason; contract's verb; blocks before seconds; two-stage ladder)
all apply.

### 5.1 Board states (what a visitor sees without a wallet)

**B0 · keeper-down** — no round in `commit` with more than 2 blocks left.

```
┌─ NOW BIDDING ──────────────────────────────────────────────────────┐
│ SOURCE · BASE MAINNET · RPC · BLOCK 51 209 002                      │
│ No round is accepting bids.                                         │
│ The house opens one every 60 blocks; the last opened at 51 208 110, │
│ 892 blocks ago. The keeper may be down. Recent rounds are below.    │
│ What produced this: a scan of the Book's AuctionOpened logs over the │
│ last 200 blocks found none in commit.                               │
└─────────────────────────────────────────────────────────────────────┘
```
Primary action: none. Do nothing: the slot re-scans every 30 s and fills itself when a
round opens. **Expected during the first minute after the keeper starts and never
otherwise; if a tester screenshots this, the keeper is down and that is what it says.**

**B1 · commit** (the NOW BIDDING card of §2.1). Sealed cards accrue; the progress bar
fills; the bid input and button are live for a connected wallet. Do nothing: at
`commitEnd − 2` the round slides to RESOLVING and the next one takes the slot.

**B2 · reveal** (RESOLVING). Cards unseal as reveals land; the stat line reads
`clearing N bps · running` in `--amber` (Gnosis's three words, `ui-spec.md` §4.1); the
leading card is tagged `leading`, the runner-up `← sets the price`. Do nothing: at
`revealEnd + 1` the price goes `final`. Unrevealed cards get the `--brick` left border and
`unrevealed · bid void` (bond 0 wording).

**B3 · exclusive** (RESOLVING, `bestBidder != null`). The winner's card is boxed in
`--glass`; the track's third cell counts down `winner fills at 120 bps improvement · 9
blocks`. Do nothing: at `exclusiveEnd + 1` the cell reads `not filled by the winner ·
open to anyone at base price`. If nobody revealed, the cell is drawn `is-void`
(`app.js:167-172`) and the round goes straight to open — the contract collapses the
window (`:222-225`), so the page must not draw one.

**B4 · open** — a fill by the house at base price lands (P-9), or already landed in
exclusive. Stat line: `filled · block N · by winner ✓` or `filled · by the house at base
price · the winner did not fill`. Do nothing: the keeper settles at `exclusiveEnd + 2`.

**B5 · settled** — the `open` cell carries `settled ✓ block N ↗`; the round leaves the
slot on the next commit boundary and becomes a row in the list, and a receipt (S4)
appears under "rounds" for the newest settled round. `settlementMatchesDerivation` is
shown as `subgraph replay = contract` or `⚠ replay ≠ contract`, never hidden.

Degraded variants of every B-state: RPC-stale (§4), subgraph-cached / snapshot for the
list (`ui-spec.md` §3.1). They are overlays on the state, not separate states.

### 5.2 Wallet states

| State | Where it shows | Label | Do nothing |
|---|---|---|---|
| **W0 no-provider** | board header | `No wallet found` (disabled), `title`: *Bidding needs a browser wallet on Base — a desktop extension. Everything else here works without one.* | The whole board still runs. Mobile visitors are in this state by default; §10 cuts WalletConnect. |
| **W1 disconnected** | board header; and as the reason on the bid button: `Connect wallet to bid` | `Connect wallet` | Nothing; the visitor watches. |
| **W2 connecting** | header | `Confirm in wallet…` | Wallet prompt times out → back to W1 with `Connection cancelled` 3 s. |
| **W3 wrong-chain** | header in `--brick` outline; bid button: `Switch to Base to bid` | `Switch to Base` → `wallet_switchEthereumChain 0x2105`, `wallet_addEthereumChain` on 4902 | Nothing. If a **bid record exists**, the strip (§6.2) reads `Switch to Base to reveal · N blocks left` in `--brick`. |
| **W4 connected** | header: `0x91ab…04ce · Base`; menu `Copy address`, `Disconnect` (forgets locally) | — | On return, `eth_accounts` without a prompt (`cta-patterns.md` §4.5). |
| **W4′ connected, no gas** | on the bid button: `Not enough ETH on Base for gas` with the estimate in mono | — | Nothing. |

Account switch while a record exists: the strip shows the record's account, `sealed from
0x91ab…04ce — switch back to that account to reveal`. Records are keyed by bidder
(§6.1), so nothing is lost, and nothing is revealed from the wrong account
(`NoCommitment`, `:190`).

### 5.3 Bidder states — the flow, end to end

```
                      ┌───────────────────────────────────────────────────────────────┐
                      │                    NOW BIDDING card                             │
 none ──type bps──▶ arming ──click──▶ secret-written ──wallet ok──▶ sealing ──mined──▶ sealed
                                        │ 4001 / CommitClosed                            │
                                        └──▶ (record dead) ──▶ "next round" prefill ◀────┘ (record: alive)
                                                                                         │ commitEnd passes; card → RESOLVING
                      ┌──────────────────────────────────────────────────────────────────┘
                      ▼
                 reveal-due ──click──▶ revealing ──mined──▶ revealed{leading | sets-price | outbid}
                      │ revealEnd passes                                  │ revealEnd passes
                      ▼                                                   ▼
                   missed                               leading ──▶ won(arming-fill) ──▶ filling ──▶ filled
                                                        others ──▶ lost                 │ exclusiveEnd passes
                                                                                        ▼
                                                                                  window-closed
```

Each state below gives: **screen** / **primary action** / **if they do nothing**.

**S-none.** Screen: the NOW BIDDING card with the input empty; button `Enter a bid between
50 and 500`. Action: type. Nothing: nothing.

**S-arming.** Screen: input has a valid integer; button `Place sealed bid · 250 bps`;
under it `commit closes at block 51 204 150 · 28 blocks · ~56 s at 2 s/block` and the
bond line, which on keeper rounds is always: `nothing is escrowed · a missed reveal voids
the bid`. No checkbox (bond 0, NN/g: no confirmation for a routine action). Action: click.
Nothing: at `commitEnd − 2` the card slides away and the input's value carries into the
next round's card, unchanged, with the button re-armed — the number is the only thing
they typed and the next round is one block away.

**S-secret-written** (`cta-patterns.md` §4.7 steps 1–3, unchanged). The record exists,
`Copy bid secret` is visible beside the button, the wallet prompt is opening. Button:
`Checking…` ≤ 1 s, then `Confirm in wallet…` with the countdown still running under it.
Action: sign in the wallet. Nothing: wallet prompt times out → 4001 path, `Cancelled in
wallet`, record kept (`txHash: null`), button re-armed. If the window closes meanwhile:
`Commit closed at block N while you were signing`, record marked `dead`, and the **next
round's card is already on screen with the same bps prefilled** — this is the one place
the keeper turns an error into a one-click retry.

**S-sealing.** Button `Sealing · 0x3f9a… ↗`. The record has `txHash`. Action: none.
Nothing: mined within a block or two on Base; on `status: 0` the decoded revert
(`cta-patterns.md` §7).

**S-sealed.** The visitor's card appears in the round's bid list, hatched, tagged `you`.
Button becomes the step line: `Sealed · #2 · reveal opens at block 51 204 151 · 24 blocks
· ~48 s at 2 s/block`. **The strip appears** (§6.2) and the tab title starts counting.
Under the step line, one sentence, verbatim: *Keep this tab open. This page cannot reveal
for you; if nothing signs the reveal between blocks 51 204 151 and 51 204 210, the bid is
void.* Action: wait; optionally `Copy bid secret`; optionally **`Get ready to fill`**
(§7.1), which is offered here because this is the longest idle stretch in the flow.
Nothing: at `commitEnd + 1` the card moves to RESOLVING (pinned, §2.2) and the state is
reveal-due.

**S-reveal-due.** The one that matters. Screen, on the RESOLVING card and mirrored in the
strip:

```
┌─ RESOLVING · YOUR BID ───────────────────────────────────────────────┐
│ SOURCE · BASE MAINNET · RPC · BLOCK 51 204 171                        │
│ reveal ▮▮▮▮▮▮▮▮▮▮▯▯▯▯▯▯▯▯▯▯  21 of 60                                 │
│                                                                       │
│ #0  120 bps  0x5f…e2 TEAM · house                                     │
│ #1 ▨▨▨▨▨▨  you · sealed at block 51 204 122                           │
│                                                                       │
│ [ Reveal 250 bps · 39 blocks left ]                                   │
│ closes at block 51 204 210 · ~78 s at 2 s/block                       │
└───────────────────────────────────────────────────────────────────────┘
```
Ladder exactly as `cta-patterns.md` §4.8: never disabled while `H_c ≤ revealEnd`; `--brick`
border and `Reveal closes at block N — sign now` at ≤ 10 blocks; `· may not land` at ≤ 1.
Action: click, sign. Nothing: **S-missed** at `revealEnd + 1`.

**S-revealing.** `Revealing · 0x… ↗ · 4 blocks left` — the deadline stays on the pending
label. Nothing: mined, or `RevealClosed` decoded as `Reveal closed at block M · sent at
block N` so they see by how much.

**S-revealed.** Card unseals with `you`. Label by rank: `Revealed · you lead at 250 bps`
/ `Revealed · runner-up at 250 bps · your bid sets the price` / `Revealed · 3rd of 3`.
Rank is from the struct (`best`, `bestBps`, `secondBps`) plus this wallet's `bps`; ties
by `commitIdx` (`:199`). Strip: `revealed ✓ · leading`. Action: none; if leading,
**`Get ready to fill`** is re-offered if not done. Nothing: at `revealEnd + 1`, leading →
**S-won**, otherwise **S-lost**. "Leading" is provisional until then and the label says
`running` next to the clearing price.

**S-missed.** Card: `--brick` left border, `unrevealed · bid void`. Button (disabled,
`--brick`): `Reveal closed at block 51 204 210 · nothing was escrowed · the bid is void`.
Strip: same, stays 24 h then collapses. Under it: *The house's bid stood alone, so it
won at the reserve. Bid again in the round now open.* Action: the NOW BIDDING card is one
glance left. Nothing: nothing more happens to them; with bond > 0 the label would read
`your bond is claimable by the maker` (`:329-342`), which is specified and not built.

**S-lost.** Card flat with rank; stat line shows the winner and `clearing 250 bps ·
final` with `← sets the price` on the visitor's own row when it did. Strip collapses at
settle. Action: none. Nothing: the round settles and becomes a row; the receipt shows
their address on the losing row with its rank — the losing bidder sees exactly why they
lost (`ui-spec.md` §4.2).

**S-won (arming-fill).** Exclusive window, 15 blocks. Screen:

```
┌─ RESOLVING · YOU WON ────────────────────────────────────────────────┐
│ exclusive ▮▮▮▯▯▯▯▯▯▯▯▯▯▯▯  3 of 15 · only you may fill until 51 204 225│
│ you bid 250 · you pay 120 bps — what the house bid · improvement 120 bps│
│                                                                       │
│ [ Fill · pay 0.00001 WETH · receive 24 096 USDC units · 12 blocks left ]│
│ quote() at block 51 204 213 · window closes at block 51 204 225        │
└───────────────────────────────────────────────────────────────────────┘
```
If pre-arming (§7.1) was done: one button, one signature. If not: the button reads
`Wrap 0.00001 ETH first (1 of 3) · 12 blocks left`, then `Approve the router (2 of 3)`,
then `Fill (3 of 3)`, each with the countdown, and the visitor will probably not make it;
the label does not pretend otherwise. Action: fill. Nothing: **S-window-closed** at
`exclusiveEnd + 1`.

**S-filling.** `Filling · 0x… ↗ · 8 blocks left`. Nothing: mined → **S-filled**; revert
`GlasshouseExclusiveWindow` after the boundary → window-closed wording.

**S-filled.** Card: `filled ✓ block N ↗ · by you · at 120 bps improvement`. The receipt
(S4) for this round renders *inline under the card* with `RECEIPT · your fill` as its
head — this is the screenshot, and for a winner it is theirs. Strip collapses. Action:
none. Nothing: keeper settles; `Claim bond` is hidden (bond 0).

**S-window-closed.** `Exclusive window closed at block N · you did not fill · nothing was
escrowed · open to anyone at base price`. The house fills (P-9) and the receipt records
`the winner did not fill`. Strip collapses at settle.

**Concurrent bids.** A visitor may be `sealed` in the RESOLVING round and `arming` in the
NOW BIDDING round at once. The strip lists every live record, one line each, most urgent
first (reveal-due < 10 blocks, then reveal-due, then won, then sealed).

---

## 6. The reveal problem

A bidder who commits and does not reveal within `revealBlocks` (60 blocks, ~120 s on a
keeper round) has their bid voided; with bond > 0 the maker may take the bond
(`claimUnrevealed`, `:329-342`). The window is measured in blocks the browser does not
control, and a browser tab is not a reliable place to hold a secret with a deadline.
`cta-patterns.md` §5 gave a five-part answer. This section keeps four parts, overrules
one, and adds three, and states plainly what the page can and cannot guarantee.

### 6.1 The secret: what it is, where it lives, how long

The secret is `(bps, salt)`; the commitment is `keccak256(bidder, bps, salt)` computed by
the contract itself via `commitmentFor` (`:111-113`, an `eth_call`; F-144, no keccak in the
browser). Without the salt the bid cannot be revealed by anyone, including us.

| | Decision |
|---|---|
| **Storage** | `localStorage["glasshouse:bid:<auctionId>:<bidder>"]`, JSON: `{ bps, salt, maker, orderHash, openedAtBlock, commitEnd, revealEnd, exclusiveEnd, bond, at, txHash, revealTx, fillTx, state }`. `auctionId` is `keccak256(abi.encodePacked(maker, orderHash))`, the Book's own key (`:102-104`). |
| **Written when** | Before `eth_sendTransaction` for the commit (`cta-patterns.md` §4.7 step 3). A unit test stubs the provider to throw and asserts the record exists. This ordering is the ENS-2017 lesson and is the single most important line in the wallet code. |
| **Shown when** | `Copy bid secret` appears the same instant, beside the button, and stays for the record's life. It copies `{ auction, bidder, bps, salt, revealEnd }`. Under it: *Stored in this browser only. Copy it if you might reveal from another one.* |
| **Read back** | On every load and every poll, for the connected (or last-connected) account. Reconciled against the chain, §6.3. |
| **Not in** | the URL, cookies, `sessionStorage`, IndexedDB, any server, any analytics. There is no server. |
| **Deleted when** | 24 h after `exclusiveEnd`, on the next load. Not before: a record for a missed reveal is what lets the page say *what happened*, not just that the button is gone. |
| **Another browser / device** | `Enter secret` (`cta-patterns.md` §4.13): two mono fields under a disabled `Reveal`, writes a record marked `typed`. Validation is the contract's (`BadReveal`, `:192`). |
| **Wrong wallet** | Records are per bidder; a different account sees `sealed from 0x… — switch back to that account to reveal`, never a `Reveal` it cannot sign. |
| **Privacy** | `localStorage` is per origin; the Pages origin is ours. A shared machine's next user could reveal on the first user's behalf (they gain nothing; the reveal is the honest act) but could read the bps. The secret's value is one bid on a dust order; the sentence under `Copy bid secret` says "this browser". No encryption theatre. |

### 6.2 Holding the user on the page: the strip, the title, and the browser's own dialog

1. **The strip is a sticky bottom bar** — the only sticky element on the page — and it
   exists only while this browser holds a live record. `cta-patterns.md` §5.2 put it under
   the masthead "on every route"; a one-page site has one route and a visitor who scrolls
   to the argument while they wait must still see the deadline. One line per record, mono,
   the whole line is the button:

   ```
   ▌ round 51 204 090 · sealed 250 bps · reveal opens in 24 blocks · ~48 s          ✕ hide
   ▌ round 51 204 030 · Reveal now · 9 blocks left                          [ Reveal 250 bps ]
   ```
   `--brick` at ≤ 10 blocks. `✕ hide` collapses it to a 4px `--brick` line at the bottom
   edge for 60 s, then it returns; it cannot be dismissed while a reveal is due. That is
   deliberate and the hide control's `title` says *returns in 60 s — a reveal is due*.

2. **The tab title carries the countdown** from `Sealed` until `revealed`/`closed`:
   `(24) Reveal opens · Glasshouse` → `(39) Reveal · Glasshouse` → `(9) REVEAL NOW ·
   Glasshouse`. Etherscan's "notify me when this block is produced" done the only way a
   static page can without a permission prompt.

3. **`beforeunload` while a record is `sealed` or `reveal-due`.** *(New.)* The browser
   shows its own "Leave site? Changes you made may not be saved." dialog; the text cannot
   be customised and we do not try. It is a native, permission-free, universally
   recognised way to say "you are about to walk away from something". Registered when
   the record is written, removed the moment the reveal is mined, the window closes, or
   the record dies. Never registered for `won` (a missed fill loses nothing on a keeper
   round). This is the part `cta-patterns.md` §5 did not have.

4. **The step line says the guarantee in words**, once, at `Sealed` (§5.3): *Keep this
   tab open. This page cannot reveal for you; if nothing signs the reveal between blocks
   A and B, the bid is void.* Not a toast. Not a modal. Text on the card, in the screenshot.

**What we still do not do**, and why (unchanged from `cta-patterns.md` §5): no
Notifications API (a permission prompt on a page a stranger was handed is worse than the
risk); no email; no relayer that reveals for you (that is an auctioneer, the thing the
project removes); no service worker that signs without a click (nobody does it, for good
reason). Added: **no auto-reveal by the keeper** even though the keeper could technically
be handed the secret — the page never sends the secret anywhere, and a design in which it
did would be a custodial auction with extra steps.

### 6.3 Return: tab closed, reopened, reloaded, another tab

On every load, before anything renders below the fold: read every record → one batched
RPC → `Book.auctions(maker, orderHash)` and `Book.bids(maker, orderHash, bidder)`
(`:344`, `:348`) at the current head → derive the state → render the strip. **This
overrules `cta-patterns.md` §5.5**, which reconciled against the subgraph's `Bid` row: the
indexer can be three blocks behind, and three blocks is the difference between `Reveal
now · 2 blocks left` and a `RevealClosed` revert. The contract judges against the chain
head (`:186`); so does the page.

| Left during | Record | On return the strip / card shows |
|---|---|---|
| typing | none | nothing; the input is a number they can retype |
| secret written, wallet unsigned | `txHash: null` | `H_c ≤ commitEnd`: `250 bps not sent · commit closes in 12 blocks — Place sealed bid`; `chain bids().commitment != 0` (they did sign, the page missed the receipt): treated as sealed; else after `commitEnd`: `expired unsent` once, then deleted |
| commit pending | `txHash` | `sealing · 0x… ↗` until `bids().commitment != 0`, then sealed |
| sealed, reveal not open | sealed | `sealed 250 bps · reveal opens in N blocks` + title countdown + `beforeunload` re-armed |
| reveal open | sealed | `Reveal now · N blocks left` — the line is the button; clicking it also scrolls the pinned RESOLVING card into view |
| reveal pending | `revealTx` | `revealing · 0x… ↗ · N blocks left`; if `bids().revealed` is already true, revealed |
| revealed | — | `revealed ✓ · leading` etc. from the struct |
| reveal closed, unrevealed | sealed | `reveal closed at block N · bid void` (`--brick`), 24 h |
| won, exclusive open | sealed, revealed | `You won · Fill · N blocks left` — line is the button |
| won, window closed | — | `window closed at block N · the house filled at base price` |
| filled | `fillTx` | `filled ✓ ↗`; the receipt is under "rounds" |
| any, > 24 h past `exclusiveEnd` | deleted | nothing; the round's own timeline is the record |

Two tabs of the same page: both read the same record; both would show `Reveal now`; the
second to sign gets `AlreadyRevealed` (`:191`) → shown as `Revealed ✓` (`cta-patterns.md`
§7). Harmless, and the label says what happened.

### 6.4 Missing it

At `revealEnd + 1` against `H_c`: the button flips to the closed state (§5.3 S-missed),
the strip line turns `--brick` and stays 24 h, `beforeunload` is removed, the title stops
counting. The sentence is complete and specific: what closed, at which block, what it
cost (`nothing was escrowed · the bid is void`), and what to do (`bid again in the round
now open`). We do **not** show a "you would have won" — the page cannot know that
(unrevealed bids are unrevealed) and it would be a fabricated regret.

### 6.5 Urgency without lying

- **Blocks are the fact; seconds are an estimate and say so** on every line (`~78 s at
  2 s/block`). A countdown in seconds alone is a promise the chain did not make.
- **Blocks come only from the RPC.** Between 2 s polls the seconds estimate may tick;
  the block count never changes locally. If the RPC stops answering, the count freezes
  and the label says `last read block N · 14 s ago` — the button stays enabled, because a
  reveal not attempted is the only outcome that is certain to fail.
- **The button is never disabled while the contract would accept the reveal**
  (`H_c ≤ revealEnd`, `:186`), and it is never enabled after. Threshold colour at ≤ 10
  blocks, `may not land` at ≤ 1. The disabled rule is asymmetric on purpose
  (`cta-patterns.md` §4.8): a late reveal costs cents of gas; an unattempted one costs the
  bid.
- **Pre-flight simulation has a 1.5 s budget.** `eth_call` of the exact reveal calldata
  before the wallet prompt catches `BadReveal` and `RevealNotOpen` without a signature;
  if it has not returned in 1.5 s the page sends anyway, because at 5 blocks left a
  simulation is not worth a block.
- **The page states what it cannot do**, once, at `Sealed` (§6.2 item 4). Nothing on the
  page ever says "we'll remind you", "don't worry", or "auto".

### 6.6 What bond 0 changes about all of this

On keeper rounds a missed reveal costs the visitor nothing but the bid. The urgency
machinery above is built anyway, for two reasons. First, the flow is the product's flow,
and the product's rounds will carry bonds; a design that only works when nothing is at
stake is not a design. Second, a missed reveal still damages the *round*: with the
runner-up silent, the winner pays the reserve, which is the withholding attack the bond
exists to price (`:168-170`). The board shows that consequence honestly (`unrevealed · bid
void`, and the clearing price it produced), and the honest-limits box says that live rounds
run with `bond = 0`, so the one property the live board does not demonstrate is the cost of
silence. Every bond > 0 label is specified in `cta-patterns.md` §4.6–4.10 and §5 and is
behind `if (bond > 0)` in the code, not deleted.

---

## 7. The fill

A winner who does not fill inside 15 blocks fills nothing; a non-winner who tries inside
the window reverts (`GlasshouseExclusiveWindow`, `GlasshouseAuctionLib.sol` `applyOutcome`).
After the window anyone fills at base price. Thirty seconds for a human is enough for one
signature if everything else is already in place.

### 7.1 Pre-arm during the wait: `Get ready to fill`

Offered on the card at `S-sealed` (the longest idle stretch, up to 120 s) and again at
`S-revealed · leading`. A two-step stepper inside a `<details>`:

```
▸ Get ready to fill — 2 signatures now, so winning needs only 1
  1  Wrap 0.00001 ETH → WETH          [ Wrap ]      one-time; you keep the WETH if you lose
  2  Approve the router for 0.00001 WETH  [ Approve ]  exact amount, never unlimited
```
Both read from chain on load (`WETH.balanceOf`, `WETH.allowance(account, ROUTER)`) and
render `done ✓` when already satisfied, so a returning tester who wrapped yesterday sees
one signature from the start. Cost stated: *about a cent of gas each on Base.*

### 7.2 The fill button

Label `Fill · pay 0.00001 WETH · receive 24 096 USDC units · 12 blocks left`. The
`receive` figure is `Router.quote(order, amount, takerData)` via `eth_call` with `from =
account` at the block shown (`ISwapVM.sol:36`); tagged `chain`. Raw units, as the receipt
already does (`ui-spec.md` S4); the token pair cell is `const` (the Book does not know the
pair, `subgraph/README.md`). Under it: `winner pays 120 bps improvement · window closes at
block N`. Ladder: `Checking…` → `Confirm in wallet… · N blocks left` → `Filling · 0x… ↗`
→ `filled ✓ block N ↗`. Improvement in bps only; no USD, no "saved".

### 7.3 Where the bytes come from — no encoder in the browser

- **The order.** `Aqua.ship` emits `Shipped(maker, app, strategyHash, strategy)`
  (`IAqua.sol:45`) where `strategy = abi.encode(order)` and `strategyHash ==
  router.hash(order) == the auction's orderHash` (asserted in
  `LiveFillPreflight.t.sol:193`). The page runs `eth_getLogs` on Aqua, topic0 `Shipped`,
  block range `[openedAtBlock − 5, openedAtBlock]` (the keeper ships one block before it
  opens, §3.1), and picks the log whose `strategyHash` equals the round's `orderHash`.
  None of the parameters is indexed, so the match is client-side over a handful of logs.
  Source tag on the fill button's figure: `SOURCE · BASE MAINNET · AQUA Shipped LOG · TX
  0x… ↗`.
- **The calldata.** `swap((address,uint256,bytes) order, uint256 amount, bytes
  takerTraitsAndData)`. `abi.encode(order)` of a single struct with one dynamic member is
  `0x20 ‖ tuple-body`; inside the three-argument call the tuple is dynamic, so the call
  is `selector ‖ [0x60, amount, offset(taker)] ‖ tuple-body ‖ len(taker) ‖ taker ‖ pad`.
  The page therefore splices: strip the first 32 bytes of `strategy`, prepend the three
  head words, append the length-prefixed taker bytes. No ABI encoder.
- **The taker data.** `TAKER_DATA_PREFIX ‖ recipient` (`run-live-fill.ts:66-69`); the
  preflight already pins that the two recipients' taker data differ only in the trailing
  20 bytes. Carried by the page as `const`.
- **The proof.** `LiveFillPreflight.t.sol` gains a test that prints the exact `swap`
  calldata for a fixed recipient; `test/js/fill-calldata.test.js` splices the same inputs
  and asserts byte equality. The browser's bytes are the fork's bytes or the test fails.

### 7.4 If they do not fill

`S-window-closed` (§5.3). The keeper fills at base price (P-9), the receipt records it,
`settle` marks `winnerForfeited` (`:277`) and the receipt's `bonds` row reads `0 · nothing
escrowed · winner forfeited (no bond)`. Nothing is dressed up.

---

## 8. Information architecture

```
ABOVE THE FOLD          masthead line · headline · standfirst · [Connect wallet]
                        NOW BIDDING card  |  RESOLVING card
                        third-row (open/settling)
                        house-bid disclosure sentence · section nav
                        ── sticky strip (only while this browser holds a bid) ──

ONE SCROLL              § rounds        S2 list (subgraph, 120 s), newest first, phase chips
                                        S4 receipt of the newest settled round, or of *your*
                                        round when you have one
                        § how a round works   the four-cell track, now the *live* one from
                                        the RESOLVING card, with the config caption
                                        (`config/auction.json` "humanDemo" — the live
                                        board runs the human windows; the "advocated"
                                        set is in "the numbers")

TWO SCROLLS             § why           the three-opcode strip and the argument
                                        (index.html masthead strip + sections 1–3, cut to
                                        roughly a third; the board now shows what the
                                        prose used to describe)
                        § the numbers   S1 comparison (as built, `TEST` tag) · parameters
                                        table (`advocated`) · S5 reserve control (`rule`)
                        § limits        honest-limits box + two new bullets (§9)
                        footer          addresses, subgraph deployment id, repo

A LINK AWAY             Basescan on every hash · GitHub · `docs/design/*` · the Studio
                        query URL · `subgraph/README.md`
```

Section nav (mono, under the disclosure sentence): `bid · rounds · how a round works ·
why · the numbers · limits`. Anchor links; no sticky nav (the strip is the one sticky
thing).

The receipt earns its place one scroll down because for a winner it is *theirs* and it
also renders inline under their card (§5.3 S-filled). The reserve control (S5) stays on
the page because it is the second Graph product's on-page evidence and now has real rows
to work on (§3.2 item 4); it is two scrolls down because a visitor who has not bid has no
reason to read it. The latency lens is gone (§10).

---

## 9. Honest limits — two bullets added

To the `.limits` box, after the existing five:

- **The live board is a demonstration, not a market.** Every round's maker is us, one of
  the bidders is always us, and the order is a dust order (0.00001 WETH). What is real is
  the mechanism: the contract, the chain, the sealed bids, the second price, the fill.
- **Live rounds run with `bond = 0`.** A bidder who commits and never reveals loses only
  the bid. The bond that makes silence cost something is in the contract
  (`GlasshouseBook.sol:168-172`) and in the tests, not on the live board, because a
  visitor cannot be asked to escrow an ERC-20 to try a page.

---

## 10. What is cut, and why

Budget: Tue 09 (full day) + Wed 10 (morning) ≈ **12 implementation hours**, one
implementer. `ui-spec.md` §8's tier table is superseded by this one.

| Rank | Item | Hours | Cut order |
|---|---|---|---|
| 1 | **Keeper** (`scripts/keeper.ts` from `run-live-fill.ts`; pipeline, house bid, base-price fill, settle; `postTransferInData` counter; preflight test for three order hashes; orders.json for k = 0…2000) | 3 | never — without it nothing else is testable by a stranger |
| 2 | **Board data plane** (RPC discovery + batched `auctions()` at a pinned block + logs on change; two slots + third-row; keeper-down state; RPC-stale overlay; provenance constant + parity test) | 3 | never |
| 3 | **Wallet + sealed bid + reveal** (connect ladder; input; commit with record-before-send; strip; title; `beforeunload`; reconciliation via `bids()`; all §5.3 states through `S-lost`/`S-missed`) | 4 | never |
| 4 | **Fill** (pre-arm stepper; `Shipped` log; splice; quote; fill ladder; calldata parity test) | 2 | **cut first.** If cut: the `S-won` card reads `You won at 120 bps. Filling from the browser is not built yet; the house fills at the base price when the window opens, and the receipt records that the winner did not fill.` Honest, and allocation is still demonstrated. |
| 5 | Rounds list + receipt re-pointed at the new sections (mostly exists in `app.js`) | 0.5 | never |
| 6 | Reserve control S5 | 1.5 | cut second |
| 7 | `Enter secret` | 0.5 | cut third |
| 8 | Argument prose cut to a third; two new limits bullets; nav | 0.5 | never |
| — | **Total if nothing is cut** | **15** | so something is: expect 4 or 6 to go, decided Wed 09:00 |

**Cut outright, with the reason:**

- **Latency lens (S6).** Two hours of hand-drawn SVG to *show* that a clock rewards speed;
  the board now shows a sealed auction resolving every two minutes. The comparison table
  (built) carries the numeric claim.
- **`Replay reveals`.** Live reveals happen every 120 s.
- **`Settle auction` and `Claim bond` as visitor CTAs.** The keeper settles; bond is 0.
  The track cell says `settles after block N · permissionless · the house calls it`. Fewer
  signatures asked of strangers.
- **Bond > 0 path** (approve, checkbox, claim bond, forfeit labels). Specified in
  `cta-patterns.md`; guarded by `bond > 0`; not built.
- **Mobile wallets / WalletConnect / EIP-6963.** Needs a library and a build. Mobile
  visitors watch; the `No wallet found` `title` says so.
- **Notifications, email, relayers, auto-reveal.** §6.2.
- **The Next app before freeze.** After, alongside, importing `site/*.js`
  (`frontend-architecture.md` §0). Nothing in this document depends on it.
- **The "two routes, one answer" MCP panel; maker UI; theme toggle; pagination; search.**
  Unchanged from `ui-spec.md` §8.

---

## 11. Files this implies (none edited by this document)

| File | Change |
|---|---|
| `site/index.html` | Restructure to §8. Argument sections shortened. Board mount points: `#board-bidding`, `#board-resolving`, `#board-third`, `#strip`. |
| `site/app.js` | Split: `site/board.js` (RPC plane, slots, cards), `site/history.js` (the current subgraph list/receipt code, kept), `site/wallet.js` (EIP-1193 ladder, calldata for `commit`/`reveal`/`deposit`/`approve`/`swap`, selector constants asserted against `subgraph/abis/GlasshouseBook.json` in a test), `site/bid-store.js` (records, reconciliation, strip, title, `beforeunload`), `site/provenance.js`. All plain ESM, all importable by the Next app later. |
| `site/phase.js`, `site/reserve-rule.js` | Untouched. |
| `scripts/keeper.ts`, `scripts/lib/orders.json` | New (§3). |
| `test/fork/LiveFillPreflight.t.sol` | + three-hash test; + prints `swap` calldata for a fixed recipient. |
| `test/js/` | + `bid-store.test.js` (record-before-send; state derivation table of §6.3), `fill-calldata.test.js`, `provenance.test.js`, `keeper.test.js`, `selectors.test.js`. |
| `config/auction.json` | Unchanged. The keeper reads `humanDemo`. |
| `run.md` | A `D-0nn` entry pointing here; keeper start/stop times and the maker's float in §6 when it runs. Not written by this document. |

**Acceptance, additive to `ui-spec.md` §9 and `cta-patterns.md` §8:**

1. With the keeper running, a stranger with a Base wallet and ~$0.10 of ETH completes
   commit → reveal → win/lose from the hosted URL, with one deliberate tab close after
   `Sealed`, and the strip on reopen shows `Reveal now · N blocks left`. Recorded in
   `run.md` with block numbers.
2. With the keeper stopped, the NOW BIDDING slot shows B0 within 30 s and names the block
   of the last open.
3. Network panel with the tab visible: one batched RPC request per 4 s, one subgraph
   request per 120 s, and nothing while hidden.
4. `Reveal` is enabled at `H_c == revealEnd` and disabled at `H_c == revealEnd + 1`; the
   strip line and the card button agree at every poll (same state object).
5. Kill the RPC in devtools during reveal-due: the count freezes, the tag turns amber
   with `last read block N`, the button stays enabled.
6. `fill-calldata.test.js` bytes == the preflight's printed bytes.
7. The word "external" does not occur in `site/`; every address has a provenance chip;
   the house's chip reads `TEAM · house`; the disclosure sentence is present.
8. `grep -c "auto\|remind\|don't worry\|we'll" site/` returns 0 outside `<details>` raw
   error text.

---

## 12. Open, for the human

| | Question | My default if unanswered by Tue 09:00 |
|---|---|---|
| O-1 | The headline string (§2.1). | Ship mine. |
| O-2 | Maker float for the test window: ~$20 USDC + ~$30 ETH on Base, on the deployer key the keeper runs with. | Keeper refuses to start below 5 USDC / 0.01 ETH and says so. |
| O-3 | House bid ceiling 200 bps (P-3). | 200. Review after the first ten visitor rounds: if visitors never lose, raise to 300. |
| O-4 | Cut 4 (fill) or cut 6 (reserve panel) first if Wednesday is short. | Fill first (§10): allocation is the thesis; the fill is the proof the router honours it, and that proof already exists on the fork and will exist on mainnet from the keeper's own fills. |
