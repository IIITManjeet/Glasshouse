// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Test, Vm } from "forge-std/Test.sol";

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

import { GlasshouseBookV2 } from "../src/book/GlasshouseBookV2.sol";
import { IGlasshouseBookV2, OpenParams, QueuedRound } from "../src/interfaces/IGlasshouseBookV2.sol";
import { Outcome, AuctionStatus } from "../src/interfaces/IGlasshouseBook.sol";
import { MockAqua } from "./helpers/MockAqua.sol";

contract V2Token is ERC20 {
    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) { }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) external {
        _burn(from, amount);
    }
}

/// @notice OpenZeppelin `StandardMerkleTree`-compatible leaves and sorted-pair hashing,
///         so a proof built here verifies under `MerkleProof.verify` exactly as a proof
///         from the site's OpenZeppelin merkle-tree package would. The tree shape (pairwise
///         layers, odd node promoted) differs from `StandardMerkleTree`'s; the Book only
///         checks proofs, never shapes.
library TestMerkle {
    function leaf(address who) internal pure returns (bytes32) {
        return keccak256(bytes.concat(keccak256(abi.encode(who))));
    }

    function hashPair(bytes32 a, bytes32 b) internal pure returns (bytes32) {
        return a < b ? keccak256(abi.encode(a, b)) : keccak256(abi.encode(b, a));
    }

    function root(bytes32[] memory leaves) internal pure returns (bytes32) {
        bytes32[] memory layer = leaves;
        while (layer.length > 1) layer = _up(layer);
        return layer[0];
    }

    function proof(bytes32[] memory leaves, uint256 index) internal pure returns (bytes32[] memory out) {
        bytes32[] memory tmp = new bytes32[](8);
        uint256 n;
        bytes32[] memory layer = leaves;
        while (layer.length > 1) {
            uint256 sibling = index ^ 1;
            if (sibling < layer.length) tmp[n++] = layer[sibling];
            layer = _up(layer);
            index /= 2;
        }
        out = new bytes32[](n);
        for (uint256 i; i < n; ++i) out[i] = tmp[i];
    }

    function _up(bytes32[] memory layer) private pure returns (bytes32[] memory next) {
        next = new bytes32[]((layer.length + 1) / 2);
        for (uint256 i; i < next.length; ++i) {
            next[i] = 2 * i + 1 < layer.length ? hashPair(layer[2 * i], layer[2 * i + 1]) : layer[2 * i];
        }
    }
}

/// @notice Shared fixture: a public v2 Book over a mock Aqua, a bond token and an offer
///         token. Helpers open with v1-shaped arguments by default (`makerBond = 0`,
///         `tlockRound = 0`, empty proof), which is what the copied v1 suite runs on.
abstract contract BookV2Fixture is Test {
    GlasshouseBookV2 internal book;
    V2Token internal token; // tokenIn: bonds, maker bonds, tips
    V2Token internal offer; // offerToken: what the maker promises
    MockAqua internal aqua;

    address internal constant MAKER = address(0xAAAA);
    address internal constant ROUTER = address(0x120073);
    address internal constant STRANGER = address(0x57A2);
    bytes32 internal constant ORDER = keccak256("order-1");

    uint40 internal constant COMMIT_BLOCKS = 10;
    uint40 internal constant REVEAL_BLOCKS = 10;
    uint40 internal constant EXCLUSIVE_BLOCKS = 5;
    uint24 internal constant RESERVE_BPS = 10;
    uint24 internal constant MAX_BPS = 500;
    uint128 internal constant BOND = 1 ether;
    uint128 internal constant MAKER_BOND = 3 ether;
    uint128 internal constant MIN_OFFER = 50 ether;
    uint64 internal constant TLOCK_ROUND = 32_226_011;

    bytes32[] internal noProof;

    function setUp() public virtual {
        aqua = new MockAqua();
        book = new GlasshouseBookV2(bytes32(0), address(aqua));
        token = new V2Token("Bond", "BOND");
        offer = new V2Token("Offer", "OFR");
        _fundMaker(MAKER);
        vm.roll(1000);
    }

    // --- helpers ---------------------------------------------------------------

    function _fundMaker(address maker) internal {
        token.mint(maker, 1000 ether);
        vm.prank(maker);
        token.approve(address(book), type(uint256).max);
    }

    function _params() internal view returns (OpenParams memory p) {
        p = OpenParams({
            router: ROUTER,
            commitBlocks: COMMIT_BLOCKS,
            revealBlocks: REVEAL_BLOCKS,
            tokenIn: address(token),
            exclusiveBlocks: EXCLUSIVE_BLOCKS,
            reserveBps: RESERVE_BPS,
            maxBps: MAX_BPS,
            bond: BOND,
            makerBond: 0,
            offerToken: address(0),
            tlockRound: 0,
            minOffer: 0
        });
    }

    function _bondedParams() internal view returns (OpenParams memory p) {
        p = _params();
        p.makerBond = MAKER_BOND;
        p.offerToken = address(offer);
        p.minOffer = MIN_OFFER;
    }

    function _openWith(address maker, bytes32 orderHash, OpenParams memory p) internal returns (uint40 commitEnd, uint40 revealEnd) {
        vm.prank(maker);
        book.open(orderHash, p, noProof);
        GlasshouseBookV2.Auction memory a = book.auctions(maker, orderHash);
        return (a.commitEnd, a.revealEnd);
    }

    function _open() internal returns (uint40 commitEnd, uint40 revealEnd) {
        return _openWith(MAKER, ORDER, _params());
    }

    /// @dev Ships `orderHash` under the router for `maker` with `declared` of the offer
    ///      token, and backs it with a real wallet balance and allowance to Aqua.
    function _ship(address maker, bytes32 orderHash, uint256 declared) internal {
        address[] memory tokens = new address[](2);
        tokens[0] = address(offer);
        tokens[1] = address(token);
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = declared;
        vm.prank(maker);
        aqua.shipHash(ROUTER, orderHash, tokens, amounts);
        offer.mint(maker, declared);
        vm.prank(maker);
        offer.approve(address(aqua), type(uint256).max);
    }

    function _dock(address maker, bytes32 orderHash) internal {
        address[] memory tokens = new address[](2);
        tokens[0] = address(offer);
        tokens[1] = address(token);
        vm.prank(maker);
        aqua.dock(ROUTER, orderHash, tokens);
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
        _commitOn(MAKER, ORDER, who, bps, salt);
    }

    function _commitOn(address maker, bytes32 orderHash, address who, uint24 bps, bytes32 salt) internal {
        vm.prank(who);
        book.commit(maker, orderHash, _commitment(who, bps, salt), "", noProof);
    }

    function _reveal(address who, uint24 bps, bytes32 salt) internal {
        vm.prank(who);
        book.reveal(MAKER, ORDER, bps, salt);
    }

    function _fill(address taker) internal {
        vm.prank(ROUTER);
        book.postTransferIn(MAKER, taker, address(0), address(0), 1, 1, 0, ORDER, "", "");
    }
}

/// @title GlasshouseBookV2V1SuiteTest
/// @notice Every test in `test/GlasshouseBook.t.sol`, re-run against the v2 Book with
///         v1-shaped arguments: `makerBond = 0`, `tlockRound = 0`, empty proof. Copied,
///         not shared, so both suites stay readable on their own. Where v2 changed an
///         event, the assertion follows the v2 event; nothing else differs.
contract GlasshouseBookV2V1SuiteTest is BookV2Fixture {
    function testFuzz_CommitmentForMatchesWhatRevealChecks(address who, uint24 bps, bytes32 salt) public view {
        assertEq(book.commitmentFor(who, bps, salt), _commitment(who, bps, salt), "helper disagrees with reveal");
    }

    function test_CommitmentFor_IsAcceptedByReveal() public {
        (uint40 commitEnd,) = _open();
        address a = _bidder(1);

        bytes32 commitment = book.commitmentFor(a, 123, bytes32("salt"));
        vm.prank(a);
        book.commit(MAKER, ORDER, commitment, "", noProof);

        vm.roll(commitEnd + 1);
        vm.prank(a);
        book.reveal(MAKER, ORDER, 123, bytes32("salt"));

        assertTrue(book.bids(MAKER, ORDER, a).revealed, "helper-built commitment must reveal");
    }

    // --- open ------------------------------------------------------------------

    function test_Open_SetsImmutableParameters() public {
        (uint40 commitEnd, uint40 revealEnd) = _open();
        assertEq(commitEnd, uint40(block.number) + COMMIT_BLOCKS, "commitEnd");
        assertEq(revealEnd, commitEnd + REVEAL_BLOCKS, "revealEnd");

        GlasshouseBookV2.Auction memory a = book.auctions(MAKER, ORDER);
        assertEq(a.router, ROUTER, "router");
        assertEq(a.tokenIn, address(token), "tokenIn");
        assertEq(a.reserveBps, RESERVE_BPS, "reserve");
        assertEq(a.maxBps, MAX_BPS, "max");
        assertEq(a.bond, BOND, "bond");
    }

    function test_Open_IsNamespacedByMaker() public {
        _open();
        address other = address(0xBBBB);
        vm.prank(other);
        book.open(ORDER, _params(), noProof);

        assertTrue(book.key(MAKER, ORDER) != book.key(other, ORDER), "keys collide");
    }

    function test_Open_RevertsOnReopen() public {
        _open();
        OpenParams memory p = _params();
        vm.prank(MAKER);
        vm.expectRevert(IGlasshouseBookV2.AlreadyOpened.selector);
        book.open(ORDER, p, noProof);
    }

    function test_Open_RevertsOnZeroCommitOrRevealWindow() public {
        OpenParams memory p = _params();
        p.commitBlocks = 0;
        vm.startPrank(MAKER);
        vm.expectRevert(IGlasshouseBookV2.BadWindow.selector);
        book.open(ORDER, p, noProof);

        p = _params();
        p.revealBlocks = 0;
        vm.expectRevert(IGlasshouseBookV2.BadWindow.selector);
        book.open(ORDER, p, noProof);
        vm.stopPrank();
    }

    function test_Open_RevertsOnZeroExclusiveWindow() public {
        OpenParams memory p = _params();
        p.exclusiveBlocks = 0;
        vm.prank(MAKER);
        vm.expectRevert(IGlasshouseBookV2.BadWindow.selector);
        book.open(ORDER, p, noProof);
    }

    function test_Open_RevertsWhenReserveExceedsMax() public {
        OpenParams memory p = _params();
        p.reserveBps = 600;
        p.maxBps = 500;
        vm.prank(MAKER);
        vm.expectRevert(IGlasshouseBookV2.BadWindow.selector);
        book.open(ORDER, p, noProof);
    }

    function test_Open_RevertsWhenMaxIsNotBelowFullBps() public {
        OpenParams memory p = _params();
        p.reserveBps = 0;
        p.maxBps = 10_000;
        vm.prank(MAKER);
        vm.expectRevert(IGlasshouseBookV2.BadWindow.selector);
        book.open(ORDER, p, noProof);
    }

    // --- commit ----------------------------------------------------------------

    function test_Commit_RevertsWhenNotOpened() public {
        address a = _bidder(1);
        vm.prank(a);
        vm.expectRevert(IGlasshouseBookV2.NotOpened.selector);
        book.commit(MAKER, ORDER, bytes32(uint256(1)), "", noProof);
    }

    function test_Commit_RevertsAfterCommitEnd() public {
        (uint40 commitEnd,) = _open();
        address a = _bidder(1);
        vm.roll(commitEnd + 1);
        vm.prank(a);
        vm.expectRevert(IGlasshouseBookV2.CommitClosed.selector);
        book.commit(MAKER, ORDER, bytes32(uint256(1)), "", noProof);
    }

    function test_Commit_RevertsOnSecondCommitFromSameBidder() public {
        _open();
        address a = _bidder(1);
        _commit(a, 100, "s");
        vm.prank(a);
        vm.expectRevert(IGlasshouseBookV2.AlreadyCommitted.selector);
        book.commit(MAKER, ORDER, bytes32(uint256(2)), "", noProof);
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
        vm.expectRevert(IGlasshouseBookV2.RevealNotOpen.selector);
        book.reveal(MAKER, ORDER, 100, "s");
    }

    function test_Reveal_RevertsAfterRevealEnd() public {
        (, uint40 revealEnd) = _open();
        address a = _bidder(1);
        _commit(a, 100, "s");
        vm.roll(revealEnd + 1);
        vm.prank(a);
        vm.expectRevert(IGlasshouseBookV2.RevealClosed.selector);
        book.reveal(MAKER, ORDER, 100, "s");
    }

    function test_Reveal_RevertsWithoutCommitment() public {
        (uint40 commitEnd,) = _open();
        address a = _bidder(1);
        vm.roll(commitEnd + 1);
        vm.prank(a);
        vm.expectRevert(IGlasshouseBookV2.NoCommitment.selector);
        book.reveal(MAKER, ORDER, 100, "s");
    }

    function test_Reveal_RevertsOnWrongSalt() public {
        (uint40 commitEnd,) = _open();
        address a = _bidder(1);
        _commit(a, 100, "right");
        vm.roll(commitEnd + 1);
        vm.prank(a);
        vm.expectRevert(IGlasshouseBookV2.BadReveal.selector);
        book.reveal(MAKER, ORDER, 100, "wrong");
    }

    function test_Reveal_CommitmentIsBoundToBidder() public {
        (uint40 commitEnd,) = _open();
        address a = _bidder(1);
        address b = _bidder(2);

        vm.prank(b);
        book.commit(MAKER, ORDER, _commitment(a, 100, "s"), "", noProof); // b copies a's commitment

        vm.roll(commitEnd + 1);
        vm.prank(b);
        vm.expectRevert(IGlasshouseBookV2.BadReveal.selector);
        book.reveal(MAKER, ORDER, 100, "s");
    }

    function test_Reveal_RevertsOnDoubleReveal() public {
        (uint40 commitEnd,) = _open();
        address a = _bidder(1);
        _commit(a, 100, "s");
        vm.roll(commitEnd + 1);
        _reveal(a, 100, "s");
        vm.prank(a);
        vm.expectRevert(IGlasshouseBookV2.AlreadyRevealed.selector);
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
        vm.expectRevert(abi.encodeWithSelector(IGlasshouseBookV2.BidOutOfRange.selector, RESERVE_BPS - 1, RESERVE_BPS, MAX_BPS));
        book.reveal(MAKER, ORDER, RESERVE_BPS - 1, "s");

        vm.prank(b);
        vm.expectRevert(abi.encodeWithSelector(IGlasshouseBookV2.BidOutOfRange.selector, MAX_BPS + 1, RESERVE_BPS, MAX_BPS));
        book.reveal(MAKER, ORDER, MAX_BPS + 1, "s");
    }

    function test_Commit_EscrowsBond() public {
        _open();
        address a = _bidder(1);

        uint256 before = token.balanceOf(a);
        _commit(a, 100, "s");
        assertEq(before - token.balanceOf(a), BOND, "bond not taken at commit");
        assertEq(token.balanceOf(address(book)), BOND, "bond not escrowed");
    }

    function test_Reveal_TakesNoFurtherBond() public {
        (uint40 commitEnd,) = _open();
        address a = _bidder(1);
        _commit(a, 100, "s");
        vm.roll(commitEnd + 1);

        uint256 before = token.balanceOf(a);
        _reveal(a, 100, "s");
        assertEq(token.balanceOf(a), before, "reveal must not charge again");
        assertEq(token.balanceOf(address(book)), BOND, "escrow unchanged");
    }

    // --- phases ----------------------------------------------------------------

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

    function test_Clearing_ZeroReserveZeroBid_StillHasAWinner() public {
        OpenParams memory p = _params();
        p.reserveBps = 0;
        (uint40 commitEnd, uint40 revealEnd) = _openWith(MAKER, ORDER, p);

        address one = _bidder(1);
        _commit(one, 0, "s");
        vm.roll(commitEnd + 1);
        _reveal(one, 0, "s");
        vm.roll(revealEnd + 1);

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

    function testFuzz_TopTwo_MatchesReferenceScan(uint256 seed, uint8 rawCount) public {
        uint256 n = 2 + (uint256(rawCount) % 7); // 2..8 bidders

        address[] memory who = new address[](n);
        uint24[] memory bps = new uint24[](n);

        (uint40 commitEnd, uint40 revealEnd) = _open();

        for (uint256 i; i < n; i++) {
            who[i] = _bidder(i + 1);
            bps[i] = uint24(RESERVE_BPS + (uint256(keccak256(abi.encode(seed, i))) % (MAX_BPS - RESERVE_BPS + 1)));
            _commit(who[i], bps[i], "s");
        }

        vm.roll(commitEnd + 1);

        uint256 offset = uint256(keccak256(abi.encode(seed, "order"))) % n;
        for (uint256 i; i < n; i++) {
            uint256 j = (i + offset) % n;
            _reveal(who[j], bps[j], "s");
        }

        vm.roll(revealEnd + 1);

        uint256 bestI = 0;
        for (uint256 i = 1; i < n; i++) {
            if (bps[i] > bps[bestI]) bestI = i;
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
        vm.expectRevert(IGlasshouseBookV2.NotRouter.selector);
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
        vm.expectRevert(IGlasshouseBookV2.WindowNotElapsed.selector);
        book.settle(MAKER, ORDER);
    }

    function test_Settle_WinnerFilled_NoForfeit_AndEveryoneReclaims() public {
        (address a, address b, uint40 revealEnd) = _runToSettlement(300, 200);

        _fill(a);

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

    function test_Settle_NoFillRecorded_DoesNotForfeitTheWinner() public {
        (address a, address b, uint40 revealEnd) = _runToSettlement(300, 200);

        vm.roll(revealEnd + EXCLUSIVE_BLOCKS + 1);
        book.settle(MAKER, ORDER);
        assertFalse(book.auctions(MAKER, ORDER).winnerForfeited, "silence is not evidence");

        vm.prank(MAKER);
        vm.expectRevert(IGlasshouseBookV2.NothingToClaim.selector);
        book.claimForfeit(ORDER);

        uint256 beforeA = token.balanceOf(a);
        vm.prank(a);
        book.claimBond(MAKER, ORDER);
        assertEq(token.balanceOf(a) - beforeA, BOND, "winner keeps its bond");

        uint256 beforeB = token.balanceOf(b);
        vm.prank(b);
        book.claimBond(MAKER, ORDER);
        assertEq(token.balanceOf(b) - beforeB, BOND, "loser keeps its bond");
    }

    function test_Settle_MakerCannotForgeAForfeitByMisconfiguringTheRouter() public {
        OpenParams memory p = _params();
        p.router = address(0xDEAD);
        (uint40 commitEnd, uint40 revealEnd) = _openWith(MAKER, ORDER, p);

        address a = _bidder(1);
        _commit(a, 300, "s");
        vm.roll(commitEnd + 1);
        _reveal(a, 300, "s");
        vm.roll(revealEnd + EXCLUSIVE_BLOCKS + 1);

        book.settle(MAKER, ORDER);
        assertFalse(book.auctions(MAKER, ORDER).winnerForfeited, "misconfiguration is not a no-show");

        uint256 beforeA = token.balanceOf(a);
        vm.prank(a);
        book.claimBond(MAKER, ORDER);
        assertEq(token.balanceOf(a) - beforeA, BOND, "bidder made whole");
    }

    function test_Settle_SomeoneElseFilled_WinnerForfeitsToMaker() public {
        (address a, address b, uint40 revealEnd) = _runToSettlement(300, 200);

        _fill(b);

        vm.roll(revealEnd + EXCLUSIVE_BLOCKS + 1);
        book.settle(MAKER, ORDER);
        assertTrue(book.auctions(MAKER, ORDER).winnerForfeited, "evidenced no-show must forfeit");

        vm.prank(a);
        vm.expectRevert(IGlasshouseBookV2.NothingToClaim.selector);
        book.claimBond(MAKER, ORDER);

        uint256 beforeMaker = token.balanceOf(MAKER);
        vm.prank(MAKER);
        book.claimForfeit(ORDER);
        assertEq(token.balanceOf(MAKER) - beforeMaker, BOND, "forfeit to maker");

        uint256 beforeB = token.balanceOf(b);
        vm.prank(b);
        book.claimBond(MAKER, ORDER);
        assertEq(token.balanceOf(b) - beforeB, BOND, "honest bidder still whole");
    }

    function test_ClaimUnrevealed_SilenceCostsTheBond() public {
        (uint40 commitEnd, uint40 revealEnd) = _open();
        address a = _bidder(1);
        address b = _bidder(2);
        _commit(a, 300, "s");
        _commit(b, 250, "s");

        vm.roll(commitEnd + 1);
        _reveal(a, 300, "s"); // b stays silent
        vm.roll(revealEnd + 1);

        assertEq(book.outcome(MAKER, ORDER).clearingBps, RESERVE_BPS, "silence drops the price");

        vm.roll(revealEnd + EXCLUSIVE_BLOCKS + 1);
        book.settle(MAKER, ORDER);

        uint256 beforeMaker = token.balanceOf(MAKER);
        vm.prank(MAKER);
        book.claimUnrevealed(ORDER, b);
        assertEq(token.balanceOf(MAKER) - beforeMaker, BOND, "silent bidder forfeits");

        vm.prank(b);
        vm.expectRevert(IGlasshouseBookV2.NothingToClaim.selector);
        book.claimBond(MAKER, ORDER);
    }

    function test_ClaimUnrevealed_DoesNotTouchAnHonestBidder() public {
        (address a,, uint40 revealEnd) = _runToSettlement(300, 200);
        vm.roll(revealEnd + EXCLUSIVE_BLOCKS + 1);
        book.settle(MAKER, ORDER);

        vm.prank(MAKER);
        vm.expectRevert(IGlasshouseBookV2.NothingToClaim.selector);
        book.claimUnrevealed(ORDER, a);
    }

    function test_Settle_FilledBySomeoneElse_StillForfeits() public {
        (address a,, uint40 revealEnd) = _runToSettlement(300, 200);

        _fill(address(0xE15E));

        vm.roll(revealEnd + EXCLUSIVE_BLOCKS + 1);
        book.settle(MAKER, ORDER);
        assertTrue(book.auctions(MAKER, ORDER).winnerForfeited, "filled by non-winner");
        assertTrue(a != address(0xE15E), "sanity");
    }

    function test_Settle_RevertsOnSecondSettle() public {
        (,, uint40 revealEnd) = _runToSettlement(300, 200);
        vm.roll(revealEnd + EXCLUSIVE_BLOCKS + 1);
        book.settle(MAKER, ORDER);
        vm.expectRevert(IGlasshouseBookV2.AlreadySettled.selector);
        book.settle(MAKER, ORDER);
    }

    function test_ClaimBond_RevertsBeforeSettlement() public {
        (address a,,) = _runToSettlement(300, 200);
        vm.prank(a);
        vm.expectRevert(IGlasshouseBookV2.NotSettled.selector);
        book.claimBond(MAKER, ORDER);
    }

    function test_ClaimBond_RevertsOnDoubleClaim() public {
        (address a,, uint40 revealEnd) = _runToSettlement(300, 200);
        _fill(a);
        vm.roll(revealEnd + EXCLUSIVE_BLOCKS + 1);
        book.settle(MAKER, ORDER);

        vm.startPrank(a);
        book.claimBond(MAKER, ORDER);
        vm.expectRevert(IGlasshouseBookV2.NothingToClaim.selector);
        book.claimBond(MAKER, ORDER);
        vm.stopPrank();
    }

    function test_ClaimForfeit_RevertsWhenWinnerDidFill() public {
        (address a,, uint40 revealEnd) = _runToSettlement(300, 200);
        _fill(a);
        vm.roll(revealEnd + EXCLUSIVE_BLOCKS + 1);
        book.settle(MAKER, ORDER);

        vm.prank(MAKER);
        vm.expectRevert(IGlasshouseBookV2.NothingToClaim.selector);
        book.claimForfeit(ORDER);
    }

    function test_Escrow_IsFullyDrainedAfterAllClaims() public {
        (address a, address b, uint40 revealEnd) = _runToSettlement(300, 200);
        assertEq(token.balanceOf(address(book)), 2 * BOND, "two bonds escrowed");

        _fill(b);

        vm.roll(revealEnd + EXCLUSIVE_BLOCKS + 1);
        book.settle(MAKER, ORDER);

        vm.prank(MAKER);
        book.claimForfeit(ORDER); // a won, b filled: a forfeits
        vm.prank(b);
        book.claimBond(MAKER, ORDER);

        assertEq(token.balanceOf(address(book)), 0, "escrow not fully drained");
        assertTrue(a != b, "sanity");
    }
}

/// @title GlasshouseBookV2Test
/// @notice What v2 adds, per `docs/design/v2.md` §3.9: `revealFor`, the timelock
///         ciphertext, the maker bond and its offer check, the invite root, the queue.
///
/// The properties, in order of how much they matter:
///   1. A maker bond is slashed only on positive evidence, read from Aqua and the offer
///      token, inside the winner's window. Never outside it, never without a winner.
///   2. When it is slashed, the winner gets it and the unrevealed forfeits; the maker
///      gets neither.
///   3. Who reveals a bid changes nothing about the result.
///   4. A queue opens only what the maker funded, in the maker's order, when allowed.
contract GlasshouseBookV2Test is BookV2Fixture {
    // --- revealFor -----------------------------------------------------------------

    /// @dev A stranger opening a bid produces exactly the state the bidder would have,
    ///      and the event says who did it.
    function test_RevealFor_ByAStranger_SameResultAndRecordsWhoRevealed() public {
        (uint40 commitEnd, uint40 revealEnd) = _open();
        address a = _bidder(1);
        address b = _bidder(2);
        _commit(a, 300, "sa");
        _commit(b, 200, "sb");
        vm.roll(commitEnd + 1);

        vm.expectEmit(address(book));
        emit IGlasshouseBookV2.BidRevealed(MAKER, ORDER, a, 300, STRANGER);
        vm.prank(STRANGER);
        book.revealFor(MAKER, ORDER, a, 300, "sa");

        vm.expectEmit(address(book));
        emit IGlasshouseBookV2.BidRevealed(MAKER, ORDER, b, 200, b);
        _reveal(b, 200, "sb");

        assertTrue(book.bids(MAKER, ORDER, a).revealed, "a revealed");
        assertFalse(book.bids(MAKER, ORDER, STRANGER).revealed, "the stranger has no bid");

        vm.roll(revealEnd + 1);
        Outcome memory o = book.outcome(MAKER, ORDER);
        assertEq(o.winner, a, "winner is the bidder, not the revealer");
        assertEq(o.clearingBps, 200, "second price");
    }

    /// @dev The commitment binds the bidder's address, so naming the wrong bidder with
    ///      someone else's plaintext opens nothing.
    function test_RevealFor_WrongBidderReverts() public {
        (uint40 commitEnd,) = _open();
        address a = _bidder(1);
        address b = _bidder(2);
        _commit(a, 300, "s");
        _commit(b, 200, "s");
        vm.roll(commitEnd + 1);

        vm.prank(STRANGER);
        vm.expectRevert(IGlasshouseBookV2.BadReveal.selector);
        book.revealFor(MAKER, ORDER, b, 300, "s"); // a's plaintext, b's name
    }

    function test_RevealFor_BeforeCommitEndReverts() public {
        (uint40 commitEnd,) = _open();
        address a = _bidder(1);
        _commit(a, 300, "s");
        vm.roll(commitEnd);

        vm.prank(STRANGER);
        vm.expectRevert(IGlasshouseBookV2.RevealNotOpen.selector);
        book.revealFor(MAKER, ORDER, a, 300, "s");
    }

    function test_RevealFor_AfterRevealEndReverts() public {
        (, uint40 revealEnd) = _open();
        address a = _bidder(1);
        _commit(a, 300, "s");
        vm.roll(revealEnd + 1);

        vm.prank(STRANGER);
        vm.expectRevert(IGlasshouseBookV2.RevealClosed.selector);
        book.revealFor(MAKER, ORDER, a, 300, "s");
    }

    function test_RevealFor_ThenSelfRevealReverts() public {
        (uint40 commitEnd,) = _open();
        address a = _bidder(1);
        _commit(a, 300, "s");
        vm.roll(commitEnd + 1);

        vm.prank(STRANGER);
        book.revealFor(MAKER, ORDER, a, 300, "s");
        vm.expectRevert(IGlasshouseBookV2.AlreadyRevealed.selector);
        _reveal(a, 300, "s");
    }

    /// @dev I-9. For any set of bids, any reveal order and any assignment of who reveals
    ///      each one, the result equals the self-revealed, commit-ordered run and the
    ///      naive reference scan.
    function testFuzz_RevealSource_DoesNotChangeTheOutcome(uint256 seed, uint8 rawCount, uint256 sourceMask) public {
        uint256 n = 2 + (uint256(rawCount) % 7); // 2..8 bidders
        address[] memory who = new address[](n);
        uint24[] memory bps = new uint24[](n);

        (uint40 commitEnd, uint40 revealEnd) = _open();
        for (uint256 i; i < n; i++) {
            who[i] = _bidder(i + 1);
            bps[i] = uint24(RESERVE_BPS + (uint256(keccak256(abi.encode(seed, i))) % (MAX_BPS - RESERVE_BPS + 1)));
            _commit(who[i], bps[i], bytes32(i));
        }
        vm.roll(commitEnd + 1);

        uint256 snap = vm.snapshotState();

        // Run A: every bidder reveals its own bid, in commit order.
        for (uint256 i; i < n; i++) {
            _reveal(who[i], bps[i], bytes32(i));
        }
        vm.roll(revealEnd + 1);
        Outcome memory selfRevealed = book.outcome(MAKER, ORDER);

        vm.revertToState(snap);

        // Run B: rotated order; each bid opened by its bidder or by a stranger.
        uint256 offset = uint256(keccak256(abi.encode(seed, "order"))) % n;
        for (uint256 i; i < n; i++) {
            uint256 j = (i + offset) % n;
            if ((sourceMask >> j) & 1 == 1) {
                vm.prank(address(uint160(0x5000 + j)));
                book.revealFor(MAKER, ORDER, who[j], bps[j], bytes32(j));
            } else {
                _reveal(who[j], bps[j], bytes32(j));
            }
        }
        vm.roll(revealEnd + 1);
        Outcome memory mixed = book.outcome(MAKER, ORDER);

        uint256 bestI = 0;
        for (uint256 i = 1; i < n; i++) {
            if (bps[i] > bps[bestI]) bestI = i;
        }
        uint24 second = 0;
        for (uint256 i; i < n; i++) {
            if (i != bestI && bps[i] > second) second = bps[i];
        }
        uint24 expected = second > RESERVE_BPS ? second : RESERVE_BPS;

        assertEq(mixed.winner, selfRevealed.winner, "winner depends on who revealed");
        assertEq(mixed.clearingBps, selfRevealed.clearingBps, "price depends on who revealed");
        assertEq(mixed.exclusiveUntil, selfRevealed.exclusiveUntil, "window depends on who revealed");
        assertEq(mixed.winner, who[bestI], "winner disagrees with reference scan");
        assertEq(mixed.clearingBps, expected, "clearing disagrees with reference scan");
    }

    // --- timelock ciphertext -------------------------------------------------------

    function _openTimelocked() internal returns (uint40 commitEnd, uint40 revealEnd) {
        OpenParams memory p = _params();
        p.tlockRound = TLOCK_ROUND;
        return _openWith(MAKER, ORDER, p);
    }

    function test_Ciphertext_RequiredAtExactLengthWhenTimelocked() public {
        _openTimelocked();
        address a = _bidder(1);
        bytes32 c = _commitment(a, 300, "s");

        vm.startPrank(a);
        vm.expectRevert(IGlasshouseBookV2.BadCiphertext.selector);
        book.commit(MAKER, ORDER, c, "", noProof);
        vm.expectRevert(IGlasshouseBookV2.BadCiphertext.selector);
        book.commit(MAKER, ORDER, c, new bytes(159), noProof);
        vm.expectRevert(IGlasshouseBookV2.BadCiphertext.selector);
        book.commit(MAKER, ORDER, c, new bytes(161), noProof);
        vm.stopPrank();
    }

    /// @dev The ciphertext rides in the event and nowhere in storage.
    function test_Ciphertext_EmittedNotStored() public {
        _openTimelocked();
        address a = _bidder(1);
        bytes memory ct = new bytes(160);
        for (uint256 i; i < ct.length; i++) {
            ct[i] = bytes1(uint8(i + 1));
        }

        vm.expectEmit(address(book));
        emit IGlasshouseBookV2.BidCommitted(MAKER, ORDER, a, 0, ct);
        vm.prank(a);
        book.commit(MAKER, ORDER, _commitment(a, 300, "s"), ct, noProof);

        GlasshouseBookV2.Bid memory b = book.bids(MAKER, ORDER, a);
        assertEq(b.commitment, _commitment(a, 300, "s"), "commitment stored as v1");
        assertEq(book.auctions(MAKER, ORDER).tlockRound, TLOCK_ROUND, "round recorded");
    }

    function test_Ciphertext_ForbiddenWhenNotTimelocked() public {
        _open();
        address a = _bidder(1);
        bytes32 c = _commitment(a, 300, "s");

        vm.startPrank(a);
        vm.expectRevert(IGlasshouseBookV2.BadCiphertext.selector);
        book.commit(MAKER, ORDER, c, new bytes(1), noProof);
        vm.expectRevert(IGlasshouseBookV2.BadCiphertext.selector);
        book.commit(MAKER, ORDER, c, new bytes(160), noProof);
        vm.stopPrank();
    }

    function test_Open_EmitsTheV2Fields() public {
        OpenParams memory p = _bondedParams();
        p.tlockRound = TLOCK_ROUND;
        _ship(MAKER, ORDER, MIN_OFFER);

        uint40 commitEnd = uint40(block.number) + COMMIT_BLOCKS;
        vm.expectEmit(address(book));
        emit IGlasshouseBookV2.AuctionOpened(
            MAKER,
            ORDER,
            ROUTER,
            address(token),
            commitEnd,
            commitEnd + REVEAL_BLOCKS,
            EXCLUSIVE_BLOCKS,
            RESERVE_BPS,
            MAX_BPS,
            BOND,
            MAKER_BOND,
            address(offer),
            MIN_OFFER,
            TLOCK_ROUND
        );
        vm.prank(MAKER);
        book.open(ORDER, p, noProof);
    }

    /// @dev v1 accepts a zero commitment, which can never be revealed or claimed and
    ///      strands the bond. v2 refuses it.
    function test_Commit_RejectsTheZeroCommitment() public {
        _open();
        address a = _bidder(1);
        vm.prank(a);
        vm.expectRevert(IGlasshouseBookV2.NoCommitment.selector);
        book.commit(MAKER, ORDER, bytes32(0), "", noProof);
    }

    // --- maker bond at open ----------------------------------------------------------

    function test_MakerBond_PulledAtOpen() public {
        _ship(MAKER, ORDER, MIN_OFFER);
        uint256 before = token.balanceOf(MAKER);
        _openWith(MAKER, ORDER, _bondedParams());

        assertEq(before - token.balanceOf(MAKER), MAKER_BOND, "maker bond not taken");
        assertEq(token.balanceOf(address(book)), MAKER_BOND, "maker bond not escrowed");
        GlasshouseBookV2.Auction memory a = book.auctions(MAKER, ORDER);
        assertEq(a.makerBond, MAKER_BOND, "recorded");
        assertEq(a.offerToken, address(offer), "offer token");
        assertEq(a.minOffer, MIN_OFFER, "min offer");
        assertEq(a.queueIndex, 0, "opened directly");
    }

    /// @dev A bond nothing could ever slash is refused, not accepted and ignored.
    function test_MakerBond_NoEvidencePathOnABookWithoutAqua() public {
        GlasshouseBookV2 blind = new GlasshouseBookV2(bytes32(0), address(0));
        OpenParams memory p = _bondedParams();
        vm.prank(MAKER);
        vm.expectRevert(IGlasshouseBookV2.NoEvidencePath.selector);
        blind.open(ORDER, p, noProof);

        // Unbonded rounds are fine there.
        vm.prank(MAKER);
        blind.open(ORDER, _params(), noProof);
    }

    function test_MakerBond_NotShipped_WhenNeverShipped() public {
        OpenParams memory p = _bondedParams();
        vm.prank(MAKER);
        vm.expectRevert(IGlasshouseBookV2.NotShipped.selector);
        book.open(ORDER, p, noProof);
    }

    function test_MakerBond_NotShipped_WhenDocked() public {
        _ship(MAKER, ORDER, MIN_OFFER);
        _dock(MAKER, ORDER);
        (, uint8 count) = aqua.rawBalances(MAKER, ROUTER, ORDER, address(offer));
        assertEq(count, 0xff, "docked");

        OpenParams memory p = _bondedParams();
        vm.prank(MAKER);
        vm.expectRevert(IGlasshouseBookV2.NotShipped.selector);
        book.open(ORDER, p, noProof);
    }

    function test_MakerBond_NotShipped_WhenDeclaredBelowMinOffer() public {
        _ship(MAKER, ORDER, MIN_OFFER - 1);
        OpenParams memory p = _bondedParams();
        vm.prank(MAKER);
        vm.expectRevert(IGlasshouseBookV2.NotShipped.selector);
        book.open(ORDER, p, noProof);
    }

    /// @dev Shipped under a different app is not shipped for this router.
    function test_MakerBond_NotShipped_UnderAnotherRouter() public {
        _ship(MAKER, ORDER, MIN_OFFER);
        OpenParams memory p = _bondedParams();
        p.router = address(0xDEAD);
        vm.prank(MAKER);
        vm.expectRevert(IGlasshouseBookV2.NotShipped.selector);
        book.open(ORDER, p, noProof);
    }

    function test_MakerBond_RequiresANonEmptyPromise() public {
        _ship(MAKER, ORDER, MIN_OFFER);
        OpenParams memory p = _bondedParams();
        p.minOffer = 0;
        vm.prank(MAKER);
        vm.expectRevert(IGlasshouseBookV2.BadWindow.selector);
        book.open(ORDER, p, noProof);
    }

    // --- checkOffer ------------------------------------------------------------------

    address internal winner;
    address internal runnerUp;

    /// @dev Bonded auction, two bids revealed, chain left at the first window block.
    function _bondedToWindow() internal returns (uint40 revealEnd) {
        _ship(MAKER, ORDER, MIN_OFFER);
        uint40 commitEnd;
        (commitEnd, revealEnd) = _openWith(MAKER, ORDER, _bondedParams());
        winner = _bidder(1);
        runnerUp = _bidder(2);
        _commit(winner, 300, "s");
        _commit(runnerUp, 200, "s");
        vm.roll(commitEnd + 1);
        _reveal(winner, 300, "s");
        _reveal(runnerUp, 200, "s");
        vm.roll(revealEnd + 1);
    }

    function test_CheckOffer_RevertsOutsideTheWindow() public {
        uint40 revealEnd = _bondedToWindow();

        vm.roll(revealEnd);
        vm.expectRevert(IGlasshouseBookV2.OfferCheckNotOpen.selector);
        book.checkOffer(MAKER, ORDER);

        vm.roll(revealEnd + EXCLUSIVE_BLOCKS + 1);
        vm.expectRevert(IGlasshouseBookV2.OfferCheckNotOpen.selector);
        book.checkOffer(MAKER, ORDER);

        // Both window edges are inside.
        vm.roll(revealEnd + 1);
        book.checkOffer(MAKER, ORDER);
        vm.roll(revealEnd + EXCLUSIVE_BLOCKS);
        book.checkOffer(MAKER, ORDER);
    }

    function test_CheckOffer_RevertsDuringCommitAndReveal() public {
        _ship(MAKER, ORDER, MIN_OFFER);
        (uint40 commitEnd,) = _openWith(MAKER, ORDER, _bondedParams());
        vm.expectRevert(IGlasshouseBookV2.OfferCheckNotOpen.selector);
        book.checkOffer(MAKER, ORDER);
        vm.roll(commitEnd + 1);
        vm.expectRevert(IGlasshouseBookV2.OfferCheckNotOpen.selector);
        book.checkOffer(MAKER, ORDER);
    }

    function test_CheckOffer_RevertsWithNoWinner() public {
        _ship(MAKER, ORDER, MIN_OFFER);
        (, uint40 revealEnd) = _openWith(MAKER, ORDER, _bondedParams());
        _dock(MAKER, ORDER);
        vm.roll(revealEnd + 1);
        vm.expectRevert(IGlasshouseBookV2.OfferCheckNotOpen.selector);
        book.checkOffer(MAKER, ORDER);
    }

    function test_CheckOffer_RevertsForAnUnbondedMaker() public {
        (uint40 commitEnd, uint40 revealEnd) = _open();
        address a = _bidder(1);
        _commit(a, 300, "s");
        vm.roll(commitEnd + 1);
        _reveal(a, 300, "s");
        vm.roll(revealEnd + 1);
        vm.expectRevert(IGlasshouseBookV2.OfferCheckNotOpen.selector);
        book.checkOffer(MAKER, ORDER);
    }

    function test_CheckOffer_RevertsForAnUnopenedAuction() public {
        vm.expectRevert(IGlasshouseBookV2.OfferCheckNotOpen.selector);
        book.checkOffer(MAKER, ORDER);
    }

    function test_CheckOffer_RevertsAfterTheWinnerFilled() public {
        _bondedToWindow();
        _dock(MAKER, ORDER);
        _fill(winner);
        vm.expectRevert(IGlasshouseBookV2.OfferCheckNotOpen.selector);
        book.checkOffer(MAKER, ORDER);
    }

    function _expectDefault(uint8 reason, uint256 observed) internal {
        vm.expectEmit(address(book));
        emit IGlasshouseBookV2.MakerDefaulted(MAKER, ORDER, reason, observed, MIN_OFFER);
        vm.prank(STRANGER);
        book.checkOffer(MAKER, ORDER);
        assertTrue(book.auctions(MAKER, ORDER).makerDefaulted, "flag not set");
    }

    function test_CheckOffer_Reason1_Docked() public {
        _bondedToWindow();
        _dock(MAKER, ORDER);
        _expectDefault(1, 0);
    }

    function test_CheckOffer_Reason1_NeverShippedAnymore() public {
        _bondedToWindow();
        aqua.setRaw(MAKER, ROUTER, ORDER, address(offer), 0, 0);
        _expectDefault(1, 0);
    }

    function test_CheckOffer_Reason2_DeclaredBelowMinOffer() public {
        _bondedToWindow();
        aqua.setRaw(MAKER, ROUTER, ORDER, address(offer), uint248(MIN_OFFER - 7), 2);
        _expectDefault(2, MIN_OFFER - 7);
    }

    function test_CheckOffer_Reason3_WalletBelowMinOffer() public {
        _bondedToWindow();
        vm.prank(MAKER);
        offer.transfer(address(0xD00D), 11 ether);
        _expectDefault(3, MIN_OFFER - 11 ether);
    }

    function test_CheckOffer_Reason4_AllowanceBelowMinOffer() public {
        _bondedToWindow();
        vm.prank(MAKER);
        offer.approve(address(aqua), MIN_OFFER - 1);
        _expectDefault(4, MIN_OFFER - 1);
    }

    /// @dev First failure wins: docked and emptied reports the dock.
    function test_CheckOffer_FirstFailureWins() public {
        _bondedToWindow();
        _dock(MAKER, ORDER);
        vm.prank(MAKER);
        offer.approve(address(aqua), 0);
        _expectDefault(1, 0);
    }

    function test_CheckOffer_PassingCheckIsANoOp() public {
        _bondedToWindow();
        vm.recordLogs();
        book.checkOffer(MAKER, ORDER);
        assertEq(vm.getRecordedLogs().length, 0, "a passing check emitted");
        assertFalse(book.auctions(MAKER, ORDER).makerDefaulted, "a passing check flagged");
    }

    /// @dev D-v2-4. Caught once in the window is caught: re-funding does not clear it,
    ///      a second call emits nothing, and settle reports it.
    function test_CheckOffer_FlagIsSticky() public {
        uint40 revealEnd = _bondedToWindow();
        _dock(MAKER, ORDER);
        _expectDefault(1, 0);

        // Maker "repairs" the offer under the same hash.
        aqua.setRaw(MAKER, ROUTER, ORDER, address(offer), uint248(MIN_OFFER), 2);

        vm.recordLogs();
        book.checkOffer(MAKER, ORDER);
        assertEq(vm.getRecordedLogs().length, 0, "second check emitted");
        assertTrue(book.auctions(MAKER, ORDER).makerDefaulted, "flag cleared");

        vm.roll(revealEnd + EXCLUSIVE_BLOCKS + 1);
        vm.expectEmit(address(book));
        emit IGlasshouseBookV2.AuctionSettled(MAKER, ORDER, winner, 200, false, true);
        book.settle(MAKER, ORDER);
    }

    /// @dev `checkOffer` over random `(declared, wallet, allowance)` against `minOffer`:
    ///      it flags exactly when one of them is short, with the first shortfall's
    ///      reason and figure.
    function testFuzz_CheckOffer_FlagsExactlyTheFirstShortfall(uint256 minOffer, uint256 declared, uint256 wallet, uint256 allowance)
        public
    {
        minOffer = bound(minOffer, 1, 1e30);
        declared = bound(declared, 0, 2e30);
        wallet = bound(wallet, 0, 2e30);
        allowance = bound(allowance, 0, 2e30);

        _ship(MAKER, ORDER, minOffer);
        OpenParams memory p = _bondedParams();
        p.minOffer = uint128(minOffer);
        (uint40 commitEnd, uint40 revealEnd) = _openWith(MAKER, ORDER, p);
        address a = _bidder(1);
        _commit(a, 300, "s");
        vm.roll(commitEnd + 1);
        _reveal(a, 300, "s");
        vm.roll(revealEnd + 1);

        aqua.setRaw(MAKER, ROUTER, ORDER, address(offer), uint248(declared), 2);
        uint256 have = offer.balanceOf(MAKER);
        if (have > wallet) offer.burn(MAKER, have - wallet);
        else offer.mint(MAKER, wallet - have);
        vm.prank(MAKER);
        offer.approve(address(aqua), allowance);

        uint8 reason;
        uint256 observed;
        if (declared < minOffer) (reason, observed) = (2, declared);
        else if (wallet < minOffer) (reason, observed) = (3, wallet);
        else if (allowance < minOffer) (reason, observed) = (4, allowance);

        vm.recordLogs();
        book.checkOffer(MAKER, ORDER);
        Vm.Log[] memory logs = vm.getRecordedLogs();

        assertEq(book.auctions(MAKER, ORDER).makerDefaulted, reason != 0, "flag disagrees with the facts");
        if (reason == 0) {
            assertEq(logs.length, 0, "passing check emitted");
        } else {
            assertEq(logs.length, 1, "one event");
            (uint8 r, uint256 obs, uint256 req) = abi.decode(logs[0].data, (uint8, uint256, uint256));
            assertEq(r, reason, "reason");
            assertEq(obs, observed, "observed");
            assertEq(req, minOffer, "required");
        }
    }

    // --- settle and the maker bond -----------------------------------------------------

    function test_Settle_WithDefault_WinnerClaimsTheMakerBond_MakerCannot() public {
        uint40 revealEnd = _bondedToWindow();
        _dock(MAKER, ORDER);
        book.checkOffer(MAKER, ORDER);
        vm.roll(revealEnd + EXCLUSIVE_BLOCKS + 1);
        book.settle(MAKER, ORDER);

        vm.prank(MAKER);
        vm.expectRevert(IGlasshouseBookV2.NothingToClaim.selector);
        book.claimMakerBond(MAKER, ORDER);

        uint256 before = token.balanceOf(winner);
        vm.expectEmit(address(book));
        emit IGlasshouseBookV2.MakerBondClaimed(MAKER, ORDER, winner, MAKER_BOND, true);
        vm.prank(winner);
        book.claimMakerBond(MAKER, ORDER);
        assertEq(token.balanceOf(winner) - before, MAKER_BOND, "winner paid");

        // And the winner's own bond comes back: the default is the maker's, not theirs.
        vm.prank(winner);
        book.claimBond(MAKER, ORDER);
        assertEq(token.balanceOf(winner) - before, MAKER_BOND + BOND, "winner made whole plus the maker bond");

        vm.prank(winner);
        vm.expectRevert(IGlasshouseBookV2.NothingToClaim.selector);
        book.claimMakerBond(MAKER, ORDER);
    }

    /// @dev D-v2-3. A maker who defaulted must not profit from the round it broke.
    function test_Settle_WithDefault_UnrevealedForfeitsPayTheWinner() public {
        _ship(MAKER, ORDER, MIN_OFFER);
        (uint40 commitEnd, uint40 revealEnd) = _openWith(MAKER, ORDER, _bondedParams());
        winner = _bidder(1);
        address silent = _bidder(2);
        _commit(winner, 300, "s");
        _commit(silent, 250, "s");
        vm.roll(commitEnd + 1);
        _reveal(winner, 300, "s");
        vm.roll(revealEnd + 1);
        _dock(MAKER, ORDER);
        book.checkOffer(MAKER, ORDER);
        vm.roll(revealEnd + EXCLUSIVE_BLOCKS + 1);
        book.settle(MAKER, ORDER);

        uint256 makerBefore = token.balanceOf(MAKER);
        uint256 winnerBefore = token.balanceOf(winner);
        vm.expectEmit(address(book));
        emit IGlasshouseBookV2.UnrevealedForfeited(MAKER, ORDER, silent, BOND, winner);
        vm.prank(MAKER);
        book.claimUnrevealed(ORDER, silent);

        assertEq(token.balanceOf(MAKER), makerBefore, "maker profited from its default");
        assertEq(token.balanceOf(winner) - winnerBefore, BOND, "winner not paid the forfeit");
    }

    function test_Settle_WithoutDefault_MakerReclaimsTheBond() public {
        uint40 revealEnd = _bondedToWindow();
        book.checkOffer(MAKER, ORDER); // passes
        vm.roll(revealEnd + EXCLUSIVE_BLOCKS + 1);
        book.settle(MAKER, ORDER);

        vm.prank(winner);
        vm.expectRevert(IGlasshouseBookV2.NothingToClaim.selector);
        book.claimMakerBond(MAKER, ORDER);

        uint256 before = token.balanceOf(MAKER);
        vm.expectEmit(address(book));
        emit IGlasshouseBookV2.MakerBondClaimed(MAKER, ORDER, MAKER, MAKER_BOND, false);
        vm.prank(MAKER);
        book.claimMakerBond(MAKER, ORDER);
        assertEq(token.balanceOf(MAKER) - before, MAKER_BOND, "maker reclaims");
    }

    /// @dev A dock after the window is the maker tidying up, not a default.
    function test_Settle_DockAfterTheWindow_IsNotADefault() public {
        uint40 revealEnd = _bondedToWindow();
        vm.roll(revealEnd + EXCLUSIVE_BLOCKS + 1);
        _dock(MAKER, ORDER);
        vm.expectRevert(IGlasshouseBookV2.OfferCheckNotOpen.selector);
        book.checkOffer(MAKER, ORDER);
        book.settle(MAKER, ORDER);
        assertFalse(book.auctions(MAKER, ORDER).makerDefaulted, "late dock flagged");

        vm.prank(MAKER);
        book.claimMakerBond(MAKER, ORDER);
    }

    function test_Settle_NoWinner_MakerReclaimsTheBond() public {
        _ship(MAKER, ORDER, MIN_OFFER);
        (, uint40 revealEnd) = _openWith(MAKER, ORDER, _bondedParams());
        vm.roll(revealEnd + EXCLUSIVE_BLOCKS + 1);
        book.settle(MAKER, ORDER);

        uint256 before = token.balanceOf(MAKER);
        vm.prank(MAKER);
        book.claimMakerBond(MAKER, ORDER);
        assertEq(token.balanceOf(MAKER) - before, MAKER_BOND, "maker reclaims");
        assertEq(token.balanceOf(address(book)), 0, "escrow drained");
    }

    function test_ClaimMakerBond_RevertsBeforeSettleAndWhenUnbonded() public {
        uint40 revealEnd = _bondedToWindow();
        vm.prank(MAKER);
        vm.expectRevert(IGlasshouseBookV2.NotSettled.selector);
        book.claimMakerBond(MAKER, ORDER);

        bytes32 other = keccak256("unbonded");
        (, uint40 otherRevealEnd) = _openWith(MAKER, other, _params());
        vm.roll((otherRevealEnd > revealEnd ? otherRevealEnd : revealEnd) + EXCLUSIVE_BLOCKS + 1);
        book.settle(MAKER, other);
        vm.prank(MAKER);
        vm.expectRevert(IGlasshouseBookV2.NothingToClaim.selector);
        book.claimMakerBond(MAKER, other);
    }

    /// @dev I-6: `winnerForfeited && makerDefaulted` is unreachable. A fill inside the
    ///      window closes the offer check, but `filledBy` can still be written after the
    ///      window, before settle, when the gate opens the order to everyone. Without the
    ///      `!makerDefaulted` term in settle, a maker could default, re-fund, fill from a
    ///      second address and collect the winner's bond. The winner keeps it.
    function test_WinnerForfeitAndMakerDefault_AreExclusive() public {
        uint40 revealEnd = _bondedToWindow();
        _dock(MAKER, ORDER);
        book.checkOffer(MAKER, ORDER);
        vm.roll(revealEnd + EXCLUSIVE_BLOCKS + 1);
        _fill(address(0xE15E)); // after the window: the gate allows anyone now
        book.settle(MAKER, ORDER);

        GlasshouseBookV2.Auction memory a = book.auctions(MAKER, ORDER);
        assertTrue(a.makerDefaulted, "flag");
        assertFalse(a.winnerForfeited, "defaulted maker forfeited the winner");

        vm.prank(MAKER);
        vm.expectRevert(IGlasshouseBookV2.NothingToClaim.selector);
        book.claimForfeit(ORDER);

        uint256 before = token.balanceOf(winner);
        vm.startPrank(winner);
        book.claimBond(MAKER, ORDER);
        book.claimMakerBond(MAKER, ORDER);
        vm.stopPrank();
        assertEq(token.balanceOf(winner) - before, BOND + MAKER_BOND, "winner made whole plus the maker bond");
    }

    function test_Escrow_BondedRound_FullyDrainedAfterAllClaims() public {
        uint40 revealEnd = _bondedToWindow();
        assertEq(token.balanceOf(address(book)), MAKER_BOND + 2 * BOND, "escrow");
        _dock(MAKER, ORDER);
        book.checkOffer(MAKER, ORDER);
        vm.roll(revealEnd + EXCLUSIVE_BLOCKS + 1);
        book.settle(MAKER, ORDER);

        vm.prank(winner);
        book.claimMakerBond(MAKER, ORDER);
        vm.prank(winner);
        book.claimBond(MAKER, ORDER);
        vm.prank(runnerUp);
        book.claimBond(MAKER, ORDER);
        assertEq(token.balanceOf(address(book)), 0, "escrow not drained");
    }

    // --- invite root ---------------------------------------------------------------

    address internal constant MEMBER_A = address(0xA11CE);
    address internal constant MEMBER_B = address(0xB0B);
    address internal constant OUTSIDER = address(0x0475);

    function _room() internal returns (GlasshouseBookV2 room, bytes32[] memory leaves) {
        leaves = new bytes32[](3);
        leaves[0] = TestMerkle.leaf(MEMBER_A);
        leaves[1] = TestMerkle.leaf(MEMBER_B);
        leaves[2] = TestMerkle.leaf(MAKER);
        room = new GlasshouseBookV2(TestMerkle.root(leaves), address(aqua));
        for (uint256 i; i < 3; i++) {
            address who = i == 0 ? MEMBER_A : i == 1 ? MEMBER_B : OUTSIDER;
            token.mint(who, 100 ether);
            vm.prank(who);
            token.approve(address(room), type(uint256).max);
        }
        vm.prank(MAKER);
        token.approve(address(room), type(uint256).max);
    }

    function test_Merkle_MemberOpensAndCommits() public {
        (GlasshouseBookV2 room, bytes32[] memory leaves) = _room();
        vm.prank(MAKER);
        room.open(ORDER, _params(), TestMerkle.proof(leaves, 2));

        bytes32[] memory proofA = TestMerkle.proof(leaves, 0);
        vm.prank(MEMBER_A);
        room.commit(MAKER, ORDER, _commitment(MEMBER_A, 300, "s"), "", proofA);
        assertEq(room.bids(MAKER, ORDER, MEMBER_A).commitment, _commitment(MEMBER_A, 300, "s"), "committed");
    }

    function test_Merkle_NonMemberCannotOpenOrCommitOrEnqueue() public {
        (GlasshouseBookV2 room, bytes32[] memory leaves) = _room();
        OpenParams memory p = _params();

        vm.prank(OUTSIDER);
        vm.expectRevert(IGlasshouseBookV2.NotMember.selector);
        room.open(ORDER, p, noProof);

        QueuedRound[] memory rounds = new QueuedRound[](1);
        rounds[0] = QueuedRound(ORDER, 0, 0, p);
        vm.prank(OUTSIDER);
        vm.expectRevert(IGlasshouseBookV2.NotMember.selector);
        room.enqueue(rounds, noProof);

        vm.prank(MAKER);
        room.open(ORDER, p, TestMerkle.proof(leaves, 2));
        bytes32 c = _commitment(OUTSIDER, 300, "s");
        vm.prank(OUTSIDER);
        vm.expectRevert(IGlasshouseBookV2.NotMember.selector);
        room.commit(MAKER, ORDER, c, "", noProof);
    }

    /// @dev An invite link carries one address's proof; it is useless to anyone else.
    function test_Merkle_AProofForAnotherAddressIsRejected() public {
        (GlasshouseBookV2 room, bytes32[] memory leaves) = _room();
        vm.prank(MAKER);
        room.open(ORDER, _params(), TestMerkle.proof(leaves, 2));

        bytes32[] memory proofA = TestMerkle.proof(leaves, 0);
        bytes32 c = _commitment(OUTSIDER, 300, "s");
        vm.prank(OUTSIDER);
        vm.expectRevert(IGlasshouseBookV2.NotMember.selector);
        room.commit(MAKER, ORDER, c, "", proofA);

        OpenParams memory p = _params();
        vm.prank(MEMBER_B);
        vm.expectRevert(IGlasshouseBookV2.NotMember.selector);
        room.open(keccak256("b-order"), p, proofA);
    }

    function test_Merkle_ZeroRootAdmitsEveryone() public {
        assertEq(book.inviteRoot(), bytes32(0), "public");
        bytes32[] memory junk = new bytes32[](2);
        junk[0] = keccak256("x");
        junk[1] = keccak256("y");

        vm.prank(OUTSIDER);
        book.open(ORDER, _params(), junk);
        address a = _bidder(1);
        vm.prank(a);
        book.commit(OUTSIDER, ORDER, _commitment(a, 300, "s"), "", junk);
    }

    /// @dev Reveal, settle and claims stay open to non-members: none of them lets a
    ///      non-member into the auction, and each must be callable for liveness.
    function test_Merkle_LivenessCallsStayPermissionless() public {
        (GlasshouseBookV2 room, bytes32[] memory leaves) = _room();
        vm.prank(MAKER);
        room.open(ORDER, _params(), TestMerkle.proof(leaves, 2));
        GlasshouseBookV2.Auction memory cfg = room.auctions(MAKER, ORDER);
        vm.prank(MEMBER_A);
        room.commit(MAKER, ORDER, _commitment(MEMBER_A, 300, "s"), "", TestMerkle.proof(leaves, 0));

        vm.roll(cfg.commitEnd + 1);
        vm.prank(OUTSIDER);
        room.revealFor(MAKER, ORDER, MEMBER_A, 300, "s");
        vm.roll(cfg.revealEnd + EXCLUSIVE_BLOCKS + 1);
        vm.prank(OUTSIDER);
        room.settle(MAKER, ORDER);
        assertTrue(room.auctions(MAKER, ORDER).settled, "settled by an outsider");
    }

    /// @dev I-7, over random trees of 2..64 leaves: every member can open and commit
    ///      with its own proof; an outsider cannot with any member's proof.
    function testFuzz_Merkle_MembershipOverRandomTrees(uint256 seed, uint8 rawSize, uint8 rawIndex) public {
        uint256 n = 2 + (uint256(rawSize) % 63); // 2..64
        bytes32[] memory leaves = new bytes32[](n);
        address[] memory members = new address[](n);
        for (uint256 i; i < n; i++) {
            members[i] = address(uint160(uint256(keccak256(abi.encode(seed, i))) | 1));
            leaves[i] = TestMerkle.leaf(members[i]);
        }
        GlasshouseBookV2 room = new GlasshouseBookV2(TestMerkle.root(leaves), address(0));

        uint256 m = uint256(rawIndex) % n; // the opener
        uint256 c = (m + 1 + uint256(keccak256(abi.encode(seed, "c"))) % (n - 1)) % n; // a different committer
        address outsider = address(uint160(uint256(keccak256(abi.encode(seed, "outsider")))));

        vm.prank(members[m]);
        room.open(ORDER, _params(), TestMerkle.proof(leaves, m));
        OpenParams memory p = _params();
        p.bond = 0;
        vm.prank(members[c]);
        room.open(ORDER, p, TestMerkle.proof(leaves, c));

        vm.prank(members[c]);
        room.commit(members[c], ORDER, keccak256("c"), "", TestMerkle.proof(leaves, c));

        bytes32[] memory stolen = TestMerkle.proof(leaves, m);
        vm.prank(outsider);
        vm.expectRevert(IGlasshouseBookV2.NotMember.selector);
        room.commit(members[c], ORDER, keccak256("o"), "", stolen);

        // A member presenting another member's proof is refused too.
        vm.prank(members[m]);
        vm.expectRevert(IGlasshouseBookV2.NotMember.selector);
        room.commit(members[c], ORDER, keccak256("m"), "", TestMerkle.proof(leaves, c));
    }

    // --- queue -----------------------------------------------------------------------

    address internal constant OPENER = address(0x0BE7);
    uint128 internal constant TIP = 0.25 ether;

    function _round(bytes32 orderHash, uint40 notBefore, uint128 tip, bool bonded) internal view returns (QueuedRound memory) {
        return QueuedRound(orderHash, notBefore, tip, bonded ? _bondedParams() : _params());
    }

    function _enqueue(QueuedRound[] memory rounds) internal {
        vm.prank(MAKER);
        book.enqueue(rounds, noProof);
    }

    function _three(uint40 notBefore) internal view returns (QueuedRound[] memory rounds) {
        rounds = new QueuedRound[](3);
        rounds[0] = _round(keccak256("q0"), notBefore, TIP, true);
        rounds[1] = _round(keccak256("q1"), notBefore + 50, TIP, false);
        rounds[2] = _round(keccak256("q2"), notBefore + 100, 0, true);
    }

    function _settleCurrent(address maker) internal {
        GlasshouseBookV2.Auction memory a = _currentAuction(maker);
        if (block.number <= a.revealEnd + a.exclusiveBlocks) vm.roll(a.revealEnd + a.exclusiveBlocks + 1);
        bytes32 cur = book.queueCurrent(maker);
        // queueCurrent is a key; find its order hash among the fixture's names.
        bytes32[3] memory names = [keccak256("q0"), keccak256("q1"), keccak256("q2")];
        for (uint256 i; i < 3; i++) {
            if (book.key(maker, names[i]) == cur) {
                book.settle(maker, names[i]);
                return;
            }
        }
        revert("current round not found");
    }

    function _currentAuction(address maker) internal view returns (GlasshouseBookV2.Auction memory a) {
        bytes32[3] memory names = [keccak256("q0"), keccak256("q1"), keccak256("q2")];
        bytes32 cur = book.queueCurrent(maker);
        for (uint256 i; i < 3; i++) {
            if (book.key(maker, names[i]) == cur) return book.auctions(maker, names[i]);
        }
    }

    function test_Enqueue_PullsMakerBondPlusTipForEveryEntry() public {
        uint256 before = token.balanceOf(MAKER);
        vm.expectEmit(address(book));
        emit IGlasshouseBookV2.RoundsEnqueued(MAKER, 0, 3);
        _enqueue(_three(uint40(block.number)));

        uint256 expected = 2 * uint256(MAKER_BOND) + 2 * uint256(TIP);
        assertEq(before - token.balanceOf(MAKER), expected, "sum(makerBond + tip)");
        assertEq(token.balanceOf(address(book)), expected, "escrowed");
        assertEq(book.queueLength(MAKER), 3, "length");
        assertEq(book.queueHead(MAKER), 0, "head");

        vm.expectEmit(address(book));
        emit IGlasshouseBookV2.RoundsEnqueued(MAKER, 3, 1);
        QueuedRound[] memory more = new QueuedRound[](1);
        more[0] = _round(keccak256("q3"), 0, 0, false);
        _enqueue(more);
    }

    /// @dev A queued entry can only fail to open for reasons the maker fixes by shipping
    ///      or withdrawing; the static rules are checked up front.
    function test_Enqueue_ValidatesParametersUpFront() public {
        QueuedRound[] memory rounds = new QueuedRound[](1);
        rounds[0] = _round(keccak256("q0"), 0, 0, false);
        rounds[0].params.exclusiveBlocks = 0;
        vm.prank(MAKER);
        vm.expectRevert(IGlasshouseBookV2.BadWindow.selector);
        book.enqueue(rounds, noProof);

        GlasshouseBookV2 blind = new GlasshouseBookV2(bytes32(0), address(0));
        rounds[0] = _round(keccak256("q0"), 0, 0, true);
        vm.prank(MAKER);
        vm.expectRevert(IGlasshouseBookV2.NoEvidencePath.selector);
        blind.enqueue(rounds, noProof);
    }

    function test_OpenNext_OpensTheHeadPaysTheTipAndEmitsBoth() public {
        _enqueue(_three(uint40(block.number)));
        _ship(MAKER, keccak256("q0"), MIN_OFFER);

        uint40 commitEnd = uint40(block.number) + COMMIT_BLOCKS;
        vm.expectEmit(address(book));
        emit IGlasshouseBookV2.AuctionOpened(
            MAKER,
            keccak256("q0"),
            ROUTER,
            address(token),
            commitEnd,
            commitEnd + REVEAL_BLOCKS,
            EXCLUSIVE_BLOCKS,
            RESERVE_BPS,
            MAX_BPS,
            BOND,
            MAKER_BOND,
            address(offer),
            MIN_OFFER,
            0
        );
        vm.expectEmit(address(book));
        emit IGlasshouseBookV2.QueuedRoundOpened(MAKER, keccak256("q0"), OPENER, TIP);
        vm.prank(OPENER);
        book.openNext(MAKER);

        assertEq(token.balanceOf(OPENER), TIP, "tip paid to the opener");
        GlasshouseBookV2.Auction memory a = book.auctions(MAKER, keccak256("q0"));
        assertEq(a.commitEnd, commitEnd, "opened as if by the maker");
        assertEq(a.makerBond, MAKER_BOND, "bond carried from the queue");
        assertEq(a.queueIndex, 1, "1-based queue position");
        assertEq(book.queueHead(MAKER), 1, "head moved");
        assertEq(book.queueCurrent(MAKER), book.key(MAKER, keccak256("q0")), "current");
        assertEq(book.queued(MAKER, 0).orderHash, bytes32(0), "entry deleted");
        // The bond stays escrowed, now backing the auction.
        assertEq(token.balanceOf(address(book)), 2 * uint256(MAKER_BOND) + TIP, "escrow after open");
    }

    function test_OpenNext_RespectsNotBefore() public {
        uint40 notBefore = uint40(block.number) + 7;
        _enqueue(_three(notBefore));
        _ship(MAKER, keccak256("q0"), MIN_OFFER);

        vm.roll(notBefore - 1);
        vm.expectRevert(abi.encodeWithSelector(IGlasshouseBookV2.NotBefore.selector, notBefore));
        book.openNext(MAKER);

        vm.roll(notBefore);
        book.openNext(MAKER);
    }

    function test_OpenNext_RequiresThePreviousQueuedRoundSettled() public {
        _enqueue(_three(uint40(block.number)));
        _ship(MAKER, keccak256("q0"), MIN_OFFER);
        book.openNext(MAKER);

        vm.roll(block.number + 60);
        vm.expectRevert(IGlasshouseBookV2.PreviousRoundOpen.selector);
        book.openNext(MAKER);

        _settleCurrent(MAKER);
        book.openNext(MAKER);
        assertEq(book.queueCurrent(MAKER), book.key(MAKER, keccak256("q1")), "second round open");
    }

    function test_OpenNext_QueueEmpty() public {
        vm.expectRevert(IGlasshouseBookV2.QueueEmpty.selector);
        book.openNext(MAKER);

        QueuedRound[] memory one = new QueuedRound[](1);
        one[0] = _round(keccak256("q1"), 0, 0, false);
        _enqueue(one);
        book.openNext(MAKER);
        _settleCurrent(MAKER);
        vm.expectRevert(IGlasshouseBookV2.QueueEmpty.selector);
        book.openNext(MAKER);
    }

    /// @dev A head entry that cannot open blocks the queue; nobody but the maker can
    ///      move past it, by shipping or withdrawing.
    function test_OpenNext_UnshippedHeadBlocksUntilTheMakerShips() public {
        _enqueue(_three(uint40(block.number)));
        vm.expectRevert(IGlasshouseBookV2.NotShipped.selector);
        book.openNext(MAKER);

        _ship(MAKER, keccak256("q0"), MIN_OFFER);
        book.openNext(MAKER);
        assertEq(book.queueHead(MAKER), 1, "opened after shipping");
    }

    function test_OpenNext_AlreadyOpenedHeadBlocksUntilWithdrawn() public {
        _enqueue(_three(uint40(block.number)));
        _ship(MAKER, keccak256("q0"), MIN_OFFER);
        _openWith(MAKER, keccak256("q0"), _params()); // the maker opened it by hand

        vm.expectRevert(IGlasshouseBookV2.AlreadyOpened.selector);
        book.openNext(MAKER);

        vm.prank(MAKER);
        book.withdrawQueued(0);
        vm.roll(block.number + 50);
        book.openNext(MAKER);
        assertEq(book.queueCurrent(MAKER), book.key(MAKER, keccak256("q1")), "skipped to q1");
    }

    function test_WithdrawQueued_RefundsAndBlocksALaterOpenOfThatIndex() public {
        _enqueue(_three(uint40(block.number)));
        uint256 before = token.balanceOf(MAKER);

        vm.expectEmit(address(book));
        emit IGlasshouseBookV2.QueuedRoundWithdrawn(MAKER, 1, keccak256("q1"));
        vm.prank(MAKER);
        book.withdrawQueued(1);
        assertEq(token.balanceOf(MAKER) - before, TIP, "q1 refunded (tip only, unbonded)");

        vm.prank(MAKER);
        vm.expectRevert(IGlasshouseBookV2.NotQueued.selector);
        book.withdrawQueued(1);

        _ship(MAKER, keccak256("q0"), MIN_OFFER);
        _ship(MAKER, keccak256("q2"), MIN_OFFER);
        book.openNext(MAKER);
        _settleCurrent(MAKER);
        vm.roll(block.number + 100);
        book.openNext(MAKER);
        assertEq(book.queueCurrent(MAKER), book.key(MAKER, keccak256("q2")), "q1 was skipped");
        assertEq(book.auctions(MAKER, keccak256("q1")).commitEnd, 0, "q1 never opened");
        assertEq(book.auctions(MAKER, keccak256("q2")).queueIndex, 3, "q2 keeps its position");
    }

    function test_WithdrawQueued_RevertsOnOpenedOrOutOfRange() public {
        _enqueue(_three(uint40(block.number)));
        _ship(MAKER, keccak256("q0"), MIN_OFFER);
        book.openNext(MAKER);

        vm.startPrank(MAKER);
        vm.expectRevert(IGlasshouseBookV2.NotQueued.selector);
        book.withdrawQueued(0);
        vm.expectRevert(IGlasshouseBookV2.NotQueued.selector);
        book.withdrawQueued(3);
        vm.stopPrank();

        // Another maker's index is not yours.
        vm.prank(address(0xBBBB));
        vm.expectRevert(IGlasshouseBookV2.NotQueued.selector);
        book.withdrawQueued(1);
    }

    function test_WithdrawQueued_EveryEntry_EmptiesTheQueue() public {
        _enqueue(_three(uint40(block.number)));
        vm.startPrank(MAKER);
        book.withdrawQueued(2);
        book.withdrawQueued(0);
        book.withdrawQueued(1);
        vm.stopPrank();
        assertEq(token.balanceOf(address(book)), 0, "all refunded");
        assertEq(book.queueHead(MAKER), 3, "head past the end");
        vm.expectRevert(IGlasshouseBookV2.QueueEmpty.selector);
        book.openNext(MAKER);
    }

    /// @dev `settleAndOpenNext` is exactly `settle` then `openNext`: same state, same
    ///      balances, same logs.
    function test_SettleAndOpenNext_EqualsTheTwoCalls() public {
        _enqueue(_three(uint40(block.number)));
        _ship(MAKER, keccak256("q0"), MIN_OFFER);
        book.openNext(MAKER);
        GlasshouseBookV2.Auction memory first = book.auctions(MAKER, keccak256("q0"));
        vm.roll(first.revealEnd + EXCLUSIVE_BLOCKS + 60);

        uint256 snap = vm.snapshotState();

        vm.recordLogs();
        vm.prank(OPENER);
        book.settle(MAKER, keccak256("q0"));
        vm.prank(OPENER);
        book.openNext(MAKER);
        Vm.Log[] memory twoCalls = vm.getRecordedLogs();
        bytes memory stateA = _queueState();

        vm.revertToState(snap);

        vm.recordLogs();
        vm.prank(OPENER);
        book.settleAndOpenNext(MAKER, keccak256("q0"));
        Vm.Log[] memory oneCall = vm.getRecordedLogs();
        bytes memory stateB = _queueState();

        assertEq(keccak256(stateA), keccak256(stateB), "state differs");
        assertEq(oneCall.length, twoCalls.length, "log count differs");
        for (uint256 i; i < oneCall.length; i++) {
            assertEq(oneCall[i].emitter, twoCalls[i].emitter, "emitter");
            assertEq(keccak256(abi.encode(oneCall[i].topics)), keccak256(abi.encode(twoCalls[i].topics)), "topics");
            assertEq(keccak256(oneCall[i].data), keccak256(twoCalls[i].data), "data");
        }
    }

    function _queueState() internal view returns (bytes memory) {
        return abi.encode(
            book.auctions(MAKER, keccak256("q0")),
            book.auctions(MAKER, keccak256("q1")),
            book.queueHead(MAKER),
            book.queueCurrent(MAKER),
            token.balanceOf(address(book)),
            token.balanceOf(OPENER),
            token.balanceOf(MAKER)
        );
    }

    function test_SettleAndOpenNext_SettleStandsAloneWhenOpenNextCannot() public {
        _enqueue(_three(uint40(block.number)));
        _ship(MAKER, keccak256("q0"), MIN_OFFER);
        book.openNext(MAKER);
        GlasshouseBookV2.Auction memory first = book.auctions(MAKER, keccak256("q0"));
        vm.roll(first.revealEnd + EXCLUSIVE_BLOCKS + 1); // before q1's notBefore

        vm.expectRevert(abi.encodeWithSelector(IGlasshouseBookV2.NotBefore.selector, uint40(1050)));
        book.settleAndOpenNext(MAKER, keccak256("q0"));

        // settle alone is never blocked by the maker's queue.
        book.settle(MAKER, keccak256("q0"));
        assertTrue(book.auctions(MAKER, keccak256("q0")).settled, "settled");
    }

    /// @dev I-2, on the queue: after a full queued lifecycle every token is accounted for.
    function test_Queue_EscrowIsFullyDrainedAfterEveryPath() public {
        _enqueue(_three(uint40(block.number)));
        _ship(MAKER, keccak256("q0"), MIN_OFFER);
        vm.prank(OPENER);
        book.openNext(MAKER);
        _settleCurrent(MAKER);
        vm.prank(MAKER);
        book.claimMakerBond(MAKER, keccak256("q0"));
        vm.prank(MAKER);
        book.withdrawQueued(2);
        vm.roll(block.number + 60);
        vm.prank(OPENER);
        book.openNext(MAKER);
        _settleCurrent(MAKER);
        assertEq(token.balanceOf(address(book)), 0, "escrow not drained");
        assertEq(token.balanceOf(OPENER), 2 * uint256(TIP), "two tips");
    }
}

/// @title GlasshouseRouterUntouchedTest
/// @notice I-10. A "small" router change cannot ride along with a Book change.
///
/// @dev What is pinned, and why not the whole bytecode. Under `via_ir`, solc's output for
///      a contract depends on the AST ids of every file in the same compilation job, not
///      only on the contract's own sources: adding the v2 files to Forge's single job
///      moves the router's executable code (21,108 -> 21,168 bytes) with its sources and
///      settings unchanged. A pinned full-bytecode hash in Forge would therefore fail on
///      any new file anywhere.
///
/// @dev Nor the metadata hash in the CBOR tail, which this test first pinned. The
///      metadata JSON carries Forge's auto-detected remappings, and some of those are
///      absolute paths (the checkout folder, `D:/ethonline/node_modules/...`), so the
///      digest moved with the checkout's folder: it passed in the worktree it was
///      measured in and failed in the main checkout with identical sources.
///
/// @dev So the test reads the router's metadata from Forge's artifact and pins what the
///      metadata hash was standing in for: keccak256 of every file in the router's
///      source closure (69 files, `src/` and `node_modules/` alike, in the artifact's
///      order), plus the compiler version, optimizer runs, `viaIR` and EVM version.
///      Change one byte of any source, or one setting, and it moves; move the checkout
///      and it does not.
///
/// @dev The executable bytecode itself is checked against the router live on Base out
///      of band, with the build Ignition deploys from; see `docs/design/v2.md`,
///      "Implementation notes (Phase 1)".
contract GlasshouseRouterUntouchedTest is Test {
    string internal constant ARTIFACT = "/artifacts/GlasshouseRouter.sol/GlasshouseRouter.json";

    bytes32 internal constant SOURCES_DIGEST = 0xab199c42e9fbc626fc8ebdbac563268f6a4a3a37d15bc34a14270d3911b5ee71;
    uint256 internal constant SOURCE_COUNT = 69;

    function test_RouterSourcesAndSettingsAreUnchanged() public view {
        string memory json = vm.readFile(string.concat(vm.projectRoot(), ARTIFACT));

        string[] memory paths = vm.parseJsonKeys(json, ".metadata.sources");
        assertEq(paths.length, SOURCE_COUNT, "router source closure changed size");
        bytes memory packed;
        for (uint256 i; i < paths.length; ++i) {
            packed = abi.encodePacked(
                packed, vm.parseJsonBytes32(json, string.concat(".metadata.sources['", paths[i], "'].keccak256"))
            );
        }
        assertEq(keccak256(packed), SOURCES_DIGEST, "router sources changed");

        assertEq(vm.parseJsonString(json, ".metadata.compiler.version"), "0.8.30+commit.73712a01", "compiler");
        assertEq(vm.parseJsonUint(json, ".metadata.settings.optimizer.runs"), 700, "optimizer runs");
        assertTrue(vm.parseJsonBool(json, ".metadata.settings.optimizer.enabled"), "optimizer");
        assertTrue(vm.parseJsonBool(json, ".metadata.settings.viaIR"), "viaIR");
        assertEq(vm.parseJsonString(json, ".metadata.settings.evmVersion"), "osaka", "evm version");
    }
}
