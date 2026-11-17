#!/usr/bin/env node
import assert from "node:assert/strict";
import { NVVideo } from "../../src/graphics_adapters/geforce_6800/nv_video.js";

const vram=new Uint8Array(4096),registers=new Map();let irqs=0;
const device={vram_size:vram.length,registers,update_irq(){irqs++;}};
let video=new NVVideo(device);
function write(at,value){registers.set(at,value>>>0);video.written(at,value>>>0);}
function buffer(index,at=0x100,format=0x10004)
{
    const put=(reg,value)=>write(reg+4*index,value);
    put(0x8900,0);put(0x8908,4095);put(0x8910,0x1000);put(0x8918,0x1000);
    put(0x8920,at);put(0x8928,0x10002);put(0x8930,0);put(0x8938,1<<20);put(0x8940,1<<20);
    put(0x8948,0);put(0x8950,0x10002);put(0x8958,format);
}
vram.set([16,128,235,128],0x100);buffer(0);write(0x8700,1);
const out=new Uint8Array(8);out.fill(77);
video.render(out,vram,2,1);assert.deepEqual([...out],Array(8).fill(77),"queued overlay does not appear before vblank");
assert.equal(video.read(0x8700),1);assert.equal(irqs,0,"a doorbell cannot report completion");
// The descriptor is latched by the doorbell. Editing it cannot redirect an
// already submitted buffer or turn its completion into an unrelated transfer.
write(0x8920,4000);video.on_vblank();video.render(out,vram,2,1);
assert.deepEqual([...out],[0,0,0,255,255,255,255,255]);
assert.equal(video.read(0x8700),0);assert.equal(registers.get(0x8100),1);assert.equal(irqs,1);
video.on_vblank();assert.equal(irqs,1,"completed buffers do not generate repeated interrupts");

vram.set([128,235,128,16],0x200);buffer(1,0x200,4);write(0x8700,16);
const saved=structuredClone(video.get_state());video=new NVVideo(device);video.set_state(saved);
video.render(out,vram,2,1);assert.equal(out[0],0,"snapshot keeps the old active plane while the next buffer waits");
video.on_vblank();video.render(out,vram,2,1);
assert.deepEqual([...out],[255,255,255,255,0,0,0,255]);
assert.equal(registers.get(0x8100),0x11,"legacy buffer interrupts have independent bits 0 and 4");

// Display color key, signed destination clipping and source stride bounds.
buffer(0);write(0x8958,0x110004);write(0x8B00,0x010203);write(0x8700,1);video.on_vblank();
out.set([1,2,3,255,4,5,6,255]);video.render(out,vram,2,1);
assert.deepEqual([...out],[0,0,0,255,4,5,6,255],"the color key gates the overlay without altering other scanout pixels");
out.set([99,98,97,255,4,5,6,255]);video.render(out,vram,2,1,new Uint32Array([0x010203,0]));
assert.deepEqual([...out],[0,0,0,255,4,5,6,255],"key matching uses the primary plane before display gamma");
buffer(0);write(0x8948,0xFFFF);write(0x8700,1);video.on_vblank();out.fill(88);video.render(out,vram,2,1);
assert.deepEqual([...out],[255,255,255,255,88,88,88,88]);
const before=vram.slice(),count=irqs,status=registers.get(0x8100);
buffer(1,4094);write(0x8700,16);video.on_vblank();
assert.equal(video.read(0x8700),16,"an out-of-range buffer remains uncompleted");
assert.equal(irqs,count);assert.equal(registers.get(0x8100),status);assert.deepEqual(vram,before);
assert.match(video.faults.at(-1),/bounds/);
buffer(1,0x200,0x10005);write(0x8700,16);video.on_vblank();
assert.equal(irqs,count,"unsupported planar data cannot produce a successful packed-buffer notification");
assert.match(video.faults.at(-1),/format/);

write(0x8704,1);video.on_vblank();out.fill(99);video.render(out,vram,2,1);
assert.deepEqual([...out],Array(8).fill(99));assert.equal(video.read(0x8700),0);
// Pre-PVIDEO snapshots retained raw register requests. Migrate those requests,
// then complete them by the same vblank path as a new MMIO doorbell.
write(0x8704,0);buffer(0);registers.set(0x8700,1);video.set_state(null);
assert.equal(video.read(0x8700),1);video.on_vblank();assert.equal(video.read(0x8700),0);
// NV30/NV40 schedules offset changes against a wrapping retrace counter.
// Publishing an offset is not a completion; only the selected retrace can
// consume it and cause the miniport's counter notification interrupt.
registers.set(0x8100,0);write(0x8B08,0x10000000);
let counterState=structuredClone(video.get_state());counterState[3]=4094;counterState[4]=14;
video.set_state(counterState);write(0x8B10,0x100);write(0x8B0C,0x10001);
assert.equal(video.commands.length,1);assert.equal(registers.get(0x8100),0);
video.on_vblank();assert.equal(video.read(0x8B08)&4095,4095);assert.equal(registers.get(0x8100),0);
counterState=structuredClone(video.get_state());video=new NVVideo(device);video.set_state(counterState);
video.on_vblank();assert.equal(video.read(0x8B08)&4095,0);assert.equal(registers.get(0x8100),0);
video.on_vblank();assert.equal(video.read(0x8B08)&4095,1);
assert.equal(video.read(0x8B08)>>>16&15,15);assert.equal(registers.get(0x8100),0x100);
assert.equal(video.commands.length,0);assert.deepEqual(vram,before,"counter completion never fabricates a guest DMA notifier");
write(0x8B08,0x10000ABC);assert.equal(video.read(0x8B08)&4095,1,"software cannot overwrite the hardware counter");
write(0x8B0C,0x10002);
assert.equal(video.read(0x8B08)&0x1000000,0x1000000,"an unconsumed offset makes the hardware slot busy");
write(0x8B0C,0x10100);assert.equal(video.commands.length,1,"a busy hardware slot cannot overwrite an earlier offset transfer");
video.on_vblank();assert.equal(video.read(0x8B08)>>>16&15,0,"consumer index wraps independently of the 12-bit retrace counter");
assert.equal(video.commands.length,0);assert.equal(video.read(0x8B08)&0x1000000,0);
counterState=structuredClone(video.get_state());counterState[3]=20;counterState[5]=[];video.set_state(counterState);
write(0x8B0C,0x10013);video.on_vblank();
assert.equal(video.commands.length,0,"an offset submitted after its retrace deadline completes on the next retrace");
write(0x8B0C,0x10017);video.on_vblank();assert.equal(video.commands.length,1,"a future deadline does not complete early");
video.on_vblank();assert.equal(video.commands.length,0);
assert.equal(video.read(0x8B04)>>>16&4095,video.read(0x8B08)&4095,"display and scheduler counter samples share the retrace phase");
write(0x8B08,0);const clock=video.read(0x8B04)>>>16&4095;video.on_vblank();
assert.equal(video.read(0x8B04)>>>16&4095,(clock+1)&4095,"the display clock continues when offset scheduling is disabled");
write(0x8B04,0x0FFF0000);assert.equal(video.read(0x8B04)>>>16&4095,(clock+1)&4095,"the display counter is read only");
console.log("PASS: NV40 PVIDEO vblank latching, both YUV orders, clipping/keying, snapshots and checked completions");
