import { c_string, equals, u16, u32 } from "../android/bytes.js";
import { SHA256, sha256_hex } from "../image/sha256.js";
import { fpsx_group_data, parse_fpsx, validate_fpsx_layout } from "./fpsx.js";
import { rebuild_eka2_rom } from "./rom.js";

// The 22.0.110 SOS+CORE group starts with 3 KiB of separate metadata.
// Each SOS+ROFS group has the same-size reserved zero area before its header.
const SOS_PREFIX_SIZE = 0xC00;

function data_ranges(blocks)
{
    const ranges = [];
    for(const block of blocks)
    {
        const last = ranges.at(-1);
        if(last?.end === block.start) last.end = block.end;
        else ranges.push({ start: block.start, end: block.end });
    }
    return ranges;
}

function describe_fpsx(parsed)
{
    return {
        bytes: parsed.bytes.length,
        header_end: parsed.header_end,
        header_fields: parsed.tlvs,
        block_count: parsed.blocks.length,
        erase_ranges: parsed.erase_ranges,
        groups: parsed.groups.map(group => ({
            label: group.label,
            space: group.space,
            certificate_blocks: group.certificates.length,
            certificate_range: group.certificates.length ? { start: group.certificates[0].start, end: group.certificates[0].end } : null,
            data_blocks: group.data.length,
            data_ranges: data_ranges(group.data),
        })),
    };
}

function selected_group(container, label)
{
    const groups = container.groups.filter(group => group.label === label && group.data.length);
    if(groups.length !== 1) throw new Error(`N97: expected one ${label || "UDA"} payload group, got ${groups.length}`);
    const group = groups[0];
    if(group.space.join(",") !== "0,3,0") throw new Error(`N97: ${label || "UDA"} uses an unexpected flash space`);
    return group;
}

function read_rofs(data, label)
{
    // SymbianSource's userlibandfileserver/fileserver/inc/rofs.h (TRofsHeader).
    const prefix = data.subarray(0, SOS_PREFIX_SIZE);
    const body = data.subarray(SOS_PREFIX_SIZE);
    const invalid = reason => { throw new Error(`N97 ${label}: ${reason}`); };
    if(body.length < 48 || prefix.some(byte => byte !== 0) || c_string(body, 0, 4) !== "ROFS")
    {
        invalid("expected the ROFS header after the zero prefix");
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

function rofs_entry(image, start, end, name)
{
    const decoder = new TextDecoder("utf-16le");
    for(let at = start; at + 30 <= end;)
    {
        const size = u16(image, at);
        const name_offset = image[at + 18];
        const name_end = name_offset + 2 * image[at + 29];
        if(size < 30 || at + size > Math.ceil(end / 4) * 4 ||
            name_offset < 30 || name_end > size || at + name_end > end) return null;
        if(decoder.decode(image.subarray(at + name_offset, at + name_end)).toLowerCase() === name)
        {
            return { address: u32(image, at + 24), size: u32(image, at + 20) };
        }
        at = Math.ceil((at + size) / 4) * 4;
    }
    return null;
}

// TRofsDir and TRofsEntry from Symbian's rofs.h. A directory's file block
// lives in a separate part of the image. Preview only the boot language list.
function rofs_language_bytes(image, header)
{
    const tree_end = header.tree_offset + header.tree_size;
    let dir = header.tree_offset;
    for(const name of ["resource", "bootdata"])
    {
        if(dir < header.tree_offset || dir + 12 > tree_end) return null;
        const first = image[dir + 3];
        const size = u16(image, dir);
        if(first < 12 || first > size || dir + size > tree_end) return null;
        const child = rofs_entry(image, dir + first, dir + size, name);
        if(!child) return null;
        dir = child.address;
    }
    if(dir < header.tree_offset || dir + 12 > tree_end) return null;
    const start = u32(image, dir + 4);
    const end = start + u32(image, dir + 8);
    const entries_end = header.entries_offset + header.entries_size;
    if(start < header.entries_offset || end > entries_end) return null;
    const file = rofs_entry(image, start, end, "languages.txt");
    if(!file) return null;
    if(file.address < entries_end || file.address + file.size > header.image_size || file.size > 4096) return new Uint8Array(0);
    return image.subarray(file.address, file.address + file.size);
}

function rofs_languages(image, header)
{
    const bytes = rofs_language_bytes(image, header);
    if(!bytes) return null;
    const utf16 = bytes[0] === 0xff && bytes[1] === 0xfe;
    const text = new TextDecoder(utf16 ? "utf-16le" : "utf-8").decode(bytes);
    return text.split(/\r?\n/).flatMap(line => {
        const language = /^(\d{1,3})(,d)?$/i.exec(line.trim());
        return language ? [{ id: Number(language[1]), default: !!language[2] }] : [];
    });
}

/** @param {!Uint8Array} data */
export function inspect_n97_uda(data)
{
    const invalid = reason => { throw new Error(`N97 UDA: ${reason}`); };
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

function image(name, bytes, size = bytes.length)
{
    const hash = new SHA256().update(bytes);
    if(size > bytes.length)
    {
        const zeros = new Uint8Array(1024 * 1024);
        for(let offset = bytes.length; offset < size; offset += zeros.length)
        {
            hash.update(zeros.subarray(0, Math.min(zeros.length, size - offset)));
        }
    }
    return { name, bytes, size, sha256: hash.hex() };
}

/** @param {{core: !Uint8Array, rofs2: !Uint8Array, rofs3: !Uint8Array, uda: !Uint8Array, eno?: !Uint8Array}} inputs */
export function extract_n97_images(inputs)
{
    const core = parse_fpsx(inputs.core);
    const rofs2 = parse_fpsx(inputs.rofs2);
    const rofs3 = parse_fpsx(inputs.rofs3);
    const uda = parse_fpsx(inputs.uda);
    const eno = inputs.eno ? parse_fpsx(inputs.eno) : null;
    const containers = { core, rofs2, rofs3, uda };
    if(eno) containers.eno = eno;
    validate_fpsx_layout(Object.values(containers));

    const core_group = selected_group(core, "SOS+CORE");
    const core_data = fpsx_group_data(core, core_group);
    const packed = core_data.subarray(SOS_PREFIX_SIZE);
    const rom = rebuild_eka2_rom(packed);
    const files = [
        image("core-prefix.bin", core_data.subarray(0, SOS_PREFIX_SIZE)),
        image("rom.packed.bin", packed.subarray(0, rom.header.stored_size)),
        image("rom.xip.bin", rom.bytes),
    ];
    const rofs_headers = [];
    let languages = [];
    for(const [index, container] of [core, rofs2, rofs3].entries())
    {
        const label = `SOS+ROFS${index + 1}`;
        const group = selected_group(container, label);
        const part = read_rofs(fpsx_group_data(container, group), label);
        files.push(image(`rofs${index + 1}.img`, part.bytes));
        rofs_headers.push({ ...part.header, flash_address: group.data[0].start + SOS_PREFIX_SIZE });
        languages = rofs_languages(part.bytes, part.header) ?? languages;
    }
    const uda_group = selected_group(uda, null);
    const uda_data = fpsx_group_data(uda, uda_group);
    const uda_header = inspect_n97_uda(uda_data);
    files.push(image("uda.fat", uda_data, uda_header.logical_size));

    return {
        files,
        report: {
            containers: Object.fromEntries(Object.entries(containers).map(([key, parsed]) => [key, describe_fpsx(parsed)])),
            rom: { ...rom.header, pages: rom.page_counts, flash_address: core_group.data[0].start + SOS_PREFIX_SIZE,
                core_flash_group_sha256: sha256_hex(core_data), rom_flash_span_sha256: sha256_hex(packed) },
            rofs: rofs_headers, languages,
            uda: { ...uda_header, flash_address: uda_group.data[0].start },
        },
    };
}
