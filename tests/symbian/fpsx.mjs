import assert from "node:assert/strict";
import { test } from "node:test";
import { fpsx_group_data, parse_fpsx, validate_fpsx_layout } from "../../src/symbian/fpsx.js";
import { inspect_fat16_uda } from "../../src/symbian/firmware_partitions.js";
import { rebuild_eka2_rom } from "../../src/symbian/rom.js";

import { block, cert, fat_payload, fpsx, rom_page, valid_page } from "./fpsx_fixture.js";

test("validates FPSX TLVs, record checksums, destination ranges and certificate alternatives", () => {
    const bytes = fpsx([
        cert(0x1000, "SOS+CORE"), cert(0x1000, "SOS+CORE", 2), block(Buffer.alloc(512, 0x5A), 0x1200),
        block(Buffer.alloc(512, 0x25), 0x1400),
    ], [Buffer.from([0xFA, 0, 0, 0, 0, 1, 0xB1])]);
    const parsed = parse_fpsx(bytes);
    const [group] = parsed.groups;
    assert.equal(parsed.tlvs[0].size, 1);
    assert.equal(group.certificates.length, 2);
    assert.equal(fpsx_group_data(parsed, group)[512], 0x25);
    assert.throws(() => parse_fpsx(bytes.subarray(0, bytes.length - 1)), /truncated block data/);

    const bad_header = Buffer.from(bytes);
    bad_header[parsed.blocks[2].offset + 15] ^= 1;
    assert.throws(() => parse_fpsx(bad_header), /header checksum mismatch/);
    const bad_payload = Buffer.from(bytes);
    bad_payload[parsed.blocks[2].data_offset] ^= 1;
    assert.throws(() => parse_fpsx(bad_payload), /data checksum mismatch/);

    const overlap = fpsx([block(Buffer.alloc(512), 0x2000), block(Buffer.alloc(512), 0x2100)]);
    assert.throws(() => parse_fpsx(overlap), /overlapping flash ranges/);
    assert.throws(() => validate_fpsx_layout([parsed, parsed]), /overlapping flash ranges/);
    const gapped = parse_fpsx(fpsx([cert(0x1000, "SOS+CORE"), block(Buffer.alloc(512), 0x1400)]));
    assert.throws(() => fpsx_group_data(gapped, gapped.groups[0]), /non-contiguous data/);
});

test("reconstructs the linked ROM and rejects invalid or overlapping pageable data", () => {
    const input = rom_page(valid_page);
    const rom = rebuild_eka2_rom(input);
    assert.deepEqual(rom.bytes.slice(0x1000, 0x1006), new Uint8Array([0x11, 0x12, 0x11, 0x12, 0x11, 0x12]));
    assert.equal(rom.header.bootstrap_vector.linked_target_address, 0x80000200);
    assert.equal(rom.header.restart_vector.target_offset, 0x204);
    assert.deepEqual(rom.page_counts, { raw: 0, bytepair: 1, erased: 0 });

    assert.throws(() => rebuild_eka2_rom(rom_page(valid_page.subarray(0, -1))), /short BytePair page/);
    assert.throws(() => rebuild_eka2_rom(rom_page(Buffer.from([1, 0xFC, 0x81, 0x81, 0x11, 0x81]))), /dictionary reference/);
    input.writeUInt32LE(0xF00, 0x308);
    assert.throws(() => rebuild_eka2_rom(input), /overlapping or truncated source range/);
});

test("extends a trimmed FAT16 volume only when the rest of its data area is free", () => {
    const data = fat_payload();
    const uda = inspect_fat16_uda(data, "UDA fixture");
    assert.equal(uda.last_used_cluster, 2);
    assert.equal(uda.last_used_end, data.length);
    assert.equal(uda.logical_size, 4284 * 512);
    data.writeUInt16LE(0xFFFF, 518);
    assert.throws(() => inspect_fat16_uda(data, "UDA fixture"), /cluster in use lies beyond/);
});
