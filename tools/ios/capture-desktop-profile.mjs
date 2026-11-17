// Only the caller-owned browser_runner DevTools endpoint. Diagnostic
// sampling perturbs execution; never report this run as an FPS A/B result.
import fs from "node:fs";
import path from "node:path";
const prefix = process.argv[2], port = Number(process.argv[3] || 9896);
if(!prefix || !path.resolve(prefix).startsWith(path.resolve("build/ios") + path.sep))
    throw Error("usage: capture-desktop-profile.mjs build/ios/<prefix> [debug-port]");
const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
const ws = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve;ws.onerror = reject; });
let id = 0;const pending = new Map(), attached = [];
const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    if(ws.readyState !== WebSocket.OPEN) { reject(Error("DevTools disconnected"));return; }
    const request = ++id, timer = setTimeout(() => { pending.delete(request);reject(Error("DevTools request timed out: " + method)); }, 30000);
    pending.set(request, [value => { clearTimeout(timer);resolve(value); }, error => { clearTimeout(timer);reject(error); }]);
    ws.send(JSON.stringify({ id: request, method, params, sessionId }));
});
ws.onclose = () => { for(const [, reject] of pending.values()) reject(Error("DevTools disconnected"));pending.clear(); };
ws.onmessage = ({ data }) => {
    const m = JSON.parse(data);
    if(m.id && pending.has(m.id))
    {
        const [resolve, reject] = pending.get(m.id);pending.delete(m.id);
        m.error ? reject(Error(JSON.stringify(m.error))) : resolve(m.result);
    }
    if(m.method === "Target.attachedToTarget") attached.push(m.params);
};
const sleep = ms => new Promise(r => setTimeout(r, ms));
let sessionId;
try
{
    const targets = (await send("Target.getTargets")).targetInfos;
    const target = targets.find(t => t.type === "page" && t.url.includes("/tests/ios/ui-performance.html"));
    if(!target) throw Error("Owned benchmark page missing");
    ({ sessionId } = await send("Target.attachToTarget", { targetId: target.targetId, flatten: true }));
    await send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, sessionId);
    let workerId;
    for(let i = 0; i < 300 && !workerId; i++)
    {
        workerId = attached.find(a => a.targetInfo.title === "v86 CPU")?.sessionId;
        if(!workerId) await sleep(100);
    }
    if(!workerId) throw Error("CPU Worker missing");
    for(let i = 0;;i++)
    {
        const r = await send("Runtime.evaluate", { expression: "globalThis.performance_progress?.phase", returnByValue: true }, sessionId);
        if(r.result.value === "measure") break;
        if(i > 360) throw Error("Warmup timed out");
        await sleep(500);
    }
    const started = await send("Runtime.evaluate", { expression: "__ios_desktop_probe.start({steps:" + (process.env.IOS_PROFILE_STEPS === "1") + "});true", returnByValue: true }, workerId);
    if(started.exceptionDetails) throw Error("Diagnostic worker required");
    for(const sid of [sessionId, workerId])
    {
        await send("Profiler.enable", {}, sid);
        await send("Profiler.setSamplingInterval", { interval: 1000 }, sid);
        await send("Profiler.start", {}, sid);
    }
    await sleep(20000);
    const trace = await send("Runtime.evaluate", { expression: "__ios_desktop_probe.stop()", returnByValue: true }, workerId);
    if(trace.exceptionDetails) throw Error("Trace failed");
    fs.writeFileSync(prefix + "-trace.json", JSON.stringify(trace.result.value));
    for(const [name, sid] of [["main", sessionId], ["cpu", workerId]])
    {
        const { profile } = await send("Profiler.stop", {}, sid);
        fs.writeFileSync(prefix + "-" + name + ".cpuprofile", JSON.stringify(profile));
        await send("Profiler.disable", {}, sid);
    }
    console.log(JSON.stringify({ seconds: (trace.result.value.end - trace.result.value.start) / 1000,
        metrics: trace.result.value.metrics, dropped_records: trace.result.value.dropped_records }));
}
finally
{
    if(sessionId) await send("Target.setAutoAttach", { autoAttach: false, waitForDebuggerOnStart: false, flatten: true }, sessionId).catch(() => {});
    ws.close();
}
