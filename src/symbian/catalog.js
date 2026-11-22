import { N97_FLASH_NAME } from "./n97_flash.js";
import { SYBORG_MACHINE, SYBORG_PROFILE } from "./syborg_profile.js";

// Each listed device has a firmware importer and a machine implementation.
export const N97_DEVICE = { id: "nokia-n97", family: "S60v5", name: "Nokia N97", model: "RM-505" };
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
export const symbian_device = machine => machine === SYBORG_MACHINE ? SYBORG_DEVICE : N97_DEVICE;
export const SYBORG_MEDIA = { manifest: "Manifest", rom: "System ROM", rofs: "Read-only file system", devicetree: "Device tree", phone: "Phone memory (C:)" };
export const N97_MEDIA = {
    rom: "rom.xip.bin",
    rofs1: "rofs1.img",
    rofs2: "rofs2.img",
    rofs3: "rofs3.img",
    phone: "uda.fat",
    boot_media: "rapido-boot.bin",
    nand: N97_FLASH_NAME,
};
export const N97_REQUIRED_MEDIA = ["rom", "rofs1", "rofs2", "rofs3", "phone"];

// TLanguage from Nokia's S60 SDK. Display unlisted IDs as recorded.
export function firmware_languages(languages)
{
    const names = { 1: "English", 2: "French", 3: "German", 4: "Spanish", 5: "Italian", 37: "Arabic", 50: "Farsi" };
    return (languages || []).map(language =>
        (names[language.id] || "Language " + language.id) + (language.default ? " (default)" : "")).join(", ");
}
