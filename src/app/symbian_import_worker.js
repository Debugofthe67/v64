// Verify build artifacts and write them to OPFS without blocking the page.
import { SHA256, sha256_hex } from "../image/sha256.js";
import { open_symbian_archive, symbian_worker_asset } from "./symbian_archive.js";
import { compose_syborg_artifacts, SYBORG_COMPONENTS_FILE, SYBORG_COMPONENTS_LIMIT } from "../symbian/syborg_compose.js";
import { verify_syborg_firmware } from "../symbian/syborg_firmware.js";
import {
    parse_syborg_manifest, validate_syborg_artifacts, SYBORG_MANIFEST_MAX_BYTES, SYBORG_MANIFEST_NAME,
} from "../symbian/syborg_import.js";
import { SYBORG_FIRMWARE_FILES } from "../symbian/syborg_profile.js";

const CHUNK = 1024 * 1024;

function progress(text)
{
    globalThis.postMessage({ progress: text });
}

function find_entry(entries, name, optional = false)
{
    const matches = entries.filter(entry => entry.name === name);
    if(matches.length > 1) throw new Error("The firmware archive contains more than one " + name);
    if(!optional && !matches.length) throw new Error("The firmware archive is missing " + name);
    return matches[0];
}

async function read_build(archive, manifest_entry)
{
    if(manifest_entry.size > SYBORG_MANIFEST_MAX_BYTES) throw new Error("manifest.json exceeds the size limit");
    const [manifest] = archive.extract([manifest_entry]);
    const info = parse_syborg_manifest(manifest);
    const siblings = archive.entries.filter(entry => entry.directory === manifest_entry.directory);
    const records = { ...info.files, composition: info.build.composition };
    const roles = ["rom", "rofs", "devicetree", "c_seed", "composition"];
    const entries = roles.map(role => {
        const record = records[role];
        const entry = find_entry(siblings, record.name);
        if(entry.size !== record.bytes) throw new Error("Wrong size for " + entry.name);
        return entry;
    });
    const files = archive.extract(entries);
    const inputs = Object.fromEntries(roles.map((role, index) => [role, files[index]]));
    progress("Verifying the firmware build…");
    await validate_syborg_artifacts(manifest, inputs);
    return { ...inputs, manifest };
}

async function read_original_firmware(archive)
{
    const roles = [];
    const entries = [];
    for(const [role, file] of Object.entries(SYBORG_FIRMWARE_FILES))
    {
        const entry = find_entry(archive.entries, file.name, role === "uda");
        if(!entry) continue;
        if(entry.size !== file.bytes) throw new Error("Wrong size for " + entry.name);
        entries.push(entry);
        roles.push(role);
    }
    progress("Extracting Nokia 5800 firmware…");
    const files = archive.extract(entries);
    const inputs = Object.fromEntries(roles.map((role, index) => [role, { name: entries[index].name, bytes: files[index] }]));
    progress("Verifying the original firmware…");
    const firmware = verify_syborg_firmware(inputs);
    progress("Preparing the Nokia 5800 system images…");
    const response = await fetch(symbian_worker_asset(SYBORG_COMPONENTS_FILE));
    if(!response.ok) throw new Error("This v86 installation is missing the Nokia 5800 assembly components");
    if(Number(response.headers.get("Content-Length")) > SYBORG_COMPONENTS_LIMIT)
        throw new Error("The Nokia 5800 assembly components are too large");
    return compose_syborg_artifacts(new Uint8Array(await response.arrayBuffer()), firmware);
}

async function read_syborg_package(file)
{
    progress("Opening the firmware archive…");
    const archive = await open_symbian_archive(file);
    const manifest_entry = find_entry(archive.entries, SYBORG_MANIFEST_NAME, true);
    const { manifest, rom, rofs, devicetree, c_seed } = manifest_entry ?
        await read_build(archive, manifest_entry) : await read_original_firmware(archive);
    const info = parse_syborg_manifest(manifest);
    const images = { manifest: { name: SYBORG_MANIFEST_NAME, size: manifest.length, sha256: sha256_hex(manifest), bytes: manifest } };
    for(const [role, bytes] of Object.entries({ rom, rofs, devicetree, phone: c_seed }))
    {
        const record = info.files[role === "phone" ? "c_seed" : role];
        images[role] = { name: record.name, size: record.bytes, sha256: record.sha256, bytes };
    }
    const media = Object.fromEntries(Object.entries(images).map(([role, { size, sha256 }]) => [role, { size, sha256 }]));
    return { images, result: { media, manifest: file.name, firmware_version: info.firmware_version, seed: info.c_seed } };
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
        const { images, result } = await read_syborg_package(data.file);
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
