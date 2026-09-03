// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Test } from "forge-std/Test.sol";

import { Opcode, OpcodeOps } from "@1inch/swap-vm/src/libs/OpcodeList.sol";
import { InstructionBuilder } from "@1inch/swap-vm/src/libs/InstructionBuilder.sol";

import { GlasshouseAuction } from "../src/instructions/GlasshouseAuction.sol";

/// @dev `parse` reads `bytes calldata`, so it can only be exercised across an
///      external call boundary.
contract ArgsHarness {
    function parseArgs(bytes calldata instruction) external pure returns (address book, uint24 maxBps) {
        // Skip the 2-byte instruction header [opcode][argsLength].
        return GlasshouseAuction.parse(instruction[2:]);
    }
}

/// @title GlasshouseArgsTest
/// @notice THE FIRST TEST WRITTEN, DELIBERATELY.
///
/// `InstructionArgs.at(shift)` is a raw `calldataload` with NO bounds checking. A
/// wrong offset does not revert — it silently returns zeros or neighbouring bytes.
/// That failure mode is invisible until a swap misprices, so the encoding is pinned
/// down here before any auction logic depends on it.
contract GlasshouseArgsTest is Test {
    using OpcodeOps for Opcode;

    ArgsHarness internal harness;

    function setUp() public {
        harness = new ArgsHarness();
    }

    function test_Layout_IsHeaderPlus23Bytes() public pure {
        // [opcode:1][argsLength:1] + address:20 + uint24:3
        assertEq(GlasshouseAuction.sizeOf(address(0), 0), InstructionBuilder.sizeOf() + 23);
        assertEq(InstructionBuilder.sizeOf(), 2);
    }

    function test_Opcode_Is0x2e_RightAfterWhitelistSequential() public pure {
        // 0x2d is WhitelistSequential — the cartel ladder this instruction replaces.
        // 0x2e is the next free slot in the same "Conditions & access guards" bank.
        assertEq(GlasshouseAuction.opcode.asU8(), 0x2e);
        assertEq(uint8(Opcode.WhitelistSequential), 0x2d);
    }

    function test_Build_EmitsCorrectHeader() public pure {
        bytes memory ins = GlasshouseAuction.build(address(0xBEEF), 250);
        assertEq(ins.length, 25);
        assertEq(uint8(ins[0]), 0x2e, "opcode byte");
        assertEq(uint8(ins[1]), 23, "args length byte");
    }

    function test_RoundTrip_Simple() public view {
        address book = address(0x1111113CCf1426A8E30e2bfF5E005d929bF6a90a);
        uint24 maxBps = 500;

        (address gotBook, uint24 gotMax) = harness.parseArgs(GlasshouseAuction.build(book, maxBps));

        assertEq(gotBook, book, "book address round-trip");
        assertEq(gotMax, maxBps, "maxBps round-trip");
    }

    /// @dev The offsets are the whole risk. Fuzz them.
    function testFuzz_RoundTrip(address book, uint24 maxBps) public view {
        (address gotBook, uint24 gotMax) = harness.parseArgs(GlasshouseAuction.build(book, maxBps));
        assertEq(gotBook, book);
        assertEq(gotMax, maxBps);
    }

    /// @dev Catches the classic failure: `maxBps` bleeding into the address field or
    ///      vice versa. With all-ones in both, any offset error corrupts one of them.
    function test_RoundTrip_AllOnes_CatchesFieldBleed() public view {
        address book = address(type(uint160).max);
        uint24 maxBps = type(uint24).max;

        (address gotBook, uint24 gotMax) = harness.parseArgs(GlasshouseAuction.build(book, maxBps));

        assertEq(gotBook, book, "address must not lose bytes to maxBps");
        assertEq(gotMax, maxBps, "maxBps must not lose bytes to address");
    }

    /// @dev Zero in one field must not corrupt the other — the mirror of the above.
    function test_RoundTrip_MixedExtremes() public view {
        (address b1, uint24 m1) = harness.parseArgs(GlasshouseAuction.build(address(type(uint160).max), 0));
        assertEq(b1, address(type(uint160).max));
        assertEq(m1, 0);

        (address b2, uint24 m2) = harness.parseArgs(GlasshouseAuction.build(address(0), type(uint24).max));
        assertEq(b2, address(0));
        assertEq(m2, type(uint24).max);
    }
}
