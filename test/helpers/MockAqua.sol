// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title MockAqua
/// @notice The four Aqua entry points the v2 Book's offer check depends on, with the same
///         semantics as the pinned Aqua's `src/Aqua.sol:26-70`, for unit tests.
///
/// @dev Faithful where the Book looks:
///        - `rawBalances` returns `(balance, tokensCount)`; `tokensCount == 0` is never
///          shipped and `0xff` is docked (`Aqua.sol:19, :26-28`);
///        - `ship` keys by `keccak256(strategy)` and refuses to overwrite (`Aqua.sol:40-52`);
///        - `dock` stores `(0, 0xff)` for every token (`Aqua.sol:54-61`);
///        - `pull` decrements the declared balance and `safeTransferFrom`s the maker's
///          wallet, so an empty wallet or a missing allowance reverts (`Aqua.sol:63-70`).
///
/// @dev Not faithful, on purpose: {shipHash} ships under a caller-chosen strategy hash, so
///      a unit test can ship "the order" without building a SwapVM program; and
///      {setRaw} writes any state directly. Neither exists on the real Aqua.
contract MockAqua {
    using SafeERC20 for IERC20;

    uint8 internal constant _DOCKED = 0xff;

    struct Balance {
        uint248 amount;
        uint8 tokensCount;
    }

    mapping(address maker => mapping(address app => mapping(bytes32 strategyHash => mapping(address token => Balance)))) private
        _balances;

    error StrategiesMustBeImmutable(address app, bytes32 strategyHash);
    error DockingShouldCloseAllTokens(address app, bytes32 strategyHash);
    error MaxNumberOfTokensExceeded(uint256 tokensCount, uint256 maxTokensCount);

    function rawBalances(address maker, address app, bytes32 strategyHash, address token)
        external
        view
        returns (uint248 balance, uint8 tokensCount)
    {
        Balance storage b = _balances[maker][app][strategyHash][token];
        return (b.amount, b.tokensCount);
    }

    function ship(address app, bytes calldata strategy, address[] calldata tokens, uint256[] calldata amounts)
        external
        returns (bytes32 strategyHash)
    {
        strategyHash = keccak256(strategy);
        _ship(msg.sender, app, strategyHash, tokens, amounts);
    }

    /// @notice Test-only: ship under an explicit strategy hash.
    function shipHash(address app, bytes32 strategyHash, address[] calldata tokens, uint256[] calldata amounts) external {
        _ship(msg.sender, app, strategyHash, tokens, amounts);
    }

    function dock(address app, bytes32 strategyHash, address[] calldata tokens) external {
        for (uint256 i; i < tokens.length; ++i) {
            Balance storage b = _balances[msg.sender][app][strategyHash][tokens[i]];
            require(b.tokensCount == tokens.length, DockingShouldCloseAllTokens(app, strategyHash));
            b.amount = 0;
            b.tokensCount = _DOCKED;
        }
    }

    function pull(address maker, bytes32 strategyHash, address token, uint256 amount, address to) external {
        Balance storage b = _balances[maker][msg.sender][strategyHash][token];
        b.amount = b.amount - uint248(amount);
        IERC20(token).safeTransferFrom(maker, to, amount);
    }

    /// @notice Test-only: set any `(balance, tokensCount)` directly.
    function setRaw(address maker, address app, bytes32 strategyHash, address token, uint248 amount, uint8 tokensCount) external {
        _balances[maker][app][strategyHash][token] = Balance(amount, tokensCount);
    }

    function _ship(address maker, address app, bytes32 strategyHash, address[] calldata tokens, uint256[] calldata amounts)
        internal
    {
        require(tokens.length < _DOCKED, MaxNumberOfTokensExceeded(tokens.length, _DOCKED - 1));
        uint8 tokensCount = uint8(tokens.length);
        for (uint256 i; i < tokens.length; ++i) {
            Balance storage b = _balances[maker][app][strategyHash][tokens[i]];
            require(b.tokensCount == 0, StrategiesMustBeImmutable(app, strategyHash));
            b.amount = uint248(amounts[i]);
            b.tokensCount = tokensCount;
        }
    }
}
