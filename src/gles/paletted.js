// OES_compressed_paletted_texture: one palette followed by tightly packed
// index images. A negative level specifies a chain starting at level zero.
export const PALETTED_FORMATS = Array.from({ length: 10 }, (_, i) => 0x8B90 + i);

export function paletted_layout(format, width, height, level)
{
    const code = format - 0x8B90;
    if(![code,width,height,level].every(Number.isInteger) || code < 0 || code > 9 || width > 16384 || height > 16384 || level > 0 ||
        level < -Math.floor(Math.log2(Math.max(1, width, height))) || width < 0 || height < 0) return null;
    const bits = code < 5 ? 4 : 8, kind = code % 5;
    const entry = [3,4,2,2,2][kind];
    const palette_bytes = (1 << bits) * entry;
    let size = palette_bytes;
    const images = [];
    for(let n = 0; n <= -level; n++)
    {
        const w = width ? Math.max(1, width >> n) : 0, h = height ? Math.max(1, height >> n) : 0;
        const bytes = Math.ceil(w * h * bits / 8);
        images.push({ level: n, width: w, height: h, offset: size, bytes });
        size += bytes;
    }
    return { bits, kind, entry, palette_bytes, images, size, rgb: kind === 0 || kind === 2 };
}

/** Expand a validated palette chain into RGBA8, preserving packed alpha. */
export function decode_paletted(layout, data)
{
    if(!data || data.length < layout.size) throw new RangeError("Truncated paletted texture");
    const palette = new Uint8Array((1 << layout.bits) * 4);
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    for(let i = 0; i < palette.length / 4; i++)
    {
        const at = i * layout.entry;
        let rgba;
        if(layout.kind < 2) rgba = [data[at], data[at+1], data[at+2], layout.kind ? data[at+3] : 255];
        else
        {
            const p = view.getUint16(at, true);
            if(layout.kind === 2) rgba = [Math.round((p >> 11) * 255 / 31), Math.round((p >> 5 & 63) * 255 / 63), Math.round((p & 31) * 255 / 31), 255];
            else if(layout.kind === 3) rgba = [(p >> 12) * 17, (p >> 8 & 15) * 17, (p >> 4 & 15) * 17, (p & 15) * 17];
            else rgba = [Math.round((p >> 11) * 255 / 31), Math.round((p >> 6 & 31) * 255 / 31), Math.round((p >> 1 & 31) * 255 / 31), (p & 1) * 255];
        }
        palette.set(rgba, i * 4);
    }
    return layout.images.map(image =>
    {
        const rgba = new Uint8Array(image.width * image.height * 4);
        for(let i = 0; i < rgba.length / 4; i++)
        {
            const byte = data[image.offset + (layout.bits === 4 ? i >> 1 : i)];
            const index = layout.bits === 4 ? i & 1 ? byte & 15 : byte >> 4 : byte;
            rgba.set(palette.subarray(index * 4, index * 4 + 4), i * 4);
        }
        return { ...image, rgba };
    });
}
