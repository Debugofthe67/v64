import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { V86 } from "../../src/main.js";
import { N97_CBUS_BASE, N97_CBUS_SEMAPHORES } from "../../src/symbian/n97_cbus.js";
import { N97_AVILMA_IRQ } from "../../src/symbian/n97_devices.js";

test("N97 AVILMA power contact uses timed CBUS data and a level GPIO interrupt", async () => {
    const vm = new V86({ machine_type: "nokia-n97", graphics_adapter: "none", autostart: false, disable_jit: true, log_level: 0,
        cpu_clock: { mode: "deterministic", instructions_per_ms: 1000 },
        wasm_path: fileURLToPath(new URL("../../build/v86-arm64.wasm", import.meta.url)),
        symbian: { rom: { buffer: Uint32Array.of(0xEAFFFFFE).buffer } } });
    try
    {
        await new Promise((resolve, reject) => {
            vm.add_listener("emulator-loaded", resolve);
            vm.add_listener("emulator-error", reject);
        });
        const cpu = vm.v86.cpu, io = cpu.io;
        function port(address, value)
        {
            const owner = io.ranges.findIndex(range => range?.base === address);
            assert.ok(owner > 0, "unmapped PA 0x" + address.toString(16));
            return value === undefined ? Number(io.mmio_read(owner, 0, 4)) : io.mmio_write(owner, 0, 4, BigInt(value));
        }
        const cbus = (offset, value) => port(N97_CBUS_BASE + offset, value);
        const gpio = (offset, value) => port(0x20031DC0 + offset, value);
        const icu = (offset, value) => port(0x20400000 + offset, value);
        const advance = microseconds => cpu.run_hardware_timers(null, cpu.clock.advance_instructions(microseconds));
        function command(read, address, value = 0, device = 1, count = 16)
        {
            cbus(0x04, 1);
            cbus(0x2C, count - 1);
            if(!read) cbus(0x20, value);
            cbus(read ? 0x18 : 0x1C, device << 6 | (read ? 0x20 : 0) | address);
            assert.equal(cbus(0x08), 1);
            advance(7);
            assert.equal(cbus(0x08), 0);
            const data = cbus(0x20);
            cbus(0x04, 0);
            return data;
        }
        const read = address => command(true, address);
        const write = (address, value) => command(false, address, value);
        const power = pressed => vm.symbian_send_control("power", pressed);
        const pin = 1 << 10, idle = 0xFFFFFFFF;

        cpu.clock.resume();
        const legacy = cpu.get_state(true);
        legacy[4].splice(-2); // snapshots before the power GPIO and CBUS devices
        for(let address = N97_CBUS_SEMAPHORES; address < N97_CBUS_SEMAPHORES + 24; address += 4)
        {
            assert.equal(port(address), 0);
            port(address, 1);
            assert.equal(port(address), 1);
            assert.equal(port(address), 0, "semaphore acquisition consumes the token");
            port(address, idle);
            assert.equal(port(address), 1);
        }
        for(const offset of [0x88, 0x94])
        {
            icu(offset, 1);
            assert.equal(icu(offset), 1);
            icu(offset + 4, 1);
            assert.equal(icu(offset), 0);
        }
        gpio(0x04, 1);
        gpio(0x34, pin);
        gpio(0x2C, pin);
        gpio(0x20, pin);
        gpio(0x10, pin);
        icu(0x04, 1);
        icu(0x20, N97_AVILMA_IRQ);
        icu(0x24, 2);
        icu(0x0C, N97_AVILMA_IRQ);
        const keypad_at_rest = gpio(0x08) & 4;
        assert.equal(gpio(0x08) & pin, 0);
        assert.equal(read(0), 0x0296);
        write(0, 0);
        assert.equal(read(0), 0x0296, "AVILMA identity is read-only");
        assert.equal(read(0x16), 0x20);
        assert.equal(read(2), 0xFFFF);
        command(false, 2, 0, 2); // unconnected target
        command(false, 2, 0, 1, 8); // unsupported AVILMA word length
        assert.equal(read(2), 0xFFFF);
        assert.equal(command(true, 0x16, 0, 2), 0xFFFF, "unconnected target leaves the wire high");

        power(true);
        assert.equal(read(0x16), 0);
        assert.equal(read(1), 1);
        assert.equal(icu(0x08), idle, "masked pending status does not reach the CPU");
        write(2, 0xFFFE);
        assert.equal(gpio(0x08), keypad_at_rest | pin, "AVILMA keeps the independent keypad input level");
        assert.equal(icu(0x08), N97_AVILMA_IRQ);
        gpio(0x20, pin);
        icu(0x80);
        assert.equal(icu(0x08), N97_AVILMA_IRQ, "GPIO acknowledge alone cannot clear an asserted AVILMA level");
        write(1, 2);
        assert.equal(read(1), 1, "W1C only clears written AVILMA bits");
        write(1, 1);
        icu(0x80);
        assert.equal(icu(0x08), idle);
        power(true);
        assert.equal(read(1), 0, "a held contact cannot raise a second interrupt");

        // A partial bus transfer, owned semaphore, and physical button are
        // captured together. Restoring releases the host contact.
        cbus(0x04, 1);
        cbus(0x2C, 15);
        cbus(0x18, 0x62);
        advance(2);
        const snapshot = await vm.save_state();
        advance(7);
        assert.equal(cbus(0x20), 0xFFFE);
        await vm.restore_state(snapshot);
        assert.equal(cbus(0x08), 1);
        assert.equal(port(N97_CBUS_SEMAPHORES), 0);
        advance(7);
        assert.equal(cbus(0x20), 0xFFFE);
        cbus(0x04, 0);
        assert.equal(read(0x16), 0x20);
        assert.equal(read(1), 1, "restoring a held power contact delivers its release");
        assert.equal(icu(0x08), N97_AVILMA_IRQ);
        write(1, 1);
        icu(0x80);
        assert.equal(icu(0x08), idle);

        cbus(0x04, 1);
        cbus(0x20, 0xFFFF);
        cbus(0x1C, 0x42);
        cbus(0x04, 0);
        advance(7);
        assert.equal(read(2), 0xFFFE, "disabling CBUS cancels its outstanding write");

        cpu.set_state(legacy);
        assert.equal(gpio(0x08) & pin, 0);
        assert.equal(read(0x16), 0x20);
        assert.equal(read(2), 0xFFFF);
        power(true);
        await vm.restart("power-on");
        assert.equal(read(1), 0);
        assert.equal(read(0x16), 0x20);
    }
    finally { await vm.destroy(); }
});
