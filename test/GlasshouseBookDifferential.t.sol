// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Test } from "forge-std/Test.sol";

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

import { GlasshouseBook } from "../src/book/GlasshouseBook.sol";
import { GlasshouseBookV2 } from "../src/book/GlasshouseBookV2.sol";
import { OpenParams } from "../src/interfaces/IGlasshouseBookV2.sol";
import { Outcome } from "../src/interfaces/IGlasshouseBook.sol";

contract DiffToken is ERC20 {
    constructor() ERC20("Bond", "BOND") { }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/// @title GlasshouseBookDifferentialTest
/// @notice I-1, Outcome is v1. For any sequence of v1-shaped calls, `outcome()` on the v2
///         Book equals `outcome()` on a v1 Book driven identically. Not an argument: both
///         Books are deployed, driven by the same random sequence, and compared after
///         every step, including every `vm.roll`.
///
/// @dev "v1-shaped" means `makerBond = 0`, `offerToken = 0`, `minOffer = 0`,
///      `tlockRound = 0`, empty ciphertext, empty proof on a public Book. With those,
///      every v1 call has exactly one v2 counterpart, and the two must agree on whether
///      the call succeeds, on the revert data when it does not (the v1 errors kept their
///      selectors), on every field of the auction both Books have, and on escrow.
///
/// @dev One v1 input is outside the domain on purpose: a zero commitment, which v1
///      accepts and strands and v2 refuses. A commitment built by `commitmentFor` is a
///      keccak256 and is never zero, so no honest client can produce one.
contract GlasshouseBookDifferentialTest is Test {
    GlasshouseBook internal v1;
    GlasshouseBookV2 internal v2;
    DiffToken internal token;

    address internal constant ROUTER = address(0x120073);
    uint256 internal constant MAKERS = 3;
    uint256 internal constant ORDERS = 3;
    uint256 internal constant BIDDERS = 4;
    uint256 internal constant STEPS = 60;

    bytes32[] internal noProof;

    // What each bidder committed, so most generated reveals are valid ones.
    mapping(bytes32 key => mapping(address bidder => uint24)) internal committedBps;
    mapping(bytes32 key => mapping(address bidder => bytes32)) internal committedSalt;

    uint256 internal rng;
    uint256 internal currentAction;
    mapping(uint256 action => uint256) internal succeeded; // went through on both, for non-vacuity

    function setUp() public {
        v1 = new GlasshouseBook();
        v2 = new GlasshouseBookV2(bytes32(0), address(0));
        token = new DiffToken();
        for (uint256 i; i < BIDDERS; i++) {
            address b = _bidder(i);
            token.mint(b, 1000 ether);
            vm.startPrank(b);
            token.approve(address(v1), type(uint256).max);
            token.approve(address(v2), type(uint256).max);
            vm.stopPrank();
        }
        vm.roll(1000);
    }

    function _maker(uint256 i) internal pure returns (address) {
        return address(uint160(0xAA00 + i));
    }

    function _order(uint256 i) internal pure returns (bytes32) {
        return keccak256(abi.encode("order", i));
    }

    function _bidder(uint256 i) internal pure returns (address) {
        return address(uint160(0xB1D000 + i));
    }

    function _next(uint256 bound_) internal returns (uint256) {
        rng = uint256(keccak256(abi.encode(rng)));
        return rng % bound_;
    }

    /// @dev Run the same call from the same sender on both Books and require the same
    ///      verdict and, on failure, the same revert bytes.
    function _both(address sender, bytes memory callV1, bytes memory callV2) internal {
        vm.prank(sender);
        (bool ok1, bytes memory ret1) = address(v1).call(callV1);
        vm.prank(sender);
        (bool ok2, bytes memory ret2) = address(v2).call(callV2);
        assertEq(ok1, ok2, "one Book accepted a call the other refused");
        if (!ok1) assertEq(ret1, ret2, "revert data differs");
        else succeeded[currentAction]++;
    }

    function _compareEverything() internal view {
        for (uint256 m; m < MAKERS; m++) {
            for (uint256 o; o < ORDERS; o++) {
                address maker = _maker(m);
                bytes32 orderHash = _order(o);

                Outcome memory a = v1.outcome(maker, orderHash);
                Outcome memory b = v2.outcome(maker, orderHash);
                assertEq(uint8(a.status), uint8(b.status), "status");
                assertEq(a.winner, b.winner, "winner");
                assertEq(a.clearingBps, b.clearingBps, "clearingBps");
                assertEq(a.exclusiveUntil, b.exclusiveUntil, "exclusiveUntil");

                GlasshouseBook.Auction memory x = v1.auctions(maker, orderHash);
                GlasshouseBookV2.Auction memory y = v2.auctions(maker, orderHash);
                assertEq(x.router, y.router, "router");
                assertEq(x.tokenIn, y.tokenIn, "tokenIn");
                assertEq(x.commitEnd, y.commitEnd, "commitEnd");
                assertEq(x.revealEnd, y.revealEnd, "revealEnd");
                assertEq(x.exclusiveBlocks, y.exclusiveBlocks, "exclusiveBlocks");
                assertEq(x.reserveBps, y.reserveBps, "reserveBps");
                assertEq(x.maxBps, y.maxBps, "maxBps");
                assertEq(x.bond, y.bond, "bond");
                assertEq(x.best, y.best, "best");
                assertEq(x.bestBps, y.bestBps, "bestBps");
                assertEq(x.bestCommitIdx, y.bestCommitIdx, "bestCommitIdx");
                assertEq(x.secondBps, y.secondBps, "secondBps");
                assertEq(x.commitCount, y.commitCount, "commitCount");
                assertEq(x.filledBy, y.filledBy, "filledBy");
                assertEq(x.settled, y.settled, "settled");
                assertEq(x.winnerForfeited, y.winnerForfeited, "winnerForfeited");
                assertFalse(y.makerDefaulted, "v1-shaped calls cannot default a maker");

                for (uint256 i; i < BIDDERS; i++) {
                    GlasshouseBook.Bid memory p = v1.bids(maker, orderHash, _bidder(i));
                    GlasshouseBookV2.Bid memory q = v2.bids(maker, orderHash, _bidder(i));
                    assertEq(p.commitment, q.commitment, "commitment");
                    assertEq(p.commitIdx, q.commitIdx, "commitIdx");
                    assertEq(p.revealed, q.revealed, "revealed");
                    assertEq(p.bondClaimed, q.bondClaimed, "bondClaimed");
                }
            }
        }
        assertEq(token.balanceOf(address(v1)), token.balanceOf(address(v2)), "escrow differs");
        for (uint256 i; i < BIDDERS; i++) {
            // Same bidders fund both Books, so their spend must split evenly.
            assertEq((1000 ether - token.balanceOf(_bidder(i))) % 2, 0, "asymmetric bidder spend");
        }
    }

    function _step() internal {
        uint256 action = _next(10);
        currentAction = action;
        address maker = _maker(_next(MAKERS));
        bytes32 orderHash = _order(_next(ORDERS));
        bytes32 k = v1.key(maker, orderHash);
        address bidder = _bidder(_next(BIDDERS));

        if (action == 0) {
            // open, sometimes with a parameter the Books must both refuse
            uint40 commitBlocks = uint40(_next(6));
            uint40 revealBlocks = uint40(1 + _next(6));
            uint40 exclusiveBlocks = uint40(_next(5));
            uint24 reserveBps = uint24(_next(300));
            uint24 maxBps = _next(8) == 0 ? uint24(200 + _next(400)) : uint24(600 + _next(9500));
            uint128 bond = _next(2) == 0 ? 0 : 1 ether;
            OpenParams memory p = OpenParams({
                router: ROUTER,
                commitBlocks: commitBlocks,
                revealBlocks: revealBlocks,
                tokenIn: address(token),
                exclusiveBlocks: exclusiveBlocks,
                reserveBps: reserveBps,
                maxBps: maxBps,
                bond: bond,
                makerBond: 0,
                offerToken: address(0),
                tlockRound: 0,
                minOffer: 0
            });
            _both(
                maker,
                abi.encodeCall(
                    GlasshouseBook.open,
                    (orderHash, ROUTER, address(token), commitBlocks, revealBlocks, exclusiveBlocks, reserveBps, maxBps, bond)
                ),
                abi.encodeCall(GlasshouseBookV2.open, (orderHash, p, noProof))
            );
        } else if (action == 1 || action == 2) {
            uint24 bps = _next(5) == 0 ? uint24(_next(700)) : uint24(300 + _next(300));
            bytes32 salt = bytes32(_next(type(uint256).max));
            bytes32 commitment = v1.commitmentFor(bidder, bps, salt);
            _both(
                bidder,
                abi.encodeCall(GlasshouseBook.commit, (maker, orderHash, commitment)),
                abi.encodeCall(GlasshouseBookV2.commit, (maker, orderHash, commitment, "", noProof))
            );
            if (v1.bids(maker, orderHash, bidder).commitment == commitment) {
                committedBps[k][bidder] = bps;
                committedSalt[k][bidder] = salt;
            }
        } else if (action == 3 || action == 4) {
            bool honest = _next(5) != 0;
            if (honest) {
                // Prefer a bidder who actually committed here.
                for (uint256 i; i < BIDDERS && committedSalt[k][bidder] == bytes32(0); i++) {
                    bidder = _bidder((uint160(bidder) - 0xB1D000 + 1) % BIDDERS);
                }
            }
            uint24 bps = honest ? committedBps[k][bidder] : uint24(_next(600));
            bytes32 salt = honest ? committedSalt[k][bidder] : bytes32(_next(3));
            _both(
                bidder,
                abi.encodeCall(GlasshouseBook.reveal, (maker, orderHash, bps, salt)),
                abi.encodeCall(GlasshouseBookV2.reveal, (maker, orderHash, bps, salt))
            );
        } else if (action == 5) {
            vm.roll(block.number + 1 + (_next(6) == 0 ? _next(8) : 0));
        } else if (action == 6) {
            address taker = _next(2) == 0 ? bidder : address(0xE15E);
            address caller = _next(6) == 0 ? address(0xBAD) : ROUTER;
            bytes memory hook = abi.encodeWithSignature(
                "postTransferIn(address,address,address,address,uint256,uint256,uint256,bytes32,bytes,bytes)",
                maker,
                taker,
                address(0),
                address(0),
                uint256(1),
                uint256(1),
                uint256(0),
                orderHash,
                bytes(""),
                bytes("")
            );
            _both(caller, hook, hook);
        } else if (action == 7) {
            bytes memory c = abi.encodeWithSignature("settle(address,bytes32)", maker, orderHash);
            _both(bidder, c, c);
        } else if (action == 8) {
            bytes memory c = abi.encodeWithSignature("claimBond(address,bytes32)", maker, orderHash);
            _both(bidder, c, c);
        } else {
            bytes memory c = _next(2) == 0
                ? abi.encodeWithSignature("claimForfeit(bytes32)", orderHash)
                : abi.encodeWithSignature("claimUnrevealed(bytes32,address)", orderHash, bidder);
            _both(maker, c, c);
        }
    }

    /// @dev I-1 over random call sequences. 256 runs of 60 steps by default.
    function testFuzz_OutcomeMatchesV1(uint256 seed) public {
        rng = seed;
        _compareEverything();
        for (uint256 i; i < STEPS; i++) {
            _step();
            _compareEverything();
        }
    }

    /// @dev The same, long enough that every auction runs all the way to claims, and
    ///      checked for not being vacuous: every kind of call must have gone through on
    ///      both Books at least once, not merely reverted identically.
    function test_OutcomeMatchesV1_LongRun() public {
        rng = 0x61a55;
        for (uint256 i; i < 600; i++) {
            this.stepAndCompare(); // external, so each step starts with fresh memory
        }
        string[10] memory names =
            ["open", "commit", "commit", "reveal", "reveal", "roll", "fill", "settle", "claimBond", "claimForfeit/Unrevealed"];
        for (uint256 action; action < 10; action++) {
            if (action == 5) continue; // rolls are not calls
            assertGt(succeeded[action], 0, string.concat("never succeeded: ", names[action]));
        }
    }

    function stepAndCompare() external {
        require(msg.sender == address(this), "self only");
        _step();
        _compareEverything();
    }

    /// @dev The v1 headline on both Books, block by block: two sealed bids, the winner
    ///      pays the runner-up's price inside its window, then the order opens to all.
    function test_Headline_BlockByBlock() public {
        address maker = _maker(0);
        bytes32 orderHash = _order(0);
        address a = _bidder(0);
        address b = _bidder(1);

        OpenParams memory p = OpenParams({
            router: ROUTER,
            commitBlocks: 30,
            revealBlocks: 30,
            tokenIn: address(token),
            exclusiveBlocks: 15,
            reserveBps: 50,
            maxBps: 500,
            bond: 1 ether,
            makerBond: 0,
            offerToken: address(0),
            tlockRound: 0,
            minOffer: 0
        });
        _both(
            maker,
            abi.encodeCall(GlasshouseBook.open, (orderHash, ROUTER, address(token), 30, 30, 15, 50, 500, 1 ether)),
            abi.encodeCall(GlasshouseBookV2.open, (orderHash, p, noProof))
        );
        bytes32 ca = v1.commitmentFor(a, 400, "s");
        bytes32 cb = v1.commitmentFor(b, 250, "s");
        _both(a, abi.encodeCall(GlasshouseBook.commit, (maker, orderHash, ca)), abi.encodeCall(GlasshouseBookV2.commit, (maker, orderHash, ca, "", noProof)));
        _both(b, abi.encodeCall(GlasshouseBook.commit, (maker, orderHash, cb)), abi.encodeCall(GlasshouseBookV2.commit, (maker, orderHash, cb, "", noProof)));

        uint256 start = block.number;
        for (uint256 blk = start; blk <= start + 80; blk++) {
            vm.roll(blk);
            if (blk == start + 31) {
                bytes memory ra = abi.encodeWithSignature("reveal(address,bytes32,uint24,bytes32)", maker, orderHash, uint24(400), bytes32("s"));
                bytes memory rb = abi.encodeWithSignature("reveal(address,bytes32,uint24,bytes32)", maker, orderHash, uint24(250), bytes32("s"));
                _both(b, rb, rb);
                _both(a, ra, ra);
            }
            _compareEverything();
        }
        assertEq(v2.outcome(maker, orderHash).winner, a, "winner");
        assertEq(v2.outcome(maker, orderHash).clearingBps, 250, "second price");
    }
}
