import { equals, u16, u32 } from "../android/bytes.js";
import { read_eka2_rom_directory, read_flat_eka2_rom } from "./rom.js";
import { SYBORG_PROFILE } from "./syborg_profile.js";

const IMAGE_HEADER_SIZE = 0x78;
const EXECUTABLE_UIDS = [0x10000079, 0x1000007A];

function invalid(message)
{
    throw new Error("Syborg ROM: " + message);
}

/** Validate the linked ROM directories, executables, dependencies and exception search table. */
export function inspect_syborg_xip(bytes)
{
    const header = read_flat_eka2_rom(bytes);
    const base = header.rom_base;
    if(base !== SYBORG_PROFILE.rom_base || header.kernel_data_address !== SYBORG_PROFILE.kernel_data_address ||
        (header.kernel_config_flags >>> 25 & 0xF) !== SYBORG_PROFILE.personality_id ||
        header.rom_size + SYBORG_PROFILE.rom_address > SYBORG_PROFILE.ram_size)
    {
        invalid("unexpected ROM base, memory layout or sym94 personality");
    }
    const directory = read_eka2_rom_directory(bytes, header);
    const ekern = directory.files.get("sys/bin/ekern.exe");
    const efile = directory.files.get("sys/bin/efile.exe");
    const kasyborg = directory.files.get("sys/bin/kasyborg.dll");
    if(header.primary_image?.name.toLowerCase() !== "ekern.exe" ||
        !ekern || header.primary_image.image_header_address !== ekern.address ||
        !efile || header.secondary_image?.directory_entry_address !== efile.directory_entry ||
        !kasyborg || [ekern, efile, kasyborg].some(file => !(file.attr & 0x80)))
    {
        invalid("missing Syborg kernel, BSP or efile.exe entry");
    }
    const images = new Map();
    const by_code = new Map();
    const ranges = new Map();
    function add_range(start, end, name, attr = undefined)
    {
        const previous = ranges.get(start);
        if(previous)
        {
            if(attr !== undefined && previous.attr === attr && previous.end === end) return;
            invalid(`overlapping ROM ranges for ${previous.name} and ${name}`);
        }
        if(start < base || end > base + bytes.length || end <= start) invalid(`out-of-range extent for ${name}`);
        ranges.set(start, { start, end, name, attr });
    }
    add_range(base, base + header.header_size, "header");
    for(const range of directory.ranges) add_range(range.start, range.end, "directory");
    for(const [path, file] of directory.files)
    {
        const at = file.address - base;
        const executable = !!(file.attr & 0x80);
        const size = file.size + (executable ? IMAGE_HEADER_SIZE : 0);
        add_range(file.address, file.address + size, path, file.attr);
        if(!executable || images.has(file.address)) continue;
        const entry = (u32(bytes, at + 16) & ~1) >>> 0;
        const code = u32(bytes, at + 20);
        const code_size = u32(bytes, at + 28);
        const text_size = u32(bytes, at + 32);
        const data = u32(bytes, at + 24);
        const data_size = u32(bytes, at + 36);
        const dependency_directory = u32(bytes, at + 56);
        const export_count = u32(bytes, at + 60);
        const export_directory = u32(bytes, at + 64);
        if(!EXECUTABLE_UIDS.includes(u32(bytes, at)) || code !== file.address + IMAGE_HEADER_SIZE ||
            !text_size || text_size > code_size || code_size > file.size ||
            entry < code || entry >= code + text_size ||
            data_size && (data < code || data + data_size > file.address + size))
        {
            invalid("invalid linked image header for " + path);
        }
        const deps = dependency_directory - base;
        const exp = export_directory - base;
        if(dependency_directory && (deps < 0 || deps % 4 || deps + 4 > bytes.length ||
            deps + 4 + u16(bytes, deps + 2) * 4 > bytes.length) ||
            export_count && (exp % 4 || export_directory < code || export_directory + export_count * 4 > code + code_size))
        {
            invalid("invalid export or dependency table for " + path);
        }
        for(let ordinal = 0; ordinal < export_count; ordinal++)
        {
            const target = (u32(bytes, exp + ordinal * 4) & ~1) >>> 0;
            // EKERN also exports data in the kernel's linked data section.
            if(target && (target < code || target >= code + code_size) &&
                !(path === "sys/bin/ekern.exe" && target >= header.kernel_data_address && target < header.kernel_limit))
            {
                invalid(`invalid export ordinal ${ordinal + 1} for ${path}`);
            }
        }
        images.set(file.address, { path, code, code_size, deps, export_count, exp });
        by_code.set(code, file.address);
    }
    for(const { path, deps } of images.values())
    {
        if(deps < 0) continue;
        const count = u16(bytes, deps + 2);
        for(let i = 0; i < count; i++)
        {
            if(!images.has(u32(bytes, deps + 4 + i * 4))) invalid("unlisted ROM dependency of " + path);
        }
    }

    const est = header.exception_table - base;
    if(est < 0 || est + 8 > bytes.length) invalid("exception search table outside the image");
    const count = u32(bytes, est);
    if(!count || est + 8 + count * 4 > bytes.length) invalid("invalid exception search table extent");
    add_range(header.exception_table, header.exception_table + 8 + count * 4, "exception search table");
    let previous = 0;
    for(let i = 0; i <= count; i++)
    {
        const code = u32(bytes, est + 4 + i * 4);
        if(code <= previous || (i < count ? !by_code.has(code) : code > base + bytes.length))
        {
            invalid("invalid exception search table address");
        }
        previous = code;
    }
    let last;
    for(const range of [...ranges.values()].sort((a, b) => a.start - b.start))
    {
        if(last && range.start < last.end) invalid(`overlapping ROM ranges for ${last.name} and ${range.name}`);
        last = range;
    }
    return { header, directory, images, exception_entries: count };
}

/** Compare romcompose's output with its original firmware and build inventory. */
export function audit_syborg_xip(bytes, xip, core, composition)
{
    const original = read_eka2_rom_directory(core.bytes, core.header);
    const base = xip.header.rom_base;
    const start = SYBORG_PROFILE.firmware_user_base - base;
    if(!equals(bytes.subarray(start, core.bytes.length), core.bytes.subarray(start)))
    {
        invalid("the firmware's linked user window differs from CORE");
    }

    const files = new Set();
    let user_files = 0;
    for(const line of new TextDecoder("utf-8", { fatal: true }).decode(composition).trimEnd().split(/\r?\n/))
    {
        // qembian calls the source side "N95" for every model passed as --n95.
        const row = /^([0-9a-f]{8}) +([0-9]+) ([0-9a-f]{2}) (N95 |OURS) (.+)$/.exec(line);
        if(!row) invalid("invalid qembian composition inventory row");
        const [, address, size, attr, source, name] = row;
        const path = name.toLowerCase();
        const file = xip.directory.files.get(path);
        if(!file || files.has(path) || file.address !== parseInt(address, 16) ||
            file.size !== Number(size) || file.attr !== parseInt(attr, 16))
        {
            invalid("composition inventory does not match ROM directory for " + name);
        }
        files.add(path);
        if(source === "OURS")
        {
            if(file.address >= SYBORG_PROFILE.firmware_user_base && file.address < base + core.bytes.length)
            {
                invalid("replacement placed inside firmware user window: " + name);
            }
            continue;
        }
        const prior = original.files.get(path);
        if(!prior || prior.address !== file.address || prior.size !== file.size || prior.attr !== file.attr ||
            file.address < SYBORG_PROFILE.firmware_user_base || file.address + file.size > base + core.bytes.length)
        {
            invalid("changed original firmware link address or directory entry for " + name);
        }
        user_files++;
    }
    if(files.size !== xip.directory.files.size || !user_files) invalid("incomplete composition inventory");

    const euser = xip.images.get(xip.directory.files.get("sys/bin/euser.dll")?.address);
    if(!euser || !euser.export_count) invalid("missing EUser exports");
    const ordinals_by_target = new Map();
    for(let i = 0; i < euser.export_count; i++)
    {
        const target = u32(bytes, euser.exp + i * 4);
        if(!target) continue;
        if(!ordinals_by_target.has(target)) ordinals_by_target.set(target, []);
        ordinals_by_target.get(target).push(i + 1);
    }
    const imported = new Set();
    let linked_thunks = 0;
    for(const image of xip.images.values())
    {
        if(image.code < SYBORG_PROFILE.firmware_user_base || image.code >= base + core.bytes.length) continue;
        const end = image.code - base + image.code_size;
        for(let at = image.code - base; at + 8 <= end; at += 4)
        {
            if(u32(bytes, at) !== 0xE51FF004) continue; // rombuild's ARM LDR PC, [PC, #-4] plus absolute target
            const ordinals = ordinals_by_target.get(u32(bytes, at + 4));
            if(!ordinals) continue;
            linked_thunks++;
            for(const ordinal of ordinals) imported.add(ordinal);
        }
    }
    if(!linked_thunks) invalid("no linked EUser import thunks found");
    return { user_files, replacement_files: files.size - user_files, euser_exports: euser.export_count,
        euser_linked_thunks: linked_thunks, euser_imported_ordinals: imported.size };
}
