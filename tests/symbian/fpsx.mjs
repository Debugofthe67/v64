import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { fpsx_group_data, parse_fpsx, validate_fpsx_layout } from "../../src/symbian/fpsx.js";
import { extract_n97_images, inspect_n97_uda, select_n97_boot_certificate } from "../../src/symbian/n97_images.js";
import { read_n97_boot_media } from "../../src/symbian/n97_boot_media.js";
import { rebuild_eka2_rom } from "../../src/symbian/rom.js";

import { block, cert, fat_payload, firmware_fixture, fpsx, rom_page, valid_page } from "./fpsx_fixture.js";

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
    assert.equal(uda.logical_size, 4200 * 512);
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

test("selects the RM-505 certificate key independently of its order", () => {
    const parsed = parse_fpsx(firmware_fixture().core);
    const group = parsed.groups.find(group => group.label === "SOS*ISASW");
    const [unmatched, match] = group.certificates;
    assert.equal(select_n97_boot_certificate(parsed, group).address, 0x08480000);
    assert.equal(select_n97_boot_certificate(parsed, { ...group, certificates: [match, unmatched] }).address, 0x08480000);
    assert.throws(() => select_n97_boot_certificate(parsed, { ...group, certificates: [unmatched] }), /expected one/);
    assert.throws(() => select_n97_boot_certificate(parsed, { ...group, certificates: [match, match] }), /expected one/);
});
