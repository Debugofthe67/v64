import assert from "node:assert/strict";
import { createHash, verify, X509Certificate } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { inflateSync } from "node:zlib";
import { inspect_sis } from "../../src/symbian/sis.js";
import { make_transfer_card, transfer_card_files, transfer_card_packages } from "../../src/symbian/transfer_card.js";
import { inspect_syborg_xip } from "../../src/symbian/syborg_xip.js";
import { list_fat16_directory, read_fat16_file } from "../lib/fat32_reader.mjs";

const UID = 0xE0860505;
const load = version => readFile(new URL(`./fixtures/notes-v${version}.sisx`, import.meta.url));
const sha = bytes => createHash("sha256").update(bytes).digest("hex");

function fields(bytes, array = false)
{
    const result = [];
    for(let offset = array ? 4 : 0; offset < bytes.length;)
    {
        const type = bytes.readUInt32LE(array ? 0 : offset);
        const size = bytes.readUInt32LE(offset + (array ? 0 : 4));
        const start = offset + (array ? 4 : 8);
        assert.ok(start + size <= bytes.length);
        result.push({ type, offset, data: bytes.subarray(start, start + size) });
        offset = start + Math.ceil(size / 4) * 4;
    }
    return result;
}
const field = (bytes, type) => fields(bytes).find(found => found.type === type).data;
function expand(wrapper)
{
    const raw = wrapper.readUInt32LE(0) ? inflateSync(wrapper.subarray(12)) : wrapper.subarray(12);
    assert.equal(BigInt(raw.length), wrapper.readBigUInt64LE(4));
    return raw;
}
const controller = pkg => field(expand(field(field(pkg.subarray(16), 12), 3)), 13);
function executable_files(pkg)
{
    const data = field(field(pkg.subarray(16), 12), 30);
    const [{ data: unit }] = fields(field(data, 2), true);
    return fields(field(unit, 2), true).map(item => expand(field(item.data, 3)));
}

test("The two Notes fixtures share a test UID, declare S60v5 and have valid self-signatures", async () => {
    let first_certificate;
    for(const version of [1, 2])
    {
        const pkg = await load(version);
        assert.deepEqual(await inspect_sis(new File([pkg], "example.sisx")), { uid: UID });
        const control = controller(pkg), meta = field(control, 14);
        assert.equal(field(meta.subarray(0, -2), 4).readInt32LE(), version); // final two bytes are install type and flags
        const [{ data: targets }] = fields(field(control, 17));
        assert.equal(field(fields(targets, true)[0].data, 9).readUInt32LE(), 0x1028315F);

        const chain = fields(control).find(found => found.type === 39);
        const certificate = new X509Certificate(field(field(chain.data, 22), 37));
        assert.ok(certificate.verify(certificate.publicKey));
        assert.equal(new Date(certificate.validFrom).toISOString(), "2026-11-18T06:29:23.000Z");
        assert.equal(new Date(certificate.validTo).toISOString(), "2036-11-15T06:29:23.000Z");
        if(first_certificate) assert.equal(certificate.fingerprint256, first_certificate);
        first_certificate = certificate.fingerprint256;
        const [{ data: signature }] = fields(field(chain.data, 2), true);
        const oid = field(field(signature, 38), 1).toString("utf16le");
        assert.equal(oid, "1.2.840.113549.1.1.5"); // RSA with SHA-1, SignSIS
        assert.ok(verify("sha1", control.subarray(0, chain.offset), certificate.publicKey, field(signature, 37)));

        const [exe, ...resources] = executable_files(pkg);
        assert.equal(exe.subarray(16, 20).toString(), "EPOC");
        assert.equal(exe.readUInt32LE(8), UID);
        assert.equal(exe.readUInt32LE(128), UID); // E32 secure ID and private directory
        assert.equal(exe.readBigUInt64LE(136), 0n); // E32 security capabilities
        assert.equal(resources.length, 2, "both app registration resources");
    }
});

test("Both Notes executables import ordinals present in the Syborg XIP firmware",
    { skip: !process.env.SYBORG_ROM }, async () => {
        const rom = await readFile(process.env.SYBORG_ROM);
        const xip = inspect_syborg_xip(rom);
        for(const version of [1, 2])
        {
            const [exe] = executable_files(await load(version));
            assert.equal(exe.readUInt32LE(28), 0, "uncompressed E32 image");
            assert.equal(exe.readUInt32LE(44) >>> 28, 1, "E32 ELF import format");
            const code = exe.readUInt32LE(100), section = exe.readUInt32LE(108);
            const counts = {};
            let block = section + 4;
            for(let library = 0; library < exe.readUInt32LE(84); library++)
            {
                const name_at = section + exe.readUInt32LE(block);
                const name = exe.toString("ascii", name_at, exe.indexOf(0, name_at))
                    .replace(/\{[a-f\d]{8}\}|\[[a-f\d]{8}\]/gi, "").toLowerCase();
                const file = xip.directory.files.get("sys/bin/" + name);
                const image = xip.images.get(file?.address);
                assert.ok(image?.export_count, "missing firmware dependency " + name);
                const absent = rom.readUInt32LE(file.address - xip.header.rom_base + 16); // TRomImageHeader::iEntryPoint
                const count = exe.readUInt32LE(block + 4);
                counts[name] = count;
                for(let i = 0; i < count; i++)
                {
                    const at = code + exe.readUInt32LE(block + 8 + i * 4);
                    const ordinal = exe.readUInt32LE(at) & 0xFFFF;
                    assert.ok(ordinal > 0 && ordinal <= image.export_count, name + " ordinal " + ordinal);
                    const target = rom.readUInt32LE(image.exp + (ordinal - 1) * 4);
                    assert.ok(target && target !== absent, name + " missing ordinal " + ordinal);
                }
                block += 8 + count * 4;
            }
            assert.deepEqual(counts, { "efsrv.dll": 11, "euser.dll": 17 + version, "gdi.dll": 2, "ws32.dll": 28 });
        }
    });

test("SIS preflight rejects a damaged UID, declared extent, or data checksum", async () => {
    const original = await load(1);
    const corrupt = (offset, mask) => {
        const copy = Buffer.from(original);
        copy[offset] ^= mask;
        return new File([copy], "damaged.sis");
    };
    await assert.rejects(inspect_sis(corrupt(12, 1)), /UID checksum/);
    await assert.rejects(inspect_sis(corrupt(23, 0x80)), /field exceeds/);
    const data = fields(field(original.subarray(16), 12)).at(-1);
    await assert.rejects(inspect_sis(corrupt(24 + data.offset + 24, 1)), /data checksum/);
});

test("a large, structurally valid unsigned SIS traverses the streaming preflight and FAT16 unchanged", async () => {
    const number = (value, size = 4) => {
        const bytes = Buffer.alloc(size);
        bytes.writeUIntLE(value, 0, Math.min(size, 6));
        return bytes;
    };
    const tag = (type, ...parts) => {
        const body = new Blob(parts);
        return new Blob([number(type), number(body.size), body, Buffer.alloc(-body.size & 3)]);
    };
    const array = (type, ...entries) => tag(2, number(type), ...entries.map(entry => entry.slice(4)));
    const string = value => tag(1, Buffer.from(value, "utf16le"));
    const packed = raw => tag(3, number(0), number(raw.size, 8), raw);
    const template = await load(1);
    const piece = Buffer.alloc(1024 ** 2, 0xA9);
    const repeated = new Blob([piece]);
    const payload = new Blob(Array(41).fill(repeated));
    const hash = createHash("sha1");
    for(let i = 0; i < 41; i++) hash.update(piece);
    const description = tag(24, string("!:\\data\\large.bin"), string(""), tag(25, number(1), tag(37, hash.digest())),
        number(1), number(0), number(payload.size, 8), number(payload.size, 8), number(0));
    const block = tag(28, array(24, description), array(13), array(26));
    const meta = tag(13, ...fields(controller(template)).filter(part => part.type !== 39)
        .map(part => part.type === 28 ? block : tag(part.type, part.data)));
    const data = tag(30, array(31, tag(31, array(32, tag(32, packed(payload))))));
    // Compute the optional file data checksum independently across blob chunks.
    const table = Uint16Array.from({ length: 256 }, (_, byte) => {
        let bits = byte << 8;
        for(let i = 0; i < 8; i++) bits = (bits << 1) ^ (bits & 0x8000 ? 0x1021 : 0);
        return bits;
    });
    let crc = 0;
    for await (const part of data.stream())
        for(const byte of part) crc = ((crc << 8) & 65535) ^ table[(crc >>> 8) ^ byte];
    const pkg = new File([template.subarray(0, 16), tag(12, tag(35, number(crc, 2)), packed(meta), data)], "大文件.sis");
    const files = await transfer_card_files([pkg]);
    assert.equal(files[0].path, "E:\\INSTALL\\大文件.sis");
    const card = make_transfer_card(files, 0x356);
    assert.equal(card.size, 128 * 1024 ** 2);
    const extracted = await read_fat16_file(card, "INSTALL/大文件.sis", 64 * 1024 ** 2);
    assert.equal(extracted.length, pkg.size);
    assert.equal(sha(extracted), sha(new Uint8Array(await pkg.arrayBuffer())));
});

test("a mixed transfer card keeps original names, extensions and contents", async () => {
    const install = [new File([await load(1)], "Notes 实验版.sisx"), new File([await load(2)], "Notes v2.SIS")];
    const regular = [new File(["utf16 split"], "123456789012🎵.txt"), new File(["reserved alias"], "F0000001.TXT"),
        new File(["exactly 13"], "123456789.txt"), new File([], "empty"), new File(["a movie"], "Example Clip.MP4"),
        ...Array.from({ length: 40 }, (_, i) => new File([String(i)], `Transfer item with a long name ${i}.bin`))];
    const selected = await transfer_card_files([...install, ...regular]);
    assert.deepEqual(selected.map(({ path }) => path), [
        ...install.map(file => "E:\\INSTALL\\" + file.name), ...regular.map(file => "E:\\Transfer\\" + file.name),
    ]);
    const card = make_transfer_card(selected, 0x356);
    assert.deepEqual(await transfer_card_packages(card), install.map(file => file.name));
    assert.deepEqual(await transfer_card_packages(make_transfer_card(await transfer_card_files(regular), 0x356)), []);
    for(const [folder, files] of [["INSTALL", install], ["Transfer", regular]])
    {
        const entries = await list_fat16_directory(card, folder);
        assert.deepEqual(entries.map(({ name }) => name), files.map(file => file.name));
        for(const file of files)
        {
            const content = await read_fat16_file(card, `${folder}/${file.name}`);
            assert.deepEqual(content, new Uint8Array(await file.arrayBuffer()), file.name);
        }
    }
    await assert.rejects(transfer_card_files([new File(["ordinary file"], "bad.sisx")]), /bad.sisx/);
    await assert.rejects(transfer_card_files([new File([], "same.txt"), new File([], "Same.TXT")]), /same name/);
    await assert.rejects(transfer_card_files([new File([], "bad:name")]), /cannot be stored/);
});
