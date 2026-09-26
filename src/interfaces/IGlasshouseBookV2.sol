// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { IGlasshouseBook } from "./IGlasshouseBook.sol";

/// @notice Everything {IGlasshouseBookV2-open} takes except the order hash, which is
///         passed beside it so a queued entry can carry the hash and the parameters
///         as two separate things.
/// @param router          Whose `postTransferIn` hook the Book trusts, and the Aqua `app`
///                        the offer check reads under.
/// @param tokenIn         Denomination of every bond and tip on this auction.
/// @param commitBlocks    Length of the commit phase, from the opening block.
/// @param revealBlocks    Length of the reveal phase, after the commit phase.
/// @param exclusiveBlocks Length of the winner's exclusive window, after the reveal phase.
/// @param reserveBps      Maker's implicit second bid.
/// @param maxBps          Reveals above this are rejected.
/// @param bond            Per bidder, in `tokenIn`, escrowed at commit.
/// @param makerBond       Escrowed from the maker at open, in `tokenIn`. Zero is allowed
///                        and means an unbonded maker.
/// @param offerToken      Token the maker promises to deliver. Read by the offer check.
/// @param tlockRound      drand round the bids are sealed to, or zero for plain
///                        commit-reveal. Recorded, never validated on chain.
/// @param minOffer        Declared depth in `offerToken`, in its own units.
/// @dev Field order follows storage packing, not reading order: a queued entry stores
///      this struct, and this order fits it in five slots instead of seven.
struct OpenParams {
    address router;
    uint40 commitBlocks;
    uint40 revealBlocks;
    address tokenIn;
    uint40 exclusiveBlocks;
    uint24 reserveBps;
    uint24 maxBps;
    uint128 bond;
    uint128 makerBond;
    address offerToken;
    uint64 tlockRound;
    uint128 minOffer;
}

/// @notice One entry in a maker's queue of rounds.
/// @param orderHash Order the round is for; the maker ships it to Aqua before it opens.
/// @param notBefore Earliest block {IGlasshouseBookV2-openNext} may open it. The maker's pacing.
/// @param tip       Paid in `params.tokenIn` to whoever calls `openNext` for this entry.
/// @param params    Everything `open` takes, minus the order hash.
struct QueuedRound {
    bytes32 orderHash;
    uint40 notBefore;
    uint128 tip;
    OpenParams params;
}

/// @title IGlasshouseBookV2
/// @notice The v2 Book's external surface: rooms, a maker bond with an on-chain offer
///         check, self-opening rounds, invite-gated open and commit, anyone-can-reveal.
/// @dev Extends {IGlasshouseBook} without changing it. `outcome` and its `Outcome` struct
///      are what the instruction reads, and they are byte-identical to v1.
interface IGlasshouseBookV2 is IGlasshouseBook {
    // --- events -------------------------------------------------------------------

    event AuctionOpened(
        address indexed maker,
        bytes32 indexed orderHash,
        address router,
        address tokenIn,
        uint40 commitEnd,
        uint40 revealEnd,
        uint40 exclusiveBlocks,
        uint24 reserveBps,
        uint24 maxBps,
        uint128 bond,
        uint128 makerBond,
        address offerToken,
        uint128 minOffer,
        uint64 tlockRound
    );
    event QueuedRoundOpened(address indexed maker, bytes32 indexed orderHash, address indexed opener, uint128 tip);
    event RoundsEnqueued(address indexed maker, uint256 fromIndex, uint256 count);
    event QueuedRoundWithdrawn(address indexed maker, uint256 index, bytes32 orderHash);
    event BidCommitted(address indexed maker, bytes32 indexed orderHash, address indexed bidder, uint40 commitIdx, bytes ciphertext);
    event BidRevealed(address indexed maker, bytes32 indexed orderHash, address indexed bidder, uint24 bps, address revealedBy);
    event AuctionFilled(address indexed maker, bytes32 indexed orderHash, address indexed taker, uint256 amountIn, uint256 amountOut);
    event MakerDefaulted(address indexed maker, bytes32 indexed orderHash, uint8 reason, uint256 observed, uint256 required);
    event AuctionSettled(
        address indexed maker, bytes32 indexed orderHash, address winner, uint24 clearingBps, bool winnerForfeited, bool makerDefaulted
    );
    event BondClaimed(address indexed maker, bytes32 indexed orderHash, address indexed bidder, uint128 amount);
    event ForfeitClaimed(address indexed maker, bytes32 indexed orderHash, address indexed bidder, uint128 amount);
    event UnrevealedForfeited(address indexed maker, bytes32 indexed orderHash, address indexed bidder, uint128 amount, address recipient);
    event MakerBondClaimed(address indexed maker, bytes32 indexed orderHash, address indexed to, uint128 amount, bool slashed);

    // --- errors: kept from v1, same selectors -------------------------------------

    error AlreadyOpened();
    error NotOpened();
    error BadWindow();
    error CommitClosed();
    error RevealClosed();
    error RevealNotOpen();
    error AlreadyCommitted();
    error NoCommitment();
    error AlreadyRevealed();
    error BadReveal();
    error BidOutOfRange(uint24 bps, uint24 reserveBps, uint24 maxBps);
    error NotRouter();
    error NotSettled();
    error AlreadySettled();
    error WindowNotElapsed();
    error NothingToClaim();

    // --- errors: new in v2 --------------------------------------------------------

    /// @dev `inviteRoot != 0` and the proof does not verify for `msg.sender`.
    error NotMember();
    /// @dev `makerBond > 0` on a Book with `aqua == 0`: a bond nothing could ever slash.
    error NoEvidencePath();
    /// @dev `makerBond > 0` and Aqua reports the strategy absent, docked, or below `minOffer`.
    error NotShipped();
    /// @dev Ciphertext length does not match the auction's `tlockRound` setting.
    error BadCiphertext();
    /// @dev Outside the winner's window, no winner, already filled, or unbonded maker.
    error OfferCheckNotOpen();
    /// @dev The maker has no unopened queued round.
    error QueueEmpty();
    /// @dev The maker's last queued round has not been settled.
    error PreviousRoundOpen();
    /// @dev The head entry's `notBefore` block has not been reached.
    error NotBefore(uint40 notBefore);
    /// @dev Index already opened, withdrawn, or out of range.
    error NotQueued();

    // --- functions ----------------------------------------------------------------

    function inviteRoot() external view returns (bytes32);
    function aqua() external view returns (address);

    function key(address maker, bytes32 orderHash) external pure returns (bytes32);
    function commitmentFor(address bidder, uint24 bps, bytes32 salt) external pure returns (bytes32);

    function open(bytes32 orderHash, OpenParams calldata p, bytes32[] calldata proof) external;
    function enqueue(QueuedRound[] calldata rounds, bytes32[] calldata proof) external;
    function withdrawQueued(uint256 index) external;
    function openNext(address maker) external;
    function settleAndOpenNext(address maker, bytes32 orderHash) external;

    function commit(address maker, bytes32 orderHash, bytes32 commitment, bytes calldata ciphertext, bytes32[] calldata proof)
        external;
    function reveal(address maker, bytes32 orderHash, uint24 bps, bytes32 salt) external;
    function revealFor(address maker, bytes32 orderHash, address bidder, uint24 bps, bytes32 salt) external;

    function checkOffer(address maker, bytes32 orderHash) external;
    function settle(address maker, bytes32 orderHash) external;

    function claimBond(address maker, bytes32 orderHash) external;
    function claimForfeit(bytes32 orderHash) external;
    function claimUnrevealed(bytes32 orderHash, address bidder) external;
    function claimMakerBond(address maker, bytes32 orderHash) external;

    function queueLength(address maker) external view returns (uint256);
    function queueHead(address maker) external view returns (uint256);
    function queueCurrent(address maker) external view returns (bytes32);
    function queued(address maker, uint256 index) external view returns (QueuedRound memory);
}
