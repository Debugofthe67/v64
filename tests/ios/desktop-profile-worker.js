// Diagnostic worker only; never changes registers, scheduling or guest time.
import { start_cpu_worker } from "../../src/browser/cpu_worker_runtime.js";
import { v86 } from "../../src/main.js";
import { A64CPU } from "../../src/arm/cpu.js";
import { AppleIOP } from "../../src/apple/iop.js";
import { AppleCLCD } from "../../src/apple/clcd.js";
import { BackdoorA32, BACKDOOR, BACKDOOR_ERROR } from "../../src/arm/backdoor_a32.js";

const capacity = 131072;
let active = false, start = 0, total = 0, records = [], metrics = {}, scheduled;
const stamp = () => performance.timeOrigin + performance.now();
const probe = globalThis.__ios_desktop_probe = {
    start() { records = [];metrics = {};total = 0;start = stamp();active = true; },
    mark(name, a = 0, b = 0) {
        if(active) { records[total % capacity] = [stamp(), name, a, b];total++; }
    },
    metric(name, ms = 0, bytes = 0) {
        if(!active) return;
        const m = metrics[name] ||= { calls: 0, ms: 0, max_ms: 0, bytes: 0 };
        m.calls++;m.ms += ms;m.max_ms = Math.max(m.max_ms, ms);m.bytes += bytes;
    },
    stop() {
        active = false;
        const offset = total > capacity ? total % capacity : 0;
        return { start, end: stamp(), time_origin: performance.timeOrigin, metrics, dropped_records: Math.max(0, total - capacity),
            records: offset ? records.slice(offset).concat(records.slice(0, offset)) : records };
    },
};
function timed(fn, name, self, args)
{
    if(!active) return fn.apply(self, args);
    const begin = performance.now();
    try { return fn.apply(self, args); }
    finally { const ms = performance.now() - begin;probe.metric(name, ms);probe.mark(name, ms); }
}
function wrap(type, name, label)
{
    const fn = type.prototype[name];
    type.prototype[name] = function(...args) { return timed(fn, label, this, args); };
}
const init = A64CPU.prototype.init;
A64CPU.prototype.init = function(...args)
{
    const result = init.apply(this, args), run = this.wm.exports.a64_run_slice;
    // Preserve the instance's memory/table and every other export. Only the
    // JS call boundary is timed; the original Wasm function runs unchanged.
    this.wm = { ...this.wm, exports: { ...this.wm.exports,
        a64_run_slice: (...a) => timed(run, "ap", null, a) } };
    return result;
};
wrap(A64CPU, "run_machine_core", "machine");
wrap(A64CPU, "run_hardware_timers", "devices");
wrap(AppleIOP, "run", "iop");
wrap(AppleCLCD, "render", "scan");
const update = AppleCLCD.prototype.update_display;
AppleCLCD.prototype.update_display = function(...args) { probe.mark("panel");return update.apply(this, args); };
const call = BackdoorA32.prototype.call;
BackdoorA32.prototype.call = function(r0, r1, r2, r3)
{
    if(!active) return call.call(this, r0, r1, r2, r3);
    const begin = performance.now(), name = this.connections.get(r3 >>> 0)?.name;
    const result = call.call(this, r0, r1, r2, r3);
    if(name === "opengles")
    {
        const op = r0 & 0xFFFF, again = op === BACKDOOR.READ && result === BACKDOOR_ERROR.AGAIN;
        const label = again ? "gl.again" : op === BACKDOOR.READ ? "gl.read" : "gl.call";
        probe.metric(label, performance.now() - begin, result > 0 && op === BACKDOOR.READ ? result : 0);
        if(!again) probe.mark(label, r3, result);
    }
    return result;
};
const yield_task = v86.prototype.yield, callback = v86.prototype.yield_callback;
v86.prototype.yield = function(delay, tick)
{
    if(active) scheduled = { tick, delay, time: performance.now() };
    return yield_task.call(this, delay, tick);
};
v86.prototype.yield_callback = function(tick)
{
    if(active && scheduled?.tick === tick)
    {
        const wait = performance.now() - scheduled.time;
        probe.metric("host.queue", Math.max(0, wait - Math.max(0, scheduled.delay)));
        probe.mark("host.queue", wait, scheduled.delay);
    }
    return callback.call(this, tick);
};
start_cpu_worker();
