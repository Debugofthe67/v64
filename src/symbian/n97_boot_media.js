import { c_string, u32 } from "../android/bytes.js";
import { sha256_hex } from "../image/sha256.js";

export const N97_CORE_ADDRESS = 0x088FF000;
export const N97_CORE_HEADER_OFFSET = 0x1000;
export const N97_ROM_ADDRESS = N97_CORE_ADDRESS + N97_CORE_HEADER_OFFSET;
export const N97_MDI_BASE = 0x08140000;
export const N97_MDI_SIZE = 0x80000;
export const N97_BOOTROM_BASE = 0xFFFF0000;
export const N97_RAPIDO_ROM_ID = "4B9B75103E691FF8";
const BOOTROM_SERVICE_OFFSET = 0x1208;

const BOOT_MEDIA_MAGIC = "N97BOOT1";
const HEADER_SIZE = 56;
const CORE_PREFIX_SIZE = N97_CORE_HEADER_OFFSET;

function invalid(message)
{
    throw new Error("Nokia N97 boot media: " + message);
}

export function usable_n97_modem_address(address)
{
    return address % 4096 === 0 && address >= N97_MDI_BASE + N97_MDI_SIZE && address < N97_CORE_ADDRESS;
}

function check_ranges(dsp, isa)
{
    if(!usable_n97_modem_address(dsp.address) || !usable_n97_modem_address(isa.address) ||
        !dsp.bytes.length || !isa.bytes.length || dsp.address + dsp.bytes.length > isa.address ||
        isa.address + isa.bytes.length > N97_CORE_ADDRESS)
    {
        invalid("the DSP0 and ISASW ranges overlap or leave the modem SDRAM area");
    }
}

/** @param {!Uint8Array} prefix @param {!Uint8Array} rom @param {{address: number, bytes: !Uint8Array}} dsp
 * @param {{address: number, bytes: !Uint8Array}} isa */
export function write_n97_boot_media(prefix, rom, dsp, isa)
{
    check_ranges(dsp, isa);
    if(prefix.length !== CORE_PREFIX_SIZE) invalid("invalid CORE preamble length");
    const bytes = new Uint8Array(HEADER_SIZE + prefix.length + dsp.bytes.length + isa.bytes.length);
    const view = new DataView(bytes.buffer);
    bytes.set(new TextEncoder().encode(BOOT_MEDIA_MAGIC));
    const digest = sha256_hex(rom);
    for(let i = 0; i < 32; i++) bytes[8 + i] = parseInt(digest.slice(i * 2, i * 2 + 2), 16);
    view.setUint32(40, dsp.address, true);
    view.setUint32(44, dsp.bytes.length, true);
    view.setUint32(48, isa.address, true);
    view.setUint32(52, isa.bytes.length, true);
    bytes.set(prefix, HEADER_SIZE);
    bytes.set(dsp.bytes, HEADER_SIZE + prefix.length);
    bytes.set(isa.bytes, HEADER_SIZE + prefix.length + dsp.bytes.length);
    return bytes;
}

/** @param {!Uint8Array} bytes @param {string} rom_digest */
export function read_n97_boot_media(bytes, rom_digest)
{
    if(bytes.length < HEADER_SIZE + CORE_PREFIX_SIZE || c_string(bytes, 0, 8) !== BOOT_MEDIA_MAGIC)
    {
        invalid("unsupported or truncated image");
    }
    const bound_digest = Array.from(bytes.subarray(8, 40), byte => byte.toString(16).padStart(2, "0")).join("");
    if(bound_digest !== rom_digest) invalid("the media belongs to a different XIP");
    const dsp_size = u32(bytes, 44), isa_size = u32(bytes, 52);
    if(HEADER_SIZE + CORE_PREFIX_SIZE + dsp_size + isa_size !== bytes.length) invalid("malformed image lengths");
    const dsp_at = HEADER_SIZE + CORE_PREFIX_SIZE;
    const isa_at = dsp_at + dsp_size;
    const dsp = { address: u32(bytes, 40), bytes: bytes.subarray(dsp_at, isa_at) };
    const isa = { address: u32(bytes, 48), bytes: bytes.subarray(isa_at) };
    check_ranges(dsp, isa);
    return { digest: sha256_hex(bytes), prefix: bytes.subarray(HEADER_SIZE, dsp_at), dsp, isa };
}

/** @param {!Uint8Array} bytes @param {string=} reported_id @param {string=} expected_sha256 */
export function check_n97_bootrom(bytes, reported_id, expected_sha256)
{
    const id = reported_id?.toUpperCase().replace(/[:\s-]/g, "") || "";
    if(id && id !== N97_RAPIDO_ROM_ID) throw new Error("The service report's ROM ID does not match RM-505 RAPIDO");
    if(bytes.length < 0x2000 || bytes.length > 0x10000 || bytes.length % 4096)
    {
        throw new Error("The RAPIDO boot ROM must be a raw, page-aligned image of 8–64 KiB from 0xFFFF0000");
    }
    const service = bytes.subarray(BOOTROM_SERVICE_OFFSET, BOOTROM_SERVICE_OFFSET + 8);
    if(service.every(byte => byte === 0) || service.every(byte => byte === 0xFF))
    {
        throw new Error("The RAPIDO boot ROM has no code at the 0xFFFF1208 service entry");
    }
    const sha256 = sha256_hex(bytes);
    if(expected_sha256 && sha256 !== expected_sha256.toLowerCase().trim())
    {
        throw new Error("The local RAPIDO boot ROM SHA-256 does not match");
    }
    return { id, sha256 };
}
