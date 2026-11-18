import { mkdirSync, writeFileSync } from "node:fs";
import { N97_BML_USER_BLOCKS } from "../../../src/symbian/n97_flash.js";
import { firmware_fixture } from "../fpsx_fixture.js";

const directory = new URL("../../../build/symbian/test-package/", import.meta.url);
// ARM probe entered by the fixture's normal XIP reset vector. Read the
// first page of the last user block; only if its first cell is erased, unlock and
// program 0xA55A. Leave all other guest-visible cells alone.
const nand_probe = Buffer.from(
    "4c009fe54c109fe5b010c0e1793ba0e3021ba0e3b010c3e13c409fe50010" +
    "a0e3b010c4e1015ba0e3b060d5e12c709fe5070056e10500001a2710a0e3" +
    "b010c4e11c109fe5b010c5e18010a0e3b010c4e1feffffea00e20100d107" +
    "000040e40100ffff00005aa50000", "hex");
nand_probe.writeUInt32LE(0xEA000004, 0x50); // branch over the literal table to the next test

// The ARM guest paints four quadrants into RGB565 SDRAM and sends them
// through DISPC and the two LoSSI targets.
function device_probe()
{
    const instructions = [], loads = [];
    const emit = (...words) => instructions.push(...words);
    const literal = (register, value) => { loads.push([instructions.length, register, value]); emit(0); };
    const branch = (condition, target) => emit(condition << 28 | 0x0A000000 | (target - instructions.length - 2) & 0xFFFFFF);
    // r6/r7 are the old probe word and 0xFFFF, respectively. Only the first
    // boot programs and then erases the two preceding user blocks.
    emit(0xE1560007); // CMP r6, r7
    const skip_erase = instructions.length;
    emit(0);
    const write_half = (address, value) => {
        literal(0, address);
        literal(1, value);
        emit(0xE1C010B0); // STRH r1, [r0]
    };
    const require_half = (address, value) => {
        literal(0, address);
        emit(0xE1D010B0); // LDRH r1, [r0]
        literal(2, value);
        emit(0xE1510002, 0x1AFFFFFE); // CMP r1, r2; BNE .
    };
    const nand_command = (value, status, interrupt) => {
        write_half(0x1E482, 0);
        write_half(0x1E440, value);
        require_half(0x1E480, status);
        require_half(0x1E482, interrupt);
    };
    const first = N97_BML_USER_BLOCKS - 3, last = first + 1;
    for(const block of [first, last])
    {
        write_half(0x1E200, block);
        write_half(0x1E498, block);
        nand_command(0x23, 0, 0x8000);
        nand_command(0, 0, 0x8080);
        write_half(0x400, 0x125A);
        write_half(0x10020, 0x4567);
        nand_command(0x80, 0, 0x8040);
    }
    write_half(0x1E200, first);
    nand_command(0x95, 0x8800, 0x8020);
    write_half(0x1E200, last);
    nand_command(0x94, 0, 0x8020);
    for(const block of [first, last])
    {
        write_half(0x1E200, block);
        nand_command(0x71, 0, 0x8000);
    }
    instructions[skip_erase] = 0x1A000000 | instructions.length - skip_erase - 2; // BNE to display

    const buffer = 0x0A000000, dispc = 0x20024800, dimensions = 359 << 16 | 639;
    literal(0, buffer);
    for(const [left, right] of [[0xF800, 0x07E0], [0x001F, 0xFFFF]])
    {
        literal(1, left | left << 16);
        literal(3, right | right << 16);
        emit(0xE3A040B4); // MOV r4, #180 rows
        const row = instructions.length;
        for(const color of [1, 3])
        {
            emit(0xE3A020A0); // MOV r2, #160 pixel pairs
            const pixel_pair = instructions.length;
            emit(0xE4800004 | color << 12, 0xE2522001); // STR color, [r0], #4; SUBS r2, r2, #1
            branch(1, pixel_pair);
        }
        emit(0xE2544001); // SUBS r4, r4, #1
        branch(1, row);
    }
    function loss_word(port, byte)
    {
        emit(0xE3A01000 | byte, 0xE5C01000 | port); // MOV r1, #byte; STRB r1, [r0, #port]
        const poll = instructions.length;
        emit(0xE5902018, 0xE3120001); // LDR r2, [r0, #0x18]; TST r2, #1
        branch(0, poll);
    }
    literal(0, 0x20032100);
    loss_word(4, 0x11);
    loss_word(4, 0x3A);
    loss_word(8, 0x70);
    for(const [command, end] of [[0x2A, 639], [0x2B, 359]])
    {
        loss_word(4, command);
        for(const byte of [0, 0, 0, 0, end >>> 8, end & 255]) loss_word(8, byte);
    }
    loss_word(4, 0x2C);
    loss_word(0x0C, 0x11);
    loss_word(0x0C, 0x3A);
    loss_word(0x10, 7);
    loss_word(0x0C, 0x29);
    literal(0, dispc);
    for(const [offset, value] of [[0x7C, dimensions], [0x80, buffer], [0x8C, dimensions], [0xA0, 0x2AD],
        [0xAC, 1], [0xB0, 1], [0x40, 0x309]])
    {
        literal(1, value);
        emit(0xE5801000 | offset); // STR r1, [r0, #offset]
    }
    // Use the side switch as a deterministic test stimulus for the TFT.
    literal(0, 0x20032100);
    literal(3, 0x20031D88);
    const idle = instructions.length;
    for(const [condition, command] of [[1, 0x28], [0, 0x29]])
    {
        const poll = instructions.length;
        emit(0xE5932000, 0xE3120C01); // LDR r2, [r3]; TST r2, #0x100 (GENIO40)
        branch(condition, poll);
        loss_word(0x0C, command);
    }
    branch(14, idle);
    for(const [index, register, value] of loads)
    {
        instructions[index] = 0xE59F0000 | register << 12 | (instructions.length - index - 2) * 4;
        emit(value);
    }
    return Buffer.from(Uint32Array.from(instructions).buffer);
}
const { parts, manifest } = firmware_fixture(Buffer.concat([nand_probe, device_probe()]));
mkdirSync(directory, { recursive: true });
const files = { ...parts, "RM505-test.vpl": manifest("059TEST"), "RM505-other.vpl": manifest("059OTHER") };
for(const [name, bytes] of Object.entries(files)) writeFileSync(new URL(name, directory), bytes);
writeFileSync(new URL("fixtures.json", directory), JSON.stringify(Object.keys(files)));
