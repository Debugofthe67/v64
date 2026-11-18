// Nominal decimal capacity of the Nokia N97's embedded user area. Removable
// cards are images of their own capacity. SD CSD has a capacity granularity.
import { open_sparse_blocks } from "../image/sparse_blocks.js";

export const N97_EMMC_SIZE = 32000000000;
export const N97_MMC_SECTOR = 512;
export const N97_EMMC_CHUNK = 64 * 1024;
const geometry = {
    magic: new TextEncoder().encode("V86N97M1"), chunk: N97_EMMC_CHUNK,
    length: N97_EMMC_SIZE, label: "Nokia N97 eMMC",
};
export const N97_EMMC_INDEX_BYTES = 512 + Math.ceil(Math.ceil(N97_EMMC_SIZE / N97_EMMC_CHUNK) * 4 / 512) * 512;

export function open_n97_emmc(access, create = false)
{
    const disk = open_sparse_blocks(access, geometry, create);
    if(!disk) throw new Error("The Nokia N97 eMMC image is not in V86's sparse format");
    return disk;
}

// Return a CSD device-size field and multiplier, or null if this raw image's
// length cannot be expressed by an SDSC or SDHC card of this generation.
export function n97_sd_capacity(size)
{
    if(!Number.isSafeInteger(size) || size < 1024 * 1024 || size > 16 * 1024 ** 3) return null;
    if(size > 2 * 1024 ** 3)
    {
        if(size % (512 * 1024)) return null;
        return { high_capacity: true, csize: size / (512 * 1024) - 1, multiple: 0, length: 9 };
    }
    // Standard capacity cards above 1 GiB use a 1 KiB CSD block length
    // while the ordinary file-system transfer length can be set to 512.
    const length = size > 1024 ** 3 ? 10 : 9;
    for(let mult = 0; mult <= 7; mult++)
    {
        const count = size / 2 ** (length + mult + 2);
        if(Number.isInteger(count) && count > 0 && count <= 4096)
            return { high_capacity: false, csize: count - 1, multiple: mult, length };
    }
    return null;
}
