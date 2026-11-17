// Real A32 EL0 short descriptors: aligned Device DRAM may execute in the
// page function, without making a cache entry that could bypass alignment.
import assert from "node:assert/strict";
import fs from "node:fs";
import { build32, actual32, root } from "../a32/runner.mjs";
import { BackdoorA32 } from "../../src/arm/backdoor_a32.js";
const dir=root+"build/ios/uncached-jit/";fs.mkdirSync(dir,{recursive:true});
fs.writeFileSync(dir+"memory.c",`#include <a32.h>
#include <stdio.h>
static unsigned l1[4096] __attribute__((aligned(16384)));
extern unsigned run_user(void (*fn)(void),unsigned arg);extern char user_returned[];
static int hook(struct a32_frame *f,int kind){
 if(kind==A32_SVC||kind==A32_DABT){if(kind==A32_DABT)f->r[0]=0xdead;f->pc=(unsigned)user_returned;f->cpsr=0x1d3;return 1;}return 0;
}
__attribute__((naked)) static void increment(void){__asm__(
 "mov r1,#128\\n1: ldr r2,[r0]\\nadd r2,r2,#1\\nstr r2,[r0]\\nsubs r1,r1,#1\\nbne 1b\\nmov r0,r2\\nsvc #0xff");}
__attribute__((naked)) static void probe(void){__asm__(
 "movw r0,#3\\nmovt r0,#0x8664\\nmov r1,#0x80000000\\nmov r2,#4\\nmov r3,#1\\n.word 0xe7f866f4\\nsvc #0xff");}
__attribute__((naked)) static void probe_reserved(void){__asm__(
 "mov r4,#0x80000000\\nldrex r5,[r4]\\nmovw r0,#3\\nmovt r0,#0x8664\\nmov r1,r4\\nmov r2,#4\\nmov r3,#1\\n.word 0xe7f866f4\\nclrex\\nsvc #0xff");}
int main(int argc,char **argv){
 a32_exception_hook=hook;
 for(unsigned i=0x400;i<0x480;i++)l1[i]=(i<<20)|(3<<10)|(1<<12)|12|2;
 l1[0x800]=0x41000000|(3<<10)|(1<<12)|12|2;
 l1[0x801]=0x41000000|(3<<10)|4|2;
 l1[0x802]=0x41000000|(3<<10)|2;
 l1[0x803]=0x41000000|(2<<10)|(1<<15)|4|2;
 l1[0x804]=0x09000000|(3<<10)|4|2;
 l1[0x805]=0x70000000|(3<<10)|4|2;
 l1[0x806]=0x40000000|(3<<10)|4|2;
 a32_mcr(0,c2,c0,0,(unsigned)l1);a32_mcr(0,c2,c0,2,0);a32_mcr(0,c3,c0,0,1);
 a32_dsb();a32_mcr(0,c8,c7,0,0);a32_mcr(0,c1,c0,0,a32_mrc(0,c1,c0,0)|1);a32_isb();
 for(unsigned i=0;i<3;i++){
  *(volatile unsigned *)0x41000000=9;
  if(run_user(increment,0x80000000+i*0x100000)!=137)return 1;
 }
 if(run_user(increment,0x80100001)!=0xdead||run_user(increment,0x80200001)!=0xdead||run_user(increment,0x80300000)!=0xdead)return 2;
 if(run_user(probe,0)!=4)return 3;
 if(run_user(probe_reserved,0)!=4)return 4;
 a32_mcr(0,c1,c0,0,a32_mrc(0,c1,c0,0)&~1u);a32_isb();
 puts("uncached DRAM executes; Device alignment and permissions still fault");return 0;
}`);
const binary=build32("uncached-jit",[dir+"memory.c",root+"tests/a32/system_asm.S"]);
process.env.A64_JIT="1";process.env.A64_JIT_HOT="1";process.env.A64_JIT_SWITCHES="a64_page_aarch32=1";
let probes=0,cpu_ref;
const result=await actual32(binary,{cores:2,setup:cpu=>{
 const ex=cpu.wm.exports;
 cpu_ref=cpu;
 const backdoor=cpu.devices.backdoor=new BackdoorA32(cpu,()=>null);
 backdoor.connections.set(1,{name:"fixture",service:{available:()=>true,close(){},read:()=>{
  probes++;
  if(probes===2){
   for(const address of [0x80100000,0x80200000])
    assert.equal(ex.a64_page_access(BigInt(address),0x104),0,"normal-alias LDREX protects Device-alias writes");
   return new Uint8Array([1,2,3,4]);
  }
  for(const address of [0x80100000,0x80200000]){
   const fills=ex.a64_page_stat(7);
   for(let i=0;i<8;i++){
    assert.ok(ex.a64_page_access(BigInt(address),4),"aligned uncached read");
    assert.ok(ex.a64_page_access(BigInt(address),0x104),"aligned uncached store");
    assert.equal(ex.a64_page_access(BigInt(address+1),4),0,"later unaligned access cannot hit an entry");
   }
   assert.equal(ex.a64_page_stat(7),fills,"Device RAM never fills the access cache");
   for(const size of [1,2,8,16]){
    assert.ok(ex.a64_page_access(BigInt(address),size),"aligned uncached read width "+size);
    assert.ok(ex.a64_page_access(BigInt(address),0x100|size),"aligned uncached store width "+size);
    if(size>1)assert.equal(ex.a64_page_access(BigInt(address+1),size),0,"Device alignment for width "+size);
   }
  }
  assert.ok(ex.a64_page_access(0x80300000n,4),"read-only mapping still permits reads");
  for(const address of [0x80300000,0x80400000,0x80500000,0x80610000])
   assert.equal(ex.a64_page_access(BigInt(address),0x104),0,"RO/MMIO/hole/watched code cannot get a writable host pointer");
  return new Uint8Array([1,2,3,4]);
 }}});
}});
assert.equal(result.status,"ok",result.text);assert.equal(probes,2);
assert.ok(result.page_tier.compiled>0,"real page functions executed");
if(cpu_ref.wm.exports.a32_retried_word){
 const word=cpu_ref.wm.exports.a32_retried_word;let seen=false;
 for(let i=0;i<4096;i++)if(word(i,false)===0xE5902000&&word(i,true)>0)seen=true;
 assert.ok(seen,"AP retries report the actual faulting LDR, separately from page steps");
}
console.log("PASS: compiled uncached DRAM, widths 1/2/4/8/16, no Device cache entries, alignment/RO faults, MMIO/hole/code/reservation exclusion");
