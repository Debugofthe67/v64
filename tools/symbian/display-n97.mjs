#!/usr/bin/env node
// Execute the original DispC constructor and raster routines behind a
// minimal MMU/caller, then compare every pixel in the normal display sink.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { V86 } from "../../src/main.js";
import { STATE_OFFSETS } from "../../src/arm/state_layout.js";

const [rom] = process.argv.slice(2);
if(!rom || process.argv.length !== 3) throw new Error("Usage: node tools/symbian/display-n97.mjs <rom.xip.bin>");
const vm = new V86({ machine_type: "nokia-n97", graphics_adapter: "none", disable_jit: true, autostart: false, log_level: 0,
    cpu_clock: { mode: "deterministic", instructions_per_ms: 1000 },
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
    const ttbr = 0x08004000, dispc_table = 0x08008000, trampoline = 0x08001000, done = trampoline + 0x40;
    const get_mmio = trampoline + 0x20, set_mmio = trampoline + 0x30, dispc = 0xC6024800;
    const bytes = array => new Uint8Array(array.buffer);
    const put = (pa, ...words) => cpu.write_blob_physical(bytes(Uint32Array.from(words)), pa);
    const table = new Uint32Array(4096);
    table[0x080] = 0x08000C02;
    table[0xC60] = dispc_table | 1;
    for(let offset = 0; offset < cpu.boot_files.rom.byteLength; offset += 0x100000)
        table[(0x80000000 + offset) >>> 20] = (0x08900000 + offset) | 0xC02;
    cpu.write_blob_physical(bytes(table), ttbr);
    put(dispc_table + 0x24 * 4, 0x20024FF2);
    put(trampoline, 0xEE020F10, 0xEE031F10, 0xEE112F10, 0xE3822001, 0xEE012F10, 0xEE073F95, 0xE1A0F004);
    put(get_mmio, 0xE5900000, 0xE12FFF1E); // LDR r0, [r0]; BX lr.
    put(set_mmio, 0xE5801000, 0xE12FFF1E); // STR r1, [r0]; BX lr.
    const set_reg = (n, value) => state.setUint32(STATE_OFFSETS.x + n * 8, value, true);
    function run()
    {
        for(let count = 0; count < 50000 && Number(cpu.read_pc()) !== done; count++) wasm["a64_worker_slice"](1);
        assert.equal(Number(cpu.read_pc()), done, "retail routine returned");
    }
    function call(entry, ...args)
    {
        args.forEach((value, index) => set_reg(index, value));
        set_reg(13, 0x080F0000);
        set_reg(14, done);
        state.setUint32(STATE_OFFSETS.pc, entry, true);
        run();
        return state.getUint32(STATE_OFFSETS.x, true);
    }
    wasm["a32_boot_with_registers"](trampoline, ttbr, -1, 0, 0);
    set_reg(4, done);
    run();
    cpu.clock.resume();
    const driver = 0x08030000, device = 0x08032000, mode = 0x08033000, buffer = 0x0A100000;
    const width = call(get_mmio, 0x801411AC), height = call(get_mmio, 0x801411B0); // stock panel timings
    assert.deepEqual([width, height], [640, 360]);
    assert.equal(call(0x80132758, driver, device), driver);
    assert.equal(cpu.read32_physical(driver), 0x80143670); // DispC vtable
    put(device + 0x6F0, mode);
    put(mode + 0x64, width, height);
    put(mode + 0xE4, buffer);

    let frame;
    const hub = cpu.devices.display;
    hub.sink.update_buffer = ([{ pixels }]) => { frame = pixels; };
    const reports = [];
    const read = offset => call(get_mmio, dispc + offset);
    const advance = () => cpu.run_hardware_timers(null, cpu.clock.advance_instructions(20000));
    function check_frame(open, colors)
    {
        vm.symbian_set_slider(open);
        hub.request_frame(true);
        assert.deepEqual([frame.width, frame.height], open ? [width, height] : [height, width]);
        const palette = colors.map(color => [color >>> 16, color >>> 8 & 255, color & 255]);
        for(let py = 0; py < frame.height; py++)
        {
            for(let px = 0; px < frame.width; px++)
            {
                const x = open ? px : py, y = open ? py : height - 1 - px;
                const [r, g, b] = palette[(x >= width / 2 ? 1 : 0) | (y >= height / 2 ? 2 : 0)];
                const index = (py * frame.width + px) * 4;
                if(frame.data[index] !== r || frame.data[index + 1] !== g || frame.data[index + 2] !== b || frame.data[index + 3] !== 255)
                    assert.fail("unexpected RGBA at " + px + "," + py);
            }
        }
        return createHash("sha256").update(frame.data).digest("hex");
    }
    for(const [format, bpp, values, colors] of [
        [6, 2, [0xF800, 0x07E0, 0x001F, 0xFFFF], [0xFF0000, 0x00FF00, 0x0000FF, 0xFFFFFF]],
        [8, 4, [0xAABC342D, 0x5567A542, 0xCC1E3DE0, 0x21FFC853], [0xBC342D, 0x67A542, 0x1E3DE0, 0xFFC853]],
    ])
    {
        const plane = bpp === 2 ? new Uint16Array(width * height) : new Uint32Array(width * height);
        for(let y = 0; y < height; y++)
            for(let x = 0; x < width; x++) plane[y * width + x] = values[(x >= width / 2 ? 1 : 0) | (y >= height / 2 ? 2 : 0)];
        cpu.write_blob_physical(bytes(plane), buffer);
        put(mode + 0x94, format === 6 ? 0 : 1);
        put(mode + 0xD4, bpp);
        call(set_mmio, dispc + 0x40, 0x308); // parallel TFT raster mode at the modelled controller boundary
        put(mode + 0x26C, height, width);
        put(mode + 0x3FC, 0);
        call(0x80132950, driver); // original controller formats, programs and enables the GFX plane
        assert.equal(read(0x40) & 1, 1);
        assert.equal(read(0x80), buffer);
        assert.equal(read(0xA0) >>> 1 & 15, format);
        advance();
        assert.equal(read(0x18) & 3, 2, "continuous LCD scan raises VSYNC");
        call(0x8013333C, driver); // original DispC IRQ callback
        assert.equal(read(0x18), 0, "the original callback acknowledges the DISPC flags");
        const landscape_sha256 = check_frame(true, colors), portrait_sha256 = check_frame(false, colors);

        put(mode + 0x26C, width, height);
        put(mode + 0x3FC, 1);
        call(0x80132B24, driver); // original plane DMA rotation
        call(0x80133178, driver); // original GOLCD
        assert.equal(read(0x40) & 0x20, 0x20);
        const base = read(0x80), row_inc = read(0xAC), pixel_inc = read(0xB0) << 16 >> 16;
        assert.equal(base, buffer + (height - 1) * width * bpp);
        assert.equal(row_inc, (height - 1) * width * bpp + 1);
        assert.equal(pixel_inc, 1 - (width + 1) * bpp);
        advance();
        assert.equal(read(0x40) & 0x20, 0);
        assert.equal(check_frame(true, colors), landscape_sha256);
        assert.equal(check_frame(false, colors), portrait_sha256);
        reports.push({ format, landscape_sha256, portrait_sha256, rotation: { base, row_inc, pixel_inc } });
    }
    console.log(JSON.stringify({ firmware: cpu.boot_files.rom_digest, vsync_acknowledged_by: "0x8013333C", raster: reports }, null, 2));
}
finally { await vm.destroy(); }
