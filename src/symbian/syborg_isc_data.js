import { sha256_hex } from "../image/sha256.js";

// Assembled from tools/symbian/syborg-isc-data.S with clang
// --target=armv5te-none-eabi and llvm-objcopy -O binary --only-section=.text.
// The patch is applied only to the in-memory network-enabled ROM.
const CODE = [
    0xE3510012, 0x0A000006, 0xE3510005, 0x0A000004, 0xE3510006, 0x0A00001A,
    0xE3510022, 0x0A000032, 0xE59FF148, 0xE92D4070, 0xE24DD010, 0xE1A04000,
    0xE1A05001, 0xE1A01002, 0xE1A0200D, 0xE3550005, 0x03A03002, 0x13A03001,
    0xE59FC124, 0xE12FFF3C, 0xE3500000, 0x1A000031, 0xE1A00004, 0xE3550005,
    0x059D1004, 0x159D1000, 0xE59FC108, 0xE12FFF3C, 0xE3550005, 0x1A000028,
    0xE1A0100D, 0xE3A02000, 0xEA00001F, 0xE92D4070, 0xE24DD010, 0xE1A04000,
    0xE1A01002, 0xE1A0200D, 0xE3A03003, 0xE59FC0D0, 0xE12FFF3C, 0xE3500000,
    0x1A00001C, 0xE59F60C8, 0xE7943006, 0xE3530000, 0x1A000008, 0xE89D0007,
    0xE7840006, 0xE0846006, 0xE5861004, 0xE5862008, 0xE1A00004, 0xE59FC0A4,
    0xE12FFF3C, 0xEA00000E, 0xE1A0100D, 0xE3E0200D, 0xEA000005, 0xE92D4070,
    0xE24DD010, 0xE1A04000, 0xE59F607C, 0xE0841006, 0xE3E02002, 0xE5913000,
    0xE3530000, 0x0A000002, 0xE5940030, 0xE59FC068, 0xE12FFF3C, 0xE3A00000,
    0xE28DD010, 0xE8BD8070, 0xE92D4070, 0xE24DD010, 0xE1A04000, 0xE1A05001,
    0xE1A01002, 0xE1A02003, 0xE28D0004, 0xE59FC03C, 0xE12FFF3C, 0xE1A00004,
    0xE1A01005, 0xE28D2004, 0xE3A03000, 0xE58D3000, 0xE59FC024, 0xE12FFF3C,
    0xE28DD010, 0xE8BD8070, 0x82741380, 0x827410B4, 0x82742404, 0x00001124,
    0x82742780, 0x8274337C, 0x827433B4, 0x82742C64,
];
const DRIVER = 0x2740908;
const DRIVER_SIZE = 0x44F0;
const DRIVER_HASH = "d5d7f18f0b97c178a5f212eef28fe745092cd6a96acf780628ffeda1358eb07c";
const FREE_ROM = 0x25FD000;
const CALLS = [
    [0x2741348, 0xEB00000C, FREE_ROM],         // Control
    [0x2742910, 0xEB000287, FREE_ROM + 0x128], // Write needed length to a descriptor
];

/** @param {Uint8Array} rom */
export function enable_syborg_isc_data(rom, xip)
{
    const entry = xip.directory.files.get("sys/bin/nokiaiscdriver.ldd");
    const driver = xip.images.get(entry?.address);
    const base = xip.header.rom_base;
    const end = FREE_ROM + CODE.length * 4;
    const overlaps = (start, limit) => start < base + end && limit > base + FREE_ROM;
    const files = [...xip.directory.files.values()];
    if(driver?.code !== base + DRIVER || driver.code_size !== DRIVER_SIZE ||
        sha256_hex(rom.subarray(DRIVER, DRIVER + DRIVER_SIZE)) !== DRIVER_HASH ||
        end > rom.length || rom.subarray(FREE_ROM, end).some(byte => byte !== 0) ||
        xip.directory.ranges.some(({ start, end }) => overlaps(start, end)) ||
        files.some(({ address, size, attr }) => overlaps(address, address + size + (attr & 0x80 ? 0x78 : 0))))
    {
        throw new Error("Nokia 5800 networking requires the reference Nokia ISC driver and ROM layout");
    }
    const view = new DataView(rom.buffer, rom.byteOffset, rom.byteLength);
    for(const [call, expected, target] of CALLS)
    {
        if(view.getUint32(call, true) !== expected) throw new Error("Unexpected Nokia ISC driver instruction");
        view.setUint32(call, 0xEB000000 | ((target - call - 8) >> 2 & 0xFFFFFF), true);
    }
    CODE.forEach((word, index) => view.setUint32(FREE_ROM + index * 4, word, true));
}
