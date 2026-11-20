import { sha256_hex } from "../image/sha256.js";
import { inspect_fat16_uda, read_sos_rofs, SOS_PREFIX_SIZE } from "./firmware_partitions.js";
import { fpsx_group_data, parse_fpsx, validate_fpsx_layout } from "./fpsx.js";
import { rebuild_eka2_rom } from "./rom.js";
import { SYBORG_FIRMWARE_FILES, SYBORG_PROFILE, SYBORG_ROFS_LAYERS } from "./syborg_profile.js";

function extract(container, label)
{
    const groups = container.groups.filter(group => group.label === label && group.data.length);
    if(groups.length !== 1 || groups[0].space.join(",") !== "0,3,0")
    {
        throw new Error(`RM-356 FPSX: expected one ${label || "UDA"} NAND group`);
    }
    return fpsx_group_data(container, groups[0]);
}

/** Verify the named firmware files, then identify and extract the expected partitions. */
export function verify_syborg_firmware(inputs)
{
    const containers = {};
    for(const [role, file] of Object.entries(SYBORG_FIRMWARE_FILES))
    {
        const input = inputs[role];
        if(role === "uda" && input === undefined) continue;
        if(!input) throw new Error(`Missing RM-356 ${role}: ${file.name}`);
        if(input.name !== file.name) throw new Error(`Wrong RM-356 ${role} version: expected ${file.name}, got ${input.name}`);
        if(input.bytes.length !== file.bytes || sha256_hex(input.bytes) !== file.sha256)
        {
            throw new Error(`RM-356 ${role} size or SHA-256 mismatch: ${file.name}`);
        }
        containers[role] = parse_fpsx(input.bytes);
    }
    validate_fpsx_layout(Object.values(containers));
    const core = rebuild_eka2_rom(extract(containers.core, "SOS+CORE").subarray(SOS_PREFIX_SIZE));
    if(core.header.rom_base !== SYBORG_PROFILE.rom_base || sha256_hex(core.bytes) !== SYBORG_PROFILE.firmware_core_sha256)
    {
        throw new Error("RM-356 flat CORE address or SHA-256 mismatch");
    }
    const rofs = SYBORG_ROFS_LAYERS.map(({ role, source, sha256 }) => {
        const label = "SOS+" + role.toUpperCase();
        const data = read_sos_rofs(extract(containers[source], label), `RM-356 ${label}`).bytes;
        if(sha256_hex(data) !== sha256) throw new Error(`RM-356 ${label} SHA-256 mismatch`);
        return data;
    });
    let uda;
    if(containers.uda)
    {
        const bytes = extract(containers.uda, null);
        uda = { bytes, ...inspect_fat16_uda(bytes, "RM-356 UDA") };
    }
    return { core, rofs, uda };
}
