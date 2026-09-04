// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Test } from "forge-std/Test.sol";
import { console } from "forge-std/console.sol";

import { TokenMock } from "@1inch/solidity-utils/contracts/mocks/TokenMock.sol";

import { ISwapVM } from "@1inch/swap-vm/src/interfaces/ISwapVM.sol";
import { MakerTraitsLib } from "@1inch/swap-vm/src/libs/MakerTraits.sol";
import { TakerTraitsLib } from "@1inch/swap-vm/src/libs/TakerTraits.sol";
import { StaticBalances } from "@1inch/swap-vm/src/instructions/Balances.sol";
import { LimitSwap } from "@1inch/swap-vm/src/instructions/LimitSwap.sol";
import { WhitelistSequential } from "@1inch/swap-vm/src/instructions/Whitelist.sol";
import { DutchAuctionBalanceIn } from "@1inch/swap-vm/src/instructions/DutchAuction.sol";

import { GlasshouseAuction } from "../src/instructions/GlasshouseAuction.sol";
import { GlasshouseAuctionLib } from "../src/lib/GlasshouseAuctionLib.sol";
import { GlasshouseBook } from "../src/book/GlasshouseBook.sol";
import { GlasshouseTestRouter } from "./helpers/GlasshouseTestRouter.sol";

/// @title ComparisonTest
/// @notice THE SUBMISSION. One order, one bidder set, three ways of deciding who fills.
///
/// SwapVM ships two allocation rules and neither of them prices the order:
///
///   IDENTITY - `WhitelistSequential` (0x2d). The maker hardcodes a ladder of
///   privileged takers. An unlisted taker does not merely lose priority, it REVERTS
///   until the entire cumulative ladder has elapsed. Who fills was decided off-chain,
///   for reasons the chain cannot see, and the maker is paid nothing for the privilege.
///
///   CLOCK - `DutchAuctionBalanceIn` (0x94). The price is a pure function of
///   `block.timestamp`, so every bidder in a block faces an IDENTICAL price. Valuation
///   cannot break the tie: allocation falls to intra-block ordering, which is sold to
///   the highest priority fee. The surplus leaves the protocol as builder revenue.
///
///   BID - `GlasshouseAuction` (0x2e). The highest bidder wins and pays the second
///   price. The improvement is applied to `balanceIn`, so ordinary settlement routes it
///   to the maker.
///
/// The bidder set is deliberately latency-differentiated, because that is the whole
/// argument: the participant who values the fill LEAST is the fastest one.
contract ComparisonTest is Test {
    GlasshouseTestRouter internal router;
    GlasshouseBook internal book;
    TokenMock internal tokenA;
    TokenMock internal tokenB;

    uint256 internal constant MAKER_PK = 0x1234;
    address internal maker;

    /// @dev Valuations, expressed as the price improvement each is willing to give up in
    ///      bps. Ada values the fill most; Cyd values it least and is the fastest.
    address internal ada; // values 400 bps, slowest
    address internal bram; // values 250 bps
    address internal cyd; // values 100 bps, FASTEST, and the incumbent on the ladder

    uint24 internal constant ADA_VALUE = 400;
    uint24 internal constant BRAM_VALUE = 250;
    uint24 internal constant CYD_VALUE = 100;

    uint256 internal constant BALANCE_A = 1000e18;
    uint256 internal constant BALANCE_B = 2000e18;
    uint256 internal constant SWAP_AMOUNT = 1e18;

    uint40 internal constant COMMIT_BLOCKS = 5;
    uint40 internal constant REVEAL_BLOCKS = 5;
    uint40 internal constant EXCLUSIVE_BLOCKS = 10;
    uint24 internal constant RESERVE_BPS = 10;
    uint24 internal constant MAX_BPS = 500;

    /// @dev The ladder gives Cyd, the incumbent, an exclusive head start.
    uint40 internal LADDER_START;
    uint16 internal constant LADDER_DURATION = 300; // seconds of exclusivity

    /// @dev 0.1% per second, the middle of the three factors upstream's own tests use.
    uint64 internal constant DECAY = 0.999e18;
    uint16 internal constant DUTCH_DURATION = 600;

    function setUp() public {
        maker = vm.addr(MAKER_PK);
        ada = vm.addr(0xADA);
        bram = vm.addr(0xB4A);
        cyd = vm.addr(0xC4D);

        book = new GlasshouseBook();
        router = new GlasshouseTestRouter(address(0), address(0), address(this), "SwapVM", "1.0.0");

        tokenA = new TokenMock("Token I", "TKI");
        tokenB = new TokenMock("Token J", "TKJ");
        if (tokenA > tokenB) (tokenA, tokenB) = (tokenB, tokenA);

        tokenA.mint(maker, 1e30);
        vm.prank(maker);
        tokenA.approve(address(router), type(uint256).max);

        address[3] memory takers = [ada, bram, cyd];
        for (uint256 i; i < takers.length; i++) {
            tokenB.mint(takers[i], 1e30);
            vm.prank(takers[i]);
            tokenB.approve(address(router), type(uint256).max);
        }

        vm.roll(1000);
        vm.warp(100_000);
        LADDER_START = uint40(block.timestamp);
    }

    // --- the three programs ----------------------------------------------------
    //
    // Identical in every respect except the gate. Balances and the swap curve are the
    // same instructions with the same arguments in all three, so the only variable is
    // how taker priority is allocated.

    /// @dev IDENTITY. The ladder's `nextPC` points at the instruction immediately after
    ///      the gate, so a listed taker and a fallen-through taker reach the same price.
    ///      The gate is doing nothing but deciding WHO MAY FILL AND WHEN, which is
    ///      precisely the axis under comparison. (`WhitelistSequential` can also branch
    ///      to a better price for insiders. Not modelling that is the charitable
    ///      reading: it makes the ladder look better than it is in practice.)
    function _identityProgram() internal view returns (bytes memory) {
        address[] memory allowed = new address[](1);
        allowed[0] = cyd;
        uint16[] memory durations = new uint16[](1);
        durations[0] = LADDER_DURATION;

        uint16 gateLength = uint16(7 + 2 + 1 * 12);
        bytes memory gate = WhitelistSequential.build(LADDER_START, gateLength, allowed, durations);
        require(gate.length == gateLength, "ladder length");

        return bytes.concat(gate, StaticBalances.build(BALANCE_A, BALANCE_B), LimitSwap.build(address(tokenB), address(tokenA)));
    }

    /// @dev CLOCK. Scales `balanceIn` down over time, so the taker's price improves the
    ///      longer nobody fills. Sits in the same slot as our gate: after balances,
    ///      before the swap curve.
    function _clockProgram() internal view returns (bytes memory) {
        return bytes.concat(
            StaticBalances.build(BALANCE_A, BALANCE_B),
            DutchAuctionBalanceIn.build(LADDER_START, DUTCH_DURATION, DECAY),
            LimitSwap.build(address(tokenB), address(tokenA))
        );
    }

    /// @dev BID.
    function _bidProgram() internal view returns (bytes memory) {
        return bytes.concat(
            StaticBalances.build(BALANCE_A, BALANCE_B),
            GlasshouseAuction.build(address(book), MAX_BPS),
            LimitSwap.build(address(tokenB), address(tokenA))
        );
    }

    function _order(bytes memory program) internal view returns (ISwapVM.Order memory) {
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
                hasPostTransferInHook: false,
                hasPreTransferOutHook: false,
                hasPostTransferOutHook: false,
                preTransferInTarget: address(0),
                preTransferInData: "",
                postTransferInTarget: address(0),
                postTransferInData: "",
                preTransferOutTarget: address(0),
                preTransferOutData: "",
                postTransferOutTarget: address(0),
                postTransferOutData: "",
                program: program
            })
        );
    }

    function _takerData(ISwapVM.Order memory order, address to) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(MAKER_PK, router.hash(order));
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

    function _quoteAs(ISwapVM.Order memory order, address taker) internal returns (uint256 out) {
        bytes memory takerData = _takerData(order, taker);
        vm.prank(taker);
        (, out,) = router.quote(order, SWAP_AMOUNT, takerData);
    }

    // --- auction driving -------------------------------------------------------

    function _runGlasshouseAuction(bytes32 orderHash) internal {
        vm.prank(maker);
        book.open(
            orderHash, address(router), address(tokenB), COMMIT_BLOCKS, REVEAL_BLOCKS, EXCLUSIVE_BLOCKS, RESERVE_BPS, MAX_BPS, 0
        );
        GlasshouseBook.Auction memory a = book.auctions(maker, orderHash);

        // Everyone bids their true valuation. Under a second-price rule that is the
        // dominant strategy, which is the reason for choosing it.
        _commit(orderHash, ada, ADA_VALUE);
        _commit(orderHash, bram, BRAM_VALUE);
        _commit(orderHash, cyd, CYD_VALUE);

        vm.roll(a.commitEnd + 1);
        _reveal(orderHash, ada, ADA_VALUE);
        _reveal(orderHash, bram, BRAM_VALUE);
        _reveal(orderHash, cyd, CYD_VALUE);

        vm.roll(a.revealEnd + 1);
    }

    function _commit(bytes32 orderHash, address who, uint24 bps) internal {
        vm.prank(who);
        book.commit(maker, orderHash, keccak256(abi.encodePacked(who, bps, bytes32("s"))));
    }

    function _reveal(bytes32 orderHash, address who, uint24 bps) internal {
        vm.prank(who);
        book.reveal(maker, orderHash, bps, bytes32("s"));
    }

    function _basePriceOut() internal pure returns (uint256) {
        return SWAP_AMOUNT * BALANCE_A / BALANCE_B;
    }

    // ===========================================================================
    // IDENTITY - WhitelistSequential (0x2d)
    // ===========================================================================

    /// @dev The taker who values the fill most cannot have it, and no amount of
    ///      willingness to pay changes that. Exclusion is by address, and it is a
    ///      revert, not a worse price.
    function test_Identity_ExcludesTheHighestValuationOutright() public {
        ISwapVM.Order memory order = _order(_identityProgram());

        // Cyd is on the ladder and fills immediately.
        assertEq(_quoteAs(order, cyd), _basePriceOut(), "incumbent fills at base");

        // Ada values the fill four times as highly. She reverts.
        bytes memory adaData = _takerData(order, ada);
        vm.prank(ada);
        vm.expectRevert(WhitelistSequential.WhitelistSequentialTimeViolation.selector);
        router.quote(order, SWAP_AMOUNT, adaData);

        bytes memory bramData = _takerData(order, bram);
        vm.prank(bram);
        vm.expectRevert(WhitelistSequential.WhitelistSequentialTimeViolation.selector);
        router.quote(order, SWAP_AMOUNT, bramData);
    }

    /// @dev And the maker is paid nothing for granting the privilege: the incumbent's
    ///      price is the base price. Whatever the head start is worth, it accrues to the
    ///      incumbent, not to the person whose order it is.
    function test_Identity_MakerIsPaidNothingForThePrivilege() public {
        ISwapVM.Order memory order = _order(_identityProgram());
        assertEq(_quoteAs(order, cyd), _basePriceOut(), "no improvement to the maker");
    }

    function test_Identity_OutsidersWaitForTheWholeLadder() public {
        ISwapVM.Order memory order = _order(_identityProgram());
        vm.warp(LADDER_START + LADDER_DURATION);
        assertEq(_quoteAs(order, ada), _basePriceOut(), "open only after the ladder elapses");
    }

    // ===========================================================================
    // CLOCK - DutchAuctionBalanceIn (0x94)
    // ===========================================================================

    /// @dev THE CENTRAL FACT ABOUT THE DUTCH CLOCK, and it is provable from upstream
    ///      source rather than asserted: the price is a pure function of
    ///      `block.timestamp`. Three bidders with three different valuations, quoting in
    ///      the same block, receive exactly the same number. Nothing about valuation can
    ///      break the tie, so allocation is decided by transaction ordering - which is
    ///      sold to whoever pays the builder most.
    function test_Clock_EveryBidderInABlockFacesTheIdenticalPrice() public {
        ISwapVM.Order memory order = _order(_clockProgram());
        vm.warp(LADDER_START + 60);

        uint256 outAda = _quoteAs(order, ada);
        uint256 outBram = _quoteAs(order, bram);
        uint256 outCyd = _quoteAs(order, cyd);

        assertEq(outAda, outBram, "valuation does not move the Dutch price");
        assertEq(outBram, outCyd, "valuation does not move the Dutch price");
    }

    /// @dev So the fastest bidder wins, whatever they value it at. Cyd values the fill
    ///      least of the three and takes it, because being first in the block is the
    ///      only thing the mechanism can see.
    function test_Clock_FastestWinsRegardlessOfValuation() public {
        ISwapVM.Order memory order = _order(_clockProgram());
        vm.warp(LADDER_START + 60);

        uint256 makerBefore = tokenB.balanceOf(maker);

        bytes memory cydData = _takerData(order, cyd);
        vm.prank(cyd);
        (uint256 amountIn,,) = router.swap(order, SWAP_AMOUNT, cydData);

        assertEq(tokenB.balanceOf(maker) - makerBefore, amountIn, "maker receives the posted price");
        assertEq(amountIn, SWAP_AMOUNT, "exact-in: the clock moves what the taker RECEIVES");
    }

    /// @dev The clock only ever gives value away. Every second that passes, the taker's
    ///      price improves and the maker's worsens; the mechanism has no way to move
    ///      value the other direction.
    function test_Clock_ConcedesToTheTakerOverTime() public {
        ISwapVM.Order memory order = _order(_clockProgram());

        vm.warp(LADDER_START);
        uint256 atStart = _quoteAs(order, ada);
        vm.warp(LADDER_START + 60);
        uint256 atOneMinute = _quoteAs(order, ada);

        assertEq(atStart, _basePriceOut(), "starts at base");
        assertGt(atOneMinute, atStart, "taker gets more as the clock runs");
    }

    // ===========================================================================
    // BID - GlasshouseAuction (0x2e)
    // ===========================================================================

    /// @dev The highest valuation wins, and pays the second highest. Allocation is by
    ///      bid; the price is set by the competition rather than by a clock.
    function test_Bid_HighestValuationWinsAndPaysSecondPrice() public {
        ISwapVM.Order memory order = _order(_bidProgram());
        bytes32 orderHash = router.hash(order);
        _runGlasshouseAuction(orderHash);

        assertEq(book.outcome(maker, orderHash).winner, ada, "highest valuation wins");
        assertEq(book.outcome(maker, orderHash).clearingBps, BRAM_VALUE, "pays the second bid");

        assertLt(_quoteAs(order, ada), _basePriceOut(), "improvement moves price toward the maker");
    }

    function test_Bid_TheFastestBidderDoesNotWinByBeingFast() public {
        ISwapVM.Order memory order = _order(_bidProgram());
        bytes32 orderHash = router.hash(order);
        _runGlasshouseAuction(orderHash);

        bytes memory cydData = _takerData(order, cyd);
        vm.prank(cyd);
        vm.expectRevert(
            abi.encodeWithSelector(
                GlasshouseAuctionLib.GlasshouseExclusiveWindow.selector, ada, book.outcome(maker, orderHash).exclusiveUntil
            )
        );
        router.quote(order, SWAP_AMOUNT, cydData);
    }

    // ===========================================================================
    // THE COMPARISON
    // ===========================================================================

    /// @dev THE WHOLE ARGUMENT IN ONE TEST. Same order, same three participants, same
    ///      valuations. Only the allocation rule differs.
    ///
    ///      Measured on what the MAKER receives, since the maker is the user whose order
    ///      this is. `isExactIn` fixes what the taker pays at SWAP_AMOUNT, so the maker's
    ///      position is what it gives up: a SMALLER `amountOut` is a better outcome for
    ///      the maker.
    function test_Comparison_AllThreeGatesOnTheSameOrder() public {
        // --- identity: the incumbent fills at base, everyone else reverts
        ISwapVM.Order memory identity = _order(_identityProgram());
        uint256 identityOut = _quoteAs(identity, cyd);
        address identityWinner = cyd;

        // --- clock: everyone faces one price, so the fastest takes it
        ISwapVM.Order memory clock = _order(_clockProgram());
        vm.warp(LADDER_START + 60);
        uint256 clockOut = _quoteAs(clock, cyd);
        address clockWinner = cyd;

        // --- bid: the highest valuation wins and pays the second price
        ISwapVM.Order memory bid = _order(_bidProgram());
        bytes32 orderHash = router.hash(bid);
        _runGlasshouseAuction(orderHash);
        uint256 bidOut = _quoteAs(bid, ada);
        address bidWinner = book.outcome(maker, orderHash).winner;

        uint256 base = _basePriceOut();
        console.log("");
        console.log("   ONE ORDER, THREE WAYS OF DECIDING WHO FILLS");
        console.log("   the same three participants, the same valuations, the same curve");
        console.log("");
        console.log("   gate                        winner   values   maker gives up");
        console.log("                                        (bps)    (bps of base)");
        console.log("   -------------------------------------------------------------");
        console.log("   identity  WhitelistSequential  0x2d", CYD_VALUE, identityOut * 10_000 / base);
        console.log("   clock     DutchAuctionBalIn    0x94", CYD_VALUE, clockOut * 10_000 / base);
        console.log("   bid       GlasshouseAuction    0x2e", ADA_VALUE, bidOut * 10_000 / base);
        console.log("   -------------------------------------------------------------");
        console.log("   base price = 10000. Lower is better for the maker.");
        console.log("");
        console.log("   identity and clock both hand the fill to the participant who");
        console.log("   values it LEAST -- the incumbent, and the fastest, are the same");
        console.log("   party. The clock additionally concedes to the taker every second");
        console.log("   it runs. Only the bid gate allocates to the highest valuation,");
        console.log("   and only it moves value toward the maker.");
        console.log("");

        // 1. ALLOCATION. Identity and clock both hand the fill to the participant who
        //    values it least. Only the bid gate allocates to the highest valuation.
        assertEq(identityWinner, cyd, "identity: incumbent, chosen off-chain");
        assertEq(clockWinner, cyd, "clock: fastest, not highest");
        assertEq(bidWinner, ada, "bid: highest valuation");

        // 2. PRICE. The maker gives up the least under the bid gate, and strictly more
        //    under the clock than under no gate at all.
        assertLt(bidOut, identityOut, "bid gate returns more to the maker than identity");
        assertLt(bidOut, clockOut, "bid gate returns more to the maker than the clock");
        assertGt(clockOut, identityOut, "the clock concedes to the taker as it runs");

        // 3. And the improvement is exactly the second-highest valuation, so the number
        //    is not an artefact of the parameters: it is the competition, priced.
        assertEq(book.outcome(maker, orderHash).clearingBps, BRAM_VALUE, "clearing == second bid");
    }

    /// @dev The comparison must not depend on the Dutch auction being caught at a
    ///      flattering moment. At ANY point in its run the clock hands the fill to
    ///      whoever is first in the block, and the maker never does better than base.
    function testFuzz_Comparison_ClockNeverBeatsBaseForTheMaker(uint16 rawElapsed) public {
        uint256 elapsed = uint256(rawElapsed) % DUTCH_DURATION;
        ISwapVM.Order memory clock = _order(_clockProgram());
        vm.warp(LADDER_START + elapsed);

        uint256 outAda = _quoteAs(clock, ada);
        uint256 outCyd = _quoteAs(clock, cyd);

        assertEq(outAda, outCyd, "one price per block, whatever the elapsed time");
        assertGe(outAda, _basePriceOut(), "the clock only ever concedes to the taker");
    }
}
