#!/usr/bin/env node
// Cold boot the unmodified RM-505 XIP into the retail kernel, then call the
// original EPBUSMV stack's data entry with fresh local diagnostic media.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { closeSync, fstatSync, ftruncateSync, mkdtempSync, openSync, readSync, rmSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { V86 } from "../../src/main.js";
import { STATE_OFFSETS } from "../../src/arm/state_layout.js";
import { format_n97_emmc } from "../../src/symbian/n97_emmc_format.js";
import { open_n97_emmc } from "../../src/symbian/n97_mmc_media.js";

const [rom] = process.argv.slice(2);
if(!rom || process.argv.length !== 3) throw new Error("Usage: node tools/symbian/dma-n97.mjs <rom.xip.bin>");
const directory = mkdtempSync(join(tmpdir(), "v86-n97-dma-"));
const emmc = join(directory, "emmc.img"), sd = join(directory, "sd.img");
const read_payload = Uint8Array.from({ length: 512 }, (_, index) => (index * 127 ^ (index >>> 5) ^ 193) & 255);
const write_payload = Uint8Array.from({ length: 512 }, (_, index) => (index * 73 ^ (index >>> 2) ^ 29) & 255);
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const wasm_path = fileURLToPath(new URL("../../build/v86-arm64.wasm", import.meta.url));

function with_disk(file, mode, run)
{
    const fd = openSync(file, mode, 0o600);
    try
    {
        return run({
            getSize: () => fstatSync(fd).size,
            truncate: length => ftruncateSync(fd, length),
            read: (part, { at }) => readSync(fd, part, 0, part.length, at),
            write: (part, { at }) => writeSync(fd, part, 0, part.length, at),
        });
    }
    finally { closeSync(fd); }
}

async function probe(slot, write_to_card)
{
    const disk = url => ({ url, disk_option: "read_write" });
    const vm = new V86({ machine_type: "nokia-n97", disable_jit: true, graphics_adapter: "none", autostart: false, log_level: 0,
        cpu_clock: { mode: "deterministic", instructions_per_ms: 8000 }, wasm_path, symbian: {
            rom: { url: rom }, application_processor_only: true, emmc: disk(emmc), sd: disk(sd),
        } });
    try
    {
        await new Promise((resolve, reject) => {
            vm.add_listener("emulator-loaded", resolve);
            vm.add_listener("emulator-error", reject);
        });
        const cpu = vm.v86.cpu, wasm = cpu.wm.exports, io = cpu.io;
        assert.equal(cpu.boot_files.rom_digest, "9c0863e379d243f953d3cfcd87d11c98231f2d0469e69244d9ee059472c99194");
        const state = new DataView(cpu.wasm_memory.buffer, cpu.state_base);
        const pc = () => Number(cpu.read_pc());
        const field = name => state.getUint32(STATE_OFFSETS[name], true);
        const register = n => state.getUint32(STATE_OFFSETS.x + n * 8, true);
        const set_reg = (n, value) => state.setUint32(STATE_OFFSETS.x + n * 8, value, true);
        const jump = address => state.setUint32(STATE_OFFSETS.pc, address, true);
        // Inspect the supervisor's existing short-descriptor page tables;
        // the public A32 backdoor translation deliberately uses user permissions.
        function physical(va)
        {
            va >>>= 0;
            const n = field("a32_ttbcr") & 7;
            const ttbr1 = !!n && va >>> (32 - n) !== 0;
            const table = (field(ttbr1 ? "ttbr1_el1" : "ttbr0_el1") & (-1 << (ttbr1 ? 14 : 14 - n))) >>> 0;
            const index = (va >>> 20) & (ttbr1 ? 0xFFF : (1 << (12 - n)) - 1);
            const first = cpu.read32_physical(table + index * 4);
            if((first & 3) === 2) return ((first & 0xFFF00000) | (va & 0xFFFFF)) >>> 0;
            assert.equal(first & 3, 1, "unmapped guest VA 0x" + va.toString(16));
            const second = cpu.read32_physical(((first & 0xFFFFFC00) >>> 0) + (va >>> 12 & 255) * 4);
            if(second & 2) return ((second & 0xFFFFF000) | (va & 0xFFF)) >>> 0;
            assert.equal(second & 3, 1, "unmapped guest page VA 0x" + va.toString(16));
            return ((second & 0xFFFF0000) | (va & 0xFFFF)) >>> 0;
        }
        function write_guest(va, bytes)
        {
            for(let start = 0; start < bytes.length;)
            {
                const end = Math.min(bytes.length, start + 0x1000 - ((va + start) & 0xFFF));
                cpu.write_blob_physical(bytes.subarray(start, end), physical(va + start));
                start = end;
            }
        }
        function words(va, ...values) { write_guest(va, new Uint8Array(Uint32Array.from(values).buffer)); }
        function mmio(address, value, width)
        {
            const owner = io.ranges.findIndex(range => range && range.base <= address && address + width <= range.base + range.size);
            assert.ok(owner > 0, "unmapped PA 0x" + address.toString(16));
            const offset = address - io.ranges[owner].base;
            return value === undefined ? Number(io.mmio_read(owner, offset, width)) : io.mmio_write(owner, offset, width, BigInt(value));
        }
        const host = (offset, value) => mmio(0x20032800 + offset, value, 2);
        function card_command(word, argument = 0)
        {
            host(0x10, 0xFFFF);
            host(4, argument & 0xFFFF);
            host(8, argument >>> 16);
            host(0, word);
            assert.equal(host(0x10) & 0x40A0, 0, "MMC initialization command " + word.toString(16));
        }
        const sisa_entry = 0x800B3B40; // stop before the independently observed missing-modem access
        const park = 0x80001DBC; // unmodified ROM self-branch, parked IRQ caller
        cpu.clock.resume();
        for(let step = 0; pc() !== sisa_entry && step < 5000000; step++)
        {
            if(step && step % 32 === 0) cpu.run_hardware_timers(null, cpu.clock.advance_instructions(32));
            wasm["a64_worker_slice"](1);
        }
        assert.equal(pc(), sisa_entry);
        assert.equal(cpu.devices.n97_dma.status().physical_resets, 6);
        const stack = register(13) - 0x180, visited = new Set(), claims = [], dma_writes = [];
        const errors = [0x04, 0x0C, 0x10, 0xFFFF0004, 0xFFFF000C, 0xFFFF0010, 0x8009F04C];
        const raw_read = io.mmio_read.bind(io), raw_write = io.mmio_write.bind(io);
        io.mmio_read = (owner, offset, width) => {
            const value = raw_read(owner, offset, width);
            if(io.ranges[owner].base + Number(offset) === 0x20400008) claims.push(Number(value));
            return value;
        };
        io.mmio_write = (owner, offset, width, value) => {
            const address = io.ranges[owner].base + Number(offset);
            if(address >= 0x20040780 && address < 0x20042800)
                dma_writes.push([pc(), address, width, Number(value)]);
            raw_write(owner, offset, width, value);
        };
        const checkpoints = [0x8015EEB0, 0x8015EF5C, 0x8009C0BC, 0x8009DE34, 0x8009D8C0, 0x8009DA0C, 0x80160B5C];
        function step()
        {
            const address = pc();
            assert.ok(!errors.includes(address), "guest exception 0x" + address.toString(16) + " at FAR 0x" + field("far_el1").toString(16));
            if(checkpoints.includes(address)) visited.add(address);
            wasm["a64_worker_slice"](1);
        }
        function call(entry, ...args)
        {
            args.forEach((value, i) => set_reg(i, value));
            set_reg(13, stack);
            set_reg(14, sisa_entry);
            jump(entry);
            for(let n = 0; pc() !== sisa_entry && n < 20000; n++) step();
            assert.equal(pc(), sisa_entry, "retail function 0x" + entry.toString(16) + " returns");
            return register(0);
        }
        const allocate = size => {
            const address = call(0x80162C48, size); // stock kernel heap veneer
            assert.ok(address);
            write_guest(address, new Uint8Array(size));
            return address;
        };
        const helper = allocate(128), buffer = ((allocate(640) + 31) & ~31) >>> 0;
        const stack_driver = allocate(0x900), request = allocate(0x60);
        // The real helper sees a contiguous DMA fragment and all 512 bytes in one guest page.
        assert.equal(physical(buffer + 511), physical(buffer) + 511);
        if(write_to_card) write_guest(buffer, write_payload);
        assert.equal(call(0x80160A90, helper), helper); // actual EPBUSMV DMA platform constructor
        const dfc_queue = cpu.read32_physical(physical(0xC8006BB8 + 0x3C));
        assert.ok(dfc_queue);
        assert.equal(call(0x80160AC0, helper, buffer, 512, dfc_queue), 0);
        const argument = slot ? 512 : 1;
        words(stack_driver + 0x844, helper);
        words(stack_driver + 0x884, argument);
        words(request + 4, write_to_card ? 24 : 17, argument, 512, buffer, 512, 0, 5, write_to_card ? 1 : 2);
        words(request + 0x2C, 2); // R1

        mmio(0x20031C94, 0x4000, 4);
        mmio(slot ? 0x20031CC4 : 0x20031CC8, 0x1000, 4);
        host(0x0C, 0x801);
        card_command(0);
        if(slot)
        {
            card_command(0x1608, 0x1AA);
            card_command(0x1137);
            card_command(0x1329, 0x40FF8000);
        }
        else card_command(0x1301, 0x40FF8080);
        card_command(0x1202);
        card_command(slot ? 0x1603 : 0x2103, slot ? 0 : 0x10000);
        card_command(0x2907, 0x10000);
        host(0x10, 0xFFFF);
        host(0x2C, write_to_card ? 0x008F : 0x8F00);
        call(0x80162484, stack_driver, request); // stock sizes, DMA queue and card command
        assert.equal(host(0x10) & 0x40A1, 1);
        assert.equal(cpu.devices.n97_dma.status().completed, 0);
        for(const entry of [write_to_card ? 0x8015EF5C : 0x8015EEB0, 0x8009C0BC, 0x8009DE34, 0x80160B5C])
            assert.ok(visited.has(entry), "stock DMA path executed 0x" + entry.toString(16));

        jump(park);
        set_reg(14, park);
        const irq_mode = field("a32_cpsr") & 0x1F;
        let irq_return = 0, claim_start = 0, return_instruction = 0, steps = 0;
        for(; steps < 40000; steps++)
        {
            if(steps % 32 === 0) cpu.run_hardware_timers(null, cpu.clock.advance_instructions(32));
            const entry = pc();
            if(entry === 0xFFFF0018)
            {
                irq_return = register(14) - 4;
                claim_start = claims.length;
            }
            step();
            if((entry === 0x8004F354 || entry === 0x8004F370) && pc() === park && irq_return === park &&
                visited.has(0x8009D8C0) && visited.has(0x8009DA0C) && claims.slice(claim_start).includes(1))
            {
                return_instruction = entry;
                assert.equal(field("a32_cpsr") & 0x1F, irq_mode);
                break;
            }
        }
        assert.ok(return_instruction, "real IRQ 1 must dispatch its DMA callback and return to its caller: " +
            JSON.stringify({ pc: pc().toString(16), claims: claims.slice(-8), visited: [...visited].map(n => n.toString(16)),
                dma: cpu.devices.n97_dma.status(), dma_writes: dma_writes.map(([entry, port, width, value]) =>
                    [entry.toString(16), port.toString(16), width, value.toString(16)]) }));
        assert.equal(host(0x10) & 0x18, write_to_card ? 0x18 : 0x08);
        assert.deepEqual(cpu.devices.n97_dma.status(), { physical_resets: 6, completed: 1, bytes: 512, errors: 0 });
        if(!write_to_card) assert.deepEqual(cpu.read_blob_physical(physical(buffer), 512), read_payload);
        return { card: slot ? "microSD" : "eMMC", direction: write_to_card ? "write" : "read", bytes: 512,
            sha256: digest(write_to_card ? write_payload : read_payload), irq: 1,
            return_instruction, returned_pc: park, steps, mmio: dma_writes };
    }
    finally { await vm.destroy(); }
}

try
{
    with_disk(emmc, "wx+", access => {
        const media = open_n97_emmc(access, true);
        format_n97_emmc(media, 0x505);
        media.write(512, read_payload);
    });
    with_disk(sd, "wx+", access => {
        access.truncate(16 * 1024 ** 2);
        access.write(read_payload, { at: 512 });
    });
    const results = [];
    for(const slot of [0, 1])
    {
        results.push(await probe(slot, false));
        results.push(await probe(slot, true));
        const stored = with_disk(slot ? sd : emmc, "r", access => {
            if(!slot) return open_n97_emmc(access).read(512, 512);
            const bytes = new Uint8Array(512);
            assert.equal(access.read(bytes, { at: 512 }), 512);
            return bytes;
        });
        assert.deepEqual(stored, write_payload);
    }
    console.log(JSON.stringify(results, null, 2));
}
finally { rmSync(directory, { recursive: true, force: true }); }
