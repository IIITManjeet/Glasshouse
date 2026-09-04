// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Simulator } from "@1inch/solidity-utils/contracts/mixins/Simulator.sol";

import { SwapVM } from "@1inch/swap-vm/src/SwapVM.sol";
import { Opcodes } from "@1inch/swap-vm/src/opcodes/Opcodes.sol";
import { Context } from "@1inch/swap-vm/src/libs/VM.sol";
import { Opcode, OpcodeOps } from "@1inch/swap-vm/src/libs/OpcodeList.sol";

import { GlasshouseAuction } from "../../src/instructions/GlasshouseAuction.sol";

/// @notice The full `Opcodes` set plus the Glasshouse gate.
///
/// @dev NEVER DEPLOYED. `SwapVMRouter` with the full opcode set is 29,159 bytes and
///      exceeds EIP-170; the test EVM does not enforce that limit, which is what lets
///      the comparison run `WhitelistSequential`, `DutchAuctionBalanceIn` and our
///      opcode against one another in a single router. The router we ship is
///      `GlasshouseRouter`, built on `AquaSwapVMRouter` and inside the limit.
contract GlasshouseFullOpcodes is Opcodes {
    using OpcodeOps for Opcode;

    function _runOpcode(Context memory ctx, uint256 opcode, bytes calldata args) internal virtual override {
        if (opcode == GlasshouseAuction.opcode.asU8()) GlasshouseAuction.exec(ctx, args);
        else super._runOpcode(ctx, opcode, args);
    }
}

contract GlasshouseTestRouter is Simulator, SwapVM, GlasshouseFullOpcodes {
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

