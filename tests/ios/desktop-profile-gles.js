// The plugin half of desktop-profile-worker.js. No pixel buffers are kept.
import "../../src/gles/plugin.js";
import { GLESHost } from "../../src/gles/gles_host.js";
const receive = GLESHost.prototype.receive, request = GLESHost.prototype.request;
GLESHost.prototype.receive = function(message)
{
    if(message.type === "write" && message.bytes.length >= 16)
    {
        const v = new DataView(message.bytes.buffer, message.bytes.byteOffset, message.bytes.byteLength);
        globalThis.__ios_desktop_probe?.mark("gpu.reply", v.getUint32(0, true), v.getUint32(4, true));
    }
    return receive.call(this, message);
};
GLESHost.prototype.request = function(...args)
{
    const begin = performance.now(), result = request.apply(this, args);
    globalThis.__ios_desktop_probe?.mark("gpu.request", result.id, args[0]?.size || 0);
    result.done.then(() => {
        const elapsed = performance.now() - begin;
        globalThis.__ios_desktop_probe?.mark("gpu.resolved", result.id, elapsed);
        globalThis.__ios_desktop_probe?.metric("gpu.wait", elapsed);
    });
    return result;
};
