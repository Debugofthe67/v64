// Local-only regression using the reference build from docs/symbian-syborg-reference.md.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sha256_hex } from "../../src/image/sha256.js";
import { parse_syborg_manifest, validate_syborg_artifacts } from "../../src/symbian/syborg_import.js";
import { inspect_syborg_xip } from "../../src/symbian/syborg_xip.js";

const directory = process.argv[2] || "build/syborg-s0/reference";
const read = name => readFileSync(join(directory, name));
const manifest_bytes = read("manifest.json");
const manifest = parse_syborg_manifest(manifest_bytes);
const payload = { rom: read("ROM.img"), rofs: read("ROM.rofs"), devicetree: read("syborg.dtb") };

const { xip } = await validate_syborg_artifacts(manifest_bytes, payload);
assert.equal(xip.header.rom_base, 0x80000000);
assert.equal(xip.directory.files.size, 2055);

function changed_manifest(changes)
{
    return new TextEncoder().encode(JSON.stringify({ ...manifest, ...changes }));
}

assert.throws(() => parse_syborg_manifest(changed_manifest({ format_version: 2 })), /manifest format or version/);
assert.throws(() => parse_syborg_manifest(changed_manifest({ firmware_version: "31.0.008" })), /firmware profile or version/);
assert.throws(() => parse_syborg_manifest(changed_manifest({ personality: "sym92" })), /CPU, memory size or guest ABI/);
assert.throws(() => parse_syborg_manifest(changed_manifest({ files: { ...manifest.files, rom: undefined } })), /file metadata for rom/);
assert.throws(() => parse_syborg_manifest(changed_manifest({
    files: { ...manifest.files, devicetree: { ...manifest.files.devicetree, name: "../syborg.dtb" } },
})), /file metadata for devicetree/);
assert.throws(() => parse_syborg_manifest(changed_manifest({ rofs_layers: [...manifest.rofs_layers].reverse() })), /unexpected ROFS layer/);
await assert.rejects(() => validate_syborg_artifacts(manifest_bytes, { ...payload, rom: undefined }), /missing ROM.img/);

const wrong_dtb = Buffer.from(payload.devicetree);
wrong_dtb[wrong_dtb.length - 1] ^= 1;
await assert.rejects(() => validate_syborg_artifacts(manifest_bytes, { ...payload, devicetree: wrong_dtb }), /SHA-256 mismatch for syborg.dtb/);

payload.rofs.writeUInt32LE(10, 20);
const wrong_rofs_order = changed_manifest({
    files: { ...manifest.files, rofs: { ...manifest.files.rofs, sha256: sha256_hex(payload.rofs) } },
});
await assert.rejects(() => validate_syborg_artifacts(wrong_rofs_order, payload), /invalid partition extent or order for rofs1/);

const corrupt = Buffer.from(payload.rom);
const data = xip.directory.files.get("sys/data/estartcomp.txt");
const entry = data.directory_entry - xip.header.rom_base;
const ekern = xip.directory.files.get("sys/bin/ekern.exe");
corrupt.writeUInt32LE(ekern.address + 4, entry + 4);
assert.throws(() => inspect_syborg_xip(corrupt), /overlapping ROM ranges/);
corrupt.writeUInt32LE(xip.header.header_size, entry);
corrupt.writeUInt32LE(xip.header.rom_base, entry + 4);
assert.throws(() => inspect_syborg_xip(corrupt), /overlapping ROM ranges for header/);
corrupt.writeUInt32LE(data.size, entry);
corrupt.writeUInt32LE(data.address, entry + 4);
const euser = xip.images.get(xip.directory.files.get("sys/bin/euser.dll").address);
corrupt.writeUInt32LE(0x10000, euser.exp);
assert.throws(() => inspect_syborg_xip(corrupt), /invalid export ordinal 1 for sys\/bin\/euser.dll/);

console.log("Syborg reference import and malformed artifact checks passed");
