// An original N90 board and a synthetic AP guest: no guest clock patches.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { V86 } from "../../src/main.js";
import { build32, root } from "../a32/runner.mjs";
import { set_jit_switches } from "../../src/jit_switches.js";
const directory = process.argv[2];
if(!directory) throw Error("usage: ap-counter.mjs owner-provided-10B329-directory");
// Optional performance contract for a candidate core; correctness also runs
// against the conservative interpreter fallback in the default core.
const require_native = process.env.AP_COUNTER_REQUIRE_NATIVE === "1";
const guest = build32("ap-counter", [root + "tests/ios/ap_counter.S"]);
const emulator = new V86({ machine_type: "s5l8930", graphics_adapter: "none", autostart: false, log_level: 0,
    memory_size: 512 << 20, ir_sync_publication: true,
    wasm_path: path.resolve(process.env.A64_WASM || "build/v86-arm64.wasm"),
    jit_switches: { a64_page: 1, a64_page_hot: 1 },
    ios: { kernelcache: { url: path.resolve(directory, "kernelcache.n90.macho") },
        devicetree: { url: path.resolve(directory, "DeviceTree.n90ap.bin") } } });
try
{
    await new Promise((resolve,reject) => { emulator.add_listener("emulator-loaded",resolve); emulator.add_listener("emulator-error",reject); });
    const cpu = emulator.v86.cpu, ex = cpu.wm.exports, timer = cpu.devices.apple_timer;
    cpu.clock.pause();
    const table = new Uint32Array(4096);
    for(let i = 0x400; i < 0x480; i++) table[i] = i << 20 | 0xC0E;
    // Both privileged-only: Strongly-ordered/Device and Normal aliases.
    table[0xC02] = 0xBF100402;
    table[0xC03] = 0xBF10040E;
    cpu.write_blob_physical(new Uint8Array(table.buffer), 0x42000000);
    cpu.write_blob_physical(new Uint8Array(fs.readFileSync(guest + "guest.bin")), 0x40010000);
    const data = () => new DataView(cpu.mem8.buffer, cpu.mem8.byteOffset + cpu.ram_offset(0x43000000, 32), 32);
    data().setUint32(0, 0xC0202000, true);
    cpu.boot(0x40010000, 0);
    const run = async () => { cpu.run_machine_core(); await new Promise(resolve => setImmediate(resolve)); };
    for(let i = 0; i < 60; i++) await run();
    assert.ok(cpu.page_tier_stats().retired > 0, "synthetic AP executes native pages");
    let reads = 0;
    const read = timer.read.bind(timer);
    timer.read = offset => { if(offset === 0x2000 || offset === 0x2004) reads++; return read(offset); };
    const check = () => {
        const ticks = Math.floor(cpu.clock.now() * 24000);
        assert.equal(data().getUint32(16,true), ticks >>> 0);
        assert.equal(data().getUint32(20,true), Math.floor(ticks / 2**32));
    };
    for(const address of [0xC0202000, 0xC0302000])
    {
        data().setUint32(0,address,true);
        for(const time of [0,1.25,2**32/24000+1000])
        {
            cpu.clock.set_time(time);
            for(let i = 0; i < 4; i++) await run();
            check();
            reads = 0; await run(); check();
            if(require_native) assert.equal(reads,0,"compiled scalar AP reads use no interpreter MMIO callback");
        }
    }
    const saved = cpu.clock.get_state();
    cpu.clock.set_time(1); await run();
    cpu.clock.set_state(saved); await run(); check();
    assert.equal(ex.a64_page_access_scalar(0xC0202000n, 4 | 0x800),0,"EL0 permission is checked before the clock shortcut");
    assert.equal(ex.a64_page_access_scalar(0xC0402000n,4),0,"unmapped aliases are refused");
    assert.equal(ex.a64_page_access_scalar(0xC0202000n,4 | 0x100),0,"writes retain the device path");
    assert.equal(ex.a64_page_access_scalar(0xC0202001n,4),0,"unaligned device reads are refused");
    assert.equal(ex.a64_page_access_scalar(0xC0202008n,4),0,"the decrementer retains its device path");
    assert.equal(ex.a64_page_access(0xC0202000n,4),0,"non-scalar accesses retain their original path");
    assert.equal(ex.a64_page_access(0xC0202000n,8),0,"LDRD/LDM cannot borrow one scalar value");
    // Execute the same reads interpreted as an independent device oracle.
    set_jit_switches(ex,cpu.wasm_memory,{a64_page:0});
    reads = 0; await run(); check();
    assert.ok(reads > 0,"interpreter reads the actual board device");
    set_jit_switches(ex,cpu.wasm_memory,{a64_page:1});
    data().setUint32(4,1,true);
    reads = 0; await run(); check();
    assert.ok(reads > 0,"actual LDM keeps both device accesses");
    console.log("PASS: AP scalar PMGR reads match the board clock through both memory types, rollover and restore; permissions and LDM remain precise");
}
finally { await emulator.destroy(); }
