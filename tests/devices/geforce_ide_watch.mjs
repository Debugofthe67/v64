import assert from "node:assert/strict";
import {watch_geforce_ide_reads} from "../lib/geforce_ide_watch.mjs";
class CPU{
    constructor(){this.mem8=new Uint8Array(256);this.instruction_pointer=Uint32Array.of(0x1234);}
    write_blob_physical(bytes,address){if(address+bytes.length>256) throw failure;this.mem8.set(bytes,address);return 7;}
}
class Disk{
    constructor(){this.byteLength=1024;this.pending=[];}
    get(start,size,done,options){this.pending.push({start,size,done,options});return 9;}
    finish(index,data,error){this.pending[index].done(data,error);}
}
const failure=new RangeError("original DMA fault"),cpu=new CPU(),other=new CPU(),disk=new Disk(),records=[];
const original=CPU.prototype.write_blob_physical,get=disk.get;
const observer=watch_geforce_ide_reads(cpu,disk,100,200,row=>records.push(row));
const source=Uint8Array.from({length:16},(_,i)=>i),signal={signal:"retained"};let called=0;
assert.equal(disk.get(100,16,(data,error)=>{
    called++;assert.equal(data,source,"retain the original callback buffer");assert.equal(error,undefined);
    assert.equal(cpu.write_blob_physical(data.subarray(0,8),32),7);
    other.write_blob_physical(data,64); // another CPU must never be attributed
    // A nested source callback must restore the outer transfer's byte cursor.
    disk.get(200,4,inner=>cpu.write_blob_physical(inner,80));disk.finish(1,Uint8Array.of(9,8,7,6));
    cpu.write_blob_physical(data.subarray(8),40);
},signal),9);
assert.equal(disk.pending[0].options,signal);disk.finish(0,source);
assert.equal(called,1);assert.deepEqual([...cpu.mem8.subarray(32,48)],[...source]);
const copies=records.filter(r=>r.kind==="dma");
assert.deepEqual(copies.map(r=>[r.start,r.address,r.bytes]),[[100,32,8],[200,80,4],[108,40,8]]);
assert(copies.every(r=>r.match),"post-DMA RAM equals its source");
let received;
disk.get(100,4,(data,error)=>received=error);disk.finish(2,undefined,failure);assert.equal(received,failure);
disk.get(100,4,data=>cpu.write_blob_physical(data,255));assert.throws(()=>disk.finish(3,source),error=>error===failure);
const count=records.length;cpu.write_blob_physical(source,100);assert.equal(records.length,count,"scope restored after a throw");
observer.close();observer.close();assert.equal(CPU.prototype.write_blob_physical,original);assert.equal(disk.get,get);
assert(!Object.hasOwn(disk,"get"),"restore inherited methods without a new own property");
assert.throws(()=>watch_geforce_ide_reads(cpu,disk,1000,25,()=>{}),/range/);
const noisy=watch_geforce_ide_reads(cpu,disk,100,200,()=>{throw new Error("host output unavailable");});
disk.get(100,16,data=>cpu.write_blob_physical(data,120));disk.finish(4,source);
assert.deepEqual([...cpu.mem8.subarray(120,136)],[...source],"logging failure must not become a guest DMA failure");
assert.equal(noisy.stats.loggingErrors,2);noisy.close();
console.log("PASS: read-only IDE observation preserves asynchronous/nested callbacks,DMA bytes,errors,other CPUs and hook cleanup");
