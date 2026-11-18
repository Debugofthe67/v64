import { inspect_sis } from "./sis.js";

const SECTOR = 512, START = 2048, ROOT_SECTORS = 16, COPIES = 2;
const MiB = 1024 ** 2;
const VOLUME = "V86SIS     ";

function card_layout(files)
{
    for(let size = 16 * MiB; size <= 2048 * MiB; size *= 2)
    {
        const total = size / SECTOR - START;
        const per_cluster = Math.max(4, size / (32 * MiB));
        const cluster = SECTOR * per_cluster;
        const fatsz = Math.ceil(((total - 1 - ROOT_SECTORS) / per_cluster + 2) / (SECTOR / 2 + COPIES / per_cluster));
        const header_size = (START + 1 + COPIES * fatsz + ROOT_SECTORS) * SECTOR;
        const blocks = files.reduce((sum, file) => sum + Math.ceil(file.size / cluster), 1);
        if(blocks <= Math.floor((size - header_size) / cluster))
            return { size, total, per_cluster, cluster, fatsz, header_size, data_bytes: blocks * cluster };
    }
    throw new Error("The packages do not fit in a 2 GiB FAT16 microSD transfer card");
}

/** @param {File[]} files @param {AbortSignal} [signal] */
export async function sis_card_files(files, signal)
{
    // One directory cluster holds 62 files after the dot entries on the smallest card.
    if(!files.length || files.length > 62) throw new Error("Choose one to 62 SIS packages");
    card_layout(files);
    const packages = [];
    for(const [index, file] of files.entries())
    {
        try
        {
            const { uid } = await inspect_sis(file, signal);
            const stem = "PKG" + (index + 1).toString().padStart(5, "0");
            packages.push({ file, uid, stem, path: "F:\\INSTALL\\" + stem + ".SIS" });
        }
        catch(error)
        {
            signal?.throwIfAborted();
            throw new Error(file.name + " — " + error.message, { cause: error });
        }
    }
    return packages;
}

/** @param {Awaited<ReturnType<typeof sis_card_files>>} packages @param {number} serial */
export function make_sis_card(packages, serial)
{
    const { size, total, per_cluster, cluster: cluster_bytes, fatsz, header_size, data_bytes } = card_layout(packages.map(pkg => pkg.file));
    const header = new Uint8Array(header_size);
    const view = new DataView(header.buffer), encode = value => new TextEncoder().encode(value);
    const word = (at, value) => view.setUint16(at, value, true);
    const dword = (at, value) => view.setUint32(at, value, true);

    header.set([0, 0x20, 0x21, 0, 0x0E, 0xFE, 0xFF, 0xFF], 446);
    dword(454, START);
    dword(458, total);
    word(510, 0xAA55);
    const boot = START * SECTOR;
    header.set([0xEB, 0x3C, 0x90], boot);
    header.set(encode("V86SIS  "), boot + 3);
    word(boot + 11, SECTOR);
    header[boot + 13] = per_cluster;
    word(boot + 14, 1);
    header[boot + 16] = COPIES;
    word(boot + 17, ROOT_SECTORS * SECTOR / 32);
    word(boot + 19, total < 0x10000 ? total : 0);
    header[boot + 21] = 0xF8;
    word(boot + 22, fatsz);
    word(boot + 24, 63);
    word(boot + 26, 255);
    dword(boot + 28, START);
    dword(boot + 32, total < 0x10000 ? 0 : total);
    header[boot + 36] = 0x80;
    header[boot + 38] = 0x29;
    dword(boot + 39, serial);
    header.set(encode(VOLUME + "FAT16   "), boot + 43);
    header.set([0xEB, 0xFE], boot + 62);
    word(boot + 510, 0xAA55);

    const fat = boot + SECTOR, root = fat + COPIES * fatsz * SECTOR;
    word(fat, 0xFFF8);
    word(fat + 2, 0xFFFF);
    word(fat + 4, 0xFFFF);
    const install = new Uint8Array(cluster_bytes), entries = new DataView(install.buffer);
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
    entry(roots, 1, "INSTALL    ", 0x10, 2);
    entry(entries, 0, ".          ", 0x10, 2);
    entry(entries, 1, "..         ", 0x10);
    /** @type {BlobPart[]} */
    const parts = [header, install];
    let cluster = 3;
    for(const [index, { file, stem }] of packages.entries())
    {
        const blocks = Math.ceil(file.size / cluster_bytes);
        const end = cluster + blocks;
        entry(entries, index + 2, stem + "SIS", 0x20, cluster, file.size);
        for(; cluster < end; cluster++) word(fat + cluster * 2, cluster + 1 === end ? 0xFFFF : cluster + 1);
        parts.push(file, new Uint8Array(blocks * cluster_bytes - file.size));
    }
    header.copyWithin(fat + fatsz * SECTOR, fat, fat + fatsz * SECTOR);
    const zero = new Blob([new Uint8Array(MiB)]);
    for(let remaining = size - header.length - data_bytes; remaining > 0; remaining -= MiB)
        parts.push(remaining < MiB ? zero.slice(0, remaining) : zero);
    return new File(parts, "sis-transfer.img", { type: "application/octet-stream" });
}
