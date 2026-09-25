// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { GlasshouseBookV2 } from "./GlasshouseBookV2.sol";

/// @title GlasshouseBookFactory
/// @notice Creates rooms. A room is one {GlasshouseBookV2} deployment with its own invite
///         root, its own storage and its own escrow.
///
/// @dev The Book has no owner and no flags, so a room cannot be a field inside one Book;
///      it is a deployment. Separate storage means a bug in one room cannot reach
///      another, and "invite-only" is a property of a contract rather than of a page.
///      `docs/design/v2.md` §5.
///
/// @dev No admin, no setter. `aqua` is immutable because every Book on a chain wants the
///      same one. The public room is simply `create(bytes32(0), "Glasshouse")`, called
///      once at deploy: there is no special Book.
///
/// @dev The router is not involved. A room's orders name that room's Book inside the
///      program's `0x2e` argument, so one router serves every room (§2).
contract GlasshouseBookFactory {
    /// @notice Longest room name `create` accepts, in bytes.
    uint256 public constant MAX_NAME_LENGTH = 64;

    /// @notice The Aqua passed to every Book this factory creates.
    address public immutable aqua;

    address[] private _rooms;

    /// @dev `name` lives only here. Neither the Book nor the factory stores it, and the
    ///      creator is not stored on the Book either: membership is the root, and the
    ///      creator is just the address that paid.
    event RoomCreated(address indexed book, address indexed creator, bytes32 inviteRoot, string name);

    /// @dev `name` is longer than {MAX_NAME_LENGTH} bytes.
    error NameTooLong(uint256 length);

    /// @param aqua_ The official Aqua on the target chain. Zero creates Books with no
    ///              maker-bond path, which refuse every bonded `open`.
    constructor(address aqua_) {
        aqua = aqua_;
    }

    /// @notice Deploy a new room.
    /// @dev Plain `CREATE`: deterministic addresses buy nothing, because indexers follow
    ///      {RoomCreated}. Permissionless; a room costs its creator one deployment.
    /// @param inviteRoot Zero for a public room; otherwise the root of an OpenZeppelin
    ///                   `StandardMerkleTree` over member addresses, fixed for the life of
    ///                   the room. A new list is a new room.
    /// @param name       Display name, at most {MAX_NAME_LENGTH} bytes, emitted only.
    /// @return book The new Book's address.
    function create(bytes32 inviteRoot, string calldata name) external returns (address book) {
        require(bytes(name).length <= MAX_NAME_LENGTH, NameTooLong(bytes(name).length));

        book = address(new GlasshouseBookV2(inviteRoot, aqua));
        _rooms.push(book);

        emit RoomCreated(book, msg.sender, inviteRoot, name);
    }

    /// @notice Number of rooms created.
    function count() external view returns (uint256) {
        return _rooms.length;
    }

    /// @notice The `i`-th room, in creation order. Room 0 is the public room.
    function roomAt(uint256 i) external view returns (address) {
        return _rooms[i];
    }
}
