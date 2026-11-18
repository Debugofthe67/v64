// An empty FAT32 user volume for the virtual N97's E: drive. The imported
// retail package has no factory eMMC image. Only metadata sectors are written.
import { N97_EMMC_CHUNK, N97_EMMC_INDEX_BYTES, N97_EMMC_SIZE, N97_MMC_SECTOR } from "./n97_mmc_media.js";

const SECTOR = N97_MMC_SECTOR;
const START = 2048;
const TOTAL = N97_EMMC_SIZE / SECTOR - START;
const RESERVED = 32, COPIES = 2, SECTORS_PER_CLUSTER = 64;
const FAT = Math.ceil((TOTAL - RESERVED + 2 * SECTORS_PER_CLUSTER) / (128 * SECTORS_PER_CLUSTER + COPIES));
const CLUSTERS = Math.floor((TOTAL - RESERVED - COPIES * FAT) / SECTORS_PER_CLUSTER);
const LAYOUT = [0, START, START + 1, START + 6, START + 7, START + RESERVED, START + RESERVED + FAT];
export const N97_EMMC_INITIAL_BYTES = N97_EMMC_INDEX_BYTES +
    new Set(LAYOUT.map(sector => Math.floor(sector * SECTOR / N97_EMMC_CHUNK))).size * N97_EMMC_CHUNK;

export function format_n97_emmc(disk, serial)
{
    const encode = value => new TextEncoder().encode(value);
    function sector(signature)
    {
        const bytes = new Uint8Array(SECTOR);
        const view = new DataView(bytes.buffer);
        if(signature) view.setUint16(510, 0xAA55, true);
        return { bytes, view };
    }
    const mbr = sector(true);
    mbr.bytes.set([0, 0x20, 0x21, 0, 0x0C, 0xFE, 0xFF, 0xFF], 446);
    mbr.view.setUint32(454, START, true);
    mbr.view.setUint32(458, TOTAL, true);

    const boot = sector(true);
    boot.bytes.set([0xEB, 0x58, 0x90]);
    boot.bytes.set(encode("V86N97  "), 3);
    const bpb = boot.view;
    bpb.setUint16(11, SECTOR, true);
    bpb.setUint8(13, SECTORS_PER_CLUSTER);
    bpb.setUint16(14, RESERVED, true);
    bpb.setUint8(16, COPIES);
    bpb.setUint8(21, 0xF8);
    bpb.setUint16(24, 63, true);
    bpb.setUint16(26, 255, true);
    bpb.setUint32(28, START, true);
    bpb.setUint32(32, TOTAL, true);
    bpb.setUint32(36, FAT, true);
    bpb.setUint32(44, 2, true);
    bpb.setUint16(48, 1, true);
    bpb.setUint16(50, 6, true);
    bpb.setUint8(64, 0x80);
    bpb.setUint8(66, 0x29);
    bpb.setUint32(67, serial, true);
    boot.bytes.set(encode("NO NAME    FAT32   "), 71);
    boot.bytes.set([0xEB, 0xFE], 90);

    const info = sector(true);
    info.view.setUint32(0, 0x41615252, true);
    info.view.setUint32(484, 0x61417272, true);
    info.view.setUint32(488, CLUSTERS - 1, true);
    info.view.setUint32(492, 3, true);

    const fat = sector(false);
    fat.view.setUint32(0, 0x0FFFFFF8, true);
    fat.view.setUint32(4, 0x0FFFFFFF, true);
    fat.view.setUint32(8, 0x0FFFFFFF, true); // root directory cluster 2

    const metadata = [mbr, boot, info, boot, info, fat, fat];
    metadata.forEach(({ bytes }, i) => disk.write(LAYOUT[i] * SECTOR, bytes));
}
