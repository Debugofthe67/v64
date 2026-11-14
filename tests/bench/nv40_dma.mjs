#!/usr/bin/env node
// Synthetic checked VRAM copies, not guest FPS or isolated performance.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {pathToFileURL} from "node:url";
import {createHash} from "node:crypto";
const current=path.resolve("src/graphics_adapters/geforce_6800/nv_dma.js");
const baseline=process.env.NV_DMA_BASELINE && path.resolve(process.env.NV_DMA_BASELINE);
const modules=[...(baseline?[baseline]:[]),current],results=[],cases=[];
const size=4<<20,iterations=256,offset=0xFFF,base=0x10000;
const hash=bytes=>createHash("sha256").update(bytes).digest("hex");
for(const filename of modules)
{
    const {NVDMA}=await import(pathToFileURL(filename));
    const vram=new Uint8Array(16<<20),start=base+15+offset;
    for(let i=0;i<size;i++)vram[start+i]=i*13+7;
    const expected=hash(vram.subarray(start,start+size));
    const device={vram_size:vram.length,vram:()=>vram,machine:{is_bus_master:()=>false}};
    const engine=new NVDMA(device),view=new DataView(vram.buffer),ramin=vram.length-(1<<20);
    view.setUint32(ramin+0x100,0xF0303D,true);view.setUint32(ramin+0x104,offset+size-1,true);view.setUint32(ramin+0x108,base|2,true);
    const descriptor=engine.descriptor(0x100),ranges=engine.ranges.bind(engine);let spans=0;
    engine.ranges=(...args)=>{const result=ranges(...args);spans+=result.length;return result;};
    const entry={source:filename,sourceSHA256:hash(fs.readFileSync(filename)),rounds:[]};results.push(entry);
    cases.push({engine,descriptor,vram,start,expected,entry,reset:()=>{spans=0;},spans:()=>spans});
    for(let i=0;i<8;i++)engine.read(descriptor,offset,size);
}
for(let round=0;round<4;round++) for(const item of (round&1?cases.slice().reverse():cases))
{
    global.gc?.();item.reset();const cpu=process.cpuUsage(),before=performance.now();let bytes;
    for(let i=0;i<iterations;i++)bytes=item.engine.read(item.descriptor,offset,size);
    const wallMs=performance.now()-before,nodeCpuUs=process.cpuUsage(cpu);
    assert.equal(hash(bytes),item.expected);assert.equal(hash(item.vram.subarray(item.start,item.start+size)),item.expected);
    item.entry.rounds.push({round,wallMs,nodeCpuUs,copiedBytes:size*iterations,spans:item.spans(),lastCopySHA256:hash(bytes)});
}
console.log(JSON.stringify({scope:"Concurrent host synthetic checked linear-VRAM copies; warmed/interleaved order; no native FPS claim",size,iterations,results},null,2));
