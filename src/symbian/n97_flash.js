// The RM-505's CS0 OneNAND image. Each 2 KiB page is followed by its 64
// spare bytes. Stored cells are complemented so file holes read as erased.
// The first sector binds the writable image to the XIP it was imported with.
import { SHA256 } from "../image/sha256.js";

export const N97_FLASH_SIZE = 0x10000000;
export const N97_FLASH_BLOCK = 0x20000;
export const N97_FLASH_PAGE = 0x800;
export const N97_FLASH_SPARE = 0x40;
export const N97_FLASH_SLOT = N97_FLASH_PAGE + N97_FLASH_SPARE;
export const N97_FLASH_HEADER = 512;
export const N97_FLASH_IMAGE_SIZE = N97_FLASH_HEADER + N97_FLASH_SIZE / N97_FLASH_PAGE * N97_FLASH_SLOT;
export const N97_FLASH_ID = [0xEC, 0x40, 0x121];
export const N97_FLASH_NAME = "onenand.img";
const FORMAT = new TextEncoder().encode("V86N97N1");
const BLOCK_SLOT = N97_FLASH_BLOCK / N97_FLASH_PAGE * N97_FLASH_SLOT;

export function n97_flash_header(rom_digest)
{
    if(!/^[a-f0-9]{64}$/.test(rom_digest)) throw new Error("Invalid Nokia N97 XIP digest");
    const header = new Uint8Array(N97_FLASH_HEADER);
    header.set(FORMAT);
    for(let i = 0; i < 32; i++) header[8 + i] = parseInt(rom_digest.slice(i * 2, i * 2 + 2), 16);
    return header;
}

/** @param {?} buffer @param {string} rom_digest */
export function check_n97_flash(buffer, rom_digest)
{
    if(buffer.byteLength !== N97_FLASH_IMAGE_SIZE || typeof buffer.get_from_cache !== "function" || typeof buffer.set !== "function")
    {
        throw new Error("Nokia N97 needs a synchronous RM-505 OneNAND image");
    }
    const saved = buffer.get_from_cache(0, N97_FLASH_HEADER);
    if(saved?.length !== N97_FLASH_HEADER || !n97_flash_header(rom_digest).every((value, i) => saved[i] === value))
    {
        throw new Error("Nokia N97 OneNAND image has the wrong format or was imported with different firmware");
    }
}

/** @param {!Array<{address: number, bytes: !Uint8Array}>} extents @param {string} rom_digest */
export function seed_n97_flash(extents, rom_digest)
{
    extents.sort((a, b) => a.address - b.address);
    let end = 0;
    for(const { address, bytes } of extents)
    {
        if(address < end || address + bytes.length > N97_FLASH_SIZE) throw new Error("Overlapping or out-of-range RM-505 OneNAND records");
        end = address + bytes.length;
    }
    const header = n97_flash_header(rom_digest);
    // Iterate one erase block at a time. Neither preflight nor writing into
    // OPFS has to hold a second 264 MiB image in memory.
    function* chunks()
    {
        yield { at: 0, bytes: header };
        let block = new Uint8Array(BLOCK_SLOT);
        let index = -1;
        for(const { address, bytes } of extents)
        {
            for(let i = 0; i < bytes.length;)
            {
                const physical = address + i;
                const next = Math.floor(physical / N97_FLASH_BLOCK);
                if(next !== index)
                {
                    if(index >= 0) yield { at: N97_FLASH_HEADER + index * BLOCK_SLOT, bytes: block };
                    block = new Uint8Array(BLOCK_SLOT);
                    index = next;
                }
                const within = physical % N97_FLASH_PAGE;
                const offset = Math.floor(physical % N97_FLASH_BLOCK / N97_FLASH_PAGE) * N97_FLASH_SLOT + within;
                const count = Math.min(bytes.length - i, N97_FLASH_PAGE - within);
                for(let n = 0; n < count; n++) block[offset + n] = bytes[i + n] ^ 0xFF;
                i += count;
            }
        }
        if(index >= 0) yield { at: N97_FLASH_HEADER + index * BLOCK_SLOT, bytes: block };
    }
    const hash = new SHA256();
    const zeros = new Uint8Array(BLOCK_SLOT);
    let at = 0, source_bytes = 0;
    for(const chunk of chunks())
    {
        while(at < chunk.at)
        {
            const size = Math.min(zeros.length, chunk.at - at);
            hash.update(zeros.subarray(0, size));
            at += size;
        }
        hash.update(chunk.bytes);
        at += chunk.bytes.length;
        source_bytes += chunk.bytes.length;
    }
    while(at < N97_FLASH_IMAGE_SIZE)
    {
        const size = Math.min(zeros.length, N97_FLASH_IMAGE_SIZE - at);
        hash.update(zeros.subarray(0, size));
        at += size;
    }
    return { name: N97_FLASH_NAME, size: N97_FLASH_IMAGE_SIZE, sha256: hash.hex(), source_bytes, chunks };
}
