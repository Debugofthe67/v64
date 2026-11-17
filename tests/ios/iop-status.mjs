// A private ARM7 firmware reads the real privileged CPSR through the JIT.
import assert from "node:assert/strict";
import path from "node:path";
import { V86 } from "../../src/main.js";
import { set_jit_switches } from "../../src/jit_switches.js";
import { STATE_OFFSETS } from "../../src/arm/state_layout.js";
const directory = process.argv[2];
if(!directory) throw Error("usage: iop-status.mjs owner-provided-10B329-directory");
const emulator = new V86({machine_type:"s5l8930",graphics_adapter:"none",autostart:false,log_level:0,
    wasm_path:path.resolve(process.env.A64_WASM || "build/v86-arm64.wasm"),jit_switches:{a64_page:1},
    ios:{kernelcache:{url:path.resolve(directory,"kernelcache.n90.macho")},
        devicetree:{url:path.resolve(directory,"DeviceTree.n90ap.bin")}}});
try
{
    await new Promise((resolve,reject)=>{emulator.add_listener("emulator-loaded",resolve);emulator.add_listener("emulator-error",reject);});
    const cpu=emulator.v86.cpu,iop=cpu.devices.apple_iop,base=0x41000000;
    // MOVW/MOVT; MSR CPSR_fsxc; MOV r2,#4096; MRS r1,CPSR; STR; B MRS.
    const code=new Uint32Array([0xE30001D3,0xE34A080F,0xE12FF000,0xE3A02A01,0xE10F1000,0xE5821000,0xEAFFFFFC]);
    cpu.write_blob_physical(new Uint8Array(code.buffer),base);
    iop.write(0x110,base);iop.write(0x114,8192);iop.write(0x100,1);
    for(let n=0;n<60;n++){iop.run();await new Promise(resolve=>setImmediate(resolve));}
    const data=new DataView(cpu.mem8.buffer,cpu.mem8.byteOffset+cpu.ram_offset(base+4096,4),4);
    assert.equal(data.getUint32(0,true),0xA80F01D3,"NZCVQ, GE, A/I/F masks and supervisor mode are live");
    const before=cpu.wm.exports.a32_iop_native();
    const helpers=cpu.page_tier_stats().helpers;
    iop.run();
    assert.ok(cpu.wm.exports.a32_iop_native()>before);
    assert.equal(cpu.page_tier_stats().helpers,helpers,"compiled MRS does not save/reload GPRs through the interpreter");
    const diagnostics=await emulator.get_diagnostics(true);
    assert.ok(Number.isInteger(diagnostics.cores[0].fpcr));
    assert.ok(Number.isInteger(diagnostics.cores[0].fpsr));
    assert.ok(Array.isArray(diagnostics.steps.helped_words));
    assert.equal((await emulator.get_diagnostics()).steps,undefined,"instruction counters are opt-in");
    // The existing profiling switch must gate the exact word histogram
    // too. Total helper work and architectural behavior remain observable.
    const ex=cpu.wm.exports,thumb=new Uint32Array(cpu.wasm_memory.buffer,cpu.state_base+332,1)[0]&32;
    const nop=thumb?0x4600:0xE1A00000,length=thumb?2:4;
    const count=()=>{for(let i=0;i<4096;i++) if(ex.a32_helper_word(i,false)===nop) return ex.a32_helper_word(i,true);return 0;};
    const r0=new Uint32Array(cpu.wasm_memory.buffer,cpu.state_base+64,1)[0];
    for(const enabled of [0,1,0])
    {
        set_jit_switches(ex,cpu.wasm_memory,{a64_step_stats:enabled});
        const before=count(),total=cpu.page_tier_stats().helpers;
        for(let n=0;n<64;n++)assert.equal(ex.a32_page_helper(nop,BigInt(base),length),0);
        assert.equal(count()-before,enabled?64:0,"disabled profiling performs no word-histogram updates");
        assert.equal(cpu.page_tier_stats().helpers-total,64,"total helper diagnostics always count the work");
        assert.equal(new Uint32Array(cpu.wasm_memory.buffer,cpu.state_base+64,1)[0],r0,"NOP preserves R0 with either profiling mode");
    }
    if(ex.a32_stepped_word)
    {
        const saved = cpu.save_core_state(), address = base + 8192;
        cpu.write_blob_physical(new Uint8Array(new Uint32Array([0xE1A09009]).buffer), address);
        const state = new DataView(cpu.wasm_memory.buffer, cpu.state_base, 4096);
        const count = () => {
            for(let i = 0; i < 4096; i++)
                if(ex.a32_stepped_word(i, false) === 0xE1A09009) return ex.a32_stepped_word(i, true);
            return 0;
        };
        try
        {
            state.setUint32(STATE_OFFSETS.pstate, 0x1D3, true);
            state.setBigUint64(STATE_OFFSETS.sctlr_el1, 0n, true);
            for(const enabled of [0, 1, 0])
            {
                set_jit_switches(ex, cpu.wasm_memory, { a64_step_stats: enabled });
                const before = count();
                for(let n = 0; n < 64; n++)
                {
                    state.setBigUint64(STATE_OFFSETS.pc, BigInt(address), true);
                    ex.a64_page_step();
                    assert.equal(state.getBigUint64(STATE_OFFSETS.pc, true), BigInt(address + 4));
                }
                assert.equal(count() - before, enabled ? 64 : 0, "exact stepped words are gated by the profiling switch");
            }
            set_jit_switches(ex, cpu.wasm_memory, { a64_step_stats: 1 });
            const before = count();
            state.setBigUint64(STATE_OFFSETS.pc, 0x20000000n, true);
            ex.a64_page_step();
            assert.equal(count(), before, "a fetch fault cannot count the previously stepped word again");
            set_jit_switches(ex, cpu.wasm_memory, { a64_step_stats: 0 });
        }
        finally { cpu.load_core_state(saved); }
        assert.ok(Array.isArray((await emulator.get_diagnostics(true)).steps.a32_stepped_words));
    }
    console.log("PASS: privileged native IOP MRS preserves flags, GE and interrupt masks without interpreter helpers");
}
finally {await emulator.destroy();}
