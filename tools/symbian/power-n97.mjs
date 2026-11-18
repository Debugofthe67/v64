#!/usr/bin/env node
// Run the original RM-505 ISASW power-key HAL with a diagnostic IRQ vector.
// The isolated caller supplies the IRQ registration normally made after HW_CONF.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { V86 } from "../../src/main.js";
import { STATE_OFFSETS } from "../../src/arm/state_layout.js";

const [directory] = process.argv.slice(2);
if(!directory || process.argv.length !== 3)
    throw new Error("Usage: node tools/symbian/power-n97.mjs <extraction-directory>");

const vm = new V86({ machine_type: "nokia-n97", graphics_adapter: "none", disable_jit: true, autostart: false, log_level: 0,
    cpu_clock: { mode: "deterministic", instructions_per_ms: 20000 },
    wasm_path: fileURLToPath(new URL("../../build/v86-arm64.wasm", import.meta.url)),
    symbian: { rom: { url: join(directory, "rom.xip.bin") }, boot_media: { url: join(directory, "rapido-boot.bin") } } });
try
{
    await new Promise((resolve, reject) => {
        vm.add_listener("emulator-loaded", resolve);
        vm.add_listener("emulator-error", reject);
    });
    const cpu = vm.v86.cpu, io = cpu.io, wasm = cpu.wm.exports;
    assert.equal(cpu.boot_files.rom_digest, "9c0863e379d243f953d3cfcd87d11c98231f2d0469e69244d9ee059472c99194");
    const { bytes, address } = cpu.boot_files.media.isa;
    const isa = bytes.subarray(0x400), image = new DataView(isa.buffer, isa.byteOffset, isa.length);
    assert.equal(address, 0x08480000);
    assert.equal(createHash("sha256").update(isa).digest("hex"), "660c0d3b007efbbb1e51dc8a0d3f956fc77ec747eaf642374fb8543993fc714e");
    const isa_base = 0xC6300000, payload_base = isa_base + 0x400, globals_pa = 0x0A000000, globals_va = 0xC6800000;
    assert.equal(cpu.read32_physical(address + 0x400 + 0x488D0), image.getUint32(0x488D0, true));

    // Use the normal board's loaded ISASW, with its link address and its real
    // MMIO translations. Keep the caller, vectors and private stack in SDRAM.
    const write_words = (pa, words) => cpu.write_blob_physical(new Uint8Array(Uint32Array.from(words).buffer), pa);
    const table = new Uint32Array(4096), ttbr = 0x08008000, bootstrap = 0x08001000;
    const interwork = 0x08001040, ret = 0x08001100, unmask_irq = 0x08001120, leave_thumb = 0x08001140, irq_handler = 0x08001200;
    const stack = 0x0807F000, irq_stack = 0x0807E000;
    table[0] = table[0x080] = 0x08000C02;
    table[globals_va >>> 20] = globals_pa | 0xC02;
    table[0xC60] = 0x08014001;
    const registers = new Uint32Array(256);
    registers[0x30] = 0x20030FF2; // CBUS
    registers[0x31] = 0x20031FF2; // GPIO
    registers[0x40] = 0x20040FF2; // Semaphores
    registers[0x60] = 0x20400FF2; // ICU
    write_words(0x08014000, registers);
    for(let section = 0; section < 4; section++)
    {
        const coarse_table = 0x08010000 + section * 0x400;
        const physical = address + section * 0x100000;
        table[(isa_base >>> 20) + section] = coarse_table | 1;
        write_words(coarse_table, Uint32Array.from({ length: 256 }, (_, page) => (physical + page * 0x1000) | 0xFF2));
    }
    write_words(ttbr, table);
    // Install the short-descriptor tables, set SCTLR.M and BX into the caller.
    write_words(bootstrap, [0xEE020F10, 0xEE031F10, 0xEE112F10, 0xE3822001, 0xEE012F10, 0xEE073F95, 0xE1A0F004]);
    write_words(interwork, [0xE12FFF14]); // BX r4
    write_words(ret, [0xEAFFFFFE]);
    write_words(unmask_irq, [0xF1080080, 0xEAFFFFFE]); // CPSIE i; B .
    write_words(leave_thumb, [0x4770]); // Thumb BX lr
    write_words(0x08000018, [0xE51FF004, irq_handler]); // LDR pc, [pc, #-4]
    const stock_isr = payload_base + 0x61380;
    // Claim the actual ICU IRQ, set the IRQ stack, then BX to the stock ISR.
    write_words(irq_handler, [0xE59F000C, 0xE5900000, 0xE59FD008, 0xE59F4008, 0xE12FFF14,
        0xC6060008, irq_stack, stock_isr | 1]);

    const state = new DataView(cpu.wasm_memory.buffer, cpu.state_base);
    const field = name => state.getUint32(STATE_OFFSETS[name], true);
    const get_reg = index => state.getUint32(STATE_OFFSETS.x + index * 8, true);
    const reg = (index, value) => state.setUint32(STATE_OFFSETS.x + index * 8, value, true);
    const jump = pc => state.setUint32(STATE_OFFSETS.pc, pc, true);
    const pc = () => Number(cpu.read_pc());
    const hex = value => "0x" + value.toString(16);
    let instructions = 0;
    function run_until(target, observe = () => {})
    {
        for(let step = 0; step < 200000 && pc() !== target; step++, instructions++)
        {
            observe(pc());
            assert.ok(pc() >= 0x20 || pc() === 0x18, "unexpected vector " + hex(pc()) + " with FAR " + hex(field("far_el1")));
            if(instructions % 16 === 0) cpu.run_hardware_timers(null, cpu.clock.advance_instructions(16));
            wasm.a64_worker_slice(1);
        }
        assert.equal(pc(), target, "original ISASW stopped at " + hex(pc()));
    }
    function prepare_call(offset, args = [])
    {
        args.forEach((arg, index) => reg(index, arg));
        reg(4, payload_base + offset | 1);
        reg(13, stack);
        reg(14, ret);
        jump(interwork);
    }
    function call(offset, ...args)
    {
        prepare_call(offset, args);
        run_until(ret);
        return get_reg(0);
    }
    wasm.a32_boot_with_registers(bootstrap, ttbr, -1, 0, 0);
    reg(4, ret);
    cpu.clock.resume();
    run_until(ret);
    // Original scatterloader decompresses and zero-initializes the two
    // writable regions from the genuine scatter table.
    for(const offset of [0x3B3308, 0x3B3318])
    {
        for(let index = 0; index < 3; index++) reg(index, image.getUint32(offset + index * 4, true));
        reg(13, stack);
        reg(14, ret);
        jump(image.getUint32(offset + 12, true));
        run_until(ret);
    }
    assert.equal(cpu.read_blob_physical(globals_pa + 0xA672, 1)[0], 1);
    call(0x60BD2); // Original semaphore initialization
    assert.equal(call(0x60B68, 1, 0, 15), 0x0296); // Original CBUS read
    const power = pressed => vm.symbian_send_control("power", pressed);
    const key_state = () => call(0x488D0);
    const states = [key_state()];
    for(const pressed of [true, true, false])
    {
        power(pressed);
        states.push(key_state());
    }
    assert.deepEqual(states, [2, 3, 3, 2]);
    const status = () => call(0x61310, 0x1FFFF);
    const mask = () => call(0x61310, 0x2FFFF);
    const acknowledge = () => call(0x61350, 15);
    const enable = () => call(0x61360, 15);
    assert.equal(status() & 1, 1);
    assert.equal(mask() & 1, 1);
    acknowledge();
    enable();
    assert.equal(status() & 1, 0);
    assert.equal(mask() & 1, 0);

    const callback = payload_base + 0x48964, timer = payload_base + 0x5F316;
    const debounce = 0x4892A, release = 0x488FA, notifier = payload_base + 0x608B4;
    let notifications = 0;
    const observe_notifier = cur => { if(cur === notifier) notifications++; };
    call(0x61370, 15); // Original IRQ mask during debounce
    power(true);
    power(false);
    prepare_call(debounce);
    run_until(ret, cur => {
        assert.notEqual(cur, timer, "an early release must not schedule the held-key timer");
        observe_notifier(cur);
    });
    assert.equal(notifications, 0);
    assert.equal(status() & 1, 0);
    assert.equal(mask() & 1, 0);

    // Invoke the original timer callbacks in isolation. The original timer
    // scheduler requires other modem services, so observe its arguments at
    // entry and unwind to our caller before exercising the release callback.
    call(0x61370, 15);
    power(true);
    prepare_call(debounce);
    run_until(timer);
    const release_poll_us = get_reg(2);
    assert.deepEqual([get_reg(0), get_reg(1), release_poll_us], [payload_base + release + 1, 0, 50000]);
    reg(14, ret);
    jump(leave_thumb);
    run_until(ret);
    power(false);
    prepare_call(release);
    run_until(ret, observe_notifier);
    assert.equal(notifications, 1);
    assert.equal(mask() & 1, 0);
    acknowledge();

    // Delivering a real ARM IRQ requires a registered modem IRQ table. In
    // isolation, provide only the input GPIO mode, IRQ route, original
    // handler pointer and the diagnostic CPU dispatcher above.
    const callback_table = image.getUint32(0x6147C, true);
    assert.ok(callback_table >= globals_va && callback_table + 16 * 4 <= globals_va + 0x100000);
    write_words(globals_pa + callback_table - globals_va + 15 * 4, [callback | 1]);
    function write_port(pa, value)
    {
        const index = io.ranges.findIndex(range => range?.base === pa);
        assert.ok(index > 0, "unmapped PA " + hex(pa));
        io.mmio_write(index, 0, 4, BigInt(value));
    }
    const gpio = 0x20031DC0, pin = 1 << 10, icu = 0x20400000;
    write_port(gpio + 0x04, 1);
    for(const offset of [0x34, 0x2C, 0x20, 0x10]) write_port(gpio + offset, pin);
    write_port(icu + 0x20, 250);
    write_port(icu + 0x24, 2);
    write_port(icu + 0x0C, 250);
    write_port(icu + 0x04, 1);
    jump(unmask_irq);
    run_until(unmask_irq + 4);
    const path = [], claims = [], mask_writes = [];
    const original_read = io.mmio_read.bind(io), original_write = io.mmio_write.bind(io);
    io.mmio_read = (index, offset, width) => {
        const value = original_read(index, offset, width);
        if(io.ranges[index].base + Number(offset) === icu + 8) claims.push(Number(value));
        return value;
    };
    io.mmio_write = (index, offset, width, value) => {
        const pa = io.ranges[index].base + Number(offset);
        if(pa === 0x20030720 || pa === 0x2003071C) mask_writes.push([pa, Number(value)]);
        return original_write(index, offset, width, value);
    };
    power(true);
    run_until(timer, cur => {
        if(cur === 0x18 || cur === stock_isr || cur === callback) path.push(cur);
    });
    assert.deepEqual(path, [0x18, stock_isr, callback]);
    assert.equal(field("pstate") & 0x1F, 0x12, "original ISR ran in ARM IRQ mode");
    assert.deepEqual(claims, [250]);
    assert.deepEqual(mask_writes.slice(-2), [[0x20030720, 0xFFFF], [0x2003071C, 0x42]]);
    assert.deepEqual([get_reg(0), get_reg(1), get_reg(2)], [payload_base + debounce + 1, 0, 30000]);
    console.log(JSON.stringify({ avilma_id: "0x0296", power_states: states, irq: claims[0],
        stock_isr: hex(stock_isr), stock_callback: hex(callback), debounce_us: get_reg(2),
        release_poll_us, release_notifications: notifications }, null, 2));
}
finally { await vm.destroy(); }
