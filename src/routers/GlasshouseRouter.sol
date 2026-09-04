// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Simulator } from "@1inch/solidity-utils/contracts/mixins/Simulator.sol";

import { Context } from "@1inch/swap-vm/src/libs/VM.sol";
import { Opcode, OpcodeOps } from "@1inch/swap-vm/src/libs/OpcodeList.sol";
import { SwapVM } from "@1inch/swap-vm/src/SwapVM.sol";
import { AquaOpcodes } from "@1inch/swap-vm/src/opcodes/AquaOpcodes.sol";
import { WhitelistSequential } from "@1inch/swap-vm/src/instructions/Whitelist.sol";

import { GlasshouseAuction } from "../instructions/GlasshouseAuction.sol";

/// @title GlasshouseOpcodes
/// @notice The deployed Aqua opcode set plus the Glasshouse auction gate.
/// @dev Extension follows upstream's own `AquaOpcodesDebug`: override `_runOpcode`,
///      handle the new opcodes, delegate the rest to `super`. The older `_opcodes()`
///      array API no longer exists at HEAD.
/// @dev `WhitelistSequential` (0x2d) is re-added deliberately. `AquaOpcodes` omits it,
///      and the comparison runs the same order under the ladder and under the auction.
contract GlasshouseOpcodes is AquaOpcodes {
    using OpcodeOps for Opcode;

    function _runOpcode(Context memory ctx, uint256 opcode, bytes calldata args) internal virtual override {
             if (opcode == GlasshouseAuction.opcode.asU8()) GlasshouseAuction.exec(ctx, args);
        else if (opcode == WhitelistSequential.opcode.asU8()) WhitelistSequential.exec(ctx, args);
        else super._runOpcode(ctx, opcode, args);
    }
}

/// @title GlasshouseRouter
/// @notice `AquaSwapVMRouter` plus the Glasshouse auction opcode (Path A).
///
/// @dev Built on `AquaSwapVMRouter`, not `SwapVMRouter`: the full-opcode router is
///      ~29,159 bytes and exceeds the EIP-170 limit of 24,576, so it cannot be
///      deployed at all. This contract lives in the Aqua router's ~4,200 bytes of
///      headroom. Run `npm run size` after every change.
contract GlasshouseRouter is Simulator, SwapVM, GlasshouseOpcodes {
    constructor(
        address aqua,
        address weth,
        address owner,
        string memory name,
        string memory version
    ) SwapVM(aqua, weth, owner, name, version) { }

    function _dispatch(Context memory ctx, uint256 opcode, bytes calldata args) internal override {
        _runOpcode(ctx, opcode, args);
    }
}
