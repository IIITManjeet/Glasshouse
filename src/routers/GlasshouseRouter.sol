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
/// @notice Extends the deployed Aqua opcode set with the Glasshouse auction gate.
///
/// @dev Extension follows the upstream pattern exactly (see `AquaOpcodesDebug`):
///      override `_runOpcode`, handle the new opcodes, delegate the rest to `super`.
///      NOTE: the older `_opcodes()` array API that some prior hackathon projects
///      extended no longer exists in swap-vm HEAD.
///
/// @dev `WhitelistSequential` (0x2d) is re-added deliberately. It is NOT in
///      `AquaOpcodes` — the deployed Aqua router omits it — but our headline
///      comparison runs the same order under the cartel ladder and under the
///      auction, so the deployed router must be able to execute both.
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
/// @dev WHY WE EXTEND THE AQUA ROUTER AND NOT `SwapVMRouter`: the full-opcode
///      `SwapVMRouter` compiles to ~29,130 bytes and EXCEEDS the EIP-170 limit of
///      24,576 — it is not deployable at all. `AquaSwapVMRouter` is ~20,376 bytes,
///      leaving ~4,200 bytes of headroom, which is the budget this contract lives in.
///      Run `npm run size` after every change.
///
/// @dev The 1inch track explicitly permits this: "Official Aqua/SwapVM contracts must
///      be used (redeployments of a modified SwapVM contract is allowed)".
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
