import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { check_n97_firmware } from "../../src/symbian/n97_firmware.js";
import { check_vpl, parse_vpl } from "../../src/symbian/vpl.js";

const encoder = new TextEncoder();
const core = "RM-505_22.0.110_prd.core.C00";
const rofs = "RM-505_22.0.110_prd.rofs2.V01";
const rofs3 = "RM-505_22.0.110_C01_prd.rofs3.fpsx";
const uda = "RM505_507_22.0.110_uda_1_001.uda.fpsx";
const cli = fileURLToPath(new URL("../../tools/symbian/vpl.mjs", import.meta.url));

const file = (name, subtype, extra = "") => `<File>
    <Name>${name}</Name><FileType>Binary</FileType><FileSubType>${subtype}</FileSubType>${extra}
</File>`;
const variant = (code, files, rm = "RM-505") => `<Variant>
    <VariantIdentification>
        <Description>Sample &amp; Test &#x2014; A</Description>
        <TypeDesignator>${rm}</TypeDesignator><ProductCode>${code}</ProductCode><VariantGroup>TEST</VariantGroup>
    </VariantIdentification>
    <SwVersion>22.0.110</SwVersion><VariantVersion>001</VariantVersion>
    <FileList>${files}</FileList>
</Variant>`;
const vpl = (...variants) => encoder.encode(`\uFEFF<?xml version="1.0" encoding="UTF-8"?>
<VariantPackingList>
    <!-- Nokia VPL layout with test bytes -->
    <Tracking><Origin/></Tracking>
    ${variants.join("\n")}
</VariantPackingList>`);

const core_file = file(core, "Mcu", `<Signed>false</Signed><Optional>false</Optional>
    <FlashImage><Version>22.0.110</Version><RofsIndex>1</RofsIndex></FlashImage>
    <FileSize>9</FileSize><Crc>CBF43926</Crc>`);
const rofs_file = file(rofs, "Ppm", `<Optional>false</Optional><EnableCRCVerification>true</EnableCRCVerification>
    <FlashImage><Version>22.0.110.01.01</Version><RofsIndex>2</RofsIndex></FlashImage><Crc>cbf43926</Crc>`);
const rofs3_file = file(rofs3, "Ppm", "<FlashImage><RofsIndex>3</RofsIndex></FlashImage>");
const uda_file = file(uda, "Content");
const pack = vpl(
    variant("059TEST", core_file + rofs_file + file("optional.xml", "CardVerRef", "<Optional>true</Optional>")),
    variant("059TST2", core_file + file("other-region.rofs3.fpsx", "Ppm")),
);
const contents = "123456789";
const contents_sha256 = "15e2b0d3c33891ebb0f1ef609ec419420c20e320ce94c65fbc8c3312448eb225";
const host_file = (name, ...chunks) => ({ name, async *chunks() { yield* chunks.map(chunk => encoder.encode(chunk)); } });

test("reads the Nokia VPL fields and hashes the selected variant's files", async () => {
    const { sha256, variants } = parse_vpl(pack);
    assert.match(sha256, /^[0-9a-f]{64}$/);
    assert.deepEqual(variants.map(v => v.product_code), ["059TEST", "059TST2"]);
    assert.equal(variants[0].description, "Sample & Test — A");
    assert.deepEqual(variants[0].files.map(f => [f.role, f.rofs_index, f.size]), [
        ["core", 1, 9], ["rofs", 2, null], ["metadata", null, null],
    ]);
    const checked = await check_vpl(variants[0], [
        host_file(core.toLowerCase(), "123", "456", "789"), host_file(rofs, contents),
        { name: "other-region.rofs3.fpsx", chunks() { assert.fail("read an unselected component"); } },
    ]);
    assert.equal(checked.ok, true);
    assert.deepEqual(checked.files.map(f => f.status), ["ok", "ok", "optional-missing"]);
    assert.equal(checked.files[0].actual_crc32, "cbf43926");
    assert.equal(checked.files[0].actual_size, 9);
    assert.equal(checked.files[0].sha256, contents_sha256);
});

test("reports missing parts, size and CRC differences, and ambiguous filenames", async () => {
    const { variants } = parse_vpl(pack);
    const checked = await check_vpl(variants[0], [host_file(core, "split", " image")]);
    assert.equal(checked.ok, false);
    assert.deepEqual(checked.files.map(f => f.status), ["mismatch", "missing", "optional-missing"]);
    assert.deepEqual(checked.files[0].mismatches, ["size", "crc32"]);

    const mixed = await check_vpl(variants[0], [host_file(core, "123456788"), host_file(rofs, contents)]);
    assert.deepEqual(mixed.files[0].mismatches, ["crc32"]);
    const ambiguous = await check_vpl(variants[0], [host_file(core, contents), host_file(core.toLowerCase(), contents)]);
    assert.equal(ambiguous.files[0].status, "ambiguous");

    const wrong_version = parse_vpl(vpl(variant("059TEST", core_file.replace("<Version>22.0.110", "<Version>21.0.045"))));
    const version_check = await check_vpl(wrong_version.variants[0], [host_file(core, contents)]);
    assert.deepEqual(version_check.files[0].mismatches, ["flash_version"]);
});

test("rejects paths, external XML declarations, and duplicate items", () => {
    for(const name of ["..&#47;outside", "C:\\outside", "\\\\server\\share", "file:stream", "NUL.bin", "/name", "file%2fescape"])
    {
        assert.throws(() => parse_vpl(vpl(variant("059TEST", file(name, "Mcu")))), /unsafe filename/);
    }
    assert.throws(() => parse_vpl(encoder.encode('<!DOCTYPE VariantPackingList SYSTEM "file:///private/data">')), /XML markup/);
    assert.throws(() => parse_vpl(vpl(variant("059TEST", file("&outside;", "Mcu")))), /XML character reference/);
    assert.throws(() => parse_vpl(vpl(variant("059TEST", core_file + file(core.toLowerCase(), "Mcu")))), /duplicate filename/);
    assert.throws(() => parse_vpl(vpl(variant("059TEST", core_file).replace("</FileList>", "</WrongTag>"))), /closing tag/);
});

test("N97 preflight requires a single CORE, both ROFS overlays, and nonempty UDA", async () => {
    const first_variant = files => parse_vpl(vpl(variant("059TEST", files))).variants[0];
    const metadata_only = await check_n97_firmware(first_variant(file("x.dcp", "Other")), [host_file("x.dcp")]);
    assert.equal(metadata_only.ok, false);
    assert.match(metadata_only.issues.join("\n"), /CORE.*\n.*ROFS2.*\n.*ROFS3.*\n.*UDA/);

    const parts = core_file + rofs_file + rofs3_file + uda_file;
    const inputs = [host_file(core, contents), host_file(rofs, contents), host_file(rofs3, contents), host_file(uda)];
    const empty = await check_n97_firmware(first_variant(parts), inputs);
    assert.equal(empty.ok, false);
    assert.deepEqual(empty.issues, [`Required file ${uda} is empty.`]);

    const duplicate = file("extra.C00", "Mcu", "<FlashImage><RofsIndex>1</RofsIndex></FlashImage>");
    const layers = await check_n97_firmware(first_variant(parts.replace("<RofsIndex>3", "<RofsIndex>4") + duplicate), inputs);
    assert.equal(layers.ok, false);
    assert.match(layers.issues.join("\n"), /multiple CORE.*\n.*ROFS3.*\n.*ROFS index 2 or 3/);
});

test("CLI lists variants and checks one local RM-505 package", t => {
    const directory = mkdtempSync(join(tmpdir(), "v86-vpl-"));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const manifest = join(directory, "RM505.VPL");
    writeFileSync(manifest, vpl(
        variant("059TEST", core_file + rofs_file + rofs3_file + uda_file),
        variant("059TST2", core_file + rofs_file + rofs3_file.replace(rofs3, "other-region.rofs3.fpsx") + uda_file),
    ));
    writeFileSync(join(directory, "RM506.vpl"), vpl(variant("059TST6", core_file, "RM-506")));
    writeFileSync(join(directory, core.toLowerCase()), contents);
    writeFileSync(join(directory, rofs), contents);
    writeFileSync(join(directory, rofs3), contents);
    writeFileSync(join(directory, uda), contents);

    function run(status, ...args)
    {
        const result = spawnSync(process.execPath, [cli, ...args], { encoding: "utf8" });
        assert.equal(result.status, status, result.stderr || result.stdout);
        return JSON.parse(result.stdout);
    }

    const listed = run(0, "list", directory);
    assert.deepEqual(listed.variants.map(v => v.product_code), ["059TEST", "059TST2", "059TST6"]);
    assert.match(run(1, "check", directory).error, /More than one/);
    assert.match(run(1, "check", directory, "--product-code", "059TST6").error, /No RM-505/);
    const checked = run(0, "check", manifest, "--product-code", "059test");
    assert.equal(checked.manifest, "RM505.VPL");
    assert.equal(checked.manifest_sha256, listed.variants[0].manifest_sha256);
    assert.equal(checked.files[0].sha256, contents_sha256);
    assert.equal(run(1, "check", directory, "--product-code", "059TST2").files[2].status, "missing");

    rmSync(join(directory, rofs));
    symlinkSync(join(directory, core.toLowerCase()), join(directory, rofs));
    assert.equal(run(1, "check", manifest, "--product-code", "059TEST").files[1].status, "unreadable");
});
