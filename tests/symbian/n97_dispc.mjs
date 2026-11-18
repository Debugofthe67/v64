import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { V86 } from "../../src/main.js";
import { N97_DISPC_BASE } from "../../src/symbian/n97_dispc.js";

test("RAPIDO DISPC scans guest RAM, latches GOLCD, and preserves its in-flight frame across a snapshot", async () => {
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
        function port(address, value, width = 4)
        {
            const owner = io.ranges.findIndex(range => range && address >= range.base && address + width <= range.base + range.size);
            assert.ok(owner > 0, "unmapped PA 0x" + address.toString(16));
            const offset = address - io.ranges[owner].base;
            return value === undefined ? Number(io.mmio_read(owner, offset, width)) : io.mmio_write(owner, offset, width, BigInt(value));
        }
        const dispc = (offset, value, width) => port(N97_DISPC_BASE + offset, value, width);
        const icu = (offset, value) => port(0x20400000 + offset, value);
        const window = (width, height) => (height - 1) << 16 | width - 1;
        const advance = us => cpu.run_hardware_timers(null, cpu.clock.advance_instructions(us));
        let frame;
        cpu.devices.display.sink.update_buffer = ([{ pixels }]) => { frame = { ...pixels, data: pixels.data.slice() }; };
        const draw = () => cpu.devices.display.request_frame();
        const pixel = (x, y) => Array.from(frame.data.subarray((y * frame.width + x) * 4, (y * frame.width + x + 1) * 4));
        const x = 20, y = 30, address = 0x0A000000, address2 = address + 0x1000;
        const black = [0, 0, 0, 255], red = [255, 0, 0, 255], green = [0, 255, 0, 255];
        const blue = [0, 0, 255, 255], white = [255, 255, 255, 255];
        cpu.write_blob_physical(new Uint8Array(Uint16Array.of(0xF800, 0x07E0, 0, 0x001F, 0xFFFF, 0).buffer), address);
        cpu.write_blob_physical(new Uint8Array(Uint32Array.of(0xFEFF0000, 0x0300FF00, 0x770000FF, 0x00FFFFFF).buffer), address2);
        cpu.clock.resume();
        draw();
        assert.deepEqual([frame.width, frame.height, pixel(0, 0)], [360, 640, black]);
        assert.equal(dispc(0x10), 1);
        dispc(0x10, 0x2015); // original DispC standby and idle configuration
        assert.equal(dispc(0x10), 0x2015);
        assert.equal(dispc(0x10, undefined, 1), 0x15);
        assert.equal(dispc(0x11, undefined, 1), 0x20);
        dispc(0x11, 0xAF, 1);
        dispc(0x10, 0xFD, 1);
        assert.equal(dispc(0x10), 0x231D, "retains MIDLEMODE/clock activity and clears reserved bits");
        for(const offset of [0xA4, 0xD0, 0x160])
        {
            dispc(offset, 0x01FF01C0); // original driver initializes all three plane thresholds
            assert.equal(dispc(offset, undefined, 2), 0x01C0);
            assert.equal(dispc(offset + 2, undefined, 2), 0x01FF);
        }
        dispc(0x7C, window(640, 360));
        dispc(0x4C, 0x123456);
        dispc(0x80, address);
        dispc(0x88, y << 16 | x);
        dispc(0x8C, window(2, 2));
        dispc(0xA0, (6 << 1) | 0x21);
        dispc(0xAC, 3); // two extra bytes at the end of each row
        dispc(0x60, 90);
        dispc(0x1C, 0x23);
        icu(4, 1);
        icu(0x20, 131);
        icu(0x24, 2);
        icu(0x0C, 131);
        dispc(0x40, 0x309);
        draw();
        assert.deepEqual(pixel(359 - y, x), red, "closed slider rotates the pixel into the stock touch coordinates");
        assert.deepEqual(pixel(358 - y, x), blue);
        assert.deepEqual(pixel(0, 0), [0x12, 0x34, 0x56, 255]);
        vm.symbian_set_slider(true);
        draw();
        assert.deepEqual([frame.width, frame.height, pixel(x, y), pixel(x + 1, y), pixel(x, y + 1), pixel(x + 1, y + 1)],
            [640, 360, red, green, blue, white]);
        advance(4000);
        assert.equal(dispc(0x5C), 86);
        assert.equal(dispc(0x18), 0);
        advance(200);
        assert.equal(dispc(0x5C), 90);
        assert.equal(dispc(0x18), 0x20);
        assert.equal(icu(8), 131);
        dispc(0x18, 0x20, 1);
        icu(0x80);
        assert.equal(icu(8), 0xFFFFFFFF);

        dispc(0x80, address2 + 4);
        dispc(0xA0, (8 << 1) | 1);
        dispc(0xAC, 9);
        dispc(0xB0, (-7) >>> 0); // scan each row backwards
        assert.equal(dispc(0xB0), 0xFFF9, "pixel increment has a signed 16-bit field");
        advance(12600);
        assert.equal(dispc(0x18), 2, "continuous raster asserts VSYNC without FRAMEDONE");
        draw();
        assert.deepEqual(pixel(x, y), red, "without GO, BA0 and format remain active at their old values");
        dispc(0x18, 2);
        dispc(0x40, 0x329);
        advance(2000);
        assert.equal(dispc(0x40) & 0x20, 0x20);
        const snapshot = await vm.save_state();
        advance(16667);
        assert.equal(dispc(0x40) & 0x20, 0);
        draw();
        assert.deepEqual([pixel(x, y), pixel(x + 1, y), pixel(x, y + 1), pixel(x + 1, y + 1)],
            [green, red, white, blue], "XRGB8888 and the negative pixel increment are active together");
        vm.symbian_set_slider(false);
        await vm.restore_state(snapshot);
        draw();
        assert.equal(frame.width, 640);
        assert.deepEqual(pixel(x, y), red);
        assert.deepEqual([dispc(0xA4), dispc(0xD0), dispc(0x160)], [0x01FF01C0, 0x01FF01C0, 0x01FF01C0]);
        assert.equal(dispc(0x40) & 0x20, 0x20);
        advance(16667);
        draw();
        assert.deepEqual(pixel(x, y), green);

        dispc(0x18, 0x7FFF);
        dispc(0x40, 0x308);
        assert.equal(dispc(0x18), 0, "output disable drains the active frame before completion");
        draw();
        assert.deepEqual(pixel(x, y), green, "the raster output retains the active image while draining");
        advance(16667);
        assert.equal(dispc(0x18) & 3, 1);
        dispc(0x18, 0x7FFF);
        draw();
        assert.deepEqual(pixel(x, y), black);
        dispc(0x40, 0xB29); // stall output requires the separate controller
        advance(50000);
        draw();
        assert.equal(dispc(0x18), 0);
        assert.deepEqual(pixel(x, y), black);

        dispc(0x80, address);
        dispc(0xA0, (6 << 1) | 1);
        dispc(0x40, 0x309);
        dispc(0xAC, 3);
        dispc(0xB0, 1);
        dispc(0x40, 0x329);
        advance(16667);
        draw();
        assert.deepEqual(pixel(x, y), [248, 0, 0, 255], "replication disabled clears the low component bits");

        dispc(0x80, 0x20024800);
        dispc(0x40, 0x329);
        advance(16667);
        assert.equal(dispc(0x18) & 0x40, 0x40, "a non-RAM scanout does not access another MMIO device");
        dispc(0x10, 2);
        assert.equal(dispc(0x10), 1);
        assert.equal(dispc(0x14), 1);
        assert.equal(dispc(0x40), 0);
        assert.equal(dispc(0x18), 0);
        draw();
        assert.deepEqual(pixel(x, y), black);
    }
    finally { await vm.destroy(); }
});
