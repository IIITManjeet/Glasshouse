// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Test, Vm } from "forge-std/Test.sol";

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

import { GlasshouseBookFactory } from "../src/book/GlasshouseBookFactory.sol";
import { GlasshouseBookV2 } from "../src/book/GlasshouseBookV2.sol";
import { IGlasshouseBookV2, OpenParams } from "../src/interfaces/IGlasshouseBookV2.sol";
import { AuctionStatus } from "../src/interfaces/IGlasshouseBook.sol";
import { MockAqua } from "./helpers/MockAqua.sol";

contract RoomToken is ERC20 {
    constructor() ERC20("Bond", "BOND") { }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/// @title GlasshouseBookFactoryTest
/// @notice A room is a Book deployment. The factory has to hand every room the same Aqua,
///         its own invite root and its own storage, and announce it so an indexer can
///         follow it. `docs/design/v2.md` §5.
contract GlasshouseBookFactoryTest is Test {
    GlasshouseBookFactory internal factory;
    MockAqua internal aqua;
    RoomToken internal token;

    address internal constant CREATOR = address(0xC0FFEE);
    address internal constant MAKER = address(0xAAAA);
    address internal constant ROUTER = address(0x120073);
    address internal constant MEMBER = address(0xA11CE);
    address internal constant OTHER_MEMBER = address(0xB0B);
    bytes32 internal constant ORDER = keccak256("order-1");

    bytes32[] internal noProof;

    function setUp() public {
        aqua = new MockAqua();
        factory = new GlasshouseBookFactory(address(aqua));
        token = new RoomToken();
        vm.roll(1000);
    }

    function _params() internal view returns (OpenParams memory) {
        return OpenParams({
            router: ROUTER,
            commitBlocks: 10,
            revealBlocks: 10,
            tokenIn: address(token),
            exclusiveBlocks: 5,
            reserveBps: 10,
            maxBps: 500,
            bond: 1 ether,
            makerBond: 0,
            offerToken: address(0),
            tlockRound: 0,
            minOffer: 0
        });
    }

    function _leaf(address who) internal pure returns (bytes32) {
        return keccak256(bytes.concat(keccak256(abi.encode(who))));
    }

    /// @dev Two-member tree: the root is the sorted pair hash, and each proof is the
    ///      other leaf.
    function _twoMemberRoot() internal pure returns (bytes32) {
        bytes32 a = _leaf(MEMBER);
        bytes32 b = _leaf(OTHER_MEMBER);
        return a < b ? keccak256(abi.encode(a, b)) : keccak256(abi.encode(b, a));
    }

    function test_Create_DeploysABookWithTheRootAndTheFactoryAqua() public {
        bytes32 root = _twoMemberRoot();
        vm.prank(CREATOR);
        address book = factory.create(root, "Friends");

        assertGt(book.code.length, 0, "no code at the room");
        assertEq(GlasshouseBookV2(book).inviteRoot(), root, "root");
        assertEq(GlasshouseBookV2(book).aqua(), address(aqua), "aqua");
        assertEq(factory.aqua(), address(aqua), "factory aqua");
    }

    function test_Create_EmitsRoomCreated() public {
        vm.recordLogs();
        vm.prank(CREATOR);
        address book = factory.create(bytes32(uint256(7)), "Seven");

        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertEq(logs.length, 1, "one event");
        assertEq(logs[0].emitter, address(factory), "emitter");
        assertEq(logs[0].topics[0], GlasshouseBookFactory.RoomCreated.selector, "topic0");
        assertEq(logs[0].topics[1], bytes32(uint256(uint160(book))), "book indexed");
        assertEq(logs[0].topics[2], bytes32(uint256(uint160(CREATOR))), "creator indexed");
        (bytes32 root, string memory name) = abi.decode(logs[0].data, (bytes32, string));
        assertEq(root, bytes32(uint256(7)), "root in data");
        assertEq(name, "Seven", "name in data");
    }

    /// @dev The event signature is what the subgraph manifest subscribes to; if it
    ///      moved, every room after the change would go unindexed.
    function test_RoomCreated_SignatureIsTheManifestOne() public pure {
        assertEq(
            GlasshouseBookFactory.RoomCreated.selector, keccak256("RoomCreated(address,address,bytes32,string)"), "manifest signature"
        );
    }

    function test_Create_CountsAndListsRoomsInOrder() public {
        assertEq(factory.count(), 0, "empty");
        address pub = factory.create(bytes32(0), "Glasshouse");
        address priv = factory.create(_twoMemberRoot(), "Friends");

        assertEq(factory.count(), 2, "count");
        assertEq(factory.roomAt(0), pub, "public room is room 0");
        assertEq(factory.roomAt(1), priv, "room 1");
        assertTrue(pub != priv, "distinct deployments");

        vm.expectRevert();
        factory.roomAt(2);
    }

    function test_Create_NameBound() public {
        string memory max = "0123456789012345678901234567890123456789012345678901234567890123"; // 64
        factory.create(bytes32(0), max);

        string memory tooLong = string.concat(max, "4");
        vm.expectRevert(abi.encodeWithSelector(GlasshouseBookFactory.NameTooLong.selector, 65));
        factory.create(bytes32(0), tooLong);
    }

    /// @dev Neither the factory nor the Book has an owner: nothing about a room can be
    ///      changed after it is created, by anyone, including its creator.
    function test_NoOwnerAnywhere() public {
        vm.prank(CREATOR);
        address book = factory.create(bytes32(0), "x");
        (bool ok,) = book.call(abi.encodeWithSignature("owner()"));
        assertFalse(ok, "book has an owner()");
        (ok,) = address(factory).call(abi.encodeWithSignature("owner()"));
        assertFalse(ok, "factory has an owner()");
    }

    /// @dev Separate storage: the same (maker, orderHash) can be auctioned once per room,
    ///      and the two auctions do not see each other.
    function test_Rooms_HaveSeparateStorageAndEscrow() public {
        GlasshouseBookV2 a = GlasshouseBookV2(factory.create(bytes32(0), "A"));
        GlasshouseBookV2 b = GlasshouseBookV2(factory.create(bytes32(0), "B"));

        vm.prank(MAKER);
        a.open(ORDER, _params(), noProof);
        assertTrue(a.outcome(MAKER, ORDER).status == AuctionStatus.Bidding, "open in A");
        assertTrue(b.outcome(MAKER, ORDER).status == AuctionStatus.None, "B unaffected");

        vm.prank(MAKER);
        b.open(ORDER, _params(), noProof); // same order, second room: allowed

        address bidder = address(0xB1D);
        token.mint(bidder, 10 ether);
        vm.startPrank(bidder);
        token.approve(address(a), type(uint256).max);
        a.commit(MAKER, ORDER, a.commitmentFor(bidder, 100, "s"), "", noProof);
        vm.stopPrank();

        assertEq(token.balanceOf(address(a)), 1 ether, "escrow in A");
        assertEq(token.balanceOf(address(b)), 0, "no escrow in B");
        assertEq(b.bids(MAKER, ORDER, bidder).commitment, bytes32(0), "bid not visible in B");
    }

    /// @dev An invite-only room made by the factory gates exactly like one deployed by
    ///      hand.
    function test_InviteOnlyRoom_GatesOpenAndCommit() public {
        GlasshouseBookV2 room = GlasshouseBookV2(factory.create(_twoMemberRoot(), "Friends"));

        bytes32[] memory proofForMember = new bytes32[](1);
        proofForMember[0] = _leaf(OTHER_MEMBER);
        bytes32[] memory proofForOther = new bytes32[](1);
        proofForOther[0] = _leaf(MEMBER);

        OpenParams memory p = _params();
        vm.prank(MAKER);
        vm.expectRevert(IGlasshouseBookV2.NotMember.selector);
        room.open(ORDER, p, proofForMember);

        vm.prank(MEMBER);
        room.open(ORDER, p, proofForMember);

        token.mint(OTHER_MEMBER, 10 ether);
        vm.startPrank(OTHER_MEMBER);
        token.approve(address(room), type(uint256).max);
        room.commit(MEMBER, ORDER, room.commitmentFor(OTHER_MEMBER, 100, "s"), "", proofForOther);
        vm.stopPrank();
        assertTrue(room.bids(MEMBER, ORDER, OTHER_MEMBER).commitment != bytes32(0), "member committed");
    }

    /// @dev A factory built with no Aqua makes rooms that refuse every bonded open.
    function test_FactoryWithoutAqua_RoomsRefuseMakerBonds() public {
        GlasshouseBookFactory blind = new GlasshouseBookFactory(address(0));
        GlasshouseBookV2 room = GlasshouseBookV2(blind.create(bytes32(0), "blind"));
        OpenParams memory p = _params();
        p.makerBond = 1;
        p.minOffer = 1;
        p.offerToken = address(token);
        vm.prank(MAKER);
        vm.expectRevert(IGlasshouseBookV2.NoEvidencePath.selector);
        room.open(ORDER, p, noProof);
    }

    function testFuzz_Create_AnyRootIsStoredVerbatim(bytes32 root) public {
        address book = factory.create(root, "fuzz");
        assertEq(GlasshouseBookV2(book).inviteRoot(), root, "root");
    }
}
