// v86 compatibility ROM for the observed RM-505 22.0.110 ISASW call.
// This is a synthetic MMIO protocol. See docs/symbian-n97.md for the
// physical evidence behind the certificate layout and call arguments.
import { c_string } from "../android/bytes.js";
import { sha256_hex } from "../image/sha256.js";
import { SHA1 } from "../ios/crypto.js";
import { N97_ROM_ADDRESS } from "./n97_boot_media.js";
import { N97_FLASH_PAGE } from "./n97_flash.js";

export const N97_COMPAT_XIP = "9c0863e379d243f953d3cfcd87d11c98231f2d0469e69244d9ee059472c99194";
export const N97_COMPAT_PORT = 0xFFFF2000;
const KEYS_ADDRESS = 0x82A00;
const ROOT_FINGERPRINT = "caeebb65d3c48e6dc73b49dc5063a2ee5867d611";
const CERTIFICATE_SIZE = 0x400;
const DESCRIPTOR_ADDRESS = N97_ROM_ADDRESS + 0x2A08;
const DESCRIPTOR = [0x96BD0FAB, 0x71C22AAF, 0xAF6462D2, 0x00140000];
const ISASW = {
    name: "SOS-ISASW", address: 0x08480000, size: 3893852, type: 0x55434D43, entry: 0x1000,
    trailer_sha256: "f8f6a48a6ab62c3f7ecaa8a7915dc40bfcb85106a58f3bbd2fc6975e6ca00c54",
};
const DSP0 = {
    name: "DSP0", address: 0x08200000, size: 1820720, type: 0x50534443, entry: 0,
    trailer_sha256: "f90d033ac879ef00d49cfe7e4f0f8ae5d7bcfcadddc722e02df52ecdfa5056f0",
};

export function n97_compat_bootrom(rom_digest, media, nand)
{
    if(rom_digest !== N97_COMPAT_XIP) throw new Error("The RAPIDO compatibility ROM supports the RM-505 22.0.110 XIP");
    if(!nand || media?.isa.address !== ISASW.address || media?.isa.bytes.length !== ISASW.size ||
        media?.dsp.address !== DSP0.address || media?.dsp.bytes.length !== DSP0.size)
    {
        throw new Error("The RAPIDO compatibility ROM requires the 22.0.110 retail boot media and OneNAND");
    }
    const rom = new Uint8Array(0x2000);
    const view = new DataView(rom.buffer);
    [
        0xB410, // push {r4}
        0x4C05, // ldr r4, [pc, #20] (literal at 0x1220)
        0x6020, // str r0, [r4]
        0x6061, // str r1, [r4, #4]
        0x60A2, // str r2, [r4, #8]
        0x60E3, // str r3, [r4, #12]
        0x6920, // ldr r0, [r4, #16]
        0xBC10, // pop {r4}
        0x4770, // bx lr
    ].forEach((instruction, i) => view.setUint16(0x1208 + 2 * i, instruction, true));
    view.setUint32(0x1220, N97_COMPAT_PORT, true);
    return rom;
}

function big_endian_integer(bytes)
{
    let value = 0n;
    for(const byte of bytes) value = (value << 8n) | BigInt(byte);
    return value;
}

/** Verify the complete EMSA-PKCS1-v1_5 encoding described in RFC 8017 §9.2. */
export function verify_n97_rsa_signature(modulus_le, signature, message)
{
    if(signature.length !== 128 || modulus_le.length !== 128 || !(modulus_le[127] & 0x80) || !(modulus_le[0] & 1)) return false;
    const n = big_endian_integer(Uint8Array.from(modulus_le).reverse());
    const s = big_endian_integer(signature);
    if(s === 0n || s >= n) return false;
    const encoded = new Uint8Array(128).fill(0xFF);
    encoded.set([0, 1], 0);
    encoded.set([0, 0x30, 0x21, 0x30, 9, 6, 5, 0x2B, 0x0E, 3, 2, 0x1A, 5, 0, 4, 0x14], 92);
    encoded.set(new SHA1().update(message).digest(), 108);
    // Both selected BB5 keys declare public exponent 3.
    return s * s % n * s % n === big_endian_integer(encoded);
}

function modem_key(keys)
{
    if(!keys || keys.length !== 0x600) return null;
    const view = new DataView(keys.buffer, keys.byteOffset, keys.length);
    if(view.getUint32(4, true) !== 3 || new SHA1().update(keys.subarray(4, 0x8C)).hex() !== ROOT_FINGERPRINT ||
        !verify_n97_rsa_signature(keys.subarray(0xC, 0x8C), keys.subarray(0x444, 0x4C4), keys.subarray(0, 0x444)) ||
        view.getUint32(0x214, true) !== 3) return null;
    return keys.subarray(0x21C, 0x29C);
}

function verify_component(image, key, component)
{
    if(!image || image.length !== component.size) return false;
    const view = new DataView(image.buffer, image.byteOffset, CERTIFICATE_SIZE);
    if(view.getUint32(0, true) !== 0x809795A3 ||
        view.getUint32(0x18, true) !== 0x168 || view.getUint32(0x1C, true) !== CERTIFICATE_SIZE ||
        view.getUint32(0x20, true) !== component.size - 1 || view.getUint32(0x148, true) !== component.entry ||
        view.getUint32(0x158, true) !== component.type || view.getUint32(0x3D8, true) !== component.size ||
        view.getUint32(0x3DC, true) !== component.address ||
        !verify_n97_rsa_signature(key, image.subarray(0x350, 0x3D0), image.subarray(0, 0x168)) ||
        sha256_hex(image.subarray(0x168, CERTIFICATE_SIZE)) !== component.trailer_sha256) return false;
    const digest = new SHA1().update(image.subarray(CERTIFICATE_SIZE)).digest();
    digest[0] ^= 0x80;
    return digest.every((byte, i) => byte === image[0x24 + i]);
}

const OUTCOMES = ["idle", "request", "keys", "isasw", "dsp0", "verified"];

export function create_n97_rapido_compat(cpu, nand, toc_address)
{
    let args = [], outcome = "idle";
    function ram(address, length)
    {
        const offset = cpu.ram_offset(address, length);
        return offset < 0 ? null : cpu.mem8.subarray(offset, offset + length);
    }
    function verify_call()
    {
        if(args[0] !== DESCRIPTOR_ADDRESS || args[1] !== 0 || args[2] !== ISASW.address || args[3] !== 0) return "request";
        const bytes = ram(args[0], 16);
        if(!bytes) return "request";
        const descriptor = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
        if(!DESCRIPTOR.every((value, i) => descriptor.getUint32(4 * i, true) === value)) return "request";
        // The original loader reads address and size from these two TOC entries.
        const entries = ram(toc_address, 64);
        if(!entries) return "request";
        const toc = new DataView(entries.buffer, entries.byteOffset, entries.length);
        if(![DSP0, ISASW].every((component, i) => toc_address + toc.getInt32(32 * i, true) === component.address &&
            toc.getUint32(32 * i + 4, true) === component.size && c_string(entries, 32 * i + 20, 12) === component.name)) return "request";
        let keys;
        try
        {
            const page = nand.read_main_page(Math.floor(KEYS_ADDRESS / N97_FLASH_PAGE));
            keys = page.subarray(KEYS_ADDRESS % N97_FLASH_PAGE);
        }
        catch(error)
        {
            return "keys";
        }
        const key = modem_key(keys);
        if(!key) return "keys";
        if(!verify_component(ram(args[2], ISASW.size), key, ISASW)) return "isasw";
        if(!verify_component(ram(DSP0.address, DSP0.size), key, DSP0)) return "dsp0";
        return "verified";
    }
    cpu.io.register_mmio(N97_COMPAT_PORT, 20, {
        name: "v86 RAPIDO ROM verification",
        read(offset, width) { return offset === 16 && width === 4 && outcome === "verified" ? 1 : 0; },
        write(offset, width, value)
        {
            if(offset === 0) args = [];
            if(width !== 4 || offset !== args.length * 4)
            {
                args = [];
                outcome = "request";
                return;
            }
            args.push(value >>> 0);
            if(args.length === 4)
            {
                outcome = verify_call();
                args = [];
            }
            else outcome = "idle";
        },
    });
    return {
        status: () => outcome,
        reset() { args = []; outcome = "idle"; },
        get_state: () => [args.slice(), outcome],
        check_state(state)
        {
            if(!Array.isArray(state?.[0]) || state[0].length > 3 ||
                !state[0].every(value => Number.isInteger(value) && value >= 0 && value <= 0xFFFFFFFF) ||
                !OUTCOMES.includes(state[1]) || state[0].length && state[1] !== "idle")
            {
                throw new Error("Invalid RAPIDO compatibility ROM snapshot");
            }
        },
        set_state(state) { args = state[0].slice(); outcome = state[1]; },
    };
}
