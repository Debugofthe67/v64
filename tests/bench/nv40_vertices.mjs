#!/usr/bin/env node
// Checked vertex/index expansion CPU work, not native FPS. Alternate order
// after warmup; optional baseline is a saved pre-change NV40State module.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {pathToFileURL} from "node:url";
import {createHash} from "node:crypto";
import {NVDMA} from "../../src/graphics_adapters/geforce_6800/nv_dma.js";
const sources=[...(process.env.NV_VERTEX_BASELINE?[path.resolve(process.env.NV_VERTEX_BASELINE)]:[]),path.resolve("src/graphics_adapters/geforce_6800/nv40_state.js")];
const implementations=[];
for(const source of sources)
{
    const {NV40State}=await import(pathToFileURL(source));
    const memory=new Uint8Array(8<<20),view=new DataView(memory.buffer),ramin=7<<20;
    for(let i=0;i<3<<20;i++)memory[i]=i*37+11;
    view.setUint32(ramin+0x100,0x303D,true);view.setUint32(ramin+0x104,ramin-1,true);view.setUint32(ramin+0x108,3,true);
    const device={vram_size:memory.length,vram:()=>memory,machine:{is_bus_master:()=>true}};device.dma=new NVDMA(device);
    const state=new NV40State(device),object={methods:new Map([[0x19C,0x10],[0x1740,0x1842],[0x1680,0x10000],[0x174C,0x1840],[0x168C,0x10010],[0x1C90,0x3EAAAAAB],[0x181C,3<<20]])};
    for(let i=0;i<131072;i++)view.setUint32((3<<20)+i*4,i*193&65535,true);
    implementations.push({source,state,object,sourceSHA256:createHash("sha256").update(fs.readFileSync(source)).digest("hex")});
}
const inputs=[[0,[1,0]],[3,[1,1]],[9,[1,2]]],indices=Array.from({length:32768},(_,i)=>i*7&8191),inline=Array.from({length:8192*4},(_,i)=>i*31337>>>0);
const cases=[
    {name:"indices16",run:item=>{item.object.methods.set(0x1820,0x10);return item.state.indices(item.object,0,131072);}},
    {name:"indices32",run:item=>{item.object.methods.set(0x1820,0);return item.state.indices(item.object,0,131072);}},
    {name:"indexed-float-color-current",run:item=>item.state.array_vertices(item.object,indices,inputs)},
    {name:"inline-float-current",run:item=>{const o={methods:new Map([[0x1740,0x42],[0x1C90,0x3EAAAAAB]])};return item.state.inline_vertices(o,inline,[[0,[1,0]],[9,[1,1]]]);}}
];
const rounds=7,iterations=8,results=[];
const bytes=value=>Array.isArray(value)?new Uint8Array(Uint32Array.from(value).buffer):value.bytes;
for(const test of cases)
{
    const expected=test.run(implementations[0]);
    for(const item of implementations)assert.deepEqual(test.run(item),expected);
    const entry={scenario:test.name,resultBytes:bytes(expected).length,resultSHA256:createHash("sha256").update(bytes(expected)).digest("hex"),implementations:implementations.map(item=>({source:item.source,sourceSHA256:item.sourceSHA256,rounds:[]}))};results.push(entry);
    for(const item of implementations) for(let i=0;i<8;i++)test.run(item);
    for(let round=0;round<rounds;round++) for(const index of round&1?implementations.map((_,i)=>i).reverse():implementations.map((_,i)=>i))
    {
        const item=implementations[index];globalThis.gc?.();
        const cpu=process.cpuUsage(),start=performance.now();let result;
        for(let i=0;i<iterations;i++)result=test.run(item);
        const wallMs=performance.now()-start,nodeCpuUs=process.cpuUsage(cpu);
        assert.deepEqual(result,expected);entry.implementations[index].rounds.push({wallMs,nodeCpuUs});
    }
    for(const item of entry.implementations){const times=item.rounds.map(row=>row.nodeCpuUs.user+row.nodeCpuUs.system).sort((a,b)=>a-b);item.medianNodeCpuMs=times[times.length>>>1]/1000;}
}
console.log(JSON.stringify({scope:"Interleaved checked CPU expansion microbenchmark; concurrent host; no native FPS claim",rounds,iterations,results},null,2));
