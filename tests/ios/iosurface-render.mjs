// Render to a shareable N90 IOSurface and read the actual GPU pixels
// through an independent process's texture attachment.
import assert from "node:assert/strict";
import fs from "node:fs";
import { compile_glslang, create_glslang } from "../../src/gles/glslang.js";
import { GLESHost } from "../../src/gles/gles_host.js";
import { chrome_renderer } from "../gles/chrome_renderer.mjs";
import { client } from "../gles/lib.mjs";

const glslang = process.env.IOSURFACE_GLSLANG ? await create_glslang(await compile_glslang(
    fs.readFileSync(new URL("../../bios/glslang.wasm", import.meta.url)))) : null;
const renderer = await chrome_renderer();
try
{
    const host = new GLESHost({ width: 64, height: 48, dpi: 326 }, renderer, undefined, { glslang });
    async function attach(texture, id = 42)
    {
        const process = client(host);
        const { call, send } = await process.connect();
        const context = (await call("rcCreateContext", 3, 0, 2)).ret;
        assert.equal((await call("rcMakeCurrent", context, 0, 0)).ret, 1);
        const buffer = (await call("v86AcquireIOSurface", id, 64, 48, 0x42475241)).ret;
        assert.ok(buffer);
        send("gles2:glBindFramebuffer", 0x8d40, 1);
        if(texture)
        {
            send("gles2:glBindTexture", 0x0de1, 2);
            send("rcBindTexture", buffer);
            send("gles2:glFramebufferTexture2D", 0x8d40, 0x8ce0, 0x0de1, 2, 0);
        }
        else
        {
            send("gles2:glBindRenderbuffer", 0x8d41, 3);
            send("rcBindRenderbuffer", buffer);
            send("gles2:glFramebufferRenderbuffer", 0x8d40, 0x8ce0, 0x8d41, 3);
        }
        assert.equal((await call("gles2:glCheckFramebufferStatus", 0x8d40)).ret, 0x8cd5);
        return { process, call, send, buffer };
    }
    const writer = await attach(false), reader = await attach(true);
    assert.equal(writer.buffer, reader.buffer);
    const cpuPixels = new Uint8Array(64 * 48 * 4);
    for(let y = 0; y < 48; y++)
        for(let x = 0; x < 64; x++) cpuPixels.set([x, y, 200, 255], (64 * y + x) * 4);
    assert.equal((await reader.call("v86IOSurfaceIsCurrent", reader.buffer, 17)).ret, 0);
    assert.equal((await reader.call("v86UploadIOSurface", reader.buffer, 17, cpuPixels)).ret, 1);
    const verifyCPU = async () => {
        const { outs } = await reader.call("gles2:glReadPixels", 0, 0, 64, 48, 0x1908, 0x1401, cpuPixels.length);
        for(let y = 0; y < 48; y++)
            for(let x = 0; x < 64; x++)
            {
                const at = (64 * y + x) * 4;
                assert.deepEqual([...outs[0].subarray(at, at + 4)], [200, y, x, 255]);
            }
    };
    await verifyCPU();
    for(const flip of [0, 1])
    {
        const native = await reader.call("v86ReadIOSurface", reader.buffer, 1, 2, flip, 64 * 2 * 4);
        assert.equal(native.ret, 1, "native status follows the actual GPU response");
        for(let y = 0; y < 2; y++)
            for(let x = 0; x < 64; x++)
            {
                const at = (64 * y + x) * 4;
                assert.deepEqual([...native.outs[0].subarray(at, at + 4)], [x, 1 + (flip ? 1 - y : y), 200, 255]);
            }
    }
    writer.send("gles2:glClearColor", 0, 1, 0, 1);
    writer.send("gles2:glClear", 0x4000);
    writer.send("gles2:glEnable", 0xc11);
    writer.send("gles2:glScissor", 0, 0, 2, 2);
    writer.send("gles2:glClearColor", 1, 0, 0, 1);
    writer.send("gles2:glClear", 0x4000);
    await writer.call("gles2:glFinish");
    const check = async (corner = [255, 0, 0, 255]) => {
        const { outs } = await reader.call("gles2:glReadPixels", 0, 0, 64, 48, 0x1908, 0x1401, 64 * 48 * 4);
        for(let y = 0; y < 48; y++)
            for(let x = 0; x < 64; x++)
            {
                const at = (64 * y + x) * 4;
                assert.deepEqual([...outs[0].subarray(at, at + 4)], x < 2 && y < 2 ? corner : [0, 255, 0, 255]);
            }
    };
    assert.equal((await writer.call("v86IOSurfaceIsCurrent", writer.buffer, 17)).ret, 1);
    assert.equal((await reader.call("v86UploadIOSurface", reader.buffer, 17, cpuPixels)).ret, 1);
    await check();
    await host.prepare_save();
    host.set_state(host.get_state());
    // The writer's renderbuffer must still alias the restored color buffer.
    writer.send("gles2:glClearColor", 1, 1, 0, 1);
    writer.send("gles2:glClear", 0x4000);
    await writer.call("gles2:glFinish");
    await check([255, 255, 0, 255]);
    // Reallocating this renderbuffer detaches the IOSurface. Clearing the
    // private storage must leave the other process's pixels untouched.
    writer.send("gles2:glRenderbufferStorage", 0x8d41, 0x8056, 64, 48);
    writer.send("gles2:glDisable", 0xc11);
    writer.send("gles2:glClearColor", 0, 0, 1, 1);
    writer.send("gles2:glClear", 0x4000);
    await writer.call("gles2:glFinish");
    writer.process.process_pipe.close();
    await check([255, 255, 0, 255]);
    assert.equal((await reader.call("v86IOSurfaceIsCurrent", reader.buffer, 17)).ret, 1);
    assert.equal((await reader.call("v86UploadIOSurface", reader.buffer, 18, cpuPixels)).ret, 1);
    await verifyCPU();
    // A native window publishes flipped CPU rows, while the producing
    // renderbuffer keeps GL rows. An independent compositor must sample
    // those published rows even when the GPU alias avoids a CPU upload.
    const windowWriter = await attach(false, 43), window = windowWriter.buffer;
    assert.equal((await reader.call("v86AcquireIOSurface", 43, 64, 48, 0x42475241)).ret, window);
    windowWriter.send("gles2:glBindRenderbuffer", 0x8d41, 3);
    windowWriter.send("rcBindRenderbuffer", window);
    windowWriter.send("gles2:glDisable", 0xc11);
    windowWriter.send("gles2:glClearColor", 0, 1, 0, 1);
    windowWriter.send("gles2:glClear", 0x4000);
    windowWriter.send("gles2:glEnable", 0xc11);
    windowWriter.send("gles2:glScissor", 0, 0, 2, 2);
    windowWriter.send("gles2:glClearColor", 1, 0, 0, 1);
    windowWriter.send("gles2:glClear", 0x4000);
    const native = await windowWriter.call("v86ReadIOSurface", window, 0, 48, 1, 64 * 48 * 4);
    assert.equal(native.ret, 1);
    assert.deepEqual([...native.outs[0].subarray(64 * 47 * 4, 64 * 47 * 4 + 4)], [0, 0, 255, 255]);
    reader.send("gles2:glBindTexture", 0xde1, 2);
    reader.send("rcBindTexture", window);
    // Reading through its FBO still addresses GL rows and preserves the
    // producer's retained backing; only sampling uses native memory rows.
    const retained = await reader.call("gles2:glReadPixels", 0, 0, 1, 1, 0x1908, 0x1401, 4);
    assert.deepEqual([...retained.outs[0]], [255, 0, 0, 255]);
    reader.send("gles2:glBindFramebuffer", 0x8d40, 7);
    reader.send("gles2:glBindRenderbuffer", 0x8d41, 8);
    reader.send("gles2:glRenderbufferStorage", 0x8d41, 0x8056, 64, 48);
    reader.send("gles2:glFramebufferRenderbuffer", 0x8d40, 0x8ce0, 0x8d41, 8);
    assert.equal((await reader.call("gles2:glCheckFramebufferStatus", 0x8d40)).ret, 0x8cd5, "sampling target complete");
    const text = s => new TextEncoder().encode(s + "\0");
    async function shader(type, source) {
        const id = (await reader.call("gles2:glCreateShader", type)).ret;
        reader.send("gles2:glShaderString", id, text(source), source.length + 1);
        reader.send("gles2:glCompileShader", id);
        const status = await reader.call("gles2:glGetShaderiv", id, 0x8b81, 4);
        assert.equal(new DataView(status.outs[0].buffer, status.outs[0].byteOffset).getUint32(0,true), 1, "shader compiled");return id;
    }
    const vs = await shader(0x8b31, "attribute vec2 p; varying vec2 uv; void main(){uv=(p+1.0)*0.5;gl_Position=vec4(p,0.0,1.0);}");
    const fs = await shader(0x8b30, "precision mediump float;uniform sampler2D tex;varying vec2 uv;void main(){gl_FragColor=texture2D(tex,uv);}");
    const program = (await reader.call("gles2:glCreateProgram")).ret;
    reader.send("gles2:glAttachShader", program, vs);reader.send("gles2:glAttachShader", program, fs);
    reader.send("gles2:glBindAttribLocation", program, 0, text("p"));
    reader.send("gles2:glLinkProgram", program);reader.send("gles2:glUseProgram", program);
    const linked = await reader.call("gles2:glGetProgramiv", program, 0x8b82, 4);
    assert.equal(new DataView(linked.outs[0].buffer, linked.outs[0].byteOffset).getUint32(0,true),1,"program linked");
    reader.send("gles2:glViewport", 0, 0, 64, 48);
    reader.send("gles2:glDisable", 0xc11);
    reader.send("gles2:glTexParameteri", 0xde1, 0x2801, 0x2600);
    reader.send("gles2:glTexParameteri", 0xde1, 0x2800, 0x2600);
    const positions = new Uint8Array(new Float32Array([-1, -1, 3, -1, -1, 3]).buffer);
    reader.send("gles2:glEnableVertexAttribArray", 0);
    reader.send("gles2:glVertexAttribPointerData", 0, 2, 0x1406, 0, 0, positions, positions.length);
    async function sampleNative(cpuWritten = false) {
        reader.send("gles2:glDrawArrays", 4, 0, 3);
        assert.equal((await reader.call("gles2:glGetError")).ret,0,"sampling draw accepted");
        const { outs } = await reader.call("gles2:glReadPixels", 0, 0, 64, 48, 0x1908, 0x1401, 64 * 48 * 4);
        for(let y = 0; y < 48; y++) for(let x = 0; x < 64; x++) {
            const at = (y * 64 + x) * 4;
            assert.deepEqual([...outs[0].subarray(at, at + 4)], cpuWritten && x === 0 && y === 0 ? [0, 0, 255, 255] : x < 2 && y >= 46 ? [255, 0, 0, 255] : [0, 255, 0, 255]);
        }
    }
    await sampleNative();
    await host.prepare_save();host.set_state(host.get_state());
    await sampleNative();
    await reader.call("rcUpdateColorBuffer", window, 0, 0, 1, 1, 0x1908, 0x1401, new Uint8Array([0, 0, 255, 255]));
    await sampleNative(true);
    windowWriter.process.process_pipe.close();
    reader.process.process_pipe.close();
    console.log(`PASS: IOSurface sharing, native window sampling orientation and retained backing survive restore (${glslang ? "native GLSL ES 1.00/glslang" : "GLES 2 translator"})`);
}
finally { renderer.close(); }
