import { N97_FLASH_NAME } from "./n97_flash.js";

// Each listed device has a firmware importer and a machine implementation.
export const SYMBIAN_DEVICES = [
    { id: "nokia-n97", family: "S60v5", name: "Nokia N97", model: "RM-505" },
];

export const N97_DEVICE = SYMBIAN_DEVICES[0];
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
