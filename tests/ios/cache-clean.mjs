// Private firmware on the real Cortex-A8 board: DCCSW has the same coherent
// no-op semantics as the interpreter, without a fetch/decode step per way.
import assert from "node:assert/strict";
import path from "node:path";
import { V86 } from "../../src/main.js";
import { set_jit_switches } from "../../src/jit_switches.js";
const directory = process.argv[2];
if(!directory) throw Error("usage: cache-clean.mjs owner-provided-10B329-directory");
const emulator = new V86({ machine_type: "s5l8930", graphics_adapter: "none", autostart: false, log_level: 0,
    ir_sync_publication: true,
    wasm_path: path.resolve(process.env.A64_WASM || "build/v86-arm64.wasm"), jit_switches: { a64_page: 1, a64_page_hot: 1 },
    ios: { kernelcache: { url: path.resolve(directory, "kernelcache.n90.macho") },
        devicetree: { url: path.resolve(directory, "DeviceTree.n90ap.bin") } } });
try
{
    await new Promise((resolve, reject) => {
        emulator.add_listener("emulator-loaded", resolve);emulator.add_listener("emulator-error", reject);
    });
    const cpu = emulator.v86.cpu, iop = cpu.devices.apple_iop, base = 0x41000000;
    for(const [name, thumb, opcode, native] of [
        ["ARM DCCSW", false, 0xEE070F5A, true],
        ["Thumb DCCSW", true, 0xEE070F5A, true],
        ["ARM false-condition DCCSW", false, 0x0E070F5A, true],
        ["ARM neighboring DCCMVAC", false, 0xEE070F3A, false],
    ])
    {
        iop.write(0x100, 0x10);
        const code = [0xE30001D3, 0xE34A080F, 0xE12FF000, 0xE3A02A01];
        if(thumb) code.push(0xE28F3001, 0xE12FFF13, 0x8100F3EF,
            ((opcode << 16) | (opcode >>> 16)) >>> 0, 0xE7F96011);
        else code.push(0xE10F1000, 0xE5821000, opcode, 0xEAFFFFFB);
        cpu.write_blob_physical(new Uint8Array(new Uint32Array(code).buffer), base);
        iop.write(0x110, base);iop.write(0x114, 8192);iop.write(0x100, 1);
        for(let n = 0; n < 60; n++) { iop.run();await new Promise(resolve => setImmediate(resolve)); }
        const before = cpu.page_tier_stats();
        const retired = cpu.wm.exports.core_statistics_get(1, 0);
        iop.run();
        const after = cpu.page_tier_stats();
        const data = new DataView(cpu.mem8.buffer, cpu.mem8.byteOffset + cpu.ram_offset(base + 4096, 4), 4);
        assert.equal(data.getUint32(0, true), 0xA80F01D3, name + " preserves flags, GE, masks and mode");
        assert.ok(after.retired > before.retired, name + " actually runs compiled code");
        assert.equal(cpu.wm.exports.core_statistics_get(1, 0) - retired, 4096,
            name + " counts each instruction once across native and interpreted execution");
        if(native) assert.equal(after.steps, before.steps, name + " needs no interpreter step");
        else assert.ok(after.steps > before.steps, name + " retains its original CP15 path");
        const undefineds = cpu.undefined_instructions();
        assert.equal(undefineds.el0 + undefineds.el1, 0, name + " stays supported");
    }
    // A real user-mode loop must still trap for each CP15 write. The UND
    // vector saves SPSR and returns through MOVS PC,LR to the next instruction.
    iop.write(0x100, 0x10);
    const code = new Uint32Array(21).fill(0xE1A00000);
    const branch = (from, to) => 0xEA000000 | ((to - from - 8) >> 2 & 0xFFFFFF);
    code[0] = branch(0, 32);code[1] = branch(4, 64);
    code.set([0xE3A02A01, 0xE3A00010, 0xE121F000, 0xE3A04080,
        0xEE070F5A, 0xE2544001, 0x1AFFFFFC, 0xEAFFFFFE], 8);
    code.set([0xE14F1000, 0xE5821000, 0xE3A03001, 0xE5823004, 0xE1B0F00E], 16);
    cpu.write_blob_physical(new Uint8Array(code.buffer), base);
    cpu.write_blob_physical(new Uint8Array(8), base + 4096);
    iop.write(0x110, base);iop.write(0x114, 8192);iop.write(0x100, 1);
    for(let n = 0; n < 60; n++) { iop.run();await new Promise(resolve => setImmediate(resolve)); }
    const data = new DataView(cpu.mem8.buffer, cpu.mem8.byteOffset + cpu.ram_offset(base + 4096, 8), 8);
    assert.equal(data.getUint32(0, true) & 31, 16, "UND captures the original user mode");
    assert.equal(data.getUint32(4, true), 1, "user-mode DCCSW reaches the real undefined vector");

    // Both exception vectors wait. The LDREX helper succeeds; the next
    // instruction either faults in a step or retries a native load mid-block.
    for(const [opcode, name] of [[0xE7F000F0, "undefined step"], [0xE5901001, "unaligned load"]])
    {
        const program = new Uint32Array(16).fill(0xE320F003);
        program[0] = branch(0, 32);
        program.set([0xE3A00A01, 0xE1901F9F, opcode, 0xE3A04001, 0xE3A05002], 8);
        cpu.write_blob_physical(new Uint8Array(program.buffer), base);
        const once = () => {
            iop.write(0x100, 1);
            const before = cpu.wm.exports.core_statistics_get(1, 0);
            assert.equal(iop.run(), false);
            return cpu.wm.exports.core_statistics_get(1, 0) - before;
        };
        set_jit_switches(cpu.wm.exports, cpu.wasm_memory, { a64_page: 0 });
        assert.equal(once(), 4, name + ": branch, MOV, LDREX and vector WFI retire");
        set_jit_switches(cpu.wm.exports, cpu.wasm_memory, { a64_page: 1 });
        for(let n = 0; n < 60; n++) { once(); await new Promise(resolve => setImmediate(resolve)); }
        const before = cpu.page_tier_stats();
        assert.equal(once(), 4, name + " and the unexecuted block suffix do not retire");
        const after = cpu.page_tier_stats();
        assert.ok(after.retired > before.retired && after.helpers > before.helpers, "tested the compiled helper");
        if(name === "unaligned load") assert.ok(after.retries > before.retries, "tested a real native retry");
    }
    console.log("PASS: ARM/Thumb cache operations preserve CPSR; native, stepped, helper and fault paths count retirements exactly once");
}
finally { await emulator.destroy(); }
