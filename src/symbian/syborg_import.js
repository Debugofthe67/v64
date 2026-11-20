import { c_string, u32, u32be } from "../android/bytes.js";
import { sha256_hex } from "../image/sha256.js";
import { read_sos_rofs } from "./firmware_partitions.js";
import {
    SYBORG_C_SEEDS, SYBORG_FIRMWARE_FILES, SYBORG_FORMAT, SYBORG_FORMAT_VERSION,
    SYBORG_PROFILE, SYBORG_ROFS_LAYERS,
} from "./syborg_profile.js";
import { inspect_syborg_xip } from "./syborg_xip.js";

export const SYBORG_MANIFEST_NAME = "manifest.json";
export const SYBORG_COMPOSITION_NAME = "hybrid-manifest.txt";
export const SYBORG_MANIFEST_MAX_BYTES = 16 * 1024;
export const SYBORG_READ_ONLY_FILES = { rom: "ROM.img", rofs: "ROM.rofs", devicetree: "syborg.dtb" };

const ROFS_HEADER_SIZE = 4096;
const ROM_LIMIT = 128 * 1024 * 1024;
const DTB_LIMIT = 1024 * 1024;
const COMPOSITION_LIMIT = 1024 * 1024;
const SHA256 = /^[a-f0-9]{64}$/;

function invalid(message)
{
    throw new Error("Syborg import: " + message);
}

function describe(name, bytes)
{
    return { "name": name, "bytes": bytes.length, "sha256": sha256_hex(bytes) };
}

function matches_record(record, expected)
{
    return record?.["name"] === expected.name && record["bytes"] === expected.bytes && record["sha256"] === expected.sha256;
}

/** Validate manifest metadata before asking the caller to read large files. */
export function parse_syborg_manifest(bytes)
{
    if(bytes.length > SYBORG_MANIFEST_MAX_BYTES) invalid("manifest.json exceeds the size limit");
    let manifest;
    try
    {
        manifest = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    }
    catch(e)
    {
        invalid("manifest.json is not valid UTF-8 JSON");
    }
    if(manifest?.["format"] !== SYBORG_FORMAT || manifest["format_version"] !== SYBORG_FORMAT_VERSION)
    {
        invalid("unsupported manifest format or version");
    }
    if(manifest["profile"] !== SYBORG_PROFILE.id || manifest["firmware_version"] !== SYBORG_PROFILE.firmware_version)
    {
        invalid("unsupported firmware profile or version");
    }
    if(manifest["cpu"] !== SYBORG_PROFILE.cpu || manifest["personality"] !== SYBORG_PROFILE.personality ||
        manifest["ram_size"] !== SYBORG_PROFILE.ram_size)
    {
        invalid("incorrect CPU, memory size or guest ABI for this profile");
    }
    const build = manifest["build"];
    if(build?.["qembian_revision"] !== SYBORG_PROFILE.qembian_revision ||
        build["sources_lock_sha256"] !== SYBORG_PROFILE.qembian_sources_lock_sha256)
    {
        invalid("unsupported qembian build revision or source lock");
    }
    check_file_record(build["composition"], "composition", SYBORG_COMPOSITION_NAME, COMPOSITION_LIMIT);
    if(typeof build["firmware"]?.["uda"] !== "undefined" &&
        !matches_record(build["firmware"]["uda"], SYBORG_FIRMWARE_FILES.uda))
    {
        invalid("unsupported UDA source fingerprint");
    }
    for(const role of ["core", "rofs2", "rofs3"])
    {
        if(!matches_record(build["firmware"]?.[role], SYBORG_FIRMWARE_FILES[role]))
        {
            invalid("missing or unsupported source fingerprint for " + role);
        }
    }

    const { Z, C, D, E } = SYBORG_PROFILE.drives;
    const drives = manifest["drives"];
    if(drives?.["C"] !== C || drives["D"] !== D || drives["E"] !== E ||
        !Array.isArray(drives["Z"]) || drives["Z"].length !== Z.length || Z.some((id, i) => drives["Z"][i] !== id))
    {
        invalid("incorrect C:, D:, E: or Z: drive mapping");
    }
    const layers = manifest["rofs_layers"];
    if(!Array.isArray(layers) || layers.length !== Z.length)
    {
        invalid("expected three ordered ROFS layers");
    }
    SYBORG_ROFS_LAYERS.forEach(({ role, source, sha256 }, index) => {
        const layer = layers[index];
        if(layer?.["role"] !== role || layer["drive"] !== Z[index] || layer["source"] !== source || layer["sha256"] !== sha256)
        {
            invalid("unexpected ROFS layer, drive or source fingerprint at index " + index);
        }
    });

    const files = manifest["files"];
    check_file_record(files?.["rom"], "rom", SYBORG_READ_ONLY_FILES.rom, ROM_LIMIT);
    check_file_record(files?.["rofs"], "rofs", SYBORG_READ_ONLY_FILES.rofs, SYBORG_PROFILE.rofs_window_size);
    check_file_record(files?.["devicetree"], "devicetree", SYBORG_READ_ONLY_FILES.devicetree, DTB_LIMIT);
    const seed = manifest["c_seed"];
    if((seed !== "blank" && seed !== "factory") || !matches_record(files?.["c_seed"], SYBORG_C_SEEDS[seed]) ||
        seed === "factory" && !build["firmware"]["uda"])
    {
        invalid("invalid C: seed fingerprint or missing factory UDA");
    }
    return manifest;
}

function check_file_record(record, role, name, max)
{
    if(record?.["name"] !== name || !Number.isSafeInteger(record["bytes"]) || record["bytes"] <= 0 ||
        record["bytes"] > max || typeof record["sha256"] !== "string" || !SHA256.test(record["sha256"]))
    {
        invalid("missing or invalid file metadata for " + role);
    }
}

function check_artifact(bytes, record)
{
    if(!bytes) invalid("missing " + record["name"]);
    if(bytes.length !== record["bytes"]) invalid("wrong size for " + record["name"]);
    if(sha256_hex(bytes) !== record["sha256"]) invalid("SHA-256 mismatch for " + record["name"]);
}

function read_syborg_rofs(bytes)
{
    if(bytes.length <= ROFS_HEADER_SIZE || c_string(bytes, 0, 8) !== "SYBROFS" || bytes[7] ||
        u32(bytes, 8) !== bytes.length - ROFS_HEADER_SIZE || u32(bytes, 12) !== 2 ||
        u32(bytes, 16) !== SYBORG_ROFS_LAYERS.length)
    {
        invalid("invalid SYBROFS v2 header");
    }
    let next = ROFS_HEADER_SIZE;
    const layers = SYBORG_ROFS_LAYERS.map(({ role, sha256 }, index) => {
        const record = 20 + index * 12;
        const offset = ROFS_HEADER_SIZE + u32(bytes, record + 4);
        const size = u32(bytes, record + 8);
        const end = offset + size;
        const drive = u32(bytes, record);
        if(drive !== SYBORG_PROFILE.drives.Z[index] || offset !== next || !size || end > bytes.length)
        {
            invalid("invalid partition extent or order for " + role);
        }
        next = Math.ceil(end / ROFS_HEADER_SIZE) * ROFS_HEADER_SIZE;
        const part = read_sos_rofs(bytes.subarray(offset, end), role, 0).bytes;
        if(part.length !== size || sha256_hex(part) !== sha256 ||
            bytes.subarray(end, next).some(byte => byte !== 0xFF))
        {
            invalid("invalid size, padding or firmware SHA-256 for " + role);
        }
        return { role, drive, offset, size };
    });
    if(next !== bytes.length) invalid("unexpected data after the ROFS partitions");
    return layers;
}

/** Verify the boot set plus the immutable source seed and composition file when provided for folder import. */
export function validate_syborg_artifacts(manifest_bytes, { rom, rofs, devicetree, c_seed, composition })
{
    const manifest = parse_syborg_manifest(manifest_bytes);
    const files = manifest["files"];
    check_artifact(rom, files["rom"]);
    check_artifact(rofs, files["rofs"]);
    check_artifact(devicetree, files["devicetree"]);
    if(c_seed !== undefined) check_artifact(c_seed, files["c_seed"]);
    if(composition !== undefined) check_artifact(composition, manifest["build"]["composition"]);
    if(files["devicetree"]["sha256"] !== SYBORG_PROFILE.devicetree_sha256 ||
        u32be(devicetree, 0) !== 0xD00DFEED || u32be(devicetree, 4) !== devicetree.length)
    {
        invalid("unexpected Nokia 5800 Syborg device tree");
    }
    const xip = inspect_syborg_xip(rom);
    const layers = read_syborg_rofs(rofs);
    return { manifest, profile: SYBORG_PROFILE, xip, layers };
}

/** Serialize the sidecar for locally built files. The command validates it before writing. */
export function make_syborg_manifest({ rom, rofs, devicetree, c_seed, composition }, seed, has_uda)
{
    const firmware = Object.fromEntries(Object.entries(SYBORG_FIRMWARE_FILES).filter(([role]) => role !== "uda" || has_uda));
    const manifest = {
        "format": SYBORG_FORMAT,
        "format_version": SYBORG_FORMAT_VERSION,
        "profile": SYBORG_PROFILE.id,
        "firmware_version": SYBORG_PROFILE.firmware_version,
        "cpu": SYBORG_PROFILE.cpu,
        "personality": SYBORG_PROFILE.personality,
        "ram_size": SYBORG_PROFILE.ram_size,
        "build": {
            "qembian_revision": SYBORG_PROFILE.qembian_revision,
            "sources_lock_sha256": SYBORG_PROFILE.qembian_sources_lock_sha256,
            "firmware": firmware,
            "composition": describe(SYBORG_COMPOSITION_NAME, composition),
        },
        "drives": SYBORG_PROFILE.drives,
        "rofs_layers": SYBORG_ROFS_LAYERS.map(({ role, source, sha256 }, index) => ({
            "role": role, "source": source, "sha256": sha256, "drive": SYBORG_PROFILE.drives.Z[index],
        })),
        "c_seed": seed,
        "files": {
            "rom": describe(SYBORG_READ_ONLY_FILES.rom, rom),
            "rofs": describe(SYBORG_READ_ONLY_FILES.rofs, rofs),
            "devicetree": describe(SYBORG_READ_ONLY_FILES.devicetree, devicetree),
            "c_seed": describe(SYBORG_C_SEEDS[seed].name, c_seed),
        },
    };
    return new TextEncoder().encode(JSON.stringify(manifest, null, 2) + "\n");
}
