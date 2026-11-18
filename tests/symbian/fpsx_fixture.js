// Generated test structures contain no Nokia firmware.

export function block(payload, start, label = null)
{
    const header = Buffer.alloc(label ? 50 : 19);
    header.set(label ? [0x5D, 1, 0x27, 45] : [0x54, 1, 0x17, 14]);
    header.set([0, 3, 0], label ? 36 : 4);
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
export const cert = (start, label, fill = 1) => block(Buffer.alloc(512, fill), start, label);

export function firmware_fixture()
{
    const core_data = Buffer.alloc(0x2200, 0xFF);
    core_data.fill(0xDA, 0, 0xC00);
    rom_page(valid_page).copy(core_data, 0xC00);
    const core = fpsx([
        cert(0x1000, "SOS*DSP0"), block(Buffer.alloc(512, 0x77), 0x1200),
        cert(0x8000, "SOS+CORE"), block(core_data.subarray(0, 4096), 0x8200), block(core_data.subarray(4096), 0x9200),
        cert(0x10000, "SOS+ROFS1"), block(rofs_payload(), 0x10200),
    ]);
    const rofs2 = fpsx([cert(0x20000, "SOS+ROFS2"), block(rofs_payload(), 0x20200)]);
    const rofs3 = fpsx([cert(0x30000, "SOS+ROFS3"), block(rofs_payload(), 0x30200)]);
    const uda = fpsx([block(fat_payload(), 0x40000)]);
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
