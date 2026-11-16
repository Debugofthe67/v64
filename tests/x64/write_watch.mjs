// A host watch must observe real scalar/RMW/REP/SSE stores without changing
// bytes or injecting guest debug exceptions, in interpreted and compiled code.
import assert from "node:assert/strict";
import fs from "node:fs";
import {spawnSync} from "node:child_process";
import {setImmediate as immediate} from "node:timers/promises";
import {with_smp_mode,compiled_hits} from "../lib/smp_modes.mjs";
const {V86}=await import(+process.env.TEST_RELEASE_BUILD?"../../build/libv86.mjs":"../../src/main.js");
const file="build/write-watch.bin";
const assembled=spawnSync("nasm",["-f","bin","tests/x64/write_watch.asm","-o",file],{encoding:"utf8"});
assert.equal(assembled.status,0,assembled.stderr);
const results=[];
for(const mode of ["interpreter","pages"]) for(const watched of [false,true])
{
    const vm=new V86(with_smp_mode({wasm_path:process.env.TEST_WASM||"build/nv40-write-watch.wasm",
        graphics_adapter:"none",multiboot:{url:file},memory_size:16<<20,disable_jit:mode==="interpreter",
        ir_sync_publication:true,cpu_quantum:257,autostart:false,log_level:0},mode));
    try
    {
        await new Promise(resolve=>vm.add_listener("emulator-loaded",resolve));
        const cpu=vm.v86.cpu,api=cpu.wm.exports;
        assert(api.ir_test_write_watch,"requires ir-test-hooks");
        assert.equal(api.ir_test_write_watch(16,0x400),0,"reject an out-of-bounds slot");
        assert.equal(api.ir_test_write_watch(0,0x1000),0,"reject a page outside RAM");
        assert.equal(api.ir_test_write_watch(0,0xA0),0,"reject the VGA aperture");
        if(watched){assert(api.ir_test_write_watch(0,0x400));assert(api.ir_test_write_watch(1,0x401));}
        const word=at=>new DataView(cpu.mem8.buffer,cpu.mem8.byteOffset).getUint32(at,true),deadline=performance.now()+15000;
        while(word(0x380000)!==0xD0D0){assert(performance.now()<deadline,"guest stalled");cpu.run_cores();await immediate();}
        const bytes=Buffer.from(cpu.mem8.slice(0x400000,0x402000)),count=api.ir_test_write_watch_total()>>>0;
        if(watched)
        {
            const first=Math.max(0,count-4096);
            const rows=Array.from({length:count-first},(_,i)=>Array.from({length:24},(_,j)=>api.ir_test_write_watch_word(first+i,j)>>>0));
            const pcs=new Set(rows.map(row=>row[4]));
            for(let i=0;i<6;i++)assert(pcs.has(word(0x380004+i*4)),`missing writer ${i}`);
            assert(rows.every(row=>row[1]>=0x400000&&row[1]<0x402000),"only requested pages");
            assert(rows.some(row=>row[15]>1),"repeated stores are coalesced");
            assert.equal(api.ir_test_write_watch_word(count,0),0,"reject a future sequence");
            if(first)assert.equal(api.ir_test_write_watch_word(first-1,1),0,"reject overwritten records");
            cpu.write_blob_physical(Uint8Array.of(1,2,3,4),0x400080);
            assert(api.ir_test_write_watch_total()>count,"host device writes notify the watch too");
            assert(api.ir_test_write_watch(0,0xFFFFFFFF));assert(api.ir_test_write_watch(1,0xFFFFFFFF));
            const stopped=api.ir_test_write_watch_total();
            cpu.write_blob_physical(Uint8Array.of(5,6,7,8),0x400084);
            assert.equal(api.ir_test_write_watch_total(),stopped,"disabled watch stops observing");
        }
        else assert.equal(count,0);
        if(mode==="pages")assert(compiled_hits(api)>0,"compiled execution");
        results.push({mode,watched,bytes});console.log("PASS write watch",mode,watched,count);
    }
    finally {await vm.destroy();}
}
for(const result of results)assert.deepEqual(result.bytes,results[0].bytes,"watch and execution tier preserve identical memory");
console.log("PASS: six writer forms observed with identical watched/unwatched guest bytes");
