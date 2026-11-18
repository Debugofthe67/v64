import assert from "node:assert/strict";
import { mkdtempSync, openSync, closeSync, ftruncateSync, rmSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { sha256_hex } from "../../src/image/sha256.js";
import { V86 } from "../../src/main.js";
import { N97_NAND_IRQ } from "../../src/symbian/n97_devices.js";
import { create_n97_onenand } from "../../src/symbian/n97_onenand.js";
import { N97_FLASH_HEADER, N97_FLASH_IMAGE_SIZE, N97_FLASH_SLOT, n97_flash_header } from "../../src/symbian/n97_flash.js";

const BLOCK = 0x1E200, PAGE = 0x1E20E, SELECT = 0x1E400, CMD = 0x1E440;
const CONFIG = 0x1E442, STATUS = 0x1E480, INTERRUPT = 0x1E482, UNLOCK = 0x1E498, WP = 0x1E49C;
const ECC = 0x1FE00, DATA = 0x400, SPARE = 0x10020;
const digest = "0".repeat(64);

function access(read, write)
{
    const word = at => read(at, 2);
    const store = (at, value) => write(at, 2, value);
    const command = (op, clear = true) => {
        if(clear) store(INTERRUPT, 0);
        store(CMD, op);
        assert.ok(word(INTERRUPT) & 0x8000, "command completion");
        return word(STATUS);
    };
    const select = (block, page = 0, bank = 0x800) => {
        store(BLOCK, block);
        store(PAGE, page);
        store(SELECT, bank);
    };
    return { word, store, command, select };
}

test("OneNAND BufferRAM bank selection, boot commands, bounds and ECC status", () => {
    const header = n97_flash_header(digest);
    const first = new Uint8Array(N97_FLASH_SLOT);
    first.fill(0xEE, 0, 512);
    const next = new Uint8Array(N97_FLASH_SLOT);
    for(let i = 0; i < 4; i++) next.fill(0xFE - i, i * 512, (i + 1) * 512);
    next[N97_FLASH_SLOT - 64] = 0xAE;
    const backend = {
        byteLength: N97_FLASH_IMAGE_SIZE,
        get_from_cache(at) { return [header, first, next][at === 0 ? 0 : (at - N97_FLASH_HEADER) / N97_FLASH_SLOT + 1]; },
        set() { throw new Error("test backend is read only"); },
    };
    let handler;
    const device = create_n97_onenand({ register_mmio(base, size, h) {
        assert.equal(base, 0);
        assert.equal(size, 0x20000);
        handler = h;
    } }, backend, digest);
    const { word, store, command, select } = access(handler.read, handler.write);
    assert.throws(() => create_n97_onenand({}, backend, "1".repeat(64)), /different firmware/);
    assert.equal(word(INTERRUPT), 0x8080);
    assert.equal(word(0), 0x1111);
    assert.equal(word(0x1E000), 0xEC);
    assert.equal(word(0x1E002), 0x40);
    assert.equal(word(0x1E004), 0x121);
    store(0, 0x90);
    assert.deepEqual([0, 2, 4].map(word), [0xEC, 0x40, 2]);
    store(0, 0xF0);
    assert.equal(word(INTERRUPT), 0x8010);
    assert.equal(word(0), 0x1111);
    store(0, 0xE0);
    store(0, 0);
    assert.equal(word(PAGE), 4);
    assert.equal(word(DATA), 0x1111);
    select(0, 4, 0xD00);
    assert.equal(command(0, false), 0);
    assert.deepEqual([0xC00, 0xE00, 0x1000, 0x1200].map(word), [0x0404, 0x0101, 0x0202, 0x0303]);
    assert.equal(word(SPARE + 0x50), 0xFF51);
    assert.equal(word(DATA), 0x1111);
    assert.equal(word(ECC), 0);
    select(0, 5, 0x801);
    assert.equal(command(0), 0);
    assert.equal(word(DATA), 0x0202);
    select(0, 0, 1);
    assert.equal(command(0), 0x6400, "locked BootRAM does not accept a register-based load");
    assert.equal(word(0), 0x1111);
    select(0, 8);
    assert.equal(command(0), 0x2400, "missing physical data reports a load failure");
    assert.equal(word(ECC), 0xAAAA);
    store(CONFIG, word(CONFIG) | 0x100);
    assert.equal(command(0), 0x2400);
    assert.equal(word(ECC), 0);
    select(0x8800);
    assert.equal(command(0), 0x400, "invalid addresses do not alias to the first block");
    assert.equal(command(0x65), 0x400, "unsupported OTP command is not acknowledged as successful");
    store(0x1E000, 0);
    assert.equal(word(0x1E000), 0xEC);
    device.reset();
    assert.equal(word(DATA), 0xFFFF);
    assert.equal(word(CONFIG), 0x40C0);
});

function make_image(filename, rom)
{
    const fd = openSync(filename, "wx");
    try
    {
        ftruncateSync(fd, N97_FLASH_IMAGE_SIZE);
        writeSync(fd, n97_flash_header(sha256_hex(new Uint8Array(rom))), 0, N97_FLASH_HEADER, 0);
    }
    finally { closeSync(fd); }
}

async function start(rom, filename)
{
    const vm = new V86({ machine_type: "nokia-n97", graphics_adapter: "none", autostart: false, disable_jit: true,
        wasm_path: fileURLToPath(new URL("../../build/v86-arm64.wasm", import.meta.url)), log_level: 0,
        symbian: { rom: { buffer: rom }, ...(filename ? { nand: { url: filename, disk_option: "read_write" } } : {}) } });
    await new Promise((resolve, reject) => {
        vm.add_listener("emulator-loaded", resolve);
        vm.add_listener("emulator-error", reject);
    });
    const io = vm.v86.cpu.io;
    const owner = io.ranges.findIndex(range => range?.handler.name === "RM-505 OneNAND CS0");
    return { vm, ...access((at, width) => Number(io.mmio_read(owner, at, width)), (at, width, value) => io.mmio_write(owner, at, width, BigInt(value))) };
}

test("OneNAND INT follows its enable and polarity across GENIO22, ICU IRQ 245, and snapshots", async t => {
    const directory = mkdtempSync(join(tmpdir(), "v86-n97-nand-irq-"));
    const filename = join(directory, "flash.img"), rom = Uint32Array.of(0xEAFFFFFE).buffer;
    make_image(filename, rom);
    const flash = await start(rom, filename);
    t.after(async () => {
        await flash.vm.destroy();
        rmSync(directory, { recursive: true, force: true });
    });
    const cpu = flash.vm.v86.cpu, io = cpu.io;
    const port = (address, value, width = 4) => {
        const owner = io.ranges.findIndex(range => range && address >= range.base && address + width <= range.base + range.size);
        assert.ok(owner > 0);
        const offset = address - io.ranges[owner].base;
        return value === undefined ? Number(io.mmio_read(owner, offset, width)) : io.mmio_write(owner, offset, width, BigInt(value));
    };
    const gpio = (offset, value) => port(0x20031D40 + offset, value);
    const icu = (offset, value) => port(0x20400000 + offset, value);
    const pin = 1 << 22, no_interrupt = 0xFFFFFFFF;
    port(0x20034094, 0x300); // stock DPhysicalDeviceMediaNand::Create
    assert.equal(port(0x20034095, undefined, 1), 3);
    assert.equal(gpio(8) & pin, 0, "IOBE is disabled at reset");
    port(0x20031CE4, pin);
    gpio(0x28, pin);
    gpio(0x34, pin);
    gpio(4, 1);
    gpio(0x10, pin);
    icu(4, 1);
    icu(0x20, N97_NAND_IRQ);
    icu(0x24, 2);
    icu(0x0C, N97_NAND_IRQ);
    flash.store(CONFIG, 0x40E0);
    assert.equal(gpio(8) & pin, pin, "active-high ready is visible with IOBE enabled");
    gpio(0x20, pin);
    flash.store(INTERRUPT, 0);
    assert.equal(gpio(8) & pin, 0);
    assert.equal(icu(8), no_interrupt);
    flash.select(0);
    assert.equal(flash.command(0, false), 0);
    assert.equal(gpio(0x0C), pin);
    const pending = await flash.vm.save_state();
    const legacy = cpu.get_state(true);
    legacy[4].splice(65); // S3.2 serialized 65 slots, ending at the LoSSI controller.

    function acknowledge()
    {
        assert.equal(icu(8), N97_NAND_IRQ);
        gpio(0x20, pin);
        icu(0x80); // return from the RAPIDO IRQ
        assert.equal(icu(8), no_interrupt, "W1C clears the latched edge while INT remains high");
    }
    acknowledge();
    flash.store(CONFIG, 0x40A0);
    assert.equal(gpio(8) & pin, 0, "low-active configuration inverts the ready output");
    flash.store(INTERRUPT, 0);
    assert.equal(gpio(8) & pin, pin);
    acknowledge();
    flash.store(CONFIG, 0x4080);
    assert.equal(gpio(8) & pin, 0);

    await flash.vm.restore_state(pending);
    assert.equal(port(0x20034094), 0x300);
    assert.equal(gpio(8) & pin, pin);
    acknowledge();
    cpu.set_state(legacy);
    assert.equal(gpio(8) & pin, pin, "the legacy snapshot derives the pin from the saved chip registers");
    assert.equal(gpio(0x0C), 0);
    assert.equal(port(0x20034094), 0);
    await flash.vm.restart();
    assert.equal(gpio(8) & pin, 0);
});

test("N97 OneNAND programs 1→0, erases a block and preserves per-VM media across cold reopen and restore", async t => {
    const directory = mkdtempSync(join(tmpdir(), "v86-n97-nand-"));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const file = join(directory, "A.img"), other = join(directory, "B.img");
    const rom = new Uint8Array([0xFE, 0xFF, 0xFF, 0xEA]).buffer;
    make_image(file, rom);
    make_image(other, rom);
    const open = new Set();
    const machine = async filename => {
        const target = await start(rom, filename);
        open.add(target.vm);
        return target;
    };
    const close = async target => { await target.vm.destroy(); open.delete(target.vm); };
    t.after(() => Promise.all([...open].map(vm => vm.destroy())));
    const legacy = await machine();
    const compatible = await legacy.vm.save_state();
    await legacy.vm.restart("power-on");
    await legacy.vm.restore_state(compatible);
    const a = await machine(file);
    await assert.rejects(a.vm.restore_state(compatible), /same Nokia N97 OneNAND configuration/);
    // Stock PDD asserts DFS/DBS in the upper half, even for the single die.
    for(const [address, value] of [[0x03FF, 0x3F3F], [0x8400, 0x4040], [0x87FA, 0x7A7A]])
    {
        a.select(address);
        a.store(0x1E202, address & 0x8000);
        a.store(UNLOCK, address & 0x7FF);
        assert.equal(a.command(0x23), 0);
        assert.equal(a.word(WP), 4);
        assert.equal(a.command(0), 0);
        assert.equal(a.word(DATA), 0xFFFF);
        a.store(DATA, value);
        assert.equal(a.command(0x80), 0);
    }
    for(const [address, value] of [[0x03FF, 0x3F3F], [0x0400, 0x4040], [0x07FA, 0x7A7A]])
    {
        a.select(address);
        assert.equal(a.command(0), 0);
        assert.equal(a.word(DATA), value);
    }
    a.select(0x87FF);
    assert.equal(a.word(WP), 2);
    assert.equal(a.command(0), 0);
    assert.equal(a.word(DATA), 0xFFFF);
    a.store(DATA, 0xF025);
    a.store(SPARE, 0x87CE);
    assert.equal(a.command(0x80), 0x5400);
    a.store(UNLOCK, 0x7FF);
    assert.equal(a.command(0x23), 0);
    assert.equal(a.word(WP), 4);
    assert.equal(a.command(0x80), 0);
    a.store(DATA, 0x25FF);
    a.store(SPARE, 0xFFFF);
    assert.equal(a.command(0x80), 0);
    assert.equal(a.command(0), 0);
    assert.equal(a.word(DATA), 0x2025);
    assert.equal(a.word(SPARE), 0x87CE);
    assert.equal(a.command(0xF0), 0);
    assert.equal(a.word(SELECT), 0x800);
    assert.equal(a.word(DATA), 0x2025);
    assert.equal(a.command(0xF3), 0);
    assert.equal(a.word(SELECT), 0);
    assert.equal(a.word(INTERRUPT), 0x8010);
    assert.equal(a.word(DATA), 0x2025);
    a.select(0x87FF);
    const saved = await a.vm.save_state();
    const b = await machine(other);
    await assert.rejects(b.vm.restore_state(saved), /snapshot.*disk|generation/i);
    b.select(0x7FF);
    assert.equal(b.command(0), 0);
    assert.equal(b.word(DATA), 0xFFFF);
    await close(a);
    const c = await machine(file);
    assert.equal(c.word(WP), 2);
    c.select(0x7FF);
    assert.equal(c.command(0), 0);
    assert.equal(c.word(DATA), 0x2025);
    assert.equal(c.word(SPARE), 0x87CE);
    await c.vm.restore_state(saved);
    assert.equal(c.word(WP), 4);
    assert.equal(c.word(DATA), 0x2025);
    assert.equal(c.command(0x94), 0);
    assert.equal(c.word(INTERRUPT), 0x8020);
    await assert.rejects(c.vm.restore_state(saved), /generation/i);
    await close(c);
    const d = await machine(file);
    d.select(0x7FF);
    assert.equal(d.command(0), 0);
    assert.equal(d.word(DATA), 0xFFFF);
    assert.equal(d.word(SPARE), 0xFFFF);
});

test("OneNAND latches and restores erase addresses, retries a locked final block and verifies individual results", async t => {
    const directory = mkdtempSync(join(tmpdir(), "v86-n97-nand-batch-"));
    const file = join(directory, "flash.img"), rom = Uint32Array.of(0xEAFFFFFE).buffer;
    make_image(file, rom);
    const a = await start(rom, file);
    t.after(async () => {
        await a.vm.destroy();
        rmSync(directory, { recursive: true, force: true });
    });
    const device = a.vm.v86.cpu.devices.n97_onenand;
    const first = 0x3FF, locked = 0x400, last = 0x7FF, untouched = 0x123;
    for(const block of [first, locked, last, untouched])
    {
        a.select(block, 63 << 2);
        a.store(UNLOCK, block);
        assert.equal(a.command(0x23), 0);
        assert.equal(a.command(0), 0);
        a.store(DATA, block === untouched ? 0xFFFF : 0x4567);
        a.store(SPARE, 0x1234);
        assert.equal(a.command(0x80), 0);
    }
    a.store(UNLOCK, locked);
    assert.equal(a.command(0x2A), 0);
    assert.equal(a.command(0x71), 0xC00, "verification checks spare bytes even with erased main data");
    assert.equal(a.word(INTERRUPT), 0x8000);

    a.store(CONFIG, 0x40E0);
    const controller_before_batch_support = device.get_state().slice(0, 11);
    for(const block of [first, locked | 0x8000])
    {
        a.select(block);
        assert.equal(a.command(0x95), 0x8800);
        assert.equal(a.word(INTERRUPT), 0x8020);
        assert.ok(device.interrupt_level());
    }
    assert.equal(a.command(0x94), 0xCC00, "a protected final address keeps the queue");
    assert.equal(a.word(INTERRUPT), 0x8020);
    assert.equal(device.status().erases, 0);
    a.store(INTERRUPT, 0);
    assert.equal(device.interrupt_level(), false);
    const saved = await a.vm.save_state();
    a.select(first, 63 << 2);
    assert.equal(a.command(0), 0, "a new command cancels the address latches");
    assert.equal(a.word(DATA), 0x4567);
    assert.equal(a.word(SPARE), 0x1234);
    assert.equal(device.status().erases, 0);

    await a.vm.restore_state(saved);
    assert.equal(a.word(STATUS), 0xCC00);
    assert.equal(a.word(INTERRUPT), 0);
    assert.equal(device.interrupt_level(), false);
    device.set_state(controller_before_batch_support);
    assert.equal(device.get_state()[11].length, 0, "an older controller snapshot has no saved latches");
    await a.vm.restore_state(saved);
    assert.equal(a.command(0xF0), 0, "hot reset cancels a pending batch");
    assert.equal(device.get_state()[11].length, 0);
    assert.equal(device.status().erases, 0);

    await a.vm.restore_state(saved);
    a.select(last | 0x8000);
    assert.equal(a.command(0x94), 0x4C00, "both unlocked targets erase despite another queued block failing");
    assert.equal(a.word(INTERRUPT), 0x8020);
    assert.equal(device.status().erases, 2);
    for(const [block, expected] of [[first, 0], [last, 0], [locked, 0xC00], [untouched, 0xC00]])
    {
        a.select(block, 63 << 2);
        assert.equal(a.command(0x71), expected);
        assert.equal(a.word(INTERRUPT), 0x8000);
        assert.equal(a.command(0), 0);
        assert.equal(a.word(DATA), block === locked ? 0x4567 : 0xFFFF);
        assert.equal(a.word(SPARE), expected ? 0x1234 : 0xFFFF);
    }
    await assert.rejects(a.vm.restore_state(saved), /generation/i);
    await a.vm.restart("power-on");
    for(const [block, expected] of [[first, 0], [last, 0], [locked, 0xC00], [untouched, 0xC00]])
    {
        a.select(block);
        assert.equal(a.command(0x71), expected, "erase results survive a cold reset");
    }
});

test("OneNAND bounds an erase batch and reports individual backing-store failures", () => {
    const block_size = 64 * N97_FLASH_SLOT;
    const failed = 19;
    const changed = [];
    const backend = {
        byteLength: N97_FLASH_IMAGE_SIZE,
        get_from_cache(offset, length) {
            return offset === 0 ? n97_flash_header(digest) : new Uint8Array(length);
        },
        set(offset, bytes, done) {
            assert.equal(bytes.length, block_size);
            const block = (offset - N97_FLASH_HEADER) / block_size;
            if(block === failed) done(new Error("test media erase failed"));
            else { changed.push(block); done(); }
        },
        get_state: () => [],
        set_state() {},
    };
    let handler;
    const device = create_n97_onenand({ register_mmio(base, size, h) { handler = h; } }, backend, digest);
    const a = access(handler.read, handler.write);
    assert.equal(a.command(0x27), 0);
    a.select(0x8800);
    assert.equal(a.command(0x95), 0xC00);
    assert.equal(device.get_state()[11].length, 0);
    for(let block = 0; block < 63; block++)
    {
        a.select(block);
        assert.equal(a.command(0x95), 0x8800);
    }
    a.select(64);
    assert.equal(a.command(0x95), 0x8C00);
    assert.deepEqual(changed, []);
    a.select(63);
    assert.equal(a.command(0x94), 0xC00);
    assert.deepEqual(changed, Array.from({ length: 64 }, (_, n) => n).filter(n => n !== failed));
    assert.equal(device.status().erases, 63);
    a.select(failed);
    assert.equal(a.command(0x71), 0xC00, "a failed erase cannot verify using pre-existing erased bytes");
    const saved = device.get_state();
    device.reset();
    assert.equal(a.command(0x71), 0);
    device.set_state(saved);
    assert.equal(a.command(0x71), 0xC00, "the last batch failure is preserved in controller snapshots");
});
