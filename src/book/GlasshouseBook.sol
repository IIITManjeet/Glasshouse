// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import { IMakerHooks } from "@1inch/swap-vm/src/interfaces/IMakerHooks.sol";

import { IGlasshouseBook, Outcome, AuctionStatus } from "../interfaces/IGlasshouseBook.sol";

/// @title GlasshouseBook
/// @notice Sealed-bid, second-price auction for the right to fill a SwapVM order.
///
/// @dev The only stateful contract in Glasshouse. The instruction reads {outcome}
///      under STATICCALL and never writes.
///
/// @dev No owner, no upgrade path, no admin; parameters are immutable after {open}.
///      Nothing can change what `outcome()` returns.
///
/// @dev Phases are disjoint in block space, which is the core safety property:
///        commit  block.number <= commitEnd
///        reveal  commitEnd < block.number <= revealEnd
///        fill    block.number > revealEnd
///      No block holds both a reveal and a fill, so the top-2 is frozen before any
///      fill can observe it.
contract GlasshouseBook is IGlasshouseBook, IMakerHooks {
    using SafeERC20 for IERC20;

    uint256 internal constant BPS = 10_000;

    struct Auction {
        // --- immutable after open() ---
        address router; // whose postTransferIn hook we trust
        address tokenIn; // bond denomination
        uint40 commitEnd;
        uint40 revealEnd;
        uint40 exclusiveBlocks;
        uint24 reserveBps; // maker's implicit second bid
        uint24 maxBps; // reveals above this are rejected
        uint128 bond; // per bidder, in tokenIn
        // --- written only by reveal(), only while block.number <= revealEnd ---
        address best;
        uint24 bestBps;
        uint40 bestCommitIdx;
        // Only the runner-up PRICE is kept. Which address held it is reveal-order
        // dependent on ties; `secondBps` is not.
        uint24 secondBps;
        uint40 commitCount;
        // --- written only by the hook / sweep(); never read by outcome() ---
        address filledBy;
        bool settled;
        bool winnerForfeited;
    }

    struct Bid {
        bytes32 commitment;
        uint40 commitIdx;
        bool revealed;
        bool bondClaimed;
    }

    mapping(bytes32 key => Auction) private _auctions;
    mapping(bytes32 key => mapping(address bidder => Bid)) private _bids;

    event AuctionOpened(
        address indexed maker,
        bytes32 indexed orderHash,
        address router,
        address tokenIn,
        uint40 commitEnd,
        uint40 revealEnd,
        uint40 exclusiveBlocks,
        uint24 reserveBps,
        uint24 maxBps,
        uint128 bond
    );
    event BidCommitted(address indexed maker, bytes32 indexed orderHash, address indexed bidder, uint40 commitIdx);
    event BidRevealed(address indexed maker, bytes32 indexed orderHash, address indexed bidder, uint24 bps, uint128 bond);
    event AuctionFilled(address indexed maker, bytes32 indexed orderHash, address indexed taker, uint256 amountIn, uint256 amountOut);
    event AuctionSettled(address indexed maker, bytes32 indexed orderHash, address winner, uint24 clearingBps, bool winnerForfeited);
    event BondClaimed(address indexed maker, bytes32 indexed orderHash, address indexed bidder, uint128 amount);
    event ForfeitClaimed(address indexed maker, bytes32 indexed orderHash, uint128 amount);
    event UnrevealedForfeited(address indexed maker, bytes32 indexed orderHash, address indexed bidder, uint128 amount);

    error AlreadyOpened();
    error NotOpened();
    error BadWindow();
    error CommitClosed();
    error RevealClosed();
    error RevealNotOpen();
    error AlreadyCommitted();
    error NoCommitment();
    error AlreadyRevealed();
    error BadReveal();
    error BidOutOfRange(uint24 bps, uint24 reserveBps, uint24 maxBps);
    error NotRouter();
    error NotSettled();
    error AlreadySettled();
    error WindowNotElapsed();
    error NothingToClaim();

    function key(address maker, bytes32 orderHash) public pure returns (bytes32) {
        return keccak256(abi.encodePacked(maker, orderHash));
    }

    /// @notice Compute the commitment for a sealed bid.
    /// @dev A convenience, but not only that: hand-packing this wrong produces a
    ///      commitment that can never be revealed, and since the bond escrows at
    ///      {commit} the bidder then loses it. A bidder should always take the
    ///      commitment from here rather than construct it themselves.
    function commitmentFor(address bidder, uint24 bps, bytes32 salt) public pure returns (bytes32) {
        return keccak256(abi.encodePacked(bidder, bps, salt));
    }

    /// @notice Open an auction for one of your own orders.
    /// @dev `msg.sender` is the maker and namespaces the key, so an auction cannot be
    ///      squatted on someone else's order.
    function open(
        bytes32 orderHash,
        address router,
        address tokenIn,
        uint40 commitBlocks,
        uint40 revealBlocks,
        uint40 exclusiveBlocks,
        uint24 reserveBps,
        uint24 maxBps,
        uint128 bond
    ) external {
        bytes32 k = key(msg.sender, orderHash);
        Auction storage a = _auctions[k];
        require(a.commitEnd == 0, AlreadyOpened());
        // A zero-length exclusive window lets an outsider fill at the base price in the
        // same block, which makes bidding strictly dominated by not bidding.
        require(commitBlocks > 0 && revealBlocks > 0 && exclusiveBlocks > 0, BadWindow());
        require(reserveBps <= maxBps && maxBps < BPS, BadWindow());

        uint40 commitEnd = uint40(block.number) + commitBlocks;
        uint40 revealEnd = commitEnd + revealBlocks;

        a.router = router;
        a.tokenIn = tokenIn;
        a.commitEnd = commitEnd;
        a.revealEnd = revealEnd;
        a.exclusiveBlocks = exclusiveBlocks;
        a.reserveBps = reserveBps;
        a.maxBps = maxBps;
        a.bond = bond;

        emit AuctionOpened(msg.sender, orderHash, router, tokenIn, commitEnd, revealEnd, exclusiveBlocks, reserveBps, maxBps, bond);
    }

    /// @notice Commit to a sealed bid. `commitment = keccak256(bidder, bps, salt)`.
    /// @dev Sealed for shill resistance, not anti-sniping: in an open second-price
    ///      auction the maker could insert a bid just under the top.
    function commit(address maker, bytes32 orderHash, bytes32 commitment) external {
        bytes32 k = key(maker, orderHash);
        Auction storage a = _auctions[k];
        require(a.commitEnd != 0, NotOpened());
        require(block.number <= a.commitEnd, CommitClosed());

        Bid storage b = _bids[k][msg.sender];
        require(b.commitment == bytes32(0), AlreadyCommitted());

        b.commitment = commitment;
        b.commitIdx = a.commitCount;
        unchecked { a.commitCount = a.commitCount + 1; }

        // The bond is taken here, not at reveal. Taken at reveal, staying silent would
        // be free -- and a runner-up who stays silent drops `secondBps` to the reserve
        // and hands the winner a near-free fill. See {claimUnrevealed}.
        uint128 bond = a.bond;
        if (bond > 0) IERC20(a.tokenIn).safeTransferFrom(msg.sender, address(this), bond);

        emit BidCommitted(maker, orderHash, msg.sender, b.commitIdx);
    }

    /// @notice Reveal a committed bid.
    /// @dev Maintains the top-2 in O(1), so {outcome} needs no loop on the taker's gas
    ///      budget. Reveal order does not change the result: max is order-independent,
    ///      and ties break on commit index, fixed before anyone knew they were tying.
    function reveal(address maker, bytes32 orderHash, uint24 bps, bytes32 salt) external {
        bytes32 k = key(maker, orderHash);
        Auction storage a = _auctions[k];
        require(a.commitEnd != 0, NotOpened());
        require(block.number > a.commitEnd, RevealNotOpen());
        require(block.number <= a.revealEnd, RevealClosed());
        require(bps >= a.reserveBps && bps <= a.maxBps, BidOutOfRange(bps, a.reserveBps, a.maxBps));

        Bid storage b = _bids[k][msg.sender];
        require(b.commitment != bytes32(0), NoCommitment());
        require(!b.revealed, AlreadyRevealed());
        require(b.commitment == keccak256(abi.encodePacked(msg.sender, bps, salt)), BadReveal());

        b.revealed = true;

        // The `a.best == address(0)` arm must come first: with `reserveBps == 0` a
        // valid `bps == 0` bid satisfies neither `bps > a.bestBps` nor
        // `bps > a.secondBps`, so the only revealed bidder would fail to win.
        if (a.best == address(0) || bps > a.bestBps || (bps == a.bestBps && b.commitIdx < a.bestCommitIdx)) {
            a.secondBps = a.bestBps;
            a.best = msg.sender;
            a.bestBps = bps;
            a.bestCommitIdx = b.commitIdx;
        } else if (bps > a.secondBps) {
            a.secondBps = bps;
        }

        emit BidRevealed(maker, orderHash, msg.sender, bps, a.bond);
    }

    /// @inheritdoc IGlasshouseBook
    /// @dev MUST stay `view` and O(1). See {GlasshouseAuctionLib-applyOutcome}.
    function outcome(address maker, bytes32 orderHash) external view returns (Outcome memory) {
        Auction storage a = _auctions[key(maker, orderHash)];

        if (a.commitEnd == 0) {
            return Outcome(AuctionStatus.None, address(0), 0, 0);
        }
        if (block.number <= a.revealEnd) {
            return Outcome(AuctionStatus.Bidding, address(0), 0, 0);
        }
        if (a.best == address(0)) {
            // Nobody revealed: no winner, no exclusive window, open immediately.
            return Outcome(AuctionStatus.Closed, address(0), 0, a.revealEnd);
        }

        // Second price with reserve. One reveal leaves `secondBps` at 0, so this
        // collapses to the reserve and the price is defined at any bidder count.
        uint24 clearingBps = a.secondBps > a.reserveBps ? a.secondBps : a.reserveBps;

        return Outcome(AuctionStatus.Closed, a.best, clearingBps, a.revealEnd + a.exclusiveBlocks);
    }

    /// @notice Records who filled the order.
    /// @dev `swap()` calls maker hooks and `quote()` does not. Hooks run outside the
    ///      program, so writing here cannot affect quote/swap consistency.
    function postTransferIn(
        address maker,
        address taker,
        address,
        address,
        uint256 amountIn,
        uint256 amountOut,
        uint256,
        bytes32 orderHash,
        bytes calldata,
        bytes calldata
    ) external {
        bytes32 k = key(maker, orderHash);
        Auction storage a = _auctions[k];
        require(msg.sender == a.router, NotRouter());

        if (a.filledBy == address(0)) {
            a.filledBy = taker;
            emit AuctionFilled(maker, orderHash, taker, amountIn, amountOut);
        }
    }

    /// @notice Close out an auction once the exclusive window has elapsed.
    /// @dev Permissionless. Decides only whether the winner forfeits; bonds are claimed
    ///      individually, so there is no unbounded loop.
    function settle(address maker, bytes32 orderHash) external {
        Auction storage a = _auctions[key(maker, orderHash)];
        require(a.commitEnd != 0, NotOpened());
        require(!a.settled, AlreadySettled());
        require(block.number > a.revealEnd + a.exclusiveBlocks, WindowNotElapsed());

        a.settled = true;
        // Forfeiture requires positive evidence that someone else filled.
        //
        // `filledBy` is written only by {postTransferIn}, which fires only if the maker's
        // signed order sets the hook at this Book and `a.router` is the router that
        // filled. The Book sees neither, so a maker who omits the hook or names the wrong
        // router could otherwise force every honest winner to forfeit and collect the
        // bond. Where nothing filled at all the Book cannot tell a no-show from a broken
        // configuration, so it does not punish. Residual noted in {claimForfeit}.
        a.winnerForfeited = a.best != address(0) && a.filledBy != address(0) && a.filledBy != a.best;

        uint24 clearingBps = a.secondBps > a.reserveBps ? a.secondBps : a.reserveBps;
        emit AuctionSettled(maker, orderHash, a.best, a.best == address(0) ? 0 : clearingBps, a.winnerForfeited);
    }

    /// @notice Reclaim your bond after settlement.
    function claimBond(address maker, bytes32 orderHash) external {
        bytes32 k = key(maker, orderHash);
        Auction storage a = _auctions[k];
        require(a.settled, NotSettled());

        Bid storage b = _bids[k][msg.sender];
        require(b.revealed && !b.bondClaimed, NothingToClaim());
        require(!(a.winnerForfeited && msg.sender == a.best), NothingToClaim());

        b.bondClaimed = true;
        uint128 bond = a.bond;
        if (bond > 0) IERC20(a.tokenIn).safeTransfer(msg.sender, bond);

        emit BondClaimed(maker, orderHash, msg.sender, bond);
    }

    /// @notice Maker collects the winner's forfeited bond.
    /// @dev Sizing `bond >= maxBps * notional / BPS` makes a winner no-show unprofitable.
    ///      Withholding a reveal is covered by {claimUnrevealed}. This bounds, but does
    ///      not solve, bidder-ring collusion.
    /// @dev Residual: this fires only when someone else filled. A no-show that nobody
    ///      else fills behind keeps its bond, deliberately -- see {settle}.
    function claimForfeit(bytes32 orderHash) external {
        bytes32 k = key(msg.sender, orderHash);
        Auction storage a = _auctions[k];
        require(a.settled, NotSettled());
        require(a.winnerForfeited, NothingToClaim());

        Bid storage b = _bids[k][a.best];
        require(!b.bondClaimed, NothingToClaim());
        b.bondClaimed = true;

        uint128 bond = a.bond;
        if (bond > 0) IERC20(a.tokenIn).safeTransfer(msg.sender, bond);

        emit ForfeitClaimed(msg.sender, orderHash, bond);
    }

    /// @notice Maker collects the bond of a bidder who committed and never revealed.
    /// @dev Needs no hook and no trust in the maker's configuration: whether a commitment
    ///      was revealed is something the Book observed. Withholding is otherwise the
    ///      cheapest attack on a second-price auction, since a silent runner-up drops the
    ///      clearing price to the reserve.
    /// @param orderHash The maker's order.
    /// @param bidder    The bidder who committed without revealing.
    function claimUnrevealed(bytes32 orderHash, address bidder) external {
        bytes32 k = key(msg.sender, orderHash);
        Auction storage a = _auctions[k];
        require(a.settled, NotSettled());

        Bid storage b = _bids[k][bidder];
        require(b.commitment != bytes32(0) && !b.revealed && !b.bondClaimed, NothingToClaim());
        b.bondClaimed = true;

        uint128 bond = a.bond;
        if (bond > 0) IERC20(a.tokenIn).safeTransfer(msg.sender, bond);

        emit UnrevealedForfeited(msg.sender, orderHash, bidder, bond);
    }

    function auctions(address maker, bytes32 orderHash) external view returns (Auction memory) {
        return _auctions[key(maker, orderHash)];
    }

    function bids(address maker, bytes32 orderHash, address bidder) external view returns (Bid memory) {
        return _bids[key(maker, orderHash)][bidder];
    }

    // --- IMakerHooks: unused legs ---
    function preTransferIn(address, address, address, address, uint256, uint256, bytes32, bytes calldata, bytes calldata) external {}
    function preTransferOut(address, address, address, address, uint256, uint256, bytes32, bytes calldata, bytes calldata) external {}
    function postTransferOut(address, address, address, address, uint256, uint256, uint256, bytes32, bytes calldata, bytes calldata) external {}
}
