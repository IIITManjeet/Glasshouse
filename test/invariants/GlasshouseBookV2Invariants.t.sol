// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Test, Vm } from "forge-std/Test.sol";

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

import { GlasshouseBookV2 } from "../../src/book/GlasshouseBookV2.sol";
import { IGlasshouseBookV2, OpenParams, QueuedRound } from "../../src/interfaces/IGlasshouseBookV2.sol";
import { Outcome, AuctionStatus } from "../../src/interfaces/IGlasshouseBook.sol";
import { MockAqua } from "../helpers/MockAqua.sol";

contract InvToken is ERC20 {
    constructor(string memory name_) ERC20(name_, name_) { }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) external {
        _burn(from, amount);
    }
}

/// @title BookV2Handler
/// @notice Drives one v2 Book through `open` / `enqueue` / `withdrawQueued` / `openNext` /
///         `commit` / `reveal` / `revealFor` / `postTransferIn` (pranked as the router,
///         and only when the gate would let the fill through) / `checkOffer` / `settle` /
///         `settleAndOpenNext` / every claim, over three makers, four bidders, two
///         strangers, a mock Aqua that can be docked or drained mid-window, and `vm.roll`.
///
/// @dev Properties that need to see a call as it happens (who got paid, in which block,
///      in what order) are checked here and counted as violations; the invariant
///      functions assert the counters are zero. Properties of state are recomputed from
///      the Book's own views in the invariant functions.
contract BookV2Handler is Test {
    GlasshouseBookV2 public book;
    MockAqua public aqua;
    InvToken public token; // tokenIn
    InvToken public offer; // offerToken

    address internal constant ROUTER = address(0x120073);
    uint128 internal constant BOND = 1 ether;
    uint128 internal constant MAKER_BOND = 3 ether;
    uint128 internal constant MIN_OFFER = 50 ether;
    uint128 internal constant TIP = 0.1 ether;
    uint24 internal constant RESERVE_BPS = 10;
    uint24 internal constant MAX_BPS = 500;

    uint256 internal constant ORDERS_PER_MAKER = 12;

    address[3] public makers = [address(0xAA01), address(0xAA02), address(0xAA03)];
    address[4] public bidders = [address(0xB101), address(0xB102), address(0xB103), address(0xB104)];
    address[2] public strangers = [address(0x5701), address(0x5702)];

    // --- tracked state ---------------------------------------------------------

    struct Tracked {
        address maker;
        bytes32 orderHash;
        uint40 commitEnd; // copied at open, so picking an auction by phase costs no calls
        uint40 revealEnd;
        uint40 windowEnd;
    }

    Tracked[] internal _auctions;
    mapping(bytes32 key => uint256) internal _bidCount;

    mapping(bytes32 key => mapping(address bidder => uint24)) internal _bps;
    mapping(bytes32 key => mapping(address bidder => bytes32)) internal _salt;

    // I-3: successful payouts per bid and per maker bond.
    mapping(bytes32 key => mapping(address bidder => uint256)) public bidPayouts;
    mapping(bytes32 key => uint256) public makerBondPayouts;

    // I-4: blocks in which a reveal, an exclusive-window fill, and a settle happened.
    mapping(bytes32 key => mapping(uint256 blockNumber => bool)) internal _revealAt;
    mapping(bytes32 key => mapping(uint256 blockNumber => bool)) internal _windowFillAt;
    mapping(bytes32 key => mapping(uint256 blockNumber => bool)) internal _settleAt;

    // I-5: a flag the handler saw being set by a checkOffer that observed a failure.
    mapping(bytes32 key => bool) public defaultEvidenced;

    // I-8: last queue index opened per maker (1-based), and the key it opened.
    mapping(address maker => uint256) internal _lastQueuedIndex;
    mapping(address maker => bytes32) internal _lastQueuedKey;

    uint256 public violationsI4;
    uint256 public violationsI5;
    uint256 public violationsI6;
    uint256 public violationsI8;
    string public lastViolation;

    mapping(bytes4 selector => uint256) public successes;

    constructor() {
        aqua = new MockAqua();
        book = new GlasshouseBookV2(bytes32(0), address(aqua));
        token = new InvToken("BOND");
        offer = new InvToken("OFFER");
        for (uint256 i; i < makers.length; i++) {
            token.mint(makers[i], 1e30);
            vm.startPrank(makers[i]);
            token.approve(address(book), type(uint256).max);
            offer.approve(address(aqua), type(uint256).max);
            vm.stopPrank();
        }
        for (uint256 i; i < bidders.length; i++) {
            token.mint(bidders[i], 1e30);
            vm.prank(bidders[i]);
            token.approve(address(book), type(uint256).max);
        }
        vm.roll(1000);
    }

    // --- views for the invariant contract -------------------------------------

    function auctionCount() external view returns (uint256) {
        return _auctions.length;
    }

    function auctionAt(uint256 i) external view returns (address maker, bytes32 orderHash) {
        return (_auctions[i].maker, _auctions[i].orderHash);
    }

    function makerCount() external pure returns (uint256) {
        return 3;
    }

    function bidderCount() external pure returns (uint256) {
        return 4;
    }

    // --- helpers ---------------------------------------------------------------

    function _violation(uint256 which, string memory why) internal {
        if (which == 4) violationsI4++;
        else if (which == 5) violationsI5++;
        else if (which == 6) violationsI6++;
        else violationsI8++;
        lastViolation = why;
    }

    function _orderName(address maker, uint256 i) internal pure returns (bytes32) {
        return keccak256(abi.encode(maker, i % ORDERS_PER_MAKER));
    }

    function _params(uint256 seed, bool bonded) internal view returns (OpenParams memory p) {
        p = OpenParams({
            router: ROUTER,
            commitBlocks: uint40(1 + seed % 2),
            revealBlocks: uint40(1 + (seed >> 8) % 2),
            tokenIn: address(token),
            exclusiveBlocks: uint40(1 + (seed >> 16) % 3),
            reserveBps: RESERVE_BPS,
            maxBps: MAX_BPS,
            bond: (seed >> 24) % 3 == 0 ? 0 : BOND,
            makerBond: bonded ? MAKER_BOND : 0,
            offerToken: bonded ? address(offer) : address(0),
            tlockRound: 0,
            minOffer: bonded ? MIN_OFFER : 0
        });
    }

    /// @dev Ship, and back the offer with a wallet balance and an allowance.
    function _makeFillable(address maker, bytes32 orderHash) internal {
        aqua.setRaw(maker, ROUTER, orderHash, address(offer), uint248(MIN_OFFER), 2);
        uint256 have = offer.balanceOf(maker);
        if (have < MIN_OFFER) offer.mint(maker, MIN_OFFER - have);
        vm.prank(maker);
        offer.approve(address(aqua), type(uint256).max);
    }

    function _track(address maker, bytes32 orderHash) internal {
        GlasshouseBookV2.Auction memory a = book.auctions(maker, orderHash);
        _auctions.push(Tracked(maker, orderHash, a.commitEnd, a.revealEnd, a.revealEnd + a.exclusiveBlocks));
    }

    uint8 internal constant _COMMIT = 0;
    uint8 internal constant _REVEAL = 1;
    uint8 internal constant _WINDOW = 2;
    uint8 internal constant _AFTER = 3;

    function _phaseOf(Tracked memory t) internal view returns (uint8) {
        if (block.number <= t.commitEnd) return _COMMIT;
        if (block.number <= t.revealEnd) return _REVEAL;
        if (block.number <= t.windowEnd) return _WINDOW;
        return _AFTER;
    }

    /// @dev Any tracked auction, uniformly. Most calls on it will revert, which is the
    ///      point: the Book must refuse them all the same way.
    function _pick(uint256 seed) internal view returns (bool ok, address maker, bytes32 orderHash, bytes32 k) {
        uint256 n = _auctions.length;
        if (n == 0) return (false, address(0), bytes32(0), bytes32(0));
        Tracked memory t = _auctions[(seed >> 8) % n];
        return (true, t.maker, t.orderHash, book.key(t.maker, t.orderHash));
    }

    /// @dev Four calls in five go to an auction in `phase`, when there is one, so that
    ///      the successful paths are exercised as often as the refusals; the fifth is
    ///      uniform over all auctions. Past the commit phase, auctions somebody bid on
    ///      are preferred, since an empty auction has nothing to reveal, fill or claim.
    function _pickIn(uint256 seed, uint8 phase) internal view returns (bool ok, address maker, bytes32 orderHash, bytes32 k) {
        uint256 n = _auctions.length;
        // Hashed first: the fuzzer favours edge values like 0 and max, which would
        // otherwise all land on the uniform branch.
        seed = uint256(keccak256(abi.encode(seed)));
        if (n == 0 || seed % 5 == 0) return _pick(seed);
        uint256 matching;
        uint256 withBids;
        for (uint256 i; i < n; i++) {
            if (_phaseOf(_auctions[i]) != phase) continue;
            matching++;
            if (_hasBids(_auctions[i])) withBids++;
        }
        if (matching == 0) return _pick(seed);
        bool needBids = phase != _COMMIT && withBids > 0;
        uint256 want = (seed >> 8) % (needBids ? withBids : matching);
        for (uint256 i; i < n; i++) {
            Tracked memory t = _auctions[i];
            if (_phaseOf(t) != phase || (needBids && !_hasBids(t))) continue;
            if (want == 0) return (true, t.maker, t.orderHash, book.key(t.maker, t.orderHash));
            want--;
        }
    }

    function _hasBids(Tracked memory t) internal view returns (bool) {
        return _bidCount[keccak256(abi.encodePacked(t.maker, t.orderHash))] > 0;
    }

    /// @dev The four facts, read independently of the Book's own `_offerFailure`.
    function _offerFails(address maker, bytes32 orderHash) internal view returns (bool) {
        (uint248 declared, uint8 count) = aqua.rawBalances(maker, ROUTER, orderHash, address(offer));
        if (count == 0 || count == 0xff) return true;
        if (declared < MIN_OFFER) return true;
        if (offer.balanceOf(maker) < MIN_OFFER) return true;
        if (offer.allowance(maker, address(aqua)) < MIN_OFFER) return true;
        return false;
    }

    // --- actions: opening -------------------------------------------------------

    function open(uint256 makerSeed, uint256 orderSeed, uint256 paramSeed, uint8 mode) external {
        address maker = makers[makerSeed % makers.length];
        bytes32 orderHash = _orderName(maker, orderSeed);
        mode = uint8(uint256(keccak256(abi.encode(mode, paramSeed)))); // spread edge values
        bool bonded = mode % 3 != 0;
        bool ship = mode % 7 != 0; // now and then, a bonded open against nothing: NotShipped
        if (bonded && ship) _makeFillable(maker, orderHash);

        vm.prank(maker);
        try book.open(orderHash, _params(paramSeed, bonded), new bytes32[](0)) {
            _track(maker, orderHash);
            successes[this.open.selector]++;
        } catch { }
    }

    function enqueue(uint256 makerSeed, uint256 orderSeed, uint256 countSeed, uint256 paramSeed, uint256 delaySeed, bool bonded)
        external
    {
        address maker = makers[makerSeed % makers.length];
        uint256 n = 1 + countSeed % 3;
        QueuedRound[] memory rounds = new QueuedRound[](n);
        for (uint256 i; i < n; i++) {
            bool b = bonded && (i % 2 == 0);
            rounds[i] = QueuedRound({
                orderHash: _orderName(maker, orderSeed % ORDERS_PER_MAKER + i),
                notBefore: uint40(block.number + (delaySeed >> (8 * i)) % 12),
                tip: (paramSeed >> i) % 2 == 0 ? TIP : 0,
                params: _params(paramSeed >> (4 * i), b)
            });
        }
        vm.prank(maker);
        try book.enqueue(rounds, new bytes32[](0)) {
            successes[this.enqueue.selector]++;
        } catch { }
    }

    function withdrawQueued(uint256 makerSeed, uint256 indexSeed) external {
        address maker = makers[makerSeed % makers.length];
        uint256 len = book.queueLength(maker);
        if (len == 0) return;
        vm.prank(maker);
        try book.withdrawQueued(indexSeed % len) {
            successes[this.withdrawQueued.selector]++;
        } catch { }
    }

    function openNext(uint256 makerSeed, uint256 callerSeed, bool shipHead, bool viaSettle) external {
        address maker = makers[makerSeed % makers.length];
        uint256 head = book.queueHead(maker);
        uint256 len = book.queueLength(maker);
        if (head >= len) return;

        QueuedRound memory r = book.queued(maker, head);
        if (shipHead && r.params.makerBond > 0) _makeFillable(maker, r.orderHash);

        bytes32 prev = book.queueCurrent(maker);
        bool prevSettledBefore = prev == bytes32(0) || _settled(prev);
        address caller = callerSeed % 2 == 0 ? strangers[callerSeed / 2 % 2] : bidders[callerSeed % 4];

        uint256 tipBefore = token.balanceOf(caller);
        bool ok;
        bytes32 prevOrder = _orderOf(maker, prev);
        if (viaSettle && prevOrder != bytes32(0) && !prevSettledBefore) {
            // The keeper's path: settle the current queued round and open the next.
            vm.prank(caller);
            try book.settleAndOpenNext(maker, prevOrder) {
                ok = true;
                _settleAt[prev][block.number] = true;
                if (_windowFillAt[prev][block.number]) _violation(4, "settle and window fill in one block");
                prevSettledBefore = _settled(prev); // settled inside the call, before the open
            } catch { }
        } else {
            vm.prank(caller);
            try book.openNext(maker) {
                ok = true;
            } catch { }
        }
        if (!ok) return;
        successes[this.openNext.selector]++;

        bytes32 k2 = book.key(maker, r.orderHash);
        GlasshouseBookV2.Auction memory a = book.auctions(maker, r.orderHash);

        // I-8: enqueue order, notBefore respected, previous queued round settled first.
        if (a.queueIndex != head + 1) _violation(8, "opened an entry other than the head");
        if (head + 1 <= _lastQueuedIndex[maker]) _violation(8, "queue order went backwards");
        if (block.number < r.notBefore) _violation(8, "opened before notBefore");
        if (!prevSettledBefore) _violation(8, "opened before the previous queued round settled");
        if (_lastQueuedKey[maker] != prev) _violation(8, "queueCurrent drifted");
        if (token.balanceOf(caller) - tipBefore != r.tip) _violation(8, "tip not paid to the opener");

        _lastQueuedIndex[maker] = head + 1;
        _lastQueuedKey[maker] = k2;
        _track(maker, r.orderHash);
    }

    function _orderOf(address maker, bytes32 k) internal view returns (bytes32) {
        if (k == bytes32(0)) return bytes32(0);
        for (uint256 i; i < ORDERS_PER_MAKER; i++) {
            if (book.key(maker, _orderName(maker, i)) == k) return _orderName(maker, i);
        }
        return bytes32(0);
    }

    function _settled(bytes32 k) internal view returns (bool) {
        for (uint256 i; i < _auctions.length; i++) {
            Tracked memory t = _auctions[i];
            if (book.key(t.maker, t.orderHash) == k) return book.auctions(t.maker, t.orderHash).settled;
        }
        return false;
    }

    // --- actions: bidding ---------------------------------------------------------

    /// @dev Each bidder whose bit is set in `mask` commits, with a bps drawn from `seed`
    ///      (a few out of range, so some bids can never reveal).
    function commit(uint256 auctionSeed, uint8 mask, uint256 seed) external {
        (bool ok, address maker, bytes32 orderHash, bytes32 k) = _pickIn(auctionSeed, _COMMIT);
        if (!ok) return;
        if (mask == 0) mask = 0xff;
        seed = uint256(keccak256(abi.encode(seed, "commit"))); // spread edge values
        for (uint256 i; i < bidders.length; i++) {
            if ((mask >> i) & 1 == 0) continue;
            address bidder = bidders[i];
            uint24 bps = uint24((seed >> (16 * i)) % (MAX_BPS + 20));
            bytes32 salt = keccak256(abi.encode(seed, i));
            bytes32 commitment = book.commitmentFor(bidder, bps, salt); // before the prank, which the next call consumes
            vm.prank(bidder);
            try book.commit(maker, orderHash, commitment, "", new bytes32[](0)) {
                _bps[k][bidder] = bps;
                _bidCount[k]++;
                _salt[k][bidder] = salt;
                successes[this.commit.selector]++;
            } catch { }
        }
    }

    /// @dev Each bidder whose bit is set in `mask` has its bid opened, by itself or by a
    ///      stranger, the maker or another bidder, chosen from `seed`; one in five tries a
    ///      wrong plaintext.
    function reveal(uint256 auctionSeed, uint8 mask, uint256 seed) external {
        (bool ok, address maker, bytes32 orderHash, bytes32 k) = _pickIn(auctionSeed, _REVEAL);
        if (!ok) return;
        if (mask == 0) mask = 0xff;
        seed = uint256(keccak256(abi.encode(seed, "reveal"))); // spread edge values
        for (uint256 i; i < bidders.length; i++) {
            if ((mask >> i) & 1 == 0) continue;
            uint256 s = seed >> (8 * i);
            address bidder = bidders[i];
            bool honest = (s >> 4) % 5 != 0;
            uint24 bps = honest ? _bps[k][bidder] : uint24(s % 600);
            bytes32 salt = honest ? _salt[k][bidder] : bytes32(s);

            bool done;
            uint256 who = s % 4;
            if (who == 0) {
                vm.prank(bidder);
                try book.reveal(maker, orderHash, bps, salt) {
                    done = true;
                } catch { }
            } else {
                address revealer = who == 1 ? strangers[0] : who == 2 ? maker : bidders[(i + 1) % bidders.length];
                vm.prank(revealer);
                try book.revealFor(maker, orderHash, bidder, bps, salt) {
                    done = true;
                } catch { }
            }
            if (!done) continue;
            successes[this.reveal.selector]++;
            _revealAt[k][block.number] = true;
            if (_windowFillAt[k][block.number]) _violation(4, "reveal and fill in one block");
            Outcome memory o = book.outcome(maker, orderHash);
            if (o.status != AuctionStatus.Bidding) _violation(4, "reveal landed outside Bidding");
        }
    }

    // --- actions: fill, offer, settle -------------------------------------------

    /// @dev Only what `GlasshouseAuctionLib.applyOutcome` would let through: nothing on
    ///      `Bidding`, only the winner inside the window, anyone after it. An unopened
    ///      auction has `router == 0`, so the hook reverts; that is the F-v2-1 path.
    function fill(uint256 auctionSeed, uint256 takerSeed) external {
        takerSeed = uint256(keccak256(abi.encode(takerSeed))); // spread edge values
        // One fill attempt in four inside the window: filling closes the offer check.
        (bool ok, address maker, bytes32 orderHash, bytes32 k) = _pickIn(auctionSeed, takerSeed % 4 == 0 ? _WINDOW : _AFTER);
        if (!ok) return;
        Outcome memory o = book.outcome(maker, orderHash);
        if (o.status != AuctionStatus.Closed) return;

        address taker = takerSeed % 3 == 0 ? strangers[1] : bidders[takerSeed % bidders.length];
        bool inWindow = block.number <= o.exclusiveUntil && o.winner != address(0);
        if (inWindow && taker != o.winner) return; // the gate reverts GlasshouseExclusiveWindow

        vm.prank(ROUTER);
        try book.postTransferIn(maker, taker, address(0), address(0), 1, 1, 0, orderHash, "", "") {
            successes[this.fill.selector]++;
            if (_revealAt[k][block.number]) _violation(4, "fill and reveal in one block");
            if (inWindow) {
                _windowFillAt[k][block.number] = true;
                if (_settleAt[k][block.number]) _violation(4, "window fill and settle in one block");
            }
        } catch { }
    }

    /// @dev Moves the maker's offer out from under an auction: dock it, shrink the
    ///      declared depth, drain the wallet, cut the allowance, or put it all back.
    function tamper(uint256 auctionSeed, uint256 kind) external {
        (bool ok, address maker, bytes32 orderHash,) = _pickIn(auctionSeed, _WINDOW);
        if (!ok) return;
        kind = uint256(keccak256(abi.encode(kind))) % 5;
        if (kind == 0) {
            aqua.setRaw(maker, ROUTER, orderHash, address(offer), 0, 0xff);
        } else if (kind == 1) {
            aqua.setRaw(maker, ROUTER, orderHash, address(offer), uint248(MIN_OFFER - 1), 2);
        } else if (kind == 2) {
            uint256 have = offer.balanceOf(maker);
            if (have > 0) offer.burn(maker, have);
        } else if (kind == 3) {
            vm.prank(maker);
            offer.approve(address(aqua), MIN_OFFER / 2);
        } else {
            _makeFillable(maker, orderHash);
        }
    }

    function checkOffer(uint256 auctionSeed, uint256 callerSeed) external {
        (bool ok, address maker, bytes32 orderHash, bytes32 k) = _pickIn(auctionSeed, _WINDOW);
        if (!ok) return;
        GlasshouseBookV2.Auction memory before = book.auctions(maker, orderHash);
        bool fails = before.makerBond > 0 && _offerFails(maker, orderHash);
        bool inWindow = block.number > before.revealEnd && block.number <= before.revealEnd + before.exclusiveBlocks;

        vm.prank(strangers[callerSeed % 2]);
        try book.checkOffer(maker, orderHash) {
            successes[this.checkOffer.selector]++;
            bool flagged = book.auctions(maker, orderHash).makerDefaulted;
            if (!before.makerDefaulted && flagged) {
                // I-5: set only here, only in the window, only on a bonded maker, only
                // on an observed failure, only with a winner and no fill yet.
                if (!inWindow) _violation(5, "flagged outside the window");
                if (before.makerBond == 0) _violation(5, "flagged an unbonded maker");
                if (!fails) _violation(5, "flagged without a failing fact");
                if (before.best == address(0) || before.filledBy != address(0)) _violation(5, "flagged with no winner or after a fill");
                defaultEvidenced[k] = true;
            }
            if (!before.makerDefaulted && !flagged && fails) _violation(5, "a failing fact went unflagged");
            if (before.makerDefaulted && !flagged) _violation(5, "flag cleared");
        } catch { }
    }

    function settle(uint256 auctionSeed) external {
        (bool ok, address maker, bytes32 orderHash, bytes32 k) = _pickIn(auctionSeed, _AFTER);
        if (!ok) return;
        try book.settle(maker, orderHash) {
            successes[this.settle.selector]++;
            _settleAt[k][block.number] = true;
            if (_windowFillAt[k][block.number]) _violation(4, "settle and window fill in one block");
        } catch { }
    }

    // --- actions: claims --------------------------------------------------------------

    function claimBond(uint256 auctionSeed, uint256 bidderSeed) external {
        (bool ok, address maker, bytes32 orderHash, bytes32 k) = _pickIn(auctionSeed, _AFTER);
        if (!ok) return;
        address bidder = bidders[bidderSeed % bidders.length];
        vm.prank(bidder);
        try book.claimBond(maker, orderHash) {
            bidPayouts[k][bidder]++;
            successes[this.claimBond.selector]++;
        } catch { }
    }

    function claimForfeit(uint256 auctionSeed) external {
        (bool ok, address maker, bytes32 orderHash, bytes32 k) = _pickIn(auctionSeed, _AFTER);
        if (!ok) return;
        address winner = book.auctions(maker, orderHash).best;
        vm.prank(maker);
        try book.claimForfeit(orderHash) {
            bidPayouts[k][winner]++;
            successes[this.claimForfeit.selector]++;
        } catch { }
    }

    function claimUnrevealed(uint256 auctionSeed, uint256 bidderSeed) external {
        (bool ok, address maker, bytes32 orderHash, bytes32 k) = _pickIn(auctionSeed, _AFTER);
        if (!ok) return;
        address bidder = bidders[bidderSeed % bidders.length];
        GlasshouseBookV2.Auction memory a = book.auctions(maker, orderHash);
        address expected = a.makerDefaulted ? a.best : maker;
        uint256 beforeBal = token.balanceOf(expected);
        vm.prank(maker);
        try book.claimUnrevealed(orderHash, bidder) {
            bidPayouts[k][bidder]++;
            successes[this.claimUnrevealed.selector]++;
            if (token.balanceOf(expected) - beforeBal != a.bond) _violation(6, "unrevealed forfeit paid the wrong party");
        } catch { }
    }

    function claimMakerBond(uint256 auctionSeed, uint256 callerSeed) external {
        (bool ok, address maker, bytes32 orderHash, bytes32 k) = _pickIn(auctionSeed, _AFTER);
        if (!ok) return;
        GlasshouseBookV2.Auction memory a = book.auctions(maker, orderHash);
        address caller = callerSeed % 2 == 0 ? maker : (a.best != address(0) ? a.best : bidders[callerSeed % 4]);

        vm.recordLogs();
        vm.prank(caller);
        try book.claimMakerBond(maker, orderHash) {
            makerBondPayouts[k]++;
            successes[this.claimMakerBond.selector]++;
            Vm.Log[] memory logs = vm.getRecordedLogs();
            for (uint256 i; i < logs.length; i++) {
                if (logs[i].topics[0] != IGlasshouseBookV2.MakerBondClaimed.selector) continue;
                address to = address(uint160(uint256(logs[i].topics[3])));
                (, bool slashed) = abi.decode(logs[i].data, (uint128, bool));
                // I-6: slashed => to == best and makerDefaulted; not slashed => to == maker.
                if (slashed && (to != a.best || !a.makerDefaulted)) _violation(6, "slash paid someone other than the winner");
                if (!slashed && to != maker) _violation(6, "unslashed bond paid someone other than the maker");
                if (slashed != a.makerDefaulted) _violation(6, "slash disagrees with the default flag");
            }
        } catch {
            vm.getRecordedLogs();
        }
    }

    /// @dev Time moves slowly on purpose: two roll calls in three do nothing, so a block
    ///      sees about forty other calls and every phase gets several of each action.
    ///      Now and then it jumps, so windows also elapse with nobody watching.
    function roll(uint256 blocks) external {
        blocks = uint256(keccak256(abi.encode(blocks)));
        if (blocks % 3 != 0) return;
        vm.roll(block.number + 1 + ((blocks >> 8) % 8 == 0 ? 4 : 0));
    }
}

/// @title GlasshouseBookV2Invariants
/// @notice I-2, I-3, I-4, I-5, I-6 and I-8 of `docs/design/v2.md` §3.8, over
///         {BookV2Handler}. I-1 is `test/GlasshouseBookDifferential.t.sol`, I-7 and I-9
///         are fuzz tests in `test/GlasshouseBookV2.t.sol`, I-10 is
///         `GlasshouseRouterUntouchedTest` there.
/// forge-config: default.invariant.runs = 24
/// forge-config: default.invariant.depth = 500
/// forge-config: default.invariant.check_interval = 5
contract GlasshouseBookV2Invariants is Test {
    BookV2Handler internal handler;
    GlasshouseBookV2 internal book;

    function setUp() public {
        handler = new BookV2Handler();
        book = handler.book();
        targetContract(address(handler));

        bytes4[] memory selectors = new bytes4[](15);
        selectors[0] = BookV2Handler.open.selector;
        selectors[1] = BookV2Handler.enqueue.selector;
        selectors[2] = BookV2Handler.withdrawQueued.selector;
        selectors[3] = BookV2Handler.openNext.selector;
        selectors[4] = BookV2Handler.commit.selector;
        selectors[5] = BookV2Handler.reveal.selector;
        selectors[6] = BookV2Handler.fill.selector;
        selectors[7] = BookV2Handler.tamper.selector;
        selectors[8] = BookV2Handler.checkOffer.selector;
        selectors[9] = BookV2Handler.settle.selector;
        selectors[10] = BookV2Handler.claimBond.selector;
        selectors[11] = BookV2Handler.claimForfeit.selector;
        selectors[12] = BookV2Handler.claimUnrevealed.selector;
        selectors[13] = BookV2Handler.claimMakerBond.selector;
        selectors[14] = BookV2Handler.roll.selector;
        targetSelector(FuzzSelector({ addr: address(handler), selectors: selectors }));
    }

    /// @dev Not an invariant of the Book: a check that each run is not vacuous.
    function afterInvariant() external view {
        assertGt(handler.auctionCount(), 0, "no auction ever opened");
    }

    /// @dev I-2. `tokenIn.balanceOf(book)` is exactly the unclaimed bidder bonds, plus
    ///      the unclaimed maker bonds, plus `makerBond + tip` of every unopened queued
    ///      entry. Every path out decrements exactly one term.
    function invariant_I2_EscrowConservation() public view {
        uint256 expected;
        uint256 n = handler.auctionCount();
        for (uint256 i; i < n; i++) {
            (address maker, bytes32 orderHash) = handler.auctionAt(i);
            GlasshouseBookV2.Auction memory a = book.auctions(maker, orderHash);
            for (uint256 j; j < handler.bidderCount(); j++) {
                GlasshouseBookV2.Bid memory b = book.bids(maker, orderHash, handler.bidders(j));
                if (b.commitment != bytes32(0) && !b.bondClaimed) expected += a.bond;
            }
            if (!a.makerBondClaimed) expected += a.makerBond;
        }
        for (uint256 m; m < handler.makerCount(); m++) {
            address maker = handler.makers(m);
            uint256 len = book.queueLength(maker);
            for (uint256 i; i < len; i++) {
                QueuedRound memory r = book.queued(maker, i);
                if (r.params.commitBlocks != 0) expected += uint256(r.params.makerBond) + r.tip;
            }
        }
        assertEq(handler.token().balanceOf(address(book)), expected, "escrow is not the sum of what is owed");
    }

    /// @dev I-3. Per bid, `bondClaimed` flips at most once and only through a claim path
    ///      that paid; per auction, likewise `makerBondClaimed`.
    function invariant_I3_EveryBondLeavesOnce() public view {
        uint256 n = handler.auctionCount();
        for (uint256 i; i < n; i++) {
            (address maker, bytes32 orderHash) = handler.auctionAt(i);
            bytes32 k = book.key(maker, orderHash);
            for (uint256 j; j < handler.bidderCount(); j++) {
                address bidder = handler.bidders(j);
                uint256 paid = handler.bidPayouts(k, bidder);
                assertLe(paid, 1, "a bid bond left twice");
                assertEq(book.bids(maker, orderHash, bidder).bondClaimed, paid == 1, "bondClaimed without a payout");
            }
            uint256 mpaid = handler.makerBondPayouts(k);
            assertLe(mpaid, 1, "a maker bond left twice");
            assertEq(book.auctions(maker, orderHash).makerBondClaimed, mpaid == 1, "makerBondClaimed without a payout");
        }
    }

    /// @dev I-4. No block admits both a reveal (`reveal` or `revealFor`) and a fill; no
    ///      block admits both an exclusive-window fill and `settle`.
    function invariant_I4_PhaseDisjointness() public view {
        assertEq(handler.violationsI4(), 0, handler.lastViolation());
    }

    /// @dev I-5. `makerDefaulted` only via a `checkOffer` in the window that observed a
    ///      failure, never on an unbonded maker, never cleared.
    function invariant_I5_DefaultNeedsEvidence() public view {
        assertEq(handler.violationsI5(), 0, handler.lastViolation());
        uint256 n = handler.auctionCount();
        for (uint256 i; i < n; i++) {
            (address maker, bytes32 orderHash) = handler.auctionAt(i);
            GlasshouseBookV2.Auction memory a = book.auctions(maker, orderHash);
            if (a.makerDefaulted) {
                assertTrue(handler.defaultEvidenced(book.key(maker, orderHash)), "default with no evidenced check");
                assertGt(a.makerBond, 0, "unbonded maker defaulted");
            }
        }
    }

    /// @dev I-6. Slash direction, and `winnerForfeited && makerDefaulted` unreachable.
    function invariant_I6_SlashDirection() public view {
        assertEq(handler.violationsI6(), 0, handler.lastViolation());
        uint256 n = handler.auctionCount();
        for (uint256 i; i < n; i++) {
            (address maker, bytes32 orderHash) = handler.auctionAt(i);
            GlasshouseBookV2.Auction memory a = book.auctions(maker, orderHash);
            assertFalse(a.winnerForfeited && a.makerDefaulted, "winner forfeited on a defaulted round");
        }
    }

    /// @dev I-8. Queued rounds open in enqueue order, at or after `notBefore`, each after
    ///      the previous queued round settled, and the opener gets the tip.
    function invariant_I8_QueueOrder() public view {
        assertEq(handler.violationsI8(), 0, handler.lastViolation());
    }
}
