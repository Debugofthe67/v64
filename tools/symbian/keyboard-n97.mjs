#!/usr/bin/env node
// Run the retail register I/O, key decoder, and Hall routines in V86 with
// minimal caller objects. No retail ROM instructions are replaced.
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { V86 } from "../../src/main.js";
import { STATE_OFFSETS } from "../../src/arm/state_layout.js";
import { N97_KEY_CODES } from "../../src/symbian/n97_keymap.js";

const [rom] = process.argv.slice(2);
if(!rom || process.argv.length !== 3) throw new Error("Usage: node tools/symbian/keyboard-n97.mjs <rom.xip.bin>");
const emulator = new V86({
    machine_type: "nokia-n97", disable_jit: true, graphics_adapter: "none", autostart: false, log_level: 0,
    wasm_path: fileURLToPath(new URL("../../build/v86-arm64.wasm", import.meta.url)), symbian: { rom: { url: rom } },
});
try
{
    await new Promise((resolve, reject) => {
        emulator.add_listener("emulator-loaded", resolve);
        emulator.add_listener("emulator-error", reject);
    });
    const cpu = emulator.v86.cpu, wasm = cpu.wm.exports;
    assert.equal(cpu.boot_files.rom_digest, "9c0863e379d243f953d3cfcd87d11c98231f2d0469e69244d9ee059472c99194");
    const state = new DataView(cpu.wasm_memory.buffer, cpu.state_base);
    const ttbr = 0x08004000, small_pages = 0x08008000, trampoline = 0x08001000, done = trampoline + 0x40;
    const read_word = trampoline + 0x20, icu = 0xC6060000;
    const linked_data = 0xC8000000, data = 0x0A000000;
    const table = new Uint32Array(4096);
    for(const [va, pa] of [[0x08000000, 0x08000000], [linked_data, data]])
        table[va >>> 20] = pa | 0xC02;
    for(let offset = 0; offset < cpu.boot_files.rom.byteLength; offset += 0x100000)
        table[(0x80000000 + offset) >>> 20] = (0x08900000 + offset) | 0xC02;
    function ram(pa, length)
    {
        const offset = cpu.ram_offset(pa, length);
        assert.ok(offset >= 0, "unmapped RAM 0x" + pa.toString(16));
        return offset;
    }
    function write_bytes(pa, bytes)
    {
        const offset = ram(pa, bytes.length);
        cpu.mem8.set(bytes, offset);
        wasm["a64_bus_written"](offset, bytes.length);
    }
    table[0xC60] = small_pages | 1;
    const peripherals = Uint32Array.from({ length: 256 }, (_, page) => (0x20000000 + page * 4096) | 0xFF2);
    peripherals[0x60] = 0x20400FF2; // RAPIDO ICU's distinct physical region.
    const binary = values => new Uint8Array(Uint32Array.from(values).buffer);
    const linked_pa = va => data + (va - linked_data);
    const put = (va, ...words) => write_bytes(linked_pa(va), binary(words));
    const view = (pa, size) => cpu.mem8.subarray(ram(pa, size), ram(pa, size) + size);
    write_bytes(ttbr, new Uint8Array(table.buffer));
    write_bytes(small_pages, new Uint8Array(peripherals.buffer));
    // TTBR0, DACR, enable MMU, flush prefetch and branch through R4.
    write_bytes(trampoline, binary([0xEE020F10, 0xEE031F10, 0xEE112F10, 0xE3822001, 0xEE012F10, 0xEE073F95, 0xE1A0F004]));

    write_bytes(read_word, binary([0xE5900000, 0xE12FFF1E])); // LDR r0, [r0]; BX lr.
    const events = [], irq_calls = [];
    const pc = () => Number(cpu.read_pc());
    const jump = value => state.setBigUint64(STATE_OFFSETS.pc, BigInt(value), true);
    const register = index => state.getUint32(STATE_OFFSETS.x + index * 8, true);
    const set_register = (index, value) => state.setBigUint64(STATE_OFFSETS.x + index * 8, BigInt(value), true);
    function step(stop)
    {
        for(let count = 0; count < 30000; count++)
        {
            const entry = pc();
            if(entry === stop) return;
            if(entry === 0x8006D9A0)
            {
                // Capture the retail TRawEvent passed to Kern::AddEvent.
                const raw = view(register(0), 12);
                events.push([raw[0], new DataView(raw.buffer, raw.byteOffset, raw.length).getUint32(8, true)]);
            }
            else if(entry === done + 16)
            {
                // Observer installed in the test pin callback's slot.
                irq_calls.push([register(0), register(1)]);
            }
            // Kernel log, benchmark ticks, spin lock and register-dump hooks
            // normally depend on active scheduling, which this probe omits.
            else if(![0x80050FB4, 0x8007A6FC, 0x8005041C].includes(entry))
            {
                wasm["a64_worker_slice"](1);
                continue;
            }
            jump(register(14));
            set_register(0, 0);
        }
        throw new Error("Guest stopped at 0x" + pc().toString(16) + " before 0x" + stop.toString(16));
    }
    function call(entry, args = [], stop = done)
    {
        jump(entry);
        args.forEach((value, index) => set_register(index, value));
        set_register(13, 0x080F0000);
        set_register(14, done);
        step(stop);
        return register(0);
    }
    wasm["a32_boot_with_registers"](trampoline, ttbr, -1, 0, 0);
    set_register(4, done);
    step(done);

    const i2c = 0xC6032200, tx_rx = 0xC8073000, request = 0xC8074000, tx = 0xC8075000, rx = 0xC8076000;
    const st = (offset, value) => call(0x800D9D70, [i2c + offset, value]);
    const ld = offset => call(0x800D9D68, [i2c + offset]);
    put(tx_rx + 0x14, request);
    put(request + 0x20, tx, rx);
    function send(bytes, stop)
    {
        // Use original TBuf8 stack-object shape and the i2c.dll transmit worker.
        put(tx, 0x30000000 | bytes.length, 14);
        write_bytes(linked_pa(tx + 8), bytes);
        put(tx_rx + 0x9C, 0);
        st(0x2C, 0x42);
        st(0x18, bytes.length);
        st(0x24, stop ? 0x8603 : 0x8601);
        for(let i = 0; i < bytes.length; i += 2)
        {
            assert.ok(ld(8) & 16);
            call(0x800D9124, [tx_rx], 0x800D91E0);
        }
        assert.ok(ld(8) & 4);
        st(8, 4);
    }
    function receive(count)
    {
        put(rx, 0x30000000 | count, 14);
        put(tx_rx + 0xA0, 0);
        st(0x18, count);
        st(0x24, 0x8403);
        for(let i = 0; i < count; i += 2)
        {
            const stat = ld(8);
            assert.ok(stat & 8);
            call(0x800D9048, [tx_rx, stat], 0x800D90D0);
        }
        assert.equal(ld(8), 4);
        st(8, 4);
        return view(linked_pa(rx + 8), count).slice();
    }
    function query(command, length)
    {
        send(Uint8Array.of(command), false);
        assert.equal(ld(8), 0x1000);
        return receive(length);
    }
    assert.deepEqual(Array.from(query(0x80, 2)), [0, 0]);
    assert.deepEqual(Array.from(query(0x82, 1)), [0x10]);
    send(Uint8Array.of(0x81, 0), true);
    send(Uint8Array.of(0x90, 0x59), true);
    assert.deepEqual(Array.from(query(0x91, 1)), [0x59]);

    call(0x8009FDC0); // egpio.dll bank descriptors
    call(0x8009FECC); // egpio.dll pin tables
    call(0x800F924C); // keypad_exp.dll's stock raw-key table
    call(0x80167DD8); // switch.dll hardware table
    const pin66 = 0xC8078000, pin58 = pin66 + 0x10;
    put(pin66, 2, 2, 66);
    put(pin58, 26, 1, 58);
    call(0x800A04AC, [pin66, 1, 1]); // Same stock trigger call as the NSC setup.
    const gpio_control = call(0x8009FDF0, [2]);
    call(0x8009F948, [gpio_control, 2, 1]);
    const start_vector = irq => {
        call(0x800D9D88, [icu + 0x04, 1]);
        call(0x800D9D88, [icu + 0x20, irq]);
        call(0x800D9D88, [icu + 0x24, 2]);
        call(0x800D9D88, [icu + 0x0C, irq]);
    };
    start_vector(249);
    // The original GPIO ISR invokes a callback after reading its enable and
    // pending maps and then clears the bit. Observe it in the test slot.
    const callbacks = 0xC8007D48;
    for(const [bank, pin] of [[1, 26], [2, 2]])
    {
        put(callbacks + bank * 1024 + pin * 32, 0xD0000000 + 32 * bank + pin, done + 16, 32 * bank + pin);
    }

    const nsc = 0xC8070000, keypad_request = 0xC8071000, driver = 0xC8072000;
    put(keypad_request + 0x30, driver, 4);
    put(driver + 0x0C, 1);
    const stock_key_table = view(linked_pa(0xC800BED8), 80);
    const result = {};
    for(const [key, wire] of N97_KEY_CODES)
    {
        emulator.symbian_send_key(wire, true);
        emulator.symbian_send_key(wire, false);
        assert.equal(call(read_word, [icu + 8]), 249);
        call(0x8009FEFC, [2]);
        call(read_word, [icu + 0x80]);
        assert.deepEqual(irq_calls.at(-1), [0xD0000042, 0x4200]);
        assert.equal(irq_calls.length, Object.keys(result).length + 1);
        assert.deepEqual(Array.from(query(0x82, 1)), [1]);
        const fifo = query(0x89, 14);
        assert.deepEqual(Array.from(fifo), [wire | 0x80, wire, ...Array(12).fill(0)]);
        put(keypad_request + 0x68, 0x3000000E, 14);
        write_bytes(linked_pa(keypad_request + 0x70), fifo);
        call(0x800FC438, [nsc, keypad_request], 0x800FC628);
        const scan = stock_key_table[(wire & 15) === 15 ? wire - 2 : wire];
        assert.ok(scan);
        assert.deepEqual(events.slice(-2), [[3, scan], [4, scan]]);
        result[key] = { wire, scan };
    }

    const slide = 0xC8022000, sensor = slide + 0x1000, config = 0xC800F388;
    write_bytes(linked_pa(slide), view(linked_pa(config), 32));
    put(slide + 0x20, sensor);
    put(slide + 0x8C, slide + 0x300);
    put(sensor, 0x80169340);
    put(sensor + 0x30, pin58);
    call(0x8009F948, [call(0x8009FDF0, [1]), 26, 1]);
    start_vector(248);
    for(const [open, scan] of [[true, 0xBB], [false, 0xBC]])
    {
        call(0x80167DB8, [sensor, +!open]);
        emulator.symbian_set_slider(open);
        assert.equal(call(read_word, [icu + 8]), 248);
        call(0x8009FEFC, [1]);
        call(read_word, [icu + 0x80]);
        assert.deepEqual(irq_calls.at(-1), [0xD000003A, 0x3A00]);
        const level = call(0x80164D64, [slide]);
        assert.equal(level, +open);
        call(0x80164C58, [slide, level]);
        assert.deepEqual(events.slice(-2), [[3, scan], [4, scan]]);
    }
    console.log(JSON.stringify({ "keyboard": result, "gpio_callbacks": irq_calls.length,
        "slide_open_events": events.slice(-4, -2), "slide_close_events": events.slice(-2) }, null, 2));
}
finally
{
    await emulator.destroy();
}
