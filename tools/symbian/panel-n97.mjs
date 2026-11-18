#!/usr/bin/env node
// Cold-boot the original RM-505 AP kernel, then use its LoSSI DFC,
// both display interface constructors and the original DispC scanout.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { V86 } from "../../src/main.js";
import { STATE_OFFSETS } from "../../src/arm/state_layout.js";
import { N97_DISPC_BASE } from "../../src/symbian/n97_dispc.js";

const [rom] = process.argv.slice(2);
if(!rom || process.argv.length !== 3) throw new Error("Usage: node tools/symbian/panel-n97.mjs <rom.xip.bin>");
const instructions_per_ms = 8000;
const vm = new V86({ machine_type: "nokia-n97", graphics_adapter: "none", disable_jit: true, autostart: false,
    cpu_clock: { mode: "deterministic", instructions_per_ms }, log_level: 0,
    wasm_path: fileURLToPath(new URL("../../build/v86-arm64.wasm", import.meta.url)),
    symbian: { rom: { url: rom }, application_processor_only: true } });
try
{
    await new Promise((resolve, reject) => {
        vm.add_listener("emulator-loaded", resolve);
        vm.add_listener("emulator-error", reject);
    });
    const cpu = vm.v86.cpu, wasm = cpu.wm.exports, { n97_panel: panel, n97_lossi: lossi } = cpu.devices;
    const firmware = cpu.boot_files.rom_digest;
    assert.equal(firmware, "9c0863e379d243f953d3cfcd87d11c98231f2d0469e69244d9ee059472c99194");
    const state = new DataView(cpu.wasm_memory.buffer, cpu.state_base);
    const field = name => state.getUint32(STATE_OFFSETS[name], true);
    const register = n => state.getUint32(STATE_OFFSETS.x + n * 8, true);
    const set_reg = (n, value) => state.setUint32(STATE_OFFSETS.x + n * 8, value, true);
    const pc = () => Number(cpu.read_pc());
    const jump = address => state.setUint32(STATE_OFFSETS.pc, address, true);
    const hex = value => "0x" + value.toString(16);
    const faults = new Set([4, 0xC, 0x10, 0xFFFF0004, 0xFFFF000C, 0xFFFF0010]);
    const advance = instructions => cpu.run_hardware_timers(null, cpu.clock.advance_instructions(instructions));
    const sisa = 0x800B3B40; // missing-modem checkpoint in the AP-only diagnostic
    let display_interrupts = 0;
    function run_to_return(limit, check_faults = true)
    {
        for(let step = 0; step < limit && pc() !== sisa; step++)
        {
            if(step % 32 === 0) advance(32);
            if(check_faults && faults.has(pc())) assert.fail("retail exception at " + hex(pc()) + " FAR " + hex(field("far_el1")));
            if(pc() === 0x8013333C) display_interrupts++;
            wasm["a64_worker_slice"](1);
        }
        assert.equal(pc(), sisa, "retail execution returns at the checkpoint");
    }
    cpu.clock.resume();
    run_to_return(5000000, false);
    assert.equal(cpu.devices.n97_dma.status().physical_resets, 6);

    // Use the cold kernel's page tables to supply diagnostic caller data.
    function physical(va)
    {
        va >>>= 0;
        const n = field("a32_ttbcr") & 7, use_ttbr1 = n && va >>> (32 - n);
        const table = (field(use_ttbr1 ? "ttbr1_el1" : "ttbr0_el1") & (-1 << (use_ttbr1 ? 14 : 14 - n))) >>> 0;
        const index = va >>> 20 & (use_ttbr1 ? 0xFFF : (1 << (12 - n)) - 1);
        const first = cpu.read32_physical(table + index * 4);
        if((first & 3) === 2) return ((first & 0xFFF00000) | (va & 0xFFFFF)) >>> 0;
        assert.equal(first & 3, 1, "unmapped VA " + hex(va));
        const page = cpu.read32_physical(((first & 0xFFFFFC00) >>> 0) + (va >>> 12 & 255) * 4);
        if(page & 2) return ((page & 0xFFFFF000) | (va & 0xFFF)) >>> 0;
        assert.equal(page & 3, 1, "unmapped page at " + hex(va));
        return ((page & 0xFFFF0000) | (va & 0xFFFF)) >>> 0;
    }
    function write_guest(va, bytes)
    {
        for(let start = 0; start < bytes.length;)
        {
            const end = Math.min(bytes.length, start + 0x1000 - ((va + start) & 0xFFF));
            cpu.write_blob_physical(bytes.subarray(start, end), physical(va + start));
            start = end;
        }
    }
    const put = (va, ...values) => write_guest(va, new Uint8Array(Uint32Array.from(values).buffer));
    const read = va => cpu.read32_physical(physical(va));
    const stack = register(13) - 0x180;
    function call(entry, ...args)
    {
        args.forEach((value, i) => set_reg(i, value));
        set_reg(13, stack);
        set_reg(14, sisa);
        jump(entry);
        run_to_return(540000);
        return register(0);
    }
    function allocate(size)
    {
        const address = call(0x80162C48, size); // stock kernel heap veneer
        assert.ok(address);
        write_guest(address, new Uint8Array(size));
        return address;
    }

    assert.equal(call(0x80114038, 0xFFFFFFFF), 0); // LoSSI driver entry
    const display = allocate(0x900), mode = allocate(0xC00), config = allocate(0x200);
    const driver = display + 0x16C, lcd = mode + 0x4CC, buffer = mode + 0x7D4;
    assert.equal(call(0x8012DFC0, driver, display), driver); // DisplayControllerHw owns DispC
    put(stack, config);
    assert.equal(call(0x8013B1AC, mode, display, 0, config), mode); // WhiteDwarf owns both LoSSI interfaces
    assert.equal(read(lcd + 0x288), 1);
    assert.equal(read(buffer + 0x104), 0);

    function submit(object, begin, end, commands)
    {
        call(begin, object);
        for(const [entry, ...args] of commands) call(entry, object, ...args);
        assert.equal(call(end, object), 0); // unmodified LoSSI DFC sends words and completes
    }
    const cs0 = commands => submit(buffer, 0x8014005C, 0x8013948C, commands);
    const cs1 = commands => submit(lcd, 0x8013FD10, 0x801372E4, commands);
    cs1([[0x801403D0], [0x80140390], [0x801403E0]]); // sleep exit, pixel format 7, display on
    cs0([[0x80138EC0], [0x80138D48]]); // original buffer setup selects format 0x70 and exits sleep
    advance(20 * instructions_per_ms);
    cs0([[0x80138E5C, 0, 639], [0x80138DF8, 0, 359], [0x80138DF0]]); // windows and write start

    assert.equal(read(driver), 0x801432B4); // DisplayControllerHw derives from DispC
    const width = 640, height = 360, plane = 0x0DA00000;
    put(display + 0x6F0, mode);
    put(mode + 0x64, width, height);
    put(mode + 0xE4, plane);
    put(mode + 0xD4, 4);
    put(mode + 0x94, 1);
    put(mode + 0x26C, height, width);
    const colors = [0xBC342D, 0x67A542, 0x1E3DE0, 0xFFC853];
    const data = new Uint32Array(width * height);
    const left = 304, top = 30, columns = 180, rows = 25, replacement = 0xAF230B;
    const in_rect = (x, y) => x >= left && x < left + columns && y >= top && y < top + rows;
    let updated = false;
    const expected = (x, y) => updated && in_rect(x, y) ? replacement :
        colors[(x >= width / 2 ? 1 : 0) | (y >= height / 2 ? 2 : 0)];
    for(let y = 0; y < height; y++)
        for(let x = 0; x < width; x++) data[y * width + x] = expected(x, y);
    cpu.write_blob_physical(new Uint8Array(data.buffer), plane);
    call(0x80132950, driver); // original display controller configures the GFX plane
    advance(32 * instructions_per_ms);
    assert.equal(panel.status().pixels_received, width * height);

    let frame;
    const hub = cpu.devices.display;
    hub.sink.update_buffer = ([{ pixels }]) => { frame = pixels; };
    function check_frame(landscape, black = false)
    {
        vm.symbian_set_slider(landscape);
        hub.request_frame(true);
        assert.deepEqual([frame.width, frame.height], landscape ? [width, height] : [height, width]);
        for(let y = 0; y < frame.height; y++)
        {
            for(let x = 0; x < frame.width; x++)
            {
                const i = (y * frame.width + x) * 4;
                const rgb = frame.data[i] << 16 | frame.data[i + 1] << 8 | frame.data[i + 2];
                const color = black ? 0 : landscape ? expected(x, y) : expected(y, height - 1 - x);
                if(rgb !== color || frame.data[i + 3] !== 255) assert.fail("unexpected RGBA at " + x + "," + y);
            }
        }
        return createHash("sha256").update(frame.data).digest("hex");
    }
    const initial = { landscape: check_frame(true), portrait: check_frame(false) };

    function display_register(offset)
    {
        const address = N97_DISPC_BASE + offset, io = cpu.io;
        const owner = io.ranges.findIndex(range => range?.base === address);
        assert.ok(owner > 0);
        return Number(io.mmio_read(owner, 0, 4));
    }
    // Supply the live kernel DFC queue normally provided by the display
    // owner. The original DispC constructor and initializer own the DFCs.
    const dfc_queue = read(0xC8006BB8 + 0x3C);
    assert.ok(dfc_queue);
    put(display + 0x704, dfc_queue);
    const handshake = [], io = cpu.io;
    const read_mmio = io.mmio_read.bind(io), write_mmio = io.mmio_write.bind(io);
    io.mmio_read = (owner, offset, access_width) => {
        const value = read_mmio(owner, offset, access_width);
        if(io.ranges[owner].base + Number(offset) === N97_DISPC_BASE + 0x14)
            handshake.push(["read", hex(pc()), Number(value)]);
        return value;
    };
    io.mmio_write = (owner, offset, access_width, value) => {
        if(io.ranges[owner].base + Number(offset) === N97_DISPC_BASE + 0x10)
            handshake.push(["write", hex(pc()), Number(value)]);
        write_mmio(owner, offset, access_width, value);
    };
    try { assert.equal(call(0x801335E0, driver), 0, "original DispC software reset returns"); }
    finally
    {
        io.mmio_read = read_mmio;
        io.mmio_write = write_mmio;
    }
    assert.deepEqual(handshake, [["write", "0x801335e8", 2], ["read", "0x801335f0", 0], ["write", "0x80133600", 0]]);
    assert.equal(display_register(0x14), 0);
    assert.equal(check_frame(true), initial.landscape);
    assert.equal(check_frame(false), initial.portrait);
    assert.equal(call(0x801327D4, driver), 0, "original DispC initializer returns and binds IRQ 131");
    advance(instructions_per_ms);
    assert.equal(display_register(0x14), 1);
    assert.equal(display_register(0x10), 0x2015);
    assert.deepEqual([0xA4, 0xD0, 0x160].map(display_register), [0x01FF01C0, 0x01FF01C0, 0x01FF01C0]);
    call(0x80132950, driver);
    advance(20 * instructions_per_ms);
    assert.equal(panel.status().pixels_received, width * height);

    data.fill(0xD0C1F2);
    for(let y = top; y < top + rows; y++) data.fill(replacement, y * width + left, y * width + left + columns);
    cpu.write_blob_physical(new Uint8Array(data.buffer), plane);
    put(mode + 0x31C, left | columns << 16, top | rows << 16);
    put(mode + 0x2CC, 1);
    put(mode + 0x2DC, 0);
    call(0x8013297C, driver, 0); // drain the full scanout
    advance(32 * instructions_per_ms);
    cs0([[0x80138E5C, left, left + columns - 1], [0x80138DF8, top, top + rows - 1], [0x80138DF0]]);
    const update_window = read(read(mode) + 0x64);
    assert.equal(update_window, 0x8013C5A8);
    call(update_window, mode);
    assert.equal(display_register(0x80), plane + 4 * (top * width + left));
    assert.equal(display_register(0xAC), 1 + 4 * (width - columns));
    advance(32 * instructions_per_ms);
    assert.equal(panel.status().pixels_received, width * height + columns * rows);
    updated = true;
    const landscape = check_frame(true), portrait = check_frame(false);
    cpu.write_blob_physical(new Uint8Array(data.byteLength), plane);
    advance(40 * instructions_per_ms);
    assert.equal(check_frame(true), landscape);
    cs1([[0x80140410]]); // display off
    const blank = check_frame(false, true);
    cs1([[0x801403E0]]);
    assert.equal(check_frame(false), portrait);
    cs1([[0x801402B8]]); // enter sleep
    assert.equal(check_frame(false, true), blank);
    cs1([[0x801403D0]]);
    advance(20 * instructions_per_ms);
    assert.equal(check_frame(true), landscape);
    assert.equal(check_frame(false), portrait);
    assert.ok(display_interrupts, "stock display IRQ handler ran after the reset and update");
    assert.equal(lossi.status().dropped, 0);
    console.log(JSON.stringify({ firmware, panel: panel.status(), lossi: lossi.status(),
        reset: { handshake, ready: display_register(0x14), display_interrupts },
        rgba_sha256: { initial, updated: { landscape, portrait }, blank } }, null, 2));
}
finally { await vm.destroy(); }
