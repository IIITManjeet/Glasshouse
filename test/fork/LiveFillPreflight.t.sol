// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import { Test } from "forge-std/Test.sol";
import { console } from "forge-std/console.sol";

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import { IAqua } from "@1inch/aqua/src/interfaces/IAqua.sol";
import { ISwapVM } from "@1inch/swap-vm/src/interfaces/ISwapVM.sol";
import { MakerTraits, MakerTraitsLib } from "@1inch/swap-vm/src/libs/MakerTraits.sol";
import { TakerTraitsLib } from "@1inch/swap-vm/src/libs/TakerTraits.sol";
import { XYCSwap } from "@1inch/swap-vm/src/instructions/XYCSwap.sol";

import { GlasshouseAuction } from "../../src/instructions/GlasshouseAuction.sol";
import { GlasshouseBook } from "../../src/book/GlasshouseBook.sol";
import { GlasshouseRouter } from "../../src/routers/GlasshouseRouter.sol";

interface IWETH is IERC20 {
    function deposit() external payable;
}

/// @title Preflight for the live mainnet fill
///
/// @notice `AquaBaseFork.t.sol` proves a real fill works, but it deploys a FRESH Book and
///         Router inside the test. This one binds to the contracts actually deployed on
///         Base, uses the real maker address, and uses the dust amounts the live run will
///         use -- so what it proves is not "the design works" but "these exact bytes,
///         against these exact addresses, at this scale, will fill".
///
///         It then prints the order and taker data as hex, which is what
///         `scripts/run-live-fill.ts` broadcasts. Nothing is hand-packed: the encoding
///         comes out of upstream's own `MakerTraitsLib` / `TakerTraitsLib`, because a
///         mis-packed order on mainnet is an order that can never be filled and an
///         auction that can never be won.
///
///         Run:
///           forge test --match-contract LiveFillPreflight -vv
contract LiveFillPreflightTest is Test {
    // --- the real deployment ----------------------------------------------------
    address internal constant AQUA = 0x1111113CCf1426A8E30e2bfF5E005d929bF6a90a;
    address internal constant BOOK = 0xc4ea91Fe700918220423ac307C6B1c59650FFbfe;
    address internal constant ROUTER = 0x5c3baE054e8b4915a13726B397b1AeA864247DBf;
    address internal constant MAKER = 0xeEbf737F92C8F0d9070f35a7D9BAf416923bEcDf;

    address internal constant WETH = 0x4200000000000000000000000000000000000006;
    address internal constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;

    // --- dust, sized so the maker holds what a fill actually pulls ---------------
    //
    // Aqua.ship() records virtual balances and moves no tokens (Aqua.sol:40-52); the
    // transfer happens at pull(), for the fill amount only (:63-70). So the declared
    // balance could be anything. It is set to what the maker will really hold, because a
    // strategy that could not honour a larger fill is a strategy we should not advertise.
    //
    // 0.0008 WETH against 2 USDC is ~2500 USDC/WETH, which is where the Uniswap v3
    // WETH/USDC pool on Base actually is, so the curve prices this the way a real one
    // would and the strategy is not trivially arbitrageable. A 0.00001 WETH fill is
    // ~1.2% of the reserve.
    uint256 internal constant BALANCE_WETH = 0.0008 ether;
    uint256 internal constant BALANCE_USDC = 2e6;
    uint256 internal constant SWAP_AMOUNT = 0.00001 ether;

    // --- auction, the `advocated` set from config/auction.json -------------------
    uint40 internal constant COMMIT_BLOCKS = 30;
    uint40 internal constant REVEAL_BLOCKS = 30;
    uint40 internal constant EXCLUSIVE_BLOCKS = 15;
    uint24 internal constant RESERVE_BPS = 50;
    uint24 internal constant MAX_BPS = 500;
    uint24 internal constant WINNING_BID = 400;
    uint24 internal constant RIVAL_BID = 250;

    GlasshouseBook internal book;
    GlasshouseRouter internal router;

    address internal winner;
    address internal rival;
    bool internal forked;

    function setUp() public {
        try vm.createSelectFork(vm.envOr("BASE_RPC_URL", string("https://mainnet.base.org"))) {
            forked = true;
        } catch {
            return;
        }
        require(AQUA.code.length > 0, "Aqua absent: not a Base fork");
        require(BOOK.code.length > 0, "Book absent: wrong chain");
        require(ROUTER.code.length > 0, "Router absent: wrong chain");

        book = GlasshouseBook(BOOK);
        router = GlasshouseRouter(payable(ROUTER));

        winner = makeAddr("winner");
        rival = makeAddr("rival");

        // What the live run will have to arrange for real. The maker holds USDC to pay
        // out and approves Aqua; the winner holds WETH to pay in and approves the router.
        deal(USDC, MAKER, BALANCE_USDC);
        vm.startPrank(MAKER);
        IERC20(USDC).approve(AQUA, type(uint256).max);
        IERC20(WETH).approve(AQUA, type(uint256).max);
        vm.stopPrank();

        vm.deal(winner, 0.01 ether);
        vm.startPrank(winner);
        IWETH(WETH).deposit{ value: SWAP_AMOUNT }();
        IERC20(WETH).approve(ROUTER, type(uint256).max);
        vm.stopPrank();

        vm.deal(rival, 0.01 ether);
    }

    modifier onlyForked() {
        if (!forked) {
            // Not skipped silently: a fork test that "passes" without a fork is a test
            // that reports coverage it does not have.
            vm.skip(true);
        }
        _;
    }

    /// @dev Aqua mode: no balances instruction, Aqua supplies them. Gate first, curve
    ///      second -- 0x2e must decide who may fill before the price is computed.
    function _order() internal pure returns (ISwapVM.Order memory) {
        return MakerTraitsLib.build(
            MakerTraitsLib.Args({
                maker: MAKER,
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
                postTransferInTarget: BOOK,
                postTransferInData: "",
                preTransferOutTarget: address(0),
                preTransferOutData: "",
                postTransferOutTarget: address(0),
                postTransferOutData: "",
                program: bytes.concat(GlasshouseAuction.build(BOOK, MAX_BPS), XYCSwap.build())
            })
        );
    }

    function _takerData(address to) internal pure returns (bytes memory) {
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
                signature: ""
            })
        );
    }

    /// @dev The whole live run, against real Base state and the real deployed contracts.
    function test_Preflight_TheLiveRunFills() public onlyForked {
        ISwapVM.Order memory order = _order();

        // --- ship ---------------------------------------------------------------
        address[] memory tokens = new address[](2);
        tokens[0] = WETH;
        tokens[1] = USDC;
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = BALANCE_WETH;
        amounts[1] = BALANCE_USDC;

        vm.prank(MAKER);
        bytes32 orderHash = IAqua(AQUA).ship(ROUTER, abi.encode(order), tokens, amounts);
        assertEq(orderHash, router.hash(order), "strategy hash must equal the order hash");

        // THE POINT OF THE WHOLE EXERCISE. The first live run opened against
        // `Date.now()` in hex, which is not the hash of anything, so no program ran and
        // no fill was possible. This is a real order hash, and it is what the auction
        // must be opened against.
        assertTrue(orderHash != bytes32(uint256(uint40(block.timestamp)) * 1000), "not a timestamp");

        // --- auction ------------------------------------------------------------
        vm.prank(MAKER);
        book.open(orderHash, ROUTER, WETH, COMMIT_BLOCKS, REVEAL_BLOCKS, EXCLUSIVE_BLOCKS, RESERVE_BPS, MAX_BPS, 0);

        GlasshouseBook.Auction memory a = book.auctions(MAKER, orderHash);

        bytes32 saltW = keccak256("winner salt, per bidder, not shared");
        bytes32 saltR = keccak256("rival salt, per bidder, not shared");

        // Hoisted deliberately. vm.prank applies to the NEXT call, and an inline
        // book.commitmentFor(...) argument IS that next call -- the prank is spent on it
        // and commit() then runs as the test contract. That fails as AlreadyCommitted on
        // the second bidder, which is a confusing way to learn this.
        bytes32 cw = book.commitmentFor(winner, WINNING_BID, saltW);
        bytes32 cr = book.commitmentFor(rival, RIVAL_BID, saltR);

        vm.prank(winner);
        book.commit(MAKER, orderHash, cw);
        vm.prank(rival);
        book.commit(MAKER, orderHash, cr);

        // Nothing may fill during bidding, not even the eventual winner.
        vm.roll(a.commitEnd);
        assertEq(uint8(book.outcome(MAKER, orderHash).status), 1, "bidding");

        vm.roll(uint256(a.commitEnd) + 1);
        vm.prank(winner);
        book.reveal(MAKER, orderHash, WINNING_BID, saltW);
        vm.prank(rival);
        book.reveal(MAKER, orderHash, RIVAL_BID, saltR);

        vm.roll(uint256(a.revealEnd) + 1);
        assertEq(book.outcome(MAKER, orderHash).winner, winner, "highest bid wins");
        assertEq(book.outcome(MAKER, orderHash).clearingBps, RIVAL_BID, "pays the second bid");

        // --- the fill -----------------------------------------------------------
        uint256 makerWethBefore = IERC20(WETH).balanceOf(MAKER);
        uint256 makerUsdcBefore = IERC20(USDC).balanceOf(MAKER);
        uint256 winnerUsdcBefore = IERC20(USDC).balanceOf(winner);

        vm.prank(winner);
        (uint256 amountIn, uint256 amountOut,) = router.swap(order, SWAP_AMOUNT, _takerData(winner));

        assertEq(amountIn, SWAP_AMOUNT, "exact-in");
        assertGt(amountOut, 0, "the winner received USDC");
        assertEq(IERC20(WETH).balanceOf(MAKER) - makerWethBefore, amountIn, "maker received WETH");
        assertEq(IERC20(USDC).balanceOf(winner) - winnerUsdcBefore, amountOut, "winner received USDC");
        assertEq(makerUsdcBefore - IERC20(USDC).balanceOf(MAKER), amountOut, "maker paid the USDC");

        // The fill was reported back to the Book by the maker hook, so the auction knows
        // the winner filled and nobody has to be taken on trust.
        assertEq(book.auctions(MAKER, orderHash).filledBy, winner, "fill recorded against the winner");

        console.log("");
        console.log("   LIVE RUN PREFLIGHT - real deployed contracts, real Base state");
        console.log("   ------------------------------------------------------------");
        console.log("   orderHash    %s", vm.toString(orderHash));
        console.log("   maker        %s", MAKER);
        console.log("   WETH in      %s", amountIn);
        console.log("   USDC out     %s", amountOut);
        console.log("   clearing     %s bps (the rival's bid, not the winner's)", RIVAL_BID);
        console.log("   maker USDC   %s -> %s", makerUsdcBefore, IERC20(USDC).balanceOf(MAKER));
        console.log("");
        console.log("   order.traits %s", vm.toString(MakerTraits.unwrap(order.traits)));
        console.log("   order.data   %s", vm.toString(order.data));
        console.log("   takerData    %s", vm.toString(_takerData(winner)));
        console.log("");
    }

    /// @dev A ROUND COUNTER MAKES THE ORDER HASH FRESH, which is what lets a keeper open
    ///      a new auction every few minutes instead of the run being one-shot forever.
    ///
    ///      `Aqua.ship` rejects a strategy hash it has already seen
    ///      (StrategiesMustBeImmutable) and `Book.open` rejects an order hash it has
    ///      already opened, so a deterministic order can be run exactly once. The escape
    ///      is `postTransferInData`: MakerTraits concatenates it into `order.data`
    ///      (MakerTraits.sol:163) so it changes the hash, while the Book ignores it -- its
    ///      `postTransferIn` takes both hook-data arguments UNNAMED
    ///      (GlasshouseBook.sol:245-246), so nothing about the mechanism depends on the
    ///      bytes. A counter there is therefore free.
    ///
    ///      This pins that: same order in every other respect, different round, different
    ///      hash, and the gate is still the first instruction in the program.
    function test_Preflight_ARoundCounterGivesAFreshOrderHash() public pure {
        bytes32 h0 = keccak256(abi.encode(_orderForRound(0)));
        bytes32 h1 = keccak256(abi.encode(_orderForRound(1)));
        bytes32 h2 = keccak256(abi.encode(_orderForRound(2)));

        assertTrue(h0 != h1, "round 1 must not collide with round 0");
        assertTrue(h1 != h2, "round 2 must not collide with round 1");
        assertTrue(h0 != h2, "round 2 must not collide with round 0");

        // The program is untouched by the counter: the gate still runs before the curve,
        // which is the only thing about the order that carries meaning.
        bytes memory program = bytes.concat(GlasshouseAuction.build(BOOK, MAX_BPS), XYCSwap.build());
        ISwapVM.Order memory r7 = _orderForRound(7);
        bool found;
        for (uint256 i = 0; i + program.length <= r7.data.length; i++) {
            bool same = true;
            for (uint256 j; j < program.length; j++) {
                if (r7.data[i + j] != program[j]) { same = false; break; }
            }
            if (same) { found = true; break; }
        }
        assertTrue(found, "the program must survive the round counter unchanged");
    }

    /// @dev The live order, with a round counter in the hook data the Book ignores.
    function _orderForRound(uint32 round) internal pure returns (ISwapVM.Order memory) {
        return MakerTraitsLib.build(
            MakerTraitsLib.Args({
                maker: MAKER,
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
                postTransferInTarget: BOOK,
                postTransferInData: abi.encodePacked(round),
                preTransferOutTarget: address(0),
                preTransferOutData: "",
                postTransferOutTarget: address(0),
                postTransferOutData: "",
                program: bytes.concat(GlasshouseAuction.build(BOOK, MAX_BPS), XYCSwap.build())
            })
        );
    }

    /// @dev The live runner is TypeScript and must build taker data for an ephemeral
    ///      winner whose address does not exist until run time. Re-implementing upstream's
    ///      bit packing in TS is exactly how you produce an unfillable order, so instead
    ///      the runner splices the address into a fixed prefix. That is only safe if the
    ///      encoding really does differ in nothing but those 20 bytes, which is what this
    ///      pins. If upstream's TakerTraitsLib ever changes shape, this fails and the
    ///      runner must be revisited rather than quietly shipping a malformed fill.
    function test_Preflight_TakerDataDiffersOnlyInTheRecipient() public pure {
        address a = address(0xA1);
        address b = address(0xB2);

        bytes memory da = _takerData(a);
        bytes memory db = _takerData(b);
        assertEq(da.length, db.length, "same length for any recipient");

        // Everything before the trailing 20 bytes must be byte-identical.
        uint256 cut = da.length - 20;
        for (uint256 i; i < cut; i++) {
            assertEq(da[i], db[i], "taker data differs outside the recipient");
        }
        // And the trailing 20 bytes must be exactly the recipient.
        for (uint256 i; i < 20; i++) {
            assertEq(uint8(da[cut + i]), uint8(bytes20(a)[i]), "recipient not in the last 20 bytes");
            assertEq(uint8(db[cut + i]), uint8(bytes20(b)[i]), "recipient not in the last 20 bytes");
        }

        console.log("   takerData length   %s", da.length);
        console.log("   splice prefix      %s", vm.toString(_slice(da, 0, cut)));
    }

    function _slice(bytes memory b, uint256 start, uint256 len) internal pure returns (bytes memory out) {
        out = new bytes(len);
        for (uint256 i; i < len; i++) out[i] = b[start + i];
    }

    /// @dev What the winner is buying: the same order, filled by anyone else inside the
    ///      exclusive window, reverts. This is the property the mainnet run has to show,
    ///      and the first attempt could not show it because there was no order.
    function test_Preflight_OutsiderIsExcludedInsideTheWindow() public onlyForked {
        ISwapVM.Order memory order = _order();

        address[] memory tokens = new address[](2);
        tokens[0] = WETH;
        tokens[1] = USDC;
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = BALANCE_WETH;
        amounts[1] = BALANCE_USDC;

        vm.prank(MAKER);
        bytes32 orderHash = IAqua(AQUA).ship(ROUTER, abi.encode(order), tokens, amounts);

        vm.prank(MAKER);
        book.open(orderHash, ROUTER, WETH, COMMIT_BLOCKS, REVEAL_BLOCKS, EXCLUSIVE_BLOCKS, RESERVE_BPS, MAX_BPS, 0);
        GlasshouseBook.Auction memory a = book.auctions(MAKER, orderHash);

        bytes32 saltW = keccak256("winner salt, per bidder, not shared");
        bytes32 cw = book.commitmentFor(winner, WINNING_BID, saltW);
        vm.prank(winner);
        book.commit(MAKER, orderHash, cw);

        vm.roll(uint256(a.commitEnd) + 1);
        vm.prank(winner);
        book.reveal(MAKER, orderHash, WINNING_BID, saltW);
        vm.roll(uint256(a.revealEnd) + 1);

        // An outsider holds the tokens and the approval, and still cannot fill.
        vm.deal(rival, 0.01 ether);
        vm.startPrank(rival);
        IWETH(WETH).deposit{ value: SWAP_AMOUNT }();
        IERC20(WETH).approve(ROUTER, type(uint256).max);
        vm.expectRevert();
        router.swap(order, SWAP_AMOUNT, _takerData(rival));
        vm.stopPrank();
    }
}
