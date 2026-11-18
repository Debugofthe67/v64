import assert from "node:assert/strict";
import { closeSync, fstatSync, ftruncateSync, mkdtempSync, openSync, readSync, rmSync, statSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { V86 } from "../../src/main.js";
import { create_n97_mmc_card } from "../../src/symbian/n97_mmc_card.js";
import { N97_MMC_BASE } from "../../src/symbian/n97_mmc.js";
import { format_n97_emmc, N97_EMMC_INITIAL_BYTES } from "../../src/symbian/n97_emmc_format.js";
import { N97_EMMC_CHUNK, N97_EMMC_SIZE, n97_sd_capacity, open_n97_emmc } from "../../src/symbian/n97_mmc_media.js";

function local_file(path, read_write, run)
{
    const fd = openSync(path, read_write ? "wx+" : "r");
    try
    {
        return run({
            getSize: () => fstatSync(fd).size,
            truncate: length => ftruncateSync(fd, length),
            read: (part, { at }) => readSync(fd, part, 0, part.length, at),
            write: (part, { at }) => writeSync(fd, part, 0, part.length, at),
        });
    }
    finally { closeSync(fd); }
}

test("N97 eMMC stores a complete FAT32 seed and grows only for touched 64 KiB chunks", t => {
    const dir = mkdtempSync(join(tmpdir(), "v86-n97-emmc-"));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const file = join(dir, "emmc");
    local_file(file, true, access => {
        const disk = open_n97_emmc(access, true);
        format_n97_emmc(disk, 0x11223344);
        assert.equal(disk.size, N97_EMMC_SIZE);
        assert.equal(access.getSize(), N97_EMMC_INITIAL_BYTES);
        const u16 = (data, at) => new DataView(data.buffer, data.byteOffset).getUint16(at, true);
        const u32 = (data, at) => new DataView(data.buffer, data.byteOffset).getUint32(at, true);
        const mbr = disk.read(0, 512);
        assert.equal(u16(mbr, 510), 0xAA55);
        assert.equal(mbr[450], 0x0C);
        const start = u32(mbr, 454), size = u32(mbr, 458);
        assert.equal((start + size) * 512, N97_EMMC_SIZE);
        const boot = disk.read(start * 512, 512), info = disk.read((start + 1) * 512, 512);
        assert.equal(u32(boot, 28), start);
        assert.equal(u32(boot, 32), size);
        assert.equal(u32(boot, 67), 0x11223344);
        assert.equal(u32(boot, 44), 2);
        assert.equal(boot[16], 2);
        assert.equal(u32(info, 0), 0x41615252);
        assert.equal(u32(info, 484), 0x61417272);
        assert.deepEqual(disk.read((start + 6) * 512, 512), boot);
        assert.deepEqual(disk.read((start + 7) * 512, 512), info);
        const first = start + u16(boot, 14), second = first + u32(boot, 36);
        const a = disk.read(first * 512, 512), b = disk.read(second * 512, 512);
        assert.deepEqual(a, b);
        assert.equal(u32(a, 8), 0x0FFFFFFF);
        assert.equal(disk.read((second + u32(boot, 36)) * 512, 512).some(byte => byte), false);
        disk.write(N97_EMMC_SIZE - 512, new Uint8Array(512).fill(0xB0));
        assert.equal(access.getSize(), N97_EMMC_INITIAL_BYTES + N97_EMMC_CHUNK);
        assert.throws(() => disk.write(N97_EMMC_SIZE, new Uint8Array(512)), /Outside/);
    });
    local_file(file, false, access => {
        const disk = open_n97_emmc(access);
        assert.deepEqual(disk.read(N97_EMMC_SIZE - 512, 512), new Uint8Array(512).fill(0xB0));
        assert.deepEqual(disk.read(0x400000000, 512), new Uint8Array(512));
    });
});

test("SD protocol distinguishes SDSC byte addresses and SDHC sector addresses", () => {
    for(const [size, high] of [[16 * 1024 ** 2, false], [4 * 1024 ** 3, true]])
    {
        const card = create_n97_mmc_card({ byteLength: size, get_from_cache() {}, set() {} }, false);
        assert.equal(n97_sd_capacity(size).high_capacity, high);
        assert.equal(card.send(1, 0, 1), null);
        assert.equal(card.send(8, 0x1AA, 1).response, 0x1AA);
        assert.equal(card.send(41, 0x40FF8000, 1), null);
        assert.equal(card.send(55, 0, 1).response, 32);
        assert.equal(card.send(41, 0x40FF8000, 1).response, high ? 0xC0FF8000 : 0x80FF8000);
        assert.equal(card.send(2, 0, 1).response.length, 16);
        card.send(3, 0, 1);
        assert.equal(card.send(9, 0x10000, 1).response[0] >>> 6, high ? 1 : 0);
        card.send(7, 0x10000, 1);
        const result = card.send(17, high ? 123 : 123 * 512, 1);
        assert.deepEqual(result.transfer, { sector: 123, write: false, count: 1 });
        if(!high) assert.equal(card.send(17, 513, 1).error, true);
        assert.equal(card.send(17, high ? size / 512 : size, 1).error, true);
    }
});

async function machine(file, sd)
{
    const rom = new Uint8Array([0xFE, 0xFF, 0xFF, 0xEA]).buffer;
    const media = url => ({ url, disk_option: "read_write" });
    const vm = new V86({ machine_type: "nokia-n97", graphics_adapter: "none", autostart: false, disable_jit: true, log_level: 0,
        wasm_path: fileURLToPath(new URL("../../build/v86-arm64.wasm", import.meta.url)), symbian: {
            rom: { buffer: rom }, ...(file ? { emmc: media(file) } : {}), ...(sd ? { sd: media(sd) } : {}),
        } });
    await new Promise((resolve, reject) => {
        vm.add_listener("emulator-loaded", resolve);
        vm.add_listener("emulator-error", reject);
    });
    const io = vm.v86.cpu.io;
    function range(address)
    {
        const id = io.ranges.findIndex(range => range && address >= range.base && address < range.base + range.size);
        assert.ok(id > 0, address.toString(16));
        return [id, address - io.ranges[id].base];
    }
    function io_set(address, value, width = 2) { io.mmio_write(...range(address), width, BigInt(value)); }
    function io_get(address, width = 2) { return Number(io.mmio_read(...range(address), width)); }
    const set = (offset, value) => io_set(N97_MMC_BASE + offset, value);
    const get = offset => io_get(N97_MMC_BASE + offset);
    const clock = on => io_set(on ? 0x20031C94 : 0x20031C98, 0x4000, 4);
    const select = external => io_set(external ? 0x20031CC4 : 0x20031CC8, 0x1000, 4);
    function cmd(word, argument = 0)
    {
        set(0x10, 0xFFFF);
        set(4, argument & 0xFFFF);
        set(8, argument >>> 16);
        set(0, word);
        return { status: get(0x10), response: get(0x5C) * 65536 + get(0x58) };
    }
    const blocks = (bytes = 512, count = 1) => { set(0x24, bytes - 1); set(0x28, count - 1); };
    function fifo()
    {
        const page = new Uint8Array(512), view = new DataView(page.buffer);
        for(let at = 0; at < 512; at += 2) view.setUint16(at, get(0x20), true);
        return page;
    }
    function ready()
    {
        clock(true);
        set(0xC, 0x801);
        cmd(0);
        assert.equal(cmd(0x1301, 0x40FF8080).response, 0xC0FF8080);
        cmd(0x1202);
        cmd(0x2103, 0x10000);
        assert.equal(cmd(0x2907, 0x10000).response, 0x900);
        blocks();
    }
    return { vm, clock, select, set, get, io_get, io_set, cmd, blocks, fifo, ready };
}

test("RAPIDO host MMC IRQ, card mux, cold reopen and snapshot generation", async t => {
    const dir = mkdtempSync(join(tmpdir(), "v86-n97-mmc-vm-"));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const file = join(dir, "A.img"), other = join(dir, "B.img"), sd = join(dir, "SD.img");
    for(const path of [file, other]) local_file(path, true, access => format_n97_emmc(open_n97_emmc(access, true), 1));
    local_file(sd, true, access => access.truncate(16 * 1024 ** 2));
    const open = new Set();
    const start = async (...args) => {
        const result = await machine(...args);
        open.add(result.vm);
        return result;
    };
    const close = async target => { await target.vm.destroy(); open.delete(target.vm); };
    t.after(() => Promise.all([...open].map(target => target.destroy())));
    const legacy = await start(), previous = await legacy.vm.save_state();
    await legacy.vm.restore_state(previous);
    await close(legacy);
    const a = await start(file, sd);
    await assert.rejects(a.vm.restore_state(previous), /same Nokia N97 MMC/);
    assert.equal(a.cmd(0x1301, 0x40FF8080).status, 0, "gated clock suppresses commands");
    a.ready();
    a.io_set(0x20400020, 159, 4);
    a.io_set(0x20400024, 2, 4);
    a.io_set(0x2040000C, 159, 4);
    a.io_set(0x20400004, 1, 4);
    a.set(0x14, 1);
    assert.equal(a.cmd(0x210D, 0x10000).response, 0x900);
    assert.equal(a.io_get(0x20400008, 4), 159);
    a.set(0x10, 1);
    a.io_get(0x20400080, 4);
    assert.equal(a.io_get(0x20400008, 4), 0xFFFFFFFF);
    assert.equal(a.cmd(0xB108).response, 0x900);
    assert.equal(new DataView(a.fifo().buffer).getUint32(212, true), N97_EMMC_SIZE / 512);

    a.select(true);
    assert.equal(a.io_get(0x20031CC0, 4), 0x1000);
    assert.equal(a.io_get(0x20031D88, 4) & 0x2000, 0, "inserted microSD pulls GENIO45 low");
    a.cmd(0);
    assert.equal(a.cmd(0x1608, 0x1AA).response, 0x1AA);
    a.cmd(0x1137);
    a.cmd(0x1329, 0x40FF8000);
    a.cmd(0x1202);
    a.cmd(0x1603);
    a.cmd(0x2907, 0x10000);
    a.cmd(0x3118, 512);
    for(let i = 0; i < 256; i++) a.set(0x20, i === 0 ? 0x2575 : 0);
    a.select(false);
    assert.equal(a.io_get(0x20031CC0, 4), 0);
    assert.equal(a.cmd(0x210D, 0x10000).response, 0x900, "eMMC keeps its selected RCA when SD is used");
    const end = N97_EMMC_SIZE / 512 - 1;
    a.blocks(512, 2);
    assert.equal(a.cmd(0x3119, end - 1).response, 0x900);
    a.set(0x20, 0x1357);
    assert.equal(a.cmd(0x210D, 0x10000).response, 0xC00, "CMD13 reports RCV without dropping a partial sector");
    for(let i = 1; i < 256; i++) a.set(0x20, 0);
    assert.equal(a.cmd(0x210D, 0x10000).response, 0xC00, "CMD13 between blocks preserves the second sector");
    a.set(0x20, 0x2468);
    for(let i = 1; i < 256; i++) a.set(0x20, 0);
    assert.equal(a.cmd(0x210D, 0x10000).response, 0x900);
    a.set(0x2C, 31 << 8);
    assert.equal(a.cmd(0xB112, end - 1).status & 0x400, 0x400, "32-word FIFO meets the high-water mark");
    assert.equal(a.get(0x20), 0x1357);
    for(let i = 1; i < 225; i++) a.get(0x20);
    assert.equal(a.get(0x10) & 0x400, 0, "31 final words fall below the high-water mark");
    assert.equal(a.cmd(0x210D, 0x10000).response, 0xA00, "CMD13 reports DATA during a partial multi-block read");
    for(let i = 225; i < 256; i++) a.get(0x20);
    assert.equal(a.get(0x20), 0x2468);
    for(let i = 1; i < 256; i++) a.get(0x20);
    assert.equal(a.cmd(0x210D, 0x10000).response, 0x900);
    a.blocks();
    assert.equal(a.cmd(0x3118, end).response, 0x900);
    a.set(0x20, 0xAEFA);
    assert.equal(a.cmd(0x210D, 0x10000).response, 0xC00);
    for(let i = 1; i < 256; i++) a.set(0x20, 0);
    a.cmd(0xB111, end);
    assert.equal(a.get(0x20), 0xAEFA);
    assert.equal(a.cmd(0x210D, 0x10000).response, 0xA00);
    const saved = await a.vm.save_state();
    assert.equal(statSync(file).size, N97_EMMC_INITIAL_BYTES + N97_EMMC_CHUNK);
    assert.equal(statSync(other).size, N97_EMMC_INITIAL_BYTES);
    const b = await start(other);
    await assert.rejects(b.vm.restore_state(saved), /snapshot.*disk|configuration/i);
    b.ready();
    b.select(true);
    assert.equal(b.io_get(0x20031D88, 4) & 0x2000, 0x2000, "empty slot leaves GENIO45 high");
    assert.equal(b.cmd(0x1608, 0x1AA).status, 128, "empty slot reports a command timeout");
    b.select(false);
    b.cmd(0xB111, end);
    assert.equal(b.get(0x20), 0);
    await close(a);
    const c = await start(file, sd);
    c.ready();
    c.cmd(0xB111, end);
    assert.equal(c.get(0x20), 0xAEFA);
    assert.equal(c.get(0x20), 0);
    await c.vm.restore_state(saved);
    assert.equal(c.get(0x20), 0, "resume the in-flight read at the saved FIFO position");
    assert.equal(c.cmd(0x290C).response, 0x900, "explicit stop returns to TRANSFER state");
    c.cmd(0x3118, end);
    for(let i = 0; i < 256; i++) c.set(0x20, 0);
    assert.equal(c.cmd(0x210D, 0x10000).response, 0x900, "completed transfer returns to TRANSFER state");
    await assert.rejects(c.vm.restore_state(saved), /generation/);
    local_file(sd, false, access => {
        const bytes = new Uint8Array(2);
        access.read(bytes, { at: 512 });
        assert.deepEqual(bytes, new Uint8Array([0x75, 0x25]));
    });
});

test("live microSD signals GENIO45 and waits for an in-progress RAM restore", async t => {
    const dir = mkdtempSync(join(tmpdir(), "v86-n97-sd-live-"));
    const sd = join(dir, "SD.img"), other = join(dir, "other.img"), size = 16 * 1024 ** 2;
    const opened = [];
    t.after(async () => {
        for(const vm of opened) await vm.destroy();
        rmSync(dir, { recursive: true, force: true });
    });
    for(const path of [sd, other]) local_file(path, true, access => access.truncate(size));
    const a = await machine();
    opened.push(a.vm);
    const insert = (path = sd, bytes = size) => a.vm.symbian_insert_sd({ url: path, size: bytes });
    const gpio = 0x20031D80, pin = 0x2000, icu = 0x20400000;
    const sd_status = async () => (await a.vm.get_diagnostics()).symbian.mmc.sd_bytes;
    const setup_irq = () => {
        for(const [offset, value] of [[0x04, 1], [0x28, pin], [0x38, pin], [0x20, pin], [0x10, pin]])
            a.io_set(gpio + offset, value, 4);
        for(const [offset, value] of [[0x20, 234], [0x24, 2], [0x0C, 234], [0x04, 1]])
            a.io_set(icu + offset, value, 4);
    };
    setup_irq();
    await assert.rejects(insert(sd, size + 512), /descriptor/);
    assert.equal(await sd_status(), null);
    assert.equal(a.io_get(gpio + 8, 4) & pin, pin);
    assert.equal(a.io_get(icu + 8, 4), 0xFFFFFFFF, "a rejected image does not signal insertion");

    const marker_address = 0x08070000, marker = Uint8Array.of(43, 111, 23, 243);
    a.vm.write_memory(marker, marker_address);
    const parts = [];
    await a.vm.save_state_stream(bytes => { parts.push(Buffer.from(bytes)); });
    const snapshot = Buffer.concat(parts);
    a.vm.write_memory(new Uint8Array(4), marker_address);
    const read_ram = new Set();
    let pause_restore, continue_restore;
    const reached = new Promise(resolve => { pause_restore = resolve; });
    const gate = new Promise(resolve => { continue_restore = resolve; });
    const restored = a.vm.restore_state_stream({ size: snapshot.length, read: async (offset, length) => {
        const bytes = snapshot.subarray(offset, offset + length);
        if(length > 20 && bytes.readUInt32LE(0) === 2)
        {
            if(read_ram.has(offset)) { pause_restore(); await gate; }
            read_ram.add(offset);
        }
        return bytes;
    } });
    await reached;
    const inserted = insert();
    try
    {
        // Wait until the backend is open, so this observes the final commit
        // gate rather than racing an asynchronous filesystem open.
        for(let n = 0; n < 500 && !a.vm.disk_descriptors.some(([name]) => name === "symbian_sd"); n++)
            await new Promise(resolve => setTimeout(resolve, 2));
        assert.ok(a.vm.disk_descriptors.some(([name]) => name === "symbian_sd"));
        assert.equal(await sd_status(), null, "a validated, staged image is invisible during the second RAM pass");
    }
    finally { continue_restore(); await Promise.all([restored, inserted]); }
    assert.deepEqual(a.vm.read_memory(marker_address, marker.length), marker);
    assert.equal(await sd_status(), size);
    assert.equal(a.io_get(gpio + 8, 4) & pin, 0);
    assert.equal(a.io_get(icu + 8, 4), 234);
    assert.equal(a.io_get(gpio + 0x0C, 4) & pin, pin);
    a.io_set(gpio + 0x20, pin, 4);
    a.io_get(icu + 0x80, 4);
    assert.equal(a.io_get(icu + 8, 4), 0xFFFFFFFF, "the insertion edge is acknowledged");
    await assert.rejects(insert(other), /occupied/);

    const rival = await machine();
    opened.push(rival.vm);
    await assert.rejects(rival.vm.symbian_insert_sd({ url: sd, size }), /one writer/);
    a.clock(true);
    a.select(true);
    a.set(0xC, 0x801);
    for(const [command, argument] of [[0], [0x1608, 0x1AA], [0x1137], [0x1329, 0x40FF8000],
        [0x1202], [0x1603], [0x2907, 0x10000]]) assert.equal(a.cmd(command, argument).status & 0x40A0, 0);
    a.blocks();
    assert.equal(a.cmd(0x3118, 512).response, 0x900);
    for(let n = 0; n < 256; n++) a.set(0x20, n ^ 0xD358);
    const a_state = await a.vm.save_state();
    await a.vm.destroy();
    opened.splice(opened.indexOf(a.vm), 1);
    const b = await machine(null, other);
    opened.push(b.vm);
    await assert.rejects(b.vm.restore_state(a_state), /snapshot's disk symbian_sd/i);
    const c = await machine(null, sd);
    opened.push(c.vm);
    await c.vm.restore_state(a_state);
    assert.equal(c.io_get(gpio + 8, 4) & pin, 0, "the original card remains present on cold reopen and resume");
    assert.equal(c.cmd(0xB111, 512).response, 0x900);
    for(let n = 0; n < 256; n++) assert.equal(c.get(0x20), n ^ 0xD358, "guest-written sectors persist after live insertion");
});

test("RAPIDO DMA consumes actual MMC handshakes, retains partial writes on restore and acknowledges ICU vectors", async t => {
    const dir = mkdtempSync(join(tmpdir(), "v86-n97-mmc-dma-"));
    const file = join(dir, "emmc"), sd = join(dir, "sd");
    local_file(file, true, access => format_n97_emmc(open_n97_emmc(access, true), 1));
    local_file(sd, true, access => access.truncate(16 * 1024 ** 2));
    const target = await machine(file, sd);
    t.after(async () => {
        await target.vm.destroy();
        rmSync(dir, { recursive: true, force: true });
    });
    const { vm, set, get, io_set, io_get, cmd, ready, select } = target;
    const cpu = vm.v86.cpu, dma = cpu.devices.n97_dma, icu = 0x20400000;
    const data = N97_MMC_BASE + 0x20, buffer = 0x08200000, channel = 0x20041000;
    const write = (address, value) => io_set(address, value, 4);
    const read = address => io_get(address, 4);
    const regs = (base, values) => values.forEach(([offset, value]) => write(base + offset, value));
    const status = () => dma.status();
    function arm(irq)
    {
        regs(icu, [[0x04, 1], [0x20, irq], [0x24, 2], [0x0C, irq]]);
    }
    function interrupt(irq)
    {
        assert.equal(read(icu + 8), irq);
        read(icu + 0x80);
        assert.equal(read(icu + 8), 0xFFFFFFFF, "one pending event per completed DMA transfer");
    }
    function physical(write_to_card, address = buffer)
    {
        write(channel + 4, 1);
        write(channel + 8, 0);
        const memory = [address, 4, 32], peripheral = [data, 0, 16];
        [0x14, 0x20].forEach((offset, index) => {
            const endpoint = index === +write_to_card ? peripheral : memory;
            regs(channel + offset, endpoint.map((word, part) => [part * 4, word]));
        });
        write(0x2004080C, write_to_card ? 16 : 15);
        regs(channel, [[0x10, 0], [0x2C, 255], [0x34, 1], [8, 2]]);
    }
    function logical(write_to_card)
    {
        write(0x20042640, 1);
        regs(0x20042400, [[0x80, 256], [0x140, 2], [0x1C0, data], [0x200, buffer], [0x280, 512 * 4], [0x300, 1]]);
        write(0x20040820, write_to_card ? 16 : 15);
        write(0x20042440, write_to_card ? 1 : 2);
        if(write_to_card) write(0x2004242C, 1);
    }
    function complete()
    {
        for(let n = 0; n < 16; n++) dma.poll();
    }

    assert.equal(read(channel), 0);
    write(channel, 2);
    assert.equal(read(channel), 0, "reset is gated");
    regs(channel, [[4, 1], [0, 2], [4, 0]]);
    assert.equal(read(channel), 0x6E);
    assert.equal(status().physical_resets, 1);
    assert.equal(read(channel + 8), 0);

    ready(); // eMMC starts with a real FAT32 MBR at LBA 0.
    arm(1);
    physical(false);
    dma.poll();
    assert.equal(status().bytes, 0, "arming cannot initiate media I/O");
    assert.equal(read(channel + 8), 2);
    assert.equal(cmd(0xB111).status & 0x80, 0);
    dma.poll();
    assert.equal(read(channel + 0x2C), 255, "PIO mode requests no DMA");
    set(0x2C, 0x8F00);
    dma.poll();
    assert.equal(read(channel + 0x2C), 223);
    const snapshot = await vm.save_state();
    complete();
    assert.equal(read(channel + 0x2C), 0xFFFFFF);
    assert.equal(cpu.read16_physical(buffer + 510), 0xAA55);
    interrupt(1);
    await vm.restore_state(snapshot);
    assert.equal(read(channel + 0x2C), 223);
    complete();
    assert.equal(status().completed, 1);
    assert.equal(status().bytes, 512);
    assert.equal(cpu.read16_physical(buffer + 510), 0xAA55);
    interrupt(1);
    write(channel + 4, 0);

    arm(6);
    logical(false);
    cmd(0xB111, 2048);
    complete();
    assert.equal(read(0x200426C0), 256);
    assert.equal(Buffer.from(cpu.read_blob_physical(buffer + 82, 8)).toString(), "FAT32   ");
    interrupt(6);
    regs(0x20042400, [[0x1C, buffer + 510], [0x20, 2], [0x18, 4]]);
    assert.equal(read(0x20042418), 0, "the real logical RX completion barrier is coherent");
    regs(0x20042400, [[0x1C, data], [0x18, 4]]);
    assert.equal(read(0x20042418), 4, "the RAM barrier does not acknowledge peripheral addresses");

    select(true);
    cmd(0);
    cmd(0x1608, 0x1AA);
    cmd(0x1137);
    cmd(0x1329, 0x40FF8000);
    cmd(0x1202);
    cmd(0x1603);
    cmd(0x2907, 0x10000);
    const payload = Uint8Array.from({ length: 512 }, (_, i) => i ^ (i >>> 4));
    cpu.write_blob_physical(payload, buffer);
    set(0x2C, 0x008F);
    assert.equal(cmd(0x3118, 512).status, 1);
    physical(true);
    dma.poll();
    const partial_write = await vm.save_state();
    set(0x2C, 0);
    dma.poll();
    assert.equal(read(channel + 0x2C), 223, "disabled DMA requests preserve transferred positions");
    await vm.restore_state(partial_write);
    complete();
    assert.equal(get(0x10) & 0x18, 0x18);
    interrupt(1);
    const disk = openSync(sd, "r");
    try
    {
        const written = new Uint8Array(512);
        assert.equal(readSync(disk, written, 0, 512, 512), 512);
        assert.deepEqual(written, payload);
    }
    finally { closeSync(disk); }

    set(0x2C, 0x8F00);
    cmd(0xB111, 512);
    physical(false, data);
    complete();
    assert.equal(status().errors, 1, "invalid RAM terminates the channel");
    assert.equal(read(icu + 8), 0xFFFFFFFF);
    physical(false);
    const untouched = cpu.read_blob_physical(buffer, 512);
    cmd(0x290C);
    cmd(0xB111, 0);
    dma.poll();
    assert.equal(status().errors, 2, "cancelling before the first DMA beat does not redirect the request");
    assert.deepEqual(cpu.read_blob_physical(buffer, 512), untouched);
    assert.equal(read(icu + 8), 0xFFFFFFFF);
    cmd(0x290C);

    set(0x2C, 0x008F);
    cmd(0x3118, 512);
    logical(true);
    cmd(0x290C);
    cmd(0x3118, 1024);
    complete();
    assert.equal(status().errors, 3, "cancelled logical TX cannot write to another sector");
    assert.equal(get(0x10) & 0x18, 0);
    assert.equal(read(icu + 8), 0xFFFFFFFF);
    const after_retry = openSync(sd, "r");
    try
    {
        const untouched_sector = new Uint8Array(512);
        assert.equal(readSync(after_retry, untouched_sector, 0, 512, 1024), 512);
        assert.deepEqual(untouched_sector, new Uint8Array(512));
    }
    finally { closeSync(after_retry); }

    cmd(0x290C);
    arm(6);
    cmd(0xB111, 512);
    logical(true);
    dma.poll();
    assert.equal(read(0x20042440), 1, "TX waits while the active command is in the other direction");
    for(let word = 0; word < 256; word++)
        assert.equal(get(0x20), payload[word * 2] | payload[word * 2 + 1] << 8);
    assert.equal(cmd(0x3118, 1024).status, 1);
    complete();
    assert.equal(get(0x10) & 0x18, 0x18);
    interrupt(6);
    assert.equal(status().errors, 3, "a previous RX does not expire a queued TX");

    set(0x2C, 0x8F00);
    logical(false);
    write(0x20042500, 1);
    cmd(0xB111, 512);
    dma.poll();
    assert.equal(read(0x200426C0), 0, "paused DMA consumes no beats");
    cmd(0x290C);
    cmd(0xB111, 0);
    dma.poll();
    assert.equal(read(0x20042440), 0, "a paused channel expires when its command is cancelled");
    assert.equal(status().errors, 4);
    assert.deepEqual(cpu.read_blob_physical(buffer, 512), untouched);
    assert.equal(read(icu + 8), 0xFFFFFFFF);
    cmd(0x290C);

    physical(false);
    cmd(0xB111, 512);
    cmd(0x290C);
    cmd(0xB111, 0);
    complete();
    assert.equal(status().errors, 5, "arming before a command still reserves only that command's generation");
    assert.deepEqual(cpu.read_blob_physical(buffer, 512), untouched);
    assert.equal(read(icu + 8), 0xFFFFFFFF);
});
