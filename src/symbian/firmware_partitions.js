import { c_string, equals, u16, u32 } from "../android/bytes.js";

// The RM-356 SOS+CORE payloads start with 3 KiB of metadata.
// Their SOS+ROFS groups reserve the same prefix before each layer.
export const SOS_PREFIX_SIZE = 0xC00;

/** @param {!Uint8Array} data @param {string} label @param {number=} prefix_size */
export function read_sos_rofs(data, label, prefix_size = SOS_PREFIX_SIZE)
{
    // SymbianSource's userlibandfileserver/fileserver/inc/rofs.h (TRofsHeader).
    const prefix = data.subarray(0, prefix_size);
    const body = data.subarray(prefix_size);
    const invalid = reason => { throw new Error(`${label}: ${reason}`); };
    if(body.length < 48 || prefix.some(byte => byte !== 0) || c_string(body, 0, 4) !== "ROFS")
    {
        invalid(prefix_size ? "expected the ROFS header after the zero prefix" : "expected the ROFS header");
    }
    const header_size = body[4];
    const format_version = u16(body, 6);
    const tree_offset = u32(body, 8);
    const tree_size = u32(body, 12);
    const entries_offset = u32(body, 16);
    const entries_size = u32(body, 20);
    const image_size = u32(body, 36);
    const max_size = u32(body, 44);
    if(header_size !== 48 || format_version !== 0x0200 || tree_offset !== header_size || tree_size < 12 ||
        tree_offset + tree_size > entries_offset || entries_offset + entries_size > image_size ||
        image_size > body.length || image_size > max_size)
    {
        invalid("invalid ROFS header or directory extents");
    }
    if(body.length - image_size >= 4096 || body.subarray(image_size).some(byte => byte !== 0xFF))
    {
        invalid("unexpected bytes after the ROFS image");
    }
    return {
        bytes: body.subarray(0, image_size),
        header: {
            format: "ROFS", format_version, header_size, image_size, max_size, tree_offset, tree_size, entries_offset, entries_size,
            version: [body[32], body[33], u16(body, 34)], checksum: u32(body, 40),
        },
    };
}

/** @param {!Uint8Array} data @param {string} label */
export function inspect_fat16_uda(data, label)
{
    const invalid = reason => { throw new Error(`${label}: ${reason}`); };
    if(data.length < 512 || u16(data, 510) !== 0xAA55) invalid("missing FAT boot sector");
    const sector_size = u16(data, 11);
    const sectors_per_cluster = data[13];
    const reserved = u16(data, 14);
    const fat_count = data[16];
    const root_entry_count = u16(data, 17);
    const fat_sectors = u16(data, 22);
    const sectors = u16(data, 19) || u32(data, 32);
    if(![512, 1024, 2048, 4096].includes(sector_size) || !sectors_per_cluster || sectors_per_cluster & sectors_per_cluster - 1 ||
        !reserved || ![1, 2].includes(fat_count) || !root_entry_count || !fat_sectors || data.length % sector_size)
    {
        invalid("invalid FAT16 BPB geometry");
    }
    const root_sectors = Math.ceil(root_entry_count * 32 / sector_size);
    const fat_size = fat_sectors * sector_size;
    const data_sector = reserved + fat_count * fat_sectors + root_sectors;
    const clusters = Math.floor((sectors - data_sector) / sectors_per_cluster);
    const logical_size = sectors * sector_size;
    if(clusters < 4085 || clusters >= 65525 || (clusters + 2) * 2 > fat_size ||
        data_sector * sector_size > data.length || data.length > logical_size)
    {
        invalid("invalid or truncated FAT16 volume");
    }

    const fat = data.subarray(reserved * sector_size, reserved * sector_size + fat_size);
    if(u16(fat, 0) !== (0xFF00 | data[21]) || u16(fat, 2) < 0xFFF8) invalid("invalid FAT16 reserved entries");
    if(fat_count === 2 && !equals(fat, data.subarray(reserved * sector_size + fat_size, reserved * sector_size + 2 * fat_size)))
    {
        invalid("the FAT16 copies differ");
    }
    let last_used_cluster = 1;
    for(let cluster = 2; cluster < clusters + 2; cluster++)
    {
        if(u16(fat, cluster * 2)) last_used_cluster = cluster;
    }
    const last_used_end = (data_sector + (last_used_cluster - 1) * sectors_per_cluster) * sector_size;
    if(last_used_end > data.length) invalid("a FAT16 cluster in use lies beyond the supplied flash data");
    return {
        format: "FAT16", sector_size, sectors_per_cluster, sectors, reserved_sectors: reserved, fat_count, fat_sectors,
        root_entry_count, data_sector, clusters, last_used_cluster, last_used_end, logical_size,
        flash_data_size: data.length, zero_fill_bytes: logical_size - data.length,
    };
}
