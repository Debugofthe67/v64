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
const LAST_BLOCK = N97_FLASH_SIZE / N97_FLASH_BLOCK - 1;
export const N97_BML_RESERVOIR = LAST_BLOCK + 1 - 44;
// BML_Format validates against 0x7D2 usable blocks. Two additional
// management blocks precede the 44 blocks scanned for PCB metadata.
export const N97_BML_USER_BLOCKS = N97_BML_RESERVOIR - 2;
const BML_SECTOR = 512, BML_SPARE = 16;

// Samsung's published 512-byte ECC format. Each pair contains inverted
// parity for the zero and one groups of an address bit, in that order.
const ECC_MAIN_ORDER = [3, 4, 5, 6, 7, 8, 9, 10, 11, 0, 1, 2];
const ECC_SPARE_ORDER = [3, 4, 0, 1, 2];
const ECC_BYTE_PARITY = new Uint8Array(256);
for(let byte = 1; byte < ECC_BYTE_PARITY.length; byte++)
{
    ECC_BYTE_PARITY[byte] = ECC_BYTE_PARITY[byte >> 1] ^ (byte & 1);
}

/** @param {!Uint8Array} bytes @param {number} offset @param {number} length @param {!Array<number>} order */
function sector_ecc(bytes, offset, length, order)
{
    let columns = 0, rows = 0;
    for(let index = 0; index < length; index++)
    {
        const byte = bytes[offset + index];
        columns ^= byte;
        rows ^= index & -ECC_BYTE_PARITY[byte];
    }
    const position = rows << 3 | ECC_BYTE_PARITY[columns & 0xAA] |
        ECC_BYTE_PARITY[columns & 0xCC] << 1 | ECC_BYTE_PARITY[columns & 0xF0] << 2;
    const total = ECC_BYTE_PARITY[columns];
    let ecc = 0;
    for(let index = 0; index < order.length; index++)
    {
        const one_group = position >> order[index] & 1;
        const zero_group = total ^ one_group;
        const pair = (1 ^ zero_group) | (1 ^ one_group) << 1;
        ecc |= pair << (2 * index);
    }
    return ecc;
}

/** @param {!Uint8Array} main @param {number} offset */
export function n97_main_ecc(main, offset)
{
    return sector_ecc(main, offset, 512, ECC_MAIN_ORDER);
}

/** @param {!Uint8Array} spare @param {number} offset Start of the 16-byte spare sector. */
export function n97_spare_ecc(spare, offset)
{
    return 0xFC00 | sector_ecc(spare, offset + 2, 3, ECC_SPARE_ORDER);
}

/**
 * Construct the two initial XSR pool control blocks for this single-die
 * OneNAND with no bad blocks. The original RM-505 BML_Format produces this
 * four-page layout, including the Nokia PIA signature and OOB marks.
 * @param {!Array<{id: number, attributes: number, start_block: number, blocks: number}>} partitions
 */
function* initial_bml_blocks(partitions)
{
    const encoder = new TextEncoder();
    for(const [block, alternate, locked] of [[N97_BML_RESERVOIR, N97_BML_RESERVOIR + 1, false], [LAST_BLOCK, LAST_BLOCK - 1, true]])
    {
        const raw = new Uint8Array(2 * N97_FLASH_SLOT).fill(0xFF);
        const view = new DataView(raw.buffer);
        // Pool control header and its mirror. An unused remap entry stays erased.
        raw.set(encoder.encode(locked ? "LOCKPCHD" : "ULOCKPCH"));
        view.setUint16(8, 1, true); // pool control age
        view.setUint16(10, alternate, true);
        raw.fill(0, 12, 20); // initial erase signature
        raw.copyWithin(BML_SECTOR, 0, BML_SECTOR);
        const area = 2 * BML_SECTOR;
        if(locked)
        {
            raw.fill(0, area, area + BML_SECTOR);
            raw.set(encoder.encode("XSRPART5"), area);
            view.setUint32(area + 8, 0x00011000, true);
            view.setUint32(area + 12, partitions.length, true);
            for(const [index, part] of partitions.entries())
            {
                const offset = area + 16 + index * 16;
                view.setUint32(offset, part.id, true);
                view.setUint32(offset + 4, part.attributes, true);
                view.setUint32(offset + 8, part.start_block, true);
                view.setUint32(offset + 12, part.blocks, true);
            }
        }
        else view.setUint32(area + 4, BML_SECTOR - 8, true); // empty partition extension
        raw.copyWithin(area + BML_SECTOR, area, area + BML_SECTOR);

        for(let sector = 0; sector < 4; sector++)
        {
            // New block map (inf=0xFCFE, age=1). Its mappings stay erased.
            view.setUint16(N97_FLASH_SLOT + sector * BML_SECTOR, 0xFCFE, true);
            view.setUint16(N97_FLASH_SLOT + sector * BML_SECTOR + 2, 1, true);
            raw[N97_FLASH_PAGE + sector * BML_SPARE + 5] = 0xFE;
            if(sector !== 0) raw[N97_FLASH_SLOT + N97_FLASH_PAGE + sector * BML_SPARE + 5] = 0xFE;
        }
        yield { at: N97_FLASH_HEADER + block * BLOCK_SLOT, bytes: raw.map(byte => byte ^ 0xFF) };
    }
}

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

/**
 * @param {!Array<{address: number, bytes: !Uint8Array}>} extents
 * @param {string} rom_digest
 * @param {?Array<{id: number, attributes: number, start_block: number, blocks: number}>} partitions
 */
export function seed_n97_flash(extents, rom_digest, partitions = null)
{
    extents.sort((a, b) => a.address - b.address);
    let end = 0;
    for(const { address, bytes } of extents)
    {
        if(address < end || address + bytes.length > N97_FLASH_SIZE) throw new Error("Overlapping or out-of-range RM-505 OneNAND records");
        end = address + bytes.length;
    }
    const header = n97_flash_header(rom_digest);
    // Only provision a blank reserved area in a new image. A supplied
    // reservoir always wins, including when it contains only partial records.
    const has_reservoir = end > N97_BML_USER_BLOCKS * N97_FLASH_BLOCK;
    const seeded_bml = partitions !== null && !has_reservoir;
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
        if(partitions && !has_reservoir) yield* initial_bml_blocks(partitions);
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
    return { name: N97_FLASH_NAME, size: N97_FLASH_IMAGE_SIZE, sha256: hash.hex(), source_bytes, chunks,
        bml: { state: seeded_bml ? "initialized" : has_reservoir ? "supplied" : "unformatted", partitions } };
}
