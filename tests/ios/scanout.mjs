// Real Wasm comparison against the original JS pixel path. No firmware or
// guest assets: both panels see the same RAM, including DART scatter pages.
import assert from "node:assert/strict";
import path from "node:path";
import { V86 } from "../../src/main.js";
import { AppleCLCD, N90_VIDEO } from "../../src/apple/clcd.js";
const emulator = new V86({ cpu_type: "arm32", graphics_adapter: "none", memory_size: 16 << 20,
    autostart: false, log_level: 0, wasm_path: path.resolve(process.env.A64_WASM || "build/v86-arm64.wasm") });
try
{
    await new Promise((resolve, reject) => { emulator.add_listener("emulator-loaded", resolve);emulator.add_listener("emulator-error", reject); });
    const cpu = emulator.v86.cpu, ex = cpu.wm.exports;
    const bytes = N90_VIDEO.stride * N90_VIDEO.height, words = bytes / 4, base = 0x40010000;
    const offset = cpu.ram_offset(base, bytes), data = () => new Uint32Array(cpu.mem8.buffer, cpu.mem8.byteOffset + offset, words);
    let comparisons = 0;
    const make = native => {
        const fake = { mem8: cpu.mem8, ram_offset: cpu.ram_offset.bind(cpu),
            write_blob_physical: cpu.write_blob_physical.bind(cpu), io: { register_mmio() {} },
            wasm_memory: cpu.wasm_memory,
            wm: native ? { exports: { a64_video_prepare: ex.a64_video_prepare,
                a64_video_changed() { comparisons++;return ex.a64_video_changed(); } } } : undefined };
        const panel = new AppleCLCD(fake, { add_source() {},set_mode() {},set_size_graphical() {},update_buffer() {} }, { set_line() {} });
        panel.regs[0x4044 >>> 2] = base;
        return panel;
    };
    const fast = make(true), reference = make(false), both = fn => { fn(fast);fn(reference); };
    const render = (now, message) => {
        both(p => p.render(now));
        assert.deepEqual(fast.rgba, reference.rgba, message);
        assert.equal(fast.performance.frames, reference.performance.frames, message + " frame notifications");
        assert.equal(fast.blank, reference.blank, message + " blank detection");
    };
    let seed = 37;const pixels = data();
    for(let i = 0; i < words; i++) { seed = Math.imul(seed, 1664525) + 1013904223 | 0;pixels[i] = seed; }
    render(0, "initial full frame and alpha ignored by the pixel conversion");
    const count = fast.performance.frames;
    render(10, "unchanged frame");assert.equal(fast.performance.frames, count);
    for(const i of [0, 1, 2, 3, 4, 1023, 1024, words - 1])
    {
        data()[i] ^= 0xAA010203;
        render(20 + i, "change in SIMD lane/row/end " + i);
    }
    data()[100] ^= 0xFF000000;render(100, "alpha-only changes still match the original comparison");
    both(p => { p.backlight = 1023;p.invalidate(); });render(200, "fractional backlight preserves clamped rounding");
    both(p => { p.backlight = 0;p.invalidate(); });render(300, "backlight off");
    both(p => { p.backlight = 2047;p.invalidate(); });render(400, "backlight wake forces conversion despite unchanged source");
    const saved = fast.get_state(), savedRAM = cpu.mem8.slice(offset, offset + bytes);
    data().fill(0x12345678);render(500, "frame before restoring RAM");
    cpu.mem8.set(savedRAM, offset);both(p => p.set_state(saved));render(600, "snapshot restore invalidates host display cache");
    cpu.wasm_memory.grow(1);render(700, "fresh Wasm views after memory growth");
    data()[words - 1] ^= 1;render(800, "guest store after memory growth");
    const pages = bytes / 4096;
    both(p => { p.regs[0x4044 >>> 2] = 0x1000;p.translate = a => base + (pages - 1 - ((a - 0x1000) >>> 12)) * 4096 + (a & 4095);p.invalidate(); });
    render(900, "reversed DART pages are gathered into Wasm staging");
    render(910, "unchanged scattered frame");
    data()[0] ^= 0x101010;render(920, "change through scattered mapping");
    const translate = fast.translate, validComparisons = comparisons;
    both(p => { p.translate = a => (a - 0x1000) >>> 12 === 100 ? -1 : translate(a); });
    data()[words - 1] ^= 0x101;
    render(930, "an invalid DART page rejects a partial staging buffer");
    assert.equal(comparisons, validComparisons, "an incomplete frame never updates the native shadow");
    both(p => { p.translate = translate; });render(940, "mapping recovery publishes the complete changed frame");
    data().fill(0);render(1000, "all-black source");
    data()[0] = 0x00123456;render(1010, "black-panel probing remains bounded");
    render(1100, "new CPU pixels are visible at the next probe");
    const before = comparisons;
    fast.cpu.parallel = true;render(1200, "parallel cores use the original JS path");assert.equal(comparisons, before);
    fast.cpu.parallel = false;
    assert.ok(comparisons >= 20, "the real comparison API was exercised");
    if(process.env.A64_SCANOUT_BENCH)
    {
        data().fill(0x00123456);
        both(p => { p.regs[0x4044 >>> 2] = base;p.invalidate();p.render(); });
        const measure = (panel, count) => {
            const start = performance.now();
            for(let i = 0; i < count; i++) panel.render();
            return performance.now() - start;
        };
        measure(reference, 100);measure(fast, 100);
        const results = [];
        for(let round = 0; round < 3; round++)
        {
            const pair = {};
            for(const [name, panel] of round % 2 ? [["wasm", fast], ["js", reference]] : [["js", reference], ["wasm", fast]])
                pair[name] = measure(panel, 600);
            results.push(pair);
        }
        console.log(JSON.stringify({ unchanged_scans: 600, milliseconds: results }));
    }
    console.log("PASS: native scanout matches JS for pixel changes, DART, backlight, restore, memory growth and parallel fallback");
}
finally { await emulator.destroy(); }
