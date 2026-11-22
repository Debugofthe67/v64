import { sha256_hex } from "../image/sha256.js";
import { INSTALL_BOOTSTRAP, INSTALL_EXE } from "./syborg_install_binary.js";

const ENTRY = "v86_install.exe";
const ESTART_HASH = "c6f852048198facd63788bdae3f2cd723fc4e5aedf8c2f356745cdc96e30c289";
const CLOSE_IMPORT = 0x78EE28;
const align = (size, boundary) => Math.ceil(size / boundary) * boundary;
const decode = value => Uint8Array.from(atob(value), byte => byte.charCodeAt(0));

// Add the small open-source helper to the ROM filesystem for this boot. The
// original package and installation server are never written by the host.
export function syborg_install_rom(rom, xip, limit)
{
    const base = xip.header.rom_base, { files, folders } = xip.directory;
    const image = xip.images.get(files.get("sys/bin/estart.exe")?.address);
    const efile = files.get("sys/bin/efile.exe");
    const bin = folders.get("sys/bin/");
    if(!image || !efile || !bin?.entry || files.has("sys/bin/" + ENTRY) ||
        sha256_hex(rom.subarray(image.code - base, image.code - base + image.code_size)) !== ESTART_HASH)
        return null;

    const exe = decode(INSTALL_EXE), bootstrap = decode(INSTALL_BOOTSTRAP);
    const exe_at = align(rom.length, 4), bootstrap_at = align(exe_at + exe.length, 4);
    const bin_at = align(bootstrap_at + bootstrap.length, 4), old_bin = bin.address - base;
    const entry_size = align(10 + 2 * ENTRY.length, 4);
    const old_table = old_bin + 4 + bin.size, new_table = bin_at + 4 + bin.size + entry_size;
    const count = bin.subdirs + bin.files;
    const length = align(new_table + 4 + 2 * (count + 1), 4096);
    if(length > limit || bin.size / 4 > 0xFFFF) return null;

    const result = new Uint8Array(length);
    result.set(rom);
    result.set(exe, exe_at);
    result.set(bootstrap, bootstrap_at);
    result.set(rom.subarray(old_bin, old_table), bin_at);
    const view = new DataView(result.buffer), old = new DataView(rom.buffer, rom.byteOffset, rom.byteLength);
    const entry = bin_at + 4 + bin.size;
    view.setUint32(entry, exe.length, true);
    view.setUint32(entry + 4, base + exe_at, true);
    result[entry + 8] = 1;
    result[entry + 9] = ENTRY.length;
    for(let i = 0; i < ENTRY.length; i++) view.setUint16(entry + 10 + 2 * i, ENTRY.charCodeAt(i), true);

    // Keep every original directory-entry offset. Insert the new filename
    // into the sorted index that the ROM filesystem uses for lookups.
    let index = bin.subdirs;
    const names = new TextDecoder("utf-16le");
    for(; index < count; index++)
    {
        const at = old_bin + 4 + old.getUint16(old_table + 4 + index * 2, true) * 4;
        const name = names.decode(rom.subarray(at + 10, at + 10 + rom[at + 9] * 2));
        if(name.replace(/[A-Z]/g, letter => letter.toLowerCase()) > ENTRY) break;
    }
    result.set(rom.subarray(old_table, old_table + 4 + index * 2), new_table);
    view.setUint16(new_table + 4 + index * 2, bin.size / 4, true);
    result.set(rom.subarray(old_table + 4 + index * 2, old_table + 4 + count * 2), new_table + 6 + index * 2);
    view.setUint16(new_table + 2, bin.files + 1, true);
    view.setUint32(bin_at, bin.size + entry_size, true);
    view.setUint32(bin.entry - base + 4, base + bin_at, true);
    view.setUint32(0xA4, efile.directory_entry - bin.address + base + bin_at, true);
    for(const offset of [0x90, 0xF0, 0xF4]) view.setUint32(offset, length, true);
    view.setUint32(CLOSE_IMPORT, base + bootstrap_at, true);
    return result;
}
