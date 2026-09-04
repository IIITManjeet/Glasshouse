// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @notice Lifecycle of a Glasshouse auction, as seen by the VM instruction.
/// @dev The instruction only ever *reads* this. All transitions are driven by
///      `block.number` crossing fixed, immutable boundaries set at `open()`.
enum AuctionStatus {
    /// @dev No auction for this (maker, orderHash); the order fills as a plain limit
    ///      order. Keeps a shipped strategy live if the maker never opens one.
    None,
    /// @dev `block.number <= revealEnd`. Bids may still arrive, so nothing may fill.
    Bidding,
    /// @dev `block.number > revealEnd`. The top-2 is frozen.
    Closed
}

/// @notice What the instruction needs to know, and nothing more.
/// @param status         See {AuctionStatus}.
/// @param winner         Highest revealed bidder, or `address(0)` if none.
/// @param clearingBps    Price improvement the winner actually pays, in bps.
///                       Second-price: `max(reserveBps, secondHighestBps)`.
/// @param exclusiveUntil Last block (inclusive) of the winner's exclusive window.
struct Outcome {
    AuctionStatus status;
    address winner;
    uint24 clearingBps;
    uint40 exclusiveUntil;
}

/// @title IGlasshouseBook
/// @notice The read side of the auction book, consumed by the instruction via STATICCALL.
/// @dev `outcome` MUST be `view`: the instruction runs inside both `quote()` and
///      `swap()`, and a state write here would make the two diverge.
interface IGlasshouseBook {
    /// @notice Resolve an auction to its frozen result.
    /// @dev Must be O(1) and depend only on frozen storage and `block.number`; it runs
    ///      inside a swap, on the taker's gas budget.
    /// @param maker     Maker who opened the auction, and the key's namespace.
    /// @param orderHash Position identifier, from `ctx.query.orderHash`.
    function outcome(address maker, bytes32 orderHash) external view returns (Outcome memory);
}
