// Performance consumers must distinguish real-time execution from slow or
// deterministic guest time without looking inside a CPU worker.
import assert from "node:assert/strict";
import path from "node:path";
const { V86 } = await import(+process.env.TEST_RELEASE_BUILD ? "../../build/libv86.mjs" : "../../src/main.js");
let host = 100;
const emulator = new V86({ cpu_type: "arm32", graphics_adapter: "none", memory_size: 16 << 20,
    autostart: false, log_level: 0, wasm_path: path.resolve("build/v86-arm64.wasm"),
    cpu_clock: { mode: "normal", rate: 0.25, now: () => host } });
try
{
    await new Promise((resolve, reject) => { emulator.add_listener("emulator-loaded", resolve);emulator.add_listener("emulator-error", reject); });
    const cpu = emulator.v86.cpu;
    cpu.clock.pause();
    const stopped = await emulator.get_diagnostics();
    assert.equal(stopped.clock.mode, "normal");
    assert.equal(stopped.clock.rate, 0.25);
    assert.equal(stopped.clock.paused, true);
    host += 1000;
    assert.equal((await emulator.get_diagnostics()).clock.now_ms, stopped.clock.now_ms);
    cpu.clock.resume();
    host += 20;
    const running = await emulator.get_diagnostics();
    assert.equal(running.clock.paused, false);
    assert.equal(running.clock.now_ms - stopped.clock.now_ms, 5);
    assert.ok(Number.isFinite(running.host_time));
    console.log("PASS: public ARM clock diagnostics expose scaled time, pause state and host time independently");
}
finally { await emulator.destroy(); }
