#!/usr/bin/env node
// Observes an unmodified RM-505 22.0.110 XIP on the default board.
// The trace does not register devices or change guest memory or registers.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { STATE_OFFSETS } from "../../src/arm/state_layout.js";
import { V86 } from "../../src/main.js";
import { N97_BOOT_TOC, N97_RAM_BASE, N97_RAM_SIZE, N97_ROM_ADDRESS } from "../../src/symbian/n97_board.js";
import { N97_CPU_PLL, N97_L2_BASE, N97_PLL3_CONTROL, N97_RAPIDO_SELECT } from "../../src/symbian/n97_devices.js";

if(process.argv.length !== 3) throw new Error("Usage: node tools/symbian/boot-n97.mjs <rom.xip.bin>");
const rom = await readFile(process.argv[2]);
const sha256 = createHash("sha256").update(rom).digest("hex");
assert.equal(sha256, "9c0863e379d243f953d3cfcd87d11c98231f2d0469e69244d9ee059472c99194", "expected RM-505 22.0.110 XIP");
const wasm_path = fileURLToPath(new URL("../../build/v86-arm64.wasm", import.meta.url));

const vm = new V86({ machine_type: "nokia-n97", graphics_adapter: "none", disable_jit: true,
    autostart: false, log_level: 0, wasm_path, cpu_clock: { mode: "deterministic" },
    symbian: { rom: { buffer: Uint8Array.from(rom).buffer }, rom_sha256: sha256 } });
try
{
    await new Promise((resolve, reject) => {
        vm.add_listener("emulator-loaded", resolve);
        vm.add_listener("emulator-error", reject);
    });
    const cpu = vm.v86.cpu;
    const wasm = cpu.wm.exports;
    const state = new DataView(cpu.wasm_memory.buffer, cpu.state_base);
    const pc_now = () => Number(cpu.read_pc());
    const field = name => state.getUint32(STATE_OFFSETS[name], true);
    const register = n => state.getUint32(STATE_OFFSETS.x + n * 8, true);
    const word = address => new DataView(cpu.mem8.buffer, cpu.mem8.byteOffset + cpu.ram_offset(address, 4), 4).getUint32(0, true);
    assert.equal(cpu.profile, "arm1136");
    assert.equal(pc_now(), N97_ROM_ADDRESS);
    const boot_registers = Array.from({ length: 4 }, (_, i) => register(i));

    const mmio = [];
    let step = 0;
    function log_access(owner, offset, width, direction, value)
    {
        mmio.push({ step, pc: pc_now(), direction, address: cpu.io.ranges[owner].base + Number(offset), width, value: Number(value) });
    }
    const read = cpu.io.mmio_read.bind(cpu.io);
    const write = cpu.io.mmio_write.bind(cpu.io);
    cpu.io.mmio_read = (owner, offset, width) => {
        const value = read(owner, offset, width);
        log_access(owner, offset, width, "read", value);
        return value;
    };
    cpu.io.mmio_write = (owner, offset, width, value) => {
        write(owner, offset, width, value);
        log_access(owner, offset, width, "write", value);
    };

    const entry = 0x8004F110;
    const variant_start = 0x800973C4;
    const variant_clock_exit = 0x8009746C;
    let configuration, mmu_enabled_at, first_linked_pc, ekern, variant, fault;
    let first_instructions = [];
    for(; step < 1400000; step++)
    {
        const pc = pc_now();
        const sctlr = field("sctlr_el1");
        if(first_instructions.length < 4) first_instructions.push(pc - N97_ROM_ADDRESS);
        if(!mmu_enabled_at && (sctlr & 1)) mmu_enabled_at = { pc, step, sctlr };
        if(!first_linked_pc && pc >= 0x80000000 && pc < 0x80000000 + rom.length) first_linked_pc = pc;
        if(pc === N97_ROM_ADDRESS + 0x1978)
        {
            const superpage = register(10);
            configuration = { superpage, ram_base: word(superpage + 0x102C), ram_size: word(superpage + 0x1030),
                mcu_hz: word(superpage + 0x105C), startup_reason: word(superpage + 0x4C), toc_address: word(superpage + 0x1620) };
        }
        if(pc === entry) ekern = { pc, step, sctlr, registers: [register(0), register(1)] };
        if(pc === variant_start) variant = { pc, step };
        if(pc === variant_clock_exit) variant.clocks_returned_at = step;
        wasm["a64_worker_slice"](1);
        if(pc === entry) ekern.pc_after_first_instruction = pc_now();
        if([0x4, 0xC, 0x10, 0xFFFF0004, 0xFFFF000C, 0xFFFF0010].includes(pc_now()))
        {
            fault = { pc, exception_vector: pc_now(), instructions_to_fault: step + 1,
                address: field("far_el1"), dfsr: field("esr_el1"), sctlr: field("sctlr_el1") };
            break;
        }
    }

    assert.deepEqual(first_instructions, [0, 0x1880, 0x1884, 0x1888]);
    const sram = cpu.devices.n97_sram.get_state()[1];
    const stored = new DataView(sram.buffer, sram.byteOffset, sram.byteLength);
    assert.deepEqual(Array.from({ length: 4 }, (_, n) => stored.getUint32(0x10 + n * 4, true)), boot_registers);
    assert.deepEqual(configuration, { superpage: 0x0FD00000, ram_base: N97_RAM_BASE, ram_size: N97_RAM_SIZE,
        mcu_hz: 433920000, startup_reason: 0x00012400, toc_address: N97_BOOT_TOC });
    assert.deepEqual(mmu_enabled_at, { pc: 0x08900A88, step: 29801, sctlr: 0x00C52879 });
    assert.equal(first_linked_pc, 0x80000A90);
    assert.deepEqual(ekern, { pc: entry, step: 1336737, sctlr: 0x00C5387D,
        registers: [0x80000000, 0xC0000000], pc_after_first_instruction: 0x8004F114 });
    assert.deepEqual(variant, { pc: variant_start, step: 1359960, clocks_returned_at: 1360182 });
    for(const [address, value] of [[N97_RAPIDO_SELECT, 0x3110A], [N97_L2_BASE + 0x77C, 0], [N97_L2_BASE + 0x104, 0x30000],
        [N97_CPU_PLL, 0xE29], [N97_PLL3_CONTROL, 0xD490]])
    {
        assert.ok(mmio.some(read => read.direction === "read" && read.address === address && read.width === 4 && read.value === value));
    }
    assert.deepEqual(fault, { pc: 0x800974C4, exception_vector: 0xFFFF0010, instructions_to_fault: 1360196,
        address: 0xC6031C10, dfsr: 0x808, sctlr: 0x00C5387D });
    const devices = cpu.get_diagnostics().symbian;
    assert.equal(devices.l2_enabled, true);
    assert.deepEqual(devices.clocks, { configured_cpu_hz: 433920000, pll3_locked: true });
    const snapshot = await vm.save_state();
    await vm.restart("power-on");
    assert.equal(pc_now(), N97_ROM_ADDRESS);
    const reset_devices = cpu.get_diagnostics().symbian;
    assert.equal(reset_devices.l2_enabled, false);
    assert.equal(reset_devices.clocks.pll3_locked, false);
    await vm.restore_state(snapshot);
    assert.equal(pc_now(), fault.exception_vector);
    assert.deepEqual(cpu.get_diagnostics().symbian, devices);
    console.log(JSON.stringify({ sha256, load_address: N97_ROM_ADDRESS, boot_registers, first_instructions,
        configuration, mmu_enabled_at, first_linked_pc, ekern, variant, fault, devices, reset_devices, mmio }, null, 2));
}
finally
{
    await vm.destroy();
}
