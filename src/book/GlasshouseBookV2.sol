// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { MerkleProof } from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

import { IMakerHooks } from "@1inch/swap-vm/src/interfaces/IMakerHooks.sol";
import { IAqua } from "@1inch/aqua/src/interfaces/IAqua.sol";

import { IGlasshouseBook, Outcome, AuctionStatus } from "../interfaces/IGlasshouseBook.sol";
import { IGlasshouseBookV2, OpenParams, QueuedRound } from "../interfaces/IGlasshouseBookV2.sol";

/// @title GlasshouseBookV2
/// @notice Sealed-bid, second-price auction for the right to fill a SwapVM order, one
///         deployment per room.
///
/// @dev v1 (`GlasshouseBook`) is the reference and its semantics are carried forward
///      unchanged: `open` / `commit` / `reveal` / `outcome` / `settle` / the claims, the
///      O(1) top-2, the phase rule and "forfeiture needs positive evidence". What v2
///      adds, per `docs/design/v2.md` §3:
///        - an invite root gating `open`, `enqueue` and `commit` (§3.3);
///        - a maker bond, slashed to the winner only on positive evidence from Aqua that
///          the offer was not there during the winner's window (§3.1);
///        - a per-maker queue of pre-funded rounds anyone may open for a tip (§3.2);
///        - `revealFor`, and a timelock ciphertext carried in the commit event (§3.4).
///
/// @dev No owner, no upgrade path, no admin. `inviteRoot` and `aqua` are immutable, and
///      every auction parameter is immutable after it opens. Nothing can change what
///      `outcome()` returns.
///
/// @dev Phases are disjoint in block space, which is the core safety property:
///        commit  block.number <= commitEnd
///        reveal  commitEnd < block.number <= revealEnd
///        fill    block.number > revealEnd
///      No block holds both a reveal and a fill, so the top-2 is frozen before any
///      fill can observe it. `revealFor` is `reveal` with the bidder named, so it obeys
///      the same bounds.
contract GlasshouseBookV2 is IGlasshouseBookV2, IMakerHooks {
    using SafeERC20 for IERC20;

    uint256 internal constant BPS = 10_000;

    /// @notice Length of a drand quicknet IBE ciphertext `U || V || W`: a compressed G2
    ///         point and two 32-byte words. `docs/design/v2.md` §4.4.
    uint256 public constant TLOCK_CIPHERTEXT_LEN = 160;

    /// @dev Aqua's marker for a docked strategy (`Aqua.sol:19`).
    uint8 internal constant _AQUA_DOCKED = 0xff;

    /// @dev {MakerDefaulted} reasons. First failure wins; the check stops there.
    uint8 internal constant _REASON_NOT_SHIPPED = 1; // never shipped, or docked
    uint8 internal constant _REASON_DECLARED = 2; // Aqua's declared balance < minOffer
    uint8 internal constant _REASON_WALLET = 3; // maker's wallet balance < minOffer
    uint8 internal constant _REASON_ALLOWANCE = 4; // maker's allowance to Aqua < minOffer

    /// @dev Declared in storage-slot order; see `docs/design/v2.md` §3.5. `outcome()`
    ///      reads slots 0, 1 and 3 only, and nothing in them is written after
    ///      `revealEnd`.
    struct Auction {
        // --- slot 0: immutable after open() ---
        address router; // whose postTransferIn hook we trust, and the Aqua app
        uint40 commitEnd;
        uint40 revealEnd;
        // --- slot 1: immutable after open() ---
        address tokenIn; // bond, maker bond and tip denomination
        uint40 exclusiveBlocks;
        uint24 reserveBps; // maker's implicit second bid
        uint24 maxBps; // reveals above this are rejected
        // --- slot 2: immutable after open() ---
        uint128 bond; // per bidder, in tokenIn
        uint128 makerBond; // from the maker, in tokenIn
        // --- slot 3: written only by reveal/revealFor, only while block.number <= revealEnd ---
        address best;
        uint24 bestBps;
        uint40 bestCommitIdx;
        // Only the runner-up PRICE is kept. Which address held it is reveal-order
        // dependent on ties; `secondBps` is not.
        uint24 secondBps;
        // --- slot 4: never read by outcome() ---
        uint40 commitCount;
        address filledBy;
        bool settled;
        bool winnerForfeited;
        bool makerDefaulted;
        bool makerBondClaimed;
        // --- slot 5: immutable after open() ---
        address offerToken;
        uint64 tlockRound; // stored so commit can check the ciphertext length
        // --- slot 6: immutable after open() ---
        uint128 minOffer;
        uint40 queueIndex; // 0 = opened directly, else 1-based position in the maker's queue
    }

    struct Bid {
        bytes32 commitment;
        uint40 commitIdx;
        bool revealed;
        bool bondClaimed;
    }

    /// @notice Zero for a public room; otherwise the invite list's Merkle root.
    bytes32 public immutable inviteRoot;
    /// @notice The Aqua the offer check reads; zero disables the maker bond.
    address public immutable aqua;

    mapping(bytes32 key => Auction) private _auctions;
    mapping(bytes32 key => mapping(address bidder => Bid)) private _bids;

    mapping(address maker => QueuedRound[]) private _queue;
    mapping(address maker => uint256) private _queueHead; // no unopened entry below this index
    mapping(address maker => bytes32) private _queueCurrent; // key of the last queued round opened

    /// @param inviteRoot_ Zero for a public room; otherwise the root of an OpenZeppelin
    ///                    `StandardMerkleTree` over member addresses, gating `open`,
    ///                    `enqueue` and `commit`.
    /// @param aqua_       The Aqua the offer check reads. Zero disables the maker bond.
    constructor(bytes32 inviteRoot_, address aqua_) {
        inviteRoot = inviteRoot_;
        aqua = aqua_;
    }

    function key(address maker, bytes32 orderHash) public pure returns (bytes32) {
        return keccak256(abi.encodePacked(maker, orderHash));
    }

    /// @notice Compute the commitment for a sealed bid.
    /// @dev A convenience, but not only that: hand-packing this wrong produces a
    ///      commitment that can never be revealed, and since the bond escrows at
    ///      {commit} the bidder then loses it. A bidder should always take the
    ///      commitment from here rather than construct it themselves.
    function commitmentFor(address bidder, uint24 bps, bytes32 salt) public pure returns (bytes32) {
        return keccak256(abi.encodePacked(bidder, bps, salt));
    }

    // --- opening -------------------------------------------------------------------

    /// @notice Open an auction for one of your own orders.
    /// @dev `msg.sender` is the maker and namespaces the key, so an auction cannot be
    ///      squatted on someone else's order. With `p.makerBond > 0` the order must be
    ///      shipped to Aqua already, and the bond is pulled here in `p.tokenIn`.
    /// @param proof Membership proof for `msg.sender`; ignored in a public room.
    function open(bytes32 orderHash, OpenParams calldata p, bytes32[] calldata proof) external {
        _requireMember(proof);
        OpenParams memory params = p;
        _open(msg.sender, orderHash, params, 0);
        if (params.makerBond > 0) IERC20(params.tokenIn).safeTransferFrom(msg.sender, address(this), params.makerBond);
    }

    /// @notice Queue rounds for anyone to open later, in order, for a tip.
    /// @dev Pulls `makerBond + tip` for every entry now, so an opener never depends on
    ///      the maker's allowance or balance at opening time. Parameters are validated
    ///      here so a queued entry can only fail to open for reasons the maker fixes by
    ///      shipping or withdrawing: `NotShipped` or `AlreadyOpened`.
    function enqueue(QueuedRound[] calldata rounds, bytes32[] calldata proof) external {
        _requireMember(proof);

        QueuedRound[] storage q = _queue[msg.sender];
        uint256 fromIndex = q.length;
        for (uint256 i; i < rounds.length; ++i) {
            _validate(rounds[i].params);
            q.push(rounds[i]);
        }
        emit RoundsEnqueued(msg.sender, fromIndex, rounds.length);

        for (uint256 i; i < rounds.length; ++i) {
            uint256 amount = uint256(rounds[i].params.makerBond) + rounds[i].tip;
            if (amount > 0) IERC20(rounds[i].params.tokenIn).safeTransferFrom(msg.sender, address(this), amount);
        }
    }

    /// @notice Take back an unopened queued round and its `makerBond + tip`.
    /// @dev The only way past a head entry that cannot open. Nobody else can skip it;
    ///      skipping would let a stranger reorder a maker's rounds.
    function withdrawQueued(uint256 index) external {
        QueuedRound[] storage q = _queue[msg.sender];
        require(index < q.length && q[index].params.commitBlocks != 0, NotQueued());

        QueuedRound memory r = q[index];
        delete q[index];

        emit QueuedRoundWithdrawn(msg.sender, index, r.orderHash);

        uint256 amount = uint256(r.params.makerBond) + r.tip;
        if (amount > 0) IERC20(r.params.tokenIn).safeTransfer(msg.sender, amount);
    }

    /// @notice Open the maker's next queued round and collect its tip.
    /// @dev Permissionless. Opens only what the maker enqueued and funded, only in the
    ///      maker's order, only at or after `notBefore`, only once the previous queued
    ///      round has settled. The worst a stranger can do is open the next round at the
    ///      earliest moment the maker allowed.
    function openNext(address maker) external {
        _openNext(maker);
    }

    /// @notice {settle} then {openNext}, for a keeper or a visitor who wants the tip in
    ///         one transaction.
    /// @dev `settle` itself never opens anything: a revert here leaves `settle` callable
    ///      on its own, so no maker-controlled state can make an auction unsettleable.
    function settleAndOpenNext(address maker, bytes32 orderHash) external {
        _settle(maker, orderHash);
        _openNext(maker);
    }

    // --- bidding -------------------------------------------------------------------

    /// @notice Commit to a sealed bid. `commitment = keccak256(bidder, bps, salt)`.
    /// @dev Sealed for shill resistance, not anti-sniping: in an open second-price
    ///      auction the maker could insert a bid just under the top.
    /// @param ciphertext Empty when the auction's `tlockRound == 0`; otherwise exactly
    ///                   {TLOCK_CIPHERTEXT_LEN} bytes, emitted and never stored or read.
    /// @param proof      Membership proof for `msg.sender`; ignored in a public room.
    function commit(address maker, bytes32 orderHash, bytes32 commitment, bytes calldata ciphertext, bytes32[] calldata proof)
        external
    {
        bytes32 k = key(maker, orderHash);
        Auction storage a = _auctions[k];
        require(a.commitEnd != 0, NotOpened());
        require(block.number <= a.commitEnd, CommitClosed());
        _requireMember(proof);
        require(ciphertext.length == (a.tlockRound == 0 ? 0 : TLOCK_CIPHERTEXT_LEN), BadCiphertext());
        // A zero commitment can never be revealed or claimed, and would leave the slot
        // looking uncommitted: v1 accepts it and strands the bond. Refused here.
        require(commitment != bytes32(0), NoCommitment());

        Bid storage b = _bids[k][msg.sender];
        require(b.commitment == bytes32(0), AlreadyCommitted());

        b.commitment = commitment;
        b.commitIdx = a.commitCount;
        unchecked { a.commitCount = a.commitCount + 1; }

        // The bond is taken here, not at reveal. Taken at reveal, staying silent would
        // be free -- and a runner-up who stays silent drops `secondBps` to the reserve
        // and hands the winner a near-free fill. See {claimUnrevealed}.
        uint128 bond = a.bond;
        if (bond > 0) IERC20(a.tokenIn).safeTransferFrom(msg.sender, address(this), bond);

        emit BidCommitted(maker, orderHash, msg.sender, b.commitIdx, ciphertext);
    }

    /// @notice Reveal your own committed bid.
    function reveal(address maker, bytes32 orderHash, uint24 bps, bytes32 salt) external {
        _reveal(maker, orderHash, msg.sender, bps, salt);
    }

    /// @notice Reveal someone else's committed bid, typically after decrypting its
    ///         timelock ciphertext.
    /// @dev Permissionless. The commitment binds `bidder`, so only the true `(bps, salt)`
    ///      opens it, and the result is independent of who reveals or in what order.
    function revealFor(address maker, bytes32 orderHash, address bidder, uint24 bps, bytes32 salt) external {
        _reveal(maker, orderHash, bidder, bps, salt);
    }

    /// @inheritdoc IGlasshouseBook
    /// @dev MUST stay `view` and O(1). See {GlasshouseAuctionLib-applyOutcome}.
    ///      Byte-for-byte the v1 rule: reads slots 0, 1 and 3 only.
    function outcome(address maker, bytes32 orderHash) external view returns (Outcome memory) {
        Auction storage a = _auctions[key(maker, orderHash)];

        if (a.commitEnd == 0) {
            return Outcome(AuctionStatus.None, address(0), 0, 0);
        }
        if (block.number <= a.revealEnd) {
            return Outcome(AuctionStatus.Bidding, address(0), 0, 0);
        }
        if (a.best == address(0)) {
            // Nobody revealed: no winner, no exclusive window, open immediately.
            return Outcome(AuctionStatus.Closed, address(0), 0, a.revealEnd);
        }

        // Second price with reserve. One reveal leaves `secondBps` at 0, so this
        // collapses to the reserve and the price is defined at any bidder count.
        uint24 clearingBps = a.secondBps > a.reserveBps ? a.secondBps : a.reserveBps;

        return Outcome(AuctionStatus.Closed, a.best, clearingBps, a.revealEnd + a.exclusiveBlocks);
    }

    // --- fill, offer check, settlement ----------------------------------------------

    /// @notice Records who filled the order.
    /// @dev `swap()` calls maker hooks and `quote()` does not. Hooks run outside the
    ///      program, so writing here cannot affect quote/swap consistency. Reverts for an
    ///      auction that was never opened (`a.router == 0`), which is what keeps a
    ///      hook-bearing queued order unfillable until its round opens.
    function postTransferIn(
        address maker,
        address taker,
        address,
        address,
        uint256 amountIn,
        uint256 amountOut,
        uint256,
        bytes32 orderHash,
        bytes calldata,
        bytes calldata
    ) external {
        bytes32 k = key(maker, orderHash);
        Auction storage a = _auctions[k];
        require(msg.sender == a.router, NotRouter());

        if (a.filledBy == address(0)) {
            a.filledBy = taker;
            emit AuctionFilled(maker, orderHash, taker, amountIn, amountOut);
        }
    }

    /// @notice Check, from Aqua and the offer token, that the maker's offer is fillable
    ///         while the winner holds exclusivity. Flags a default if it is not.
    /// @dev Permissionless, and only inside `(revealEnd, revealEnd + exclusiveBlocks]`
    ///      with a winner, no fill yet and a bonded maker. There, only the winner can
    ///      fill, so "unfilled and unfillable" means exactly one thing: the maker sold
    ///      exclusivity on something that was not there. Before the window the maker may
    ///      still be arranging inventory; after it the maker may legitimately dock.
    /// @dev Sticky: once flagged, later calls are no-ops that emit nothing. A passing
    ///      check writes nothing. Residual: a dock in the last block of the window after
    ///      the last check in it is not caught.
    function checkOffer(address maker, bytes32 orderHash) external {
        Auction storage a = _auctions[key(maker, orderHash)];
        uint256 revealEnd = a.revealEnd;
        require(
            a.makerBond > 0 && block.number > revealEnd && block.number <= revealEnd + a.exclusiveBlocks && a.best != address(0)
                && a.filledBy == address(0),
            OfferCheckNotOpen()
        );
        if (a.makerDefaulted) return;

        (uint8 reason, uint256 observed) = _offerFailure(maker, orderHash, a.router, a.offerToken, a.minOffer, true);
        if (reason != 0) {
            a.makerDefaulted = true;
            emit MakerDefaulted(maker, orderHash, reason, observed, a.minOffer);
        }
    }

    /// @notice Close out an auction once the exclusive window has elapsed.
    /// @dev Permissionless. Decides only whether the winner forfeits and reports whether
    ///      the maker defaulted; bonds are claimed individually, so there is no unbounded
    ///      loop. Never opens a round: it must stay the one function nothing the maker
    ///      controls can block.
    function settle(address maker, bytes32 orderHash) external {
        _settle(maker, orderHash);
    }

    // --- claims --------------------------------------------------------------------

    /// @notice Reclaim your bond after settlement.
    /// @dev A winner whose maker defaulted always reclaims here: {settle} never sets
    ///      `winnerForfeited` on a defaulted auction.
    function claimBond(address maker, bytes32 orderHash) external {
        bytes32 k = key(maker, orderHash);
        Auction storage a = _auctions[k];
        require(a.settled, NotSettled());

        Bid storage b = _bids[k][msg.sender];
        require(b.revealed && !b.bondClaimed, NothingToClaim());
        require(!(a.winnerForfeited && msg.sender == a.best), NothingToClaim());

        b.bondClaimed = true;
        uint128 bond = a.bond;
        if (bond > 0) IERC20(a.tokenIn).safeTransfer(msg.sender, bond);

        emit BondClaimed(maker, orderHash, msg.sender, bond);
    }

    /// @notice Maker collects the winner's forfeited bond.
    /// @dev Sizing `bond >= maxBps * notional / BPS` makes a winner no-show unprofitable.
    ///      Withholding a reveal is covered by {claimUnrevealed}. This bounds, but does
    ///      not solve, bidder-ring collusion.
    /// @dev Residual: this fires only when someone else filled. A no-show that nobody
    ///      else fills behind keeps its bond, deliberately -- see {settle}.
    function claimForfeit(bytes32 orderHash) external {
        bytes32 k = key(msg.sender, orderHash);
        Auction storage a = _auctions[k];
        require(a.settled, NotSettled());
        require(a.winnerForfeited, NothingToClaim());

        address winner = a.best;
        Bid storage b = _bids[k][winner];
        require(!b.bondClaimed, NothingToClaim());
        b.bondClaimed = true;

        uint128 bond = a.bond;
        if (bond > 0) IERC20(a.tokenIn).safeTransfer(msg.sender, bond);

        emit ForfeitClaimed(msg.sender, orderHash, winner, bond);
    }

    /// @notice Maker triggers the forfeit of a bidder who committed and never revealed.
    /// @dev Needs no hook and no trust in the maker's configuration: whether a commitment
    ///      was revealed is something the Book observed. Silence is a bidder fault either
    ///      way, but a maker who defaulted must not profit from the round it broke, so
    ///      then the bond goes to the winner (D-v2-3). The maker still calls this.
    /// @param orderHash The maker's order.
    /// @param bidder    The bidder who committed without revealing.
    function claimUnrevealed(bytes32 orderHash, address bidder) external {
        bytes32 k = key(msg.sender, orderHash);
        Auction storage a = _auctions[k];
        require(a.settled, NotSettled());

        Bid storage b = _bids[k][bidder];
        require(b.commitment != bytes32(0) && !b.revealed && !b.bondClaimed, NothingToClaim());
        b.bondClaimed = true;

        address recipient = a.makerDefaulted ? a.best : msg.sender;
        uint128 bond = a.bond;
        if (bond > 0) IERC20(a.tokenIn).safeTransfer(recipient, bond);

        emit UnrevealedForfeited(msg.sender, orderHash, bidder, bond, recipient);
    }

    /// @notice Collect the maker bond after settlement: the winner's if the maker
    ///         defaulted, the maker's otherwise.
    /// @dev Only the recipient may call, so "winner claims, maker cannot" and the reverse
    ///      are both enforced rather than merely routed.
    function claimMakerBond(address maker, bytes32 orderHash) external {
        Auction storage a = _auctions[key(maker, orderHash)];
        require(a.settled, NotSettled());
        require(a.makerBond > 0 && !a.makerBondClaimed, NothingToClaim());

        bool slashed = a.makerDefaulted;
        address to = slashed ? a.best : maker;
        require(msg.sender == to, NothingToClaim());

        a.makerBondClaimed = true;
        uint128 amount = a.makerBond;
        IERC20(a.tokenIn).safeTransfer(to, amount);

        emit MakerBondClaimed(maker, orderHash, to, amount, slashed);
    }

    // --- views ---------------------------------------------------------------------

    function auctions(address maker, bytes32 orderHash) external view returns (Auction memory) {
        return _auctions[key(maker, orderHash)];
    }

    function bids(address maker, bytes32 orderHash, address bidder) external view returns (Bid memory) {
        return _bids[key(maker, orderHash)][bidder];
    }

    /// @notice Number of entries ever enqueued by `maker`, opened and withdrawn included.
    function queueLength(address maker) external view returns (uint256) {
        return _queue[maker].length;
    }

    /// @notice Index {openNext} would open next, or {queueLength} if none is left.
    function queueHead(address maker) external view returns (uint256) {
        return _nextQueued(maker);
    }

    /// @notice Key of the maker's last queued round opened, or zero.
    function queueCurrent(address maker) external view returns (bytes32) {
        return _queueCurrent[maker];
    }

    /// @notice A queued entry. All zero once opened or withdrawn.
    function queued(address maker, uint256 index) external view returns (QueuedRound memory) {
        return _queue[maker][index];
    }

    // --- internals -----------------------------------------------------------------

    /// @dev OpenZeppelin `StandardMerkleTree` leaf: the address, ABI-encoded and hashed
    ///      twice, so the site builds proofs with OpenZeppelin's merkle-tree package as is.
    function _requireMember(bytes32[] calldata proof) internal view {
        bytes32 root = inviteRoot;
        if (root == bytes32(0)) return;
        bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(msg.sender))));
        require(MerkleProof.verifyCalldata(proof, root, leaf), NotMember());
    }

    /// @dev The static checks shared by {open} and {enqueue}: the v1 window rules, a bond
    ///      backing a non-empty promise, and an evidence path for any bond.
    function _validate(OpenParams memory p) internal view {
        // A zero-length exclusive window lets an outsider fill at the base price in the
        // same block, which makes bidding strictly dominated by not bidding.
        require(p.commitBlocks > 0 && p.revealBlocks > 0 && p.exclusiveBlocks > 0, BadWindow());
        require(p.reserveBps <= p.maxBps && p.maxBps < BPS, BadWindow());
        require(p.makerBond == 0 || p.minOffer > 0, BadWindow());
        // A bond that can never be slashed is theatre: refused rather than accepted and
        // ignored. Signature-mode orders have no on-chain offer to inspect.
        require(p.makerBond == 0 || aqua != address(0), NoEvidencePath());
    }

    /// @dev Writes and announces an auction. Does not move tokens; callers do.
    function _open(address maker, bytes32 orderHash, OpenParams memory p, uint40 queueIndex) internal returns (bytes32 k) {
        k = key(maker, orderHash);
        Auction storage a = _auctions[k];
        require(a.commitEnd == 0, AlreadyOpened());
        _validate(p);
        if (p.makerBond > 0) {
            // Shipped now, and deep enough. Wallet and allowance are the window's
            // business: the maker may still be arranging inventory.
            (uint8 reason,) = _offerFailure(maker, orderHash, p.router, p.offerToken, p.minOffer, false);
            require(reason == 0, NotShipped());
        }

        uint40 commitEnd = uint40(block.number) + p.commitBlocks;
        uint40 revealEnd = commitEnd + p.revealBlocks;

        a.router = p.router;
        a.commitEnd = commitEnd;
        a.revealEnd = revealEnd;
        a.tokenIn = p.tokenIn;
        a.exclusiveBlocks = p.exclusiveBlocks;
        a.reserveBps = p.reserveBps;
        a.maxBps = p.maxBps;
        a.bond = p.bond;
        a.makerBond = p.makerBond;
        a.offerToken = p.offerToken;
        a.tlockRound = p.tlockRound;
        a.minOffer = p.minOffer;
        a.queueIndex = queueIndex;

        emit AuctionOpened(
            maker,
            orderHash,
            p.router,
            p.tokenIn,
            commitEnd,
            revealEnd,
            p.exclusiveBlocks,
            p.reserveBps,
            p.maxBps,
            p.bond,
            p.makerBond,
            p.offerToken,
            p.minOffer,
            p.tlockRound
        );
    }

    function _openNext(address maker) internal {
        QueuedRound[] storage q = _queue[maker];
        uint256 i = _nextQueued(maker);
        require(i < q.length, QueueEmpty());

        bytes32 current = _queueCurrent[maker];
        require(current == bytes32(0) || _auctions[current].settled, PreviousRoundOpen());

        QueuedRound memory r = q[i];
        require(block.number >= r.notBefore, NotBefore(r.notBefore));

        delete q[i];
        _queueHead[maker] = i + 1;
        // The bond was escrowed at enqueue; it now backs this auction instead.
        _queueCurrent[maker] = _open(maker, r.orderHash, r.params, uint40(i + 1));

        emit QueuedRoundOpened(maker, r.orderHash, msg.sender, r.tip);

        if (r.tip > 0) IERC20(r.params.tokenIn).safeTransfer(msg.sender, r.tip);
    }

    /// @dev First entry at or after the stored head that is neither opened nor withdrawn.
    ///      Skipping withdrawn entries costs the caller one read each; only the maker can
    ///      create them, and only by withdrawing rounds it funded.
    function _nextQueued(address maker) internal view returns (uint256 i) {
        QueuedRound[] storage q = _queue[maker];
        uint256 len = q.length;
        i = _queueHead[maker];
        while (i < len && q[i].params.commitBlocks == 0) ++i;
    }

    function _settle(address maker, bytes32 orderHash) internal {
        Auction storage a = _auctions[key(maker, orderHash)];
        require(a.commitEnd != 0, NotOpened());
        require(!a.settled, AlreadySettled());
        require(block.number > a.revealEnd + a.exclusiveBlocks, WindowNotElapsed());

        a.settled = true;
        // Forfeiture requires positive evidence that someone else filled.
        //
        // `filledBy` is written only by {postTransferIn}, which fires only if the maker's
        // signed order sets the hook at this Book and `a.router` is the router that
        // filled. The Book sees neither, so a maker who omits the hook or names the wrong
        // router could otherwise force every honest winner to forfeit and collect the
        // bond. Where nothing filled at all the Book cannot tell a no-show from a broken
        // configuration, so it does not punish. Residual noted in {claimForfeit}.
        //
        // A winner whose maker defaulted never forfeits. The flag proves the offer was
        // not fillable while the winner held exclusivity, so a fill by someone else
        // after the window (when the gate opens the order to all) is not the winner's
        // no-show. Without this, a maker could default, re-fund, fill from a second
        // address before settle, and collect the winner's bond against its own.
        a.winnerForfeited =
            !a.makerDefaulted && a.best != address(0) && a.filledBy != address(0) && a.filledBy != a.best;

        uint24 clearingBps = a.secondBps > a.reserveBps ? a.secondBps : a.reserveBps;
        emit AuctionSettled(
            maker, orderHash, a.best, a.best == address(0) ? 0 : clearingBps, a.winnerForfeited, a.makerDefaulted
        );
    }

    /// @dev Maintains the top-2 in O(1), so {outcome} needs no loop on the taker's gas
    ///      budget. Reveal order does not change the result: max is order-independent,
    ///      and ties break on commit index, fixed before anyone knew they were tying.
    ///      Who calls does not change it either: `bidder` is what the commitment binds.
    function _reveal(address maker, bytes32 orderHash, address bidder, uint24 bps, bytes32 salt) internal {
        bytes32 k = key(maker, orderHash);
        Auction storage a = _auctions[k];
        require(a.commitEnd != 0, NotOpened());
        require(block.number > a.commitEnd, RevealNotOpen());
        require(block.number <= a.revealEnd, RevealClosed());
        require(bps >= a.reserveBps && bps <= a.maxBps, BidOutOfRange(bps, a.reserveBps, a.maxBps));

        Bid storage b = _bids[k][bidder];
        require(b.commitment != bytes32(0), NoCommitment());
        require(!b.revealed, AlreadyRevealed());
        require(b.commitment == keccak256(abi.encodePacked(bidder, bps, salt)), BadReveal());

        b.revealed = true;

        // The `a.best == address(0)` arm must come first: with `reserveBps == 0` a
        // valid `bps == 0` bid satisfies neither `bps > a.bestBps` nor
        // `bps > a.secondBps`, so the only revealed bidder would fail to win.
        if (a.best == address(0) || bps > a.bestBps || (bps == a.bestBps && b.commitIdx < a.bestCommitIdx)) {
            a.secondBps = a.bestBps;
            a.best = bidder;
            a.bestBps = bps;
            a.bestCommitIdx = b.commitIdx;
        } else if (bps > a.secondBps) {
            a.secondBps = bps;
        }

        emit BidRevealed(maker, orderHash, bidder, bps, msg.sender);
    }

    /// @dev The four facts a fill needs, read from chain in the order a fill would hit
    ///      them. Returns the first failure and what was observed, in `offerToken` units
    ///      (for reason 1, Aqua's declared balance, which docking zeroes). With
    ///      `walletToo == false` only the two Aqua facts are read, which is the `open`
    ///      check.
    function _offerFailure(address maker, bytes32 orderHash, address router, address offerToken, uint128 minOffer, bool walletToo)
        internal
        view
        returns (uint8 reason, uint256 observed)
    {
        address aqua_ = aqua;
        (uint248 declared, uint8 tokensCount) = IAqua(aqua_).rawBalances(maker, router, orderHash, offerToken);
        if (tokensCount == 0 || tokensCount == _AQUA_DOCKED) return (_REASON_NOT_SHIPPED, declared);
        if (declared < minOffer) return (_REASON_DECLARED, declared);
        if (!walletToo) return (0, 0);

        // Aqua's `pull` is `safeTransferFrom(maker, to, amount)`: both must cover it.
        uint256 wallet = IERC20(offerToken).balanceOf(maker);
        if (wallet < minOffer) return (_REASON_WALLET, wallet);
        uint256 allowance = IERC20(offerToken).allowance(maker, aqua_);
        if (allowance < minOffer) return (_REASON_ALLOWANCE, allowance);
        return (0, 0);
    }

    // --- IMakerHooks: unused legs ---
    function preTransferIn(address, address, address, address, uint256, uint256, bytes32, bytes calldata, bytes calldata) external {}
    function preTransferOut(address, address, address, address, uint256, uint256, bytes32, bytes calldata, bytes calldata) external {}
    function postTransferOut(address, address, address, address, uint256, uint256, uint256, bytes32, bytes calldata, bytes calldata) external {}
}
