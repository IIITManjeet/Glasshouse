// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Test } from "forge-std/Test.sol";
import { console } from "forge-std/console.sol";

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import { IAqua } from "@1inch/aqua/src/interfaces/IAqua.sol";

import { ISwapVM } from "@1inch/swap-vm/src/interfaces/ISwapVM.sol";
import { MakerTraitsLib } from "@1inch/swap-vm/src/libs/MakerTraits.sol";
import { TakerTraitsLib } from "@1inch/swap-vm/src/libs/TakerTraits.sol";
import { XYCSwap } from "@1inch/swap-vm/src/instructions/XYCSwap.sol";

import { GlasshouseAuction } from "../../src/instructions/GlasshouseAuction.sol";
import { GlasshouseAuctionLib } from "../../src/lib/GlasshouseAuctionLib.sol";
import { GlasshouseBook } from "../../src/book/GlasshouseBook.sol";
import { GlasshouseRouter } from "../../src/routers/GlasshouseRouter.sol";

interface IWETH {
    function deposit() external payable;
}

/// @title AquaBaseFork
/// @notice The 1inch track's qualification requirement, executed: "onchain execution of
///         token transfers should be presented during the final demo (local forks are
///         ok)", against the OFFICIAL Aqua deployment rather than a mock of it.
///
/// Everything upstream here is real Base mainnet state:
///   Aqua  0x1111113ccf1426a8e30e2bff5e005d929bf6a90a  (5,619 bytes, verified live)
///   WETH  0x4200000000000000000000000000000000000006
///   USDC  0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
///
/// Only `GlasshouseBook` and `GlasshouseRouter` are ours, and the router is the DEPLOYABLE
/// one - `AquaSwapVMRouter` plus opcode 0x2e - not the oversized test harness.
///
/// @dev NOTE ON THE CURVE. `AquaOpcodes` contains no `LimitSwap`, so an Aqua-mode program
///      prices with `XYCSwap`: `amountOut = amountIn * balanceOut / (balanceIn + amountIn)`.
///      Scaling `balanceIn` by (1 + b) therefore moves the price by *approximately* b,
///      approaching it exactly as the fill shrinks relative to the shipped balance. The
///      exact-b result holds for `LimitSwap`, which is what the unit tests use. Both are
///      correct in direction; only the constant-product path is approximate, and this test
///      measures the actual figure rather than assuming it.
///
/// @dev Skips cleanly when no fork is available, so the suite still runs offline.
contract AquaBaseFork is Test {
    address internal constant AQUA = 0x1111113CCf1426A8E30e2bfF5E005d929bF6a90a;
    address internal constant WETH = 0x4200000000000000000000000000000000000006;
    address internal constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;

    GlasshouseBook internal book;
    GlasshouseRouter internal router;

    address internal maker;
    address internal winner;
    address internal rival;

    uint256 internal constant BALANCE_WETH = 10 ether;
    uint256 internal constant BALANCE_USDC = 40_000e6;
    uint256 internal constant SWAP_AMOUNT = 0.01 ether;

    uint40 internal constant COMMIT_BLOCKS = 30;
    uint40 internal constant REVEAL_BLOCKS = 30;
    uint40 internal constant EXCLUSIVE_BLOCKS = 15;
    uint24 internal constant RESERVE_BPS = 50;
    uint24 internal constant MAX_BPS = 500;

    uint24 internal constant WINNING_BID = 400;
    uint24 internal constant RIVAL_BID = 250;

    bool internal forked;

    function setUp() public {
        try vm.createSelectFork(vm.envOr("BASE_RPC_URL", string("https://mainnet.base.org"))) {
            forked = true;
        } catch {
            return;
        }
        require(AQUA.code.length > 0, "Aqua absent: not a Base fork");

        maker = makeAddr("maker");
        winner = makeAddr("winner");
        rival = makeAddr("rival");

        book = new GlasshouseBook();
        router = new GlasshouseRouter(AQUA, WETH, address(this), "GlasshouseRouter", "1.0.0");

        // Fund from the real tokens. WETH is minted by deposit; USDC by cheatcode.
        vm.deal(maker, 100 ether);
        vm.prank(maker);
        IWETH(WETH).deposit{ value: 50 ether }();
        deal(USDC, maker, 1_000_000e6);

        vm.deal(winner, 10 ether);
        vm.prank(winner);
        IWETH(WETH).deposit{ value: 5 ether }();

        vm.startPrank(maker);
        IERC20(WETH).approve(AQUA, type(uint256).max);
        IERC20(USDC).approve(AQUA, type(uint256).max);
        vm.stopPrank();

        vm.prank(winner);
        IERC20(WETH).approve(address(router), type(uint256).max);
    }

    modifier onlyForked() {
        if (!forked) return;
        _;
    }

    // --- order construction ----------------------------------------------------

    /// @dev Aqua mode: no balances instruction, because Aqua supplies them. The gate runs
    ///      first, then the curve.
    function _order() internal view returns (ISwapVM.Order memory) {
        return MakerTraitsLib.build(
            MakerTraitsLib.Args({
                maker: maker,
                tokenA: WETH,
                tokenB: USDC,
                shouldUnwrapWeth: false,
                useAquaInsteadOfSignature: true,
                allowZeroAmountIn: false,
                receiver: address(0),
                hasPreTransferInHook: false,
                hasPostTransferInHook: true,
                hasPreTransferOutHook: false,
                hasPostTransferOutHook: false,
                preTransferInTarget: address(0),
                preTransferInData: "",
                postTransferInTarget: address(book),
                postTransferInData: "",
                preTransferOutTarget: address(0),
                preTransferOutData: "",
                postTransferOutTarget: address(0),
                postTransferOutData: "",
                program: bytes.concat(GlasshouseAuction.build(address(book), MAX_BPS), XYCSwap.build())
            })
        );
    }

    function _takerData() internal view returns (bytes memory) {
        return TakerTraitsLib.build(
            TakerTraitsLib.Args({
                taker: address(0),
                isExactIn: true,
                shouldUnwrapWeth: false,
                isStrictThresholdAmount: false,
                isFirstTransferFromTaker: false,
                useTransferFromAndAquaPush: true,
                isAToB: true,
                allowPartialFill: false,
                threshold: "",
                to: winner,
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
                signature: ""
            })
        );
    }

    /// @dev Registers the strategy with the real Aqua. Tokens stay in the maker's wallet;
    ///      Aqua tracks the virtual balances the router may draw on.
    function _ship(ISwapVM.Order memory order) internal returns (bytes32 strategyHash) {
        address[] memory tokens = new address[](2);
        tokens[0] = WETH;
        tokens[1] = USDC;
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = BALANCE_WETH;
        amounts[1] = BALANCE_USDC;

        vm.prank(maker);
        strategyHash = IAqua(AQUA).ship(address(router), abi.encode(order), tokens, amounts);
        assertEq(strategyHash, router.hash(order), "strategy hash must equal the order hash");
    }

    function _runAuction(bytes32 orderHash) internal returns (uint40 revealEnd) {
        vm.prank(maker);
        book.open(
            orderHash, address(router), WETH, COMMIT_BLOCKS, REVEAL_BLOCKS, EXCLUSIVE_BLOCKS, RESERVE_BPS, MAX_BPS, 0
        );
        GlasshouseBook.Auction memory a = book.auctions(maker, orderHash);
        revealEnd = a.revealEnd;

        bytes32 cw = book.commitmentFor(winner, WINNING_BID, bytes32("s"));
        bytes32 cr = book.commitmentFor(rival, RIVAL_BID, bytes32("s"));
        vm.prank(winner);
        book.commit(maker, orderHash, cw);
        vm.prank(rival);
        book.commit(maker, orderHash, cr);

        vm.roll(a.commitEnd + 1);
        vm.prank(winner);
        book.reveal(maker, orderHash, WINNING_BID, bytes32("s"));
        vm.prank(rival);
        book.reveal(maker, orderHash, RIVAL_BID, bytes32("s"));

        vm.roll(revealEnd + 1);
    }

    // --- the test that satisfies the track ------------------------------------

    /// @dev A real fill, through the official Aqua, gated by opcode 0x2e, with tokens
    ///      actually moving between wallets on forked Base mainnet state.
    function test_Fork_RealFillThroughOfficialAqua() public onlyForked {
        ISwapVM.Order memory order = _order();
        bytes32 orderHash = _ship(order);
        _runAuction(orderHash);

        assertEq(book.outcome(maker, orderHash).winner, winner, "highest bid wins");
        assertEq(book.outcome(maker, orderHash).clearingBps, RIVAL_BID, "pays the second bid");

        uint256 makerWethBefore = IERC20(WETH).balanceOf(maker);
        uint256 winnerWethBefore = IERC20(WETH).balanceOf(winner);
        uint256 winnerUsdcBefore = IERC20(USDC).balanceOf(winner);

        vm.prank(winner);
        (uint256 amountIn, uint256 amountOut,) = router.swap(order, SWAP_AMOUNT, _takerData());

        assertEq(amountIn, SWAP_AMOUNT, "exact-in");
        assertGt(amountOut, 0, "the winner received USDC");

        // Tokens really moved, in both directions, between real wallets.
        assertEq(IERC20(WETH).balanceOf(maker) - makerWethBefore, amountIn, "maker received WETH");
        assertEq(winnerWethBefore - IERC20(WETH).balanceOf(winner), amountIn, "winner paid WETH");
        assertEq(IERC20(USDC).balanceOf(winner) - winnerUsdcBefore, amountOut, "winner received USDC");

        // And the fill was recorded through the maker hook.
        assertEq(book.auctions(maker, orderHash).filledBy, winner, "fill recorded");

        console.log("");
        console.log("   REAL FILL ON FORKED BASE, THROUGH THE OFFICIAL AQUA");
        console.log("   ---------------------------------------------------");
        console.log("   Aqua          0x1111113CCf1426A8E30e2bfF5E005d929bF6a90a");
        console.log("   clearing bps ", RIVAL_BID);
        console.log("   WETH in      ", amountIn);
        console.log("   USDC out     ", amountOut);
        console.log("");
    }

    /// @dev The gate must exclude a non-winner on the real deployment too, not only in the
    ///      unit harness. This is the property the whole mechanism rests on.
    function test_Fork_OutsiderIsExcludedInsideTheWindow() public onlyForked {
        ISwapVM.Order memory order = _order();
        bytes32 orderHash = _ship(order);
        _runAuction(orderHash);

        bytes memory takerData = _takerData();
        uint40 until = book.outcome(maker, orderHash).exclusiveUntil;

        vm.prank(rival);
        vm.expectRevert(
            abi.encodeWithSelector(GlasshouseAuctionLib.GlasshouseExclusiveWindow.selector, winner, until)
        );
        router.quote(order, SWAP_AMOUNT, takerData);
    }

    /// @dev How much the improvement is actually worth on the constant-product curve the
    ///      deployed router has to use. Measured, not assumed: `XYCSwap` dilutes the
    ///      balanceIn scaling by the fill size, so this lands slightly under the nominal
    ///      250 bps and approaches it as the fill shrinks.
    function test_Fork_MeasuredImprovementOnTheXYCCurve() public onlyForked {
        ISwapVM.Order memory order = _order();
        bytes32 orderHash = _ship(order);
        uint40 revealEnd = _runAuction(orderHash);
        bytes memory takerData = _takerData();

        vm.prank(winner);
        (, uint256 improvedOut,) = router.quote(order, SWAP_AMOUNT, takerData);

        vm.roll(revealEnd + EXCLUSIVE_BLOCKS + 1);
        vm.prank(winner);
        (, uint256 baseOut,) = router.quote(order, SWAP_AMOUNT, takerData);

        assertLt(improvedOut, baseOut, "improvement must move price toward the maker");

        uint256 measuredBps = (baseOut - improvedOut) * 10_000 / baseOut;
        console.log("");
        console.log("   improvement on the XYC curve, in bps of the base fill");
        console.log("   nominal clearing ", RIVAL_BID);
        console.log("   measured         ", measuredBps);
        console.log("");

        assertLe(measuredBps, uint256(RIVAL_BID), "constant product dilutes, never amplifies");
        assertGt(measuredBps, uint256(RIVAL_BID) * 9 / 10, "and only slightly, at this fill size");
    }
}
