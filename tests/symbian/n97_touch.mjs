import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { V86 } from "../../src/main.js";
import { N97_I2C_BASE } from "../../src/symbian/n97_i2c.js";
import { create_n97_touch } from "../../src/symbian/n97_touch.js";

const retail_setup = [0x80, 0x62, 0x8A, 0x2B, 0x6A, 1, 4, 0x72, 0xF8, 0x1C];

test("TSC2004 ADC samples cover every pixel of the original exyin calibration", () => {
    const touch = create_n97_touch({ now: () => 0 }, () => {});
    touch.write(retail_setup);
    for(let pixel = 0; pixel < 640; pixel++)
    {
        const x = pixel, y = pixel % 360;
        touch.set_touch(x, y, true);
        touch.write([3]);
        const view = new DataView(Uint8Array.from(touch.read(8)).buffer);
        // The RM-505 boot calibration from exyin.dll 0x8016C7BC followed by 0x8016CE40.
        const adc_x = view.getUint16(0), adc_y = view.getUint16(2);
        assert.equal((0xADBE * (1023 - adc_y) + (0xFFEBA3BC | 0)) >> 16, x);
        assert.equal((0x6448 * adc_x + (0xFFEAD8D0 | 0)) >> 16, y);
        assert.equal(view.getUint16(4), 400);
        assert.equal(view.getUint16(6), 450);
        touch.release();
    }
});

test("N97 screen, call keys and lock share the original buses and restore without stale contacts", async () => {
    const vm = new V86({ machine_type: "nokia-n97", graphics_adapter: "none", autostart: false, disable_jit: true,
        cpu_clock: { mode: "deterministic", instructions_per_ms: 1000 }, log_level: 0,
        wasm_path: fileURLToPath(new URL("../../build/v86-arm64.wasm", import.meta.url)),
        symbian: { rom: { buffer: Uint32Array.of(0xEAFFFFFE).buffer } } });
    try
    {
        await new Promise((resolve, reject) => {
            vm.add_listener("emulator-loaded", resolve);
            vm.add_listener("emulator-error", reject);
        });
        const cpu = vm.v86.cpu, io = cpu.io;
        function port(pa, width, value)
        {
            const owner = io.ranges.findIndex(range => range && pa >= range.base && pa + width <= range.base + range.size);
            assert.ok(owner > 0);
            const offset = pa - io.ranges[owner].base;
            return value === undefined ? Number(io.mmio_read(owner, offset, width)) : io.mmio_write(owner, offset, width, BigInt(value));
        }
        const bus = (offset, value) => port(N97_I2C_BASE + offset, 2, value);
        const gpio = (offset, value) => port(0x20031D80 + offset, 4, value);
        const icu = (offset, value) => port(0x20400000 + offset, 4, value);
        function send(address, bytes, stop = true)
        {
            bus(0x2C, address);
            bus(0x18, bytes.length);
            bus(0x24, stop ? 0x8603 : 0x8601);
            const nack = !!(bus(8) & 2);
            if(!nack)
            {
                for(let index = 0; index < bytes.length; index += 2)
                    bus(0x1C, bytes[index] | ((bytes[index + 1] ?? 0) << 8));
            }
            bus(8, 6);
            return !nack;
        }
        function read_adc(command, count = 1)
        {
            assert.ok(send(0x4A, [command], false));
            bus(0x18, count * 2);
            bus(0x24, 0x8403);
            const words = [];
            for(let index = 0; index < count; index++)
            {
                const data = bus(0x1C);
                words.push((data & 255) << 8 | data >> 8);
            }
            bus(8, 4);
            return words;
        }
        const advance = us => cpu.run_hardware_timers(null, cpu.clock.advance_instructions(us));
        cpu.clock.resume();
        assert.throws(() => vm.symbian_set_touch(640, 10, true), /native screen coordinates/);
        assert.throws(() => vm.symbian_set_touch(100, 1, undefined), /boolean/);
        assert.ok(!send(0x4B, [0x83]));
        assert.ok(send(0x4A, [0x83]));
        assert.deepEqual(read_adc(0x63), [0x4000]);
        assert.ok(send(0x4A, retail_setup));
        assert.deepEqual(read_adc(0x63), [0x4A2B]);
        assert.deepEqual(read_adc(0x6B, 2), [0x104, 0xF81C]);

        assert.throws(() => vm.symbian_send_control("power", true), /expected a Nokia N97 control/);
        assert.throws(() => vm.symbian_send_control("lock", 1), /boolean state/);
        const pen = 1 << 6, lock = 1 << 8, hall = 1 << 26, absent_sd = 1 << 13;
        gpio(0x2C, pen); // exyin configures a low-level GPIO interrupt.
        gpio(0x38, pen);
        gpio(0x28, hall);
        gpio(0x34, hall);
        gpio(4, 1);
        gpio(0x10, pen | hall);
        for(const id of [234, 248])
        {
            icu(4, 1);
            icu(0x20, id);
            icu(0x24, 2);
            icu(0x0C, id);
        }
        assert.equal(gpio(8), pen | lock | absent_sd);
        vm.symbian_set_touch(320, 180, true);
        vm.symbian_set_slider(true);
        assert.equal(gpio(8), hall | lock | absent_sd);
        assert.equal(icu(8), 248);
        gpio(0x20, hall);
        icu(0x80);
        assert.equal(icu(8), 234);
        gpio(0x20, pen);
        assert.equal(gpio(0x0C) & pen, pen, "DAV remains low until all updated results have been read");
        assert.equal(read_adc(0x3B)[0] & 0xF000, 0xF000);
        assert.equal(read_adc(3)[0], 515);
        assert.equal(gpio(8) & pen, 0, "reading only X cannot clear DAV for Y and pressure");
        assert.deepEqual(read_adc(0x0B, 3), [521, 400, 450]);
        icu(0x80);
        assert.equal(icu(8), 0xFFFFFFFF);
        assert.equal(gpio(8), hall | pen | lock | absent_sd);
        assert.deepEqual(read_adc(0x63), [0x8A2B]);

        vm.symbian_set_touch(639, 359, true);
        advance(9999);
        assert.equal(gpio(8) & pen, pen);
        advance(1);
        assert.equal(icu(8), 234);
        const saved = await vm.save_state();
        assert.deepEqual(read_adc(3, 4), [972, 51, 400, 450]);
        advance(10000);
        assert.equal(cpu.devices.n97_touch.status().samples, 3, "stationary touch produces another timed batch");
        await vm.restore_state(saved);
        assert.equal(cpu.devices.n97_touch.status().pressed, false, "snapshot reopens without the host contact");
        assert.deepEqual(read_adc(3, 4), [972, 51, 400, 450]);
        assert.deepEqual(read_adc(0x63), [0x4A2B]);
        advance(50000);
        assert.equal(cpu.devices.n97_touch.status().samples, 2);
        assert.equal(gpio(8), hall | pen | lock | absent_sd);
        icu(0x80);

        // GENIO38 and GENIO40 drive the same ICU source. Confirm either
        // interrupt still reaches the guest after acknowledging the other.
        gpio(0x28, lock);
        gpio(0x38, lock);
        gpio(0x10, lock);
        vm.symbian_send_control("send", true);
        vm.symbian_send_control("lock", true);
        assert.equal(gpio(8), hall | absent_sd);
        assert.equal(gpio(0x0C), pen | lock);
        assert.equal(icu(8), 234);
        gpio(0x20, lock);
        icu(0x80);
        assert.equal(icu(8), 234, "DAV remains asserted after acknowledging lock");
        assert.deepEqual(read_adc(3, 4), [720, 15, 400, 450]);
        icu(0x80);
        assert.equal(icu(8), 0xFFFFFFFF);
        vm.symbian_set_touch(100, 200, true);
        vm.symbian_send_control("end", true);
        advance(10000);
        assert.equal(cpu.devices.n97_touch.status().contact, "send");
        assert.deepEqual(read_adc(3, 4), [720, 15, 400, 450]);
        vm.symbian_send_control("send", false);
        vm.symbian_set_touch(110, 210, true); // movement of a second contact
        assert.equal(cpu.devices.n97_touch.status().contact, null);
        assert.deepEqual(read_adc(0x63), [0x4A2B]);

        vm.symbian_set_touch(110, 210, false);
        vm.symbian_send_control("end", false);
        vm.symbian_send_control("end", true);
        gpio(0x34, lock);
        const held_controls = await vm.save_state();
        assert.equal(cpu.devices.n97_touch.status().contact, "end");
        assert.deepEqual(read_adc(3, 4), [293, 15, 400, 450]);
        vm.symbian_send_control("lock", false);
        gpio(0x20, pen);
        icu(0x80);
        assert.equal(gpio(0x0C), lock);
        assert.equal(icu(8), 234, "lock rising edge remains after draining DAV");
        await vm.restore_state(held_controls);
        assert.equal(gpio(8) & lock, lock, "restoring releases the host lock switch");
        assert.equal(cpu.devices.n97_touch.status().contact, null, "restoring releases the bezel contact");
        assert.equal(gpio(0x0C), pen | lock);
        assert.deepEqual(read_adc(3, 4), [293, 15, 400, 450]);
        gpio(0x20, lock);
        icu(0x80);

        vm.symbian_set_touch(320, 180, true);
        vm.symbian_send_control("send", true);
        assert.deepEqual(read_adc(3, 4), [515, 521, 400, 450]);
        assert.equal(cpu.devices.n97_touch.status().contact, "screen");
        vm.symbian_set_touch(320, 180, false);
        vm.symbian_send_control("send", false);
        vm.symbian_set_touch(10, 12, true);
        vm.symbian_set_touch(20, 30, false);
        assert.deepEqual([cpu.devices.n97_touch.status().x, cpu.devices.n97_touch.status().y], [20, 30]);
        assert.deepEqual(read_adc(3, 4), [86, 978, 400, 450], "lifting preserves the last latched conversion");

        // The stock NSC driver's pin 19 is KP-Y11/GPIO0. A brief glitch is
        // ignored and a valid low pulse resets N500 without losing Hall state.
        for(const delay of [4, 11])
        {
            assert.ok(send(0x42, [0x85, 0, 1]));
            assert.ok(send(0x42, [0x86, 0, 0]));
            advance(delay);
            if(delay === 11) assert.ok(!send(0x4A, [0x63]));
            assert.ok(send(0x42, [0x86, 0, 1]));
            assert.deepEqual(read_adc(0x63), [delay === 11 ? 0x4000 : 0x4A2B]);
        }
        assert.equal(gpio(8), hall | pen | lock | absent_sd);
        assert.ok(send(0x42, [0x86, 0, 0]));
        const legacy = cpu.get_state(true);
        legacy[4].splice(-4); // the earlier layout ends before the touch pin, controller, lock and display.
        assert.ok(send(0x42, [0x86, 0, 1]));
        vm.symbian_send_control("lock", true);
        cpu.set_state(legacy);
        assert.equal(gpio(8) & lock, lock, "older snapshots start with the lock switch at rest");
        assert.ok(!send(0x4A, [0x63]), "previous snapshots still drive the N500 reset line from GPIO0");
        assert.ok(send(0x42, [0x86, 0, 1]));
        assert.deepEqual(read_adc(0x63), [0x4000]);
        // Before the active-address latch was saved, the keypad was the only
        // possible target, even if software had already overwritten SA.
        bus(0x2C, 0x42);
        bus(0x18, 3);
        bus(0x24, 0x8603);
        bus(0x1C, 0x86);
        bus(0x2C, 0x4A);
        const legacy_tx = cpu.get_state(true);
        legacy_tx[4].splice(-4);
        legacy_tx[4].find(device => device?.[5] === "tx").pop();
        bus(0x24, 0);
        cpu.set_state(legacy_tx);
        bus(0x1C, 0);
        advance(11);
        assert.ok(!send(0x4A, [0x63]), "legacy in-flight TX finishes at the keypad after SA changes");
        vm.symbian_send_control("lock", true);
        await vm.restart();
        assert.equal(gpio(8) & lock, lock);
        assert.equal(cpu.devices.n97_touch.status().samples, 0);
    }
    finally { await vm.destroy(); }
});
