#!/usr/bin/env node
// Run the original EPBUSMV command/response and card-select routines. An
// ARM PIO loop drains the shared host FIFO in place of the platform DMAC.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { closeSync, fstatSync, ftruncateSync, mkdtempSync, openSync, readSync, rmSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { V86 } from "../../src/main.js";
import { STATE_OFFSETS } from "../../src/arm/state_layout.js";
import { format_n97_emmc } from "../../src/symbian/n97_emmc_format.js";
import { N97_EMMC_SIZE, open_n97_emmc } from "../../src/symbian/n97_mmc_media.js";

const [rom] = process.argv.slice(2);
if(!rom || process.argv.length !== 3) throw new Error("Usage: node tools/symbian/mmc-n97.mjs <rom.xip.bin>");
const directory = mkdtempSync(join(tmpdir(), "v86-rapido-mmc-"));

function make_evidence_media()
{
    const emmc = join(directory, "emmc.img"), sd = join(directory, "sd.img");
    const fd = openSync(emmc, "wx+", 0o600);
    try
    {
        format_n97_emmc(open_n97_emmc({
            getSize: () => fstatSync(fd).size,
            truncate: length => ftruncateSync(fd, length),
            read: (part, { at }) => readSync(fd, part, 0, part.length, at),
            write: (part, { at }) => writeSync(fd, part, 0, part.length, at),
        }, true), 0x505);
    }
    finally { closeSync(fd); }
    const card = openSync(sd, "wx+", 0o600);
    try
    {
        ftruncateSync(card, 16 * 1024 ** 2);
        const sample = Buffer.from("RM-505 microSD evidence sector");
        writeSync(card, sample, 0, sample.length, 512);
    }
    finally { closeSync(card); }
    return { emmc, sd };
}

let vm;
try
{
    const { emmc, sd } = make_evidence_media();
    const disk = url => ({ url, disk_option: "read_write" });
    vm = new V86({ machine_type: "nokia-n97", disable_jit: true, graphics_adapter: "none", autostart: false, log_level: 0,
        wasm_path: fileURLToPath(new URL("../../build/v86-arm64.wasm", import.meta.url)),
        symbian: { rom: { url: rom }, emmc: disk(emmc), sd: disk(sd) } });
    await new Promise((resolve, reject) => {
        vm.add_listener("emulator-loaded", resolve);
        vm.add_listener("emulator-error", reject);
    });
    const cpu = vm.v86.cpu, wasm = cpu.wm.exports;
    const xip = cpu.boot_files;
    assert.equal(xip.rom_digest, "9c0863e379d243f953d3cfcd87d11c98231f2d0469e69244d9ee059472c99194");
    const state = new DataView(cpu.wasm_memory.buffer, cpu.state_base);
    const ram_address = (pa, size) => {
        const at = cpu.ram_offset(pa, size);
        assert.ok(at >= 0);
        return at;
    };
    function place(pa, bytes)
    {
        const at = ram_address(pa, bytes.byteLength);
        cpu.mem8.set(bytes, at);
        wasm["a64_bus_written"](at, bytes.byteLength);
    }
    function words(pa, values) { place(pa, new Uint8Array(Uint32Array.from(values).buffer)); }
    const linked_data = 0xC8000000, data = 0x0A000000;
    const ttbr = 0x08004000, trampoline = 0x08001000, fifo_code = trampoline + 0x100, pause = trampoline + 0x200;
    const table = new Uint32Array(4096), peripheral_va = 0xC6032800, peripheral_pa = 0x20032800;
    for(const [va, pa] of [[0x08000000, 0x08000000], [0xC6000000, 0x20000000], [linked_data, data]])
        table[va >>> 20] = pa | 0xC02;
    for(let i = 0; i < xip.rom.byteLength; i += 0x100000)
        table[(0x80000000 + i) >>> 20] = (0x08900000 + i) | 0xC02;
    place(ttbr, new Uint8Array(table.buffer));
    // CP15 TTBR0, DACR, SCTLR.M, prefetch flush, branch to r4.
    words(trampoline, [0xEE020F10, 0xEE031F10, 0xEE112F10, 0xE3822001, 0xEE012F10, 0xEE073F95, 0xE1A0F004]);
    // ldrh r3,[r0]; strh r3,[r1],#2; subs r2,#1; bne to ldrh; bx lr
    words(fifo_code, [0xE1D030B0, 0xE0C130B2, 0xE2522001, 0x1AFFFFFB, 0xE12FFF1E]);
    const reg = (n, v) => state.setUint32(STATE_OFFSETS.x + n * 8, v, true);
    const pc = () => Number(cpu.read_pc());
    function step(stop)
    {
        for(let n = 0; n < 18000 && pc() !== stop; n++) wasm["a64_worker_slice"](1);
        assert.equal(pc(), stop, "original ARM routine missed its checkpoint");
    }
    function call(entry, ...args)
    {
        state.setUint32(STATE_OFFSETS.pc, entry, true);
        args.forEach((value, i) => reg(i, value));
        reg(13, 0x080F0000);
        reg(14, pause);
        step(pause);
    }
    const { io } = cpu;
    const trace = [], card_detect = [];
    const read = io.mmio_read.bind(io), write = io.mmio_write.bind(io);
    io.mmio_read = (owner, offset, width) => {
        const address = io.ranges[owner].base + Number(offset);
        const value = read(owner, offset, width);
        if(address === 0x20031D88) card_detect.push([address, width, Number(value)]);
        return value;
    };
    io.mmio_write = (owner, offset, width, value) => {
        trace.push([io.ranges[owner].base + Number(offset), width, Number(BigInt.asUintN(width * 8, value))]);
        write(owner, offset, width, value);
    };
    function mmio(address, width, value)
    {
        const id = io.ranges.findIndex(range => range && address >= range.base && address < range.base + range.size);
        assert.ok(id > 0, "Mapped peripheral at " + address.toString(16));
        const offset = address - io.ranges[id].base;
        return value === undefined ? Number(read(id, offset, width)) : write(id, offset, width, BigInt(value));
    }
    wasm["a32_boot_with_registers"](trampoline, ttbr, -1, 0, 0);
    reg(4, pause);
    step(pause);
    call(0x8009FDC0); // original egpio bank construction
    const object = 0xC8019000, stack = 0xC8020000, request = 0xC8022000;
    const guest_pa = va => va - linked_data + data;
    function select(slot)
    {
        words(guest_pa(object) + 8, [slot]);
        words(guest_pa(object) + 0x10, [0xFFFFFFFF]);
        words(guest_pa(object) + 0x58, [44 << 8]);
        call(0x80160890, object, slot);
        assert.deepEqual(trace.at(-1), [slot ? 0x20031CC8 : 0x20031CC4, 4, 0x1000]);
    }
    const host_write = (offset, value) => mmio(peripheral_pa + offset, 2, value);
    const host_read = offset => mmio(peripheral_pa + offset, 2);
    mmio(0x20031C94, 4, 0x4000);
    host_write(0xC, 0x81F);
    const stock = [];
    function original_command(index, argument, response_type, expected_word, expected)
    {
        host_write(0x10, 0xFFFF);
        words(guest_pa(stack) + 0x884, [argument]);
        words(guest_pa(request) + 4, [index]);
        words(guest_pa(request) + 8, [argument]);
        words(guest_pa(request) + 0x2C, [response_type]);
        const begin = trace.length;
        call(0x80162484, stack, request);
        assert.deepEqual(trace.slice(begin), [[peripheral_pa + 4, 2, argument & 0xFFFF],
            [peripheral_pa + 8, 2, argument >>> 16], [peripheral_pa, 2, expected_word]]);
        assert.ok(host_read(0x10) & 1);
        if(response_type)
        {
            call(0x8016272C, stack, request);
            const bytes = cpu.mem8.subarray(ram_address(guest_pa(request) + 0x50, 16), ram_address(guest_pa(request) + 0x50, 16) + 16);
            if(expected !== undefined) assert.equal(new DataView(bytes.buffer, bytes.byteOffset).getUint32(0, false), expected);
            else assert.ok(bytes.some(byte => byte), "Original linked routine copied the R2 response");
        }
        stock.push({ index, argument, word: expected_word, response: host_read(0x5C) * 65536 + host_read(0x58) });
    }
    function read_block(index, argument)
    {
        host_write(0x10, 0xFFFF);
        host_write(4, argument & 0xFFFF);
        host_write(8, argument >>> 16);
        host_write(0x24, 511);
        host_write(0x28, 0);
        host_write(0, 0xB100 | index);
        assert.ok(host_read(0x10) & 1);
        const dest = 0x0803F000;
        call(fifo_code, peripheral_va + 0x20, dest, 256);
        assert.ok(host_read(0x10) & 8);
        return cpu.mem8.slice(ram_address(dest, 512), ram_address(dest, 512) + 512);
    }
    select(1);
    original_command(0, 0, 0, 0);
    original_command(1, 0x40FF8080, 5, 0x301, 0xC0FF8080);
    original_command(2, 0, 4, 0x202);
    original_command(3, 0x10000, 2, 0x103, 0x700);
    original_command(7, 0x10000, 3, 0x907, 0x900);
    const ext = read_block(8, 0);
    assert.equal(new DataView(ext.buffer).getUint32(212, true) * 512, N97_EMMC_SIZE);
    const mbr = read_block(17, 0);
    assert.equal(mbr[450], 0x0C);
    const lba = new DataView(mbr.buffer).getUint32(454, true);
    assert.equal(lba, 2048);
    const boot = read_block(17, lba);
    assert.equal(Buffer.from(boot.subarray(82, 90)).toString(), "FAT32   ");
    select(0);
    const detector = object + 0x80;
    words(guest_pa(detector) + 0x28, [0, 45 << 8]); // active detection, configured GENIO45
    call(0x80160F2C, detector);
    assert.equal(state.getUint32(STATE_OFFSETS.x, true), 1);
    assert.deepEqual(card_detect, [[0x20031D88, 4, 0]]);
    original_command(0, 0, 0, 0);
    original_command(8, 0x1AA, 8, 0x608, 0x1AA);
    original_command(55, 0, 2, 0x137, 0x20);
    original_command(41, 0x40FF8000, 5, 0x329, 0x80FF8000);
    original_command(2, 0, 4, 0x202);
    original_command(3, 0, 8, 0x603, 0x10700);
    original_command(7, 0x10000, 3, 0x907, 0x900);
    const sector = read_block(17, 512);
    assert.match(Buffer.from(sector).toString(), /^RM-505 microSD evidence sector/);
    const digest = bytes => createHash("sha256").update(bytes).digest("hex");
    console.log(JSON.stringify({ stock, eMMC: { bytes: N97_EMMC_SIZE, mbr: digest(mbr), fat32: digest(boot) },
        microSD: { sector: 1, sha256: digest(sector), card_detect }, hardware: cpu.devices.n97_mmc.status() }, null, 2));
}
finally
{
    await vm?.destroy();
    rmSync(directory, { recursive: true, force: true });
}
