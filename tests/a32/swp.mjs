import assert from "node:assert/strict";
import { build32, actual32, root } from "./runner.mjs";

const guest = build32("swp", [root + "tests/a32/swp.c"]);
for(const profile of ["cortex-a8", "v86-arm32-v1"])
{
    for(const jit of [0, 1])
    {
        const result = await actual32(guest, {
            // Exercise the CPU profile against synthetic RAM without boot firmware.
            setup: cpu => cpu.set_profile(profile),
            options: { ir_sync_publication: true, jit_switches: {
                a64_page: jit, a64_page_hot: 1, a64_page_aarch32: 1,
            } },
        });
        assert.equal(result.status, "ok", `${profile}, JIT ${jit}: ${result.text}`);
        if(jit && profile === "cortex-a8")
        {
            assert.ok(result.page_tier.compiled > 0 && result.page_tier.helpers > 0);
        }
    }
}
console.log("PASS: Cortex-A8 SWP/SWPB, predicates, big-endian data and memory faults; Cortex-A15 keeps UNDEF");
