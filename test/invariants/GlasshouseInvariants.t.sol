// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Test } from "forge-std/Test.sol";

import { TokenMock } from "@1inch/solidity-utils/contracts/mocks/TokenMock.sol";

import { CoreInvariants } from "@1inch/swap-vm/test/invariants/CoreInvariants.t.sol";
import { ISwapVM } from "@1inch/swap-vm/src/interfaces/ISwapVM.sol";
import { SwapVM } from "@1inch/swap-vm/src/SwapVM.sol";
import { MakerTraitsLib } from "@1inch/swap-vm/src/libs/MakerTraits.sol";
import { TakerTraitsLib } from "@1inch/swap-vm/src/libs/TakerTraits.sol";
import { StaticBalances } from "@1inch/swap-vm/src/instructions/Balances.sol";
import { LimitSwap } from "@1inch/swap-vm/src/instructions/LimitSwap.sol";

import { GlasshouseAuction } from "../../src/instructions/GlasshouseAuction.sol";
import { GlasshouseAuctionLib } from "../../src/lib/GlasshouseAuctionLib.sol";
import { GlasshouseBook } from "../../src/book/GlasshouseBook.sol";
import { GlasshouseTestRouter } from "../helpers/GlasshouseTestRouter.sol";

/// @title GlasshouseInvariants
/// @notice The seven invariants 1inch judges strategies against, applied to opcode 0x2e.
///
/// @dev Uses upstream's own `CoreInvariants` harness rather than a reimplementation, so
///      the assertions are theirs and not ours. `PROGRAMS.md` names it as the reference.
///
/// @dev What is new here is the phase dimension. Every other invariant suite in the
///      upstream repo tests one price regime; this instruction has three, and the
///      interesting claim is that the invariants hold in each of them independently:
///
///        bidding  nothing may fill at all, in any direction, at any size
///        window   the winner fills at the improved price, and the improvement must not
///                 break symmetry, additivity or rounding
///        open     the improvement is gone and the order prices exactly as it would
///                 have with no auction attached
///
/// @dev The taker throughout is `address(this)`, because `CoreInvariants._executeSwap`
///      calls the router directly. So the test contract has to win its own auction.
contract GlasshouseInvariants is Test, CoreInvariants {
    GlasshouseTestRouter internal swapVM;
    GlasshouseBook internal book;
    TokenMock internal tokenA;
    TokenMock internal tokenB;

    uint256 internal constant MAKER_PK = 0x1234;
    address internal maker;
    address internal rival;

    uint256 internal constant BALANCE_A = 1e30;
    uint256 internal constant BALANCE_B = 2e30;

    // The parameters we actually deploy with (config/auction.json, "advocated").
    uint40 internal constant COMMIT_BLOCKS = 30;
    uint40 internal constant REVEAL_BLOCKS = 30;
    uint40 internal constant EXCLUSIVE_BLOCKS = 15;
    uint24 internal constant RESERVE_BPS = 50;
    uint24 internal constant MAX_BPS = 500;

    uint24 internal constant WINNING_BID = 400;
    uint24 internal constant RIVAL_BID = 250; // becomes the clearing price

    uint40 internal revealEnd;

    function setUp() public {
        maker = vm.addr(MAKER_PK);
        rival = vm.addr(0x2222);

        book = new GlasshouseBook();
        swapVM = new GlasshouseTestRouter(address(0), address(0), address(this), "SwapVM", "1.0.0");

        tokenA = new TokenMock("Token I", "TKI");
        tokenB = new TokenMock("Token J", "TKJ");
        if (tokenA > tokenB) (tokenA, tokenB) = (tokenB, tokenA);

        tokenA.mint(maker, type(uint128).max);
        tokenB.mint(maker, type(uint128).max);
        vm.startPrank(maker);
        tokenA.approve(address(swapVM), type(uint256).max);
        tokenB.approve(address(swapVM), type(uint256).max);
        vm.stopPrank();

        tokenA.approve(address(swapVM), type(uint256).max);
        tokenB.approve(address(swapVM), type(uint256).max);

        vm.roll(1000);
    }

    /// @inheritdoc CoreInvariants
    function _executeSwap(
        SwapVM _swapVM,
        ISwapVM.Order memory order,
        address tokenIn,
        address,
        uint256 amount,
        bytes memory takerData
    ) internal override returns (uint256 amountIn, uint256 amountOut) {
        TokenMock(tokenIn).mint(address(this), amount * 10);
        (amountIn, amountOut,) = _swapVM.swap(order, amount, takerData);
    }

    // --- program and order -----------------------------------------------------

    function _program() internal view returns (bytes memory) {
        return bytes.concat(
            StaticBalances.build(BALANCE_A, BALANCE_B),
            GlasshouseAuction.build(address(book), MAX_BPS),
            LimitSwap.build(address(tokenA), address(tokenB))
        );
    }

    function _order() internal view returns (ISwapVM.Order memory) {
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
                program: _program()
            })
        );
    }

    function _takerData(ISwapVM.Order memory order, bool isExactIn, uint256 threshold)
        internal
        view
        returns (bytes memory)
    {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(MAKER_PK, swapVM.hash(order));
        return TakerTraitsLib.build(
            TakerTraitsLib.Args({
                taker: address(0),
                isExactIn: isExactIn,
                shouldUnwrapWeth: false,
                isStrictThresholdAmount: false,
                isFirstTransferFromTaker: false,
                useTransferFromAndAquaPush: false,
                isAToB: true,
                allowPartialFill: false,
                threshold: threshold > 0 ? abi.encodePacked(bytes32(threshold)) : bytes(""),
                to: address(this),
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

    /// @dev The test contract wins its own auction, since it is the taker the harness
    ///      drives. The rival exists so the clearing price is a real second price rather
    ///      than the reserve.
    function _winAuction(bytes32 orderHash) internal {
        vm.prank(maker);
        book.open(
            orderHash,
            address(swapVM),
            address(tokenA),
            COMMIT_BLOCKS,
            REVEAL_BLOCKS,
            EXCLUSIVE_BLOCKS,
            RESERVE_BPS,
            MAX_BPS,
            0
        );
        GlasshouseBook.Auction memory a = book.auctions(maker, orderHash);
        revealEnd = a.revealEnd;

        book.commit(maker, orderHash, book.commitmentFor(address(this), WINNING_BID, bytes32("s")));
        bytes32 rivalCommitment = book.commitmentFor(rival, RIVAL_BID, bytes32("s"));
        vm.prank(rival);
        book.commit(maker, orderHash, rivalCommitment);

        vm.roll(a.commitEnd + 1);
        book.reveal(maker, orderHash, WINNING_BID, bytes32("s"));
        vm.prank(rival);
        book.reveal(maker, orderHash, RIVAL_BID, bytes32("s"));
    }

    function _config(ISwapVM.Order memory order) internal view returns (InvariantConfig memory config) {
        config = _getDefaultConfig();
        config.exactInTakerData = _takerData(order, true, 0);
        config.exactOutTakerData = _takerData(order, false, type(uint256).max);
    }

    // --- the three phases ------------------------------------------------------

    /// @dev While bids can still arrive there is no winner, so NOTHING may fill -- in
    ///      either direction, at any size, for anyone. The invariant assertions all
    ///      execute swaps, so the correct check for this phase is that every one of them
    ///      reverts rather than that they agree.
    function test_Invariants_NothingFillsWhileBiddingIsOpen() public {
        ISwapVM.Order memory order = _order();
        _winAuction(swapVM.hash(order));
        // _winAuction leaves us mid-reveal: bids are in, but revealEnd has not passed.

        // Built up front: `_takerData` makes an external call, and `expectRevert` binds
        // to the next call of any kind.
        bytes memory exactIn = _takerData(order, true, 0);
        bytes memory exactOut = _takerData(order, false, type(uint256).max);

        uint256[3] memory amounts = [uint256(1e18), 10e18, 50e18];
        for (uint256 i; i < amounts.length; i++) {
            vm.expectRevert(GlasshouseAuctionLib.GlasshouseAuctionInProgress.selector);
            swapVM.quote(order, amounts[i], exactIn);

            vm.expectRevert(GlasshouseAuctionLib.GlasshouseAuctionInProgress.selector);
            swapVM.quote(order, amounts[i], exactOut);
        }

        // Including for the eventual winner: winning does not grant an early fill.
        vm.roll(revealEnd);
        vm.expectRevert(GlasshouseAuctionLib.GlasshouseAuctionInProgress.selector);
        swapVM.quote(order, 1e18, exactIn);
    }

    /// @dev Inside the exclusive window the winner pays the improved price. Every
    ///      invariant has to survive that: scaling `balanceIn` must not break exact-in /
    ///      exact-out symmetry, must not make splitting a swap profitable, and must not
    ///      round against the maker.
    function test_Invariants_HoldInsideTheExclusiveWindow() public {
        ISwapVM.Order memory order = _order();
        _winAuction(swapVM.hash(order));
        vm.roll(revealEnd + 1);

        assertEq(book.outcome(maker, swapVM.hash(order)).clearingBps, RIVAL_BID, "clearing is the second bid");

        assertAllInvariantsWithConfig(swapVM, order, address(tokenA), address(tokenB), _config(order));
    }

    /// @dev And they still hold at the last block of the window, which is the boundary a
    ///      fencepost error would land on.
    function test_Invariants_HoldAtTheLastBlockOfTheWindow() public {
        ISwapVM.Order memory order = _order();
        _winAuction(swapVM.hash(order));
        vm.roll(revealEnd + EXCLUSIVE_BLOCKS);

        assertAllInvariantsWithConfig(swapVM, order, address(tokenA), address(tokenB), _config(order));
    }

    /// @dev Once the window elapses the improvement is gone and the order must price
    ///      exactly as it would have with no auction attached. Same invariants, and the
    ///      gate is now transparent.
    function test_Invariants_HoldAfterTheWindowElapses() public {
        ISwapVM.Order memory order = _order();
        _winAuction(swapVM.hash(order));
        vm.roll(revealEnd + EXCLUSIVE_BLOCKS + 1);

        assertAllInvariantsWithConfig(swapVM, order, address(tokenA), address(tokenB), _config(order));
    }

    /// @dev With no auction ever opened the gate must be inert: the program prices as a
    ///      plain limit order and the invariants hold unchanged. This is the liveness
    ///      case, and it is what a maker gets if they ship a strategy and never run an
    ///      auction against it.
    function test_Invariants_HoldWithNoAuctionAtAll() public {
        ISwapVM.Order memory order = _order();
        assertAllInvariantsWithConfig(swapVM, order, address(tokenA), address(tokenB), _config(order));
    }

    /// @dev The improvement must be the ONLY difference between the windowed price and
    ///      the open one. If the gate perturbed anything else, this ratio would drift.
    function test_ImprovementIsExactlyTheClearingPrice() public {
        ISwapVM.Order memory order = _order();
        _winAuction(swapVM.hash(order));
        bytes memory takerData = _takerData(order, true, 0);

        vm.roll(revealEnd + 1);
        (, uint256 improvedOut,) = swapVM.quote(order, 1e18, takerData);

        vm.roll(revealEnd + EXCLUSIVE_BLOCKS + 1);
        (, uint256 baseOut,) = swapVM.quote(order, 1e18, takerData);

        // balanceIn was scaled by (1 + clearing), so out is divided by it.
        uint256 expected = baseOut * 10_000 / (10_000 + uint256(RIVAL_BID));
        assertApproxEqAbs(improvedOut, expected, 1, "improvement is not exactly the clearing price");
        assertLt(improvedOut, baseOut, "improvement must move price toward the maker");
    }
}
