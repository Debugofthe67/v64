// Symbian OS v9.X SIS File Format Specification §§2.12, 3 and 4.2.
const SIS_PACKAGE_LIMIT = 0x7FFFFFFF;
const CONTROLLER_LIMIT = 8 * 1024 ** 2;
const PACKAGE_UID = 0x10201A7A;
const CONTENTS = 12, CONTROLLER = 13, INFO = 14, UID = 9;
const ARRAY = 2, COMPRESSED = 3, DATA = 30, DATA_UNIT = 31, CONTROLLER_CRC = 34, DATA_CRC = 35;

const crc_table = new Uint16Array(256);
for(let i = 0; i < crc_table.length; i++)
{
    let bits = i << 8;
    for(let j = 0; j < 8; j++) bits = (bits << 1) ^ (bits & 0x8000 ? 0x1021 : 0);
    crc_table[i] = bits;
}

function crc16(bytes, start, end, step = 1, crc = 0)
{
    for(let i = start; i < end; i += step) crc = (crc << 8 & 0xFFFF) ^ crc_table[(crc >>> 8) ^ bytes[i]];
    return crc;
}

function field_bounds(view, start, limit)
{
    const type = view.getUint32(0, true);
    const length = view.getUint32(4, true);
    const value = start + 8, end = value + length, next = Math.ceil(end / 4) * 4;
    if(next > limit) throw new Error("SIS field exceeds its container");
    return { type, length, start, value, end, next };
}

function read_field(view, start, limit)
{
    if(start + 8 > limit) throw new Error("Truncated SIS field header");
    const field = field_bounds(new DataView(view.buffer, view.byteOffset + start, 8), start, limit);
    for(let i = field.end; i < field.next; i++)
        if(view.getUint8(i)) throw new Error("Invalid SIS field padding");
    return field;
}

async function view_at(file, at, length)
{
    const bytes = await file.slice(at, at + length).arrayBuffer();
    if(bytes.byteLength !== length) throw new Error("SIS package changed while reading");
    return new DataView(bytes);
}

async function read_blob_field(file, start, limit)
{
    if(start + 8 > limit) throw new Error("Truncated SIS field header");
    const field = field_bounds(await view_at(file, start, 8), start, limit);
    if(field.next !== field.end)
    {
        const padding = await view_at(file, field.end, field.next - field.end);
        if(new Uint8Array(padding.buffer).some(byte => byte)) throw new Error("Invalid SIS field padding");
    }
    return field;
}

async function field_crc(file, field, signal)
{
    let crc = 0, count = 0;
    const reader = file.slice(field.start, field.next).stream().getReader();
    try
    {
        for(;;)
        {
            signal?.throwIfAborted();
            const { done, value } = await reader.read();
            if(done) break;
            count += value.length;
            crc = crc16(value, 0, value.length, 1, crc);
        }
    }
    catch(error)
    {
        await reader.cancel().catch(() => {});
        throw error;
    }
    finally { reader.releaseLock(); }
    if(count !== field.next - field.start) throw new Error("SIS package changed while reading");
    return crc;
}

async function expand_controller(blob, length, signal)
{
    const out = new Uint8Array(length);
    const reader = blob.stream().pipeThrough(new DecompressionStream("deflate")).getReader();
    let used = 0;
    try
    {
        for(;;)
        {
            signal?.throwIfAborted();
            const { done, value } = await reader.read();
            if(done) break;
            if(value.length > length - used) throw new Error("SIS controller expands past its declared size");
            out.set(value, used);
            used += value.length;
        }
    }
    catch(error)
    {
        await reader.cancel().catch(() => {});
        signal?.throwIfAborted();
        throw new Error("Invalid compressed SIS controller", { cause: error });
    }
    finally { reader.releaseLock(); }
    if(used !== length) throw new Error("Incorrect expanded SIS controller size");
    return out;
}

/** Checks bounded package structure and integrity. Signature and install policy belong to the guest. */
export async function inspect_sis(file, signal = undefined)
{
    signal?.throwIfAborted();
    if(!/\.sisx?$/i.test(file.name || "")) throw new Error("Choose a .sis or .sisx file");
    if(!Number.isSafeInteger(file.size) || file.size < 24 || file.size > SIS_PACKAGE_LIMIT)
        throw new Error("SIS package size is outside the supported range");
    const view = await view_at(file, 0, 16);
    const bytes = new Uint8Array(view.buffer);
    const uid = view.getUint32(8, true);
    if(view.getUint32(0, true) !== PACKAGE_UID || view.getUint32(4, true) !== 0 || !uid)
        throw new Error("This package does not have a Symbian OS 9.x SIS header");
    const checksum = (crc16(bytes, 1, 12, 2) * 65536) + crc16(bytes, 0, 12, 2);
    if(view.getUint32(12, true) !== checksum) throw new Error("SIS UID checksum mismatch");
    const contents = await read_blob_field(file, 16, file.size);
    if(contents.type !== CONTENTS || contents.next !== file.size) throw new Error("Invalid SIS contents length");

    let next = await read_blob_field(file, contents.value, contents.end);
    const checksums = new Map();
    for(const type of [CONTROLLER_CRC, DATA_CRC])
    {
        if(next.type !== type) continue;
        if(next.length !== 2) throw new Error("Invalid SIS checksum length");
        checksums.set(type, (await view_at(file, next.value, 2)).getUint16(0, true));
        next = await read_blob_field(file, next.next, contents.end);
    }
    const controller = next, data = await read_blob_field(file, controller.next, contents.end);
    if(controller.type !== COMPRESSED || controller.length < 20 || data.type !== DATA || data.next !== contents.end)
        throw new Error("Invalid SIS controller or file data field");
    const units = await read_blob_field(file, data.value, data.end);
    if(units.type !== ARRAY || units.length < 4 || units.next !== data.end ||
        (await view_at(file, units.value, 4)).getUint32(0, true) !== DATA_UNIT)
        throw new Error("Invalid SIS data array");
    const encoding = await view_at(file, controller.value, 12);
    const algorithm = encoding.getUint32(0, true);
    const size = encoding.getBigUint64(4, true);
    if(size < 24n || size > BigInt(CONTROLLER_LIMIT) || algorithm > 1 || controller.length > CONTROLLER_LIMIT * 2)
        throw new Error("Unsupported SIS controller encoding or size");
    const packed = file.slice(controller.value + 12, controller.end);
    if(algorithm === 0 && packed.size !== Number(size)) throw new Error("Incorrect SIS controller size");
    if(checksums.has(CONTROLLER_CRC) && checksums.get(CONTROLLER_CRC) !== await field_crc(file, controller, signal))
        throw new Error("SIS controller checksum mismatch");
    const raw = algorithm === 1 ? await expand_controller(packed, Number(size), signal) : new Uint8Array(await packed.arrayBuffer());
    if(raw.length !== Number(size)) throw new Error("Incorrect SIS controller size");
    const inner = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    const root = read_field(inner, 0, raw.length), info = read_field(inner, root.value, root.end);
    const id = read_field(inner, info.value, info.end);
    if(root.type !== CONTROLLER || root.next !== raw.length || info.type !== INFO || id.type !== UID ||
        id.length !== 4 || inner.getUint32(id.value, true) !== uid) throw new Error("SIS controller UID does not match the header");
    if(checksums.has(DATA_CRC) && checksums.get(DATA_CRC) !== await field_crc(file, data, signal))
        throw new Error("SIS data checksum mismatch");
    signal?.throwIfAborted();
    return { uid };
}
