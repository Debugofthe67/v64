import assert from "node:assert/strict";
import { actual32, build32, root } from "./runner.mjs";

const guest = build32("thumb-sp", [root + "tests/a32/thumb-sp.c"], { thumb: true });
for(const [profile, jit] of [["cortex-a8", 0], ["cortex-a8", 1], ["v86-arm32-v1", 0]])
{
    const result = await actual32(guest, {
        setup: cpu => cpu.set_profile(profile),
        options: {
            ir_sync_publication: true,
            jit_switches: { a64_page: jit, a64_page_hot: 1, a64_page_aarch32: 1 },
        },
    });
    assert.equal(result.status, "ok", `${profile}, JIT ${jit}: ${result.text}`);
    if(jit) assert.ok(result.page_tier.compiled > 0);
}
console.log("PASS: Cortex-A8 Thumb SP restore preserves flags and the generic ARM32 profile faults");
