import { inspect_sis } from "./sis.js";

const SECTOR = 512, MAX_CARD_SLACK = 2048, ROOT_SECTORS = 16, COPIES = 2;
const MAX_DIRECTORY_BYTES = 65536 * 32;
const MiB = 1024 ** 2;
const VOLUME = "V86TRANSFER";
const LFN_OFFSETS = [1, 3, 5, 7, 9, 14, 16, 18, 20, 22, 24, 28, 30];

function card_layout(files)
{
    const folders = new Map();
    for(const entry of files)
    {
        if(!folders.has(entry.folder)) folders.set(entry.folder, { files: [], entries: 3 }); // dot, dotdot, end marker
        const directory = folders.get(entry.folder);
        directory.files.push(entry.file);
        directory.entries += Math.ceil(entry.file.name.length / LFN_OFFSETS.length) + 1;
    }
    for(let size = 16 * MiB; size <= 2048 * MiB; size *= 2)
    {
        // Leave one MiB outside the largest volume so its cluster count
        // stays within FAT16.
        const total = size / SECTOR - (size === 2048 * MiB ? MAX_CARD_SLACK : 0);
        const per_cluster = Math.max(4, size / (32 * MiB));
        const cluster = SECTOR * per_cluster;
        const fatsz = Math.ceil(((total - 1 - ROOT_SECTORS) / per_cluster + 2) / (SECTOR / 2 + COPIES / per_cluster));
        const header_size = (1 + COPIES * fatsz + ROOT_SECTORS) * SECTOR;
        const directories = Array.from(folders, ([name, dir]) => ({ name, files: dir.files,
            blocks: Math.ceil(dir.entries * 32 / cluster) }));
        const blocks = files.reduce((sum, { file }) => sum + Math.ceil(file.size / cluster),
            directories.reduce((sum, dir) => sum + dir.blocks, 0));
        if(blocks <= Math.floor((total - 1 - COPIES * fatsz - ROOT_SECTORS) / per_cluster))
            return { size, total, per_cluster, cluster, fatsz, header_size, data_bytes: blocks * cluster, directories };
    }
    throw new Error("The selected files do not fit on a 2 GiB transfer card");
}

/** @param {File[]} files @param {AbortSignal} [signal] */
export async function transfer_card_files(files, signal)
{
    signal?.throwIfAborted();
    if(!files.length) throw new Error("Choose at least one file");
    const names = new Set();
    const entries = files.map(file => {
        const name = file.name;
        if(!name || name.length > 255 || /^ |[. ]$/.test(name) || /[\x00-\x1F"*/:<>?\\|\uFFFE\uFFFF]/.test(name))
            throw new Error(`${name} — this filename cannot be stored on the transfer card`);
        const folder = /\.sisx?$/i.test(name) ? "INSTALL" : "Transfer";
        const path = `E:\\${folder}\\${name}`;
        const key = path.toUpperCase();
        if(names.has(key)) throw new Error(`Two selected files have the same name on the card: ${path}`);
        names.add(key);
        return { file, folder, path };
    });
    card_layout(entries);
    for(const { file, folder } of entries)
    {
        if(folder !== "INSTALL") continue;
        try
        {
            await inspect_sis(file, signal);
        }
        catch(error)
        {
            signal?.throwIfAborted();
            throw new Error(file.name + " — " + error.message, { cause: error });
        }
    }
    return entries;
}

// VFAT stores 13 UTF-16 units in each long entry. The entries precede
// their 8.3 alias in reverse ordinal order and share its checksum.
function alias_checksum(alias)
{
    let checksum = 0;
    for(let i = 0; i < alias.length; i++)
        checksum = (((checksum & 1) << 7 | checksum >>> 1) + alias.charCodeAt(i)) & 255;
    return checksum;
}

function long_name(dir, index, name, alias)
{
    const checksum = alias_checksum(alias);
    const count = Math.ceil(name.length / LFN_OFFSETS.length);
    for(let part = count; part > 0; part--)
    {
        const at = index++ * 32;
        dir.setUint8(at, part | (part === count ? 0x40 : 0));
        dir.setUint8(at + 11, 15);
        dir.setUint8(at + 13, checksum);
        LFN_OFFSETS.forEach((offset, i) => {
            const position = (part - 1) * LFN_OFFSETS.length + i;
            const unit = position < name.length ? name.charCodeAt(position) : position === name.length ? 0 : 0xFFFF;
            dir.setUint16(at + offset, unit, true);
        });
    }
    return index;
}

/** @param {Awaited<ReturnType<typeof transfer_card_files>>} files @param {number} serial */
export function make_transfer_card(files, serial)
{
    const { size, total, per_cluster, cluster: cluster_bytes, fatsz, header_size, data_bytes, directories } = card_layout(files);
    const header = new Uint8Array(header_size);
    const view = new DataView(header.buffer), encode = value => new TextEncoder().encode(value);
    const word = (at, value) => view.setUint16(at, value, true);
    const dword = (at, value) => view.setUint32(at, value, true);

    header.set([0xEB, 0x3C, 0x90], 0);
    header.set(encode("V86     "), 3);
    word(11, SECTOR);
    header[13] = per_cluster;
    word(14, 1);
    header[16] = COPIES;
    word(17, ROOT_SECTORS * SECTOR / 32);
    word(19, total < 0x10000 ? total : 0);
    header[21] = 0xF8;
    word(22, fatsz);
    word(24, 63);
    word(26, 255);
    dword(32, total < 0x10000 ? 0 : total);
    header[36] = 0x80;
    header[38] = 0x29;
    dword(39, serial);
    header.set(encode(VOLUME + "FAT16   "), 43);
    header.set([0xEB, 0xFE], 62);
    word(510, 0xAA55);

    const fat = SECTOR, root = fat + COPIES * fatsz * SECTOR;
    word(fat, 0xFFF8);
    word(fat + 2, 0xFFFF);
    /** @param {DataView} dir @param {number} index @param {string} name @param {number} attr */
    function entry(dir, index, name, attr, cluster = 0, length = 0)
    {
        const at = index * 32;
        new Uint8Array(dir.buffer, dir.byteOffset + at, 11).set(encode(name));
        dir.setUint8(at + 11, attr);
        dir.setUint16(at + 16, 0x3021, true); // 2004-01-01
        dir.setUint16(at + 18, 0x3021, true);
        dir.setUint16(at + 24, 0x3021, true);
        dir.setUint16(at + 26, cluster, true);
        dir.setUint32(at + 28, length, true);
    }
    const roots = new DataView(header.buffer, root);
    entry(roots, 0, VOLUME, 8);
    /** @type {BlobPart[]} */
    const parts = [header];
    let cluster = 2, root_index = 1;
    function allocate(blocks)
    {
        if(!blocks) return 0;
        const first = cluster, end = cluster + blocks;
        for(; cluster < end; cluster++) word(fat + cluster * 2, cluster + 1 === end ? 0xFFFF : cluster + 1);
        return first;
    }
    for(const directory of directories)
    {
        const bytes = new Uint8Array(directory.blocks * cluster_bytes);
        const dir = new DataView(bytes.buffer), first = allocate(directory.blocks);
        const short = directory.name.toUpperCase().padEnd(11, " ");
        if(directory.name !== short.trim()) root_index = long_name(roots, root_index, directory.name, short);
        entry(roots, root_index++, short, 0x10, first);
        entry(dir, 0, ".          ", 0x10, first);
        entry(dir, 1, "..         ", 0x10);
        parts.push(bytes);

        const names = new Set(directory.files.map(file => file.name.toUpperCase()));
        let index = 2, alias_id = 0;
        for(const file of directory.files)
        {
            const dot = file.name.lastIndexOf(".");
            const ext = dot < 0 ? "" : file.name.slice(dot + 1).toUpperCase().replace(/[^A-Z0-9]/g, "_").slice(0, 3);
            let stem;
            do stem = "F" + (++alias_id).toString(36).toUpperCase().padStart(7, "0");
            while(names.has(ext ? stem + "." + ext : stem));
            const alias = stem + ext.padEnd(3, " ");
            const blocks = Math.ceil(file.size / cluster_bytes);
            index = long_name(dir, index, file.name, alias);
            entry(dir, index++, alias, 0x20, allocate(blocks), file.size);
            if(blocks) parts.push(file, new Uint8Array(blocks * cluster_bytes - file.size));
        }
    }
    header.copyWithin(fat + fatsz * SECTOR, fat, fat + fatsz * SECTOR);
    const zero = new Blob([new Uint8Array(MiB)]);
    for(let remaining = size - header.length - data_bytes; remaining > 0; remaining -= MiB)
        parts.push(remaining < MiB ? zero.slice(0, remaining) : zero);
    return new File(parts, "file-transfer.img", { type: "application/octet-stream" });
}

const VIDEO_TYPES = new Map([
    ["mp4", "video/mp4"], ["m4v", "video/mp4"], ["3gp", "video/3gpp"],
    ["mov", "video/quicktime"], ["webm", "video/webm"],
]);

function directory_entries(bytes)
{
    const dir = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const entries = [];
    let name = "", sequence = 0, checksum = 0;
    for(let at = 0; at + 32 <= bytes.length && bytes[at]; at += 32)
    {
        const marker = bytes[at], attr = bytes[at + 11];
        if(marker === 0xE5) { name = ""; sequence = 0; continue; }
        if(attr === 15)
        {
            const part = marker & 31, check = bytes[at + 13];
            if(marker & 0x40) { name = ""; sequence = part; checksum = check; }
            if(!part || part !== sequence || check !== checksum) { name = ""; sequence = 0; continue; }
            const units = LFN_OFFSETS.map(offset => dir.getUint16(at + offset, true));
            name = String.fromCharCode(...units).split("\0")[0] + name;
            sequence--;
            continue;
        }
        const alias = String.fromCharCode(...bytes.subarray(at, at + 11));
        const long = name && sequence === 0 && checksum === alias_checksum(alias) ? name : "";
        name = "";
        sequence = 0;
        if(attr & 8 || marker === 0x2E) continue;
        const ext = alias.slice(8).trimEnd();
        entries.push({ name: long || alias.slice(0, 8).trimEnd() + (ext ? "." + ext : ""),
            directory: !!(attr & 0x10), cluster: dir.getUint16(at + 26, true), size: dir.getUint32(at + 28, true) });
    }
    return entries;
}

/** Read the video entries on the FAT16 transfer card created by make_transfer_card. @param {Blob} disk */
export async function transfer_card_videos(disk)
{
    const boot = new DataView(await disk.slice(0, SECTOR).arrayBuffer());
    if(boot.byteLength !== SECTOR || boot.getUint16(510, true) !== 0xAA55 || boot.getUint16(11, true) !== SECTOR ||
        String.fromCharCode(...new Uint8Array(boot.buffer, 54, 5)) !== "FAT16")
        throw new Error("The transfer card does not contain a supported FAT16 volume.");
    const cluster_bytes = boot.getUint8(13) * SECTOR;
    const fat_at = boot.getUint16(14, true) * SECTOR, fat_size = boot.getUint16(22, true) * SECTOR;
    const root_at = fat_at + boot.getUint8(16) * fat_size;
    const root_size = boot.getUint16(17, true) * 32;
    const data_at = root_at + Math.ceil(root_size / SECTOR) * SECTOR;
    const total = (boot.getUint16(19, true) || boot.getUint32(32, true)) * SECTOR;
    if(!cluster_bytes || !fat_at || !fat_size || !root_size || total > disk.size || data_at >= total)
        throw new Error("The transfer card has an invalid FAT16 layout.");
    const fat = new DataView(await disk.slice(fat_at, fat_at + fat_size).arrayBuffer());
    const root = new Uint8Array(await disk.slice(root_at, root_at + root_size).arrayBuffer());
    const transfer = directory_entries(root).find(entry => entry.directory && entry.name.toUpperCase() === "TRANSFER");
    if(!transfer) return [];

    // Coalesce consecutive clusters, so a video can be passed to the browser
    // as a Blob without reading the whole card or copying it to phone memory.
    function extents(first, length)
    {
        const ranges = [], visited = new Set();
        let remaining = length;
        for(let cluster = first; cluster < 0xFFF8 && remaining > 0; cluster = fat.getUint16(cluster * 2, true))
        {
            const offset = data_at + (cluster - 2) * cluster_bytes;
            if(cluster < 2 || cluster >= 0xFFF0 || cluster * 2 + 2 > fat.byteLength || offset + cluster_bytes > total || visited.has(cluster))
                throw new Error("The transfer card has a damaged file chain.");
            visited.add(cluster);
            const end = offset + Math.min(remaining, cluster_bytes);
            const previous = ranges.at(-1);
            if(previous && previous.end === offset) previous.end = end;
            else ranges.push({ offset, end });
            remaining -= end - offset;
        }
        if((Number.isFinite(length) && remaining > 0) || !ranges.length)
            throw new Error("The transfer card contains an incomplete file.");
        return ranges;
    }

    const directory = new Blob(extents(transfer.cluster, Infinity).map(({ offset, end }) => disk.slice(offset, end)));
    if(directory.size > MAX_DIRECTORY_BYTES) throw new Error("The transfer directory is too large.");
    return directory_entries(new Uint8Array(await directory.arrayBuffer())).flatMap(entry => {
        const dot = entry.name.lastIndexOf(".");
        const type = dot < 0 ? undefined : VIDEO_TYPES.get(entry.name.slice(dot + 1).toLowerCase());
        if(entry.directory || !entry.size || !type) return [];
        return [{ name: entry.name, open: () => new Blob(extents(entry.cluster, entry.size).map(({ offset, end }) =>
            disk.slice(offset, end)), { type }) }];
    });
}
