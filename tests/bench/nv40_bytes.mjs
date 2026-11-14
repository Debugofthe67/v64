// Native attachment-sized exact comparisons, not guest FPS. Run separately
// from native performance gates; order alternates to reduce warm-up bias.
import assert from "node:assert/strict";
import {nv40_changed_bytes} from "../../src/graphics_adapters/geforce_6800/nv40_render.js";
const bytes=4<<20,iterations=32,rounds=7;
function baseline(a,b)
{
    if(a===b)return null;
    if(!a||a.length!==b.length)return[0,b.length];
    const n=a.length>>>2,aw=new Uint32Array(a.buffer,a.byteOffset,n),bw=new Uint32Array(b.buffer,b.byteOffset,n);
    let first=0;while(first<n&&aw[first]===bw[first])first++;
    first*=4;while(first<b.length&&a[first]===b[first])first++;
    if(first===b.length)return null;
    let last=b.length;while(last>first&&a[last-1]===b[last-1])last--;
    return[first,last];
}
const implementations={baseline,grouped:nv40_changed_bytes},results=[];
let guard=0;
for(const scenario of ["first-byte","middle-byte","last-byte","whole-image","unchanged"])
{
    const a=new Uint8Array(bytes),b=new Uint8Array(bytes);
    if(scenario==="whole-image")b.fill(255);
    else if(scenario!=="unchanged")b[scenario==="first-byte"?0:scenario==="middle-byte"?bytes>>>1:bytes-1]=1;
    const expected=baseline(a,b);assert.deepEqual(nv40_changed_bytes(a,b),expected);
    for(const fn of Object.values(implementations))for(let i=0;i<32;i++)fn(a,b);
    await new Promise(resolve=>setImmediate(resolve));
    const timings={baseline:[],grouped:[]};
    for(let round=0;round<rounds;round++)
        for(const name of round&1?["grouped","baseline"]:["baseline","grouped"])
        {
            const fn=implementations[name],start=performance.now();
            for(let i=0;i<iterations;i++){const changed=fn(a,b);guard^=changed?changed[0]^changed[1]:0;}
            timings[name].push(performance.now()-start);
        }
    const median=values=>values.slice().sort((a,b)=>a-b)[values.length>>>1];
    results.push({scenario,bytes,iterations,rounds,expected,timings,
        medianMilliseconds:{baseline:median(timings.baseline),grouped:median(timings.grouped)},
        speedup:median(timings.baseline)/median(timings.grouped)});
}
console.log(JSON.stringify({scope:"Exact CPU byte-comparison microbenchmark; no native FPS claim",guard,results},null,2));
