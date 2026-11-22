// A fixed-geometry block image with a sector-aligned header and index.

/** Open the packed block map used by the iPhone NAND. */
export function open_sparse_blocks(access, { magic, chunk, length, label }, create = false)
{
    const HEADER = 512;
    const COUNT = Math.ceil(length / chunk), INDEX = COUNT * 4;
    const DATA = HEADER + Math.ceil(INDEX / 512) * 512;
    function read(at, bytes)
    {
        if(access["read"](bytes, { "at": at }) !== bytes.length) throw new Error("Short read from " + label);
    }
    function write(at, bytes)
    {
        for(let n = 0; n < bytes.length;)
        {
            const done = access["write"](bytes.subarray(n), { "at": at + n });
            if(!done) throw new Error("Short write to " + label);
            n += done;
        }
    }

    const header = new Uint8Array(HEADER), index = new Uint8Array(INDEX);
    const hv = new DataView(header.buffer), map = new DataView(index.buffer);
    let allocated = 0;
    if(create)
    {
        access["truncate"](0);
        header.set(magic);
        hv.setUint32(8, chunk, true);
        hv.setUint32(12, COUNT, true);
        access["truncate"](DATA);
        write(0, header);
    }
    else
    {
        const size = access["getSize"]();
        if(size < HEADER) return null;
        read(0, header);
        if(!magic.every((byte, i) => header[i] === byte)) return null;
        allocated = (size - DATA) / chunk;
        if(hv.getUint32(8, true) !== chunk || hv.getUint32(12, true) !== COUNT ||
            !Number.isInteger(allocated) || allocated < 0 || allocated > COUNT)
            throw new Error("Invalid sparse geometry for " + label);
        read(HEADER, index);
        const used = new Set();
        for(let i = 0; i < COUNT; i++)
        {
            const slot = map.getUint32(i * 4, true);
            if(slot > allocated || slot && used.has(slot)) throw new Error("Invalid sparse index for " + label);
            if(slot) used.add(slot);
        }
    }
    const slot_offset = (slot, within) => DATA + (slot - 1) * chunk + within;
    const update = new Uint8Array(4), uv = new DataView(update.buffer);
    function visit(at, bytes, step)
    {
        if(!Number.isSafeInteger(at) || at < 0 || at + bytes.length > length) throw new Error("Outside " + label);
        for(let done = 0; done < bytes.length;)
        {
            const start = at + done, n = Math.floor(start / chunk), within = start % chunk;
            const length = Math.min(bytes.length - done, chunk - within);
            step(n, within, bytes.subarray(done, done + length));
            done += length;
        }
    }
    return {
        size: length,
        read(at, length) {
            const bytes = new Uint8Array(length);
            visit(at, bytes, (n, within, part) => {
                const slot = map.getUint32(n * 4, true);
                if(slot) read(slot_offset(slot, within), part);
            });
            return bytes;
        },
        write(at, bytes) {
            visit(at, bytes, (n, within, part) => {
                let slot = map.getUint32(n * 4, true);
                if(slot) { write(slot_offset(slot, within), part); return; }
                if(part.every(byte => !byte)) return;
                if(allocated >= COUNT) throw new Error("The sparse index is full for " + label);
                slot = allocated + 1;
                access["truncate"](DATA + slot * chunk);
                try
                {
                    write(slot_offset(slot, within), part);
                    uv.setUint32(0, slot, true);
                    write(HEADER + n * 4, update);
                    map.setUint32(n * 4, slot, true);
                    allocated = slot;
                }
                catch(error)
                {
                    // Restore the unused slot if a host write was incomplete.
                    uv.setUint32(0, 0, true);
                    write(HEADER + n * 4, update);
                    access["truncate"](DATA + allocated * chunk);
                    throw error;
                }
            });
        },
    };
}
