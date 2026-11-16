#!/usr/bin/env node
// Checked native NV texture reads, not a guest FPS or GPU timing benchmark.
//70 1024x1024 BC1 images:35MiB encoded,315MiB source+RGBA working set.
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {NVDMA} from "../../src/graphics_adapters/geforce_6800/nv_dma.js";
import {NV2D} from "../../src/graphics_adapters/geforce_6800/nv_2d.js";
import {NV40State} from "../../src/graphics_adapters/geforce_6800/nv40_state.js";
import {NV40Texture} from "../../src/graphics_adapters/geforce_6800/nv40_texture.js";
const vram=new Uint8Array(128<<20),view=new DataView(vram.buffer),source=0x10000,count=70,encodedBytes=1024*1024/2;
const device={vram_size:vram.length,vram:()=>vram,machine:{is_bus_master:()=>true}};
device.dma=new NVDMA(device);device.graph={device};device.graph.engine2d=new NV2D(device.graph);
const ramin=vram.length-(1<<20);view.setUint32(ramin+0x100,0x303D,true);view.setUint32(ramin+0x104,ramin-1,true);view.setUint32(ramin+0x108,3,true);
for(let image=0;image<count;image++) for(let at=source+image*encodedBytes,end=at+encodedBytes;at<end;at+=8)
{
    view.setUint16(at,0xF800|image,true);view.setUint16(at+2,image,true);view.setUint32(at+4,0xE4E4E4E4^image,true);
}
const expected=createHash("sha256").update(vram.subarray(source,source+count*encodedBytes)).digest("hex"),results=[];
for(const compressed of [false,true])
{
    globalThis.gc?.();
    const textures=new NV40Texture(new NV40State(device));let blocks=0;
    const decode=textures.blocks.bind(textures);textures.blocks=(...args)=>{blocks++;return decode(...args);};
    const object={methods:new Map([[0x184,0x10],[0x1A04,0x10629],[0x1A08,0x30303],[0x1A0C,0x80000000],
        [0x1A10,0xAAE4],[0x1A14,0x01010000],[0x1A18,1024<<16|1024],[0x1840,0]])};
    const rounds=[];
    for(let round=0;round<3;round++)
    {
        const before={...textures.stats},beforeBlocks=blocks,start=performance.now();let returned=0,sample=0;
        for(let image=0;image<count;image++)
        {
            object.methods.set(0x1A00,source+image*encodedBytes);
            const bytes=textures.images(textures.describe(object,0,compressed))[0];returned+=bytes.length;
            sample=(Math.imul(sample,31)^bytes[0]^bytes[bytes.length-1])>>>0;
        }
        rounds.push({round,wallMs:performance.now()-start,returnedBytes:returned,sampleChecksum:sample,
            hits:textures.stats.hits-before.hits,misses:textures.stats.misses-before.misses,
            evictions:textures.stats.evictions-before.evictions,blockDecodes:blocks-beforeBlocks,residentBytes:textures.stats.bytes});
    }
    if(compressed)assert(rounds.every(r=>r.blockDecodes===0)&&rounds[1].hits===count&&rounds[1].evictions===0);
    else assert.equal(rounds[1].blockDecodes,count,"the RGBA working set exceeds the actual256MiB budget");
    results.push({mode:compressed?"enabled native BC":"CPU RGBA fallback",cacheLimit:textures.cache_limit,rounds});textures.clear();
}
assert.equal(createHash("sha256").update(vram.subarray(source,source+count*encodedBytes)).digest("hex"),expected);
console.log(JSON.stringify({scope:"Synthetic checked texture reads, concurrent host workloads; no GPU/guest FPS claim",count,width:1024,height:1024,
    sourceBytes:count*encodedBytes,sourceSHA256:expected,results},null,2));
