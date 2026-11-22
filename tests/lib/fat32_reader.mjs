// Read bounded guest-written artifacts from a read-only FAT disk adapter.
async function read_fat(disk, filename, list_directory, bits)
{
    const blob = disk instanceof Blob;
    async function read(at, size) {
        if(at < 0 || size < 0 || at + size > (blob ? disk.size : disk.byteLength))
            throw new Error("FAT read outside disk");
        if(blob) return new Uint8Array(await disk.slice(at, at + size).arrayBuffer());
        return new Promise(resolve => disk.get(at, size, bytes => resolve(new Uint8Array(bytes).slice())));
    }
    const view = bytes => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const fat32 = bits === 32;
    const type_at = fat32 ? 82 : 54;
    const matches_type = boot => new TextDecoder().decode(boot.subarray(type_at, type_at + 8)).trim() === "FAT" + bits;
    let boot = await read(0, 512), base = 0;
    if(!matches_type(boot)) {
        base = view(boot).getUint32(454, true) * 512;
        boot = await read(base, 512);
    }
    const header = view(boot), sector = header.getUint16(11, true), cluster = sector * boot[13];
    if(sector !== 512 || !cluster || !matches_type(boot))
        throw new Error("Expected FAT" + bits + " with 512-byte sectors");
    const fat_size = (fat32 ? header.getUint32(36, true) : header.getUint16(22, true)) * sector;
    if(!fat_size || fat_size > 32 * 1024 * 1024) throw new Error("FAT outside reader limit");
    const fat_at = base + header.getUint16(14, true) * sector;
    const fat = view(await read(fat_at, fat_size));
    const root_at = fat_at + boot[16] * fat_size;
    const root_size = fat32 ? 0 : header.getUint16(17, true) * 32;
    const data_at = root_at + Math.ceil(root_size / sector) * sector;
    const first_end = fat32 ? 0x0ffffff8 : 0xfff8;
    const entry_size = bits / 8;
    async function chain(first, limit = 32 * 1024 * 1024) {
        const seen = new Set(), chunks = [];let length = 0;
        for(let next = first; next >= 2 && next < first_end;) {
            const entry = next * entry_size;
            if(seen.has(next) || entry + entry_size > fat.byteLength || length >= 32 * 1024 * 1024)
                throw new Error("Invalid or oversized FAT chain");
            seen.add(next);chunks.push(await read(data_at + (next - 2) * cluster, cluster));length += cluster;
            if(length >= limit) break;
            next = fat32 ? fat.getUint32(entry, true) & 0x0fffffff : fat.getUint16(entry, true);
        }
        const result = new Uint8Array(Math.min(length, limit));let at = 0;
        for(const bytes of chunks) {const count = Math.min(bytes.length, result.length - at);result.set(bytes.subarray(0, count), at);at += count;}
        return result;
    }
    function entries(bytes) {
        const result = [];let long = [];
        for(let at = 0; at + 32 <= bytes.length && bytes[at]; at += 32) {
            const row = bytes.subarray(at, at + 32), entry = view(row);
            if(row[0] === 0xe5) {long = [];continue;}
            if(row[11] === 15) {
                const text = new Uint8Array([...row.subarray(1, 11), ...row.subarray(14, 26), ...row.subarray(28, 32)]);
                long.unshift(new TextDecoder("utf-16le").decode(text).split("\0")[0].replaceAll("\uffff", ""));continue;
            }
            const short = new TextDecoder().decode(row.subarray(0, 8)).trim() +
                (row[8] === 32 ? "" : "." + new TextDecoder().decode(row.subarray(8, 11)).trim());
            const name = long.join("") || short;long = [];
            if(row[11] & 8 || name === "." || name === "..") continue;
            const high_cluster = fat32 ? entry.getUint16(20, true) * 65536 : 0;
            result.push({name, short, cluster:high_cluster + entry.getUint16(26, true),
                size:entry.getUint32(28, true), directory:!!(row[11] & 16)});
        }
        return result;
    }
    let directory = fat32 ? await chain(header.getUint32(44, true)) : await read(root_at, root_size);
    const parts = filename.replaceAll("\\", "/").split("/").filter(Boolean);
    for(let index = 0; index < parts.length; index++) {
        const found = entries(directory).find(entry =>
            [entry.name, entry.short].some(value => value.toLowerCase() === parts[index].toLowerCase()));
        if(!found) return null;
        if(index === parts.length - 1) {
            if(list_directory) {
                if(!found.directory) throw new Error("Requested a file as a directory");
                return entries(await chain(found.cluster));
            }
            if(found.directory) throw new Error("Requested a directory");
            if(found.size > 32 * 1024 * 1024) throw new Error("Artifact exceeds reader limit");
            const bytes = found.size ? await chain(found.cluster, found.size) : new Uint8Array(0);
            if(bytes.length !== found.size) throw new Error("Truncated FAT file");
            return bytes;
        }
        if(!found.directory) return null;
        directory = await chain(found.cluster);
    }
    if(list_directory) return entries(directory);
    throw new Error("Empty FAT filename");
}

export const read_fat32_file = (disk, filename) => read_fat(disk, filename, false, 32);
export const list_fat32_directory = (disk, dirname) => read_fat(disk, dirname, true, 32);
export const read_fat16_file = (disk, filename) => read_fat(disk, filename, false, 16);
export const list_fat16_directory = (disk, dirname) => read_fat(disk, dirname, true, 16);
