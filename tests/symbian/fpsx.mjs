import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { fpsx_group_data, parse_fpsx, validate_fpsx_layout } from "../../src/symbian/fpsx.js";
import { extract_n97_images, inspect_n97_uda, rm505_bml_partitions, select_n97_boot_certificate } from "../../src/symbian/n97_images.js";
import { N97_BML_RESERVOIR, N97_BML_USER_BLOCKS, N97_FLASH_BLOCK, N97_FLASH_HEADER, N97_FLASH_PAGE, N97_FLASH_SLOT } from "../../src/symbian/n97_flash.js";
import { read_n97_boot_media } from "../../src/symbian/n97_boot_media.js";
import { rebuild_eka2_rom } from "../../src/symbian/rom.js";

import { block, cert, fat_payload, firmware_fixture, fixture_partitions, fpsx, rm505_partition_tlv, rom_page, valid_page } from "./fpsx_fixture.js";

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
    const uda = inspect_n97_uda(data);
    assert.equal(uda.last_used_cluster, 2);
    assert.equal(uda.last_used_end, data.length);
    assert.equal(uda.logical_size, 4284 * 512);
    data.writeUInt16LE(0xFFFF, 518);
    assert.throws(() => inspect_n97_uda(data), /cluster in use lies beyond/);
});

test("CLI exports separate certified DSP0 and ISASW regions bound to the selected N97 XIP", t => {
    const directory = mkdtempSync(join(tmpdir(), "v86-fpsx-"));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const input = join(directory, "firmware");
    const output = join(directory, "rebuilt");
    mkdirSync(input);
    const { core, rofs2, rofs3, uda, parts, manifest } = firmware_fixture();
    for(const [name, bytes] of Object.entries(parts)) writeFileSync(join(input, name), bytes);
    writeFileSync(join(input, "RM505.vpl"), manifest("059TEST"));

    assert.throws(() => extract_n97_images({ core, rofs2: rofs3, rofs3: rofs2, uda }), /expected one SOS\+ROFS2/);
    const cli = fileURLToPath(new URL("../../tools/symbian/vpl.mjs", import.meta.url));
    const run = dir => spawnSync(process.execPath, [cli, "extract", input, dir], { encoding: "utf8" });
    const result = run(output);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const report = JSON.parse(readFileSync(join(output, "firmware.json"), "utf8"));
    assert.deepEqual(report.containers.core.groups.map(group => group.label), [null, "SOS*DSP0", "SOS*ISASW", "SOS+CORE", "SOS+ROFS1"]);
    assert.equal(report.nand.bml.state, "initialized");
    assert.equal(report.nand.stl.state, "initialized");
    assert.equal(readFileSync(join(output, "core-prefix.bin"))[0], 0xDA);
    const digest = report.images.find(image => image.name === "rom.xip.bin").sha256;
    const bytes = readFileSync(join(output, "rapido-boot.bin"));
    const media = read_n97_boot_media(bytes, digest);
    assert.equal(media.dsp.address, 0x08200000);
    assert.equal(media.isa.address, 0x08480000);
    assert.equal(media.dsp.bytes[1024], 0x77);
    assert.equal(media.isa.bytes[1024], 0x9D);
    assert.equal(media.prefix[1024], 0xDA);
    assert.throws(() => read_n97_boot_media(bytes, "0".repeat(64)), /different XIP/);
    assert.throws(() => read_n97_boot_media(bytes.subarray(0, -1), digest), /malformed image lengths/);
    const overlap = Buffer.from(bytes);
    overlap.writeUInt32LE(media.dsp.address, 48);
    assert.throws(() => read_n97_boot_media(overlap, digest), /overlap/);
    assert.equal(readFileSync(join(output, "uda.fat")).at(-1), 0);
    for(const { name, size, sha256 } of report.images)
    {
        const bytes = readFileSync(join(output, name));
        assert.equal(bytes.length, size);
        assert.equal(createHash("sha256").update(bytes).digest("hex"), sha256);
    }
    assert.match(run(output).stderr, /EEXIST/);
    const rejected = join(directory, "rejected");
    writeFileSync(join(input, "core.C00"), core.subarray(0, -1));
    assert.match(run(rejected).stderr, /truncated block data/);
    assert.equal(existsSync(rejected), false);
});

test("adds stock BML mirrors from the application TLV and preserves supplied reservoir records", () => {
    const part = rm505_partition_tlv(fixture_partitions), unrelated = rm505_partition_tlv(fixture_partitions, [1, 3, 0]);
    const parse = (...records) => rm505_bml_partitions(parse_fpsx(fpsx([block(Buffer.alloc(512), 0x80000)], records)));
    assert.equal(parse(unrelated), null);
    const unknown_format = Buffer.from(part);
    unknown_format[5] = 0x5F;
    assert.equal(parse(unknown_format), null);
    const partitions = parse(part, unrelated);
    assert.deepEqual(partitions, fixture_partitions.map(([id, attributes, start, length]) =>
        ({ id, attributes, start_block: start / N97_FLASH_BLOCK, blocks: length / N97_FLASH_BLOCK })));
    assert.throws(() => parse(part, part), /BML partition table/);
    const invalid_count = Buffer.from(part);
    invalid_count.writeUInt32BE(31, 17);
    assert.throws(() => parse(invalid_count), /BML partition table/);
    for(const entries of [
        [[3, 2, 0, 0x40000], [4, 2, 0x20000, 0x20000]],
        [[3, 2, 0, 0x20000], [3, 2, 0x20000, 0x20000]],
        [[3, 2, 0, 1]],
        [[3, 1, N97_BML_USER_BLOCKS * N97_FLASH_BLOCK, N97_FLASH_BLOCK]],
        [[3, 1, 0, N97_FLASH_BLOCK], [4, 0x22, N97_FLASH_BLOCK, N97_FLASH_BLOCK]],
    ]) assert.throws(() => parse(rm505_partition_tlv(entries)), /BML partition table/);
    assert.ok(parse(rm505_partition_tlv([[3, 0x22, 0, N97_FLASH_BLOCK],
        [4, 1, (N97_BML_USER_BLOCKS - 1) * N97_FLASH_BLOCK, N97_FLASH_BLOCK]])));

    const fixture = firmware_fixture();
    const nand = (inputs, options) => extract_n97_images(inputs, options).files.find(file => file.name === "onenand.img");
    const raw = (chunk, from, to) => Buffer.from(chunk.bytes.subarray(from, to).map(byte => byte ^ 0xFF));
    const page_slot = block => N97_FLASH_HEADER + block * (N97_FLASH_BLOCK / N97_FLASH_PAGE) * N97_FLASH_SLOT;
    const unlocked = page_slot(N97_BML_RESERVOIR), locked = page_slot(0x7FF);
    const fresh = nand(fixture, { initialize_stl: false });
    const fresh_chunks = [...fresh.chunks()];
    assert.deepEqual(fresh_chunks.slice(-2).map(chunk => chunk.at), [unlocked, locked]);
    const [unlock, lock] = fresh_chunks.slice(-2);
    assert.equal(raw(unlock, 0, 8).toString(), "ULOCKPCH");
    assert.equal(raw(lock, 0, 8).toString(), "LOCKPCHD");
    assert.deepEqual(raw(lock, 0, 512), raw(lock, 512, 1024));
    const pia = raw(lock, 1024, 1536);
    assert.equal(pia.subarray(0, 8).toString(), "XSRPART5");
    assert.equal(pia.readUInt32LE(12), partitions.length);
    assert.deepEqual(Array.from({ length: 4 }, (_, i) => pia.readUInt32LE(16 + i * 4)), [3, 2, 4, 1]);
    assert.deepEqual(pia, raw(lock, 1536, 2048));
    assert.equal(raw(lock, N97_FLASH_PAGE + 5, N97_FLASH_PAGE + 6)[0], 0xFE);

    const blank = nand(fixture, { initialize_bml: false });
    assert.equal(blank.bml.state, "unformatted");
    assert.deepEqual([...blank.chunks()], fresh_chunks.slice(0, -2), "only BML pages differ from the raw extraction");
    const start = N97_BML_USER_BLOCKS * N97_FLASH_BLOCK;
    const supplied = nand({ ...fixture, eno: fpsx([block(Buffer.alloc(512, 0xA6), start)]) });
    assert.equal(supplied.bml.state, "supplied");
    assert.match(supplied.stl.reason, /already supplies/);
    const supplied_chunks = [...supplied.chunks()];
    assert.equal(supplied_chunks.at(-1).at, page_slot(N97_BML_USER_BLOCKS));
    assert.deepEqual(raw(supplied_chunks.at(-1), 0, 512), Buffer.alloc(512, 0xA6));
});

test("seeds a translated factory UDA and empty STL service volume only over authorized flash extents", () => {
    const fixture = firmware_fixture();
    const image = inputs => extract_n97_images(inputs).files.find(file => file.name === "onenand.img");
    const slot = block => N97_FLASH_HEADER + block * (N97_FLASH_BLOCK / N97_FLASH_PAGE) * N97_FLASH_SLOT;
    const find = (chunks, block, page = 0) => {
        const start = slot(block);
        const chunk = chunks.find(chunk => chunk.at === start);
        return Buffer.from(chunk.bytes.subarray(page * N97_FLASH_SLOT, (page + 1) * N97_FLASH_SLOT).map(byte => byte ^ 0xFF));
    };
    const nand = image(fixture);
    assert.equal(nand.stl.state, "initialized");
    assert.deepEqual(nand.stl.volumes, [
        { id: 8, reserved: 10, start_block: 6, blocks: 27, sectors: 4284 },
        { id: 10, reserved: 3, start_block: 1984, blocks: 4, sectors: 252 },
    ]);
    const chunks = [...nand.chunks()];
    assert.ok(chunks.every((chunk, i) => !i || chunk.at >= chunks[i - 1].at + chunks[i - 1].bytes.length));
    const unit_header = find(chunks, 7);
    assert.equal(unit_header.toString("ascii", 12, 16), "XSR2");
    assert.equal(unit_header.readUInt32LE(16), 1);
    assert.equal(unit_header.readUInt32LE(28), 89);
    assert.equal(unit_header.readUInt32LE(36), 0xFFFFFFFE);
    assert.equal(unit_header.readUInt32LE(64), 8);
    const bpb = find(chunks, 6, 1);
    assert.deepEqual(bpb.subarray(0, N97_FLASH_PAGE), fat_payload().subarray(0, N97_FLASH_PAGE));
    assert.deepEqual([...bpb.subarray(N97_FLASH_PAGE + 2, N97_FLASH_PAGE + 6)], [0, 0xFF, 8, 0xF0]);
    assert.deepEqual([...bpb.subarray(N97_FLASH_PAGE + 0x32, N97_FLASH_PAGE + 0x36)], [3, 0xFC, 8, 0]);
    const last = find(chunks, 6 + 16, 63);
    assert.ok(last.subarray(0, N97_FLASH_PAGE).every(byte => byte === 0));
    assert.ok(find(chunks, 6 + 17).subarray(N97_FLASH_PAGE + 8, N97_FLASH_PAGE + 11).some(byte => byte !== 0xFF));
    const service = find(chunks, 1984);
    assert.equal(service.readUInt32LE(64), 10);
    assert.equal(service.readUInt32LE(4), 3);
    assert.equal(chunks.find(chunk => chunk.at === slot(1984)).bytes.length, N97_FLASH_SLOT);
    const erase_log = find(chunks, N97_BML_USER_BLOCKS);
    assert.equal(erase_log.toString("ascii", 0, 6), "ERLSIG");
    assert.deepEqual(erase_log.subarray(512, 520), erase_log.subarray(0, 8).map(byte => byte ^ 0xFF));

    const record = Buffer.alloc(512, 0xB5);
    const supplied = image({ ...fixture, eno: fpsx([block(record, 7 * N97_FLASH_BLOCK),
        block(record, 1984 * N97_FLASH_BLOCK)]) });
    assert.match(supplied.stl.reason, /other flash records/);
    assert.equal(supplied.bml.state, "unformatted", "a conflicting source keeps its original physical layout");
    const supplied_chunks = [...supplied.chunks()];
    assert.deepEqual(find(supplied_chunks, 7).subarray(0, 512), record);
    assert.deepEqual(find(supplied_chunks, 1984).subarray(0, 512), record);
    assert.deepEqual(find(supplied_chunks, 6).subarray(0, 512), fat_payload().subarray(0, 512));

    const smaller = fat_payload();
    smaller.writeUInt16LE(4200, 19);
    const mismatched = image({ ...fixture, uda: fpsx([block(smaller, 6 * N97_FLASH_BLOCK)]) });
    assert.match(mismatched.stl.reason, /address or geometry/);
    assert.deepEqual(find([...mismatched.chunks()], 6).subarray(0, 512), smaller.subarray(0, 512));
});

test("selects the RM-505 certificate key independently of its order", () => {
    const parsed = parse_fpsx(firmware_fixture().core);
    const group = parsed.groups.find(group => group.label === "SOS*ISASW");
    const [unmatched, match] = group.certificates;
    assert.equal(select_n97_boot_certificate(parsed, group).address, 0x08480000);
    assert.equal(select_n97_boot_certificate(parsed, { ...group, certificates: [match, unmatched] }).address, 0x08480000);
    assert.throws(() => select_n97_boot_certificate(parsed, { ...group, certificates: [unmatched] }), /expected one/);
    assert.throws(() => select_n97_boot_certificate(parsed, { ...group, certificates: [match, match] }), /expected one/);
});
