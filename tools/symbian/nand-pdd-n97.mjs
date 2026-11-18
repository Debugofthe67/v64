#!/usr/bin/env node
// Exercise the original mednand.pdd factory and PartitionInfo in a cold
// RM-505 AP kernel, using a disposable copy of an FPSX-derived OneNAND.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { constants, copyFileSync, createReadStream, mkdtempSync, rmSync } from "node:fs";
import { parseArgs } from "node:util";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { V86 } from "../../src/main.js";
import { STATE_OFFSETS } from "../../src/arm/state_layout.js";
import { N97_BML_USER_BLOCKS, N97_FLASH_BLOCK, N97_FLASH_HEADER, N97_FLASH_NAME, N97_FLASH_PAGE, N97_FLASH_SLOT } from "../../src/symbian/n97_flash.js";

const { positionals: [directory, ...extra], values } = parseArgs({ allowPositionals: true, options: { bml: { type: "boolean" } } });
if(!directory || extra.length) throw new Error("Usage: node tools/symbian/nand-pdd-n97.mjs <extraction-directory> [--bml]");
const scratch = mkdtempSync(join(tmpdir(), "v86-n97-pdd-"));
const nand = join(scratch, N97_FLASH_NAME);

async function user_region_sha256()
{
    const end = N97_FLASH_HEADER + N97_BML_USER_BLOCKS * (N97_FLASH_BLOCK / N97_FLASH_PAGE) * N97_FLASH_SLOT;
    const hash = createHash("sha256");
    for await(const chunk of createReadStream(nand, { end: end - 1 })) hash.update(chunk);
    return hash.digest("hex");
}

async function probe()
{
    const vm = new V86({ machine_type: "nokia-n97", graphics_adapter: "none", disable_jit: true, autostart: false,
        cpu_clock: { mode: "deterministic", instructions_per_ms: 8000 }, log_level: 0,
        wasm_path: fileURLToPath(new URL("../../build/v86-arm64.wasm", import.meta.url)),
        symbian: { rom: { url: join(directory, "rom.xip.bin") }, application_processor_only: true,
            nand: { url: nand, disk_option: "read_write" } } });
    try
    {
        await new Promise((resolve, reject) => {
            vm.add_listener("emulator-loaded", resolve);
            vm.add_listener("emulator-error", reject);
        });
        const cpu = vm.v86.cpu, io = cpu.io, wasm = cpu.wm.exports, firmware = cpu.boot_files.rom_digest;
        assert.equal(firmware, "9c0863e379d243f953d3cfcd87d11c98231f2d0469e69244d9ee059472c99194");

        const state = new DataView(cpu.wasm_memory.buffer, cpu.state_base);
        const field = name => state.getUint32(STATE_OFFSETS[name], true);
        const register = n => state.getUint32(STATE_OFFSETS.x + n * 8, true);
        const set_reg = (n, value) => state.setUint32(STATE_OFFSETS.x + n * 8, value, true);
        const pc = () => Number(cpu.read_pc());
        const jump = address => state.setUint32(STATE_OFFSETS.pc, address, true);
        const hex = value => "0x" + (value >>> 0).toString(16);
        const faults = new Set([4, 0xC, 0x10, 0xFFFF0004, 0xFFFF000C, 0xFFFF0010]);
        const sisa = 0x800B3B40;
        const registration = [], bml_status = [];
        let entered_gpio_isr = false;
        function run_until(stop, limit, track_stock_call = true)
        {
            for(let step = 0; step < limit && pc() !== stop; step++)
            {
                if(step % 32 === 0) cpu.run_hardware_timers(null, cpu.clock.advance_instructions(32));
                if(track_stock_call)
                {
                    const address = pc();
                    if(faults.has(address)) assert.fail("retail exception at " + hex(address) + " FAR " + hex(field("far_el1")));
                    if(address === 0x8010A388) registration.push({ type: register(0), drives: register(1), media: register(3) });
                    if(address === 0x800E0474) bml_status.push(register(0));
                    if(address === 0x8009FEFC) entered_gpio_isr = true;
                }
                wasm["a64_worker_slice"](1);
            }
            assert.equal(pc(), stop, "stock code stopped at " + hex(pc()) + " instead of " + hex(stop));
        }
        cpu.clock.resume();
        run_until(sisa, 5000000, false);

        // Reuse the live EKA2 kernel's ARM short-descriptor translations.
        function physical(va)
        {
            va >>>= 0;
            const n = field("a32_ttbcr") & 7, use_ttbr1 = n && va >>> (32 - n);
            const table = (field(use_ttbr1 ? "ttbr1_el1" : "ttbr0_el1") & (-1 << (use_ttbr1 ? 14 : 14 - n))) >>> 0;
            const index = va >>> 20 & (use_ttbr1 ? 0xFFF : (1 << (12 - n)) - 1);
            const first = cpu.read32_physical(table + index * 4);
            if((first & 3) === 2) return ((first & 0xFFF00000) | (va & 0xFFFFF)) >>> 0;
            assert.equal(first & 3, 1, "unmapped VA " + hex(va));
            const page = cpu.read32_physical(((first & 0xFFFFFC00) >>> 0) + (va >>> 12 & 255) * 4);
            if(page & 2) return ((page & 0xFFFFF000) | (va & 0xFFF)) >>> 0;
            assert.equal(page & 3, 1, "unmapped page at " + hex(va));
            return ((page & 0xFFFF0000) | (va & 0xFFFF)) >>> 0;
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
        const put = (va, ...values) => write_guest(va, new Uint8Array(Uint32Array.from(values).buffer));
        const read = va => cpu.read32_physical(physical(va));
        const stack = register(13) - 0x180;
        function call(entry, args = [], stop = sisa)
        {
            args.forEach((value, i) => set_reg(i, value));
            set_reg(13, stack);
            set_reg(14, sisa);
            jump(entry);
            run_until(stop, 8000000);
            return register(0);
        }
        function allocate(size)
        {
            const address = call(0x80162C48, [size]);
            assert.ok(address);
            write_guest(address, new Uint8Array(size));
            return address;
        }

        // Trace the actual bus traffic while passing every operation to the board.
        const ids = [], scanned_blocks = new Set(), claims = [];
        let erased_reads = 0, populated_reads = 0, block = 0, timing, input, rising;
        const read_mmio = io.mmio_read.bind(io), write_mmio = io.mmio_write.bind(io);
        io.mmio_read = (owner, offset, width) => {
            const value = read_mmio(owner, offset, width);
            if(io.ranges[owner].base + Number(offset) === 0x20400008) claims.push(Number(value));
            if(io.ranges[owner].base === 0)
            {
                if(offset >= 0x1E000 && offset <= 0x1E004) ids.push(Number(value));
                if(offset >= 0x400 && offset < 0xC00 || offset >= 0x10020 && offset < 0x100A0)
                {
                    if(Number(value) >>> 0 === 2 ** (8 * width) - 1) erased_reads++;
                    else populated_reads++;
                }
            }
            return value;
        };
        io.mmio_write = (owner, offset, width, value) => {
            const address = io.ranges[owner].base + Number(offset);
            if(address === 0x20034094) timing = Number(value);
            if(address === 0x20031CE4) input = Number(value);
            if(address === 0x20031D74) rising = Number(value);
            if(address === 0x1E200) block = Number(value) & 0x7FF;
            if(address === 0x1E440 && (value === 0n || value === 0x13n)) scanned_blocks.add(block);
            write_mmio(owner, offset, width, value);
        };

        assert.equal(call(0x800DEEE8, [0xFFFFFFFF]), 0); // stock media extension entry
        assert.equal(registration.length, 1);
        const { type, drives, media } = registration[0];
        assert.equal(type, 2);
        assert.equal(drives, 10);
        const factory = call(0x800DF0C8), slot = allocate(16);
        assert.equal(read(read(factory) + 40), 0x800DF984);
        put(stack, factory + 32); // TVersion reference from the original factory
        // BML verification uses the initialized PDD hardware before automatic
        // STL format can act on the imported UDA. The raw-media probe also runs
        // the full hardware phase, stopping before its async completion callback.
        const detected = call(0x800DF984, [factory, slot, read(media + 4), 0], values.bml ? 0x800DF2D4 : 0x800DFA8C);
        assert.equal(detected, 0);
        assert.equal(timing, 0x300);
        assert.deepEqual([input, rising], [1 << 22, 1 << 22]);
        const identity = [0xEC, 0x40, 0x121];
        if(values.bml)
        {
            const open = call(0x800F059C, [0]);
            assert.equal(open, 0, "stock BML_Open");
            assert.deepEqual(ids.slice(0, 3), identity);
            const after_open = cpu.devices.n97_onenand.status();
            const buffer = allocate(N97_FLASH_PAGE);
            const reference = [
                [0x00080000, "TOC", "7d205c7846a817f407f667ebb6d5e887e24fcb390561982b7850abc62acc06a1"],
                [0x01A21000, "ROFS1", "d7ae3de957f38a94bf6d1adf7651dfa5ea570c10ae727806629a763bbd8e5b3d"],
                [0x079A1000, "ROFS2", "337c98a4d956116b8e799428b35895474fc810ab97604c514bb58168afa468e8"],
                [0x09CA1000, "ROFS3", "7ff2686472083798be88dd71c55a3952059207bbe7abcb74550741014ba64cf6"],
                [0x0ABA0000, "UDA", "6b5f0abf82be73c4d3572cfda1098c7a148bfc3f29b40da55e9ebf1fba31f37b"],
            ];
            const pages = reference.map(([address, label, expected]) => {
                // BML_Read(volume, sector, count, destination, OOB, flags).
                put(stack, 0, 6);
                assert.equal(call(0x800F10C8, [0, address / 512, N97_FLASH_PAGE / 512, buffer]), 0);
                const content = Buffer.alloc(N97_FLASH_PAGE);
                for(let at = 0; at < content.length;)
                {
                    const count = Math.min(content.length - at, 4096 - ((buffer + at) & 4095));
                    content.set(cpu.read_blob_physical(physical(buffer + at), count), at);
                    at += count;
                }
                const sha256 = createHash("sha256").update(content).digest("hex");
                assert.equal(sha256, expected, label);
                return { address: hex(address), label, sha256 };
            });
            const after_read = cpu.devices.n97_onenand.status();
            assert.ok(after_read.reads >= after_open.reads + pages.length);
            assert.equal(after_read.programs, after_open.programs);
            assert.equal(after_read.erases, after_open.erases);
            const close = call(0x800F0718, [0]);
            assert.equal(close, 0, "stock BML_Close");
            return { firmware, drives, identity, open, close, pages, after_open, after_read,
                after_close: cpu.devices.n97_onenand.status() };
        }
        assert.deepEqual(ids, [...identity, ...identity, ...identity]);

        const driver = read(slot), info = allocate(0x800), partition_info = read(read(driver) + 20);
        assert.equal(partition_info, 0x800E0458); // DMediaDriverNand::PartitionInfo
        const result = call(partition_info, [driver, info]) | 0;
        assert.equal(result, -2);
        assert.deepEqual(bml_status, [0x80110000]);
        assert.deepEqual([...scanned_blocks], Array.from({ length: 44 }, (_, i) => 0x7D4 + i));
        assert.ok(erased_reads > 0);
        assert.equal(populated_reads, 0);
        const status = cpu.devices.n97_onenand.status();
        assert.deepEqual([status.reads, status.programs, status.erases], [528, 0, 0]);

        // The BML scan uses polling. Separately exercise the stock interrupt
        // route with a diagnostic read while the registered device is alive.
        const flash = io.ranges.findIndex(range => range?.handler.name === "RM-505 OneNAND CS0");
        assert.ok(flash > 0);
        const config = read_mmio(flash, 0x1E442, 2);
        io.mmio_write(flash, 0x1E442, 2, config | 0x60n);
        io.mmio_write(flash, 0x1E482, 2, 0n);
        call(0x800F671C, [0]); // original GPIO acknowledge
        call(0x800F670C, [0]); // original rising-edge unmask
        const before_irq = claims.length;
        io.mmio_write(flash, 0x1E440, 2, 0n);
        jump(0x80001DBC); // original ROM idle branch
        run_until(0x800F6724, 50000); // stop at the PDD wrapper before the media callback
        assert.ok(entered_gpio_isr && claims.slice(before_irq).includes(245));
        const diagnostic_reads = cpu.devices.n97_onenand.status().reads - status.reads;
        assert.equal(diagnostic_reads, 1);
        return { firmware, drives, identity, timing, partition_info: hex(partition_info),
            reservoir: { first: "0x7d4", last: "0x7ff", erased_reads }, bml_status: hex(bml_status[0]), result, ...status,
            diagnostic_irq: { reads: diagnostic_reads, vector: 245, pdd_entry: hex(pc()) } };
    }
    finally { await vm.destroy(); }
}

try
{
    copyFileSync(join(directory, N97_FLASH_NAME), nand, constants.COPYFILE_FICLONE);
    const user_before = values.bml ? await user_region_sha256() : null;
    const first = await probe();
    let result = first;
    if(values.bml)
    {
        assert.equal(await user_region_sha256(), user_before, "first BML mount left all user cells unchanged");
        const cold_reopen = await probe();
        assert.equal(await user_region_sha256(), user_before, "cold BML reopen left all user cells unchanged");
        result = { first, cold_reopen, user_region_sha256: user_before };
    }
    console.log(JSON.stringify(result, null, 2));
}
finally { rmSync(scratch, { recursive: true, force: true }); }
