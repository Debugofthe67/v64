import { SYBORG_MACHINE, SYBORG_PROFILE } from "./syborg_profile.js";

// Each listed device has a firmware importer and a machine implementation.
export const SYBORG_DEVICE = {
    id: SYBORG_MACHINE, family: "S60v5", name: "Nokia 5800", model: SYBORG_PROFILE.model,
    // RM-356 keypad_exp.dll, switch.dll and exyin.dll, using Symbian scan codes.
    controls: {
        front: [
            { id: "call", label: "Call", scan: 0xC4 },
            { id: "menu", label: "Menu", scan: 0xB4 },
            { id: "end", label: "End", scan: 0xC5 },
        ],
        side: [
            { id: "volup", label: "Vol +", scan: 0xA2 },
            { id: "voldown", label: "Vol −", scan: 0xA3 },
            { id: "lock", label: "Lock", scan: 0xB3, min_press_ms: 220 },
            { id: "camera-half", label: "Focus", scan: 0xE2 },
            { id: "camera-full", label: "Capture", scan: 0xAB },
        ],
        top: [
            { id: "power", label: "Power", scan: 0xA6 },
            { id: "media", label: "Media", scan: 0xF0 },
        ],
    },
};
export const SYMBIAN_DEVICES = [SYBORG_DEVICE];
export const SYBORG_MEDIA = { manifest: "Manifest", rom: "System ROM", rofs: "Read-only file system", devicetree: "Device tree", phone: "Phone memory (C:)" };
