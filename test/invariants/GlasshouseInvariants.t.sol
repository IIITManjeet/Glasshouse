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
import { GlasshouseBookV2 } from "../../src/book/GlasshouseBookV2.sol";
import { IGlasshouseBook } from "../../src/interfaces/IGlasshouseBook.sol";
import { OpenParams } from "../../src/interfaces/IGlasshouseBookV2.sol";
import { GlasshouseTestRouter } from "../helpers/GlasshouseTestRouter.sol";

/// @title GlasshouseInvariantsBase
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
///
/// @dev Parameterised over the Book: {GlasshouseInvariants} runs it against v1 and
///      {GlasshouseInvariantsV2} against v2. The gate reads only `IGlasshouseBook.outcome`,
///      so it does not know which Book it is talking to and must not care
///      (`docs/design/v2.md` §3.9). Only opening, committing and revealing differ.
abstract contract GlasshouseInvariantsBase is Test, CoreInvariants {
    GlasshouseTestRouter internal swapVM;
    address internal book;
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

        book = _deployBook();
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
            GlasshouseAuction.build(book, MAX_BPS),
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
        uint40 commitEnd;
        (commitEnd, revealEnd) = _openAuction(orderHash);

        _commit(address(this), orderHash, keccak256(abi.encodePacked(address(this), WINNING_BID, bytes32("s"))));
        _commit(rival, orderHash, keccak256(abi.encodePacked(rival, RIVAL_BID, bytes32("s"))));

        vm.roll(commitEnd + 1);
        _reveal(address(this), orderHash, WINNING_BID, bytes32("s"));
        _reveal(rival, orderHash, RIVAL_BID, bytes32("s"));
    }

    // --- the Book-specific part ------------------------------------------------

    function _deployBook() internal virtual returns (address);

    /// @dev Opens as `maker`, unbonded, with the deployed parameters.
    function _openAuction(bytes32 orderHash) internal virtual returns (uint40 commitEnd, uint40 revealEnd_);

    /// @dev Commits from `who`; `address(this)` needs no prank.
    function _commit(address who, bytes32 orderHash, bytes32 commitment) internal virtual;

    function _reveal(address who, bytes32 orderHash, uint24 bps, bytes32 salt) internal virtual;

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

        assertEq(IGlasshouseBook(book).outcome(maker, swapVM.hash(order)).clearingBps, RIVAL_BID, "clearing is the second bid");

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

/// @title GlasshouseInvariants
/// @notice The seven upstream invariants over the gate, against the v1 Book deployed on
///         Base.
contract GlasshouseInvariants is GlasshouseInvariantsBase {
    function _deployBook() internal override returns (address) {
        return address(new GlasshouseBook());
    }

    function _openAuction(bytes32 orderHash) internal override returns (uint40, uint40) {
        vm.prank(maker);
        GlasshouseBook(book).open(
            orderHash, address(swapVM), address(tokenA), COMMIT_BLOCKS, REVEAL_BLOCKS, EXCLUSIVE_BLOCKS, RESERVE_BPS, MAX_BPS, 0
        );
        GlasshouseBook.Auction memory a = GlasshouseBook(book).auctions(maker, orderHash);
        return (a.commitEnd, a.revealEnd);
    }

    function _commit(address who, bytes32 orderHash, bytes32 commitment) internal override {
        if (who != address(this)) vm.prank(who);
        GlasshouseBook(book).commit(maker, orderHash, commitment);
    }

    function _reveal(address who, bytes32 orderHash, uint24 bps, bytes32 salt) internal override {
        if (who != address(this)) vm.prank(who);
        GlasshouseBook(book).reveal(maker, orderHash, bps, salt);
    }
}

/// @title GlasshouseInvariantsV2
/// @notice The same seven invariants, the same program, the same router, against the v2
///         Book opened with v1-shaped arguments. If the gate priced differently here, the
///         v2 Book would have changed `outcome()`, which I-1 says it must not.
contract GlasshouseInvariantsV2 is GlasshouseInvariantsBase {
    bytes32[] internal noProof;

    function _deployBook() internal override returns (address) {
        return address(new GlasshouseBookV2(bytes32(0), address(0)));
    }

    function _openAuction(bytes32 orderHash) internal override returns (uint40, uint40) {
        OpenParams memory p = OpenParams({
            router: address(swapVM),
            commitBlocks: COMMIT_BLOCKS,
            revealBlocks: REVEAL_BLOCKS,
            tokenIn: address(tokenA),
            exclusiveBlocks: EXCLUSIVE_BLOCKS,
            reserveBps: RESERVE_BPS,
            maxBps: MAX_BPS,
            bond: 0,
            makerBond: 0,
            offerToken: address(0),
            tlockRound: 0,
            minOffer: 0
        });
        vm.prank(maker);
        GlasshouseBookV2(book).open(orderHash, p, noProof);
        GlasshouseBookV2.Auction memory a = GlasshouseBookV2(book).auctions(maker, orderHash);
        return (a.commitEnd, a.revealEnd);
    }

    function _commit(address who, bytes32 orderHash, bytes32 commitment) internal override {
        if (who != address(this)) vm.prank(who);
        GlasshouseBookV2(book).commit(maker, orderHash, commitment, "", noProof);
    }

    /// @dev The rival's bid is opened by a stranger through `revealFor`, which must make
    ///      no difference to anything the gate sees.
    function _reveal(address who, bytes32 orderHash, uint24 bps, bytes32 salt) internal override {
        if (who == address(this)) {
            GlasshouseBookV2(book).reveal(maker, orderHash, bps, salt);
        } else {
            vm.prank(address(0x57A2));
            GlasshouseBookV2(book).revealFor(maker, orderHash, who, bps, salt);
        }
    }
}
