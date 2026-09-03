// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @notice Lifecycle of a Glasshouse auction, as seen by the VM instruction.
/// @dev The instruction only ever *reads* this. All transitions are driven by
///      `block.number` crossing fixed, immutable boundaries set at `open()`.
enum AuctionStatus {
    /// @dev No auction was ever opened for this (maker, orderHash). The order
    ///      behaves as a plain limit order. This keeps a shipped strategy fillable
    ///      if the maker never opens an auction (liveness).
    None,
    /// @dev `block.number <= revealEnd`. Bids may still arrive, so no winner exists
    ///      yet and the order must not be fillable.
    Bidding,
    /// @dev `block.number > revealEnd`. The top-2 is frozen forever; `outcome()` is
    ///      a pure function of frozen storage.
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
/// @notice The read side of the auction book, consumed by the SwapVM instruction
///         via STATICCALL.
/// @dev CRITICAL: `outcome` MUST be `view`. The instruction runs inside both
///      `quote()` (static context) and `swap()`; any state write here would make the
///      two diverge and break quote/swap consistency.
interface IGlasshouseBook {
    /// @notice Resolve an auction to its (frozen) result.
    /// @dev Must be O(1) — this runs inside a swap and shares the taker's gas budget.
    ///      Must depend only on frozen storage and `block.number`.
    /// @param maker     Maker who opened the auction (the key's namespace, so nobody
    ///                  can squat an auction on someone else's order).
    /// @param orderHash The strategy/position identifier from `ctx.query.orderHash`.
    function outcome(address maker, bytes32 orderHash) external view returns (Outcome memory);
}
