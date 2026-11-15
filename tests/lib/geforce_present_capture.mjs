import assert from "node:assert/strict";

// Observe an already completed native BGRA present without changing scanout,
// submitting GPU work, or applying a display gamma/cursor transformation.
export function geforce_present_bmp(vram, mode, front)
{
    assert(vram instanceof Uint8Array && mode && mode.bytes === 4);
    const {width, height, pitch} = mode;
    assert(Number.isSafeInteger(width) && width > 0 && width <= 2048);
    assert(Number.isSafeInteger(height) && height > 0 && height <= 1536);
    assert(Number.isSafeInteger(pitch) && pitch >= width * 4);
    assert(Number.isSafeInteger(front) && front >= 0 && !(front & 3));
    assert(front + (height - 1) * pitch + width * 4 <= vram.byteLength);
    const stride = (width * 3 + 3) & ~3, bmp = Buffer.alloc(54 + stride * height);
    bmp.write("BM");bmp.writeUInt32LE(bmp.length, 2);bmp.writeUInt32LE(54, 10);
    bmp.writeUInt32LE(40, 14);bmp.writeInt32LE(width, 18);bmp.writeInt32LE(height, 22);
    bmp.writeUInt16LE(1, 26);bmp.writeUInt16LE(24, 28);bmp.writeUInt32LE(stride * height, 34);
    for(let y = 0; y < height; y++) for(let x = 0; x < width; x++)
    {
        const s = front + y * pitch + x * 4, d = 54 + (height - 1 - y) * stride + x * 3;
        bmp[d] = vram[s];bmp[d + 1] = vram[s + 1];bmp[d + 2] = vram[s + 2];
    }
    return bmp;
}
