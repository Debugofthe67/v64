#!/usr/bin/env node
// Execute the original RM-505 22.0.110 RAP3NAND identification and read-page
// routines and mednand.pdd's unlock routine in V86, without modifying flash.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { V86 } from "../../src/main.js";
import { STATE_OFFSETS } from "../../src/arm/state_layout.js";
import { fpsx_group_data, parse_fpsx } from "../../src/symbian/fpsx.js";
import { N97_FLASH_PAGE, N97_FLASH_NAME } from "../../src/symbian/n97_flash.js";

const [directory, core_file] = process.argv.slice(2);
if(!directory || !core_file || process.argv.length !== 4)
{
    throw new Error("Usage: node tools/symbian/onenand-n97.mjs <extraction-directory> <retail CORE.C00>");
}
const core = parse_fpsx(await readFile(core_file));
const loader = fpsx_group_data(core, core.groups.find(group => group.label === "RAP3NAND"));
const sha256 = data => createHash("sha256").update(data).digest("hex");
assert.equal(sha256(loader), "0d7305dd3c057210cd5b67fb1b994ed02291cd68899bd64c0b0dbc29bb94f4b8");
const vm = new V86({ machine_type: "nokia-n97", graphics_adapter: "none", disable_jit: true, autostart: false,
    log_level: 0, wasm_path: fileURLToPath(new URL("../../build/v86-arm64.wasm", import.meta.url)), symbian: {
        rom: { url: join(directory, "rom.xip.bin") }, boot_media: { url: join(directory, "rapido-boot.bin") },
        nand: { url: join(directory, N97_FLASH_NAME), disk_option: "read_write" },
    } });

function observe_pdd(cpu, next_pc, state, write_register, destinations)
{
    const wasm = cpu.wm.exports;
    const xip = new Uint8Array(cpu.boot_files.rom);
    assert.equal(cpu.boot_files.rom_digest, "9c0863e379d243f953d3cfcd87d11c98231f2d0469e69244d9ee059472c99194");
    const data_header = 0xDEE70;
    const header = new DataView(xip.buffer, data_header, 0x64);
    const from = header.getUint32(0x18, true) - 0x80000000;
    const length = header.getUint32(0x24, true);
    const linked_data = header.getUint32(0x60, true);
    const globals = 0x0A000000, linked_globals = 0xC8000000;
    const ttbr = 0x08004000, trampoline = 0x08001000, pause = trampoline + 64;
    const table = new Uint32Array(4096);
    const section = (va, pa) => { table[va >>> 20] = pa | 0xC02; };
    // A minimal ARMv6 section table for this isolated PDD call. It leaves
    // CS0 as MMIO and maps ROM and DLL globals at their linked addresses.
    for(const address of [0, 0x08000000, 0x30000000]) section(address, address);
    section(linked_globals, globals);
    for(let offset = 0; offset < xip.length; offset += 0x100000) section(0x80000000 + offset, 0x08900000 + offset);
    const write = (pa, bytes) => {
        const at = cpu.ram_offset(pa, bytes.length);
        assert.ok(at >= 0);
        cpu.mem8.set(bytes, at);
        wasm["a64_bus_written"](at, bytes.length);
    };
    const word = pa => new DataView(cpu.mem8.buffer, cpu.mem8.byteOffset + cpu.ram_offset(pa, 4), 4).getUint32(0, true);
    write(ttbr, new Uint8Array(table.buffer));
    write(globals + linked_data - linked_globals, xip.subarray(from, from + length));
    // CP15 TTBR0, DACR, SCTLR.M, prefetch flush, branch to r4.
    write(trampoline, new Uint8Array(new Uint32Array([0xEE020F10, 0xEE031F10, 0xEE112F10, 0xE3822001,
        0xEE012F10, 0xEE073F95, 0xE1A0F004]).buffer));
    wasm["a32_boot_with_registers"](trampoline, ttbr, -1, 0, 0);
    write_register(4, pause);
    next_pc(pause);
    function call(entry, args, stop = pause)
    {
        state.setUint32(STATE_OFFSETS.pc, entry, true);
        args.forEach((value, i) => write_register(i, value));
        write_register(13, 0x080F0000);
        write_register(14, pause);
        next_pc(stop);
        return state.getUint32(STATE_OFFSETS.x, true);
    }
    // Stop after the stock device table and callback selection, before the
    // PDD calls the live kernel allocator to construct its media objects.
    call(0x800F49CC, [0], 0x800F4A90);
    assert.equal(word(globals + 0xBD2C), 0xC8009F10);
    const functions = new DataView(xip.buffer).getUint32(0xF6360, true) - linked_globals;
    const unlock = word(globals + functions + 8);
    assert.equal(unlock, 0x800F3724);
    const blocks = [0x7FA, 0x7FB, 0x7FC];
    destinations.length = 0;
    assert.equal(call(unlock, [0, blocks[0], blocks.length]), 0);
    const values = at => destinations.filter(([offset]) => offset === at).map(([, , value]) => value);
    assert.deepEqual(values(0x1E200), blocks.map(block => block | 0x8000));
    assert.deepEqual(values(0x1E498), blocks);
    assert.deepEqual(values(0x1E440), blocks.map(() => 0x23));
    return { unlock, blocks, result: 0 };
}

try
{
    await new Promise((resolve, reject) => {
        vm.add_listener("emulator-loaded", resolve);
        vm.add_listener("emulator-error", reject);
    });
    const cpu = vm.v86.cpu, wasm = cpu.wm.exports;
    const table = cpu.boot_files.tags;
    const tags = new DataView(table.buffer);
    let at = 0;
    while(at < table.length && tags.getUint32(at, true) !== 19) at += tags.getUint32(at + 4, true);
    const tag = Array.from({ length: 10 }, (_, i) => tags.getUint32(at + 4 * i, true));
    assert.deepEqual(tag, [19, 40, 0x10000000, 0, 0x20000, 0xEC, 0x40, 0, 0, 0x121]);
    const base = 0x08000000, dest = 0x08020000, stop = 0x08020000 + N97_FLASH_PAGE;
    const start = cpu.ram_offset(base, loader.length);
    cpu.mem8.set(loader, start);
    wasm["a64_bus_written"](start, loader.length);
    const state = new DataView(cpu.wasm_memory.buffer, cpu.state_base);
    const pc = () => Number(cpu.read_pc());
    const write_register = (n, value) => state.setUint32(STATE_OFFSETS.x + 8 * n, value, true);
    function next_pc(stop)
    {
        for(let n = 0; n < 30000 && pc() !== stop; n++) wasm["a64_worker_slice"](1);
        assert.equal(pc(), stop, "original guest routine did not reach its checkpoint");
    }
    function call(entry, r0, r1 = 0, r2 = 0)
    {
        wasm["a32_boot_with_registers"](base + entry, r0, r1, r2, 0);
        state.setUint32(STATE_OFFSETS.pstate, state.getUint32(STATE_OFFSETS.pstate, true) | 32, true);
        write_register(13, 0x30003000);
        write_register(14, stop | 1);
        next_pc(stop);
        return state.getUint32(STATE_OFFSETS.x, true);
    }
    const registers = [], destinations = [];
    let data_reads = 0;
    const { io } = cpu;
    const read = io.mmio_read.bind(io), write = io.mmio_write.bind(io);
    io.mmio_read = (owner, offset, width) => {
        const value = read(owner, offset, width);
        if(io.ranges[owner].base === 0)
        {
            if(offset >= 0x1E000) registers.push(["read", Number(offset), width, Number(value)]);
            if(offset >= 0x400 && offset < 0xC00 && width === 2) data_reads++;
        }
        return value;
    };
    io.mmio_write = (owner, offset, width, value) => {
        if(io.ranges[owner].base === 0) destinations.push([Number(offset), width, Number(value)]);
        write(owner, offset, width, value);
    };
    call(0x2EB4, 0);
    assert.deepEqual(registers.slice(0, 3), [["read", 0x1E000, 2, 0xEC], ["read", 0x1E002, 2, 0x40], ["read", 0x1E004, 2, 0x121]]);
    const identification = registers.splice(0, 3);
    const pages = [];
    for(const address of [0x80000, 0x1A21000, 0x79A1000, 0x9CA1000, 0xABA0000])
    {
        destinations.length = 0;
        registers.length = 0;
        data_reads = 0;
        assert.equal(call(0x2CE8, 0, address / N97_FLASH_PAGE, dest), 0);
        assert.equal(data_reads, 1024);
        const copied = cpu.mem8.subarray(cpu.ram_offset(dest, N97_FLASH_PAGE), cpu.ram_offset(dest, N97_FLASH_PAGE) + N97_FLASH_PAGE);
        assert.equal(copied.length, N97_FLASH_PAGE);
        assert.ok(registers.some(([, offset, width, value]) => offset === 0x1E482 && width === 2 && value === 0x8080));
        assert.ok(registers.some(([, offset, width, value]) => offset === 0x1FE00 && width === 2 && value === 0));
        if(address === 0x80000)
        {
            assert.deepEqual(destinations, [[0x1E200, 2, 4], [0x1E20E, 2, 0], [0x1E400, 2, 0x800], [0x1E482, 2, 0], [0x1E440, 2, 0]]);
            assert.equal(sha256(copied.subarray(0, 1024)), "482b607a6113162e95a984b6d26bb2af30d08afbe8d338dc00f8fa34dec696d1");
            assert.equal(sha256(copied), "7d205c7846a817f407f667ebb6d5e887e24fcb390561982b7850abc62acc06a1");
        }
        if(address === 0x1A21000 || address === 0x79A1000 || address === 0x9CA1000)
            assert.match(Buffer.from(copied.subarray(0, 4)).toString(), /^ROF[SxX]$/);
        pages.push({ address, sha256: sha256(copied), prefix: Buffer.from(copied.subarray(0, 8)).toString("hex") });
    }
    const pdd = observe_pdd(cpu, next_pc, state, write_register, destinations);
    const device = cpu.devices.n97_onenand.status();
    assert.equal(device["reads"], pages.length);
    assert.equal(device["programs"] + device["erases"], 0);
    console.log(JSON.stringify({ loader: sha256(loader), tag, identification, pages, pdd, device }, null, 2));
}
finally
{
    await vm.destroy();
}
