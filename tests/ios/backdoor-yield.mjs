// Empty native graphics reads must yield to the host event loop, where
// asynchronous GPU replies arrive. Never fake completion or enter guest WFI.
import assert from "node:assert/strict";
import fs from "node:fs";
import { build32, actual32, root } from "../a32/runner.mjs";
import { BackdoorA32 } from "../../src/arm/backdoor_a32.js";
const dir = root + "build/ios/backdoor-yield/";
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(dir + "yield.c", `#include <a32.h>
#include <stdio.h>
extern unsigned run_user(void (*fn)(void),unsigned arg);extern char user_returned[];
unsigned pixel, attempts;
static int hook(struct a32_frame *f,int kind) {
    if(kind==A32_SVC){f->pc=(unsigned)user_returned;f->cpsr=0x1d3;return 1;}return 0;
}
#ifdef TEST_THUMB
__attribute__((target("thumb")))
#endif
__attribute__((naked)) static void read_pixels(void) {
    __asm__("ldr r1,=pixel\\nldr r4,=attempts\\nmov r2,#4\\nmov r3,#1\\n"
        "1: movw r0,#3\\nmovt r0,#0x8664\\n"
#ifdef TEST_THUMB
        ".inst.w 0xf7f8a664\\n"
#else
        ".word 0xe7f866f4\\n"
#endif
        "ldr r5,[r4]\\nadd r5,r5,#1\\nstr r5,[r4]\\ncmn r0,#2\\nbeq 1b\\nsvc #0xff");
}
int main(int argc,char **argv) {
    a32_exception_hook=hook;run_user(read_pixels,0);
    if(attempts!=2||pixel!=0x44332211){printf("attempts=%u pixel=%x\\n",attempts,pixel);return 1;}
    puts("two real read attempts, one real payload");return 0;
}`);
for(const thumb of [false, true]) {
    const binary = build32("backdoor-yield-" + (thumb ? "thumb" : "arm"),
        [dir + "yield.c", root + "tests/a32/system_asm.S"], { cflags: thumb ? ["-DTEST_THUMB"] : [] });
    for(const jit of [false, true]) {
        let ready = false, empty = 0, reads = 0, yielded = 0;
        const result = await actual32(binary, { options: {
            jit_switches: { a64_page: +jit, a64_page_hot: 1, a64_page_aarch32: 1 }, ir_sync_publication: true,
        }, setup: cpu => {
            const backdoor = cpu.devices.backdoor = new BackdoorA32(cpu, () => null);
            backdoor.connections.set(1, { name: "generated-pixels", service: {
                available() { if(!ready) empty++;return ready; },
                read() { reads++;return new Uint8Array([0x11, 0x22, 0x33, 0x44]); },close() {},
            } });
            const original = cpu.run_cores;
            cpu.run_cores = function() {
                const before = empty, answer = original.call(this);
                if(empty !== before) {
                    assert.equal(empty - before, 1, "end the slice at the first empty read");
                    assert.equal(reads, 0, "the host has not delivered bytes yet");
                    assert.equal(answer, 0, "resume promptly, never park the guest in WFI");
                    yielded++;ready = true;
                }
                return answer;
            };
        } });
        assert.equal(result.status, "ok", result.text);
        assert.match(result.text, /two real read attempts/);
        assert.equal(yielded, 1);assert.equal(reads, 1);
        console.log(`PASS: ${thumb ? "Thumb" : "ARM"} ${jit ? "JIT" : "interpreter"}: empty read yields, PC advances once, actual reply delivered once`);
    }
}
