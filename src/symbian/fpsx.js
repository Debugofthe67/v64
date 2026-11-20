// Nokia BB5 FPSX records used by RM-505 and RM-356. Header layouts are
// cross-checked with EKA2L1's FPSX reader and saur0n/unpacker.

import { c_string, u32be } from "../android/bytes.js";

const WIDE_TLVS = new Set([0xE4, 0xE5, 0xEA, 0xEE, 0xF3]);
const BLOCK_TYPES = {
    0x17: { content: 0x54, header_size: 14, storage_at: 0, checksum_at: 3, range_at: 6 },
    0x27: { content: 0x5D, header_size: 45, storage_at: 32, checksum_at: 35, range_at: 37 },
    0x28: { content: 0x5D, header_size: 67, storage_at: 32, checksum_at: 35, range_at: 37 },
};

function invalid(message, offset)
{
    throw new Error(`FPSX at 0x${offset.toString(16)}: ${message}`);
}

function read_tlvs(bytes, start, end, count)
{
    const entries = [];
    let at = start;
    for(let i = 0; i < count; i++)
    {
        if(at + 2 > end) invalid("truncated TLV header", at);
        const offset = at;
        const type = bytes[at++];
        const wide = WIDE_TLVS.has(type);
        if(wide && at + 2 > end) invalid("truncated TLV length", offset);
        let size = wide ? (bytes[at] << 8 | bytes[at + 1]) : bytes[at];
        at += wide ? 2 : 1;
        if(type === 0xFA && size === 0)
        {
            // Embedded flash toolbox. Its records are not programmed by the outer stream.
            if(at + 4 > end) invalid("truncated toolbox length", offset);
            size = u32be(bytes, at);
            at += 4;
        }
        if(at + size > end) invalid("TLV extends past its header", offset);
        entries.push({ type, offset, data_offset: at, size });
        at += size;
    }
    if(at !== end) invalid("unaccounted bytes after the TLVs", at);
    return entries;
}

function erase_ranges(bytes, tlvs)
{
    const ranges = [];
    for(const tlv of tlvs)
    {
        if(tlv.type !== 0xC8) continue;
        const offset = tlv.data_offset;
        if(tlv.size < 1) invalid("truncated erase schedule", offset);
        for(const entry of read_tlvs(bytes, offset + 1, offset + tlv.size, bytes[offset]))
        {
            if(entry.type !== 0x12) continue;
            const at = entry.data_offset;
            if(entry.size < 11 || (entry.size - 3) % 8) invalid("invalid erase range list", at);
            const space = Array.from(bytes.subarray(at, at + 3));
            for(let pos = at + 3; pos < at + entry.size; pos += 8)
            {
                const start = u32be(bytes, pos);
                const end = u32be(bytes, pos + 4) + 1;
                if(end <= start) invalid("invalid erase range", pos);
                ranges.push({ space, start, end });
            }
        }
    }
    return ranges;
}

function read_block(bytes, offset)
{
    if(offset + 4 > bytes.length) invalid("truncated block header", offset);
    const content = bytes[offset];
    const type = bytes[offset + 2];
    const layout = BLOCK_TYPES[type];
    if(!layout || content !== layout.content || bytes[offset + 1] !== 1 || bytes[offset + 3] !== layout.header_size)
    {
        invalid(`unsupported content or header layout (0x${content.toString(16)}/0x${type.toString(16)})`, offset);
    }

    const header = offset + 4;
    const checksum = header + layout.header_size;
    if(checksum >= bytes.length) invalid("truncated block header", offset);
    let sum = 0;
    for(let i = offset + 1; i <= checksum; i++) sum += bytes[i];
    if((sum & 0xFF) !== 0xFF) invalid("block header checksum mismatch", offset);
    if(type === 0x17 && bytes[header + 5] !== 1) invalid("unsupported binary block flags", offset);

    const size = u32be(bytes, header + layout.range_at);
    const start = u32be(bytes, header + layout.range_at + 4);
    const end = start + size;
    const data_offset = checksum + 1;
    const next = data_offset + Math.ceil(size / 512) * 512;
    if(!size || end > 2 ** 32) invalid("invalid block destination range", offset);
    if(next > bytes.length) invalid("truncated block data", offset);

    // Payload checksums are the XOR of big-endian 16-bit words.
    let xor = 0;
    const data_end = data_offset + size;
    for(let i = data_offset; i < data_end; i += 2) xor ^= bytes[i] << 8 | (i + 1 < data_end ? bytes[i + 1] : 0);
    const checksum_pos = header + layout.checksum_at;
    if(xor !== (bytes[checksum_pos] << 8 | bytes[checksum_pos + 1])) invalid("block data checksum mismatch", offset);

    const space = Array.from(bytes.subarray(header + layout.storage_at, header + layout.storage_at + 3));
    const certificate = content === 0x5D;
    const label = certificate ? c_string(bytes, header + 20, 12) : null;
    return { offset, type, certificate, label, space, start, end, data_offset, size, next };
}

function same_space(a, b)
{
    return a.every((byte, index) => byte === b[index]);
}

function collect_groups(blocks)
{
    const groups = [];
    let group;
    for(const block of blocks)
    {
        const previous = group?.data.at(-1) || group?.certificates.at(-1);
        const same_target = previous && same_space(block.space, previous.space);
        const joins_certs = block.certificate && previous?.certificate && block.label === previous.label &&
            block.start === previous.start && block.end === previous.end;
        const joins_data = !block.certificate && (group?.certificates.length || block.start === previous?.end);
        if(!same_target || !(joins_certs || joins_data))
        {
            group = { label: block.label, space: block.space, certificates: [], data: [] };
            groups.push(group);
        }
        (block.certificate ? group.certificates : group.data).push(block);
    }
    return groups;
}

/** @param {!Uint8Array} bytes */
export function parse_fpsx(bytes)
{
    if(bytes.length < 9 || bytes[0] !== 0xB2) invalid("expected an outer BB5 FPSX header", 0);
    const header_end = 5 + u32be(bytes, 1);
    if(header_end < 9 || header_end > bytes.length) invalid("invalid FPSX header length", 1);
    const tlvs = read_tlvs(bytes, 9, header_end, u32be(bytes, 5));
    const blocks = [];
    for(let at = header_end; at < bytes.length;)
    {
        const block = read_block(bytes, at);
        blocks.push(block);
        at = block.next;
    }
    if(!blocks.length) invalid("no outer flash records", header_end);
    const parsed = { bytes, header_end, tlvs, blocks, erase_ranges: erase_ranges(bytes, tlvs), groups: collect_groups(blocks) };
    validate_fpsx_layout([parsed]);
    return parsed;
}

/** @param {!Array<ReturnType<typeof parse_fpsx>>} containers */
export function validate_fpsx_layout(containers)
{
    // Certificates with different keys in the same group represent the same
    // flash range. Only their shared extent participates in overlap checks.
    const records = containers.flatMap(parsed => parsed.groups.flatMap(group => [...group.certificates.slice(0, 1), ...group.data]));
    records.sort((a, b) => a.start - b.start);
    const end_by_space = new Map();
    for(const block of records)
    {
        const key = block.space.join(",");
        if(block.start < (end_by_space.get(key) || 0)) invalid("overlapping flash ranges", block.offset);
        end_by_space.set(key, block.end);
    }
}

/**
 * Extract one image in flash-address order. Certificate variants can share
 * flash addresses, but each byte in the requested data region has one source.
 * @param {ReturnType<typeof parse_fpsx>} parsed
 * @param {ReturnType<typeof collect_groups>[number]} group
 */
export function fpsx_group_data(parsed, group)
{
    const first = group.data[0];
    if(!first) throw new Error(`FPSX: no data blocks for ${group.label || "the selected group"}`);
    let end = group.certificates[0]?.end ?? first.start;
    for(const block of group.data)
    {
        if(block.start !== end) invalid(`non-contiguous data in ${group.label || "flash group"}`, block.offset);
        end = block.end;
    }
    const raw = new Uint8Array(end - first.start);
    for(const block of group.data)
    {
        raw.set(parsed.bytes.subarray(block.data_offset, block.data_offset + block.size), block.start - first.start);
    }
    return raw;
}
