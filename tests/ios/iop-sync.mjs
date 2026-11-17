import assert from "node:assert/strict";
import path from "node:path";
import { V86 } from "../../src/main.js";
import { STATE_OFFSETS } from "../../src/arm/state_layout.js";
import { set_jit_switches } from "../../src/jit_switches.js";

const directory = process.argv[2];
if(!directory) throw Error("usage: iop-sync.mjs owner-provided-10B329-directory");
const emulator = new V86({
    machine_type: "s5l8930", graphics_adapter: "none", autostart: false, log_level: 0,
    wasm_path: path.resolve(process.env.A64_WASM || "build/v86-arm64.wasm"),
    jit_switches: { a64_page: 1, a64_page_hot: 1 },
    ios: { kernelcache: { url: path.resolve(directory, "kernelcache.n90.macho") },
        devicetree: { url: path.resolve(directory, "DeviceTree.n90ap.bin") } },
});
try
{
    await new Promise((resolve, reject) => {
        emulator.add_listener("emulator-loaded", resolve);
        emulator.add_listener("emulator-error", reject);
    });
    const cpu = emulator.v86.cpu, ex = cpu.wm.exports, iop = cpu.devices.apple_iop;
    const apCode = 0x40010000, iopBase = 0x41000000;
    const writeCode = (address, words) =>
        cpu.write_blob_physical(new Uint8Array(new Uint32Array(words).buffer), address);
    const registers = () => new DataView(cpu.wasm_memory.buffer, cpu.state_base, 4096);
    writeCode(apCode, [0xE1901F9F, 0xE1802F91]); // LDREX r1,[r0]; STREX r2,r1,[r0]
    writeCode(iopBase, [0xE3A00A01, 0xE3A01000, 0xE5801000, 0xEAFFFFFD]); // store zero at local 4096
    iop.write(0x110, iopBase);
    iop.write(0x114, 8192);
    iop.write(0x100, 1);
    for(let n = 0; n < 60; n++) { iop.run(); await new Promise(resolve => setImmediate(resolve)); }
    assert.ok(ex.a32_iop_native() > 0, "IOP store loop has compiled");
    for(const jit of [0, 1])
    {
        set_jit_switches(ex, cpu.wasm_memory, { a64_page: jit });
        for(const [offset, failed] of [[4160, 0], [4096, 1]])
        {
            registers().setBigUint64(STATE_OFFSETS.pc, BigInt(apCode), true);
            registers().setBigUint64(STATE_OFFSETS.x, BigInt(iopBase + offset), true);
            ex.a64_step();
            iop.run();
            ex.a64_step();
            assert.equal(registers().getUint32(STATE_OFFSETS.x + 16, true), failed,
                `STREX after IOP same-value store (offset ${offset}, JIT ${jit})`);
        }
    }
    console.log("PASS: IOP stores invalidate only the matching AP reservation in both execution modes");

    // WFI; MOV r5,#1; WFE; MOV r5,#2; WFE; MOV r5,#3; B .
    writeCode(iopBase, [0xE320F003, 0xE3A05001, 0xE320F002, 0xE3A05002, 0xE320F002, 0xE3A05003, 0xEAFFFFFE]);
    writeCode(apCode, [0xE320F004]); // SEV
    const marker = () => {
        ex.a32_iop_select(true);
        try { return registers().getUint32(STATE_OFFSETS.x + 5 * 8, true); }
        finally { ex.a32_iop_select(false); }
    };
    const sendEvent = () => {
        registers().setBigUint64(STATE_OFFSETS.pc, BigInt(apCode), true);
        ex.a64_step();
    };
    for(const jit of [0, 1])
    {
        set_jit_switches(ex, cpu.wasm_memory, { a64_page: jit });
        iop.write(0x100, 1);
        assert.equal(iop.run(), false);
        const asleep = iop.get_state();
        sendEvent();
        iop.run();
        assert.equal(marker(), 0, "SEV alone does not wake WFI");
        iop.set_state(asleep);
        assert.equal(iop.run(), false, "restored WFI stays asleep");
        assert.equal(marker(), 0);
        iop.vic.write(0, 0x10, 1);
        iop.vic.set_line(0, true);
        assert.ok(iop.wake_pending(), "host should reschedule the IOP for WFI wakeup");
        iop.run();
        assert.equal(marker(), 1, "masked IRQ wakes WFI without taking an exception");
        iop.run();
        assert.equal(marker(), 1, "masked IRQ does not wake WFE");
        assert.equal(!!iop.wake_pending(), false, "host can idle with masked IRQ during WFE");
        iop.vic.set_line(0, false);
        sendEvent();
        assert.ok(iop.wake_pending(), "AP event reschedules the waiting IOP");
        const eventPending = iop.get_state();
        iop.run();
        assert.equal(marker(), 2, "AP SEV wakes the first WFE");
        iop.set_state(eventPending);
        iop.run();
        iop.run();
        assert.equal(marker(), 2, "restored event is consumed only once");
        sendEvent();
        iop.run();
        assert.equal(marker(), 3);
    }
    console.log("PASS: IOP WFI/WFE persist across slices and restore, with VIC and AP event wakeups");
}
finally { await emulator.destroy(); }
