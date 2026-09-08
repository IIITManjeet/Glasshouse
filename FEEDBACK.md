# Developer feedback: Uniswap v3 on Base

From building [Glasshouse](README.md), a 1inch SwapVM instruction. Not a Uniswap Hook or
CCA integration — a small, real piece of plumbing: the maker's fill inventory is bought
by swapping ETH for USDC through the deployed **Uniswap v3 QuoterV2 + SwapRouter02** on
Base (`scripts/get-usdc.ts`), and `scripts/uniswap-benchmark.mjs` (new, this submission)
quotes the same QuoterV2 to answer "what would this trade have gotten on Uniswap?" as an
external check on our own price-improvement claim, rather than only comparing ourselves
to ourselves. Two real runs against Base mainnet, one real bug, everything below is from
that — not a wishlist written without touching the stack.

## What was easy

- **The contracts just work, and they're where you'd expect.** Once verified on chain
  (`get-usdc.ts:36-39` — we checked `eth_getCode` on both the router and quoter rather
  than trusting a copied address, and separately confirmed the 0.05% WETH/USDC pool at
  `0xd0b53D9277642d899DF5C87A3966A349A798F224` is the deepest venue for the pair), the
  ABI is stable and the quote/swap round-trip is exactly as documented: quote first,
  compute a slippage floor, swap, done.
- **QuoterV2's `quoteExactInputSingle` is accurate.** We compared it against the pool's
  own token balances independently (`uniswap-benchmark.mjs`'s DEPTH section) and the
  numbers are internally consistent — no surprises there.
- **No API key, no rate-limited gateway.** Everything here is a plain `eth_call` /
  `eth_sendTransaction` against a public Base RPC. For a hackathon under time pressure,
  not having to provision Uniswap-side credentials before writing code mattered.

## What was confusing

### 1. `SwapRouter02.ExactInputSingleParams` silently drops `deadline`

The original `SwapRouter` (`v3-periphery`) and the newer `SwapRouter02`
(`swap-router-contracts`, what's actually deployed on Base at
`0x2626664c2603336E57B271c5C0b26F421741e481`) have **struct-incompatible**
`ExactInputSingleParams`. We diffed both interfaces directly:

```solidity
// ISwapRouter.sol (original) — has deadline
struct ExactInputSingleParams {
    address tokenIn; address tokenOut; uint24 fee; address recipient;
    uint256 deadline;                                   // <-- here
    uint256 amountIn; uint256 amountOutMinimum; uint160 sqrtPriceLimitX96;
}

// IV3SwapRouter.sol (SwapRouter02) — no deadline
struct ExactInputSingleParams {
    address tokenIn; address tokenOut; uint24 fee; address recipient;
    uint256 amountIn; uint256 amountOutMinimum; uint160 sqrtPriceLimitX96;
}
```

Every tutorial and Stack Overflow answer we found while building this used the original
`SwapRouter`'s seven/eight-field struct. Copy that struct against `SwapRouter02` and you
get a **silent ABI mismatch** — the call either reverts with no useful reason or, worse,
decodes garbage into the wrong fields, because struct tuples are positional. We caught it
only because we hand-wrote the ABI and cross-checked field order rather than pasting a
snippet (`get-usdc.ts:75-76`). Nothing on the Uniswap docs site we read flagged that
`SwapRouter02` is a different, non-drop-in interface from `SwapRouter`, despite Base
having no `SwapRouter` (v1) deployment we could find — `SwapRouter02` is simply *the*
router on Base, so this is the interface a new integrator on this chain will use first,
with no L1-router training wheels to have already taught them the difference.

**Suggestion:** a one-paragraph callout on the SwapRouter02 reference page — "if you're
copying `ExactInputSingleParams` from `SwapRouter` docs, delete the `deadline` field" —
would have saved us the diff above.

### 2. Deadline protection didn't disappear, it moved — and that's easy to miss

Removing `deadline` from the swap struct doesn't mean SwapRouter02 dropped deadline
protection; it moved it to `IMulticallExtended.multicall(uint256 deadline, bytes[]
data)`, which wraps the call instead of parameterizing it. That's a reasonable design (one
deadline for a whole batched multicall instead of one per leg), but it means a straight,
unwrapped `exactInputSingle` call — which is exactly what a minimal single-swap
integration like ours makes (`get-usdc.ts:178-198`) — **has no deadline protection at
all**, silently. We only avoided this because our swap is small, immediate, and this is a
hackathon script, not because we were warned. A production integration copying our
pattern (or any "quote then swap" tutorial that doesn't specifically call out multicall)
would ship with an unbounded transaction validity window and not know it.

**Suggestion:** state explicitly, next to `exactInputSingle`'s docs, that it has no
deadline of its own and that a caller who wants one must wrap the call in
`multicall(deadline, data)` — not just that `multicall` exists.

### 3. `QuoterV2` is deliberately not `view`, and the reason is easy to misread

`quoteExactInputSingle` is `nonpayable`, not `view`, even though it changes no state. The
contract's own NatSpec says why: *"These functions are not gas efficient and should
`not` be called on chain. Instead, optimistically execute the swap and check the amounts
in the callback."* (`QuoterV2.sol`, top-of-file `@dev` comment.) That's true and
well-intentioned, but out of context it reads like a warning against using the quoter at
all in real code, when what it actually means is "call it exactly like you'd call a
state-changing function, then discard the result instead of broadcasting it" — i.e. via
`eth_call` with the ABI's own state mutability, or in viem, `simulateContract` rather
than the more natural `readContract` (which the ABI's declared mutability makes
TypeScript refuse for a `nonpayable` entry, even though the RPC call underneath is
identical either way — we checked). We got this right because `get-usdc.ts` predates this
submission and already used `simulateContract`, but it took reading the actual quoter
source to understand *why* that's the right call and not just a style choice.

**Suggestion:** an explicit "how to call this from ethers/viem" snippet next to the quoter
reference, not just the Solidity NatSpec, would close the gap between "why is this not
`view`" and "what do I actually type."

### 4. A real bug, and it wasn't Uniswap's fault — but Uniswap's error surface made it harder to find

The most interesting thing that happened: a swap reverted with `STF` while the wallet
held exactly the WETH it had just wrapped and a 10x allowance already granted to the
router — both preconditions visibly satisfied on chain. The identical call simulated
clean seconds later. Root cause (commit `6b3a037`, `get-usdc.ts:160-176`): viem's
`sendTransaction` runs `eth_estimateGas` at `"latest"` internally, and Base's public RPC
endpoint is load-balanced across replicas a block or two apart. The approve had mined,
but the gas estimate was answered by a replica that hadn't applied that block yet, so the
allowance it saw was zero, and `TransferHelper.safeTransferFrom` — `require(success && (…
), 'STF')` — reverted with a two-character string that names the token transfer and says
nothing about *why* it failed. That is 100% infrastructure (Base's RPC layer, not
Uniswap's contracts), but the diagnosis was harder than it needed to be because `STF` is
the entire error surface: no custom error, no operands, nothing to grep for or reason
about beyond "some transfer somewhere failed." A require string with the token, spender,
and amounts involved — even just as a custom error's arguments — would have pointed
straight at "allowance looked like 0" instead of us re-deriving that from first
principles (fix in commit `6b3a037`). The same public Base endpoint also rate-limited us
separately (`-32016`, fixed by spreading load across providers in commit `a34de4b`) —
a different symptom of the same underlying "one public RPC, hammered" problem, and
neither is Uniswap's to fix, but both ate time that would otherwise have gone into the
Uniswap integration itself.

**Suggestion:** `TransferHelper`'s two/three-character revert strings (`STF`, `STE`,
`STAF`, `SA`) predate custom errors and cost real debugging time when something upstream
of Uniswap (an RPC provider's own consistency, in our case) is what's actually wrong.
Even a doc page that says "if you see STF/STE and your balances and allowances look
correct on a block explorer, suspect stale state at your RPC provider, not your
transaction" would have cut our diagnosis time from about an hour to a few minutes.

## What we built to make our own claim honest

`scripts/uniswap-benchmark.mjs` quotes the same QuoterV2 pinned to a specific block and
prints it next to Glasshouse's own synthetic constant-product price at the same trade
size — explicitly including the case where Uniswap's quote is *better*, which at the
live fill's real size (0.00001 WETH) it is: Uniswap's pool held roughly 2.5 million times
more WETH than the dust reserves our demo order declares, and the script says so rather
than only printing the comparison that flatters us. We'd rather ship that than a number
that only works one way.

## Summary

Everything above came from two real runs against Base mainnet, not a read-through of the
docs. The contracts do what they say; the two places we spent real time were (a) the
`SwapRouter` → `SwapRouter02` struct change not being called out anywhere we found it
before we found it ourselves, and (b) an RPC-consistency bug whose error message, `STF`,
told us the symptom and nothing about the cause. Both are small, both are fixable with
documentation rather than code, and both cost us more time than the actual integration
did.
