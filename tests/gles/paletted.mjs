import assert from "node:assert/strict";
import { PALETTED_FORMATS, decode_paletted, paletted_layout } from "../../src/gles/paletted.js";
import { GLESHost } from "../../src/gles/gles_host.js";
import { client, fake_renderer, i32s } from "./lib.mjs";
const host = new GLESHost({width:640,height:960,dpi:326},fake_renderer());
const {call}=await client(host).connect();
const ctx=(await call("rcCreateContext",3,0,1)).ret;
await call("rcMakeCurrent",ctx,0,0);
await call("gles1:glBindTexture",0xde1,1);
assert.equal(i32s((await call("gles1:glGetIntegerv",0x86a2,4)).outs[0])[0],15);
assert.deepEqual(i32s((await call("gles1:glGetIntegerv",0x86a3,60)).outs[0]).slice(5),PALETTED_FORMATS);
for(const format of PALETTED_FORMATS)
{
    const layout=paletted_layout(format,4,1,0),data=new Uint8Array(layout.size),view=new DataView(data.buffer);
    const colors=[[255,0,0,255],[0,255,0,255],[0,0,255,layout.rgb?255:0]];
    for(let i=0;i<3;i++)
    {
        if(layout.kind<2)data.set(colors[i].slice(0,layout.entry),i*layout.entry);
        else view.setUint16(i*2,[[0xf800,0x07e0,0x001f],[0xf00f,0x0f0f,0x00f0],[0xf801,0x07c1,0x003e]][layout.kind-2][i],true);
    }
    data.set(layout.bits===4?[0x01,0x21]:[0,1,2,1],layout.palette_bytes);
    assert.deepEqual([...decode_paletted(layout,data)[0].rgba],[...colors[0],...colors[1],...colors[2],...colors[1]],"palette format "+format.toString(16));
    assert.throws(()=>decode_paletted(layout,data.subarray(0,data.length-1)),RangeError);
    await call("gles1:glCompressedTexImage2D",0xde1,0,format,4,1,0,data.length,data);
    assert.equal((await call("gles1:glGetError")).ret,0);
    for(const [level,border,size,bytes,error] of [[1,0,data.length,data,0x501],[-8,0,data.length,data,0x501],
        [0,1,data.length,data,0x502],[0,0,data.length-1,data,0x501],[0,0,data.length,null,0x501]])
    {
        await call("gles1:glCompressedTexImage2D",0xde1,level,format,4,1,border,size,bytes);
        assert.equal((await call("gles1:glGetError")).ret,error);
    }
    await call("gles1:glCompressedTexSubImage2D",0xde1,0,0,0,4,1,format,data.length,data);
    assert.equal((await call("gles1:glGetError")).ret,0x502);
}
const layout=paletted_layout(0x8b91,4,4,-2),bytes=new Uint8Array(layout.size);
bytes.set([255,0,0,255,0,255,0,255,0,0,255,255]);
bytes.fill(0x11,layout.images[1].offset,layout.images[2].offset);bytes[layout.images[2].offset]=0x20;
const images=decode_paletted(layout,bytes);
assert.deepEqual(images.map(i=>[i.width,i.height,i.rgba.length]),[[4,4,64],[2,2,16],[1,1,4]]);
for(let i=0;i<3;i++)assert.deepEqual([...images[i].rgba.slice(0,4)],[[255,0,0,255],[0,255,0,255],[0,0,255,255]][i]);
await call("gles1:glCompressedTexImage2D",0xde1,-2,0x8b91,4,4,0,bytes.length,bytes);
assert.equal((await call("gles1:glGetError")).ret,0);
assert.deepEqual([...host.shadow.context(ctx).group.textures.get(1).images].map(([level,i])=>[level,i.width,i.height]),[[0,4,4],[1,2,2],[2,1,1]]);
for(const args of [[0x8b90,2,2,1],[0x8b90,2,2,-2],[0x8b90,-1,2,0],[0x8b90,Infinity,2,0],[0x8b90,2,NaN,0],[0x8b90,2,2,0.5]])
    assert.equal(paletted_layout(...args),null);
console.log("PASS: ten ES1 palette formats, alpha, nibble order, mip chain sizes, queries and invalid uploads");
