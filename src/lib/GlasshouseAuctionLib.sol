// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";

import { SwapQuery, SwapRegisters } from "@1inch/swap-vm/src/libs/VM.sol";

import { IGlasshouseBook, Outcome, AuctionStatus } from "../interfaces/IGlasshouseBook.sol";

/// @title GlasshouseAuctionLib
/// @notice The auction mechanism, with no dependency on SwapVM's `Context` so that it
///         can be wrapped by an opcode or by an `Extruction` target.
/// @dev Every function here is `view` at most. See {applyOutcome}.
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
    /// @dev MUST STAY `view`. `quote()` and `swap()` run the same program in different
    ///      static contexts, so any state write here makes the two diverge.
    ///
    /// @dev `LimitSwap` prices every branch off `balanceIn / balanceOut`, so scaling
    ///      `balanceIn` up by (1 + b) raises the taker's price by exactly `b` in all
    ///      four branches and ordinary settlement delivers it to the maker. This is the
    ///      mirror of `DutchAuctionBalanceIn`, which scales `balanceIn` down over time.
    ///
    /// @dev ORDERING IS SECURITY-CRITICAL: after balances are set, before the swap
    ///      curve. Aqua mode [Glasshouse -> LimitSwap]; signature mode
    ///      [StaticBalances -> Glasshouse -> LimitSwap].
    ///
    /// @param query  Supplies `maker`, `orderHash` and `taker`.
    /// @param swap   Current registers. Only `balanceIn` is touched.
    /// @param book   Address of the auction book.
    /// @param maxBps Maker's signed cap on price movement. The Book is untrusted: the
    ///               price cannot move further than the maker authorised, whatever
    ///               `outcome()` returns.
    /// @return updated Registers with `balanceIn` adjusted, or unchanged.
    function applyOutcome(
        SwapQuery memory query,
        SwapRegisters memory swap,
        address book,
        uint24 maxBps
    ) internal view returns (SwapRegisters memory updated) {
        Outcome memory o = IGlasshouseBook(book).outcome(query.maker, query.orderHash);

        // No auction for this order: behave as a plain limit order.
        if (o.status == AuctionStatus.None) return swap;

        // Bidding still open: a fill now would front-run the auction at the base price.
        require(o.status != AuctionStatus.Bidding, GlasshouseAuctionInProgress());

        // Closed. Two regimes, split by the exclusive window.
        if (block.number <= o.exclusiveUntil) {
            // Without an exclusive window a non-winner fills at the unimproved base
            // price in the same block, which is strictly cheaper than the winner's
            // improved price -- so bidding would be dominated by not bidding. The same
            // gate `WhitelistSequential` applies, except membership is earned by bid
            // and expires.
            require(query.taker == o.winner, GlasshouseExclusiveWindow(o.winner, o.exclusiveUntil));
            require(o.clearingBps <= maxBps, GlasshouseImprovementExceedsCap(o.clearingBps, maxBps));

            // ceilDiv: rounding favours the maker, matching LimitSwap's convention.
            swap.balanceIn = Math.ceilDiv(swap.balanceIn * (BPS + o.clearingBps), BPS);
            return swap;
        }

        // Window elapsed, or no winner: open to everyone at the base price.
        return swap;
    }
}
