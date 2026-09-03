# Glasshouse — Architecture

> **Status:** v2, 2026-09-03 (pre-event). v1 was written by the main agent as a stand-in;
> v2 is the architect's review, corrected against the `1inch/swap-vm` source at
> `08089a1` (main, 2026-09-01) read from the local clone. **No project source code exists
> or may exist before Sep 4** — every code block below is design pseudocode, not Solidity.
> **Read `run.md` first.** Constraints trace to numbered facts there (`F-nnn`).
>
> **What v2 changed, and why — read this if you read nothing else**
> 1. **§2 — a mechanism hole, not flagged in v1:** v1 let non-winners *fall through* to the
>    unimproved price at any time. That makes bidding strictly dominated by not bidding
>    (the winner pays more for the same fill anyone else gets cheaper). Fixed: the winner
>    buys an **exclusive window**; outsiders revert inside it (as `WhitelistSequential`
>    does) and the order opens at base price after it. Liveness preserved, bids valuable.
> 2. **§3 — randomised close DROPPED.** It defends *open* auctions against sniping; a
>    sealed commit–reveal has no sniping to defend against. It cost weak randomness,
>    the 256-block `blockhash` bound, and a genuine quote/swap divergence across that
>    bound (R-1). Second-price alone satisfies F-90 ("committed close **or** second-price").
> 3. **§2 — no `finalize()` tx and no `blockhash`.** Reveals are impossible after
>    `revealEnd`, so storage is frozen by the phase rule itself; `outcome()` is a pure
>    function of frozen storage plus `block.number`. Quote ≡ swap in every block.
> 4. **§5 — the Book learns about fills through 1inch's own `IMakerHooks`**, which the
>    router calls in `swap()` only. That is how bond settlement knows who showed up.
>    Also: **the instruction cannot emit events** — `LOG` reverts under `STATICCALL`.
> 5. **§5/§6 — the dispatch API in v1 is stale.** HEAD has no `_opcodes()` array; opcode
>    sets are an `if/else` chain in `_runOpcode(ctx, opcode, args) internal virtual`. We
>    override that. The opcode is `Opcode._2e` — the free slot right after
>    `WhitelistSequential` (0x2d) in the *Conditions & access guards* bank, per the enum's
>    own allocation rule. All 256 enum members exist, so no 1inch file is modified.
> 6. **§5 — args shrink from 64 bytes / 6 fields to 23 bytes / 2 fields.** `auctionId` is
>    `ctx.query.orderHash` (binds one auction to one order), `nextPC` is unnecessary (the
>    register adjustment *is* the branch), `closeAnchor`/`window` died with the close.
>    F-110's silent-offset risk shrinks with it. `SwapRegisters` has **four** fields, not
>    five (F-70 is stale on this).
> 7. **§4 (R-3) — Vickrey with one bidder is now specified:** maker's `reserveBps` is the
>    implicit second bid; `clearing = max(reserve, secondHighest)`; zero eligible bids →
>    no winner, no window, open at base. Ties → earliest commit.
> 8. **§6 — Path A stays primary, but the auction math is a pure library with two thin
>    wrappers** (opcode and `Extruction` target), so Path B is a 2-hour add-on, not a
>    mid-build pivot — and it lets the mainnet demo run on the **official, undeployed-by-us
>    router** with zero bytecode risk.
> 9. **§10 — the plan is re-sequenced against F-110 (18–35 h for the opcode).** VM
>    integration moves to day 5 with a mock Book; the Book follows; day 8 is the spillover
>    buffer the v1 plan did not have.
> 10. **§13 — four `run.md` facts need correcting** (F-70, F-77/F-107, F-104's extension
>     pattern, F-72's "16 opcodes"). Listed at the end for the main agent to log.

---

## 1. What we are building, in one paragraph

1inch's SwapVM allocates **taker priority** two ways, and only two:

- **By identity** — `WhitelistSequential` (0x2d): a hardcoded ladder of truncated
  addresses. Outsiders don't merely wait, they **revert** (`require(timeLeft >= duration)`)
  until the entire cumulative ladder has elapsed (F-105, confirmed at source).
- **By clock** — `DutchAuctionBalanceIn` (0x94): `balanceIn = balanceIn * decay^elapsed / 1e18`
  with `elapsed = block.timestamp - start` (F-106, confirmed at source).

**Neither allocates by bid.** And the clock version is worse than it looks: price is a
**pure function of `block.timestamp`**, so every bidder in a block faces an *identical*
price. Valuation cannot break the tie — allocation falls to **intra-block ordering**,
i.e. priority fee paid to the builder. The surplus above the posted price is competed
away **out of the protocol**.

**Glasshouse adds the missing instruction: taker priority by sealed competitive bid
(second-price, with reserve), with the surplus routed to the maker instead of the builder.**

---

## 2. The central design problem, and its solution

**Constraint (F-112, confirmed in `SwapVM.sol`):** `quote()` builds the context with
`isStaticContext: true`, `swap()` with `false`; both call the same `ctx.runLoop()` over the
same program. `quote()` is documented *"can be executed in a static-call"* and is normally
reached via `asView()` — i.e. under `STATICCALL`. If our instruction writes state, emits an
event, or reads anything that changes between the quote and the swap, quote and swap
diverge. PROGRAMS.md names *"quote/swap consistency"* in every category and, for our
category (Conditional Flow), *"branch determinism and quote/swap path consistency (same
inputs -> same branch)."*

**So the instruction must be strictly read-only. But an auction needs a bid book.**

### 2.1 Three phases, only the middle one inside the VM

```
  PHASE 1  BIDDING                 PHASE 2  FILL                    PHASE 3  SETTLEMENT
  (Book txs, write state)          (Router.swap(), instruction is   (Book tx, write state)
                                    READ-ONLY)
  ───────────────────────────      ─────────────────────────────    ────────────────────────
  maker  → Book.open(orderHash,    taker → Router.swap()            anyone → Book.sweep()
             params)                 └─ program runs                 ├─ refund bonds of
  bidder → Book.commit(hash)            └─ GlasshouseAuction.exec    │  losers + winner-who-
  bidder → Book.reveal(bps, salt)          └─ STATICCALL             │  filled
             (posts bond)                     Book.outcome()         └─ forfeit winner-who-
                                           └─ adjust balanceIn          did-not to the maker
                                              or revert or pass
                                     └─ router calls
                                        Book.postTransferIn()   ← IMakerHooks, swap() only
                                        (records the fill)
```

- **Phase 1** is ordinary state-writing transactions against `GlasshouseBook`. The
  instruction never sees them.
- **Phase 2** — the instruction does exactly one external call, a `view` call
  (`STATICCALL`) to `outcome()`, then adjusts registers or reverts. **No writes, no
  events** (a `LOG` inside a static context reverts, so `AuctionFilled` cannot come from
  the instruction — see §7).
- **Fill recording** uses the VM's own extension point for post-settlement side effects:
  the maker's order sets the `postTransferIn` hook (MakerTraits bit 251, target = the
  Book). `SwapVM.swap()` calls it after the taker's `tokenIn` has actually landed;
  `quote()` never calls hooks (it has no transfer phase). Because hooks live outside the
  program, they cannot affect quote/swap consistency — this is precisely what 1inch built
  them for. The Book requires `msg.sender == auction.router`.
- **Phase 3** is a permissionless keeper tx that touches no SwapVM code.

### 2.2 Why quote and swap cannot diverge — the argument, case by case

The invariant we protect: *for a given (order, taker, amount, block), `quote()` and
`swap()` compute the same `(amountIn, amountOut)` or both revert.*

| Case | Can `outcome()` differ between the quote call and the swap call? | Verdict |
|---|---|---|
| Same block, no Book tx between | Storage unchanged, `block.number` unchanged → identical return. | ✅ |
| Same block, a **reveal** lands between quote and swap | Impossible by construction: `reveal()` requires `block.number <= revealEnd`; the instruction requires `block.number > revealEnd`. The two phases are **disjoint in block space**, so no block can contain both a reveal and a fill. | ✅ |
| Same block, a **sweep** lands between | `sweep()` touches only bond accounting, never the fields `outcome()` reads. | ✅ |
| Taker quotes at block *N*, tx mines at *N+k* | After `revealEnd` the top-2 storage is **frozen** (nothing can write it). The only moving input is `block.number` vs `exclusiveUntil`: inside the window the branch is fixed; crossing the window boundary flips *outsider: revert → pass* and *winner: improved → base*. This is **time-dependent gating**, the same class as `Deadline` (0x20), `WhitelistSequential` (0x2d) and `DutchAuction` (0x94), all of which change outcome across blocks. In-tree accepted; PROGRAMS.md's "same inputs -> same branch" holds because `block.number` is an input. | ✅ (documented) |
| `blockhash` past 256 blocks (v1's R-1) | **Eliminated** — no `blockhash` anywhere. | ✅ |
| Book upgraded / owner changes params | **Eliminated by spec**: the Book has no owner, no upgrade path, and auction params are immutable after `open()`. If a judge asks "who can change `outcome()`?" the answer is "nobody". | ✅ |
| Instruction executed twice in one program | Both executions read the same frozen storage → same result. (This is the hazard `Extruction.sol` warns about for *stateful* targets; ours is `view`.) | ✅ |
| Maker `dock()`s the Aqua position mid-auction | Balances shrink for *both* quote and swap identically; the auction outcome is unaffected. Bidders bear maker-withdrawal risk — the same risk any Aqua taker bears. | ✅ (documented) |

**Residual honesty point for the demo:** during another bidder's exclusive window, an
outsider's `quote()` reverts. That is the *intended* gate, and it is identical to what
`WhitelistSequential` does to non-listed takers today.

### 2.3 The surplus needs no transfer — verified against `LimitSwap.sol`

The winning bid is a **price improvement in basis points**. The instruction scales
`balanceIn` up by `(BPS + clearingBps) / BPS` and lets normal settlement run.
`LimitSwap.exec` (read at source) computes:

```
exact-in :  amountOut = amountIn * balanceOut / balanceIn          (floor → favours maker)
            full fill : amountIn = balanceIn, amountOut = balanceOut   when amountIn >= balanceIn
exact-out:  amountIn  = ceil(amountOut * balanceIn / balanceOut)   (ceil  → favours maker)
            full fill : amountIn = balanceIn, amountOut = balanceOut   when amountOut >= balanceOut
```

`balanceIn / balanceOut` is the per-unit price in both directions, so scaling `balanceIn`
by `(1 + b)` raises the taker's price by exactly `b` in **all four branches**: less out
for the same in (exact-in), more in for the same out (exact-out), and the full-fill case
charges `balanceIn·(1+b)` for `balanceOut`. This is the mirror image of
`DutchAuctionBalanceIn` (F-106), which scales `balanceIn` *down* by `decay^elapsed`. The
taker-specified amount is never touched, so `takerTraits.validate(...)` passes.

Settlement then delivers the improved `amountIn` to the maker through the normal path —
`AQUA.push(maker, …, tokenIn, amountIn - fee)` in Aqua mode, or `transferFrom` to the
maker in signature mode. **No escrow, no payout path, no reentrancy surface.**

**Ordering constraint (security-critical per PROGRAMS.md):** the instruction must execute
*after* balances are set and *before* the swap-curve instruction — exactly the
`DutchAuction` constraint. In Aqua mode `SwapVM` loads balances before `runLoop`, so
`[Glasshouse → LimitSwap]` is valid; in signature mode
`[StaticBalances → Glasshouse → LimitSwap]`. `LimitSwap` enforces direction, so a
reverse-direction query reverts there before any mispriced fill.

---

## 3. Auction format: sealed-bid second-price with a reserve. No randomised close.

This is the part a judge will attack (F-87), and the v1 defence was half right.

### 3.1 The objection, stated at full strength

> *"A Dutch auction is strategically equivalent to a first-price sealed-bid auction —
> always, for any valuations. You have reimplemented opcode 0x94 with extra steps."*

And its sharper sibling, which a formal-methods judge (the `KSwap-VM` people won a badge
on exactly this rigour) will add:

> *"Revenue Equivalence (Vickrey 1961; Myerson 1981): under independent private values,
> risk-neutral symmetric bidders, all four standard formats — Dutch, English, first-price
> sealed, second-price sealed — yield the same expected seller revenue and the same
> allocation. So even a second-price auction cannot beat 0x94 for the maker."*

### 3.2 The answer, in the order to give it

1. **Different equivalence class — correctly stated.** Dutch ≡ first-price sealed-bid is a
   *strategic* equivalence and holds unconditionally. Vickrey (second-price sealed) ≡
   English is an equivalence of *dominant strategies under independent private values*:
   bid your value / stay in until the price reaches your value. Under IPV the objection
   simply does not apply to us; it is a different textbook chapter. (State the IPV caveat
   yourself; a judge who has to supply it will score you down.)

2. **We do not claim to beat Revenue Equivalence. We claim its allocation premise fails
   on-chain for 0x94 — and that is provable from source (F-106).** RET assumes the object
   goes to the highest-value bidder. In `DutchAuctionBalanceIn` the clock is quantised to
   `block.timestamp`; at the first block where the posted price is below *any* bidder's
   value, every willing bidder faces the same price and the fill goes to the
   **first-ordered transaction**, not the highest-value bidder. Allocation is by
   latency/priority fee; the price is the *posted* price; the difference
   (highest value − posted price) is bid away as priority fee **to the builder**. A sealed
   batch allocates to the highest bidder and captures that difference *in the bid* — as
   the second-highest value under Vickrey. **Our claim is about the allocation rule and
   who receives the surplus, not about expected revenue under RET.** Say it that
   precisely and there is nothing to falsify.

3. **Second-price, not first-price, for a practical reason, not a theoretical flourish:**
   truthful bidding is dominant, so bidders need not model each other's latency or
   valuations. With the thin bidder sets a new mechanism will actually see, bid-shading
   in a first-price auction would be noisy and would depress maker revenue; Vickrey
   removes the guesswork. This also satisfies F-90 item 1 (*"go second-price"*).

4. **Sealed (commit–reveal) is kept — but for shill resistance, not for anti-sniping.**
   In an *open* second-price auction the maker (or a confederate) can watch the top bid
   and insert a shill just below it, extracting nearly first-price and destroying the
   truthfulness argument. Commit–reveal means nobody, maker included, sees a bid before
   commits close. That is the honest reason sealed bids matter here, and it survives Q&A.

### 3.3 Why the randomised close is gone

A candle/randomised close defends **open ascending** auctions against last-second
sniping. In a sealed commit–reveal nobody can react to anyone's bid, so there is nothing
to snipe; the close was solving a problem this mechanism does not have, while costing:
`blockhash` weakness (v1's R-6), the 256-block liveness bound (R-1), and — worst — a real
**quote/swap divergence** when a taker's tx crossed the 256-block boundary and
`blockhash` silently became zero, moving the close and potentially the winner. F-90 asks
for *"a committed/randomised close **or** second-price."* We take second-price. Fixed
`commitEnd` / `revealEnd` block numbers; deterministic everywhere.

### 3.4 Weaknesses we state ourselves (a judge will find them otherwise)

- **Reveal withholding / bidder rings.** With bids A=100 > B=90 > C=80 (bps), B can
  decline to reveal so A pays 80. Standard Vickrey weakness. Mitigation: the forfeited
  bond must exceed the gain from withholding, so the maker sets
  `bond ≥ maxImprovementBps × expected notional / BPS` in `tokenIn`; forfeitures go to the
  maker, who is the only party harmed. State the bound; do not claim to solve collusion.
- **Sequencer censorship of the last commit block.** Base has a single sequencer that
  could drop commits at `commitEnd`. Not ours to solve; no format fixes it. Say so.
- **Maker-withdrawal risk** for bidders (§2.2, last row).

---

## 4. Components

```
                    ┌──────────────────────────────────────────────┐
                    │  1inch, deployed on Base, NOT vendored       │
                    │  Aqua   0x1111113ccf…6a90a                   │
                    │  AquaSwapVMRouter 0x111111338c…c0de 20,376 B │
                    │  (contains Extruction 0x04)                  │
                    └───────┬─────────────────────────┬────────────┘
                   inherits │                         │ Extruction(target) — Path B
        ┌───────────────────▼──────────┐   ┌──────────▼────────────────────┐
        │ GlasshouseRouter             │   │ GlasshouseExtruction          │
        │  is AquaSwapVMRouter         │   │  is IExtruction,              │
        │  overrides _runOpcode:       │   │     IStaticExtruction (view)  │
        │   0x2e → GlasshouseAuction   │   │  same core lib, no router     │
        │   0x2d → WhitelistSequential │   │  redeploy, no size budget     │
        └───────────────┬──────────────┘   └──────────┬────────────────────┘
                        │  both wrap GlasshouseAuctionLib.apply(query, swap, args)
                        │  STATICCALL outcome()                    │
   maker  ─open()──────▶│◀────────────────────────────────────────▶│
   bidders ─commit()───▶┌──────────────────────────────────────────┐
           ─reveal()───▶│  GlasshouseBook  — the ONLY stateful part │
   router ─postTransferIn() hook ─▶│  auctions[key(maker, orderHash)]        │
   anyone ─sweep()─────▶│  no owner · no upgrade · params immutable │
                        └───────────────────┬──────────────────────┘
                                            │ events
                                   ┌────────▼────────────────────┐
                                   │ Subgraph (STRETCH)          │
                                   │ + Subgraph MCP → dashboard  │
                                   └─────────────────────────────┘
```

**Three contracts we write, one library:**
- `GlasshouseAuctionLib` — the auction *math*, `pure`/`view`, no `Context` dependency:
  `apply(SwapQuery, SwapRegisters, address book, uint24 maxBps) → SwapRegisters`.
  Written once, tested once, wrapped twice.
- `GlasshouseRouter` (Path A, the scored "custom opcode") — `is AquaSwapVMRouter`,
  one `_runOpcode` override adding `Opcode._2e` and re-adding `WhitelistSequential`.
- `GlasshouseExtruction` (Path B, add-on) — one function; runs our mechanism on the
  **official** router at `0x1111…C0De` with no redeploy. `IExtruction` and
  `IStaticExtruction` share a selector (the signatures are identical; `view` does not
  change a selector), so one `view` implementation satisfies both.
- `GlasshouseBook` — bids, bonds, `outcome()`, the hook, `sweep()`.

**Test-only:** `GlasshouseTestRouter is SwapVM, Opcodes` + the same override — full
opcode set plus ours, so runs A/B/C of the comparison test hit one router. It is 30 KB
and undeployable, which is fine: `DutchAuctionLimitSwapInvariants.t.sol` already deploys
the 29,159-byte `SwapVMRouter` inside a Solidity test, proving the test EVM does not
enforce EIP-170.

---

## 5. Instruction and Book spec

### 5.1 `GlasshouseAuction` — opcode `Opcode._2e`

**Slot choice.** `OpcodeList.sol` defines all 256 members and says *"For new instructions
take the next free `_Ix` slots of their family bank."* Our instruction is a taker gate
(Conditions & access guards, `0x20–0x3f`); the next free slot after `WhitelistSequential`
(0x2d) is **`_2e`**. `InstructionBuilder.pushHeader(ptr, Opcode)` and
`Opcode._2e.asU8()` work unmodified, so **no 1inch file is edited or vendored** (F-117).
Baywatch's "append at 34" targeted an older `_opcodes()` array API that no longer exists
in HEAD; 34 = `_22` is also free, but `_2e` is the house-style answer and reads well on a
slide ("the opcode after the cartel ladder"). The `0xd0–0xef` bank is *Unallocated*, not
family-banked — legal, but not what the enum asks for.

**Args — 23 bytes, two fields.** Verified against `InstructionArgs`: `at(shift)` is
`calldataload(args.offset + shift)` returning a left-aligned word; `asAddress` is
`address(bytes20(word))` (top 20 bytes); `asU24` is `uint24(bytes3(word))`. Fields are
packed left-to-right with no padding, and **there is no bounds check** — a wrong offset
reads zeros or neighbouring bytes silently (F-110). Hence the round-trip test first.

| Offset | Width | Field | Build call | Parse call |
|---|---|---|---|---|
| 0 | 20 | `book` | `ptr.push(book)` (the `address` overload pushes 20 B) | `args.at(0).asAddress()` |
| 20 | 3 | `maxImprovementBps` | `ptr.push(maxBps, 3)` | `args.at(20).asU24()` |

`sizeOf() = InstructionBuilder.sizeOf() + 20 + 3 = 25` including the 2-byte header.

Dropped from v1 and why: `auctionId` → it is `ctx.query.orderHash` (one auction per order,
cryptographically bound, no circularity since the hash is not inside its own args);
`nextPC` → the register adjustment plus revert *is* the branch, no jump needed;
`closeAnchor`/`window` → no randomised close. `maxImprovementBps` stays as the maker's
defence against a malicious or buggy Book: whatever `outcome()` returns, the price cannot
move more than the maker allowed in the program they signed/shipped.

**`exec` — pseudocode, strictly read-only:**

```
exec(ctx, args):                                      // internal view
    (book, maxBps) = parse(args)
    o = IGlasshouseBook(book).outcome(ctx.query.maker, ctx.query.orderHash)   // STATICCALL

    if o.status == None:      return                  // no auction opened → plain limit order
    if o.status == Bidding:   revert AuctionInProgress()          // block.number <= revealEnd
    // o.status == Closed  (block.number > revealEnd; top-2 storage is frozen)

    if block.number <= o.exclusiveUntil:
        require(ctx.query.taker == o.winner, ExclusiveWindow(o.exclusiveUntil))
        require(o.clearingBps <= maxBps, ImprovementExceedsCap(o.clearingBps, maxBps))
        ctx.swap.balanceIn = ceilDiv(ctx.swap.balanceIn * (BPS + o.clearingBps), BPS)
        return
    // window elapsed (or no winner): open to everyone at base price
    return
```

Notes:
- **Full 160-bit address compare**, not `uint80`. Whitelist's truncation is an
  *args-packing* trade-off; our winner comes from the Book, not from args.
- `ceilDiv` → rounding favours the maker, matching `LimitSwap` and `ToxicFlowToll` (F-104).
- No `ctx.runLoop()` re-entry, like `DutchAuction`. Cheap, analysable, no wrapping.
- **Cannot emit events** (static context). All events come from the Book (§7).
- `status == None → pass` keeps a shipped strategy fillable if the maker never opens an
  auction (liveness). Makers should `open()` *before* `ship()`; the window between them is
  a plain limit order, which is harmless.

### 5.2 `GlasshouseBook` — the stateful half

```
struct Auction {
    address router;            // whose postTransferIn hook we trust
    address tokenIn;           // bond denomination
    uint40  commitEnd;         // block: commit() allowed while block.number <= commitEnd
    uint40  revealEnd;         // block: reveal() allowed while commitEnd < block.number <= revealEnd
    uint16  exclusiveBlocks;   // winner's exclusive window after revealEnd
    uint24  reserveBps;        // maker's implicit second bid
    uint24  maxBps;            // bids above this are rejected at reveal
    uint128 bond;              // per bidder, in tokenIn, fixed by maker
    // running result — written only by reveal(), only while block.number <= revealEnd
    address best;      uint24 bestBps;      uint40 bestCommitIdx;
    address second;    uint24 secondBps;
    // settlement — written only by hook/sweep, never read by outcome()
    address filledBy;  bool swept;
}
key = keccak256(maker, orderHash)            // maker = msg.sender of open()
```

```
open(orderHash, params)                       // maker only (msg.sender is the key's maker)
commit(maker, orderHash, commitment)          // commitment = keccak(bidder, bps, salt); block <= commitEnd
reveal(maker, orderHash, bps, salt)           // commitEnd < block <= revealEnd; pulls bond in tokenIn;
                                              // reserveBps <= bps <= maxBps else rejected;
                                              // updates (best, second) top-2 in O(1); tie → lower commitIdx
outcome(maker, orderHash) view                // → (status, winner, clearingBps, exclusiveUntil)
postTransferIn(...)  [IMakerHooks]            // require msg.sender == a.router; filledBy = taker if unset
sweep(maker, orderHash)                       // block > exclusiveUntil: refund all bonds except
                                              // the winner's if filledBy != winner → forfeit to maker
```

**`outcome()` semantics — this resolves v1's R-3 (one bidder):**

| Situation at `block.number > revealEnd` | `winner` | `clearingBps` | `exclusiveUntil` |
|---|---|---|---|
| ≥ 2 eligible reveals | `best` | `max(reserveBps, secondBps)` | `revealEnd + exclusiveBlocks` |
| exactly 1 eligible reveal | `best` | `reserveBps` (the maker's implicit second bid — textbook Vickrey-with-reserve) | `revealEnd + exclusiveBlocks` |
| 0 eligible reveals | `address(0)` | 0 | `revealEnd` (no window → open immediately) |

`status` is `None` if never opened, `Bidding` while `block.number <= revealEnd`, else
`Closed`. **`outcome()` is O(1)** — the top-2 is maintained on reveal, so v1's "cap bidders
at 32 so the scan fits the staticcall budget" is unnecessary and removed. Reveal order is
irrelevant to the result (max is order-independent; ties use commit index, fixed before
anyone knew they were tying, so it re-introduces no latency race). The maker's
`reserveBps` is also the hook for F-101's *adaptive reserve pricing*, should time allow.

**Bond in `tokenIn`**, fixed per auction by the maker. Rationale: the bidder must hold
`tokenIn` to fill anyway; forfeiture goes to the maker in the token the maker was owed;
the recommended sizing `bond ≥ maxBps × notional / BPS` makes both winner no-show and
reveal-withholding unprofitable. Native-ETH bonds are the acceptable fallback if
`SafeERC20` handling eats time, at the cost of the sizing argument.

### 5.3 `GlasshouseExtruction` — Path B wrapper

```
extruction(isStatic, nextPC, query, swap, args, takerData) view
    → (nextPC, 0, GlasshouseAuctionLib.apply(query, swap, parse(args)))
```
Program on the **official** router: `[Extruction(target = GlasshouseExtruction, args) → LimitSwap]`.
Because the target only reads frozen storage, the divergence hazard `Extruction.sol`
documents for stateful targets does not arise.

---

## 6. Bytecode budget and the Path A / Path B decision (F-108)

`SwapVMRouter` with the full opcode set is **29,159 B: undeployable**. We build from
`AquaSwapVMRouter` (20,376 B; 4,200 B headroom). Compiler: `0.8.30`, `viaIR`,
`optimizer.runs = 700` (from `hardhat.config.ts`).

**Calibration, from measured data rather than guesses:** `AquaSwapVMRouterDebug` is
23,805 B vs 20,376 B — **3,429 B for seven Debug instructions ≈ 490 B each**, and those
include console string formatting, so they are an upper-middle anchor. Only `exec`/`parse`
enter the router; `build`/`sizeOf` are `internal pure` helpers referenced solely by tests.

| Item | Bytes (est.) | Basis |
|---|---|---|
| `AquaSwapVMRouter` baseline | 20,376 | measured (F-108) |
| **EIP-170 ceiling** | **24,576** | **4,200 free** |
| `WhitelistSequential.exec` + `parse*` (unmodified import) | 400–600 | ~30 LOC, a loop and calldataloads; below the Debug average |
| `GlasshouseAuction.exec` | 900–1,400 | one `STATICCALL` + ABI decode of 4 return values dominates; `mulDiv`; two compares |
| Two `_runOpcode` dispatch arms | ~100 | two compares + two jumps |
| **Projected total** | **1,400–2,100** | **headroom ≥ 2,100 B** |

v1's ~2,600 estimate was conservative but not wrong; the risk is real only if the
instruction sprawls. **Knobs if it does:** (1) lower `optimizer.runs` for our router
profile — 700 favours runtime gas over size and we are not 1inch's gas-golfed deployment;
(2) return a packed `uint256` from `outcome()` instead of four words, cutting decode code;
(3) drop `WhitelistSequential` from the *deployed* router — it is needed in the
comparison test (which runs on the test router) but on mainnet only for an optional
"same order, two programs" flourish.

**Rules of engagement**
1. **Measure on every commit**: a script that reads the compiled artifact's
   `deployedBytecode` length and fails above 24,576. Note `solc` only *warns* at this size
   and HEAD's config even silences that warning for `*Debug.sol` — the failure would
   otherwise surface as a deploy revert.
2. `GlasshouseBook` and `GlasshouseExtruction` are separate contracts, outside this budget.
3. **Do not add** `DutchAuctionBalance*`, `OraclePriceAdjuster` or the Debug set to the
   deployed router. Dutch is exercised in the test router only.

**Should Path B be primary? Argued both ways, then decided.**

*For B from the start:* zero bytecode risk; zero router deployment/verification on day 9;
runs on the **official** router, which satisfies *"Official Aqua/SwapVM contracts must be
used"* in its strongest reading; `Extruction` is in every opcode set by design; the
mechanism is identical.

*Against:* the track text scores *"modify SwapVM opcodes and define your own instructions"*
higher, and the corpus (F-104) shows custom opcodes are the expected currency on this
track — an `Extruction` target reads as "a contract the VM calls", not "we extended the
VM". The comparison test needs stock `WhitelistSequential`/`Dutch` anyway, so a router with
extra opcodes exists regardless (in tests). And the measured headroom is ~2× our worst
estimate.

**Decision: Path A is primary, Path B is a day-8 add-on, and the code is structured so
neither is a pivot.** The auction math is a `pure` library; the opcode wrapper and the
`Extruction` wrapper are each ~15 lines. On day 9 the **mainnet** demo is run via the
`Extruction` path on the official router *first* (cheapest, no size risk, strongest
compliance line), then `GlasshouseRouter` is deployed and verified if time allows. If day-6
measurement shows the router over budget, B simply becomes the only mainnet path and A
remains the in-test "custom instruction" story — nothing is rewritten.

---

## 7. Event schema — design now, freeze day 1 (F-119)

**All events are emitted by `GlasshouseBook`.** The instruction runs under `STATICCALL`
during `quote()` and cannot `LOG`; the fill is recorded through the `postTransferIn`
hook (§2.1). There is no `finalize()` tx, so there is no on-chain "close" event: the
outcome is derivable from `AuctionOpened` params plus the `BidRevealed` set, and
`Settled` re-emits it for convenience when someone sweeps.

```
AuctionOpened (indexed maker, indexed orderHash, router, tokenIn,
               commitEnd, revealEnd, exclusiveBlocks, reserveBps, maxBps, bond)
BidCommitted  (indexed maker, indexed orderHash, indexed bidder, commitment, blockNo)
BidRevealed   (indexed maker, indexed orderHash, indexed bidder, bps, blockNo)
AuctionFilled (indexed maker, indexed orderHash, indexed taker, wasWinner,
               amountIn, amountOut, blockNo)                    // from the hook, swap() only
Settled       (indexed maker, indexed orderHash, winner, winningBps, clearingBps,
               filled, bondForfeited)                            // from sweep()
BondReleased  (indexed maker, indexed orderHash, indexed bidder, amount, forfeited)
```

`Settled` carries **both** the winning and clearing bid — the gap is the Vickrey discount
and it visualises well. `AuctionFilled.wasWinner == false` fills after the window are
**proof the mechanism is permissionless**. `AuctionFilled.amountIn` minus the base-price
`amountIn` (computable off-chain from the strategy's balances) is the **maker surplus**
metric for the dashboard.

> ⚠️ **No floats in AssemblyScript** (F-119). Emit integer components; divide in the frontend.

---

## 8. Test plan

### 🎯 Day-7 hard gate — the MVP (F-115)

`test/ComparisonTest.t.sol` on `GlasshouseTestRouter`: run **the same order three ways**
and print the price the user receives and who got the fill.

| Run | Program | Expected |
|---|---|---|
| A | `StaticBalances → WhitelistSequential → LimitSwap` | outsider **reverts** during the ladder; insider fills at base price; maker surplus 0 |
| B | `StaticBalances → DutchAuctionBalanceIn → LimitSwap` | two takers, **same block**: both quote the identical price; the **first call** fills, the second reverts on depleted balance; maker receives the *posted* price only. Model the latency race as call order within one test block — no automine tricks needed in a Solidity test |
| C | `StaticBalances → GlasshouseAuction(0x2e) → LimitSwap` | three sealed bids (e.g. 100/90/80 bps); highest wins, pays **90**; outsider reverts inside the window; after the window an outsider fills the remainder at base; `sweep()` refunds losers |

**This is the submission.** It satisfies 1inch's *"tests scripts or a UI"* with no
frontend, no subgraph, no deployment. **If run C does not work by end of day 7, cut
everything else and polish this.**

Run B must include a **latency-differentiated bidder set** (F-90): give the *second*
caller the *higher* valuation and show it loses anyway. That single assertion is the
whole F-106 argument as a test.

### Unit tests, in build order
1. **Arg round-trip** (`build ↔ parse`, 23 bytes) — before any logic (R-4).
2. `GlasshouseAuctionLib.apply` against a **mock Book** returning canned outcomes:
   all `status` × window × winner/outsider branches; exact-in and exact-out; `maxBps` cap.
3. `GlasshouseBook`: phase boundaries by block, reject-below-reserve, top-2 with ties,
   one-bidder → reserve, zero-bidder → open, hook auth, sweep accounting.
4. `GlasshouseExtruction` returns the same registers as the opcode for the same inputs.

### Invariants (F-111)

**Good news, correcting F-77/F-107:** `test/invariants/DutchAuctionLimitSwapInvariants.t.sol`
*does* exist at HEAD and is the 1D reference harness PROGRAMS.md points at. It inherits
`CoreInvariants`, deploys `SwapVMRouter` in-test, and uses signature mode. **Clone it** as
`GlasshouseInvariants.t.sol`, swap the Dutch instruction for ours, and use a Book that is
already `Closed` with a fixed winner.

| Flag | Set? | Justification |
|---|---|---|
| `skipAdditivity` | **Yes** | Gating is non-AMM; `CoreInvariants` labels the flag *"for non-AMM orders"*. |
| `skipMonotonicity` | **Probably** | Flat rate within a branch; the flag is labelled *"for flat rate orders"*. |
| `skipSpotPrice` | Try without | Single multiplicative factor on `balanceIn`; spot price should hold. |
| `skipSymmetry` | Try without | `ceilDiv` breaks exact symmetry only at rounding scale; if it trips, set it and cite `TWAPLimitSwapInvariants`' in-tree TODOs. |

Write the short **analytical-stability note** PROGRAMS.md asks for. Ours is genuinely
short: within a branch the program is a limit order scaled by a constant, so every 1D
invariant that holds for `StaticBalances → LimitSwap` holds for us with `balanceIn'`
substituted; across branches the argument is §2.2's table.

---

## 9. File tree

```
D:\ethonline\
├─ run.md                                 # research + decision log (exists)
├─ ARCHITECTURE.md                        # this file
├─ README.md                              # day 10
├─ FEEDBACK.md                            # only if we attempt Uniswap
├─ AI-DISCLOSURE.md                       # required (F-44): prompts + spec files
├─ hardhat.config.ts                      # ⚠️ ADD base + baseSepolia — HEAD ships localhost only
├─ src/
│  ├─ libs/GlasshouseAuctionLib.sol       # the math, pure/view, no Context dependency
│  ├─ instructions/GlasshouseAuction.sol  # opcode wrapper: sizeOf/build/parse/exec, Opcode._2e
│  ├─ routers/GlasshouseRouter.sol        # is AquaSwapVMRouter; one _runOpcode override
│  ├─ extruction/GlasshouseExtruction.sol # Path B wrapper (day 8)
│  ├─ book/GlasshouseBook.sol             # bids, bonds, outcome(), IMakerHooks, sweep()
│  └─ interfaces/IGlasshouseBook.sol
├─ test/
│  ├─ ComparisonTest.t.sol                # 🎯 THE SUBMISSION
│  ├─ routers/GlasshouseTestRouter.sol    # is SwapVM, Opcodes + override — test-only, 30 KB
│  ├─ mocks/BookMock.sol
│  ├─ GlasshouseArgs.t.sol                # round-trip, first
│  ├─ GlasshouseAuction.t.sol
│  ├─ GlasshouseBook.t.sol
│  └─ invariants/GlasshouseInvariants.t.sol   # cloned from DutchAuctionLimitSwapInvariants
├─ script/                                # deploy Book + Extruction (+ Router if budget) to Base
└─ subgraph/                              # STRETCH only
```

**Licence hygiene (F-117):** 1inch code is consumed as an npm dependency
(`@1inch/swap-vm` is a package; `@1inch/aqua` is already a dependency of it). **Never
vendored.** Our own code is MIT; the README states the boundary explicitly.

---

## 10. Nine-day plan — re-sequenced against F-110 (18–35 h for the opcode)

v1 gave the opcode one day (day 6) with the Book before it and the hard gate right
after. Reviewer B's estimate says the VM integration alone can consume 2.5–4.5 solo days;
the encoding layer is the sink. Three changes make the plan survivable: the args are now
23 bytes / 2 fields (most of the encoding risk is gone); the VM integration is
**front-loaded** to day 5 against a mock Book so it has days 5, 6-spill and 8 to land; and
day 8 is an explicit buffer that v1 did not have.

| Day | Work | Gate |
|---|---|---|
| **4** Sep 4 | `nvm use 22.20.0`. Clone, install, **cold compile (~7 min)**, run stock tests green. Add `base`/`baseSepolia` networks + Ignition params. Re-pull prizes page for Ledger + Chainlink (F-48). Write `GlasshouseArgs.t.sol` round-trip (build↔parse) and `IGlasshouseBook` + event signatures **frozen**. Bytecode-size check script. First commits (F-40). | **Green build + round-trip test passing.** |
| **5** | `GlasshouseAuctionLib` + opcode wrapper + `GlasshouseRouter` + `GlasshouseTestRouter`, unit-tested against `BookMock`. **Measure bytecode.** | Opcode executes in both `quote()` and `swap()`; size known. |
| **6** | `GlasshouseBook` v1: `open/commit/reveal/outcome` + hook + events. Unit tests incl. one-bidder and zero-bidder. (Bonds/`sweep` may slip to day 8.) | Book tests pass; **Path A/B mainnet decision recorded** from day-5 size. |
| **7** | 🎯 **`ComparisonTest.t.sol`, all three runs.** | 🔴 **HARD GATE** |
| **8** | **Buffer for 5–7 spillover** (this is where F-110's hours go). Then bonds + `sweep()`; `GlasshouseExtruction` (~2 h) if green. | Full lifecycle green locally. |
| **9** | Base mainnet: deploy Book + Extruction; `open()`, `ship()` a dust strategy on the **official router**, commit/reveal from 2–3 wallets, fill, sweep. Then deploy + verify `GlasshouseRouter` if time. | **Tx hashes in hand.** |
| **10** | Invariant suite (clone of the Dutch harness) + skip-flag justifications + stability note. README, `AI-DISCLOSURE.md`, licence check. | **1inch submission complete and submittable.** |
| **11** | Subgraph + Subgraph MCP — **only if 4–10 all landed**. Otherwise start the video. | Live data, or video draft. |
| **12** | **CUT DAY.** Dashboard only if the subgraph landed. **Record the video (3–5 h, human narration — AI voiceover is auto-reject).** Submission forms. **Submit.** | Submitted. |
| **13** | Deadline 12:00 EDT = **21:30 IST**. Buffer only. | — |

**Cut order (F-116, amended):** Chainlink oracle → HHI analytics → Subgraph MCP (= cutting
The Graph) → `GlasshouseRouter` mainnet deploy (keep Extruction on the official router) →
**bonds/sweep** (ship without bonds, say so) → **sealed bids** (open Vickrey; say so and
name the shill risk). **Never cut:** the comparison test, the opcode, one mainnet fill.

---

## 11. Risks (v1's R-1 and R-6 are eliminated; R-3 resolved in §5.2)

| # | Risk | Mitigation |
|---|---|---|
| R-2 | `outcome()` staticcall gas | O(1) running top-2; no scan, no bidder cap needed |
| R-4 | **Arg packing wrong** — silent garbage, not a revert (F-110) | 2 fields, offsets 0 and 20; round-trip test **first** |
| R-5 | **Base absent from `hardhat.config.ts`** (confirmed: `localhost` only at HEAD) | Add on day 4 |
| R-7 | Bidders bond before knowing they win | Bond fixed per auction in `tokenIn`, refunded to all losers and to a winner who fills; forfeited only on winner no-show |
| R-8 | **Bidding is worthless if outsiders can fill at base price anytime** (v1 design flaw) | Exclusive window; outsiders revert inside it |
| R-9 | Reveal withholding / bidder rings depress the clearing price | Bond ≥ `maxBps × notional / BPS`; forfeits to maker; stated openly (§3.4) |
| R-10 | Hook spoofing: anyone calls `postTransferIn` claiming a fill | `require(msg.sender == auction.router)`; router address fixed at `open()` |
| R-11 | Auction squatting: a stranger opens an auction for someone else's order | Key is `keccak(msg.sender, orderHash)` and the instruction queries with `ctx.query.maker` — only the real maker's auction is ever read |
| R-12 | Who can change `outcome()`? | Nobody: no owner, no upgrade, params immutable after `open()` |
| R-13 | Maker `dock()`s mid-auction | Documented bidder risk; identical to any Aqua taker's risk |
| R-14 | Reverse-direction query mis-scales `balanceIn` | `LimitSwap` direction check reverts before any fill; program layout fixed in §2.3 |
| R-15 | Sequencer censors last-block commits | Not solvable by format; state it |
| R-16 | `quote()` reverts for outsiders during the window and looks like a "broken" order to generic UIs | Same behaviour as `WhitelistSequential`; document; dashboard shows the window |

---

## 12. What we explicitly are NOT claiming

- ❌ **Not** "the first custom SwapVM opcode." Baywatch shipped three (F-104).
- ❌ **Not** "an auction-managed AMM." That won 1st place on this track already (F-102).
- ❌ **Not** "a 10-slot resolver cap" — not in the source. Say
  **`resolverPercentageThreshold`, a percentage-of-supply capital gate enforced in
  `WhitelistRegistry.sol`** (F-103).
- ❌ **Not** "higher expected revenue than a Dutch auction" — Revenue Equivalence forbids
  that claim under its own assumptions. We claim the **allocation rule** differs
  (by bid, not by latency) and that the **surplus recipient** differs (maker, not builder).
- ❌ **Not** collusion-proof, censorship-proof, or production randomness — there is no
  randomness at all now, and we say the other two out loud (§3.4).
- ✅ **We claim exactly one thing:** SwapVM allocates taker priority by identity or by
  clock, never by bid; we add the instruction that does, and route the surplus to the
  maker rather than the builder.

---

## 13. Corrections to `run.md` surfaced by this review (for the main agent to log)

Read from `1inch/swap-vm@08089a1` (main, 2026-09-01), local clone.

1. **F-70** says five registers including `amountNetPulled`. `SwapRegisters` in `VM.sol`
   has **four**: `balanceIn, balanceOut, amountIn, amountOut`. The taker-specified one is
   fixed; the instruction chain computes the other.
2. **F-77 / F-107** doubted `DutchAuctionLimitSwapInvariants.t.sol` exists. **It exists**
   at `test/invariants/`, alongside `DutchAuctionLimitSwapFeesInvariants.t.sol`,
   `ExactInOutSymmetry.t.sol` and `RoundingInvariants.sol`, and PROGRAMS.md names it as
   the 1D reference. It is our harness.
3. **F-104** describes Baywatch overriding `_opcodes()` and appending at indices 34–36.
   That API is **gone at HEAD**: `AquaOpcodes` is an `if/else` chain in
   `_runOpcode(Context memory, uint256, bytes calldata) internal virtual`, and the router's
   `_dispatch` calls it. Extension = override `_runOpcode`, handle new opcodes, `else
   super._runOpcode(...)` — exactly what `AquaOpcodesDebug` does. Slot numbering is the
   `Opcode` enum (all 256 defined), not array indices.
4. **F-72** says `AquaOpcodes` has 16 opcodes; the HEAD chain dispatches **16 arms**
   (`Jump, JumpIfTokenIn, JumpIfTokenOut, Deadline, OnlyTaker×3, XYCSwap,
   XYCConcentrateSwap, Decay, Salt, FeeFlatIn, FeeProtocol, PeggedSwap, Extruction,
   OnlyTxOriginTokenBalanceNonZero`) — consistent, and note `Deadline` *is* present
   (a time gate on the deployed router) while no whitelist, Dutch, or `StaticBalances`
   is. Aqua-mode balances come from Aqua, so `StaticBalances` is not needed there.
5. `hardhat.config.ts` at HEAD has **only `localhost`** — not `localhost/sepolia/mainnet`
   as F-119 records. Base must be added either way.
6. Solidity tests in this repo deploy the 29,159-byte `SwapVMRouter` (`DirectSwapVMHelper`,
   `DutchAuctionLimitSwapInvariants`) — the test EVM does not enforce EIP-170, so the
   full-opcode **test** router is viable; only the **deployed** router is budget-bound.
