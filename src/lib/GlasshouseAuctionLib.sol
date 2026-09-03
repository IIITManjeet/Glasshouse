// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";

import { SwapQuery, SwapRegisters } from "@1inch/swap-vm/src/libs/VM.sol";

import { IGlasshouseBook, Outcome, AuctionStatus } from "../interfaces/IGlasshouseBook.sol";

/// @title GlasshouseAuctionLib
/// @notice The auction mechanism, expressed without any dependency on SwapVM's
///         `Context`. Written once, wrapped twice: by the opcode (Path A) and by the
///         Extruction target (Path B).
/// @dev Every function here is `view` at most. This is the property the whole design
///      rests on — see {applyOutcome}.
library GlasshouseAuctionLib {
    uint256 internal constant BPS = 10_000;

    /// @dev Taker is not the auction winner and the exclusive window has not elapsed.
    error GlasshouseExclusiveWindow(address winner, uint256 until);
    /// @dev Bidding is still open; no winner exists yet.
    error GlasshouseAuctionInProgress();
    /// @dev The Book returned an improvement above the cap the maker signed.
    error GlasshouseImprovementExceedsCap(uint256 clearingBps, uint256 maxBps);

    /// @notice Apply the auction result to the swap registers.
    ///
    /// @dev THE CENTRAL INVARIANT: this function is `view`. It writes no state and
    ///      emits no events (a LOG under STATICCALL reverts, so the instruction
    ///      *cannot* emit even if we wanted it to — all events come from the Book).
    ///      Therefore `quote()` and `swap()` observe identical behaviour for a given
    ///      (order, taker, amount, block).
    ///
    /// @dev THE SURPLUS MECHANISM: `LimitSwap` prices every branch off the ratio
    ///      `balanceIn / balanceOut`:
    ///        exact-in : amountOut = amountIn * balanceOut / balanceIn
    ///        exact-out: amountIn  = ceil(amountOut * balanceIn / balanceOut)
    ///        full fill: amountIn  = balanceIn for amountOut = balanceOut
    ///      Scaling `balanceIn` up by (1 + b) therefore raises the taker's price by
    ///      exactly `b` in all four branches. The improvement reaches the maker
    ///      through ordinary settlement — no escrow, no payout path, no reentrancy
    ///      surface. This is the mirror image of `DutchAuctionBalanceIn`, which
    ///      scales `balanceIn` *down* over time.
    ///
    /// @dev ORDERING (security-critical): must run AFTER balances are set and BEFORE
    ///      the swap-curve instruction. Aqua mode: [Glasshouse -> LimitSwap].
    ///      Signature mode: [StaticBalances -> Glasshouse -> LimitSwap].
    ///
    /// @param query  Read-only swap info; supplies `maker`, `orderHash`, `taker`.
    /// @param swap   Current registers. Only `balanceIn` is ever touched.
    /// @param book   Address of the auction book.
    /// @param maxBps Maker's cap on price movement, from the signed program. Defends
    ///               against a malicious or buggy Book: whatever `outcome()` claims,
    ///               the price cannot move more than the maker authorised.
    /// @return updated Registers with `balanceIn` adjusted (or unchanged).
    function applyOutcome(
        SwapQuery memory query,
        SwapRegisters memory swap,
        address book,
        uint24 maxBps
    ) internal view returns (SwapRegisters memory updated) {
        Outcome memory o = IGlasshouseBook(book).outcome(query.maker, query.orderHash);

        // No auction for this order: behave as a plain limit order.
        if (o.status == AuctionStatus.None) return swap;

        // Bidding still open: nobody may fill yet, or the winner could be front-run
        // by a fill at the base price before the auction resolves.
        require(o.status != AuctionStatus.Bidding, GlasshouseAuctionInProgress());

        // Closed. Two regimes, split by the exclusive window.
        if (block.number <= o.exclusiveUntil) {
            // Inside the window the winner has an exclusive right to fill.
            //
            // WHY THE WINDOW EXISTS: without it, a non-winner could fill at the
            // unimproved base price in the same block, which is strictly cheaper
            // than the winner's improved price. Bidding would then be dominated by
            // not bidding and the auction would attract no bidders at all. The
            // window is what makes a bid worth placing.
            //
            // This is the same gate `WhitelistSequential` applies to non-listed
            // takers today — the difference is that membership is earned by bid
            // rather than hardcoded by the maker, and it expires.
            require(query.taker == o.winner, GlasshouseExclusiveWindow(o.winner, o.exclusiveUntil));
            require(o.clearingBps <= maxBps, GlasshouseImprovementExceedsCap(o.clearingBps, maxBps));

            // ceilDiv: rounding favours the maker, matching LimitSwap's convention.
            swap.balanceIn = Math.ceilDiv(swap.balanceIn * (BPS + o.clearingBps), BPS);
            return swap;
        }

        // Window elapsed, or there was no winner at all: open to everyone at the
        // base price. Permissionless by default; exclusivity is bounded and earned.
        return swap;
    }
}
