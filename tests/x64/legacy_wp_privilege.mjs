#!/usr/bin/env node
// Intel SDM vol.3A, page-level protection: WP=0 overrides supervisor access
// only. A kernel TLB fill must not grant CPL3 access to a read-only user page.
import assert from "node:assert/strict";
import fs from "node:fs";
import {spawnSync} from "node:child_process";
import {setImmediate as immediate} from "node:timers/promises";
import {with_smp_mode, compiled_hits} from "../lib/smp_modes.mjs";
const {V86}=await import(+process.env.TEST_RELEASE_BUILD?"../../build/libv86.mjs":"../../src/main.js");
fs.mkdirSync("build/legacy-wp-privilege",{recursive:true});
const results=[];
for(const mode of ["interpreter","pages"]) for(const pae of [false,true]) for(const large of [false,true]) for(const read of [false,true])
{
    const label=`${mode} ${pae?"PAE":"legacy"} ${large?"large":"4KiB"} ${read?"read then write":"direct write"}`;
    const file="build/legacy-wp-privilege/guest.bin";
    const assembly=spawnSync("nasm",["-f","bin",...(pae?["-DPAE"]:[]),...(large?["-DLARGE"]:[]),...(read?["-DREAD_FIRST"]:[]),
        "-o",file,"tests/x64/legacy_wp_privilege.asm"],{encoding:"utf8"});
    assert.equal(assembly.status,0,assembly.stderr);
    const vm=new V86(with_smp_mode({graphics_adapter:"none",multiboot:{url:file},memory_size:16<<20,
        ...(process.env.TEST_WASM?{wasm_path:process.env.TEST_WASM}:{}),
        disable_jit:mode==="interpreter",ir_sync_publication:true,cpu_quantum:257,autostart:false,log_level:0},mode));
    try
    {
        await new Promise(resolve=>vm.add_listener("emulator-loaded",resolve));
        const cpu=vm.v86.cpu,word=at=>new DataView(cpu.mem8.buffer,cpu.mem8.byteOffset).getUint32(at,true);
        if(process.env.TEST_WRITE_WATCH)
            assert(cpu.wm.exports.ir_test_write_watch?.(0,0x400),"arm a host watch on the protected backing page");
        const deadline=performance.now()+15000;
        while(word(0x380018)!==0xD0D0)
        {
            assert.equal(word(0x38001C),0,label+": unexpected exception");
            assert(performance.now()<deadline,label+": guest stalled");cpu.run_cores();
            await immediate();
        }
        const row={label,faults:word(0x380000),error:word(0x380004),cr2:word(0x380008),value:word(0x38000C),
            read:word(0x380014),compiledInstructions:compiled_hits(cpu.wm.exports)};
        results.push(row);console.log(JSON.stringify(row));
        if(mode==="pages")assert(row.compiledInstructions>0,label+": compiled code executed");
    }
    finally {await vm.destroy();}
}
fs.writeFileSync("build/legacy-wp-privilege/result.json",JSON.stringify(results,null,2)+"\n");
for(const row of results)
{
    assert.equal(row.faults,1,row.label+": exactly one user write fault");
    assert.equal(row.error,7,row.label+": user write protection error");
    assert.equal(row.cr2,0x4000000,row.label+": target fault address");
    assert.equal(row.value,0x11223344,row.label+": legitimate kernel value survives");
    if(row.label.endsWith("read then write"))assert.equal(row.read,0x11223344,row.label+": user read still allowed");
}
console.log("PASS: supervisor WP override never grants user write permission in16 interpreter/compiled paging cases");
