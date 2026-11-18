// The removable SD and embedded MMC cards share the RAPIDO host. Their
// protocol state remains separate when CARD_SEL changes.
import { N97_EMMC_SIZE, N97_MMC_SECTOR, n97_sd_capacity } from "./n97_mmc_media.js";
import { sha256_hex } from "../image/sha256.js";

const IDLE = 0, READY = 1, IDENT = 2, STBY = 3, TRAN = 4, DATA = 5, RCV = 6;
const ILLEGAL_COMMAND = 1 << 22, ADDRESS_ERROR = 1 << 30, OUT_OF_RANGE = 0x80000000;
const BLOCK_LENGTH_ERROR = 1 << 29, SWITCH_ERROR = 1 << 7, APP_CMD = 1 << 5;
const MMC_OCR = 0x00FF8080, SD_OCR = 0x00FF8000;
const OCR_READY = 0x80000000, OCR_SECTORS = 0x40000000;

// Write a bit field using the physical-layer notation [msb:lsb] (bit 127
// is the first bit of the first byte of a CID or CSD response).
function field(target, high, low, value)
{
    for(let bit = low; bit <= high; bit++)
    {
        if((value >>> (bit - low)) & 1) target[15 - (bit >>> 3)] |= 1 << (bit & 7);
    }
}

function register_crc(bytes)
{
    let crc = 0;
    for(const byte of bytes.subarray(0, 15))
    {
        crc ^= byte;
        for(let bit = 0; bit < 8; bit++) crc = ((crc << 1) ^ (crc & 0x80 ? 0x12 : 0)) & 0xFF;
    }
    bytes[15] = crc | 1;
    return bytes;
}

function cid_for(embedded, buffer)
{
    const cid = new Uint8Array(16);
    const digest = sha256_hex(new TextEncoder().encode(JSON.stringify(buffer.identity || buffer.byteLength)));
    const serial = parseInt(digest.slice(0, 8), 16);
    if(embedded)
    {
        // Emulator CID with the JEDEC eMMC fields (embedded-device flag and
        // six-byte product name). This does not impersonate a soldered card.
        cid.set([0xF0, 1, 0x56, 0x56, 0x38, 0x36, 0x4D, 0x4D, 0x43, 0x10]);
        field(cid, 47, 16, serial);
        field(cid, 15, 8, 0x41);
    }
    else
    {
        cid.set([0xF0, 0x56, 0x38, 0x56, 0x38, 0x36, 0x53, 0x44, 0x10]);
        field(cid, 55, 24, serial);
        field(cid, 19, 8, 0x091);
    }
    return register_crc(cid);
}

function csd_for(embedded, geometry)
{
    const csd = new Uint8Array(16);
    const bits = (high, low, value) => field(csd, high, low, value);
    bits(127, 126, embedded ? 3 : geometry.high_capacity ? 1 : 0);
    if(embedded) bits(125, 122, 4); // MMC 4.x
    bits(119, 112, 0x0E); // TAAC
    bits(103, 96, 0x32);
    bits(95, 84, 0x5B5); // Common basic, block read/write and application commands
    bits(83, 80, geometry.length);
    bits(28, 26, 2);
    bits(25, 22, geometry.length);
    if(!embedded && geometry.high_capacity)
    {
        bits(69, 48, geometry.csize);
    }
    else
    {
        bits(73, 62, geometry.csize);
        bits(49, 47, geometry.multiple);
    }
    if(!embedded) bits(46, 39, 0xFF); // single-block erase, 128-sector group
    return register_crc(csd);
}

/** @param {?} buffer synchronous disk backend @param {boolean} embedded */
export function create_n97_mmc_card(buffer, embedded)
{
    const geometry = embedded ? {
        high_capacity: true, csize: 0xFFF, multiple: 7, length: 9,
    } : n97_sd_capacity(buffer.byteLength);
    if(!geometry || embedded && buffer.byteLength !== N97_EMMC_SIZE ||
        typeof buffer.get_from_cache !== "function" || typeof buffer.set !== "function")
    {
        throw new Error("Invalid Nokia N97 " + (embedded ? "eMMC" : "microSD") + " image");
    }
    const cid = cid_for(embedded, buffer);
    const csd = csd_for(embedded, geometry);
    const sectors = buffer.byteLength / N97_MMC_SECTOR;
    let state, rca, app_cmd, bus_width, high_speed, block_count;
    const reset = () => {
        state = IDLE;
        rca = 0;
        app_cmd = false;
        bus_width = high_speed = block_count = 0;
    };
    const status = () => state << 9 | (state === STBY || state === TRAN ? 0x100 : 0);
    const r1 = (bits = 0) => ({ response: (status() | bits) >>> 0, error: !!(bits & ~APP_CMD) });
    const addressed = argument => (argument >>> 16) === rca && rca !== 0;
    const ocr = (argument, voltage) => {
        if(state !== IDLE && state !== READY) return null;
        if(argument & voltage) state = READY;
        return { response: (voltage | (geometry.high_capacity ? OCR_SECTORS : 0) | (state === READY ? OCR_READY : 0)) >>> 0 };
    };
    function extended_csd()
    {
        const bytes = new Uint8Array(512);
        bytes[183] = bus_width;
        bytes[185] = high_speed;
        bytes[192] = 3; // eMMC 4.3 extended register format
        bytes[194] = 2; // EXT_CSD structure
        bytes[196] = 1; // 26 MHz high-speed
        new DataView(bytes.buffer).setUint32(212, sectors, true);
        return bytes;
    }
    function send(command, argument, blocks)
    {
        const application = app_cmd;
        app_cmd = false;
        if(command === 0) { reset(); return {}; }
        if(!embedded && application)
        {
            if(command === 41) return ocr(argument, SD_OCR);
            if(state !== TRAN) return r1(ILLEGAL_COMMAND);
            if(command === 51) return { ...r1(), data: new Uint8Array([2, 5, 0, 0, 0, 0, 0, 0]) }; // SD 2.0, 1/4-bit
            if(command === 13) return { ...r1(), data: new Uint8Array(64) }; // SD_STATUS (no speed-class claim)
            if(command === 6 && (argument === 0 || argument === 2))
            {
                bus_width = argument;
                return r1();
            }
            if(command === 23) return r1(); // optional pre-erase hint
            return r1(ILLEGAL_COMMAND);
        }
        switch(command)
        {
            case 1: return embedded ? ocr(argument, MMC_OCR) : null;
            case 2:
                if(state !== READY) return null;
                state = IDENT;
                return { response: cid };
            case 3:
                if(state !== IDENT && (embedded || state !== STBY)) return null;
                rca = embedded ? argument >>> 16 : 1;
                if(!rca) return null;
                state = STBY;
                return embedded ? r1() : { response: rca << 16 | status() };
            case 6: {
                if(state !== TRAN || !embedded) return r1(ILLEGAL_COMMAND);
                if(argument >>> 24 !== 3 || (argument & 7) !== 0) return r1(SWITCH_ERROR);
                const index = argument >>> 16 & 0xFF, value = argument >>> 8 & 0xFF;
                if(index === 183 && value <= 1) bus_width = value;
                else if(index === 185 && value <= 1) high_speed = value;
                else return r1(SWITCH_ERROR);
                return r1();
            }
            case 7:
                if(argument === 0 && state === TRAN) { state = STBY; return {}; }
                if(!addressed(argument) || state < STBY) return null;
                state = TRAN;
                return r1();
            case 8:
                if(embedded) return state === TRAN ? { ...r1(), data: extended_csd() } : null;
                return state === IDLE && (argument & 0xF00) === 0x100 ? { response: argument & 0xFFF } : null;
            case 9: case 10: return addressed(argument) ? { response: command === 9 ? csd : cid } : null;
            case 12: return state === TRAN ? r1() : null;
            case 13: return addressed(argument) ? r1() : null;
            case 16: return state !== TRAN ? r1(ILLEGAL_COMMAND) : r1(argument === N97_MMC_SECTOR ? 0 : BLOCK_LENGTH_ERROR);
            case 23:
                if(!embedded || state !== TRAN || argument > 0xFFFF) return r1(ILLEGAL_COMMAND);
                block_count = argument;
                return r1();
            case 17: case 18: case 24: case 25: {
                if(state !== TRAN) return r1(ILLEGAL_COMMAND);
                const start = geometry.high_capacity ? argument : argument / N97_MMC_SECTOR;
                if(!Number.isInteger(start)) return r1(ADDRESS_ERROR);
                const count = command === 17 || command === 24 ? 1 : block_count || blocks;
                block_count = 0;
                if(start + count > sectors) return r1(OUT_OF_RANGE);
                return { ...r1(), transfer: { sector: start, count, write: command === 24 || command === 25 } };
            }
            case 55:
                if(embedded || (rca && !addressed(argument))) return null;
                app_cmd = true;
                return r1(APP_CMD);
            default: return state < STBY ? null : r1(ILLEGAL_COMMAND);
        }
    }
    reset();
    return {
        buffer, reset, send,
        start_data(write) { state = write ? RCV : DATA; },
        end_data() { if(state === DATA || state === RCV) state = TRAN; },
        get_state() { return [state, rca, app_cmd, bus_width, high_speed, block_count]; },
        set_state(snapshot) { [state, rca, app_cmd, bus_width, high_speed, block_count] = snapshot; },
    };
}
