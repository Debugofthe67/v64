// Generated test structures contain no Nokia firmware.

import { deflateRawSync } from "node:zlib";

export function block(payload, start, label = null, key = null)
{
    const header = Buffer.alloc(label ? 50 : 19);
    header.set(label ? [0x5D, 1, 0x27, 45] : [0x54, 1, 0x17, 14]);
    header.set([0, 3, 0], label ? 36 : 4);
    if(key) header.set(key, 4);
    if(label) header.write(label, 24);
    else header[9] = 1;
    let checksum = 0;
    for(let i = 0; i < payload.length; i += 2) checksum ^= payload[i] << 8 | (payload[i + 1] || 0);
    header.writeUInt16BE(checksum, label ? 39 : 7);
    header.writeUInt32BE(payload.length, label ? 41 : 10);
    header.writeUInt32BE(start, label ? 45 : 14);
    header[header.length - 1] = 255 - (header.subarray(1).reduce((sum, x) => sum + x, 0) & 255);
    const padding = Buffer.alloc(Math.ceil(payload.length / 512) * 512 - payload.length);
    return Buffer.concat([header, payload, padding]);
}

export function fpsx(blocks, tlvs = [])
{
    const prefix = Buffer.alloc(9);
    prefix[0] = 0xB2;
    prefix.writeUInt32BE(4 + tlvs.reduce((total, entry) => total + entry.length, 0), 1);
    prefix.writeUInt32BE(tlvs.length, 5);
    return Buffer.concat([prefix, ...tlvs, ...blocks]);
}

export function rm505_partition_tlv(entries, space = [0, 3, 0])
{
    const raw = Buffer.alloc(3 + 18 + entries.length * 16);
    raw[0] = 0xEE;
    raw.writeUInt16BE(raw.length - 3, 1);
    raw.set([1, 0x2F, 0x4F, ...space, 0, 1, 0, 0, 0xFF, 0xFF, 0xFF, 0xFF], 3);
    raw.writeUInt32BE(entries.length, 17);
    for(const [i, entry] of entries.entries())
    {
        entry.forEach((word, n) => raw.writeUInt32BE(word, 21 + i * 16 + n * 4));
    }
    return raw;
}

export const fixture_partitions = [
    [3, 2, 0x80000, 0x20000], [4, 2, 0xA0000, 0x20000], [8, 1, 0xC0000, 0x280000], [10, 1, 0xFA00000, 0x20000],
];

export function rom_page(encoded)
{
    const unpaged = Buffer.alloc(0x1000);
    unpaged.writeUInt32LE(0xEA00007E, 0);
    unpaged.writeUInt32LE(0xEA000060, 0x7C);
    unpaged.writeUInt32LE(0x80000000, 0x8C);
    unpaged.writeUInt32LE(0x2000, 0x90);
    unpaged.writeUInt32LE(0x80000200, 0x94);
    unpaged.writeUInt32LE(512, 0xC0);
    unpaged.writeUInt32LE(0x1000 + encoded.length, 0xF0);
    unpaged.writeUInt32LE(0x2000, 0xF4);
    unpaged.writeUInt32LE(0x1000, 0x148);
    unpaged.writeUInt32LE(0x1000, 0x14C);
    unpaged.writeUInt32LE(0x300, 0x150);
    unpaged.writeUInt32LE(0x1000, 0x308);
    unpaged.writeUInt16LE(encoded.length, 0x30C);
    unpaged.set([1, 1], 0x30E);
    return Buffer.concat([unpaged, encoded]);
}

function rofs_payload()
{
    const payload = Buffer.alloc(0xE00, 0xFF);
    payload.fill(0, 0, 0xC40);
    const header = payload.subarray(0xC00);
    header.write("ROFS");
    header[4] = 48;
    header.writeUInt16LE(0x200, 6);
    header.writeUInt32LE(48, 8);
    header.writeUInt32LE(12, 12);
    header.writeUInt32LE(60, 16);
    header.writeUInt32LE(64, 36);
    header.writeUInt32LE(4096, 44);
    return payload;
}

export function fat_payload()
{
    const data = Buffer.alloc(23 * 512);
    data.writeUInt16LE(512, 11);
    data[13] = 1;
    data.writeUInt16LE(1, 14);
    data[16] = 1;
    data.writeUInt16LE(16, 17);
    data.writeUInt16LE(4200, 19);
    data[21] = 0xF8;
    data.writeUInt16LE(20, 22);
    data.writeUInt16LE(0xAA55, 510);
    data.writeUInt16LE(0xFFF8, 512);
    data.writeUInt16LE(0xFFFF, 514);
    data.writeUInt16LE(0xFFFF, 516);
    return data;
}

export const valid_page = Buffer.concat([Buffer.from([2, 0xFC, 0x81, 0x11, 0x12, 0x82, 0x81, 0x81]), Buffer.alloc(1024, 0x82)]);
export const cert = (start, label, fill = 1) => block(Buffer.alloc(512, fill), start, label, fixture_root_key);

export const fixture_root_key = Buffer.from("caeebb65d3c48e6dc73b49dc5063a2ee5867d611", "hex");

function boot_cert(start, label, stored, expanded, address, key)
{
    const payload = Buffer.alloc(0x400);
    payload.writeUInt32LE(0x809795A3, 0);
    payload.writeUInt32LE(0x31DEEAE8, 0x3D0);
    payload.writeUInt32LE(payload.length + stored, 0x3D4);
    payload.writeUInt32LE(payload.length + expanded, 0x3D8);
    payload.writeUInt32LE(address, 0x3DC);
    return block(payload, start, label, key);
}

function boot_group(start, label, address, payload, deflated)
{
    const stored = deflated ? deflateRawSync(payload) : payload;
    const padded = Buffer.alloc(Math.ceil(stored.length / 512) * 512, 0xFF);
    stored.copy(padded);
    return [
        boot_cert(start, label, stored.length, payload.length, address, Buffer.alloc(20, 0x5A)),
        boot_cert(start, label, stored.length, payload.length, address, fixture_root_key),
        block(padded, start + 0x400),
    ];
}

export function firmware_fixture(bootstrap)
{
    const core_data = Buffer.alloc(0x2200, 0xFF);
    core_data.fill(0xDA, 0, 0xC00);
    rom_page(valid_page).copy(core_data, 0xC00);
    if(bootstrap)
    {
        if(bootstrap.length > 0xC00) throw new Error("Test bootstrap exceeds the unpaged ROM");
        // The XIP entry at 0x200 jumps over the byte-pair page index at 0x300.
        core_data.writeUInt32LE(0xEA00007E, 0xC00 + 0x200);
        bootstrap.copy(core_data, 0xC00 + 0x400);
    }
    const modem = [
        [0x90000, "SOS*DSP0", 0x08200000, Buffer.alloc(600, 0x77), true],
        [0x92000, "SOS*ISASW", 0x08480000, Buffer.alloc(900, 0x9D), true],
        [0x94000, "SOS+CORE", 0x088FF000, core_data, false],
    ];
    const toc = Buffer.alloc(512);
    for(const [i, [flash, label, address]] of modem.entries())
    {
        const offset = i * 32;
        toc.writeUInt32LE(flash - 0x80000, offset);
        toc.writeUInt32LE(0x4000, offset + 4);
        toc.writeUInt32LE(address, offset + 16);
        toc.write(label, offset + 20);
    }
    toc.fill(0xFF, modem.length * 32);
    const core = fpsx([
        block(toc, 0x80000), ...modem.flatMap(args => boot_group(...args)),
        cert(0xA0000, "SOS+ROFS1"), block(rofs_payload(), 0xA0200),
    ], [rm505_partition_tlv(fixture_partitions)]);
    const rofs2 = fpsx([cert(0xA8000, "SOS+ROFS2"), block(rofs_payload(), 0xA8200)]);
    const rofs3 = fpsx([cert(0xB0000, "SOS+ROFS3"), block(rofs_payload(), 0xB0200)]);
    const uda = fpsx([block(fat_payload(), 0xC0000)]);
    const parts = [["core.C00", "Mcu", 1, core], ["rofs2.fpsx", "Ppm", 2, rofs2],
        ["rofs3.fpsx", "Ppm", 3, rofs3], ["n97.uda.fpsx", "Content", 0, uda]];
    const files = parts.map(([name, subtype, rofs_index]) => `<File><Name>${name}</Name><FileType>Binary</FileType>` +
        `<FileSubType>${subtype}</FileSubType>` + (rofs_index ? `<FlashImage><RofsIndex>${rofs_index}</RofsIndex></FlashImage>` : "") + "</File>");
    const manifest = product_code => Buffer.from(`<VariantPackingList><Variant><VariantIdentification>
        <TypeDesignator>RM-505</TypeDesignator><ProductCode>${product_code}</ProductCode></VariantIdentification>
        <SwVersion>22.0.110</SwVersion><VariantVersion>001</VariantVersion><FileList>${files.join("")}</FileList>
        </Variant></VariantPackingList>`);

    return { core, rofs2, rofs3, uda, parts: Object.fromEntries(parts.map(([name, , , bytes]) => [name, bytes])), manifest };
}
