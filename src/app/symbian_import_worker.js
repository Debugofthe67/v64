// Runs on its own thread so checksums, FPSX reconstruction and OPFS writes
// can be cancelled even while a synchronous parser is running.
import { parse_vpl, VPL_MAX_BYTES } from "../symbian/vpl.js";
import { check_n97_firmware } from "../symbian/n97_firmware.js";
import { extract_n97_images } from "../symbian/n97_images.js";
import { N97_DEVICE, N97_MEDIA } from "../symbian/catalog.js";
import { open_n97_emmc } from "../symbian/n97_mmc_media.js";
import { format_n97_emmc } from "../symbian/n97_emmc_format.js";
import { SHA256, sha256_hex } from "../image/sha256.js";
import {
    parse_syborg_manifest, validate_syborg_artifacts, SYBORG_MANIFEST_MAX_BYTES, SYBORG_MANIFEST_NAME,
} from "../symbian/syborg_import.js";

const CHUNK = 1024 * 1024;

function path(file)
{
    return file.path;
}

function manifest_directory(file)
{
    const name = path(file);
    return name.slice(0, name.lastIndexOf("/") + 1);
}

async function scan(files)
{
    const variants = [];
    const errors = [];
    for(const manifest of files.filter(file => /\.vpl$/i.test(file.name)))
    {
        try
        {
            if(manifest.size > VPL_MAX_BYTES) throw new Error("VPL exceeds 1 MiB");
            const parsed = parse_vpl(new Uint8Array(await manifest.file.arrayBuffer()));
            for(const [index, variant] of parsed.variants.entries())
            {
                const { type_designator, product_code, sw_version, variant_version, description, variant_group } = variant;
                variants.push({ manifest: path(manifest), index, manifest_sha256: parsed.sha256, type_designator,
                    product_code, sw_version, variant_version, description, variant_group });
            }
        }
        catch(error)
        {
            errors.push(path(manifest) + ": " + error.message);
        }
    }
    return { variants, errors };
}

function progress(text)
{
    globalThis.postMessage({ progress: text });
}

async function read_package(files, selection)
{
    const manifests = files.filter(file => path(file) === selection.manifest);
    if(manifests.length !== 1 || manifests[0].size > VPL_MAX_BYTES) throw new Error("Select the variant's VPL again");
    const manifest = manifests[0];
    const parsed = parse_vpl(new Uint8Array(await manifest.file.arrayBuffer()));
    const variant = parsed.variants[selection.index];
    if(!variant || parsed.sha256 !== selection.manifest_sha256) throw new Error("The VPL changed. Select it again");
    if(variant.type_designator !== N97_DEVICE.model)
    {
        throw new Error("Nokia N97 requires an RM-505 VPL. Selected " + variant.type_designator);
    }

    const siblings = files.filter(file => manifest_directory(file) === manifest_directory(manifest));
    const by_name = new Map(siblings.map(file => [file.name.toLowerCase(), file]));
    const sources = siblings.map(file => ({
        name: file.name,
        async *chunks()
        {
            progress("Checking " + file.name + "…");
            for(let offset = 0; offset < file.size; offset += CHUNK)
            {
                yield new Uint8Array(await file.file.slice(offset, offset + CHUNK).arrayBuffer());
            }
        },
    }));
    const check = await check_n97_firmware(variant, sources);
    if(!check.ok) return { check };
    const inputs = {};
    for(const record of check.files)
    {
        if(record.status !== "ok" || !["core", "rofs", "uda", "eno"].includes(record.role)) continue;
        const role = record.role === "rofs" ? "rofs" + record.rofs_index : record.role;
        if(inputs[role]) throw new Error("Multiple images for " + role);
        const file = by_name.get(record.name.toLowerCase());
        progress("Reading " + record.name + "…");
        const bytes = new Uint8Array(await file.file.arrayBuffer());
        if(bytes.length !== record.actual_size || sha256_hex(bytes) !== record.sha256)
        {
            throw new Error(record.name + " changed during the check");
        }
        inputs[role] = bytes;
    }
    progress("Rebuilding the XIP ROM and firmware images…");
    const extracted = extract_n97_images(inputs);
    const images = Object.fromEntries(Object.entries(N97_MEDIA).flatMap(([role, name]) => {
        const file = extracted.files.find(file => file.name === name);
        return file ? [[role, file]] : [];
    }));
    return { check, images, languages: extracted.report.languages, stl: extracted.report.nand.stl };
}

function result_of(check, images, languages, stl)
{
    return {
        check, languages, stl,
        media: images && Object.fromEntries(Object.entries(images).map(([role, { size, sha256 }]) =>
            [role, { size, sha256 }])),
    };
}

async function read_syborg_package(files)
{
    const manifests = files.filter(file => file.name === SYBORG_MANIFEST_NAME);
    if(manifests.length !== 1) throw new Error("Choose a build folder containing one manifest.json");
    const manifest_file = manifests[0];
    if(manifest_file.size > SYBORG_MANIFEST_MAX_BYTES) throw new Error("manifest.json exceeds the size limit");
    const manifest_bytes = new Uint8Array(await manifest_file.file.arrayBuffer());
    const manifest = parse_syborg_manifest(manifest_bytes);
    const siblings = files.filter(file => manifest_directory(file) === manifest_directory(manifest_file));
    const records = { ...manifest.files, composition: manifest.build.composition };
    const inputs = {};
    for(const role of ["rom", "rofs", "devicetree", "c_seed", "composition"])
    {
        const record = records[role];
        const matches = siblings.filter(file => file.name === record.name);
        if(matches.length !== 1) throw new Error("Expected " + record.name + " next to manifest.json");
        if(matches[0].size !== record.bytes) throw new Error("Wrong size for " + record.name);
        progress("Reading " + record.name + "…");
        inputs[role] = new Uint8Array(await matches[0].file.arrayBuffer());
    }
    progress("Verifying firmware structure and SHA-256…");
    validate_syborg_artifacts(manifest_bytes, inputs);
    const images = {
        manifest: { name: manifest_file.name, size: manifest_bytes.length, sha256: sha256_hex(manifest_bytes), bytes: manifest_bytes },
    };
    for(const [role, src] of Object.entries({ rom: "rom", rofs: "rofs", devicetree: "devicetree", phone: "c_seed" }))
    {
        const { name, bytes: size, sha256 } = records[src];
        images[role] = { name, size, sha256, bytes: inputs[src] };
    }
    const media = Object.fromEntries(Object.entries(images).map(([role, { size, sha256 }]) => [role, { size, sha256 }]));
    return { images, result: { media, manifest: manifest_file.path, firmware_version: manifest.firmware_version, seed: manifest.c_seed } };
}

async function write_images(images, ids, legacy = true)
{
    let directory = await navigator.storage.getDirectory();
    for(const name of ["v86", "disks"]) directory = await directory.getDirectoryHandle(name, { create: true });
    const chunk = new Uint8Array(CHUNK);
    for(const [role, image] of Object.entries(images))
    {
        const id = ids[role];
        if(typeof id !== "string" || !/^[a-f0-9-]+-symbian-(?:manifest|rom|rofs[123]?|devicetree|phone|boot_media|nand)$/.test(id) ||
            !id.endsWith("-" + role))
        {
            throw new Error("Invalid firmware import destination");
        }
        const file = await directory.getFileHandle(id + ".img", { create: true });
        const store = await file.createSyncAccessHandle();
        try
        {
            progress("Writing " + image.name + "…");
            store.truncate(0);
            if(image.chunks)
            {
                for(const { at, bytes } of image.chunks())
                {
                    if(store.write(bytes, { at }) !== bytes.length) throw new Error("Short write to " + image.name);
                }
            }
            else
            {
                for(let at = 0; at < image.bytes.length; at += CHUNK)
                {
                    const bytes = image.bytes.subarray(at, at + CHUNK);
                    if(store.write(bytes, { at }) !== bytes.length) throw new Error("Short write to " + image.name);
                }
            }
            store.truncate(image.size);
            store.flush();
            progress("Verifying the stored " + image.name + "…");
            const hash = new SHA256();
            if(store.getSize() !== image.size) throw new Error("Unexpected stored size for " + image.name);
            for(let at = 0; at < image.size; at += CHUNK)
            {
                const bytes = chunk.subarray(0, Math.min(CHUNK, image.size - at));
                if(store.read(bytes, { at }) !== bytes.length) throw new Error("Short read of " + image.name);
                hash.update(bytes);
            }
            if(hash.hex() !== image.sha256) throw new Error("Stored firmware checksum mismatch for " + image.name);
        }
        finally
        {
            store.close();
        }
    }
    if(!legacy) return;
    if(typeof ids.emmc !== "string" || !/^[a-f0-9-]+-symbian-emmc$/.test(ids.emmc))
        throw new Error("Invalid eMMC import destination");
    progress("Creating the Nokia N97's sparse eMMC…");
    const handle = await directory.getFileHandle(ids.emmc + ".img", { create: true });
    const store = await handle.createSyncAccessHandle();
    try
    {
        format_n97_emmc(open_n97_emmc(store, true), crypto.getRandomValues(new Uint32Array(1))[0]);
        store.flush();
        open_n97_emmc(store);
    }
    finally { store.close(); }
}

globalThis.onmessage = async ({ data }) =>
{
    try
    {
        if(data.op === "check-syborg" || data.op === "import-syborg")
        {
            const { images, result } = await read_syborg_package(data.files);
            if(data.op === "import-syborg")
            {
                for(const [role, { size, sha256 }] of Object.entries(result.media))
                    if(data.expected.media[role]?.sha256 !== sha256 || data.expected.media[role]?.size !== size)
                        throw new Error("The " + images[role].name + " image changed since preflight");
                await write_images(images, data.ids, false);
            }
            globalThis.postMessage({ result });
            return;
        }
        if(data.op === "scan")
        {
            globalThis.postMessage({ result: await scan(data.files) });
            return;
        }
        if(data.op !== "check" && data.op !== "import") throw new Error("Unknown firmware import operation");
        const { check, images, languages, stl } = await read_package(data.files, data.selection);
        const result = result_of(check, images, languages, stl);
        if(data.op === "import")
        {
            if(!check.ok) throw new Error("The required firmware files no longer pass preflight");
            if(Object.keys(result.media).length !== Object.keys(data.expected.media).length)
            {
                throw new Error("The firmware images changed since preflight");
            }
            for(const [role, saved] of Object.entries(data.expected.media))
            {
                if(result.media[role]?.sha256 !== saved.sha256 || result.media[role]?.size !== saved.size)
                {
                    throw new Error("The " + role + " image changed since preflight");
                }
            }
            const verified = new Map(data.expected.check.files.map(file => [file.name, file]));
            for(const file of check.files)
            {
                if(file.status !== verified.get(file.name)?.status || file.sha256 !== verified.get(file.name)?.sha256)
                {
                    throw new Error(file.name + " changed since preflight");
                }
            }
            await write_images(images, data.ids);
        }
        globalThis.postMessage({ result });
    }
    catch(error)
    {
        globalThis.postMessage({ error: error.message });
    }
};
