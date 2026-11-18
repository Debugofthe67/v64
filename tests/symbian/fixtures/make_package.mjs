import { mkdirSync, writeFileSync } from "node:fs";
import { firmware_fixture } from "../fpsx_fixture.js";

const directory = new URL("../../../build/symbian/test-package/", import.meta.url);
// ARM probe entered by the fixture's normal XIP reset vector. Read the
// final page through CS0; only if its first cell is erased, unlock and
// program 0xA55A. Leave all other guest-visible cells alone.
const nand_probe = Buffer.from(
    "4c009fe54c109fe5b010c0e1793ba0e3021ba0e3b010c3e13c409fe50010" +
    "a0e3b010c4e1015ba0e3b060d5e12c709fe5070056e10500001a2710a0e3" +
    "b010c4e11c109fe5b010c5e18010a0e3b010c4e1feffffea00e20100ff07" +
    "000040e40100ffff00005aa50000", "hex");
nand_probe.writeUInt32LE(0xEA000004, 0x50); // branch over the literal table to the LCD test

// The ARM guest paints four quadrants into RGB565 SDRAM and submits them
// via the ordinary DISPC registers. The host never creates the image.
function display_probe()
{
    const instructions = [], loads = [];
    const emit = (...words) => instructions.push(...words);
    const literal = (register, value) => { loads.push([instructions.length, register, value]); emit(0); };
    const branch_nz = target => emit(0x1A000000 | (target - instructions.length - 2) & 0xFFFFFF);
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
            branch_nz(pixel_pair);
        }
        emit(0xE2544001); // SUBS r4, r4, #1
        branch_nz(row);
    }
    literal(0, dispc);
    for(const [offset, value] of [[0x7C, dimensions], [0x80, buffer], [0x8C, dimensions], [0xA0, 0x2AD],
        [0xAC, 1], [0xB0, 1], [0x40, 0x309]])
    {
        literal(1, value);
        emit(0xE5801000 | offset); // STR r1, [r0, #offset]
    }
    emit(0xEAFFFFFE); // idle
    for(const [index, register, value] of loads)
    {
        instructions[index] = 0xE59F0000 | register << 12 | (instructions.length - index - 2) * 4;
        emit(value);
    }
    return Buffer.from(Uint32Array.from(instructions).buffer);
}
const { parts, manifest } = firmware_fixture(Buffer.concat([nand_probe, display_probe()]));
mkdirSync(directory, { recursive: true });
const files = { ...parts, "RM505-test.vpl": manifest("059TEST"), "RM505-other.vpl": manifest("059OTHER") };
for(const [name, bytes] of Object.entries(files)) writeFileSync(new URL(name, directory), bytes);
writeFileSync(new URL("fixtures.json", directory), JSON.stringify(Object.keys(files)));
