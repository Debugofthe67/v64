// Drive a native Chromium folder input with a local RM-505 package.
// Run from the repository root. No firmware is copied to the source tree.
import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import { createServer } from "node:net";
import { resolve } from "node:path";

const directory = process.argv[2] && resolve(process.argv[2]);
if(!directory || !(await stat(directory)).isDirectory()) throw new Error("Supply a local RM-505 firmware folder");
const server = createServer();
await new Promise((done, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", done); });
const port = server.address().port;
await new Promise(done => server.close(done));
const runner = spawn(process.execPath, ["tests/app/browser_runner.mjs", "tests/app/symbian_test.html", "local=1"], {
    env: { ...process.env, BROWSER_DEBUG_PORT: String(port) },
    stdio: "inherit",
});
const finished = new Promise((done, reject) => {
    runner.on("error", reject);
    runner.on("exit", (code, signal) => done({ code, signal }));
});
const pause = () => new Promise(done => setTimeout(done, 100));
let socket;
try
{
    const endpoint = "http://127.0.0.1:" + port + "/json/list";
    let target;
    for(let attempt = 0; attempt < 150 && !target && runner.exitCode === null; attempt++)
    {
        const pages = await fetch(endpoint).then(response => response.json()).catch(() => []);
        target = pages.find(page => page.type === "page" && page.url.includes("symbian_test.html"));
        if(!target) await pause();
    }
    if(!target) throw new Error("Chrome did not open the acceptance page");
    socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((done, reject) => { socket.onopen = done; socket.onerror = reject; });
    let next_id = 0;
    function request(method, params)
    {
        const id = ++next_id;
        return new Promise((done, reject) => {
            const timer = setTimeout(() => {
                socket.removeEventListener("message", receive);
                reject(new Error(method + " timed out"));
            }, 5000);
            function receive(event)
            {
                const reply = JSON.parse(event.data);
                if(reply.id !== id) return;
                clearTimeout(timer);
                socket.removeEventListener("message", receive);
                if(reply.error) reject(new Error(reply.error.message));
                else done(reply.result);
            }
            socket.addEventListener("message", receive);
            socket.send(JSON.stringify({ id, method, params }));
        });
    }
    let input;
    for(let attempt = 0; attempt < 150 && !input && runner.exitCode === null; attempt++)
    {
        const evaluated = await request("Runtime.evaluate", { expression: "window.local_firmware_input" });
        input = evaluated.result.objectId;
        if(!input) await pause();
    }
    if(!input) throw new Error("The N97 folder input did not appear");
    await request("DOM.setFileInputFiles", { objectId: input, files: [directory] });
    const result = await finished;
    if(result.code !== 0) throw new Error("Browser import test failed: " + (result.signal || result.code));
}
finally
{
    socket?.close();
    if(runner.exitCode === null && runner.signalCode === null) runner.kill();
}
