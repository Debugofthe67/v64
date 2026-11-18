// RM-505 loader handoff. The stock bootstrap uses 0x30000010 for r0–r3
// and 0x30001000 as its initial stack top. See docs/symbian-n97.md.

import { sha256_hex } from "../image/sha256.js";
import { N97_FLASH_BLOCK, N97_FLASH_SIZE, N97_FLASH_ID } from "./n97_flash.js";
import { check_n97_bootrom, read_n97_boot_media, N97_BOOTROM_BASE, N97_CORE_ADDRESS, N97_CORE_HEADER_OFFSET,
    N97_MDI_BASE, N97_MDI_SIZE, N97_ROM_ADDRESS } from "./n97_boot_media.js";
export { N97_ROM_ADDRESS };

export const N97_LAYOUT_VERSION = 5;
export const N97_RAM_BASE = 0x08000000;
export const N97_RAM_SIZE = 128 * 1024 * 1024;
export const N97_SRAM_BASE = 0x30000000;
export const N97_SRAM_SIZE = 16 * 1024;
export const N97_DEVICE_MEMORY = N97_SRAM_SIZE + 8;
export const N97_BOOT_TOC = 0x0FCFF000;
export const N97_BOOT_TIMER = 0x20040480;
export const N97_BOOT_CONTROL = 0x20040308;
export const N97_BOOT_MAILBOX = 0x20032D10;
export const N97_BOOT_DEBUG_COOKIE = 0x10001F00;
const RAPIDO_ROM_JUMP_TABLE = 0xFFFF1200;

// The POR configuration uses the loader's tag sizes and reverse insertion
// order. RAP3NAND stores the resulting R2 pointer in SRAM at 0x30003EF8.
function cold_boot_tags(ap_only, nand)
{
    const clock = new DataView(new ArrayBuffer(8));
    clock.setFloat64(0, 433.92, true);
    const records = [
        // RAP3NAND+0x33D0 publishes the on-chip ROM jump table.
        [18, RAPIDO_ROM_JUMP_TABLE],
        ...(ap_only ? [] : [[16, N97_MDI_SIZE, N97_MDI_BASE], [9, 0x01400000, N97_RAM_BASE]]),
        [5, N97_SRAM_SIZE, N97_SRAM_BASE],
        [10, N97_BOOT_TOC],
        [13, 0x00012400],
        [6, 0x66666666, 0x406D6666],
        [21, 235200000, 0],
        [7, clock.getUint32(0, true), clock.getUint32(4, true)],
        [22, 433920000, 0],
        // RAP3NAND+0x3212..0x3242 publishes the detected CS0 geometry.
        ...(nand ? [[19, N97_FLASH_SIZE, 0, N97_FLASH_BLOCK, ...N97_FLASH_ID.slice(0, 2), 0, 0, N97_FLASH_ID[2]]] : []),
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
function rom_toc(size, media)
{
    // The bootstrap looks for SOS-ISASW in the in-memory TOC, while the
    // firmware file's compressed group is named SOS*ISASW.
    const entries = media ? [
        ["DSP0", media.dsp.address, media.dsp.bytes.length],
        ["SOS-ISASW", media.isa.address, media.isa.bytes.length],
    ] : [];
    entries.push(["MCUSW", N97_CORE_ADDRESS, N97_CORE_HEADER_OFFSET + size]);
    const bytes = new Uint8Array((entries.length + 1) * 32);
    const view = new DataView(bytes.buffer);
    const encoder = new TextEncoder();
    for(const [i, [name, address, length]] of entries.entries())
    {
        const offset = 32 * i;
        view.setInt32(offset, address - N97_BOOT_TOC, true);
        view.setUint32(offset + 4, length, true);
        view.setUint32(offset + 16, address, true);
        bytes.set(encoder.encode(name), offset + 20);
    }
    bytes.fill(0xFF, entries.length * 32);
    return bytes;
}

/**
 * @param {ArrayBuffer} rom
 * @param {number=} address
 * @param {Array<number>=} registers
 * @param {Object=} options local RAPIDO boot inputs or the explicit AP diagnostic handoff
 */
export function n97_boot_files(rom, address, registers, options)
{
    const rom_digest = sha256_hex(new Uint8Array(rom));
    if(address !== undefined)
    {
        return { rom, rom_digest, address, registers: registers.slice(), tags: null, media: null, bootrom: null, bootrom_digest: "", ap_only: false };
    }
    const media = options?.media ? read_n97_boot_media(new Uint8Array(options.media), rom_digest) : null;
    if(options?.media_digest && media?.digest !== options.media_digest) throw new Error("Nokia N97 boot media SHA-256 mismatch");
    const bootrom = options?.bootrom ? new Uint8Array(options.bootrom) : null;
    const bootrom_digest = bootrom ? check_n97_bootrom(bootrom, options.bootrom_id, options.bootrom_digest).sha256 : "";
    const tags = cold_boot_tags(options?.ap_only, options?.nand);
    return { rom, rom_digest, address: N97_ROM_ADDRESS, registers: [0, 0, N97_RAM_BASE + N97_RAM_SIZE - tags.length, 0],
        tags, media, bootrom, bootrom_digest, ap_only: !!options?.ap_only };
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
    const bootrom_at = offset + N97_DEVICE_MEMORY;
    if(boot?.bootrom && !wasm["a64_bus_map_rom"](N97_BOOTROM_BASE, 0, boot.bootrom.length, 0, bootrom_at))
    {
        throw new Error("Nokia N97: cannot map the on-chip RAPIDO boot ROM");
    }
    const load_bootrom = () => {
        if(!boot?.bootrom) return;
        new Uint8Array(cpu.wasm_memory.buffer, cpu.mem8.byteOffset + bootrom_at, boot.bootrom.length).set(boot.bootrom);
        wasm["a64_bus_written"](bootrom_at, boot.bootrom.length);
    };
    load_bootrom();
    const digest = boot?.rom_digest ?? null;
    if(expected_sha256 !== undefined && digest !== expected_sha256) throw new Error("Nokia N97 firmware SHA-256 mismatch");
    const identity = boot ? [digest, boot.address, ...boot.registers, !!boot.tags, boot.media?.digest || "",
        boot.bootrom_digest].join(":") : null;
    // Layout 4 is the same AP board without the 12-byte type-18 record.
    // A legacy snapshot carries its own RAM contents and R2.
    const legacy_registers = boot?.registers.slice();
    if(boot?.tags) legacy_registers[2] += 12;
    const legacy_identity = boot && !boot.media && !boot.bootrom && !boot.ap_only ?
        [digest, boot.address, ...legacy_registers, !!boot.tags].join(":") : undefined;
    return {
        reset() { bytes().fill(0); update(); load_bootrom(); },
        get_state() { return [identity, bytes().slice()]; },
        check_state(state, legacy = false)
        {
            const expected = legacy ? legacy_identity : identity;
            if(!state || expected === undefined || state[0] !== expected || !(state[1] instanceof Uint8Array) || state[1].length !== N97_SRAM_SIZE)
            {
                throw new Error("Nokia N97 snapshot requires the same ROM and loader handoff");
            }
        },
        set_state(state) { bytes().set(state[1]); update(); },
    };
}

export function load_n97_rom(cpu, boot)
{
    const { rom, address, registers, tags, media } = boot;
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
        const toc = rom_toc(bytes.length, media);
        const toc_offset = cpu.ram_offset(N97_BOOT_TOC, toc.length);
        if(media)
        {
            const sections = [media.dsp, media.isa,
                { address: N97_CORE_ADDRESS + N97_CORE_HEADER_OFFSET - media.prefix.length, bytes: media.prefix }];
            for(const section of sections)
            {
                const dest = cpu.ram_offset(section.address, section.bytes.length);
                if(dest < 0) throw new Error("Nokia N97: a boot image is outside SDRAM");
                cpu.mem8.set(section.bytes, dest);
                cpu.wm.exports["a64_bus_written"](dest, section.bytes.length);
            }
        }
        cpu.mem8.set(toc, toc_offset);
        cpu.wm.exports["a64_bus_written"](toc_offset, toc.length);
        cpu.mem8.set(tags, tags_offset);
        cpu.wm.exports["a64_bus_written"](tags_offset, tags.length);
    }
    cpu.wm.exports["a32_boot_with_registers"](address, registers[0], registers[1], registers[2], registers[3]);
}
