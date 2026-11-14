#!/usr/bin/env node
// ATA task-file progress and DRQ block boundaries. Reads encode their LBA;
// no host image or guest code runs. QEMU9.2: ide_set_sector/ide_sector_read.
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
const { V86 } = await import(+process.env.TEST_RELEASE_BUILD ? "../../build/libv86.mjs" : "../../src/main.js");
const groups = new Set((process.env.IDE_PROGRESS_CASES || "selected,carries,multiple,write").split(","));
assert(groups.size && [...groups].every(group => ["selected", "carries", "multiple", "write"].includes(group)));
const writes = [];
const disk = {
    byteLength: 8 * 2 ** 40,
    load() { this.onload?.({}); },
    get(start, length, done)
    {
        const bytes = new Uint8Array(length), view = new DataView(bytes.buffer);
        for(let at = 0; at < length; at += 512) view.setBigUint64(at, BigInt(start + at), true);
        done(bytes);
    },
    get_and_cache(start, length, done) { this.get(start, length, done); },
    get_from_cache() {},
    set(start, data, done) { writes.push({ start, data: data.slice() }); done(); },
    get_buffer(done) { done(); },
};
const vm = new V86({
    graphics_adapter: "none", bios: { url: fileURLToPath(new URL("../../bios/seabios.bin", import.meta.url)) },
    hda: disk, memory_size: 32 << 20, autostart: false, log_level: 0,
});
await new Promise(resolve => vm.add_listener("emulator-loaded", resolve));
const cpu = vm.v86.cpu, io = cpu.io, drive = cpu.devices.ide.primary.master;
const w = (port, value) => io.port_write8(port, value), r = port => io.port_read8(port);
w(0x3F6, 2);
function command(lba, count, cmd, extended = false, select = true)
{
    if(extended)
        for(const [port, shift] of [[0x1F2, 8], [0x1F3, 24], [0x1F4, 32], [0x1F5, 40]])
            w(port, Math.floor((port === 0x1F2 ? count : lba) / 2 ** shift) & 255);
    w(0x1F2, count & 255);
    for(let i = 0; i < 3; i++) w(0x1F3 + i, Math.floor(lba / 2 ** (8 * i)) & 255);
    if(select) w(0x1F6, 0xE0 | (extended ? 0 : Math.floor(lba / 2 ** 24) & 15));
    w(0x1F7, cmd);
}
function address(extended = false)
{
    const low = [r(0x1F3), r(0x1F4), r(0x1F5)];
    if(!extended) return low[0] + low[1] * 256 + low[2] * 65536 + (r(0x1F6) & 15) * 2 ** 24;
    w(0x3F6, 0x82);
    const high = [r(0x1F3), r(0x1F4), r(0x1F5)];
    w(0x3F6, 2);
    return [...low, ...high].reduce((sum, value, i) => sum + value * 2 ** (8 * i), 0);
}
function sector(expected)
{
    const bytes = new Uint8Array(512), view = new DataView(bytes.buffer);
    for(let i = 0; i < 256; i++) view.setUint16(i * 2, io.port_read16(0x1F0), true);
    assert.equal(view.getBigUint64(0, true), BigInt(expected * 512), "payload LBA");
}
try
{
    if(groups.has("selected"))
    {
        // A driver may keep the selected head unchanged between commands.
        command(0x12340, 1, 0x20); sector(0x12340);
        command(0x12350, 1, 0x20, false, false); sector(0x12350);
    }
    if(groups.has("carries"))
    {
        for(const [lba, extended] of [[0xFFFFFE, false], [0xFFFFFFFE, true], [0x1FFFFFFFF, true]])
        {
            command(lba, 3, extended ? 0x24 : 0x20, extended);
            for(let i = 0; i < 3; i++)
            {
                assert.equal(address(extended), lba + i + 1, "task-file address includes carries");
                assert.equal(r(0x1F2), 2 - i); sector(lba + i);
            }
        }
        command(0x8000, 0, 0x20);
        for(let i = 0; i < 256; i++)
        {
            assert.equal(r(0x1F2), (255 - i) & 255, "zero count encodes256 sectors");
            sector(0x8000 + i);
        }
        const heads = drive.head_count, track = drive.sectors_per_track;
        assert(heads <= 16);
        w(0x1F6, 0xA0 | heads - 1); w(0x1F2, 3);
        w(0x1F3, track); w(0x1F4, 1); w(0x1F5, 0); w(0x1F7, 0x20);
        const start = (2 * heads - 1) * track + track - 1;
        for(let i = 0; i < 3; i++)
        {
            const next = start + i + 1;
            assert.equal(r(0x1F3), next % track + 1, "CHS sector wraps");
            assert.equal(r(0x1F6) & 15, Math.floor(next / track) % heads, "CHS head readback");
            assert.equal(r(0x1F4) + r(0x1F5) * 256, Math.floor(next / track / heads), "CHS cylinder");
            sector(start + i);
        }
    }
    // Four-sector DRQ blocks, final partial block of two sectors.
    w(0x1F2, 4); w(0x1F7, 0xC6);
    if(groups.has("multiple"))
        for(const [cmd, extended] of [[0xC4, false], [0x29, true]])
        {
            const lba = extended ? 0x100000020 : 0x34560;
            command(lba, 10, cmd, extended);
            assert.equal(address(extended), lba + 4, "first multiple block");
            assert.equal(r(0x1F2), 6);
            for(let i = 0; i < 10; i++)
            {
                sector(lba + i);
                const next = Math.min(10, (Math.floor((i + 1) / 4) + 1) * 4);
                assert.equal(address(extended), lba + next, "next DRQ block progress");
                assert.equal(r(0x1F2), 10 - next);
            }
        }
    if(groups.has("write"))
        for(const [cmd, extended] of [[0x30, false], [0x34, true], [0xC5, false], [0x39, true]])
        {
            const lba = extended ? 0x10020000 : 0x20000, blocks = [];
            const prototype = Object.getPrototypeOf(drive), push = prototype.push_irq;
            prototype.push_irq = function()
            {
                if(this === drive) blocks.push(drive.data_pointer / 512);
                push.call(this);
            };
            try
            {
                command(lba, 10, cmd, extended);
                for(let i = 0; i < 10 * 256; i++) io.port_write16(0x1F0, i & 65535);
            }
            finally { prototype.push_irq = push; }
            assert.equal(address(extended), lba + 10, "write completion address");
            assert.equal(r(0x1F2), 0);
            assert.deepEqual(blocks, cmd === 0xC5 || cmd === 0x39 ? [4, 8, 10] :
                Array.from({ length: 10 }, (_, i) => i + 1), "write DRQ block interrupts");
            assert.equal(writes.at(-1).start, lba * 512);
            const data = writes.at(-1).data, view = new DataView(data.buffer, data.byteOffset, data.length);
            assert.equal(data.length, 5120);
            for(let i = 0; i < 2560; i++) assert.equal(view.getUint16(i * 2, true), i);
        }
    console.log("PASS ide_transfer_progress:", [...groups].join(","));
}
finally { await vm.destroy(); }
