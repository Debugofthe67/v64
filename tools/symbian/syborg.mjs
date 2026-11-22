#!/usr/bin/env node

import { mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { verify_syborg_firmware } from "../../src/symbian/syborg_firmware.js";
import { pack_syborg_components, SYBORG_COMPONENTS_FILE } from "../../src/symbian/syborg_compose.js";
import {
    make_syborg_manifest, parse_syborg_manifest, validate_syborg_artifacts, SYBORG_COMPOSITION_NAME,
    SYBORG_MANIFEST_MAX_BYTES, SYBORG_MANIFEST_NAME, SYBORG_READ_ONLY_FILES,
} from "../../src/symbian/syborg_import.js";
import { SYBORG_C_SEEDS, SYBORG_FIRMWARE_FILES, SYBORG_PROFILE } from "../../src/symbian/syborg_profile.js";
import { audit_syborg_xip } from "../../src/symbian/syborg_xip.js";

const usage = `Usage:
  node tools/symbian/syborg.mjs firmware FIRMWARE_DIR
  node tools/symbian/syborg.mjs manifest FIRMWARE_DIR ARTIFACT_DIR [--factory-seed]
  node tools/symbian/syborg.mjs verify ARTIFACT_DIR [FIRMWARE_DIR]
  node tools/symbian/syborg.mjs components FIRMWARE_DIR ARTIFACT_DIR [OUTPUT_FILE]`;

const firmware_roles = {
    core: /^rm-?356_.*\.core\.c00$/i,
    rofs2: /^rm-?356_.*\.rofs2\.v[\da-z]{2}$/i,
    rofs3: /^rm-?356_.*\.rofs3\.fpsx$/i,
    uda: /^rm-?356_.*\.uda\.fpsx$/i,
};

async function read_sized(directory, name, limit, exact = false)
{
    const path = join(directory, name);
    const info = await stat(path).catch(error => {
        if(error.code === "ENOENT") throw new Error("Missing " + path);
        throw error;
    });
    if(!info.isFile()) throw new Error("Expected a file at " + path);
    if(info.size > limit || exact && info.size !== limit) throw new Error("Wrong size for " + path);
    return readFile(path);
}

async function read_firmware(directory)
{
    const names = await readdir(directory);
    const entries = await Promise.all(Object.entries(SYBORG_FIRMWARE_FILES).map(async ([role, file]) => {
        if(!names.includes(file.name))
        {
            const wrong = names.find(name => firmware_roles[role].test(name));
            if(wrong) throw new Error(`Wrong RM-356 ${role} version: expected ${file.name}, got ${wrong}`);
            if(role === "uda") return [role, undefined];
            throw new Error(`Missing RM-356 ${role}: ${file.name}`);
        }
        return [role, { name: file.name, bytes: await read_sized(directory, file.name, file.bytes, true) }];
    }));
    return verify_syborg_firmware(Object.fromEntries(entries));
}

async function read_artifacts(directory, seed, manifest)
{
    const files = manifest?.["files"];
    const specs = [
        ["rom", SYBORG_READ_ONLY_FILES.rom, files?.["rom"]?.["bytes"] ?? 128 * 1024 * 1024],
        ["rofs", SYBORG_READ_ONLY_FILES.rofs, files?.["rofs"]?.["bytes"] ?? SYBORG_PROFILE.rofs_window_size],
        ["devicetree", SYBORG_READ_ONLY_FILES.devicetree, files?.["devicetree"]?.["bytes"] ?? 1024 * 1024],
        ["c_seed", SYBORG_C_SEEDS[seed].name, SYBORG_C_SEEDS[seed].bytes],
        ["composition", SYBORG_COMPOSITION_NAME, manifest?.["build"]?.["composition"]?.["bytes"] ?? 1024 * 1024],
    ];
    return Object.fromEntries(await Promise.all(specs.map(async ([role, name, size]) => [
        role, await read_sized(directory, name, size, !!manifest || role === "c_seed"),
    ])));
}

async function write_artifact(destination, bytes)
{
    const directory = dirname(destination);
    await mkdir(directory, { recursive: true });
    const temp_dir = await mkdtemp(join(directory, ".syborg-"));
    try
    {
        const temporary = join(temp_dir, "output");
        await writeFile(temporary, bytes);
        await rename(temporary, destination);
    }
    finally
    {
        await rm(temp_dir, { recursive: true, force: true });
    }
}

function print_artifacts(info, audit)
{
    const { manifest, xip, layers } = info;
    console.log("Verified Nokia 5800 RM-356 31.0.101 Syborg import set");
    console.log(`ROM: linked at 0x${xip.header.rom_base.toString(16)}, ${xip.directory.files.size} directory files, ${xip.images.size} images, ${xip.exception_entries} exception entries`);
    console.log("ROFS: " + layers.map(layer => `${layer.drive} (${layer.size} bytes)`).join(", "));
    console.log("C: " + manifest["files"]["c_seed"]["name"]);
    if(audit)
    {
        console.log(`CORE comparison: ${audit.user_files} original linked files, ${audit.replacement_files} replacement files`);
        console.log(`EUser: ${audit.euser_exports} exports, ${audit.euser_linked_thunks} linked ARM import thunks, ${audit.euser_imported_ordinals} matching ordinals`);
    }
}

async function main([command, first, second, flag, ...rest])
{
    if(!first || rest.length) throw new Error(usage);
    if(command === "firmware" && !second)
    {
        const { core, rofs, uda } = await read_firmware(first);
        console.log(`Verified Nokia 5800 RM-356 31.0.101 CORE (${core.bytes.length} unpaged bytes), ROFS drives 9/10/11 (${rofs.map(layer => layer.length).join("/")} bytes)`);
        console.log(uda ? `Verified optional factory UDA (${uda.logical_size}-byte FAT16)` : "Optional factory UDA absent");
        return;
    }
    if(command === "manifest" && second && (!flag || flag === "--factory-seed"))
    {
        const firmware = await read_firmware(first);
        const seed = flag ? "factory" : "blank";
        if(seed === "factory" && !firmware.uda) throw new Error("Factory seed requires the matching UDA input");
        const artifacts = await read_artifacts(second, seed);
        const manifest_bytes = make_syborg_manifest(artifacts, seed, !!firmware.uda);
        const info = validate_syborg_artifacts(manifest_bytes, artifacts);
        const audit = audit_syborg_xip(artifacts.rom, info.xip, firmware.core, artifacts.composition);
        await write_artifact(join(second, SYBORG_MANIFEST_NAME), manifest_bytes);
        print_artifacts(info, audit);
        console.log("Wrote " + join(second, SYBORG_MANIFEST_NAME));
        return;
    }
    if(command === "verify" && !flag)
    {
        const manifest_bytes = await read_sized(first, SYBORG_MANIFEST_NAME, SYBORG_MANIFEST_MAX_BYTES);
        const manifest = parse_syborg_manifest(manifest_bytes);
        const artifacts = await read_artifacts(first, manifest["c_seed"], manifest);
        const info = validate_syborg_artifacts(manifest_bytes, artifacts);
        const firmware = second ? await read_firmware(second) : undefined;
        if(firmware && manifest["build"]["firmware"]["uda"] && !firmware.uda)
        {
            throw new Error("Manifest requires the original UDA for full verification");
        }
        const audit = firmware ? audit_syborg_xip(artifacts.rom, info.xip, firmware.core, artifacts.composition) : undefined;
        print_artifacts(info, audit);
        return;
    }
    if(command === "components" && second)
    {
        const { core } = await read_firmware(first);
        const artifacts = await read_artifacts(second, "blank");
        const manifest = make_syborg_manifest(artifacts, "blank", false);
        const { xip } = validate_syborg_artifacts(manifest, artifacts);
        audit_syborg_xip(artifacts.rom, xip, core, artifacts.composition);
        const output = flag || join("build", SYBORG_COMPONENTS_FILE);
        await write_artifact(output, pack_syborg_components(artifacts, core));
        console.log("Wrote Nokia 5800 assembly components to " + output);
        return;
    }
    throw new Error(usage);
}

main(process.argv.slice(2)).catch(error => {
    console.error(error.message);
    process.exitCode = 1;
});
