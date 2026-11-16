import assert from "node:assert/strict";
import {geforce_present_bmp} from "../lib/geforce_present_capture.mjs";

const vram = Uint8Array.from([
    77,77,77,77, 0,0,255,12, 0,255,0,34, 91,92,93,94,
    255,0,0,56, 255,255,255,78,
]);
const mode = {width:2, height:2, pitch:12, bytes:4};
const before = vram.slice(), bmp = geforce_present_bmp(vram, mode, 4);
assert.equal(bmp.toString("ascii", 0, 2), "BM");
assert.equal(bmp.readUInt32LE(2), 70);
assert.equal(bmp.readInt32LE(18), 2);assert.equal(bmp.readInt32LE(22), 2);
assert.deepEqual([...bmp.subarray(54)], [255,0,0,255,255,255,0,0,0,0,255,0,255,0,0,0]);
assert.deepEqual(vram, before);
for(const front of [-4, 1, 8, NaN]) assert.throws(() => geforce_present_bmp(vram, mode, front));
for(const bad of [{bytes:2}, {pitch:7}, {height:0}, {width:2049}, {pitch:Infinity}])
    assert.throws(() => geforce_present_bmp(vram, {...mode, ...bad}, 4));
console.log("NV40 completed-present BMP: padded pitch, orientation, channels, bounds and unchanged VRAM pass");
