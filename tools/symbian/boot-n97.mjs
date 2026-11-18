#!/usr/bin/env node
// Observes an unmodified RM-505 22.0.110 XIP with the selected board handoff.
// The trace does not register devices or change guest memory or registers.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { STATE_OFFSETS } from "../../src/arm/state_layout.js";
import { V86 } from "../../src/main.js";
import { N97_BOOT_TOC, N97_RAM_BASE, N97_RAM_SIZE, N97_ROM_ADDRESS } from "../../src/symbian/n97_board.js";
import { N97_CPU_PLL, N97_L2_BASE, N97_PLL3_CONTROL, N97_RAPIDO_SELECT } from "../../src/symbian/n97_devices.js";

const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    "ap-only": { type: "boolean" }, "boot-media": { type: "string" }, "boot-rom": { type: "string" }, "nand": { type: "string" },
} });
if(positionals.length !== 1 || values["boot-rom"] && !values["boot-media"] || values["ap-only"] && values["boot-media"])
{
    throw new Error("Usage: node tools/symbian/boot-n97.mjs <rom.xip.bin> [--nand <onenand.img>] [--ap-only | --boot-media <rapido-boot.bin> [--boot-rom <dump>]]");
}
const rom = await readFile(positionals[0]);
const sha256 = createHash("sha256").update(rom).digest("hex");
assert.equal(sha256, "9c0863e379d243f953d3cfcd87d11c98231f2d0469e69244d9ee059472c99194", "expected RM-505 22.0.110 XIP");
const wasm_path = fileURLToPath(new URL("../../build/v86-arm64.wasm", import.meta.url));

const instructions_per_ms = 8000;
const image = async path => path ? { buffer: Uint8Array.from(await readFile(path)).buffer } : undefined;
const vm = new V86({ machine_type: "nokia-n97", graphics_adapter: "none", disable_jit: true,
    autostart: false, log_level: 0, wasm_path, cpu_clock: { mode: "deterministic", instructions_per_ms },
    symbian: { rom: { buffer: Uint8Array.from(rom).buffer }, rom_sha256: sha256, application_processor_only: values["ap-only"],
        boot_media: await image(values["boot-media"]), bootrom: await image(values["boot-rom"]),
        nand: values.nand ? { url: values.nand, disk_option: "read_write" } : undefined } });

function observe_rapido_service(cpu, pc_now, field, register, word)
{
    const wasm = cpu.wm.exports;
    const media = cpu.boot_files.media;
    let service, result;
    for(let step = 0; step < 500000; step++)
    {
        const pc = pc_now();
        if(pc === 0xFFFF1208 && !service)
        {
            service = { step, pc, thumb: !!(field("pstate") & 32), registers: [0, 1, 2, 3].map(register), lr: register(14) };
            assert.deepEqual(service.registers, [N97_ROM_ADDRESS + 0x2A08, 0, media.isa.address, 0]);
            assert.equal(service.thumb, true);
            assert.equal(word(media.isa.address), 0x809795A3);
        }
        if(service && pc === service.lr)
        {
            result = { step, pc, return_value: register(0) };
            wasm["a64_worker_slice"](1);
            wasm["a64_worker_slice"](1);
            result.next_branch = pc_now();
            break;
        }
        if(service && (pc === 0xC || pc === 0xFFFF000C))
        {
            result = { step, pc, ifsr: field("a32_ifsr") };
            break;
        }
        wasm["a64_worker_slice"](1);
    }
    assert.ok(service && result, "the retail bootstrap should reach the RAPIDO ROM service");
    if(!cpu.boot_files.bootrom) assert.deepEqual(result, { step: service.step + 1, pc: 0x0C, ifsr: 8 });
    if(result.return_value !== undefined) assert.equal(result.next_branch, result.return_value === 1 ? 0x0890289C : 0x08902898);
    return { sha256, boot_media_sha256: media.digest, bootrom_sha256: cpu.boot_files.bootrom_digest || null,
        onenand: cpu.devices.n97_onenand?.status(), service, result };
}

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
    if(values["boot-media"])
    {
        console.log(JSON.stringify(observe_rapido_service(cpu, pc_now, field, register, word), null, 2));
    }
    else
    {
        await observe_kernel(cpu, wasm, state, pc_now, field, register, word);
    }
}
finally
{
    await vm.destroy();
}

async function observe_kernel(cpu, wasm, state, pc_now, field, register, word)
{
    const boot_registers = Array.from({ length: 4 }, (_, i) => register(i));
    const toc_entry = { start: N97_BOOT_TOC + (word(N97_BOOT_TOC) | 0), bytes: word(N97_BOOT_TOC + 4) };
    assert.deepEqual(toc_entry, { start: 0x088FF000, bytes: 4096 + rom.length });

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
    let configuration, mmu_enabled_at, first_linked_pc, ekern, variant, irq, dma, next_abort;
    const dma_entry = 0x8009D114;
    const first_instructions = [];
    const init_poll_interval = 32;
    cpu.clock.resume();
    for(; step < (values["ap-only"] ? 5000000 : 3500000); step++)
    {
        // This tool single-steps with the VM stopped. Let the normal
        // clock and device scheduler advance for the instructions just run.
        if(step && step % init_poll_interval === 0)
        {
            cpu.run_hardware_timers(null, cpu.clock.advance_instructions(init_poll_interval));
        }
        const pc = pc_now();
        const pstate = field("pstate");
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
        if(!irq && pc === 0xFFFF0018)
        {
            irq = { pc, step, mode: pstate & 31, lr: register(14),
                spsr: state.getUint32(STATE_OFFSETS.a32_spsr + 4, true) };
        }
        if(irq && !irq.scheduler && pc === 0x8004F31C) irq.scheduler = { pc, step, mode: pstate & 31 };
        if(values["ap-only"] && !dma && pc === dma_entry) dma = { pc, step, lr: register(14) };
        if(dma && !dma.first_request && pc === 0x8009D13C)
        {
            dma.first_request = { pc, step, address: (register(0) + 0x484) >>> 0, width: 4, value: register(6) };
        }
        if(dma && !dma.returned && pc === dma.lr) dma.returned = { pc, step };
        wasm["a64_worker_slice"](1);
        if(irq && !irq.returned && (pstate & 31) === 0x12 && [0x8004F354, 0x8004F370, 0x8008D120].includes(pc))
        {
            irq.returned = { instruction: pc, pc: pc_now(), step: step + 1, cpsr: (field("pstate") | field("nzcv")) >>> 0 };
        }
        if(pc === entry) ekern.pc_after_first_instruction = pc_now();
        if(!values["ap-only"] && irq?.returned) break;
        if(!next_abort && [0xC, 0x10, 0xFFFF000C, 0xFFFF0010].includes(pc_now()))
        {
            if(!dma?.returned)
                assert.fail(`Unexpected abort after PC 0x${pc.toString(16)} at VA 0x${field("far_el1").toString(16)}`);
            next_abort = { pc, step: step + 1, vector: pc_now(), far: field("far_el1"),
                fsr: field(pc_now() % 0x100 === 0x10 ? "esr_el1" : "a32_ifsr") };
        }
        if(next_abort && step % init_poll_interval === 0 && (step - next_abort.step > 50000 ||
            cpu.devices.n97_xti.packets().some(packet => /FAULT: Exception/.test(packet.data)))) break;
    }

    assert.deepEqual(first_instructions, [0, 0x1880, 0x1884, 0x1888]);
    const sram = cpu.devices.n97_sram.get_state()[1];
    const stored = new DataView(sram.buffer, sram.byteOffset, sram.byteLength);
    assert.deepEqual(Array.from({ length: 4 }, (_, n) => stored.getUint32(0x10 + n * 4, true)), boot_registers);
    assert.deepEqual(configuration, { superpage: values["ap-only"] ? 0x0FF00000 : 0x0FD00000, ram_base: N97_RAM_BASE, ram_size: N97_RAM_SIZE,
        mcu_hz: 433920000, startup_reason: 0x00012400, toc_address: N97_BOOT_TOC });
    assert.equal(mmu_enabled_at?.pc, 0x08900A88);
    assert.equal(mmu_enabled_at.sctlr, 0x00C52879);
    assert.equal(first_linked_pc, 0x80000A90);
    assert.deepEqual(ekern, { pc: entry, step: ekern?.step, sctlr: 0x00C5387D,
        registers: [0x80000000, 0xC0000000], pc_after_first_instruction: 0x8004F114 });
    assert.ok(mmu_enabled_at.step < ekern.step && ekern.step < variant.step && variant.step < variant.clocks_returned_at);
    for(const [address, value] of [[N97_RAPIDO_SELECT, 0x3110A], [N97_L2_BASE + 0x77C, 0], [N97_L2_BASE + 0x104, 0x30000],
        [N97_CPU_PLL, 0xE29], [N97_PLL3_CONTROL, 0xD490]])
    {
        assert.ok(mmio.some(read => read.direction === "read" && read.address === address && read.width === 4 && read.value === value));
    }
    assert.equal(irq?.mode, 0x12, "the board timer must enter the original IRQ vector");
    assert.equal(irq.scheduler?.mode, 0x13, "the original IRQ path must enter the SVC scheduler");
    assert.equal(irq.returned?.pc, irq.lr - 4, "the exception return must resume the interrupted instruction");
    assert.equal(irq.returned.cpsr, irq.spsr, "the exception return must restore the interrupted CPSR");
    const board_init = mmio.filter(access => access.pc >= 0x800974A4 && access.pc < 0x8009759C &&
        access.direction === "write" && access.address >= 0x20031C10 && access.address <= 0x20031D30);
    assert.equal(board_init.length, 18);
    assert.equal(new Set(board_init.map(access => access.address)).size, board_init.length);
    const tick_ports = new Set([0x200401A4, 0x200401C4, 0x20400008, 0x2040000C, 0x20400080]);
    const first_interval = mmio.find(access => access.pc === 0x8008E4B0 && access.address === 0x200401A4);
    assert.ok(first_interval, "the original variant must arm the millisecond timer");
    const tick_bus = mmio.filter(access => access.step >= first_interval.step && access.step <= irq.returned.step &&
        tick_ports.has(access.address));
    assert.deepEqual(tick_bus.map(({ direction, address, value }) => [direction, address, value]), [
        ["write", 0x200401A4, 9600], ["write", 0x2040000C, 35], ["read", 0x20400008, 35],
        ["read", 0x200401C4, 0], ["write", 0x200401C4, 9600], ["read", 0x20400008, 0xFFFFFFFF],
        ["read", 0x20400080, 0],
    ]);
    if(values["ap-only"])
    {
        assert.ok(dma?.first_request && dma.step > irq.returned.step, "the AP diagnostic must reach the original DMA extension");
        assert.equal(dma.first_request.address, 0xC6040C04);
        assert.equal(dma.first_request.value, 1);
        assert.ok(dma.returned?.step > dma.step, "the original DMA channel initialization must return");
        for(let channel = 0; channel < 6; channel++)
        {
            const base = 0x20040C00 + channel * 0x400;
            const access = mmio.filter(({ address }) => address >= base && address <= base + 8);
            assert.deepEqual(access.slice(0, 6).map(({ direction, address, width, value }) => [direction, address - base, width, value]),
                [["write", 4, 4, 1], ["write", 0, 4, 2], ["read", 0, 4, 0x6E],
                    ["write", 8, 4, 0], ["read", 8, 4, 0], ["write", 4, 4, 0]]);
        }
    }
    const devices = cpu.get_diagnostics().symbian;
    assert.equal(devices.l2_enabled, true);
    assert.equal(devices.clocks.configured_cpu_hz, 433920000);
    const stop_pc = pc_now();
    const tick_state = cpu.devices.n97_os_timer.get_state();
    const interrupt_state = cpu.devices.n97_interrupts.get_state();
    const snapshot = await vm.save_state();
    await vm.restart("power-on");
    assert.equal(pc_now(), N97_ROM_ADDRESS);
    const reset_devices = cpu.get_diagnostics().symbian;
    assert.equal(reset_devices.l2_enabled, false);
    assert.equal(reset_devices.clocks.pll3_locked, false);
    assert.equal(cpu.devices.n97_os_timer.get_state()[4], null);
    await vm.restore_state(snapshot);
    assert.equal(pc_now(), stop_pc);
    assert.deepEqual(cpu.get_diagnostics().symbian, devices);
    assert.deepEqual(cpu.devices.n97_os_timer.get_state(), tick_state);
    assert.deepEqual(cpu.devices.n97_interrupts.get_state(), interrupt_state);
    console.log(JSON.stringify({ sha256, load_address: N97_ROM_ADDRESS, boot_registers, first_instructions,
        configuration, toc_entry, mmu_enabled_at, first_linked_pc, ekern, variant, instructions_per_ms,
        irq, tick_bus, dma, next_abort, devices, reset_devices, mmio }, null, 2));
}
