// Read the generated FAT16 card independently of the image writer.
export async function read_sis_card(card, index)
{
    const bytes = async (at, length) => new Uint8Array(await card.slice(at, at + length).arrayBuffer());
    const view = bytes => new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
    const boot = view(await bytes(0, 512));
    if(boot.getUint16(510, true) !== 0xAA55 || boot.getUint32(28, true) !== 0)
        throw new Error("Expected a raw FAT16 volume");
    const block = boot.getUint16(11, true), cluster = boot.getUint8(13) * block;
    const fat = boot.getUint16(14, true) * block, fatsz = boot.getUint16(22, true) * block;
    const root = fat + boot.getUint8(16) * fatsz, root_bytes = boot.getUint16(17, true) * 32;
    const first_cluster = root + Math.ceil(root_bytes / block) * block;
    const offset = n => first_cluster + (n - 2) * cluster;
    function find(dir, name)
    {
        const decode = new TextDecoder();
        for(let at = 0; at < dir.length && dir[at]; at += 32)
            if(decode.decode(dir.subarray(at, at + 11)) === name) return view(dir.subarray(at, at + 32));
        throw new Error("Missing FAT directory entry " + name);
    }
    const subdir = find(await bytes(root, root_bytes), "INSTALL    ");
    const file = find(await bytes(offset(subdir.getUint16(26, true)), cluster),
        "PKG" + index.toString().padStart(5, "0") + "SIS");
    const chain = view(await bytes(fat, fatsz));
    const out = new Uint8Array(file.getUint32(28, true));
    let n = file.getUint16(26, true);
    for(let at = 0; at < out.length; at += cluster)
    {
        if(n < 2 || n >= chain.byteLength / 2 || n >= 0xFFF0) throw new Error("Invalid FAT cluster chain");
        out.set(await bytes(offset(n), Math.min(out.length - at, cluster)), at);
        n = chain.getUint16(n * 2, true);
    }
    if(n < 0xFFF8) throw new Error("FAT file ends ahead of its cluster chain");
    return out;
}
