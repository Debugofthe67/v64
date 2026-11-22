import { sha256_hex } from "../image/sha256.js";
import { make_syborg_manifest, validate_syborg_artifacts } from "./syborg_import.js";
import { SYBORG_C_SEEDS, SYBORG_PROFILE } from "./syborg_profile.js";
import { audit_syborg_xip } from "./syborg_xip.js";

export const SYBORG_COMPONENTS_FILE = "syborg-5800-components.bin";
export const SYBORG_COMPONENTS_LIMIT = 8 * 1024 * 1024;
const REFERENCE_ROM = "977483ad88275c596570a74c4cc4b8ba1a0b387eee58460b401f8968d00bf90c";
const CORE_START = SYBORG_PROFILE.firmware_user_base - SYBORG_PROFILE.rom_base;
const HEADER = 16;
const COMPONENTS_FORMAT = 1;
const PAGE_SIZE = 4096;

/** Keep the Syborg code and layout information outside the original CORE window. */
export function pack_syborg_components({ rom, devicetree, composition }, core)
{
    if(sha256_hex(rom) !== REFERENCE_ROM) throw new Error("Use the reference Nokia 5800 ROM to prepare assembly components");
    const bytes = new Uint8Array(HEADER + CORE_START + rom.length - core.bytes.length + devicetree.length + composition.length);
    const header = new DataView(bytes.buffer);
    header.setUint32(0, COMPONENTS_FORMAT, true);
    header.setUint32(4, rom.length, true);
    header.setUint32(8, devicetree.length, true);
    header.setUint32(12, composition.length, true);
    let offset = HEADER;
    for(const data of [rom.subarray(0, CORE_START), rom.subarray(core.bytes.length), devicetree, composition])
    {
        bytes.set(data, offset);
        offset += data.length;
    }
    return bytes;
}

function compose_rofs(layers)
{
    const rounded = size => Math.ceil(size / PAGE_SIZE) * PAGE_SIZE;
    const payload = layers.reduce((size, layer) => size + rounded(layer.length), 0);
    const rofs = new Uint8Array(PAGE_SIZE + payload);
    rofs.set(new TextEncoder().encode("SYBROFS"));
    rofs.fill(0xFF, PAGE_SIZE);
    const header = new DataView(rofs.buffer);
    header.setUint32(8, payload, true);
    header.setUint32(12, 2, true);
    header.setUint32(16, layers.length, true);
    let offset = 0;
    for(const [index, layer] of layers.entries())
    {
        const record = 20 + index * 12;
        header.setUint32(record, SYBORG_PROFILE.drives.Z[index], true);
        header.setUint32(record + 4, offset, true);
        header.setUint32(record + 8, layer.length, true);
        rofs.set(layer, PAGE_SIZE + offset);
        offset += rounded(layer.length);
    }
    return rofs;
}

/** Reuse the reference XIP layout and restore its user-side bytes from the verified local CORE. */
export async function compose_syborg_artifacts(components, firmware)
{
    const core = firmware.core;
    if(components.length < HEADER || components.length > SYBORG_COMPONENTS_LIMIT)
        throw new Error("Invalid size for the Nokia 5800 assembly components");
    const header = new DataView(components.buffer, components.byteOffset, HEADER);
    const rom_size = header.getUint32(4, true);
    const dtb_size = header.getUint32(8, true);
    const composition_size = header.getUint32(12, true);
    const dtb_at = HEADER + CORE_START + rom_size - core.bytes.length;
    if(header.getUint32(0, true) !== COMPONENTS_FORMAT || rom_size < core.bytes.length ||
        !dtb_size || !composition_size || dtb_at + dtb_size + composition_size !== components.length)
        throw new Error("Invalid layout for the Nokia 5800 assembly components");

    const rom = new Uint8Array(rom_size);
    rom.set(components.subarray(HEADER, HEADER + CORE_START));
    rom.set(core.bytes.subarray(CORE_START), CORE_START);
    rom.set(components.subarray(HEADER + CORE_START, dtb_at), core.bytes.length);
    if(sha256_hex(rom) !== REFERENCE_ROM) throw new Error("The assembled Nokia 5800 ROM differs from the reference");
    const devicetree = components.subarray(dtb_at, dtb_at + dtb_size);
    const composition = components.subarray(dtb_at + dtb_size);
    const rofs = compose_rofs(firmware.rofs);
    const c_seed = new Uint8Array(SYBORG_C_SEEDS.blank.bytes);
    const artifacts = { rom, rofs, devicetree, composition, c_seed };
    const manifest = make_syborg_manifest(artifacts, "blank", !!firmware.uda);
    const { xip } = await validate_syborg_artifacts(manifest, artifacts);
    audit_syborg_xip(rom, xip, core, composition);
    return { ...artifacts, manifest };
}
