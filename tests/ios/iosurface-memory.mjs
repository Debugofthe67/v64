// Exercise the real EL0 MMU/backdoor, not just a fake translation callback.
// IOSurface DRAM may have Device attributes; MMIO and read-only mappings
// must still fail before taking any bytes from the graphics service.
import assert from "node:assert/strict";
import fs from "node:fs";
import { build32, actual32, root } from "../a32/runner.mjs";
import { BackdoorA32 } from "../../src/arm/backdoor_a32.js";
const dir = root + "build/ios/iosurface-memory/";fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(dir + "memory.c", `#include <a32.h>
#include <stdio.h>
static unsigned l1[4096] __attribute__((aligned(16384)));
extern unsigned run_user(void (*fn)(void),unsigned arg); extern char user_returned[];
static int hook(struct a32_frame *f,int kind) {
    if(kind==A32_SVC) { f->pc=(unsigned)user_returned; f->cpsr=0x1d3; return 1; } return 0;
}
__attribute__((naked)) static void read_pixels(void) {
    __asm__("mov r1,r0\\nmovw r0,#3\\nmovt r0,#0x8664\\nmov r2,#4\\nmov r3,#1\\n.word 0xe7f866f4\\nsvc #0xff");
}
int main(int argc,char **argv) {
    a32_exception_hook=hook;
    for(unsigned i=0x400;i<0x480;i++) l1[i]=(i<<20)|(3<<10)|(1<<12)|12|2;
    l1[0x800]=0x41000000|(3<<10)|(1<<12)|12|2;
    l1[0x801]=0x41000000|(3<<10)|4|2;
    l1[0x802]=0x41000000|(3<<10)|2;
    l1[0x803]=0x41000000|(2<<10)|(1<<15)|4|2;
    l1[0x804]=0x09000000|(3<<10)|4|2;
    l1[0x805]=0x70000000|(3<<10)|4|2;
    a32_mcr(0,c2,c0,0,(unsigned)l1); a32_mcr(0,c2,c0,2,0); a32_mcr(0,c3,c0,0,1);
    a32_dsb(); a32_mcr(0,c8,c7,0,0); a32_mcr(0,c1,c0,0,a32_mrc(0,c1,c0,0)|1); a32_isb();
    int failed=0;for(unsigned i=0;i<6;i++) {
        int n=(int)run_user(read_pixels,0x80000000+i*0x100000);
        if(n!=(i<3?4:-1)) failed|=1<<i;
    }
    unsigned pixel=*(volatile unsigned *)0x41000000;
    a32_mcr(0,c1,c0,0,a32_mrc(0,c1,c0,0)&~1u);a32_isb();
    if(failed||pixel!=0x44332211) {printf("failed=%x pixel=%x\\n",failed,pixel);return 1;}
    puts("normal/device/strongly ordered RAM receive pixels; RO/MMIO/hole reject");return 0;
}`);
const binary = build32("iosurface-memory", [dir + "memory.c", root + "tests/a32/system_asm.S"]);
let reads = 0;
const result = await actual32(binary, { setup: cpu => {
    const backdoor = cpu.devices.backdoor = new BackdoorA32(cpu, () => null);
    backdoor.connections.set(1, { name: "fixture", service: {
        available: () => true, read: () => { reads++;return new Uint8Array([0x11,0x22,0x33,0x44]); }, close() {},
    } });
} });
assert.equal(result.status, "ok", result.text);
assert.match(result.text, /RO\/MMIO\/hole reject/);
assert.equal(reads, 3, "failed mappings do not consume GPU output");
console.log("PASS: native EL0 readback to uncached IOSurface RAM preserves MMU permissions and excludes MMIO");
