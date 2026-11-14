#!/usr/bin/env node
// Exercise real ATA ports and the real8259 PIC, without executing a guest.
// A synchronously completed command must retain its new INTRQ until status
// acknowledgement, including when firmware/OS routes the line as level IRQ.
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const {V86}=await import(+process.env.TEST_RELEASE_BUILD?'../../build/libv86.mjs':'../../src/main.js');
const disk=new Uint8Array(1<<20);disk[0]=0x5a;
const vm=new V86({graphics_adapter:'none',bios:{url:fileURLToPath(new URL('../../bios/seabios.bin',import.meta.url))},
    ...(process.env.TEST_WASM?{wasm_path:process.env.TEST_WASM}:{}),hda:{buffer:disk.buffer},cdrom:{buffer:new ArrayBuffer(64<<10)},memory_size:16<<20,autostart:false,log_level:0});
try{
 await new Promise(resolve=>vm.add_listener('emulator-ready',resolve));
 const cpu=vm.v86.cpu,io=cpu.io,api=cpu.wm.exports;
 assert.equal(typeof api.machine_io_write8,'function','rebuild the CPU Wasm to include native PIC I/O');
 const w=(p,v)=>api.machine_io_write8(p,v),r=p=>api.machine_io_read8(p);
 for(const level of [true,false])for(const [base,control,bit,identify]of[[0x1f0,0x3f6,0x40,0xec],[0x170,0x376,0x80,0xa1]]){
  // Initialise both controllers, with their cascade and IRQ14/15 unmasked.
  w(0x20,0x11);w(0x21,0x20);w(0x21,4);w(0x21,1);w(0x21,0xfb);
  w(0xa0,0x11);w(0xa1,0x28);w(0xa1,2);w(0xa1,1);w(0xa1,~bit&255);
  w(0x4d1,level?bit:0);w(control,0);w(base+6,0xa0);
  const pending=()=>{w(0xa0,0x0a);return r(0xa0)&bit;};
  for(const cmd of [identify,0xe7,0xff]){
   w(base+7,cmd);
   assert.equal(pending(),bit,`command${cmd.toString(16)} ${level?'level':'edge'} IRQ remains pending`);
   const status=r(control);assert.equal(pending(),bit,'alternate status does not acknowledge completion');
   assert.equal(r(base+7),status,'regular status returns the same task-file status');
   if(level)assert.equal(pending(),0,'regular status deasserts the level request');
   // Drain an IDENTIFY block before the next command. Neither the media
   // payload nor command status may be changed by the interrupt ordering.
   if(cmd===identify)for(let i=0;i<256;i++)io.port_read16(base);
  }
  if(base===0x1f0){
   w(base+2,1);w(base+3,0);w(base+4,0);w(base+5,0);w(base+6,0xe0);w(base+7,0x20);
   assert.equal(pending(),bit,'synchronous PIO backend retains data-ready IRQ');
   r(base+7);assert.equal(io.port_read16(base),0x5a,'PIO payload unchanged');
   for(let i=1;i<256;i++)io.port_read16(base);
  }
  w(control,2);w(base+7,identify);if(level)assert.equal(pending(),0,'nIEN suppresses new assertions');
 }
 console.log('PASS: synchronous ATA/ATAPI completion, errors and PIO retain PIC IRQ; alternate/regular status and nIEN semantics');
}finally{await vm.destroy();}
