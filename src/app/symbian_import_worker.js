// Runs on its own thread so checksums, FPSX reconstruction and OPFS writes
// can be cancelled even while a synchronous parser is running.
import { parse_vpl, VPL_MAX_BYTES } from "../symbian/vpl.js";
import { check_n97_firmware } from "../symbian/n97_firmware.js";
import { extract_n97_images } from "../symbian/n97_images.js";
import { N97_DEVICE, N97_MEDIA } from "../symbian/catalog.js";
import { SHA256, sha256_hex } from "../image/sha256.js";

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
    self.postMessage({ progress: text });
}

async function read_package(files, selection, supplements)
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
    // A loose file supplied for this choice can fill a missing basename. An
    // existing sibling keeps priority and duplicate loose names stay visible
    // to check_vpl's ambiguity check.
    const sibling_names = new Set(siblings.map(file => file.name.toLowerCase()));
    for(const supplement of supplements)
    {
        if(!sibling_names.has(supplement.name.toLowerCase())) siblings.push(supplement);
    }
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
    return { check, images, languages: extracted.report.languages };
}

function result_of(check, images, languages)
{
    return {
        check, languages,
        media: images && Object.fromEntries(Object.entries(images).map(([role, { size, sha256 }]) =>
            [role, { size, sha256 }])),
    };
}

async function write_images(images, ids)
{
    let directory = await navigator.storage.getDirectory();
    for(const name of ["v86", "disks"]) directory = await directory.getDirectoryHandle(name, { create: true });
    const chunk = new Uint8Array(CHUNK);
    for(const [role, image] of Object.entries(images))
    {
        const id = ids[role];
        if(typeof id !== "string" || !/^[a-f0-9-]+-symbian-(?:rom|rofs[123]|phone|boot_media|nand)$/.test(id))
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
}

self.onmessage = async ({ data }) =>
{
    try
    {
        if(data.op === "scan")
        {
            self.postMessage({ result: await scan(data.files) });
            return;
        }
        if(data.op !== "check" && data.op !== "import") throw new Error("Unknown firmware import operation");
        const { check, images, languages } = await read_package(data.files, data.selection, data.supplements);
        const result = result_of(check, images, languages);
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
        self.postMessage({ result });
    }
    catch(error)
    {
        self.postMessage({ error: error.message });
    }
};
