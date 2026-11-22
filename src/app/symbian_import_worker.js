// Verify build artifacts and write them to OPFS without blocking the page.
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

function progress(text)
{
    globalThis.postMessage({ progress: text });
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

async function write_images(images, ids)
{
    let directory = await navigator.storage.getDirectory();
    for(const name of ["v86", "disks"]) directory = await directory.getDirectoryHandle(name, { create: true });
    const chunk = new Uint8Array(CHUNK);
    for(const [role, image] of Object.entries(images))
    {
        const id = ids[role];
        if(typeof id !== "string" || !/^[a-f0-9-]+-symbian-(?:manifest|rom|rofs|devicetree|phone)$/.test(id) ||
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
            for(let at = 0; at < image.bytes.length; at += CHUNK)
            {
                const bytes = image.bytes.subarray(at, at + CHUNK);
                if(store.write(bytes, { at }) !== bytes.length) throw new Error("Short write to " + image.name);
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

globalThis.onmessage = async ({ data }) =>
{
    try
    {
        if(data.op !== "check-syborg" && data.op !== "import-syborg") throw new Error("Unknown firmware import operation");
        const { images, result } = await read_syborg_package(data.files);
        if(data.op === "import-syborg")
        {
            for(const [role, { size, sha256 }] of Object.entries(result.media))
                if(data.expected.media[role]?.sha256 !== sha256 || data.expected.media[role]?.size !== size)
                    throw new Error("The " + images[role].name + " image changed since preflight");
            await write_images(images, data.ids);
        }
        globalThis.postMessage({ result });
    }
    catch(error)
    {
        globalThis.postMessage({ error: String(error.message || error) });
    }
};
