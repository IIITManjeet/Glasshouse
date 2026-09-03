// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Context } from "@1inch/swap-vm/src/libs/VM.sol";
import { Opcode } from "@1inch/swap-vm/src/libs/OpcodeList.sol";
import { MemoryPtr, MemoryPtrLib } from "@1inch/swap-vm/src/libs/MemoryPtr.sol";
import { InstructionBuilder } from "@1inch/swap-vm/src/libs/InstructionBuilder.sol";
import { InstructionArgs } from "@1inch/swap-vm/src/libs/InstructionArgs.sol";

import { GlasshouseAuctionLib } from "../lib/GlasshouseAuctionLib.sol";

/// @notice GlasshouseAuction opcode. Allocates taker priority by sealed competitive
///         bid instead of by identity (`WhitelistSequential`, 0x2d) or by clock
///         (`DutchAuctionBalanceIn`, 0x94).
///
/// @dev Encoding: [address book, uint24 maxImprovementBps]  (23 bytes)
///
/// @dev Slot choice: `OpcodeList` reserves 0x20-0x3f for "Conditions & access guards"
///      and instructs new instructions to take the next free `_Ix` slot of their
///      family bank. This instruction is a taker gate, and `_2e` is the next free
///      slot after `WhitelistSequential` (0x2d) — the opcode immediately after the
///      cartel ladder it replaces. All 256 enum members already exist upstream, so
///      NO 1inch file is modified or vendored.
///
/// @dev Why no `nextPC`: the whitelist opcodes jump because they grant a *shortcut*
///      past subsequent gates. Glasshouse instead adjusts a register and either
///      reverts or falls through — the adjustment IS the branch, so a jump target
///      would be dead weight in both bytecode and args.
///
/// @dev Why no `auctionId` in args: it is `ctx.query.orderHash`, which binds exactly
///      one auction to exactly one order for free. The Book namespaces by
///      `ctx.query.maker` as well, so nobody can open an auction against someone
///      else's order.
library GlasshouseAuction {
    using InstructionArgs for bytes;
    using InstructionArgs for bytes32;

    using MemoryPtrLib for MemoryPtr;
    using InstructionBuilder for MemoryPtr;

    Opcode constant opcode = Opcode._2e;

    function sizeOf(address, uint24) internal pure returns (uint256) {
        return InstructionBuilder.sizeOf() + 20 + 3;
    }

    function build(address book, uint24 maxImprovementBps) internal pure returns (bytes memory) {
        return build(MemoryPtrLib.alloc(sizeOf(book, maxImprovementBps)), book, maxImprovementBps).resolve();
    }

    function build(MemoryPtr ptrStart, address book, uint24 maxImprovementBps) internal pure returns (MemoryPtr ptr) {
        ptr = ptrStart.pushHeader(opcode);
        ptr = ptr.push(book).push(maxImprovementBps, 3);
        ptrStart.patchLength(ptr);
    }

    function parse(bytes calldata args) internal pure returns (address book, uint24 maxImprovementBps) {
        book = args.at(0).asAddress();
        maxImprovementBps = args.at(20).asU24();
    }

    /// @dev `view`, never `nonpayable`: the instruction executes under STATICCALL in
    ///      `quote()`. See {GlasshouseAuctionLib-applyOutcome}.
    function exec(Context memory ctx, bytes calldata args) internal view {
        (address book, uint24 maxImprovementBps) = parse(args);
        ctx.swap = GlasshouseAuctionLib.applyOutcome(ctx.query, ctx.swap, book, maxImprovementBps);
    }
}
