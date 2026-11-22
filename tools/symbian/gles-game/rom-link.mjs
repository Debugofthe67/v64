// SPDX-License-Identifier: BSD-2-Clause
import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { sha256_hex } from "../../../src/image/sha256.js";
import { inspect_syborg_xip } from "../../../src/symbian/syborg_xip.js";
import { validate_syborg_artifacts } from "../../../src/symbian/syborg_import.js";

const ORIGINAL = "977483ad88275c596570a74c4cc4b8ba1a0b387eee58460b401f8968d00bf90c";
const BLOB = 0x80260000, LIMIT = 0x80286DD0;
const GL_LIBRARY = "libgles_cm";
const [phase, input, out, work] = process.argv.slice(2);
const rom = readFileSync(join(input, "ROM.img"));
assert.equal(sha256_hex(rom), ORIGINAL, "Expected the S0 Nokia 5800 reference ROM");
const xip = inspect_syborg_xip(rom);
const base = xip.header.rom_base;
const hex = number => "0x" + number.toString(16);

function exports_of(library)
{
    const file = xip.directory.files.get(`sys/bin/${library}.dll`);
    const image = xip.images.get(file?.address);
    assert.ok(image, "Missing ROM library " + library);
    const def = readFileSync(join(work, library + ".def"), "utf8");
    const entry_point = rom.readUInt32LE(file.address - base + 16);
    const exports = new Map();
    for(const [, name, index] of def.matchAll(/^\s*([\w.$]+) @ ([0-9]+) NONAME$/gm))
    {
        const ordinal = Number(index);
        if(ordinal <= 0 || ordinal > image.export_count) continue;
        const target = rom.readUInt32LE(image.exp + (ordinal - 1) * 4);
        if(!target || target === entry_point) continue;
        const pc = (target & ~1) >>> 0;
        if(pc < image.code || pc >= image.code + image.code_size) continue;
        exports.set(name, { ordinal, target });
    }
    return exports;
}

if(phase === "imports")
{
    const imported = new Map();
    for(const library of ["euser", "ws32", "fbscli", "gdi", "cone"])
        for(const [name, entry] of exports_of(library)) imported.set(name, entry.target);
    const implementations = readFileSync(join(work, "implementation.txt"), "utf8");
    const local = new Set(Array.from(implementations.matchAll(/^[a-fA-F0-9]+ \S (\S+)$/gm), match => match[1]));
    const symbols = new Set(Array.from(readFileSync(join(work, "undefined.txt"), "utf8").matchAll(/^\s+U (\S+)$/gm), match => match[1]));
    const asm = [".syntax unified", ".arm", ".text", ".p2align 2"];
    for(const name of symbols)
    {
        if(local.has(name)) continue;
        const target = imported.get(name);
        assert.ok(target, "Missing Symbian SDK ordinal for " + name);
        // LDR PC interworks across ARM and Thumb and doesn't change the caller's registers.
        asm.push(`.global ${name}`, `.type ${name}, %function`, `${name}:`, "ldr pc, [pc, #-4]", `.word ${hex(target)}`);
    }
    writeFileSync(join(work, "imports.S"), asm.join("\n") + "\n");

    const legacy_exports = exports_of(GL_LIBRARY);
    const entries = [".syntax unified", ".arm", ".text", ".p2align 2"];
    for(const [, name] of implementations.matchAll(/^[a-fA-F0-9]+ T v86_((?:egl|gl)[\w]+)$/gm))
    {
        const entry = legacy_exports.get(name);
        assert.ok(entry && !(entry.target & 3), "Missing ARM libGLES_CM export for " + name);
        const instruction = rom.readUInt32LE(entry.target - base);
        assert.ok(instruction >>> 16 === 0xE92D && !(instruction & 0xA000), "Expected a relocatable ARM PUSH at " + name);
        const symbol = "v86_entry_" + name;
        entries.push(`.global ${symbol}`, `.type ${symbol}, %function`, `${symbol}:`,
            "push {r0-r3, ip, lr}", "bl v86_use_webgpu", "cmp r0, #0", "pop {r0-r3, ip, lr}",
            `bne v86_${name}`, `.word ${hex(instruction)}`, "ldr pc, [pc, #-4]", `.word ${hex(entry.target + 4)}`);
    }
    writeFileSync(join(work, "entries.S"), entries.join("\n") + "\n");
}
else if(phase === "image")
{
    assert.notEqual(realpathSync(input), realpathSync(out), "Choose a separate output directory for the game ROM");
    const input_manifest = readFileSync(join(input, "manifest.json"));
    const rofs = readFileSync(join(input, "ROM.rofs")), devicetree = readFileSync(join(input, "syborg.dtb"));
    const manifest = validate_syborg_artifacts(input_manifest, { rom, rofs, devicetree }).manifest;
    const shim = readFileSync(join(work, "legacy.bin"));
    assert.ok(shim.length && BLOB + shim.length <= LIMIT, "Legacy graphics shim exceeds the free ROM extent");
    assert.ok(rom.subarray(BLOB - base, LIMIT - base).every(byte => byte === 0), "Legacy graphics ROM extent is occupied");
    const legacy_exports = exports_of(GL_LIBRARY);
    const symbols = readFileSync(join(work, "symbols.txt"), "utf8");
    const changes = [];
    const patched = new Set();
    for(const [, linked, name] of symbols.matchAll(/^([a-fA-F0-9]+) T v86_entry_([a-zA-Z][\w]+)$/gm))
    {
        const entry = legacy_exports.get(name);
        assert.ok(entry, "No matching libGLES_CM export for " + name);
        const source = entry.target, target = parseInt(linked, 16);
        assert.ok(!(source & 3) && !(target & 3) && BLOB <= target && target < BLOB + shim.length,
            "Invalid ARM graphics entry point " + name);
        assert.ok(!patched.has(source), "More than one shim targets the same libGLES_CM entry point");
        const delta = target - source - 8;
        assert.ok(delta >= -(1 << 25) && delta < 1 << 25, "ARM branch is out of range");
        const branch = (0xEA000000 | (delta >> 2 & 0xFFFFFF)) >>> 0;
        changes.push({ name, ordinal: entry.ordinal, address: hex(source), from: hex(rom.readUInt32LE(source - base)), to: hex(branch) });
        rom.writeUInt32LE(branch, source - base);
        patched.add(source);
    }
    assert.ok(changes.some(item => item.name === "eglInitialize") && changes.some(item => item.name === "glDrawElements"),
        "Required EGL/GLES entry points are missing");
    shim.copy(rom, BLOB - base);
    manifest.files.rom.sha256 = sha256_hex(rom);
    const updated = Buffer.from(JSON.stringify(manifest, null, 2) + "\n");
    validate_syborg_artifacts(updated, { rom, rofs, devicetree });
    mkdirSync(out, { recursive: true });
    for(const name of ["ROM.rofs", "syborg.dtb", "hybrid-manifest.txt", manifest.files.c_seed.name])
        copyFileSync(join(input, name), join(out, name));
    writeFileSync(join(out, "ROM.img"), rom);
    writeFileSync(join(out, "manifest.json"), updated);
    writeFileSync(join(out, "graphics-rom.json"), JSON.stringify({ original: ORIGINAL, rom: manifest.files.rom.sha256,
        shim: { address: hex(BLOB), bytes: shim.length, sha256: sha256_hex(shim) }, entry_points: changes }, null, 2) + "\n");
    console.log(`Replaced ${changes.length} libGLES_CM entry points in ${join(out, "ROM.img")}`);
}
else
{
    throw new Error("Usage: rom-link.mjs imports|image <reference-dir> <output-dir> <build-dir>");
}
