// Packed N90 NAND for browser storage. Only written ranges grow the file.
import { NAND_BYTES, NAND_SLOT } from "../apple/nand_geometry.js";
import { open_sparse_blocks } from "../image/sparse_blocks.js";

const geometry = {
    magic: new TextEncoder().encode("V86N90S1"), chunk: NAND_SLOT * 16,
    length: NAND_BYTES, label: "iPhone NAND",
};

export function open_sparse_nand(access, create = false)
{
    return open_sparse_blocks(access, geometry, create);
}
