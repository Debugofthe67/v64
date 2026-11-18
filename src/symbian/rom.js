// EKA2 TRomHeader, TRomEntry, TRomImageHeader and SRomPageInfo layouts:
// SymbianSource's kernel/eka/include/e32rom.h. The BytePair wire format
// is described by the kernel decoder in kernel/eka/kernel/byte_pair.cpp.

import { u16, u32 } from "../android/bytes.js";

const PAGE_SIZE = 4096;
const PAGE_ENTRY_SIZE = 8;

function invalid(reason)
{
    throw new Error(`EKA2 ROM: ${reason}`);
}

function expand_bytepair(encoded, page)
{
    if(!encoded.length) invalid("empty BytePair stream");
    const dictionary = new Array(256);
    const count = encoded[0];
    let pos = 1;
    let escape = -1;
    if(count)
    {
        if(pos >= encoded.length) invalid("truncated BytePair escape symbol");
        escape = encoded[pos++];
        if(count < 32)
        {
            if(pos + count * 3 > encoded.length) invalid("truncated BytePair dictionary");
            for(let i = 0; i < count; i++)
            {
                const symbol = encoded[pos++];
                if(dictionary[symbol] || symbol === escape) invalid("duplicate BytePair symbol");
                dictionary[symbol] = [encoded[pos++], encoded[pos++]];
            }
        }
        else
        {
            const mask = pos;
            pos += 32;
            if(pos + count * 2 > encoded.length) invalid("truncated BytePair dictionary");
            let read = 0;
            for(let symbol = 0; symbol < 256; symbol++)
            {
                if(!(encoded[mask + (symbol >> 3)] & 1 << (symbol & 7))) continue;
                if(++read > count || symbol === escape) invalid("invalid BytePair dictionary bitmap");
                dictionary[symbol] = [encoded[pos++], encoded[pos++]];
            }
            if(read !== count) invalid("invalid BytePair dictionary bitmap");
        }
    }

    // Validate the dictionary graph and bound symbol expansion before decoding.
    const lengths = new Int32Array(256);
    function symbol_length(symbol)
    {
        if(symbol === escape || lengths[symbol] < 0) invalid("invalid BytePair dictionary reference");
        const pair = dictionary[symbol];
        if(!pair) return 1;
        if(lengths[symbol]) return lengths[symbol];
        lengths[symbol] = -1;
        const length = symbol_length(pair[0]) + symbol_length(pair[1]);
        if(length > page.length) invalid("BytePair symbol exceeds the page size");
        return lengths[symbol] = length;
    }
    dictionary.forEach((_, symbol) => symbol_length(symbol));

    let written = 0;
    function emit(symbol)
    {
        const pair = dictionary[symbol];
        if(pair)
        {
            emit(pair[0]);
            emit(pair[1]);
        }
        else page[written++] = symbol;
    }
    while(pos < encoded.length)
    {
        const symbol = encoded[pos++];
        if(symbol === escape)
        {
            if(pos >= encoded.length || written >= page.length) invalid("invalid escaped BytePair literal");
            page[written++] = encoded[pos++];
        }
        else
        {
            if(written + (lengths[symbol] || 1) > page.length) invalid("BytePair output overruns the page");
            emit(symbol);
        }
    }
    if(written !== page.length) invalid("short BytePair page");
}

function entry_offset(address, size, rom_base, unpaged_end)
{
    const offset = address - rom_base;
    if(offset < 0 || offset + size > unpaged_end) invalid(`ROM address 0x${address.toString(16)} is outside the unpaged image`);
    return offset;
}

function image_entry(data, address, rom_base, unpaged_end)
{
    if(!address) return null;
    const entry = entry_offset(address, 10, rom_base, unpaged_end);
    const end = entry + 10 + data[entry + 9] * 2;
    if(end > unpaged_end || end === entry + 10) invalid("invalid ROM directory entry name");
    const name = new TextDecoder("utf-16le", { fatal: true }).decode(data.subarray(entry + 10, end));
    const image_address = u32(data, entry + 4);
    const image = entry_offset(image_address, 36, rom_base, unpaged_end);
    const entry_address = u32(data, image + 16);
    const code_address = u32(data, image + 20);
    const text_size = u32(data, image + 32);
    entry_offset(code_address, text_size, rom_base, unpaged_end);
    if(entry_address < code_address || entry_address >= code_address + text_size) invalid(`entry point is outside ${name} executable code`);
    return { name, directory_entry_address: address, image_header_address: image_address, entry_address, code_address, text_size };
}

function branch_vector(data, offset, rom_base, header_size, unpaged_end)
{
    const instruction = u32(data, offset);
    if(instruction >>> 24 !== 0xEA) invalid("expected an ARM B instruction in the ROM vector");
    const target_offset = offset + 8 + (instruction << 8 >> 6);
    if(target_offset < header_size || target_offset + 4 > unpaged_end) invalid("ROM vector leaves the unpaged code area");
    return { instruction, offset, target_offset, linked_target_address: rom_base + target_offset };
}

/** Rebuild the ROM in its linked virtual address order. @param {!Uint8Array} packed */
export function rebuild_eka2_rom(packed)
{
    if(packed.length < 512) invalid("truncated ROM header");
    const rom_base = u32(packed, 0x8C);
    const rom_size = u32(packed, 0x90);
    const header_size = u32(packed, 0xC0);
    const compression = u32(packed, 0xEC);
    const stored_size = u32(packed, 0xF0);
    const image_size = u32(packed, 0xF4);
    const pageable_start = u32(packed, 0x148);
    const pageable_size = u32(packed, 0x14C);
    const page_index = u32(packed, 0x150);
    if(header_size !== 512 || compression !== 0 || u32(packed, 0x164) !== 0)
    {
        invalid("unsupported ROM header or compression of the unpaged image");
    }
    if(rom_base % PAGE_SIZE || !rom_base || rom_size > 128 * 1024 * 1024 || rom_base + rom_size > 2 ** 32 ||
        image_size > rom_size || stored_size > packed.length || stored_size < 512 || image_size < 512)
    {
        invalid("invalid virtual or stored image extent");
    }
    if(packed.length - stored_size >= PAGE_SIZE || packed.subarray(stored_size).some(byte => byte !== 0xFF))
    {
        invalid("unexpected bytes after the stored ROM extent");
    }
    const unpaged_end = page_index ? pageable_start : image_size;
    if(unpaged_end < header_size || unpaged_end > stored_size) invalid("invalid unpaged extent");

    const header = {
        rom_base, rom_size, header_size, stored_size, image_size, pageable_start, pageable_size, page_index,
        rom_root_directory: u32(packed, 0x94), kernel_data_address: u32(packed, 0x98), kernel_limit: u32(packed, 0x9C),
        variant_entry: u32(packed, 0xCC), checksum: u32(packed, 0xA8),
        version: [packed[0xE8], packed[0xE9], u16(packed, 0xEA)],
        bootstrap_vector: branch_vector(packed, 0, rom_base, header_size, unpaged_end),
        restart_vector: branch_vector(packed, 0x7C, rom_base, header_size, unpaged_end),
        primary_image: image_entry(packed, u32(packed, 0xA0), rom_base, unpaged_end),
        secondary_image: image_entry(packed, u32(packed, 0xA4), rom_base, unpaged_end),
    };
    entry_offset(header.rom_root_directory, 4, rom_base, unpaged_end);
    if(header.variant_entry) entry_offset(header.variant_entry, 10, rom_base, unpaged_end);

    const page_counts = { raw: 0, bytepair: 0, erased: 0 };
    if(!page_index)
    {
        if(pageable_start || pageable_size || stored_size !== image_size) invalid("missing ROM page table");
        return { bytes: packed.subarray(0, stored_size), header, page_counts };
    }

    const page_count = Math.ceil((pageable_start + pageable_size) / PAGE_SIZE);
    if(pageable_start % PAGE_SIZE || !pageable_size || page_count * PAGE_SIZE !== image_size ||
        page_index < header_size || page_index + page_count * PAGE_ENTRY_SIZE > unpaged_end)
    {
        invalid("invalid ROM page index extent");
    }
    const bytes = new Uint8Array(image_size);
    bytes.set(packed.subarray(0, unpaged_end));
    let previous_end = unpaged_end;
    for(let i = pageable_start / PAGE_SIZE; i < page_count; i++)
    {
        const entry = page_index + i * PAGE_ENTRY_SIZE;
        const offset = u32(packed, entry);
        const size = u16(packed, entry + 4);
        const algorithm = packed[entry + 6];
        const flags = packed[entry + 7];
        const page = bytes.subarray(i * PAGE_SIZE, (i + 1) * PAGE_SIZE);
        if(flags !== 1 || algorithm > 1 || size > PAGE_SIZE) invalid(`unsupported page ${i} format`);
        if(!size)
        {
            page.fill(0xFF);
            page_counts.erased++;
            continue;
        }
        if(offset < previous_end || offset + size > stored_size) invalid(`page ${i} has an overlapping or truncated source range`);
        previous_end = offset + size;
        const encoded = packed.subarray(offset, offset + size);
        if(algorithm === 0)
        {
            if(size !== PAGE_SIZE) invalid(`short raw page ${i}`);
            page.set(encoded);
            page_counts.raw++;
        }
        else
        {
            expand_bytepair(encoded, page);
            page_counts.bytepair++;
        }
    }
    return { bytes, header, page_counts };
}
