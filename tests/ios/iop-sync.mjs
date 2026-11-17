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
}
finally { await emulator.destroy(); }
