import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { syborg_uart } from "../../src/symbian/syborg_devices.js";
import { syborg_install_channel } from "../../src/symbian/syborg_install_channel.js";
import { syborg_install_rom } from "../../src/symbian/syborg_install_rom.js";
import { inspect_syborg_xip } from "../../src/symbian/syborg_xip.js";

test("the installer packet uses the Syborg UART FIFO, and a restored agent can receive another request", () => {
    const handlers = new Map(), replies = [];
    const bus = {
        register: (event, callback) => handlers.set(event, callback),
        send(event, value) { if(event === "symbian-install-result") replies.push(value); },
    };
    let io;
    const bridge = syborg_install_channel(bus, bytes => uart.queue_packet(bytes), true);
    const uart = syborg_uart({ io: { register_mmio(_base, _size, handler) { io = handler; } } }, bus, 1, () => {}, bridge.receive);
    const emit = (...bytes) => { for(const byte of bytes) io.write(4, 4, byte); };
    const command = Uint8Array.from({ length: 512 }, (_, index) => (index * 7) & 255);
    const open = handlers.get("symbian-install-package");
    open([0, command]);
    assert.deepEqual(replies, [[0, -18]]);
    emit(86, 56, 73, 43);
    open([1, command]);
    assert.equal(io.read(8, 4), 16);
    const cpu_reads = count => Array.from({ length: count }, () => io.read(4, 4));
    assert.deepEqual(cpu_reads(40), Array.from(command.subarray(0, 40)));
    const saved = [uart.get_state(), bridge.get_state()];
    assert.deepEqual(cpu_reads(472), Array.from(command.subarray(40)));
    uart.set_state(saved[0]);
    bridge.set_state(saved[1]);
    assert.deepEqual(cpu_reads(472), Array.from(command.subarray(40)));
    emit(86, 56, 73, 61, 0, 0, 0, 0, 86, 56, 73, 43);
    assert.deepEqual(replies, [[0, -18], [1, 0]]);
    open([2, command]);
    assert.equal(io.read(8, 4), 16);
});

test("the RM-356 ROM overlay adds only the installer app and redirects the pinned EStart import",
    { skip: !process.env.SYBORG_ROM }, async () => {
        const original = await readFile(process.env.SYBORG_ROM);
        const xip = inspect_syborg_xip(original);
        const result = syborg_install_rom(original, xip, 86 * 1024 * 1024 - 65536);
        const changed = inspect_syborg_xip(result);
        assert.equal(changed.directory.files.size, xip.directory.files.size + 1);
        for(const [name, before] of xip.directory.files)
        {
            const after = changed.directory.files.get(name);
            assert.equal(after.address, before.address, name);
            assert.equal(after.size, before.size, name);
        }
        const view = new DataView(result.buffer);
        assert.ok(view.getUint32(0x78EE28, true) >= xip.header.rom_base + original.length);
        assert.equal(original.readUInt32LE(0x78EE28), 0x80299829);
        const helper = changed.directory.files.get("sys/bin/v86_install.exe");
        assert.equal(view.getUint32(helper.address - xip.header.rom_base, true), 0x1000007A);
        assert.equal(view.getUint32(helper.address - xip.header.rom_base + 136, true), 0);
    });
