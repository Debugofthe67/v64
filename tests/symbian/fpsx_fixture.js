// Generated test structures contain no Nokia firmware.

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

export function rom_page(encoded, unpaged_size = 0x1000)
{
    const unpaged = Buffer.alloc(unpaged_size);
    const image_size = unpaged_size + 0x1000;
    const paged_index = 0x300 + unpaged_size / 0x1000 * 8;
    unpaged.writeUInt32LE(0xEA00007E, 0);
    unpaged.writeUInt32LE(0xEA000060, 0x7C);
    unpaged.writeUInt32LE(0x80000000, 0x8C);
    unpaged.writeUInt32LE(image_size, 0x90);
    unpaged.writeUInt32LE(0x80000200, 0x94);
    unpaged.writeUInt32LE(512, 0xC0);
    unpaged.writeUInt32LE(unpaged_size + encoded.length, 0xF0);
    unpaged.writeUInt32LE(image_size, 0xF4);
    unpaged.writeUInt32LE(unpaged_size, 0x148);
    unpaged.writeUInt32LE(0x1000, 0x14C);
    unpaged.writeUInt32LE(0x300, 0x150);
    unpaged.writeUInt32LE(unpaged_size, paged_index);
    unpaged.writeUInt16LE(encoded.length, paged_index + 4);
    unpaged.set([1, 1], paged_index + 6);
    return Buffer.concat([unpaged, encoded]);
}

export function fat_payload()
{
    const data = Buffer.alloc(23 * 512);
    data.writeUInt16LE(512, 11);
    data[13] = 1;
    data.writeUInt16LE(1, 14);
    data[16] = 1;
    data.writeUInt16LE(16, 17);
    data.writeUInt16LE((27 - 10) * 252, 19);
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
