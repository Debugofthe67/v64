#!/usr/bin/env node
// Verify the original updater and run it with the standalone AP diagnostic
// handoff. The VM has no persistent disks or network device.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { inflateRawSync } from "node:zlib";
import { STATE_OFFSETS } from "../../src/arm/state_layout.js";
import { V86 } from "../../src/main.js";
import { fpsx_group_data, parse_fpsx } from "../../src/symbian/fpsx.js";
import { N97_BOOT_TIMER } from "../../src/symbian/n97_board.js";
import { N97_DISPC_BASE } from "../../src/symbian/n97_dispc.js";
import { N97_CPU_PLL_CONTROL, N97_POWER_INIT, N97_POWER_REQUEST, N97_SDRC_POWER } from "../../src/symbian/n97_devices.js";
import { select_n97_boot_certificate } from "../../src/symbian/n97_images.js";
import { N97_LOSSI_BASE } from "../../src/symbian/n97_lossi.js";
import { verify_n97_rsa_signature } from "../../src/symbian/n97_rapido_compat.js";
import { rebuild_eka2_rom } from "../../src/symbian/rom.js";

const [filename] = process.argv.slice(2);
if(!filename || process.argv.length !== 3) throw new Error("Usage: node tools/symbian/updapp-n97.mjs <RM-505_22.0.110_prd.core.C00>");
const hash = (algorithm, bytes) => createHash(algorithm).update(bytes).digest();
const sha256 = bytes => hash("sha256", bytes).toString("hex");

async function verified_updapp()
{
    const file = await stat(filename);
    assert.ok(file.isFile() && file.size === 111_508_110, "expected 0576555 CORE size");
    const bytes = await readFile(filename);
    const core_sha256 = sha256(bytes);
    assert.equal(core_sha256, "d5b3cd2467edb812ab3a582b67168a962b47e40d222f90c52e89428bdbcf8a20", "expected the original RM-505 CORE");
    const core = parse_fpsx(bytes);
    const group = name => core.groups.find(item => item.label === name);
    const root = "caeebb65d3c48e6dc73b49dc5063a2ee5867d611";
    const key_records = group("KEYS").certificates
        .map(record => bytes.subarray(record.data_offset, record.data_offset + record.size))
        .filter(data => data.length === 0x600 && hash("sha1", data.subarray(4, 0x8C)).toString("hex") === root);
    assert.equal(key_records.length, 1, "expected one matching root");
    const keys = key_records[0];
    assert.equal(keys.readUInt32LE(4), 3);
    assert.equal(keys.readUInt32LE(0x214), 3);
    assert.ok(verify_n97_rsa_signature(keys.subarray(0xC, 0x8C), keys.subarray(0x444, 0x4C4), keys.subarray(0, 0x444)),
        "root signature for KEYS");

    const updater = group("SOS*UPDAPP");
    const cert = select_n97_boot_certificate(core, updater);
    assert.ok(verify_n97_rsa_signature(keys.subarray(0x21C, 0x29C), cert.bytes.subarray(0x350, 0x3D0), cert.bytes.subarray(0, 0x168)),
        "KEYS modem signature for UPDAPP");
    const view = new DataView(cert.bytes.buffer, cert.bytes.byteOffset, cert.bytes.length);
    assert.equal(view.getUint32(0x18, true), 0x168);
    assert.equal(view.getUint32(0x1C, true), cert.bytes.length);
    assert.equal(view.getUint32(0x20, true) + 1, cert.output_size);
    const packed = fpsx_group_data(core, updater);
    const input_bytes = cert.input_size - cert.bytes.length, output_bytes = cert.output_size - cert.bytes.length;
    assert.ok(input_bytes > 0 && input_bytes <= packed.length && output_bytes > 0 && output_bytes <= 4 * 1024 * 1024);
    const { buffer: expanded, engine } = inflateRawSync(packed.subarray(0, input_bytes), { info: true, maxOutputLength: output_bytes });
    assert.equal(engine.bytesWritten, input_bytes, "updater's compressed input extent");
    assert.equal(expanded.length, output_bytes, "updater's expanded output extent");
    const digest = hash("sha1", expanded);
    digest[0] ^= 0x80;
    assert.deepEqual(digest, Buffer.from(cert.bytes.subarray(0x24, 0x38)), "signed updater payload digest");

    const rom = rebuild_eka2_rom(expanded.subarray(0xC00)).bytes;
    return { rom, source: { core_sha256, expanded_bytes: expanded.length, expanded_sha256: sha256(expanded), xip_sha256: sha256(rom) } };
}

const { rom, source } = await verified_updapp();
const vm = new V86({
    machine_type: "nokia-n97", graphics_adapter: "none", net_device: { type: "none" },
    disable_jit: true, autostart: false, log_level: 0,
    wasm_path: fileURLToPath(new URL("../../build/v86-arm64.wasm", import.meta.url)),
    cpu_clock: { mode: "deterministic", instructions_per_ms: 8000 },
    symbian: { rom: { buffer: Uint8Array.from(rom).buffer }, rom_sha256: source.xip_sha256, application_processor_only: true },
});
try
{
    await new Promise((resolve, reject) => {
        vm.add_listener("emulator-loaded", resolve);
        vm.add_listener("emulator-error", reject);
    });
    const cpu = vm.v86.cpu, wasm = cpu.wm.exports, io = cpu.io;
    const { display, n97_dispc: controller, n97_panel: panel } = cpu.devices;
    const state = new DataView(cpu.wasm_memory.buffer, cpu.state_base);
    const xip = new DataView(rom.buffer, rom.byteOffset, rom.byteLength);
    const field = (name, offset = 0) => state.getUint32(STATE_OFFSETS[name] + offset, true);
    const pc = () => Number(cpu.read_pc());
    const word = pa => cpu.read32_physical(pa) >>> 0;
    function small_page(va)
    {
        const ttbr = field("ttbr1_el1") & 0xFFFFC000; // stock high-half 16 KiB table
        assert.equal(field("a32_ttbcr") & 7, 1);
        const first = word((ttbr >>> 0) + (va >>> 20) * 4);
        assert.equal(first & 3, 1);
        const second = word(((first & 0xFFFFFC00) >>> 0) + (va >>> 12 & 0xFF) * 4);
        assert.ok(second & 2);
        return ((second & 0xFFFFF000) | (va & 0xFFF)) >>> 0;
    }
    const watched = new Set([N97_SDRC_POWER, N97_POWER_REQUEST + 8, N97_POWER_INIT, N97_CPU_PLL_CONTROL, N97_BOOT_TIMER + 0x18]);
    const accesses = [], relocation = [];
    let display_accesses = 0, step = 0, fault, mmu_off;
    function record(owner, offset, width, direction, value)
    {
        const pa = io.ranges[owner].base + Number(offset);
        if(watched.has(pa) && accesses.length < 64) accesses.push({ step, pc: pc(), pa, width, direction, value: Number(value) });
        if(pa >= N97_DISPC_BASE && pa < N97_DISPC_BASE + 0x200 || pa >= N97_LOSSI_BASE && pa < N97_LOSSI_BASE + 0x30)
            display_accesses++;
    }
    const read = io.mmio_read.bind(io), write = io.mmio_write.bind(io);
    io.mmio_read = (owner, offset, width) => {
        const value = read(owner, offset, width);
        record(owner, offset, width, "read", value);
        return value;
    };
    io.mmio_write = (owner, offset, width, value) => {
        record(owner, offset, width, "write", value);
        return write(owner, offset, width, value);
    };

    let frame;
    display.sink.update_buffer = ([{ pixels: { width, height, data } }]) => {
        let non_black_pixels = 0;
        for(let i = 0; i < data.length; i += 4)
            if(data[i] || data[i + 1] || data[i + 2]) non_black_pixels++;
        frame = { width, height, non_black_pixels, rgba_sha256: sha256(data) };
    };
    cpu.clock.resume();
    for(; step < 5_000_000; step++)
    {
        if(step && step % 32 === 0) cpu.run_hardware_timers(null, cpu.clock.advance_instructions(32));
        const here = pc();
        if(here === 0xCA1040CC && (field("sctlr_el1") & 1) && !mmu_off)
        {
            const pa = small_page(here);
            const xip_offset = 0x5C190;
            const instructions = [0, 4, 8].map(offset => word(pa + offset));
            assert.deepEqual(instructions, [0, 4, 8].map(offset => xip.getUint32(xip_offset + offset, true)),
                "relocated instructions match original SecLdd.LDD XIP");
            mmu_off = { step, pc: here, pa, before: field("sctlr_el1"), target: field("x", 8),
                xip_offset, instructions };
        }
        const in_relocation = mmu_off && relocation.length < 32 &&
            (here >= 0xCA1040CC && here < 0xCA104100 || here >= mmu_off.target && here < mmu_off.target + 0x40);
        const sctlr = in_relocation ? field("sctlr_el1") : undefined;
        wasm["a64_worker_slice"](1);
        const vector = pc();
        if(in_relocation) relocation.push({ step, pc: here, sctlr, next_pc: vector, next_sctlr: field("sctlr_el1") });
        if(step === mmu_off?.step) mmu_off.after = field("sctlr_el1");
        if([0xC, 0x10, 0xFFFF000C, 0xFFFF0010].includes(vector))
        {
            const fetch = (vector & 0xFF) === 0xC;
            fault = { step: step + 1, pc: here, vector, fsr: field(fetch ? "a32_ifsr" : "esr_el1"),
                far: field("far_el1", fetch ? 4 : 0) };
            break;
        }
    }
    display.request_frame(true);
    assert.ok(frame, "display source must publish a frame");
    console.log(JSON.stringify({ source, handoff: "standalone AP diagnostic", accesses, mmu_off, relocation, fault, last: { step, pc: pc() },
        display: { controller: controller.status(), panel: panel.status(), mmio: display_accesses, frame } }, null, 2));
}
finally
{
    await vm.destroy();
}
