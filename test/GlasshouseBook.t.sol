// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Test } from "forge-std/Test.sol";

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

import { GlasshouseBook } from "../src/book/GlasshouseBook.sol";
import { Outcome, AuctionStatus } from "../src/interfaces/IGlasshouseBook.sol";

contract BondToken is ERC20 {
    constructor() ERC20("Bond", "BOND") { }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/// @title GlasshouseBookTest
/// @notice The Book is the only stateful contract in Glasshouse, and `outcome()` is
///         read from inside a swap under STATICCALL. If it is wrong, the instruction
///         faithfully applies a wrong price. Everything here exists to stop that.
///
/// The properties that actually matter, in order:
///   1. Phases are disjoint in block space. No block contains both a reveal and a fill.
///   2. The clearing price is `max(reserveBps, secondHighestBps)` for any bidder count,
///      including one and zero.
///   3. The result does not depend on reveal ORDER. If it did, we would have
///      reintroduced the latency race we are attacking.
///   4. Ties resolve to the earliest COMMIT, which was fixed before anyone knew they
///      were tying.
contract GlasshouseBookTest is Test {
    GlasshouseBook internal book;
    BondToken internal token;

    address internal constant MAKER = address(0xAAAA);
    address internal constant ROUTER = address(0x120073);
    bytes32 internal constant ORDER = keccak256("order-1");

    uint40 internal constant COMMIT_BLOCKS = 10;
    uint40 internal constant REVEAL_BLOCKS = 10;
    uint40 internal constant EXCLUSIVE_BLOCKS = 5;
    uint24 internal constant RESERVE_BPS = 10;
    uint24 internal constant MAX_BPS = 500;
    uint128 internal constant BOND = 1 ether;

    function setUp() public {
        book = new GlasshouseBook();
        token = new BondToken();
        vm.roll(1000);
    }

    // --- helpers ---------------------------------------------------------------

    function _open() internal returns (uint40 commitEnd, uint40 revealEnd) {
        vm.prank(MAKER);
        book.open(ORDER, ROUTER, address(token), COMMIT_BLOCKS, REVEAL_BLOCKS, EXCLUSIVE_BLOCKS, RESERVE_BPS, MAX_BPS, BOND);
        GlasshouseBook.Auction memory a = book.auctions(MAKER, ORDER);
        return (a.commitEnd, a.revealEnd);
    }

    function _bidder(uint256 i) internal returns (address who) {
        who = address(uint160(0xB1D000 + i));
        token.mint(who, 100 ether);
        vm.prank(who);
        token.approve(address(book), type(uint256).max);
    }

    function _commitment(address who, uint24 bps, bytes32 salt) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(who, bps, salt));
    }

    function _commit(address who, uint24 bps, bytes32 salt) internal {
        vm.prank(who);
        book.commit(MAKER, ORDER, _commitment(who, bps, salt));
    }

    function _reveal(address who, uint24 bps, bytes32 salt) internal {
        vm.prank(who);
        book.reveal(MAKER, ORDER, bps, salt);
    }

    // --- open ------------------------------------------------------------------

    function test_Open_SetsImmutableParameters() public {
        (uint40 commitEnd, uint40 revealEnd) = _open();
        assertEq(commitEnd, uint40(block.number) + COMMIT_BLOCKS, "commitEnd");
        assertEq(revealEnd, commitEnd + REVEAL_BLOCKS, "revealEnd");

        GlasshouseBook.Auction memory a = book.auctions(MAKER, ORDER);
        assertEq(a.router, ROUTER, "router");
        assertEq(a.tokenIn, address(token), "tokenIn");
        assertEq(a.reserveBps, RESERVE_BPS, "reserve");
        assertEq(a.maxBps, MAX_BPS, "max");
        assertEq(a.bond, BOND, "bond");
    }

    function test_Open_IsNamespacedByMaker() public {
        _open();
        // A different maker may open an auction on the same orderHash; it is a
        // different key, so nobody can squat an auction on someone else's order.
        address other = address(0xBBBB);
        vm.prank(other);
        book.open(ORDER, ROUTER, address(token), COMMIT_BLOCKS, REVEAL_BLOCKS, EXCLUSIVE_BLOCKS, RESERVE_BPS, MAX_BPS, BOND);

        assertTrue(book.key(MAKER, ORDER) != book.key(other, ORDER), "keys collide");
    }

    function test_Open_RevertsOnReopen() public {
        _open();
        vm.prank(MAKER);
        vm.expectRevert(GlasshouseBook.AlreadyOpened.selector);
        book.open(ORDER, ROUTER, address(token), COMMIT_BLOCKS, REVEAL_BLOCKS, EXCLUSIVE_BLOCKS, RESERVE_BPS, MAX_BPS, BOND);
    }

    function test_Open_RevertsOnZeroCommitOrRevealWindow() public {
        vm.startPrank(MAKER);
        vm.expectRevert(GlasshouseBook.BadWindow.selector);
        book.open(ORDER, ROUTER, address(token), 0, REVEAL_BLOCKS, EXCLUSIVE_BLOCKS, RESERVE_BPS, MAX_BPS, BOND);

        vm.expectRevert(GlasshouseBook.BadWindow.selector);
        book.open(ORDER, ROUTER, address(token), COMMIT_BLOCKS, 0, EXCLUSIVE_BLOCKS, RESERVE_BPS, MAX_BPS, BOND);
        vm.stopPrank();
    }

    /// @dev A zero-length exclusive window makes bidding strictly dominated: an
    ///      outsider fills at the base price in the same block the winner would fill
    ///      at the improved one. The mechanism has to refuse to be configured that way.
    function test_Open_RevertsOnZeroExclusiveWindow() public {
        vm.prank(MAKER);
        vm.expectRevert(GlasshouseBook.BadWindow.selector);
        book.open(ORDER, ROUTER, address(token), COMMIT_BLOCKS, REVEAL_BLOCKS, 0, RESERVE_BPS, MAX_BPS, BOND);
    }

    function test_Open_RevertsWhenReserveExceedsMax() public {
        vm.prank(MAKER);
        vm.expectRevert(GlasshouseBook.BadWindow.selector);
        book.open(ORDER, ROUTER, address(token), COMMIT_BLOCKS, REVEAL_BLOCKS, EXCLUSIVE_BLOCKS, 600, 500, BOND);
    }

    function test_Open_RevertsWhenMaxIsNotBelowFullBps() public {
        vm.prank(MAKER);
        vm.expectRevert(GlasshouseBook.BadWindow.selector);
        book.open(ORDER, ROUTER, address(token), COMMIT_BLOCKS, REVEAL_BLOCKS, EXCLUSIVE_BLOCKS, 0, 10_000, BOND);
    }

    // --- commit ----------------------------------------------------------------

    function test_Commit_RevertsWhenNotOpened() public {
        address a = _bidder(1);
        vm.prank(a);
        vm.expectRevert(GlasshouseBook.NotOpened.selector);
        book.commit(MAKER, ORDER, bytes32(uint256(1)));
    }

    function test_Commit_RevertsAfterCommitEnd() public {
        (uint40 commitEnd,) = _open();
        address a = _bidder(1);
        vm.roll(commitEnd + 1);
        vm.prank(a);
        vm.expectRevert(GlasshouseBook.CommitClosed.selector);
        book.commit(MAKER, ORDER, bytes32(uint256(1)));
    }

    function test_Commit_RevertsOnSecondCommitFromSameBidder() public {
        _open();
        address a = _bidder(1);
        _commit(a, 100, "s");
        vm.prank(a);
        vm.expectRevert(GlasshouseBook.AlreadyCommitted.selector);
        book.commit(MAKER, ORDER, bytes32(uint256(2)));
    }

    function test_Commit_AssignsMonotonicIndices() public {
        _open();
        address a = _bidder(1);
        address b = _bidder(2);
        _commit(a, 100, "s");
        _commit(b, 100, "s");
        assertEq(book.bids(MAKER, ORDER, a).commitIdx, 0, "first idx");
        assertEq(book.bids(MAKER, ORDER, b).commitIdx, 1, "second idx");
    }

    // --- reveal ----------------------------------------------------------------

    function test_Reveal_RevertsDuringCommitPhase() public {
        _open();
        address a = _bidder(1);
        _commit(a, 100, "s");
        vm.prank(a);
        vm.expectRevert(GlasshouseBook.RevealNotOpen.selector);
        book.reveal(MAKER, ORDER, 100, "s");
    }

    function test_Reveal_RevertsAfterRevealEnd() public {
        (, uint40 revealEnd) = _open();
        address a = _bidder(1);
        _commit(a, 100, "s");
        vm.roll(revealEnd + 1);
        vm.prank(a);
        vm.expectRevert(GlasshouseBook.RevealClosed.selector);
        book.reveal(MAKER, ORDER, 100, "s");
    }

    function test_Reveal_RevertsWithoutCommitment() public {
        (uint40 commitEnd,) = _open();
        address a = _bidder(1);
        vm.roll(commitEnd + 1);
        vm.prank(a);
        vm.expectRevert(GlasshouseBook.NoCommitment.selector);
        book.reveal(MAKER, ORDER, 100, "s");
    }

    function test_Reveal_RevertsOnWrongSalt() public {
        (uint40 commitEnd,) = _open();
        address a = _bidder(1);
        _commit(a, 100, "right");
        vm.roll(commitEnd + 1);
        vm.prank(a);
        vm.expectRevert(GlasshouseBook.BadReveal.selector);
        book.reveal(MAKER, ORDER, 100, "wrong");
    }

    /// @dev The commitment binds the bidder's own address, so a commitment cannot be
    ///      copied out of the mempool and replayed by someone else.
    function test_Reveal_CommitmentIsBoundToBidder() public {
        (uint40 commitEnd,) = _open();
        address a = _bidder(1);
        address b = _bidder(2);

        vm.prank(b);
        book.commit(MAKER, ORDER, _commitment(a, 100, "s")); // b copies a's commitment

        vm.roll(commitEnd + 1);
        vm.prank(b);
        vm.expectRevert(GlasshouseBook.BadReveal.selector);
        book.reveal(MAKER, ORDER, 100, "s");
    }

    function test_Reveal_RevertsOnDoubleReveal() public {
        (uint40 commitEnd,) = _open();
        address a = _bidder(1);
        _commit(a, 100, "s");
        vm.roll(commitEnd + 1);
        _reveal(a, 100, "s");
        vm.prank(a);
        vm.expectRevert(GlasshouseBook.AlreadyRevealed.selector);
        book.reveal(MAKER, ORDER, 100, "s");
    }

    function test_Reveal_RevertsBelowReserveOrAboveMax() public {
        (uint40 commitEnd,) = _open();
        address a = _bidder(1);
        address b = _bidder(2);
        _commit(a, RESERVE_BPS - 1, "s");
        _commit(b, MAX_BPS + 1, "s");
        vm.roll(commitEnd + 1);

        vm.prank(a);
        vm.expectRevert(abi.encodeWithSelector(GlasshouseBook.BidOutOfRange.selector, RESERVE_BPS - 1, RESERVE_BPS, MAX_BPS));
        book.reveal(MAKER, ORDER, RESERVE_BPS - 1, "s");

        vm.prank(b);
        vm.expectRevert(abi.encodeWithSelector(GlasshouseBook.BidOutOfRange.selector, MAX_BPS + 1, RESERVE_BPS, MAX_BPS));
        book.reveal(MAKER, ORDER, MAX_BPS + 1, "s");
    }

    function test_Reveal_EscrowsBond() public {
        (uint40 commitEnd,) = _open();
        address a = _bidder(1);
        _commit(a, 100, "s");
        vm.roll(commitEnd + 1);

        uint256 before = token.balanceOf(a);
        _reveal(a, 100, "s");
        assertEq(before - token.balanceOf(a), BOND, "bond not taken");
        assertEq(token.balanceOf(address(book)), BOND, "bond not escrowed");
    }

    // --- phases ----------------------------------------------------------------

    /// @dev THE SAFETY PROPERTY. The instruction only ever runs in `fill`, and the
    ///      top-2 it reads is frozen before `fill` begins. No block is in two phases.
    function test_Outcome_PhasesAreDisjointInBlockSpace() public {
        assertTrue(book.outcome(MAKER, ORDER).status == AuctionStatus.None, "before open");

        (uint40 commitEnd, uint40 revealEnd) = _open();

        vm.roll(commitEnd);
        assertTrue(book.outcome(MAKER, ORDER).status == AuctionStatus.Bidding, "at commitEnd");

        vm.roll(commitEnd + 1);
        assertTrue(book.outcome(MAKER, ORDER).status == AuctionStatus.Bidding, "first reveal block");

        vm.roll(revealEnd);
        assertTrue(book.outcome(MAKER, ORDER).status == AuctionStatus.Bidding, "at revealEnd");

        vm.roll(revealEnd + 1);
        assertTrue(book.outcome(MAKER, ORDER).status == AuctionStatus.Closed, "first fill block");
    }

    function test_Outcome_ExclusiveWindowEndsAtRevealEndPlusExclusive() public {
        (uint40 commitEnd, uint40 revealEnd) = _open();
        address a = _bidder(1);
        _commit(a, 100, "s");
        vm.roll(commitEnd + 1);
        _reveal(a, 100, "s");
        vm.roll(revealEnd + 1);

        Outcome memory o = book.outcome(MAKER, ORDER);
        assertEq(o.exclusiveUntil, revealEnd + EXCLUSIVE_BLOCKS, "window end");
    }

    // --- the clearing price ----------------------------------------------------

    function test_Clearing_TwoBidders_WinnerPaysSecondPrice() public {
        (uint40 commitEnd, uint40 revealEnd) = _open();
        address a = _bidder(1);
        address b = _bidder(2);
        _commit(a, 300, "s");
        _commit(b, 200, "s");
        vm.roll(commitEnd + 1);
        _reveal(a, 300, "s");
        _reveal(b, 200, "s");
        vm.roll(revealEnd + 1);

        Outcome memory o = book.outcome(MAKER, ORDER);
        assertEq(o.winner, a, "winner");
        assertEq(o.clearingBps, 200, "pays the second bid, not its own");
    }

    /// @dev Vickrey with one bidder is otherwise ill-posed. The reserve is the maker's
    ///      implicit second bid, so the price is well defined at any bidder count.
    function test_Clearing_SingleBidder_PaysReserve() public {
        (uint40 commitEnd, uint40 revealEnd) = _open();
        address a = _bidder(1);
        _commit(a, 400, "s");
        vm.roll(commitEnd + 1);
        _reveal(a, 400, "s");
        vm.roll(revealEnd + 1);

        Outcome memory o = book.outcome(MAKER, ORDER);
        assertEq(o.winner, a, "winner");
        assertEq(o.clearingBps, RESERVE_BPS, "reserve is the second bid");
    }

    function test_Clearing_SecondBelowReserveFloorsAtReserve() public {
        (uint40 commitEnd, uint40 revealEnd) = _open();
        address a = _bidder(1);
        address b = _bidder(2);
        _commit(a, 400, "s");
        _commit(b, RESERVE_BPS, "s");
        vm.roll(commitEnd + 1);
        _reveal(a, 400, "s");
        _reveal(b, RESERVE_BPS, "s");
        vm.roll(revealEnd + 1);

        assertEq(book.outcome(MAKER, ORDER).clearingBps, RESERVE_BPS, "floored at reserve");
    }

    /// @dev Liveness: a committed bidder who never reveals must not be able to lock the
    ///      order. No winner, no exclusive window, the order opens at base price.
    function test_Clearing_NoReveals_LeavesNoWinner() public {
        (uint40 commitEnd, uint40 revealEnd) = _open();
        address a = _bidder(1);
        _commit(a, 400, "s");
        vm.roll(commitEnd + 1);
        vm.roll(revealEnd + 1);

        Outcome memory o = book.outcome(MAKER, ORDER);
        assertTrue(o.status == AuctionStatus.Closed, "closed");
        assertEq(o.winner, address(0), "no winner");
        assertEq(o.clearingBps, 0, "no improvement");
    }

    /// @dev A zero reserve with a zero bid is the degenerate case where a naive
    ///      running-max silently drops the only revealed bidder.
    function test_Clearing_ZeroReserveZeroBid_StillHasAWinner() public {
        vm.prank(MAKER);
        book.open(ORDER, ROUTER, address(token), COMMIT_BLOCKS, REVEAL_BLOCKS, EXCLUSIVE_BLOCKS, 0, MAX_BPS, BOND);
        GlasshouseBook.Auction memory a = book.auctions(MAKER, ORDER);

        address one = _bidder(1);
        _commit(one, 0, "s");
        vm.roll(a.commitEnd + 1);
        _reveal(one, 0, "s");
        vm.roll(a.revealEnd + 1);

        Outcome memory o = book.outcome(MAKER, ORDER);
        assertEq(o.winner, one, "revealed bidder must win");
        assertEq(o.clearingBps, 0, "clearing");
    }

    // --- ties and ordering -----------------------------------------------------

    function test_Tie_EarliestCommitWins_RevealedInCommitOrder() public {
        (uint40 commitEnd, uint40 revealEnd) = _open();
        address a = _bidder(1);
        address b = _bidder(2);
        _commit(a, 300, "s");
        _commit(b, 300, "s");
        vm.roll(commitEnd + 1);
        _reveal(a, 300, "s");
        _reveal(b, 300, "s");
        vm.roll(revealEnd + 1);

        assertEq(book.outcome(MAKER, ORDER).winner, a, "earliest commit");
    }

    /// @dev The same tie, revealed in the opposite order. If revealing later could win
    ///      a tie, we would have rebuilt the latency race we are attacking.
    function test_Tie_EarliestCommitWins_RevealedInReverseOrder() public {
        (uint40 commitEnd, uint40 revealEnd) = _open();
        address a = _bidder(1);
        address b = _bidder(2);
        _commit(a, 300, "s");
        _commit(b, 300, "s");
        vm.roll(commitEnd + 1);
        _reveal(b, 300, "s");
        _reveal(a, 300, "s");
        vm.roll(revealEnd + 1);

        Outcome memory o = book.outcome(MAKER, ORDER);
        assertEq(o.winner, a, "earliest commit regardless of reveal order");
        assertEq(o.clearingBps, 300, "tied bid is the second price");
    }

    function test_Tie_ThreeWay_EarliestCommitWins() public {
        (uint40 commitEnd, uint40 revealEnd) = _open();
        address a = _bidder(1);
        address b = _bidder(2);
        address c = _bidder(3);
        _commit(a, 250, "s");
        _commit(b, 250, "s");
        _commit(c, 250, "s");
        vm.roll(commitEnd + 1);
        _reveal(c, 250, "s");
        _reveal(b, 250, "s");
        _reveal(a, 250, "s");
        vm.roll(revealEnd + 1);

        assertEq(book.outcome(MAKER, ORDER).winner, a, "earliest of three");
    }

    // --- the property that matters most ----------------------------------------

    /// @dev Reveal order must not change the outcome, and the O(1) running top-2 must
    ///      agree with a naive reference scan. This is the test that would catch a
    ///      subtly wrong displacement rule, which is the easiest thing to get wrong in
    ///      the whole contract.
    function testFuzz_TopTwo_MatchesReferenceScan(uint256 seed, uint8 rawCount) public {
        uint256 n = 2 + (uint256(rawCount) % 7); // 2..8 bidders

        address[] memory who = new address[](n);
        uint24[] memory bps = new uint24[](n);

        (uint40 commitEnd, uint40 revealEnd) = _open();

        for (uint256 i; i < n; i++) {
            who[i] = _bidder(i + 1);
            // Bound into [reserve, max] so every bid is revealable.
            bps[i] = uint24(RESERVE_BPS + (uint256(keccak256(abi.encode(seed, i))) % (MAX_BPS - RESERVE_BPS + 1)));
            _commit(who[i], bps[i], "s");
        }

        vm.roll(commitEnd + 1);

        // Reveal in a seed-dependent rotation: same set, different order.
        uint256 offset = uint256(keccak256(abi.encode(seed, "order"))) % n;
        for (uint256 i; i < n; i++) {
            uint256 j = (i + offset) % n;
            _reveal(who[j], bps[j], "s");
        }

        vm.roll(revealEnd + 1);

        // Reference: highest bid wins, earliest commit breaks ties; the clearing price
        // is the highest bid among everyone else, floored at the reserve.
        uint256 bestI = 0;
        for (uint256 i = 1; i < n; i++) {
            if (bps[i] > bps[bestI]) bestI = i; // commit index == i, so strict > keeps the earliest
        }
        uint24 second = 0;
        for (uint256 i; i < n; i++) {
            if (i != bestI && bps[i] > second) second = bps[i];
        }
        uint24 expected = second > RESERVE_BPS ? second : RESERVE_BPS;

        Outcome memory o = book.outcome(MAKER, ORDER);
        assertEq(o.winner, who[bestI], "winner disagrees with reference scan");
        assertEq(o.clearingBps, expected, "clearing price disagrees with reference scan");
    }

    // --- fill recording --------------------------------------------------------

    function test_PostTransferIn_OnlyTheConfiguredRouterMayRecord() public {
        _open();
        vm.prank(address(0xBAD));
        vm.expectRevert(GlasshouseBook.NotRouter.selector);
        book.postTransferIn(MAKER, address(1), address(0), address(0), 1, 1, 0, ORDER, "", "");
    }

    function test_PostTransferIn_RecordsOnlyTheFirstFill() public {
        _open();
        vm.startPrank(ROUTER);
        book.postTransferIn(MAKER, address(1), address(0), address(0), 1, 1, 0, ORDER, "", "");
        book.postTransferIn(MAKER, address(2), address(0), address(0), 1, 1, 0, ORDER, "", "");
        vm.stopPrank();

        assertEq(book.auctions(MAKER, ORDER).filledBy, address(1), "first filler sticks");
    }

    // --- settlement ------------------------------------------------------------

    function _runToSettlement(uint24 bidA, uint24 bidB) internal returns (address a, address b, uint40 revealEnd) {
        uint40 commitEnd;
        (commitEnd, revealEnd) = _open();
        a = _bidder(1);
        b = _bidder(2);
        _commit(a, bidA, "s");
        _commit(b, bidB, "s");
        vm.roll(commitEnd + 1);
        _reveal(a, bidA, "s");
        _reveal(b, bidB, "s");
        vm.roll(revealEnd + 1);
    }

    function test_Settle_RevertsBeforeExclusiveWindowElapses() public {
        (,, uint40 revealEnd) = _runToSettlement(300, 200);
        vm.roll(revealEnd + EXCLUSIVE_BLOCKS);
        vm.expectRevert(GlasshouseBook.WindowNotElapsed.selector);
        book.settle(MAKER, ORDER);
    }

    function test_Settle_WinnerFilled_NoForfeit_AndEveryoneReclaims() public {
        (address a, address b, uint40 revealEnd) = _runToSettlement(300, 200);

        vm.prank(ROUTER);
        book.postTransferIn(MAKER, a, address(0), address(0), 1, 1, 0, ORDER, "", "");

        vm.roll(revealEnd + EXCLUSIVE_BLOCKS + 1);
        book.settle(MAKER, ORDER);
        assertFalse(book.auctions(MAKER, ORDER).winnerForfeited, "winner filled, must not forfeit");

        uint256 beforeA = token.balanceOf(a);
        uint256 beforeB = token.balanceOf(b);
        vm.prank(a);
        book.claimBond(MAKER, ORDER);
        vm.prank(b);
        book.claimBond(MAKER, ORDER);
        assertEq(token.balanceOf(a) - beforeA, BOND, "winner bond");
        assertEq(token.balanceOf(b) - beforeB, BOND, "loser bond");
    }

    /// @dev A winner who bought exclusivity and then did not fill denied the maker a
    ///      fill it had earned. That is precisely what the bond is for.
    function test_Settle_WinnerNoShow_ForfeitsToMaker() public {
        (address a, address b, uint40 revealEnd) = _runToSettlement(300, 200);

        vm.roll(revealEnd + EXCLUSIVE_BLOCKS + 1);
        book.settle(MAKER, ORDER);
        assertTrue(book.auctions(MAKER, ORDER).winnerForfeited, "no-show must forfeit");

        vm.prank(a);
        vm.expectRevert(GlasshouseBook.NothingToClaim.selector);
        book.claimBond(MAKER, ORDER);

        uint256 beforeMaker = token.balanceOf(MAKER);
        vm.prank(MAKER);
        book.claimForfeit(ORDER);
        assertEq(token.balanceOf(MAKER) - beforeMaker, BOND, "forfeit to maker");

        // The honest loser is untouched by the winner's failure.
        uint256 beforeB = token.balanceOf(b);
        vm.prank(b);
        book.claimBond(MAKER, ORDER);
        assertEq(token.balanceOf(b) - beforeB, BOND, "loser still whole");
    }

    /// @dev An outsider filling during the window does not excuse the winner. The
    ///      instruction should have prevented it; if it somehow did not, the bond
    ///      still answers for the winner's no-show.
    function test_Settle_FilledBySomeoneElse_StillForfeits() public {
        (address a,, uint40 revealEnd) = _runToSettlement(300, 200);

        vm.prank(ROUTER);
        book.postTransferIn(MAKER, address(0xE15E), address(0), address(0), 1, 1, 0, ORDER, "", "");

        vm.roll(revealEnd + EXCLUSIVE_BLOCKS + 1);
        book.settle(MAKER, ORDER);
        assertTrue(book.auctions(MAKER, ORDER).winnerForfeited, "filled by non-winner");
        assertTrue(a != address(0xE15E), "sanity");
    }

    function test_Settle_RevertsOnSecondSettle() public {
        (,, uint40 revealEnd) = _runToSettlement(300, 200);
        vm.roll(revealEnd + EXCLUSIVE_BLOCKS + 1);
        book.settle(MAKER, ORDER);
        vm.expectRevert(GlasshouseBook.AlreadySettled.selector);
        book.settle(MAKER, ORDER);
    }

    function test_ClaimBond_RevertsBeforeSettlement() public {
        (address a,,) = _runToSettlement(300, 200);
        vm.prank(a);
        vm.expectRevert(GlasshouseBook.NotSettled.selector);
        book.claimBond(MAKER, ORDER);
    }

    function test_ClaimBond_RevertsOnDoubleClaim() public {
        (address a,, uint40 revealEnd) = _runToSettlement(300, 200);
        vm.prank(ROUTER);
        book.postTransferIn(MAKER, a, address(0), address(0), 1, 1, 0, ORDER, "", "");
        vm.roll(revealEnd + EXCLUSIVE_BLOCKS + 1);
        book.settle(MAKER, ORDER);

        vm.startPrank(a);
        book.claimBond(MAKER, ORDER);
        vm.expectRevert(GlasshouseBook.NothingToClaim.selector);
        book.claimBond(MAKER, ORDER);
        vm.stopPrank();
    }

    function test_ClaimForfeit_RevertsWhenWinnerDidFill() public {
        (address a,, uint40 revealEnd) = _runToSettlement(300, 200);
        vm.prank(ROUTER);
        book.postTransferIn(MAKER, a, address(0), address(0), 1, 1, 0, ORDER, "", "");
        vm.roll(revealEnd + EXCLUSIVE_BLOCKS + 1);
        book.settle(MAKER, ORDER);

        vm.prank(MAKER);
        vm.expectRevert(GlasshouseBook.NothingToClaim.selector);
        book.claimForfeit(ORDER);
    }

    /// @dev Bonds are pull-based, so total escrow must always cover what is claimable.
    function test_Escrow_IsFullyDrainedAfterAllClaims() public {
        (address a, address b, uint40 revealEnd) = _runToSettlement(300, 200);
        assertEq(token.balanceOf(address(book)), 2 * BOND, "two bonds escrowed");

        vm.roll(revealEnd + EXCLUSIVE_BLOCKS + 1);
        book.settle(MAKER, ORDER);

        vm.prank(MAKER);
        book.claimForfeit(ORDER); // winner a no-showed
        vm.prank(b);
        book.claimBond(MAKER, ORDER);

        assertEq(token.balanceOf(address(book)), 0, "escrow not fully drained");
        assertTrue(a != b, "sanity");
    }
}
