import { c_string, equals, u16, u32, u32be } from "../android/bytes.js";
import { SHA256, sha256_hex } from "../image/sha256.js";
import { fpsx_group_data, parse_fpsx, validate_fpsx_layout } from "./fpsx.js";
import { N97_CORE_ADDRESS, N97_CORE_HEADER_OFFSET, usable_n97_modem_address, write_n97_boot_media } from "./n97_boot_media.js";
import { N97_BML_USER_BLOCKS, N97_FLASH_BLOCK, seed_n97_flash } from "./n97_flash.js";
import { inflate } from "../virt/inflate.js";
import { rebuild_eka2_rom } from "./rom.js";
import { inspect_fat16_uda, read_sos_rofs, SOS_PREFIX_SIZE } from "./firmware_partitions.js";

const IMAGE_NAMES = ["DSP0", "ISASW"];
const FLASH_TOC = 0x80000;
const RECORD_SIZE = 32;
const CERT_SIZE = 0x400;
const RM505_ROOT_KEY = "caeebb65d3c48e6dc73b49dc5063a2ee5867d611";

function invalid_boot_media(message)
{
    throw new Error("Nokia N97 boot media: " + message);
}

/** @param {ReturnType<typeof parse_fpsx>} core @param {ReturnType<typeof parse_fpsx>["groups"][number]} group */
function rm505_certificate(core, group)
{
    // The type-27 FPSX record's 20-byte target key distinguishes its
    // alternatives. The retail RM-505 reports the CAEEBB65… root key.
    const matches = group.certificates.filter(cert =>
        Array.from(core.bytes.subarray(cert.offset + 4, cert.offset + 24),
            byte => byte.toString(16).padStart(2, "0")).join("") === RM505_ROOT_KEY);
    if(matches.length !== 1) invalid_boot_media("expected one RM-505 root-key certificate for " + group.label);
    return matches[0];
}

/** @param {ReturnType<typeof parse_fpsx>} core @param {ReturnType<typeof parse_fpsx>["groups"][number]} group */
export function select_n97_boot_certificate(core, group)
{
    const cert = rm505_certificate(core, group);
    const bytes = core.bytes.subarray(cert.data_offset, cert.data_offset + cert.size);
    if(cert.type !== 0x27 || bytes.length !== CERT_SIZE || u32(bytes, 0) !== 0x809795A3 || u32(bytes, 0x3D0) !== 0x31DEEAE8)
    {
        invalid_boot_media("invalid RM-505 certificate for " + group.label);
    }
    // RAP3NAND+0x600–0x624 retains the entire certificate in SDRAM.
    return { bytes, input_size: u32(bytes, 0x3D4), output_size: u32(bytes, 0x3D8), address: u32(bytes, 0x3DC) };
}

/** @param {ReturnType<typeof parse_fpsx>} core */
export function rm505_bml_partitions(core)
{
    // The RM-505 type EE is a big-endian flash partition request for
    // destination (0,3,0). In the 0x2F4F record, count is at +14 and the
    // following entries hold byte offsets/lengths, converted to erase blocks.
    const tables = core.tlvs.filter(tlv => tlv.type === 0xEE && tlv.size >= 6 &&
        equals(core.bytes.subarray(tlv.data_offset + 3, tlv.data_offset + 6), [0, 3, 0]));
    // Unknown partition request formats still allow an unmodified physical
    // export. Reject corrupt or duplicate tables in the recognized format.
    if(!tables.length || tables.some(tlv => (u32be(core.bytes, tlv.data_offset) >>> 8) !== 0x012F4F)) return null;
    const invalid = () => { throw new Error("N97 OneNAND: invalid RM-505 BML partition table"); };
    if(tables.length !== 1) invalid();
    const { data_offset: offset, size } = tables[0];
    if(size < 18) invalid();
    const count = u32be(core.bytes, offset + 14);
    if(!count || count > 31 || size !== 18 + count * 16) invalid();
    const ids = new Set();
    const partitions = [];
    for(let i = 0; i < count; i++)
    {
        const at = offset + 18 + i * 16;
        const id = u32be(core.bytes, at), attributes = u32be(core.bytes, at + 4);
        const start_block = u32be(core.bytes, at + 8) / N97_FLASH_BLOCK;
        const blocks = u32be(core.bytes, at + 12) / N97_FLASH_BLOCK;
        if(ids.has(id) || ![1, 2, 0x22].includes(attributes) || !Number.isInteger(start_block) ||
            !Number.isInteger(blocks) || !blocks || start_block + blocks > N97_BML_USER_BLOCKS ||
            partitions.some(part => start_block < part.start_block + part.blocks && part.start_block < start_block + blocks))
        {
            invalid();
        }
        ids.add(id);
        partitions.push({ id, attributes, start_block, blocks });
    }
    const frozen_end = Math.max(0, ...partitions.filter(part => part.attributes === 0x22).map(part => part.start_block + part.blocks));
    if(partitions.some(part => part.attributes !== 0x22 && part.start_block < frozen_end)) invalid();
    return partitions;
}

/**
 * @param {!Array<ReturnType<typeof parse_fpsx>>} containers
 * @param {string} rom_digest
 * @param {?} partitions
 * @param {?} factory_uda
 */
function extract_n97_flash(containers, rom_digest, partitions, factory_uda)
{
    // Only the outer streams' application OneNAND destination (0,3,0).
    // Toolbox records and other target spaces are not physical CS0 data.
    const extents = containers.flatMap(container => container.groups.filter(group =>
        group.space[0] === 0 && group.space[1] === 3 && group.space[2] === 0).flatMap(group => {
        const certificates = group.certificates.length ? [rm505_certificate(container, group)] : [];
        return [...certificates, ...group.data].map(record => ({ address: record.start,
            bytes: container.bytes.subarray(record.data_offset, record.data_offset + record.size),
            uda: group === factory_uda?.group && record.type === 0x17 }));
    }));
    if(!extents.length) throw new Error("No RM-505 application OneNAND records");
    return seed_n97_flash(extents, rom_digest, partitions, factory_uda);
}

function flash_toc_record(toc, label)
{
    let record = -1;
    for(let at = 0; at + RECORD_SIZE <= toc.length; at += RECORD_SIZE)
    {
        if(toc[at + 20] === 0xFF) break;
        if(c_string(toc, at + 20, 12) !== label) continue;
        if(record !== -1) invalid_boot_media("duplicate flash TOC entry for " + label);
        record = at;
    }
    if(record === -1) invalid_boot_media("missing flash TOC entry for " + label);
    return { flash: FLASH_TOC + u32(toc, record), limit: u32(toc, record + 4), address: u32(toc, record + 16) };
}

/**
 * Recreate the modem payloads from the CORE's flash TOC and original raw
 * DEFLATE groups, without running either payload or any download.
 * @param {ReturnType<typeof import("./fpsx.js").parse_fpsx>} core
 * @param {!Uint8Array} prefix
 * @param {!Uint8Array} rom
 */
function extract_n97_boot_media(core, prefix, rom)
{
    const groups = IMAGE_NAMES.map(name => core.groups.filter(group => group.label === "SOS*" + name && group.data.length));
    if(groups.every(matches => !matches.length)) return null;
    if(groups.some(matches => matches.length !== 1)) invalid_boot_media("expected one DSP0 and one ISASW group");

    const toc_groups = core.groups.filter(group => group.label === null && group.data[0]?.start === FLASH_TOC);
    if(toc_groups.length !== 1) invalid_boot_media("expected one application flash TOC");
    const toc = fpsx_group_data(core, toc_groups[0]);
    const records = IMAGE_NAMES.map(name => flash_toc_record(toc, "SOS*" + name));
    const core_record = flash_toc_record(toc, "SOS+CORE");
    const core_group = selected_group(core, "SOS+CORE");
    const core_cert = select_n97_boot_certificate(core, core_group);
    if(core_record.address !== N97_CORE_ADDRESS || prefix.length !== SOS_PREFIX_SIZE ||
        core_cert.address !== core_record.address || core_record.flash !== core_group.certificates[0].start ||
        !usable_n97_modem_address(records[0].address) || !usable_n97_modem_address(records[1].address) || records[0].address >= records[1].address)
    {
        invalid_boot_media("unsupported flash TOC load map");
    }

    const images = groups.map(([group], i) => {
        const { flash, limit, address } = records[i];
        const flash_start = group.certificates[0]?.start ?? group.data[0].start;
        if(group.space.join(",") !== "0,3,0" || flash !== flash_start || group.data.at(-1).end > flash + limit)
        {
            invalid_boot_media("flash TOC disagrees with the " + IMAGE_NAMES[i] + " group");
        }
        const cert = select_n97_boot_certificate(core, group);
        const compressed = fpsx_group_data(core, group);
        const capacity = (records[i + 1]?.address ?? N97_CORE_ADDRESS) - address;
        const input_size = cert.input_size - CERT_SIZE;
        const output_size = cert.output_size - CERT_SIZE;
        if(cert.address !== address || input_size <= 0 || input_size > compressed.length ||
            output_size <= 0 || cert.output_size > capacity || compressed.length - input_size >= 512 ||
            compressed.subarray(input_size).some(byte => byte !== 0xFF))
        {
            invalid_boot_media("certificate extents disagree with " + IMAGE_NAMES[i]);
        }
        const decoded = inflate(compressed.subarray(0, input_size), 0, output_size, output_size + 1);
        if(decoded.end !== input_size || decoded.output.length !== output_size)
        {
            invalid_boot_media("invalid DEFLATE extent in " + IMAGE_NAMES[i]);
        }
        const bytes = new Uint8Array(cert.output_size);
        bytes.set(cert.bytes);
        bytes.set(decoded.output, CERT_SIZE);
        return { address, bytes, payload_sha256: sha256_hex(decoded.output) };
    });
    const [dsp, isa] = images;
    const preamble = new Uint8Array(N97_CORE_HEADER_OFFSET);
    preamble.set(core_cert.bytes);
    preamble.set(prefix, CERT_SIZE);
    return {
        bytes: write_n97_boot_media(preamble, rom, dsp, isa),
        report: Object.fromEntries(images.map(({ address, bytes, payload_sha256 }, i) =>
            [IMAGE_NAMES[i], { address, size: bytes.length, sha256: sha256_hex(bytes), payload_sha256 }])),
    };
}

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
    return inspect_fat16_uda(data, "N97 UDA");
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
export function extract_n97_images(inputs, { initialize_bml = true, initialize_stl = initialize_bml } = {})
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
    const xip = image("rom.xip.bin", rom.bytes);
    const files = [
        image("core-prefix.bin", core_data.subarray(0, SOS_PREFIX_SIZE)),
        image("rom.packed.bin", packed.subarray(0, rom.header.stored_size)),
        xip,
    ];
    const boot_media = extract_n97_boot_media(core, core_data.subarray(0, SOS_PREFIX_SIZE), rom.bytes);
    if(boot_media) files.push(image("rapido-boot.bin", boot_media.bytes));
    const rofs_headers = [];
    let languages = [];
    for(const [index, container] of [core, rofs2, rofs3].entries())
    {
        const label = `SOS+ROFS${index + 1}`;
        const group = selected_group(container, label);
        const part = read_sos_rofs(fpsx_group_data(container, group), "N97 " + label);
        files.push(image(`rofs${index + 1}.img`, part.bytes));
        rofs_headers.push({ ...part.header, flash_address: group.data[0].start + SOS_PREFIX_SIZE });
        languages = rofs_languages(part.bytes, part.header) ?? languages;
    }
    const uda_group = selected_group(uda, null);
    const uda_data = fpsx_group_data(uda, uda_group);
    const uda_header = inspect_n97_uda(uda_data);
    const uda_image = image("uda.fat", uda_data, uda_header.logical_size);
    files.push(uda_image);
    const factory_uda = initialize_stl ? { group: uda_group, address: uda_group.data[0].start, bytes: uda_image.bytes,
        size: uda_image.size, sector_size: uda_header.sector_size } : null;
    const nand = extract_n97_flash(Object.values(containers), xip.sha256, initialize_bml ? rm505_bml_partitions(core) : null, factory_uda);
    files.push(nand);

    return {
        files,
        report: {
            containers: Object.fromEntries(Object.entries(containers).map(([key, parsed]) => [key, describe_fpsx(parsed)])),
            rom: { ...rom.header, pages: rom.page_counts, flash_address: core_group.data[0].start + SOS_PREFIX_SIZE,
                core_flash_group_sha256: sha256_hex(core_data), rom_flash_span_sha256: sha256_hex(packed) },
            rofs: rofs_headers, languages, nand: { bml: nand.bml, stl: nand.stl }, ...(boot_media ? { boot_media: boot_media.report } : {}),
            uda: { ...uda_header, flash_address: uda_group.data[0].start },
        },
    };
}
