import { check_vpl } from "./vpl.js";

// RM505_0576555_22.0.110_001.vpl declares the system's first ROFS layer
// inside CORE. The two standalone ROFS images supply layers 2 and 3.
const REQUIRED_IMAGES = [
    { label: "CORE", role: "core", rofs_index: 1 },
    { label: "ROFS2", role: "rofs", rofs_index: 2 },
    { label: "ROFS3", role: "rofs", rofs_index: 3 },
    { label: "UDA", role: "uda", rofs_index: null },
];

/**
 * @param {Parameters<typeof check_vpl>[0]} variant
 * @param {Parameters<typeof check_vpl>[1]} sources
 */
export async function check_n97_firmware(variant, sources)
{
    if(variant.type_designator !== "RM-505") throw new Error(`Nokia N97 requires RM-505, found ${variant.type_designator}`);

    const issues = [];
    for(const { label, role, rofs_index } of REQUIRED_IMAGES)
    {
        const matches = variant.files.filter(file => file.role === role && (role !== "rofs" || file.rofs_index === rofs_index));
        if(!matches.length) issues.push(`The VPL does not declare a ${label} image.`);
        else if(matches.length > 1) issues.push(`The VPL declares multiple ${label} images.`);
        else
        {
            const file = matches[0];
            if(file.optional) issues.push(`The VPL marks the required ${label} image ${file.name} as optional.`);
            if(role === "core" && file.rofs_index !== rofs_index)
            {
                issues.push(`CORE image ${file.name} must declare ROFS index 1.`);
            }
        }
    }
    for(const file of variant.files)
    {
        if(file.role === "rofs" && file.rofs_index !== 2 && file.rofs_index !== 3)
        {
            issues.push(`ROFS image ${file.name} must declare ROFS index 2 or 3.`);
        }
    }

    const result = await check_vpl(variant, sources);
    for(const file of result.files)
    {
        if(!file.optional && "actual_size" in file && file.actual_size === 0) issues.push(`Required file ${file.name} is empty.`);
    }
    return { ...result, ok: result.ok && issues.length === 0, issues };
}
