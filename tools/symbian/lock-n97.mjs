#!/usr/bin/env node
// Observe the original RM-505 switch extension handling the side lock in a
// cold-booted EKA2 kernel. No kernel entry points or firmware bytes are replaced.
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { V86 } from "../../src/main.js";
import { STATE_OFFSETS } from "../../src/arm/state_layout.js";

const [rom] = process.argv.slice(2);
if(!rom || process.argv.length !== 3) throw new Error("Usage: node tools/symbian/lock-n97.mjs <rom.xip.bin>");
const vm = new V86({ machine_type: "nokia-n97", graphics_adapter: "none", disable_jit: true, autostart: false,
    cpu_clock: { mode: "deterministic", instructions_per_ms: 8000 }, log_level: 0,
    wasm_path: fileURLToPath(new URL("../../build/v86-arm64.wasm", import.meta.url)),
    symbian: { rom: { url: rom }, application_processor_only: true } });
try
{
    await new Promise((resolve, reject) => {
        vm.add_listener("emulator-loaded", resolve);
        vm.add_listener("emulator-error", reject);
    });
    const cpu = vm.v86.cpu, io = cpu.io, wasm = cpu.wm.exports;
    assert.equal(cpu.boot_files.rom_digest, "9c0863e379d243f953d3cfcd87d11c98231f2d0469e69244d9ee059472c99194");
    const state = new DataView(cpu.wasm_memory.buffer, cpu.state_base);
    const field = name => state.getUint32(STATE_OFFSETS[name], true);
    const register = n => state.getUint32(STATE_OFFSETS.x + n * 8, true);
    const set_reg = (n, value) => state.setUint32(STATE_OFFSETS.x + n * 8, value, true);
    const jump = address => state.setUint32(STATE_OFFSETS.pc, address, true);
    const pc = () => Number(cpu.read_pc());
    const hex = value => "0x" + value.toString(16);
    function read_word(va)
    {
        // Read through the live kernel's short-descriptor translation tables.
        const n = field("a32_ttbcr") & 7, use_ttbr1 = n && va >>> (32 - n);
        const base = (field(use_ttbr1 ? "ttbr1_el1" : "ttbr0_el1") & (-1 << (use_ttbr1 ? 14 : 14 - n))) >>> 0;
        const index = va >>> 20 & (use_ttbr1 ? 0xFFF : (1 << (12 - n)) - 1);
        const section = cpu.read32_physical(base + index * 4);
        if((section & 3) === 2) return cpu.read32_physical(((section & 0xFFF00000) | (va & 0xFFFFF)) >>> 0);
        assert.equal(section & 3, 1, "unmapped guest VA " + hex(va));
        const page = cpu.read32_physical(((section & 0xFFFFFC00) >>> 0) + (va >>> 12 & 255) * 4);
        if(page & 2) return cpu.read32_physical(((page & 0xFFFFF000) | (va & 0xFFF)) >>> 0);
        assert.equal(page & 3, 1, "unmapped page at " + hex(va));
        return cpu.read32_physical(((page & 0xFFFF0000) | (va & 0xFFFF)) >>> 0);
    }
    function run_until(condition, limit)
    {
        for(let step = 0; step < limit && !condition(); step++)
        {
            if(step % 32 === 0) cpu.run_hardware_timers(null, cpu.clock.advance_instructions(32));
            execute();
        }
        assert.ok(condition(), "retail kernel stopped at " + hex(pc()) + " FAR " + hex(field("far_el1")));
    }
    const sisa_entry = 0x800B3B40, idle = 0x80001DBC;
    let execute = () => wasm["a64_worker_slice"](1);
    cpu.clock.resume();
    run_until(() => pc() === sisa_entry, 5000000);
    assert.equal(cpu.devices.n97_dma.status().physical_resets, 6);

    const events = [], claims = [], route = [];
    const irq_dispatch = 0x8009FEFC, callback = 0x80165090, debounce = 0x80164E28, dispatch = 0x80164C58;
    const checkpoints = new Set([irq_dispatch, callback, debounce, dispatch]);
    const faults = new Set([0x04, 0x0C, 0x10, 0xFFFF0004, 0xFFFF000C, 0xFFFF0010]);
    const read_mmio = io.mmio_read.bind(io);
    io.mmio_read = (owner, offset, width) => {
        const result = read_mmio(owner, offset, width);
        if(io.ranges[owner].base + Number(offset) === 0x20400008) claims.push(Number(result));
        return result;
    };
    let manager = 0;
    execute = () => {
        const address = pc();
        assert.ok(!faults.has(address), "retail exception " + hex(address) + " FAR " + hex(field("far_el1")));
        if(address === 0x80166080) manager = register(5);
        if(checkpoints.has(address)) route.push(address);
        if(address === 0x8006D9A0) events.push([read_word(register(0)) & 255, read_word(register(0) + 8)]);
        wasm["a64_worker_slice"](1);
    };
    set_reg(0, 0xFFFFFFFF);
    set_reg(13, register(13) - 0x180);
    set_reg(14, sisa_entry);
    jump(0x80168954); // original switch.dll initialization entry
    run_until(() => pc() === sisa_entry, 500000);
    assert.equal(register(0), 0);
    assert.ok(manager);
    const lock = read_word(manager + 0xC);
    assert.equal(read_word(lock + 4), 40, "retail switch object uses GENIO40");
    assert.equal(read_word(lock + 0x84), 1, "the board's lock switch rests high");
    const transitions = [];
    for(const pressed of [true, false, true, false])
    {
        const before = { events: events.length, route: route.length, claims: claims.length };
        const time = cpu.clock.now();
        vm.symbian_send_control("lock", pressed);
        jump(idle); // an existing ROM self-branch from which the CPU can receive IRQs
        run_until(() => events.length > before.events && pc() === idle, 1200000);
        const steps = route.slice(before.route);
        const irq = claims.slice(before.claims);
        assert.ok(irq.includes(234), "the retail dispatcher claims the panel's shared IRQ");
        assert.deepEqual(steps.filter((entry, i) => i === steps.indexOf(entry)), [...checkpoints]);
        assert.deepEqual(events.slice(before.events), [[pressed ? 3 : 4, 0xB3]]);
        assert.equal(read_word(lock + 0x84), +!pressed, "retail switch saves the sampled level for its next edge");
        transitions.push({ pressed, event: events.at(-1), milliseconds: cpu.clock.now() - time });
    }
    console.log(JSON.stringify({ firmware: cpu.boot_files.rom_digest, gpio: 40, irq: 234, transitions }, null, 2));
}
finally { await vm.destroy(); }
