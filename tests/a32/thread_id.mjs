#!/usr/bin/env node
import assert from "node:assert/strict";
import { STATE_OFFSETS } from "../../src/arm/state_layout.js";
import { build32, reference32, actual32, root } from "./runner.mjs";
const directory = build32("thread-id", [root+"tests/a32/thread_id.c",root+"tests/a32/thread_id_asm.S"]);
const expected = await reference32(directory);
assert.equal(expected.status,"ok",expected.text);
process.env.A64_JIT = "1";
process.env.A64_JIT_HOT = "1";
process.env.A64_JIT_SWITCHES = "a64_page_aarch32=1";
let high_halves;
const got = await actual32(directory,{setup:cpu=>{
    const offsets = ["tpidr_el0","tpidrro_el0","tpidr_el1"].map(name=>cpu.state_base+STATE_OFFSETS[name]);
    offsets.forEach((at,i)=>new DataView(cpu.wasm_memory.buffer).setUint32(at+4,0xAABBCC00+i,true));
    const run = cpu.run_cores.bind(cpu);
    cpu.run_cores = (...args)=>{
        const result = run(...args);
        const view = new DataView(cpu.wasm_memory.buffer);
        high_halves = offsets.map(at=>view.getUint32(at+4,true));
        return result;
    };
},timeout:30000});
assert.equal(got.status,"ok",got.text);
assert.equal(got.text,expected.text);
high_halves.forEach((value,i)=>assert.equal(value,0xAABBCC00+i,"PL1 write preserves high half"));
assert.ok(got.page_tier.compiled>0,"identity mapping reaches the native page tier");
console.log("PASS: hot ARM/Thumb PL1 thread IDs, all three registers and false conditions match QEMU");
