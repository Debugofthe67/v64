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
        write_half(0x10022, 0xFDEF);
        write_half(0x10024, 0xFF7F);
        nand_command(0x80, 0, 0x8040);
        nand_command(0x13, 0, 0x8080);
        require_half(0x1002A, 0x6533); // last main ECC byte, first spare ECC byte
        require_half(0x1002C, 0xFFFE); // second spare ECC byte, reserved byte
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
    function reset_display()
    {
        literal(0, dispc);
        emit(0xE3A01002, 0xE5801010); // STR #2, [DISPC_SYSCONFIG]
        const asserted = instructions.length;
        emit(0xE5902014, 0xE3120001); // LDR r2, [DISPC_SYSSTATUS]; TST r2, #1
        branch(1, asserted); // The original driver waits for reset assertion.
        emit(0xE3A01000, 0xE5801010); // Clear SYSCONFIG like the original driver.
        const completed = instructions.length;
        emit(0xE5902014, 0xE3120001);
        branch(0, completed);
    }
    reset_display();
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
    const card_calls = [];
    for(const [condition, command] of [[1, 0x28], [0, 0x29]])
    {
        const poll = instructions.length;
        card_calls.push(instructions.length);
        emit(0); // BL check_microSD, linked below
        emit(0xE5932000, 0xE3120C01); // LDR r2, [r3]; TST r2, #0x100 (GENIO40)
        branch(condition, poll);
        loss_word(0x0C, command);
        if(command === 0x28)
        {
            reset_display();
            literal(0, 0x20032100);
        }
    }
    branch(14, idle);
    // Scan the real active-low GENIO45. On first insertion, initialize the
    // raw SD card and copy its boot sector through the RAPIDO MMC FIFO.
    for(const index of card_calls) instructions[index] = 0xEB000000 | instructions.length - index - 2;
    literal(10, 0x0A080000);
    emit(0xE59A5004, 0xE2855001, 0xE58A5004); // Increment in-RAM guest heartbeat.
    emit(0xE59A5000, 0xE3550000, 0x112FFF1E); // Once read, return on nonzero STAT.
    emit(0xE5935000, 0xE3150A02, 0x112FFF1E); // TST r5, #0x2000; BXNE lr
    for(const [address, value] of [[0x20031C94, 0x4000], [0x20031CC4, 0x1000]])
    {
        literal(4, address);
        literal(5, value);
        emit(0xE5845000); // Enable MMC clock, select removable slot.
    }
    literal(4, 0x20032800);
    const mmc_word = (offset, word) => {
        literal(5, word);
        emit(0xE1C450B0 | (offset & 0xF0) << 4 | offset & 0x0F); // STRH r5, [r4, #offset]
    };
    const card_command = (cmd, argument = 0) => {
        mmc_word(0x10, 0xFFFF);
        mmc_word(4, argument & 0xFFFF);
        mmc_word(8, argument >>> 16);
        mmc_word(0, cmd);
    };
    mmc_word(0x0C, 0x801);
    for(const [word, argument] of [[0], [0x1608, 0x1AA], [0x1137], [0x1329, 0x40FF8000],
        [0x1202], [0x1603], [0x2907, 0x10000]]) card_command(word, argument);
    mmc_word(0x24, 511);
    mmc_word(0x28, 0);
    card_command(0xB111); // CMD17, read sector zero.
    literal(6, 0x0A080200);
    emit(0xE3A07C01); // MOV r7, #256 halfwords
    const fifo = instructions.length;
    emit(0xE1D452B0, 0xE0C650B2, 0xE2577001); // LDRH from FIFO; STRH [r6], #2; SUBS r7, #1
    branch(1, fifo);
    emit(0xE1D451B0, 0xE58A5000, 0xE12FFF1E); // Publish STAT after the data is in guest RAM.
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
