import assert from "node:assert/strict";
import { test } from "node:test";
import { check_vpl, parse_vpl } from "../../src/symbian/vpl.js";

const encoder = new TextEncoder();
const core = "RM-356_22.0.110_prd.core.C00";
const rofs = "RM-356_22.0.110_prd.rofs2.V01";
const rofs3 = "RM-356_22.0.110_C01_prd.rofs3.fpsx";
const uda = "RM356_507_22.0.110_uda_1_001.uda.fpsx";

const file = (name, subtype, extra = "") => `<File>
    <Name>${name}</Name><FileType>Binary</FileType><FileSubType>${subtype}</FileSubType>${extra}
</File>`;
const variant = (code, files, rm = "RM-356") => `<Variant>
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
