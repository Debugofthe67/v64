#!/usr/bin/env node
import assert from 'node:assert/strict';
import {NVDMA} from '../../src/graphics_adapters/geforce_6800/nv_dma.js';
import {NV40State} from '../../src/graphics_adapters/geforce_6800/nv40_state.js';
const memory=new Uint8Array(2<<20),view=new DataView(memory.buffer),ramin=1<<20;
const device={vram_size:memory.length,vram:()=>memory,machine:{is_bus_master:()=>true}};device.dma=new NVDMA(device);
const state=new NV40State(device),o={methods:new Map([[0x19C,0x10],[0x1680,0x5013]])};
view.setUint32(ramin+0x100,0x303D,true);view.setUint32(ramin+0x104,ramin-1,true);view.setUint32(ramin+0x108,3,true);
for(let i=0;i<4096;i++)memory[0x5000+i]=i*37+11;
const read=device.dma.read.bind(device.dma);let reads=0;device.dma.read=(...args)=>{reads++;return read(...args);};
for(let size=1;size<=4;size++)for(const stride of [1,7,16,31])for(const base of [-1,0,1])
{
    o.methods.set(0x1740,stride<<8|size<<4|2);o.methods.set(0x173C,base>>>0);
    const indices=Array.from({length:15},(_,i)=>[5,2,5,1,7][i%5]),expected=new Uint32Array(indices.length*4);
    for(let v=0;v<indices.length;v++)
    {
        expected[v*4+3]=0x3F800000;
        for(let c=0;c<size;c++)expected[v*4+c]=view.getUint32(0x5013+(indices[v]+base)*stride+c*4,true);
    }
    reads=0;const actual=state.array_vertices(o,indices,[[0,[1,0]]]);
    assert.deepEqual(new Uint32Array(actual.bytes.buffer),expected,'unaligned overlapping float records keep raw bits and defaults');
    assert.equal(reads,1,'one bounded linear VRAM float span replaces per-vertex DMA copies');
}
// Negative zero, NaN payload and infinities must remain DWORD-identical.
const special=[0x80000000,0x7FC01234,0xFF800000,0x7F800000];
for(let i=0;i<4;i++)view.setUint32(0x5013+i*4,special[i],true);
o.methods.set(0x1740,0x1042);o.methods.delete(0x173C);
assert.deepEqual([...new Uint32Array(state.array_vertices(o,[0],[[0,[1,0]]]).bytes.buffer)],special);
assert.throws(()=>state.array_vertices(o,[0,-1],[[0,[1,0]]]),/index/);
// The coalesced path still uses the original inclusive limit and read access.
const before=memory.slice(0x5000,0x5050);
view.setUint32(ramin+0x104,0x5031,true);
assert.throws(()=>state.array_vertices(o,[0,1],[[0,[1,0]]]),/limit/);
view.setUint32(ramin+0x104,ramin-1,true);view.setUint32(ramin+0x100,0xB03D,true);
assert.throws(()=>state.array_vertices(o,[0,1],[[0,[1,0]]]),/access denied/);
assert.deepEqual(memory.slice(0x5000,0x5050),before);
view.setUint32(ramin+0x100,0x303D,true);
// Sparse ranges must not allocate/copy all intervening bytes.
o.methods.set(0x1680,0x1000);o.methods.set(0x1740,0x822);reads=0;
state.array_vertices(o,[0,8192],[[0,[1,0]]]);assert.equal(reads,2);
// A legal paged draw skips an absent intermediate page. A bounding-span
// read would fault; retain checked individual fetches for paged DMA.
view.setUint32(ramin+0x200,0x103D,true);view.setUint32(ramin+0x204,0x2FFF,true);
view.setUint32(ramin+0x208,0x4001,true);view.setUint32(ramin+0x20C,0,true);view.setUint32(ramin+0x210,0x6001,true);
o.methods.set(0x19C,0x20);o.methods.set(0x1680,0);
const paged=state.dma(o,0x19C),indices=[...Array.from({length:256},(_,i)=>i),1024];
assert.throws(()=>device.dma.read(paged,0,8200),/page access/);
reads=0;const actual=state.array_vertices(o,indices,[[0,[1,0]]]);assert.equal(reads,257);
for(let v=0;v<indices.length;v++)for(let c=0;c<2;c++)
{
    const at=(indices[v]<512?0x4000+indices[v]*8:0x6000+(indices[v]-1024)*8)+c*4;
    assert.equal(new DataView(actual.bytes.buffer).getUint32(v*16+c*4,true),view.getUint32(at,true));
}
// Linear system memory also keeps per-access physical-page validation.
view.setUint32(ramin+0x200,0x2303D,true);view.setUint32(ramin+0x208,0x1003,true);
const ram=new Uint8Array(0x5000);let physicalReads=0;
device.machine.validate_physical_range=(at,n)=>{if(!(at>=0x1000&&at+n<=0x2000||at>=0x3000&&at+n<=0x4000))throw new RangeError('physical hole');};
device.machine.read_physical=(at,n)=>{physicalReads++;return ram.slice(at,at+n);};
state.array_vertices(o,indices,[[0,[1,0]]]);assert.equal(physicalReads,257);
console.log('PASS: bounded linear VRAM float spans, bit payloads, sparse fallback and paged/system holes');
