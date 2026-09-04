// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Test } from "forge-std/Test.sol";
import { console } from "forge-std/console.sol";

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

import { GlasshouseBook } from "../src/book/GlasshouseBook.sol";
import { Outcome, AuctionStatus } from "../src/interfaces/IGlasshouseBook.sol";

contract MatrixToken is ERC20 {
    constructor() ERC20("Bond", "BOND") { }
}

/// @title ReserveMatrixTest
/// @notice The reserve price is three different things depending on how many bidders
///         turn up, and the thin cases are the ones that decide whether the mechanism
///         behaves sensibly:
///
///           zero bidders  no winner, and the order must open immediately at base --
///                         a committed bidder who never reveals must not be able to
///                         lock the maker's order
///           one bidder    `secondBps` is 0, so the reserve IS the price. Vickrey with
///                         one bidder is otherwise undefined.
///           many bidders  competition sets the price and the reserve is only a floor
///
/// Rather than pick a reserve, this sweeps the range against two bidder ladders and
/// asserts every cell. It is both the parameter study and the coverage the suite was
/// missing for the degenerate cases.
contract ReserveMatrixTest is Test {
    GlasshouseBook internal book;
    MatrixToken internal token;

    address internal constant MAKER = address(0xAAAA);
    address internal constant ROUTER = address(0x120073);

    uint40 internal constant COMMIT_BLOCKS = 30;
    uint40 internal constant REVEAL_BLOCKS = 30;
    uint40 internal constant EXCLUSIVE_BLOCKS = 15;
    uint24 internal constant MAX_BPS = 500;

    function setUp() public {
        book = new GlasshouseBook();
        token = new MatrixToken();
        vm.roll(1000);
    }

    function _bidder(uint256 i) internal pure returns (address) {
        return address(uint160(0xB1D000 + i));
    }

    /// @dev Runs one complete auction. Bids below the reserve are asserted to be
    ///      unrevealable rather than silently skipped: that is the mechanism doing its
    ///      job, and it is what excludes a bidder when the reserve is raised.
    function _run(bytes32 orderHash, uint24 reserve, uint24[] memory bids)
        internal
        returns (Outcome memory o, uint40 revealEnd)
    {
        vm.prank(MAKER);
        book.open(orderHash, ROUTER, address(token), COMMIT_BLOCKS, REVEAL_BLOCKS, EXCLUSIVE_BLOCKS, reserve, MAX_BPS, 0);

        GlasshouseBook.Auction memory a = book.auctions(MAKER, orderHash);
        revealEnd = a.revealEnd;

        for (uint256 i; i < bids.length; i++) {
            vm.prank(_bidder(i));
            book.commit(MAKER, orderHash, keccak256(abi.encodePacked(_bidder(i), bids[i], bytes32("s"))));
        }

        vm.roll(a.commitEnd + 1);

        for (uint256 i; i < bids.length; i++) {
            if (bids[i] >= reserve) {
                vm.prank(_bidder(i));
                book.reveal(MAKER, orderHash, bids[i], bytes32("s"));
            } else {
                vm.prank(_bidder(i));
                vm.expectRevert(
                    abi.encodeWithSelector(GlasshouseBook.BidOutOfRange.selector, bids[i], reserve, MAX_BPS)
                );
                book.reveal(MAKER, orderHash, bids[i], bytes32("s"));
            }
        }

        vm.roll(revealEnd + 1);
        o = book.outcome(MAKER, orderHash);
    }

    function _ladder(uint24[5] memory src, uint256 n) internal pure returns (uint24[] memory out) {
        out = new uint24[](n);
        for (uint256 i; i < n; i++) out[i] = src[i];
    }

    function _competitive(uint256 n) internal pure returns (uint24[] memory) {
        return _ladder([uint24(400), 250, 100, 60, 30], n);
    }

    /// @dev One strong bidder and two weak ones. This is what a real small auction looks
    ///      like, and it is the case where the reserve actually earns its keep.
    function _thin(uint256 n) internal pure returns (uint24[] memory) {
        return _ladder([uint24(400), 30, 20, 0, 0], n);
    }

    function _case(string memory label, uint24 reserve, uint24[] memory bids) internal returns (Outcome memory o) {
        uint40 revealEnd;
        (o, revealEnd) = _run(keccak256(abi.encodePacked(label, reserve, bids.length)), reserve, bids);
        assertTrue(o.status == AuctionStatus.Closed, "auction must close");
        if (o.winner == address(0)) {
            // No winner: the order must be open to everyone immediately. A committed
            // bidder who never reveals must not be able to lock the maker's order.
            assertEq(o.exclusiveUntil, revealEnd, "no winner must not create a window");
            assertEq(o.clearingBps, 0, "no winner, no improvement");
        } else {
            assertEq(o.exclusiveUntil, revealEnd + EXCLUSIVE_BLOCKS, "window length");
        }
    }

    // --- zero bidders ----------------------------------------------------------

    /// @dev The reserve cannot conjure a winner out of an empty auction.
    function test_ZeroBidders_NoWinnerAtAnyReserve() public {
        uint24[5] memory reserves = [uint24(0), 10, 50, 200, 450];
        for (uint256 i; i < reserves.length; i++) {
            Outcome memory o = _case("zero", reserves[i], new uint24[](0));
            assertEq(o.winner, address(0), "empty auction has no winner");
        }
    }

    // --- one bidder: the reserve IS the price ----------------------------------

    function test_OneBidder_PaysExactlyTheReserve() public {
        uint24[4] memory reserves = [uint24(0), 10, 50, 200];
        for (uint256 i; i < reserves.length; i++) {
            Outcome memory o = _case("one", reserves[i], _competitive(1));
            assertEq(o.winner, _bidder(0), "sole bidder wins");
            assertEq(o.clearingBps, reserves[i], "sole bidder pays exactly the reserve");
        }
    }

    /// @dev At `reserve = 0` a lone bidder pays nothing, and the maker gains nothing from
    ///      having run the auction at all. This is the argument against a zero reserve,
    ///      and it is the number that would appear on screen if only one person bids on
    ///      demo day.
    function test_OneBidder_ZeroReserveReturnsNothingToTheMaker() public {
        Outcome memory o = _case("zero-reserve", 0, _competitive(1));
        assertEq(o.winner, _bidder(0), "sole bidder wins");
        assertEq(o.clearingBps, 0, "and pays nothing");
    }

    // --- the reserve above every bid -------------------------------------------

    /// @dev The failure mode of a reserve set too high: every bid is unrevealable, there
    ///      is no winner, and the auction has done nothing except freeze the order for
    ///      the full commit and reveal windows.
    function test_ReserveAboveEveryBid_AuctionAccomplishesNothing() public {
        Outcome memory o = _case("too-high", 450, _competitive(5));
        assertEq(o.winner, address(0), "no bid clears the reserve");
        assertEq(o.clearingBps, 0, "no improvement");
    }

    // --- competition present: the reserve is only a floor ----------------------

    function test_Competitive_SecondPriceDominatesTheReserve() public {
        uint24[4] memory reserves = [uint24(0), 10, 50, 200];
        for (uint256 i; i < reserves.length; i++) {
            Outcome memory o = _case("competitive", reserves[i], _competitive(5));
            assertEq(o.winner, _bidder(0), "highest bid wins");
            assertEq(o.clearingBps, 250, "second price, not the reserve");
        }
    }

    /// @dev Raising the reserve excludes bidders. At 50 the 30 bps bid can no longer
    ///      reveal, and at 200 three of the five are shut out. With this ladder the
    ///      clearing price is unaffected, because the excluded bids were never going to
    ///      set it -- which is the case FOR a reserve at this level.
    function test_Competitive_RaisingTheReserveExcludesWithoutChangingThePrice() public {
        Outcome memory low = _case("excl", 10, _competitive(5));
        Outcome memory high = _case("excl", 200, _competitive(5));
        assertEq(low.clearingBps, high.clearingBps, "price unchanged");
        assertEq(low.winner, high.winner, "winner unchanged");
    }

    // --- thin competition: where the reserve earns its keep --------------------

    /// @dev THE CASE THAT DECIDES THE PARAMETER. One strong bidder, two weak ones - what
    ///      a real small auction looks like. Without a reserve the maker captures 30 bps
    ///      because the runner-up is weak. Raising the reserve to 50 excludes both weak
    ///      bidders and the maker captures 50 instead. At 200 the maker captures 200 from
    ///      a bidder who was willing to pay 400.
    function test_Thin_TheReserveIsWhatProtectsTheMaker() public {
        Outcome memory r0 = _case("thin", 0, _thin(3));
        Outcome memory r10 = _case("thin", 10, _thin(3));
        Outcome memory r50 = _case("thin", 50, _thin(3));
        Outcome memory r200 = _case("thin", 200, _thin(3));

        assertEq(r0.clearingBps, 30, "no reserve: the weak runner-up sets the price");
        assertEq(r10.clearingBps, 30, "reserve below the runner-up does not bind");
        assertEq(r50.clearingBps, 50, "reserve binds once it exceeds the runner-up");
        assertEq(r200.clearingBps, 200, "and keeps binding");

        assertEq(r0.winner, _bidder(0), "same winner throughout");
        assertEq(r200.winner, _bidder(0), "same winner throughout");

        console.log("");
        console.log("   RESERVE SWEEP, thin competition (bids 400 / 30 / 20 bps)");
        console.log("   ------------------------------------------------------");
        console.log("   reserve    0  ->  maker captures", r0.clearingBps);
        console.log("   reserve   10  ->  maker captures", r10.clearingBps);
        console.log("   reserve   50  ->  maker captures", r50.clearingBps);
        console.log("   reserve  200  ->  maker captures", r200.clearingBps);
        console.log("   ------------------------------------------------------");
        console.log("   With thin competition the reserve, not the auction, is what");
        console.log("   protects the maker. With five real bidders it never binds.");
        console.log("");
    }

    /// @dev The whole matrix in one place, so a change to the clearing rule has to break
    ///      something visible.
    function testFuzz_ClearingIsAlwaysMaxOfReserveAndSecondBid(uint8 rawReserve, uint8 rawCount) public {
        uint24 reserve = uint24(uint256(rawReserve) % 300);
        uint256 n = uint256(rawCount) % 6; // 0..5

        uint24[] memory bids = _competitive(n);
        Outcome memory o = _case("fuzz", reserve, bids);

        uint24 revealedBest = 0;
        uint24 revealedSecond = 0;
        for (uint256 i; i < n; i++) {
            if (bids[i] < reserve) continue;
            if (bids[i] > revealedBest) {
                revealedSecond = revealedBest;
                revealedBest = bids[i];
            } else if (bids[i] > revealedSecond) {
                revealedSecond = bids[i];
            }
        }

        if (revealedBest == 0 && n > 0 && reserve > 400) {
            assertEq(o.winner, address(0), "everything excluded");
            return;
        }
        if (n == 0) {
            assertEq(o.winner, address(0), "no bidders");
            return;
        }

        uint24 expected = revealedSecond > reserve ? revealedSecond : reserve;
        assertEq(o.clearingBps, expected, "clearing must be max(reserve, second revealed bid)");
    }
}
