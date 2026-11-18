import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { V86 } from "../../src/main.js";
import { STATE_OFFSETS } from "../../src/arm/state_layout.js";
import { check_n97_bootrom, N97_RAPIDO_ROM_ID, write_n97_boot_media } from "../../src/symbian/n97_boot_media.js";
import { N97_ROM_ADDRESS } from "../../src/symbian/n97_board.js";

const wasm_path = fileURLToPath(new URL("../../build/v86-arm64.wasm", import.meta.url));
const service = 0xFFFF1208;

function probe_bootrom()
{
    const bytes = new Uint8Array(8192);
    // Synthetic Thumb rejection routine, never used as a retail ROM.
    bytes.set([0x00, 0x20, 0x70, 0x47], 0x1208);
    return bytes;
}

test("RAPIDO ROM checks size, mapped entry, independently reported chip ID and digest", () => {
    const bytes = probe_bootrom();
    const result = check_n97_bootrom(bytes, "4b9b7510:3e691ff8");
    assert.equal(result.id, N97_RAPIDO_ROM_ID);
    assert.equal(check_n97_bootrom(bytes).id, "");
    assert.throws(() => check_n97_bootrom(bytes, "123456789ABCDEF0"), /does not match RM-505/);
    assert.throws(() => check_n97_bootrom(bytes, "", "0".repeat(64)), /SHA-256 does not match/);
    assert.throws(() => check_n97_bootrom(bytes.subarray(1)), /page-aligned/);
    assert.throws(() => check_n97_bootrom(new Uint8Array(8192)), /no code at/);
});

test("the ARM1136 maps the supplied chip ROM read-only and binds snapshots to its digest", async () => {
    const xip = new Uint8Array(36);
    const instructions = new DataView(xip.buffer);
    [
        0xE28FE00C, // add lr, pc, #12
        0xE59FF000, // ldr pc, [pc] -> Thumb entry literal at +12
        0,
        service | 1,
        0,
        0xE51F1010, // ldr r1, [pc, #-16] -> entry literal
        0xE3C11001, // bic r1, r1, #1
        0xE5810000, // str r0, [r1] -> ignored by ROM
        0xE5912000, // ldr r2, [r1]
    ].forEach((word, index) => instructions.setUint32(index * 4, word, true));
    const media = write_n97_boot_media(new Uint8Array(4096), xip,
        { address: 0x08200000, bytes: new Uint8Array([1]) },
        { address: 0x08480000, bytes: new Uint8Array([2]) });
    const image = buffer => ({ buffer });
    const bootrom = probe_bootrom();
    const vm = new V86({ machine_type: "nokia-n97", wasm_path, disable_jit: true, autostart: false, graphics_adapter: "none", log_level: 0,
        symbian: { rom: image(xip.buffer), boot_media: image(media.buffer), bootrom: image(bootrom.buffer) } });
    try
    {
        await new Promise((resolve, reject) => {
            vm.add_listener("emulator-loaded", resolve);
            vm.add_listener("emulator-error", reject);
        });
        const cpu = vm.v86.cpu;
        const step = () => cpu.wm.exports.a64_worker_slice(1);
        const pc = () => Number(cpu.read_pc());
        const state = new DataView(cpu.wasm_memory.buffer, cpu.state_base);
        assert.equal(pc(), N97_ROM_ADDRESS);
        step();
        step();
        assert.equal(pc(), service);
        step();
        step();
        assert.equal(pc(), N97_ROM_ADDRESS + 20);
        step();
        step();
        step();
        step();
        const stop_pc = N97_ROM_ADDRESS + 36;
        assert.equal(pc(), stop_pc);
        assert.equal(state.getUint32(STATE_OFFSETS.x + 16, true), 0x47702000);
        const saved = await vm.save_state();
        const expected = check_n97_bootrom(bootrom).sha256;
        const sram = cpu.devices.n97_sram.get_state();
        assert.ok(sram[0].endsWith(expected));
        sram[0] = sram[0].replace(expected, "0".repeat(64));
        assert.throws(() => cpu.devices.n97_sram.check_state(sram), /same ROM and loader handoff/);
        const legacy = cpu.get_state(true);
        legacy[103][1] = 4;
        assert.throws(() => cpu.validate_state(legacy), /same ROM and loader handoff/);
        await vm.restart("power-on");
        step();
        step();
        assert.equal(pc(), service);
        step();
        assert.equal(pc(), service + 2);
        await vm.restore_state(saved);
        assert.equal(pc(), stop_pc);
    }
    finally
    {
        await vm.destroy();
    }
});
