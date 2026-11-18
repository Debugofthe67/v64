import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { V86 } from "../../src/main.js";
import { N97_DISPC_BASE } from "../../src/symbian/n97_dispc.js";
import { N97_LOSSI_BASE } from "../../src/symbian/n97_lossi.js";

test("N97 LoSSI selects two timed targets and retains the ViSSI frame while the TFT is off", async () => {
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
        const cpu = vm.v86.cpu, io = cpu.io, panel = cpu.devices.n97_panel;
        function port(address, value, width = 4)
        {
            const owner = io.ranges.findIndex(range => range && address >= range.base && address + width <= range.base + range.size);
            assert.ok(owner > 0, "unmapped PA 0x" + address.toString(16));
            const offset = address - io.ranges[owner].base;
            return value === undefined ? Number(io.mmio_read(owner, offset, width)) : io.mmio_write(owner, offset, width, BigInt(value));
        }
        const dispc = (offset, value) => port(N97_DISPC_BASE + offset, value);
        const lossi = (offset, value, width) => port(N97_LOSSI_BASE + offset, value, width);
        const advance = us => cpu.run_hardware_timers(null, cpu.clock.advance_instructions(us));
        function word(offset, value, width = 1)
        {
            lossi(offset, value, width);
            assert.equal(lossi(0x18) & 3, 0);
            advance(1);
            assert.equal(lossi(0x18) & 3, 3);
        }
        function command(cs, byte, ...data)
        {
            word(4 + 8 * cs, byte);
            for(const value of data) word(8 + 8 * cs, value);
        }
        function read(cs, byte)
        {
            lossi(0x1C, 1);
            lossi(4 + 8 * cs, byte, 1);
            assert.equal(lossi(0x18) & 4, 0);
            advance(1);
            assert.equal(lossi(0x18) & 4, 4);
            lossi(0x20, 1);
            assert.equal(lossi(0x18) & 4, 0);
            return lossi(0x14, undefined, 1);
        }
        let frame;
        cpu.devices.display.sink.update_buffer = ([{ pixels }]) => { frame = pixels; };
        const draw = () => cpu.devices.display.request_frame(true);
        const pixel = (x, y) => {
            const i = (y * frame.width + x) * 4;
            return frame.data[i] << 16 | frame.data[i + 1] << 8 | frame.data[i + 2];
        };
        const x = 20, y = 31, buffer = 0x0A000000;
        const colors = [0xFF0000, 0x00FF00, 0x0000FF, 0xFFFFFF];
        const sample = () => [pixel(x, y), pixel(x + 1, y), pixel(x, y + 1), pixel(x + 1, y + 1)];
        cpu.clock.resume();
        vm.symbian_set_slider(true);
        cpu.write_blob_physical(new Uint8Array(Uint16Array.of(0xF800, 0x07E0, 0x001F, 0xFFFF).buffer), buffer);
        dispc(0x7C, 359 << 16 | 639);
        dispc(0x80, buffer);
        dispc(0x8C, 0x10001);
        dispc(0xA0, 0x2AD);
        dispc(0x40, 0x309);
        const before_panel = cpu.get_state(true);
        before_panel[4].splice(63); // S3.1 serialized 63 slots, ending at the DISPC.
        dispc(0x7C, 0x10001);
        dispc(0x40, 0x329);
        advance(17000);

        lossi(0x24, 0x7F);
        lossi(0x0C, 0x11, 1);
        advance(29);
        assert.equal(lossi(0x18), 0, "the configured divider holds the serial link busy");
        advance(1);
        assert.equal(lossi(0x18), 3);
        lossi(0x24, 0);
        assert.equal(read(1, 0x0A) & 0x10, 0, "TFT sleep exit has a separate settling interval");
        command(0, 0x11);
        command(0, 0x3A, 0x70);
        command(1, 0x3A, 7);
        assert.equal(read(1, 0x0C), 7);
        assert.equal(read(0, 0x0C), 0x70);
        assert.equal(read(1, 0x5A), 0xFF, "unsupported vendor reads leave the wire high");

        command(0, 0x2A, 0, 0, x, 0, 0);
        assert.deepEqual(panel.status().columns, [0, 639]);
        word(8, x + 1);
        command(0, 0x2B, 0, 0, y, 0, 0, y + 1);
        lossi(0x24, 0x80);
        // The TFT's window is two big-endian halfwords, independent of CS0.
        word(0x0C, 0x2A);
        word(0x10, 0x0002, 2);
        word(0x10, 0x0003, 2);
        lossi(0x24, 0);
        assert.deepEqual(panel.status().columns, [x, x + 1]);
        assert.deepEqual(panel.status().pages, [y, y + 1]);
        command(0, 0x2A, 0, 0, 22, 0, 2, 128); // out of range, leave the valid window intact
        assert.deepEqual(panel.status().columns, [x, x + 1]);
        command(0, 0x2C);
        command(1, 0x29);
        draw();
        assert.deepEqual(sample(), [0, 0, 0, 0]);
        advance(17000);
        draw();
        assert.deepEqual(sample(), colors);
        assert.equal(pixel(0, 0), 0);
        assert.equal(panel.status().pixels_received, 4);

        dispc(0x40, 0x308);
        cpu.write_blob_physical(new Uint8Array(8), buffer);
        command(1, 0x28);
        draw();
        assert.deepEqual(sample(), [0, 0, 0, 0]);
        lossi(0x24, 0x7F);
        lossi(0x0C, 0x29, 1);
        const snapshot = await vm.save_state();
        advance(31);
        draw();
        assert.deepEqual(sample(), colors, "waking displays GRAM after scanout stops and SDRAM is cleared");
        await vm.restore_state(snapshot);
        assert.equal(lossi(0x18) & 3, 0, "restore preserves the in-flight CS1 command");
        draw();
        assert.deepEqual(sample(), [0, 0, 0, 0]);
        advance(31);
        draw();
        assert.deepEqual(sample(), colors);

        lossi(0x0C, 0x28, 1);
        lossi(0, 3);
        assert.equal(lossi(0), 5);
        advance(50);
        draw();
        assert.deepEqual(sample(), colors, "the serial controller reset discards the pending command, not GRAM");
        command(0, 0x01);
        draw();
        assert.deepEqual(sample(), [0, 0, 0, 0]);
        command(0, 0x11);
        advance(5000);
        draw();
        assert.deepEqual(sample(), colors, "the panel soft reset preserves stored pixels");
        command(1, 0x10);
        draw();
        assert.deepEqual(sample(), [0, 0, 0, 0]);
        command(1, 0x11);
        advance(5000);
        draw();
        assert.deepEqual(sample(), colors);

        await vm.restart();
        assert.equal(panel.status().managed, false);
        assert.equal(panel.status().pixels_received, 0);
        assert.equal(lossi(0x18), 3);

        await vm.restore_state(snapshot);
        advance(31);
        cpu.set_state(before_panel);
        cpu.write_blob_physical(new Uint8Array(Uint16Array.of(0xF800, 0x07E0, 0x001F, 0xFFFF).buffer), buffer);
        draw();
        assert.equal(panel.status().managed, false);
        assert.equal(cpu.devices.n97_lossi.status().transferred, 0);
        assert.deepEqual([pixel(0, 0), pixel(1, 0), pixel(0, 1), pixel(1, 1)], colors, "a pre-panel snapshot still shows the direct raster");
    }
    finally { await vm.destroy(); }
});
