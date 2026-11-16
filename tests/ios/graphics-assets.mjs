import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { GRAPHICS_LIBRARY, GRAPHICS_SOURCES, prepare_graphics_asset, read_graphics_asset } from "../../tools/ios/graphics-assets.mjs";
import { cdhashes, check_guest_library } from "../../src/ios/guest_load.js";

const repository = path.resolve(import.meta.dirname, "../.."), asset = "bios/ios-guest/" + GRAPHICS_LIBRARY;

function fixture(t)
{
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "v86-graphics-assets-"));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    for(const name of [...GRAPHICS_SOURCES, asset, "bios/ios-guest/manifest.json"])
    {
        const target = path.join(root, name);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.copyFileSync(path.join(repository, name), target);
    }
    return root;
}

test("release adapter is signed ARMv7 and stages without Apple tools or firmware", t => {
    const root = fixture(t), bytes = prepare_graphics_asset(root);
    check_guest_library(bytes);
    assert.ok(cdhashes(bytes).length > 0);
    assert.deepEqual(fs.readFileSync(path.join(root, "build/ios-guest", GRAPHICS_LIBRARY)), bytes);
    assert.equal(fs.existsSync(path.join(root, "build/ios")), false);
});

test("missing release library fails even when a local development copy exists", t => {
    const root = fixture(t), output = path.join(root, "build/ios-guest", GRAPHICS_LIBRARY), local = Buffer.from("local adapter");
    fs.mkdirSync(path.dirname(output), { recursive: true });fs.writeFileSync(output, local);
    fs.unlinkSync(path.join(root, asset));
    assert.throws(() => prepare_graphics_asset(root), { code: "ENOENT" });
    assert.deepEqual(fs.readFileSync(output), local);
});

test("binary and source corruption fail before writing build output", t => {
    for(const changed of [asset, "tools/ios/guest/eagl.c", "src/gles/gles_wire.js"])
    {
        const root = fixture(t);
        fs.appendFileSync(path.join(root, changed), "changed");
        assert.throws(() => prepare_graphics_asset(root), changed === asset ? /Corrupt iPhone graphics/ : /graphics sources changed/);
        assert.equal(fs.existsSync(path.join(root, "build/ios-guest", GRAPHICS_LIBRARY)), false);
    }
});

test("manifest hash alone cannot authorize modified signed code", t => {
    const root = fixture(t), binary = fs.readFileSync(path.join(root, asset));
    binary[4096] ^= 1;fs.writeFileSync(path.join(root, asset), binary);
    const file = path.join(root, "bios/ios-guest/manifest.json"), manifest = JSON.parse(fs.readFileSync(file, "utf8"));
    manifest.files[GRAPHICS_LIBRARY] = createHash("sha256").update(binary).digest("hex");
    fs.writeFileSync(file, JSON.stringify(manifest));
    assert.throws(() => read_graphics_asset(root), /Invalid signed page/);
});

test("a different runtime or incomplete provenance is rejected", t => {
    for(const mutate of [m => { m.build = "other"; }, m => { delete m.sources[GRAPHICS_SOURCES[0]]; }])
    {
        const root = fixture(t), file = path.join(root, "bios/ios-guest/manifest.json"), manifest = JSON.parse(fs.readFileSync(file, "utf8"));
        mutate(manifest);fs.writeFileSync(file, JSON.stringify(manifest));
        assert.throws(() => prepare_graphics_asset(root), /manifest/);
    }
});
