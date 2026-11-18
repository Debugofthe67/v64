// RM-505 loader handoff. The stock bootstrap uses 0x30000010 for r0–r3
// and 0x30001000 as its initial stack top. See docs/symbian-n97.md.

import { sha256_hex } from "../image/sha256.js";

export const N97_LAYOUT_VERSION = 4;
export const N97_RAM_BASE = 0x08000000;
export const N97_RAM_SIZE = 128 * 1024 * 1024;
export const N97_SRAM_BASE = 0x30000000;
export const N97_SRAM_SIZE = 16 * 1024;
export const N97_DEVICE_MEMORY = N97_SRAM_SIZE + 8;
const N97_CORE_ADDRESS = 0x088FF000;
const N97_CORE_HEADER_OFFSET = 0x1000;
export const N97_ROM_ADDRESS = N97_CORE_ADDRESS + N97_CORE_HEADER_OFFSET;
export const N97_BOOT_TOC = 0x0FCFF000;
export const N97_BOOT_TIMER = 0x20040480;
export const N97_BOOT_CONTROL = 0x20040308;
export const N97_BOOT_MAILBOX = 0x20032D10;
export const N97_BOOT_DEBUG_COOKIE = 0x10001F00;

// The POR configuration uses the loader's tag sizes and reverse insertion
// order. RAP3NAND stores the resulting R2 pointer in SRAM at 0x30003EF8.
function cold_boot_tags()
{
    const clock = new DataView(new ArrayBuffer(8));
    clock.setFloat64(0, 433.92, true);
    const records = [
        [16, 0x00080000, 0x08140000],
        [9, 0x01400000, N97_RAM_BASE],
        [5, N97_SRAM_SIZE, N97_SRAM_BASE],
        [10, N97_BOOT_TOC],
        [13, 0x00012400],
        [6, 0x66666666, 0x406D6666],
        [21, 235200000, 0],
        [7, clock.getUint32(0, true), clock.getUint32(4, true)],
        [22, 433920000, 0],
        [4, N97_RAM_SIZE, N97_RAM_BASE],
        [2],
    ];
    // The consumer fetches three words even at an eight-byte terminator.
    const bytes = new Uint8Array(records.reduce((length, words) => length + (words.length + 1) * 4, 4));
    const output = new DataView(bytes.buffer);
    let offset = 0;
    for(const [type, ...payload] of records)
    {
        const length = (payload.length + 2) * 4;
        output.setUint32(offset, type, true);
        output.setUint32(offset + 4, length, true);
        for(let i = 0; i < payload.length; i++) output.setUint32(offset + 8 + 4 * i, payload[i], true);
        offset += length;
    }
    return bytes;
}

// RAP3NAND names the whole SOS+CORE segment MCUSW. Its offset is relative to
// the TOC and points at the preamble, a page before the XIP entry. The ROM
// reserves this preamble separately at XIP+0x26D0.
function rom_toc(size)
{
    const bytes = new Uint8Array(64);
    const view = new DataView(bytes.buffer);
    view.setInt32(0, N97_CORE_ADDRESS - N97_BOOT_TOC, true);
    view.setUint32(4, N97_CORE_HEADER_OFFSET + size, true);
    view.setUint32(16, N97_CORE_ADDRESS, true);
    bytes.set([0x4D, 0x43, 0x55, 0x53, 0x57], 20); // MCUSW
    bytes.fill(0xFF, 32);
    return bytes;
}

/** @param {ArrayBuffer} rom @param {number=} address @param {Array<number>=} registers */
export function n97_boot_files(rom, address, registers)
{
    if(address !== undefined)
    {
        return { rom, address, registers: registers.slice(), tags: null };
    }
    const tags = cold_boot_tags();
    return { rom, address: N97_ROM_ADDRESS, registers: [0, 0, N97_RAM_BASE + N97_RAM_SIZE - tags.length, 0], tags };
}

/** The 32,768 Hz counter read by both RAP3NAND and the XIP's boot timestamp routine. */
export function create_n97_boot_timer(cpu)
{
    let started_at = null;
    let ticks = 0;
    let captured = 0;
    let boot_control = 0;
    function write_register(address, write)
    {
        cpu.io.register_mmio(address, 4, {
            name: "RM-505 boot register",
            read() { throw new Error("Nokia N97: unmodeled read of boot register 0x" + address.toString(16)); },
            write(offset, width, value)
            {
                if(offset !== 0 || width !== 4) throw new Error("Nokia N97: invalid bootstrap register access size");
                write(value);
            },
        });
    }
    const elapsed_ticks = () => started_at === null ? 0 : Math.floor((cpu.clock.now() - started_at) * 32768 / 1000);
    write_register(N97_BOOT_TIMER + 4, value => {
        if(value === 1 && started_at === null) started_at = cpu.clock.now();
        else if(value === 0 && started_at !== null)
        {
            ticks = ticks + elapsed_ticks() >>> 0;
            started_at = null;
        }
    });
    write_register(N97_BOOT_TIMER + 0x14, value => {
        if(value === 0) captured = ticks + elapsed_ticks() >>> 0;
    });
    cpu.io.register_mmio(N97_BOOT_TIMER + 0x10, 4, {
        name: "RM-505 boot timer capture",
        read(offset, width)
        {
            if(offset !== 0 || width !== 4) throw new Error("Nokia N97: invalid boot timer capture access size");
            return captured;
        },
        write() { throw new Error("Nokia N97: unmodeled write to boot timer capture"); },
    });
    // The firmware sets bit 3 before probing RAM. Only that write is known.
    write_register(N97_BOOT_CONTROL, value => { boot_control = value; });
    return {
        reset() { started_at = null; ticks = 0; captured = 0; boot_control = 0; },
        get_state() { return [started_at, ticks, captured, boot_control]; },
        set_state(state) { [started_at, ticks, captured, boot_control] = state; },
    };
}

export function create_n97_sram(cpu, boot, expected_sha256)
{
    const offset = cpu.memory_size[0];
    const wasm = cpu.wm.exports;
    if(!wasm["a64_bus_map_device"](N97_SRAM_BASE, 0, N97_SRAM_SIZE, 0, offset))
    {
        throw new Error("Nokia N97: cannot map the bootstrap SRAM");
    }
    // ROM+0x1958 reads and discards the mailbox word. ROM+0x1EA0 reads the
    // optional debug cookie; normal cold boot has no 0xDEB0DEB0 debug request.
    if(boot?.tags && (!wasm["a64_bus_map_rom"](N97_BOOT_MAILBOX, 0, 4, 0, offset + N97_SRAM_SIZE) ||
        !wasm["a64_bus_map_rom"](N97_BOOT_DEBUG_COOKIE, 0, 4, 0, offset + N97_SRAM_SIZE + 4)))
    {
        throw new Error("Nokia N97: cannot map the cold-boot words");
    }
    const bytes = () => new Uint8Array(cpu.wasm_memory.buffer, cpu.mem8.byteOffset + offset, N97_SRAM_SIZE);
    const update = () => wasm["a64_bus_written"](offset, N97_SRAM_SIZE);
    const digest = boot ? sha256_hex(new Uint8Array(boot.rom)) : null;
    if(expected_sha256 !== undefined && digest !== expected_sha256) throw new Error("Nokia N97 firmware SHA-256 mismatch");
    const identity = boot ? [digest, boot.address, ...boot.registers, !!boot.tags].join(":") : null;
    return {
        reset() { bytes().fill(0); update(); },
        get_state() { return [identity, bytes().slice()]; },
        check_state(state)
        {
            if(state?.[0] !== identity || !(state[1] instanceof Uint8Array) || state[1].length !== N97_SRAM_SIZE)
            {
                throw new Error("Nokia N97 snapshot requires the same ROM and loader handoff");
            }
        },
        set_state(state) { bytes().set(state[1]); update(); },
    };
}

export function load_n97_rom(cpu, boot)
{
    const { rom, address, registers, tags } = boot;
    const bytes = new Uint8Array(rom);
    const offset = cpu.ram_offset(address, bytes.length);
    if(bytes.length < 4 || offset < 0 || tags && address + bytes.length > N97_BOOT_TOC)
    {
        throw new Error("Nokia N97: ROM is empty or exceeds physical RAM reserved for the image");
    }
    cpu.mem8.set(bytes, offset);
    cpu.wm.exports["a64_bus_written"](offset, bytes.length);
    if(tags)
    {
        const tags_offset = cpu.ram_offset(registers[2], tags.length);
        const toc = rom_toc(bytes.length);
        const toc_offset = cpu.ram_offset(N97_BOOT_TOC, toc.length);
        cpu.mem8.set(toc, toc_offset);
        cpu.wm.exports["a64_bus_written"](toc_offset, toc.length);
        cpu.mem8.set(tags, tags_offset);
        cpu.wm.exports["a64_bus_written"](tags_offset, tags.length);
    }
    cpu.wm.exports["a32_boot_with_registers"](address, registers[0], registers[1], registers[2], registers[3]);
}
