import assert from "node:assert/strict";
import test from "node:test";
import { check_machine_options } from "../../src/machine_options.js";
import { create_n97_boot_timer, n97_boot_files, N97_BOOT_CONTROL, N97_BOOT_TIMER, N97_BOOT_TOC,
    N97_RAM_BASE, N97_RAM_SIZE, N97_ROM_ADDRESS } from "../../src/symbian/n97_board.js";

test("the RM-505 handoff supplies the physical ROM address and RAP3NAND tag format", () => {
    assert.equal(check_machine_options({ machine_type: "nokia-n97", symbian: { rom: {} } }).cpu_profile, "arm1136");
    assert.throws(() => check_machine_options({ machine_type: "nokia-n97", symbian: { rom: {}, load_address: 0 } }), /boot_registers/);
    const boot = n97_boot_files(new ArrayBuffer(4));
    assert.equal(boot.address, N97_ROM_ADDRESS);
    assert.deepEqual(boot.registers, [0, 0, N97_RAM_BASE + N97_RAM_SIZE - boot.tags.length, 0]);
    const view = new DataView(boot.tags.buffer);
    const records = new Map();
    let at = 0;
    let type;
    do
    {
        type = view.getUint32(at, true);
        const length = view.getUint32(at + 4, true);
        assert.ok(length >= 8 && length % 4 === 0 && at + length <= boot.tags.length);
        assert.ok(!records.has(type));
        records.set(type, [at, length]);
        at += length;
    }
    while(type !== 2);
    assert.equal(at + 4, boot.tags.length);
    assert.equal(view.getUint32(at, true), 0);
    const [ram, ram_length] = records.get(4);
    assert.equal(ram_length, 16);
    assert.equal(view.getUint32(ram + 8, true), N97_RAM_SIZE);
    assert.equal(view.getUint32(ram + 12, true), N97_RAM_BASE);
    assert.equal(view.getFloat64(records.get(7)[0] + 8, true), 433.92);
    assert.equal(view.getUint32(records.get(22)[0] + 8, true), 433920000);
    assert.equal(view.getUint32(records.get(10)[0] + 8, true), N97_BOOT_TOC);
    assert.equal(view.getUint32(records.get(13)[0] + 8, true), 0x00012400);
    assert.deepEqual(records.get(18), [0, 12]);
    assert.equal(view.getUint32(8, true), 0xFFFF1200);
});

test("the boot timer advances at 32768 Hz and holds a counter snapshot until the next capture", () => {
    let now = 100;
    const mapped = new Map();
    const device = create_n97_boot_timer({
        clock: { now: () => now },
        io: { register_mmio(address, width, handler) { assert.equal(width, 4); mapped.set(address, handler); } },
    });
    const write = (address, value) => mapped.get(address).write(0, 4, value);
    const capture = () => write(N97_BOOT_TIMER + 0x14, 0);
    const read = () => mapped.get(N97_BOOT_TIMER + 0x10).read(0, 4);
    capture();
    assert.equal(read(), 0);
    write(N97_BOOT_TIMER + 4, 1);
    write(N97_BOOT_CONTROL, 8);
    now += 125;
    capture();
    assert.equal(read(), 4096);
    now += 125;
    assert.equal(read(), 4096);
    write(N97_BOOT_TIMER + 0x18, 0);
    assert.equal(read(), 4096);
    assert.throws(() => write(N97_BOOT_TIMER + 0x18, 1), /unsupported boot timer/);
    capture();
    assert.equal(read(), 8192);
    const saved = device.get_state();
    now += 2 ** 32 * 1000 / 32768;
    capture();
    assert.equal(read(), 8192);
    device.reset();
    capture();
    assert.equal(read(), 0);
    device.set_state(saved);
    assert.equal(read(), 8192);
    assert.equal(device.get_state()[3], 8);
});
