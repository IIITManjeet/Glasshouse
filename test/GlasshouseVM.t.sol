// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Test } from "forge-std/Test.sol";

import { TokenMock } from "@1inch/solidity-utils/contracts/mocks/TokenMock.sol";

import { ISwapVM } from "@1inch/swap-vm/src/interfaces/ISwapVM.sol";
import { MakerTraitsLib } from "@1inch/swap-vm/src/libs/MakerTraits.sol";
import { TakerTraitsLib } from "@1inch/swap-vm/src/libs/TakerTraits.sol";
import { StaticBalances } from "@1inch/swap-vm/src/instructions/Balances.sol";
import { LimitSwap } from "@1inch/swap-vm/src/instructions/LimitSwap.sol";

import { GlasshouseAuction } from "../src/instructions/GlasshouseAuction.sol";
import { GlasshouseAuctionLib } from "../src/lib/GlasshouseAuctionLib.sol";
import { GlasshouseBook } from "../src/book/GlasshouseBook.sol";
import { GlasshouseTestRouter } from "./helpers/GlasshouseTestRouter.sol";

/// @title GlasshouseVMTest
/// @notice First execution of the auction gate inside a real SwapVM program.
///
/// Program under test, which is the ordering the mechanism requires:
///     StaticBalances -> GlasshouseAuction -> LimitSwap
/// The gate has to run after balances exist and before the swap curve prices them.
contract GlasshouseVMTest is Test {
    GlasshouseTestRouter internal router;
    GlasshouseBook internal book;
    TokenMock internal tokenA;
    TokenMock internal tokenB;

    uint256 internal constant MAKER_PK = 0x1234;
    address internal maker;
    address internal winner;
    address internal outsider;

    uint256 internal constant BALANCE_A = 1000e18;
    uint256 internal constant BALANCE_B = 2000e18;
    uint256 internal constant SWAP_AMOUNT = 1e18;

    uint40 internal constant COMMIT_BLOCKS = 5;
    uint40 internal constant REVEAL_BLOCKS = 5;
    uint40 internal constant EXCLUSIVE_BLOCKS = 10;
    uint24 internal constant RESERVE_BPS = 10;
    uint24 internal constant BOOK_MAX_BPS = 500;
    uint24 internal constant PROGRAM_MAX_BPS = 500;

    function setUp() public {
        maker = vm.addr(MAKER_PK);
        winner = vm.addr(0xB1DDE2);
        outsider = vm.addr(0x0475);

        book = new GlasshouseBook();
        router = new GlasshouseTestRouter(address(0), address(0), address(this), "SwapVM", "1.0.0");

        tokenA = new TokenMock("Token I", "TKI");
        tokenB = new TokenMock("Token J", "TKJ");
        if (tokenA > tokenB) (tokenA, tokenB) = (tokenB, tokenA);

        tokenA.mint(maker, 1e30);
        tokenB.mint(winner, 1e30);
        tokenB.mint(outsider, 1e30);

        vm.prank(maker);
        tokenA.approve(address(router), type(uint256).max);
        vm.prank(winner);
        tokenB.approve(address(router), type(uint256).max);
        vm.prank(outsider);
        tokenB.approve(address(router), type(uint256).max);

        vm.roll(1000);
    }

    // --- program / order -------------------------------------------------------

    function _program(uint24 maxImprovementBps) internal view returns (bytes memory) {
        return bytes.concat(
            StaticBalances.build(BALANCE_A, BALANCE_B),
            GlasshouseAuction.build(address(book), maxImprovementBps),
            LimitSwap.build(address(tokenB), address(tokenA))
        );
    }

    function _order(uint24 maxImprovementBps, bool withFillHook) internal view returns (ISwapVM.Order memory) {
        return MakerTraitsLib.build(
            MakerTraitsLib.Args({
                maker: maker,
                tokenA: address(tokenA),
                tokenB: address(tokenB),
                shouldUnwrapWeth: false,
                useAquaInsteadOfSignature: false,
                allowZeroAmountIn: false,
                receiver: address(0),
                hasPreTransferInHook: false,
                hasPostTransferInHook: withFillHook,
                hasPreTransferOutHook: false,
                hasPostTransferOutHook: false,
                preTransferInTarget: address(0),
                preTransferInData: "",
                postTransferInTarget: withFillHook ? address(book) : address(0),
                postTransferInData: "",
                preTransferOutTarget: address(0),
                preTransferOutData: "",
                postTransferOutTarget: address(0),
                postTransferOutData: "",
                program: _program(maxImprovementBps)
            })
        );
    }

    function _takerData(ISwapVM.Order memory order, address to) internal view returns (bytes memory) {
        bytes32 orderHash = router.hash(order);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(MAKER_PK, orderHash);
        return TakerTraitsLib.build(
            TakerTraitsLib.Args({
                taker: address(0),
                isExactIn: true,
                shouldUnwrapWeth: false,
                isStrictThresholdAmount: false,
                isFirstTransferFromTaker: false,
                useTransferFromAndAquaPush: false,
                isAToB: false,
                allowPartialFill: false,
                threshold: "",
                to: to,
                deadline: 0,
                hasPreTransferInCallback: false,
                hasPreTransferOutCallback: false,
                preTransferInHookData: "",
                postTransferInHookData: "",
                preTransferOutHookData: "",
                postTransferOutHookData: "",
                preTransferInCallbackData: "",
                preTransferOutCallbackData: "",
                instructionsArgs: "",
                signature: abi.encodePacked(r, s, v)
            })
        );
    }

    // --- auction driving -------------------------------------------------------

    function _openAuction(bytes32 orderHash) internal returns (uint40 commitEnd, uint40 revealEnd) {
        vm.prank(maker);
        book.open(
            orderHash,
            address(router),
            address(tokenB),
            COMMIT_BLOCKS,
            REVEAL_BLOCKS,
            EXCLUSIVE_BLOCKS,
            RESERVE_BPS,
            BOOK_MAX_BPS,
            0 // no bond: bond economics are covered in GlasshouseBook.t.sol
        );
        GlasshouseBook.Auction memory a = book.auctions(maker, orderHash);
        return (a.commitEnd, a.revealEnd);
    }

    function _bid(bytes32 orderHash, address who, uint24 bps) internal {
        vm.prank(who);
        book.commit(maker, orderHash, keccak256(abi.encodePacked(who, bps, bytes32("s"))));
    }

    function _revealBid(bytes32 orderHash, address who, uint24 bps) internal {
        vm.prank(who);
        book.reveal(maker, orderHash, bps, bytes32("s"));
    }

    /// @dev Runs a complete auction and leaves the chain at the first fill block.
    function _settleAuctionWith(bytes32 orderHash, uint24 winnerBid, uint24 runnerUpBid) internal returns (uint40 revealEnd) {
        uint40 commitEnd;
        (commitEnd, revealEnd) = _openAuction(orderHash);
        _bid(orderHash, winner, winnerBid);
        _bid(orderHash, outsider, runnerUpBid);
        vm.roll(commitEnd + 1);
        _revealBid(orderHash, winner, winnerBid);
        _revealBid(orderHash, outsider, runnerUpBid);
        vm.roll(revealEnd + 1);
    }

    function _basePriceOut() internal pure returns (uint256) {
        return SWAP_AMOUNT * BALANCE_A / BALANCE_B;
    }

    function _improvedOut(uint24 bps) internal pure returns (uint256) {
        // Mirrors GlasshouseAuctionLib: balanceIn scaled up by (1 + bps), rounded so
        // that rounding favours the maker, then priced by LimitSwap.
        uint256 balanceIn = (BALANCE_B * (10_000 + uint256(bps)) + 9_999) / 10_000;
        return SWAP_AMOUNT * BALANCE_A / balanceIn;
    }

    // --- tests -----------------------------------------------------------------

    /// @dev Liveness. A maker may ship a strategy and never open an auction; the order
    ///      must still be fillable, as an ordinary limit order.
    function test_NoAuction_BehavesAsAPlainLimitOrder() public {
        ISwapVM.Order memory order = _order(PROGRAM_MAX_BPS, false);
        bytes memory takerData = _takerData(order, outsider);

        vm.prank(outsider);
        (, uint256 out,) = router.quote(order, SWAP_AMOUNT, takerData);
        assertEq(out, _basePriceOut(), "no auction should price at base");
    }

    /// @dev While bids can still arrive there is no winner, so nobody may fill. Without
    ///      this, an outsider fills at the base price before the auction resolves and
    ///      the winner's bid buys nothing.
    function test_Bidding_BlocksEveryFill() public {
        ISwapVM.Order memory order = _order(PROGRAM_MAX_BPS, false);
        bytes memory takerData = _takerData(order, winner);
        bytes32 orderHash = router.hash(order);

        (uint40 commitEnd, uint40 revealEnd) = _openAuction(orderHash);
        _bid(orderHash, winner, 300);

        vm.prank(winner);
        vm.expectRevert(GlasshouseAuctionLib.GlasshouseAuctionInProgress.selector);
        router.quote(order, SWAP_AMOUNT, takerData);

        vm.roll(commitEnd + 1);
        _revealBid(orderHash, winner, 300);

        // Still inside the reveal window: the top-2 is not frozen yet.
        vm.prank(winner);
        vm.expectRevert(GlasshouseAuctionLib.GlasshouseAuctionInProgress.selector);
        router.quote(order, SWAP_AMOUNT, takerData);

        vm.roll(revealEnd + 1);
        vm.prank(winner);
        router.quote(order, SWAP_AMOUNT, takerData); // now it resolves
    }

    /// @dev THE HEADLINE. The winner is priced by what the *second* bidder was willing
    ///      to pay, and the improvement lands with the maker as a worse taker price.
    function test_Winner_PaysSecondPrice_InsideTheWindow() public {
        ISwapVM.Order memory order = _order(PROGRAM_MAX_BPS, false);
        bytes memory takerData = _takerData(order, winner);
        bytes32 orderHash = router.hash(order);

        _settleAuctionWith(orderHash, 400, 250);

        vm.prank(winner);
        (, uint256 out,) = router.quote(order, SWAP_AMOUNT, takerData);

        assertEq(out, _improvedOut(250), "winner must pay the second bid, not its own");
        assertLt(out, _basePriceOut(), "improvement must move price toward the maker");
    }

    function test_Outsider_IsExcludedInsideTheWindow() public {
        ISwapVM.Order memory order = _order(PROGRAM_MAX_BPS, false);
        bytes32 orderHash = router.hash(order);
        _settleAuctionWith(orderHash, 400, 250);

        bytes memory takerData = _takerData(order, outsider);
        vm.prank(outsider);
        vm.expectRevert(
            abi.encodeWithSelector(
                GlasshouseAuctionLib.GlasshouseExclusiveWindow.selector, winner, book.outcome(maker, orderHash).exclusiveUntil
            )
        );
        router.quote(order, SWAP_AMOUNT, takerData);
    }

    /// @dev Exclusivity is bounded and earned. This is the deliberate inverse of
    ///      `WhitelistSequential`, where the privilege is hardcoded and the outsider is
    ///      excluded until the whole ladder has elapsed.
    function test_AfterTheWindow_OrderIsOpenToEveryoneAtBasePrice() public {
        ISwapVM.Order memory order = _order(PROGRAM_MAX_BPS, false);
        bytes32 orderHash = router.hash(order);
        uint40 revealEnd = _settleAuctionWith(orderHash, 400, 250);

        vm.roll(revealEnd + EXCLUSIVE_BLOCKS + 1);

        bytes memory outsiderData = _takerData(order, outsider);
        vm.prank(outsider);
        (, uint256 outO,) = router.quote(order, SWAP_AMOUNT, outsiderData);
        assertEq(outO, _basePriceOut(), "outsider at base price");

        bytes memory winnerData = _takerData(order, winner);
        vm.prank(winner);
        (, uint256 outW,) = router.quote(order, SWAP_AMOUNT, winnerData);
        assertEq(outW, _basePriceOut(), "winner loses the improvement obligation too");
    }

    /// @dev The maker signs a cap on price movement. Whatever the Book claims, the price
    ///      cannot move further than the maker authorised -- the Book is untrusted from
    ///      the program's point of view.
    function test_ImprovementCapIsEnforcedAgainstTheBook() public {
        uint24 cap = 100;
        ISwapVM.Order memory order = _order(cap, false);
        bytes memory takerData = _takerData(order, winner);
        bytes32 orderHash = router.hash(order);

        _settleAuctionWith(orderHash, 400, 250); // clearing 250 > cap 100

        vm.prank(winner);
        vm.expectRevert(
            abi.encodeWithSelector(GlasshouseAuctionLib.GlasshouseImprovementExceedsCap.selector, uint256(250), uint256(cap))
        );
        router.quote(order, SWAP_AMOUNT, takerData);
    }

    /// @dev THE INVARIANT THE WHOLE DESIGN RESTS ON.
    ///
    /// `quote()` runs the program with `isStaticContext = true`, `swap()` with `false`,
    /// and both execute the same bytes. If the gate wrote state, the two would diverge
    /// and every downstream invariant would go with them. It is `view`, so they cannot.
    function test_QuoteEqualsSwap() public {
        ISwapVM.Order memory order = _order(PROGRAM_MAX_BPS, false);
        bytes memory takerData = _takerData(order, winner);
        bytes32 orderHash = router.hash(order);

        _settleAuctionWith(orderHash, 400, 250);

        vm.prank(winner);
        (uint256 quotedIn, uint256 quotedOut,) = router.quote(order, SWAP_AMOUNT, takerData);

        uint256 beforeA = tokenA.balanceOf(winner);
        uint256 beforeB = tokenB.balanceOf(winner);

        vm.prank(winner);
        (uint256 swappedIn, uint256 swappedOut,) = router.swap(order, SWAP_AMOUNT, takerData);

        assertEq(swappedIn, quotedIn, "amountIn diverged between quote and swap");
        assertEq(swappedOut, quotedOut, "amountOut diverged between quote and swap");

        // And the quote was not merely self-consistent -- it is what actually moved.
        assertEq(tokenA.balanceOf(winner) - beforeA, quotedOut, "tokenOut received");
        assertEq(beforeB - tokenB.balanceOf(winner), quotedIn, "tokenIn paid");
    }

    /// @dev A second execution of the same order must quote the same way. The gate reads
    ///      frozen storage only, so nothing about it drifts once the auction has closed.
    function test_QuoteIsStableAcrossBlocksInsideTheWindow() public {
        ISwapVM.Order memory order = _order(PROGRAM_MAX_BPS, false);
        bytes memory takerData = _takerData(order, winner);
        bytes32 orderHash = router.hash(order);

        uint40 revealEnd = _settleAuctionWith(orderHash, 400, 250);

        vm.prank(winner);
        (, uint256 first,) = router.quote(order, SWAP_AMOUNT, takerData);

        vm.roll(revealEnd + EXCLUSIVE_BLOCKS); // last block of the window
        vm.prank(winner);
        (, uint256 last,) = router.quote(order, SWAP_AMOUNT, takerData);

        assertEq(first, last, "price drifted inside the exclusive window");
    }

    /// @dev The instruction cannot emit -- LOG reverts under STATICCALL -- so the fill is
    ///      recorded through the maker hook, which `swap()` calls and `quote()` does not.
    ///      Hooks live outside the program, so this cannot affect quote/swap consistency.
    function test_Swap_RecordsTheFillThroughTheMakerHook() public {
        ISwapVM.Order memory order = _order(PROGRAM_MAX_BPS, true);
        bytes memory takerData = _takerData(order, winner);
        bytes32 orderHash = router.hash(order);

        _settleAuctionWith(orderHash, 400, 250);

        assertEq(book.auctions(maker, orderHash).filledBy, address(0), "nothing filled yet");

        vm.prank(winner);
        router.quote(order, SWAP_AMOUNT, takerData);
        assertEq(book.auctions(maker, orderHash).filledBy, address(0), "quote must not record a fill");

        vm.prank(winner);
        router.swap(order, SWAP_AMOUNT, takerData);
        assertEq(book.auctions(maker, orderHash).filledBy, winner, "swap must record the filler");
    }
}
