#!/usr/bin/env node
// Run the original I²C, GPIO, and exyin.dll routines on the normal N97 board.
// Minimal caller objects supply the DFC boundary and observe Kern::AddEvent.
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { V86 } from "../../src/main.js";
import { STATE_OFFSETS } from "../../src/arm/state_layout.js";

const [rom] = process.argv.slice(2);
if(!rom || process.argv.length !== 3) throw new Error("Usage: node tools/symbian/touch-n97.mjs <rom.xip.bin>");
const vm = new V86({ machine_type: "nokia-n97", graphics_adapter: "none", disable_jit: true, autostart: false,
    cpu_clock: { mode: "deterministic", instructions_per_ms: 1000 }, log_level: 0,
    wasm_path: fileURLToPath(new URL("../../build/v86-arm64.wasm", import.meta.url)), symbian: { rom: { url: rom } } });
try
{
    await new Promise((resolve, reject) => {
        vm.add_listener("emulator-loaded", resolve);
        vm.add_listener("emulator-error", reject);
    });
    const cpu = vm.v86.cpu, wasm = cpu.wm.exports;
    assert.equal(cpu.boot_files.rom_digest, "9c0863e379d243f953d3cfcd87d11c98231f2d0469e69244d9ee059472c99194");
    const state = new DataView(cpu.wasm_memory.buffer, cpu.state_base);
    const ttbr = 0x08004000, small_pages = 0x08008000, trampoline = 0x08001000, done = trampoline + 0x40;
    const load_word = trampoline + 0x20, icu = 0xC6060000, i2c = 0xC6032200;
    const linked_data = 0xC8000000, data = 0x0A000000;
    const table = new Uint32Array(4096);
    for(const [va, pa] of [[0x08000000, 0x08000000], [linked_data, data]]) table[va >>> 20] = pa | 0xC02;
    for(let offset = 0; offset < cpu.boot_files.rom.byteLength; offset += 0x100000)
        table[(0x80000000 + offset) >>> 20] = (0x08900000 + offset) | 0xC02;
    table[0xC60] = small_pages | 1;
    const peripherals = Uint32Array.from({ length: 256 }, (_, page) => (0x20000000 + page * 4096) | 0xFF2);
    peripherals[0x60] = 0x20400FF2;
    const bytes = values => new Uint8Array(Uint32Array.from(values).buffer);
    const pa = address => address >= linked_data ? data + (address - linked_data) : address;
    const put = (address, ...values) => cpu.write_blob_physical(bytes(values), pa(address));
    const word = address => cpu.read32_physical(pa(address));
    cpu.write_blob_physical(new Uint8Array(table.buffer), ttbr);
    cpu.write_blob_physical(new Uint8Array(peripherals.buffer), small_pages);
    put(trampoline, 0xEE020F10, 0xEE031F10, 0xEE112F10, 0xE3822001, 0xEE012F10, 0xEE073F95, 0xE1A0F004);
    put(load_word, 0xE5900000, 0xE12FFF1E); // LDR r0, [r0]; BX lr.
    const pc = () => Number(cpu.read_pc());
    const jump = address => state.setUint32(STATE_OFFSETS.pc, address, true);
    const get_reg = n => state.getUint32(STATE_OFFSETS.x + n * 8, true);
    const set_reg = (n, value) => state.setUint32(STATE_OFFSETS.x + n * 8, value, true);
    const events = [], gpio_callbacks = [];
    const kernel_hooks = new Map([
        [0x8016E0F8, 0], [0x8016E0A8, 0], // the minimal caller has no mutex owner
        [0x80050FB4, 0], [0x8007A6FC, 123], // debug logging and benchmark ticks
        [done + 16, 0], [done + 20, 0], // harness DFC and GPIO callbacks
        [0x8006D9A0, 0], // observe the TRawEvent before the full kernel queue
    ]);
    function step(stop)
    {
        for(let count = 0; count < 30000 && pc() !== stop; count++)
        {
            const address = pc();
            if(!kernel_hooks.has(address)) { wasm["a64_worker_slice"](1); continue; }
            if(address === 0x8006D9A0)
            {
                const event = get_reg(0);
                events.push([word(event) & 255, word(event + 8), word(event + 12)]);
            }
            if(address === done + 20) gpio_callbacks.push([get_reg(0), get_reg(1)]);
            jump(get_reg(14));
            set_reg(0, kernel_hooks.get(address));
        }
        assert.equal(pc(), stop, "guest routine returned; stopped at 0x" + pc().toString(16));
    }
    function call(entry, args = [], stop = done)
    {
        jump(entry);
        args.forEach((value, i) => set_reg(i, value));
        set_reg(13, 0x080F0000);
        set_reg(14, done);
        step(stop);
        return get_reg(0);
    }
    wasm["a32_boot_with_registers"](trampoline, ttbr, -1, 0, 0);
    set_reg(4, done);
    step(done);
    cpu.clock.resume();
    const advance = ms => cpu.run_hardware_timers(null, cpu.clock.advance_instructions(1000 * ms));

    const driver = 0xC8070000, touch_keys = driver + 0x400, pen = 0xC8072000, pen_handle = pen + 0x100;
    const tsc = 0xC8073000, master = 0xC8074000, message = 0xC8075000, tx = 0xC8076000;
    const rx = tsc + 0xB4, vtable = 0xC8077000;
    put(driver, 0x8016EABC);
    put(driver + 0xF8, touch_keys);
    put(driver + 0x108, pen);
    put(pen, vtable);
    for(let offset = 8; offset <= 0x20; offset += 4) put(vtable + offset, done + 16);
    put(tsc + 8, driver);
    call(0x801694BC); // retail exyin.dll static initialization
    call(0x8016CA8C, [driver]);
    call(0x8016C7BC, [driver]);
    call(0x8016A4E0, [touch_keys, 0xC800F9C4]); // load the retail touch-key rectangles
    assert.deepEqual(Array.from({ length: 6 }, (_, i) => word(driver + 0x170 + i * 4)),
        [0xADBE, 0, 0, 0x6448, 0xFFEBA3BC, 0xFFEAD8D0]);

    call(0x8009FDC0); // egpio.dll bank descriptors and pin table
    call(0x8009FECC);
    put(pen_handle, 6, 1, 38);
    put(pen + 0x10, pen_handle);
    call(0x800A04AC, [pen_handle, 0, 1]); // stock exyin.dll uses low-level detection
    call(0x8009F948, [call(0x8009FDF0, [1]), 6, 1]);
    put(0xC8007D48 + 1024 + 6 * 32, 0x501, done + 20, 38);
    for(const [offset, value] of [[4, 1], [0x20, 234], [0x24, 2], [0x0C, 234]])
        call(0x800D9D88, [icu + offset, value]);

    const st = (offset, value) => call(0x800D9D70, [i2c + offset, value]);
    const ld = offset => call(0x800D9D68, [i2c + offset]);
    put(master + 0x14, message);
    put(message + 0x20, tx, rx);
    function send(address, packet, stop = true)
    {
        put(tx, 0x30000000 | packet.length, 14);
        cpu.write_blob_physical(packet, pa(tx + 8));
        put(master + 0x9C, 0);
        st(0x2C, address);
        st(0x18, packet.length);
        st(0x24, stop ? 0x8603 : 0x8601);
        if(ld(8) & 2) { st(8, 6); return false; }
        for(let offset = 0; offset < packet.length; offset += 2)
        {
            assert.ok(ld(8) & 16);
            call(0x800D9124, [master], 0x800D91E0);
        }
        assert.ok(ld(8) & 4);
        st(8, 4);
        return true;
    }
    function query(command, count, desc)
    {
        assert.ok(send(0x4A, Uint8Array.of(command), false));
        assert.equal(ld(8), 0x1000);
        put(message + 0x24, desc);
        put(desc, 0x30000000 | count, count);
        put(master + 0xA0, 0);
        st(0x18, count);
        st(0x24, 0x8403);
        for(let offset = 0; offset < count; offset += 2)
        {
            const flags = ld(8);
            assert.ok(flags & 8);
            call(0x800D9048, [master, flags], 0x800D90D0);
        }
        assert.equal(ld(8), 4);
        st(8, 4);
        return Array.from(cpu.read_blob_physical(pa(desc + 8), count));
    }
    // Use the exact controller setup and register selectors stored in the retail ROM.
    const setup = new Uint8Array(cpu.boot_files.rom).subarray(0x16E450, 0x16E462);
    assert.equal(send(0x4B, setup.slice(0, 1)), false);
    assert.ok(send(0x4A, setup.slice(0, 1)));
    assert.ok(send(0x4A, setup.slice(8)));
    assert.deepEqual(query(setup[2], 2, tsc + 0xC4), [0x4A, 0x2B]);
    assert.equal(call(0x80169F80, [tsc + 0xC4]), 0);
    assert.equal(call(0x8016B5C0, [pen]), 1); // original DPenIrqGpio reads GPIO38.

    const samples = [];
    const points = [[0, 0], [320, 180], [639, 359], [15, 42]];
    for(const [x, y] of points)
    {
        vm.symbian_set_touch(x, y, true);
        if(samples.length) advance(10);
        assert.equal(call(0x8016B5C0, [pen]), 0);
        assert.equal(call(load_word, [icu + 8]), 234);
        call(0x8009FEFC, [1]);
        assert.deepEqual(gpio_callbacks.at(-1), [0x501, 0x2600]);
        assert.equal(gpio_callbacks.length, samples.length + 1);
        const result = query(setup[1], 8, rx);
        assert.equal(call(0x8016B5C0, [pen]), 1);
        call(load_word, [icu + 0x80]);
        assert.equal(call(load_word, [icu + 8]), 0xFFFFFFFF);
        call(0x80169818, [tsc]); // the real eight-byte sample callback into the digitiser state machine
        assert.deepEqual(events.at(-1), [samples.length ? 1 : 10, x, y]);
        samples.push({ adc: result, pressure: word(driver + 0x254), event: events.at(-1) });
    }
    assert.deepEqual(query(setup[2], 2, tsc + 0xC4), [0x8A, 0x2B]);
    assert.equal(call(0x80169F80, [tsc + 0xC4]), 1);
    vm.symbian_set_touch(15, 42, false);
    advance(100);
    assert.equal(call(load_word, [icu + 8]), 0xFFFFFFFF);
    assert.deepEqual(query(setup[2], 2, tsc + 0xC4), [0x4A, 0x2B]);
    assert.equal(call(0x80169F80, [tsc + 0xC4]), 0);
    call(0x8016BAFC, [driver]); // stock pen-up path, normally invoked from the timer DFC
    assert.deepEqual(events, [[10, 0, 0], [1, 320, 180], [1, 639, 359], [1, 15, 42], [11, 15, 42]]);
    const release = events.at(-1), call_keys = [];
    const previous_events = events.length;
    for(const [key, adc_x, scan] of [["send", 720, 0xC4], ["end", 293, 0xC5]])
    {
        const adc = [];
        vm.symbian_send_control(key, true);
        for(let i = 0; i < 2; i++)
        {
            if(i) advance(10);
            assert.equal(call(0x8016B5C0, [pen]), 0);
            assert.equal(call(load_word, [icu + 8]), 234);
            call(0x8009FEFC, [1]);
            assert.deepEqual(gpio_callbacks.at(-1), [0x501, 0x2600]);
            const result = query(setup[1], 8, rx);
            assert.deepEqual(result, [adc_x >> 8, adc_x & 255, 0, 15, 1, 144, 1, 194]);
            call(load_word, [icu + 0x80]);
            call(0x80169818, [tsc]);
            adc.push(result);
        }
        assert.deepEqual(events.slice(previous_events + call_keys.length * 2), [[3, scan, 0]],
            "the held call contact produces a single key-down and no LCD event");
        vm.symbian_send_control(key, false);
        assert.deepEqual(query(setup[2], 2, tsc + 0xC4), [0x4A, 0x2B]);
        assert.equal(call(0x80169F80, [tsc + 0xC4]), 0, "the stock poll detects a lifted call contact");
        // At this probe's DFC boundary, invoke the original key-release callback.
        call(0x8016A380, [touch_keys]);
        assert.deepEqual(events.at(-1), [4, scan, 0]);
        call(0x8016BAFC, [driver]);
        call_keys.push({ key, adc, events: events.slice(-2) });
    }
    assert.deepEqual(events.slice(previous_events), [[3, 0xC4, 0], [4, 0xC4, 0], [3, 0xC5, 0], [4, 0xC5, 0]]);
    console.log(JSON.stringify({ firmware: cpu.boot_files.rom_digest, i2c_address: 0x4A, gpio: 38, irq: 234,
        samples, release, call_keys }, null, 2));
}
finally { await vm.destroy(); }
