// RAPIDO's shared MMC/SD host. EPBUSMV accesses the registers at C60328xx;
// the register and FIFO layout matches TI SPRU765A, section 2.
import { VirtDeviceSpace } from "../virt/io.js";
import { check_disk_state } from "../disk_writeback.js";
import { create_n97_mmc_card } from "./n97_mmc_card.js";
import { N97_MMC_SECTOR } from "./n97_mmc_media.js";

export const N97_MMC_BASE = 0x20032800;
export const N97_MMC_IRQ = 159;
export const N97_MMC_DMA_PORT = N97_MMC_BASE + 0x20;
const CMD = 0, ARGL = 4, ARGH = 8, CON = 0xC, STAT = 0x10, IE = 0x14;
const CTO = 0x18, DTO = 0x1C, DATA = 0x20, BLEN = 0x24, NBLK = 0x28, BUF = 0x2C, SDIO = 0x34, RSP = 0x40;
const EOC = 1, BRS = 8, EOFB = 16, DATA_TIMEOUT = 32, CMD_TIMEOUT = 128, AF = 0x400, AE = 0x800, CERR = 0x4000;
const POWER = 0x800, BIG_ENDIAN = 0x400;
const READ_DMA = 0x8000, WRITE_DMA = 0x80;
const FIFO_WORDS = 32;
const REGISTERS = new Set([CMD, ARGL, ARGH, CON, STAT, IE, CTO, DTO, DATA, BLEN, NBLK, BUF, SDIO]);

/** @param {!VirtDeviceSpace} io @param {?} emmc @param {?} sd @param {function(boolean)} set_irq
 * @param {function(boolean)=} set_sd_detect */
export function create_n97_mmc(io, emmc, sd, set_irq, set_sd_detect = () => {})
{
    const cards = [emmc ? create_n97_mmc_card(emmc, true) : null, sd ? create_n97_mmc_card(sd, false) : null];
    const regs = new Uint16Array(24);
    const transfer_sequences = [0, 0];
    let clock, selected, transfer, fifo_last, commands, reads, writes;
    const update_irq = () => set_irq(!!(clock && (regs[STAT / 4] & regs[IE / 4])));
    const powered = () => clock && (regs[CON / 4] & POWER);
    function update_fifo()
    {
        regs[STAT / 4] &= ~(AF | AE);
        if(transfer?.write && !(regs[BUF / 4] & WRITE_DMA)) regs[STAT / 4] |= AE;
        if(transfer && !transfer.write && !(regs[BUF / 4] & READ_DMA))
        {
            const available = Math.min(FIFO_WORDS, ((transfer.bytes?.length ?? N97_MMC_SECTOR) - transfer.at + 1) >> 1);
            if(available > (regs[BUF / 4] >> 8 & 31)) regs[STAT / 4] |= AF;
        }
        update_irq();
    }
    function abort()
    {
        if(transfer) cards[transfer.card]?.end_data();
        transfer = null;
        regs[STAT / 4] &= ~(AF | AE);
    }
    function reset()
    {
        regs.fill(0);
        clock = false;
        selected = 0;
        fifo_last = 0;
        commands = reads = writes = 0;
        transfer_sequences.fill(0);
        abort();
        for(const card of cards) card?.reset();
        set_sd_detect(!cards[1]);
        update_irq();
    }

    function insert_sd(buffer)
    {
        if(cards[1]) throw new Error("A Nokia N97 microSD is already inserted");
        cards[1] = create_n97_mmc_card(buffer, false);
        set_sd_detect(false); // GENIO45, active low
    }

    function start_transfer(info, fixed, word, count)
    {
        const size = (regs[BLEN / 4] & 0x7FF) + 1;
        const direction = !!(word & 0x8000);
        if((word & 0x3000) !== 0x3000 || (fixed ? !direction || size !== fixed.length || count !== 1 :
            direction === info.write || count !== info.count || size !== N97_MMC_SECTOR))
        {
            regs[STAT / 4] |= DATA_TIMEOUT;
            return;
        }
        const write = !!info?.write;
        transfer = { card: selected, sector: info?.sector ?? 0, count, write, fixed: !!fixed,
            bytes: fixed ?? null, at: 0, sequence: ++transfer_sequences[+write] };
        cards[selected].start_data(transfer.write);
        if(!transfer.fixed && transfer.write) transfer.bytes = new Uint8Array(N97_MMC_SECTOR);
    }
    function issue(word)
    {
        if(!powered()) return;
        regs[CMD / 4] = word;
        regs.fill(0, RSP / 4);
        const index = word & 63;
        if(word & 0x80)
        {
            // INAB supplies the initial clock train or stops a data phase.
            abort();
            regs[STAT / 4] |= EOC;
            update_irq();
            return;
        }
        if(transfer && index !== 12 && index !== 13)
        {
            regs[STAT / 4] |= CERR;
            update_irq();
            return;
        }
        if(index === 12) abort();
        const argument = (regs[ARGH / 4] * 65536 + regs[ARGL / 4]) >>> 0;
        const count = (regs[NBLK / 4] & 0x7FF) + 1;
        const result = cards[selected]?.send(index, argument, count);
        commands++;
        if(!result)
        {
            regs[STAT / 4] |= word & 0x700 ? CMD_TIMEOUT : EOC;
            update_irq();
            return;
        }
        if(result.response instanceof Uint8Array)
        {
            for(let i = 0; i < 8; i++) regs[RSP / 4 + 7 - i] = result.response[i * 2] * 256 + result.response[i * 2 + 1];
        }
        else if(result.response !== undefined)
        {
            regs[RSP / 4 + 7] = result.response >>> 16;
            regs[RSP / 4 + 6] = result.response & 0xFFFF;
        }
        regs[STAT / 4] |= result.error ? CERR : EOC;
        if(!result.error && (result.transfer || result.data)) start_transfer(result.transfer, result.data, word, count);
        if(!result.error && word & 0x800 && !transfer) regs[STAT / 4] |= EOFB;
        update_fifo();
    }

    function sector_from_card()
    {
        const bytes = cards[transfer.card].buffer.get_from_cache(transfer.sector * N97_MMC_SECTOR, N97_MMC_SECTOR);
        if(bytes?.length !== N97_MMC_SECTOR) throw new Error("Short MMC sector read");
        reads++;
        return bytes;
    }
    function sector_to_card()
    {
        let finished = false, failure;
        cards[transfer.card].buffer.set(transfer.sector * N97_MMC_SECTOR, transfer.bytes,
            error => { finished = true; failure = error; });
        if(!finished || failure) throw failure || new Error("MMC writes need synchronous storage");
        writes++;
    }
    function next_block()
    {
        transfer.count--;
        if(transfer.count)
        {
            transfer.sector++;
            transfer.at = 0;
            if(!transfer.write) transfer.bytes = null;
        }
        else
        {
            const wrote = transfer.write;
            abort();
            regs[STAT / 4] |= BRS | (wrote ? EOFB : 0);
        }
        update_fifo();
    }
    function data_timeout()
    {
        abort();
        regs[STAT / 4] |= DATA_TIMEOUT;
        update_irq();
    }

    function read_data(dma = false)
    {
        if(!powered() || !transfer || transfer.write) return dma ? null : fifo_last;
        try
        {
            if(!transfer.bytes) transfer.bytes = sector_from_card();
            const lo = transfer.bytes[transfer.at++];
            const hi = transfer.at < transfer.bytes.length ? transfer.bytes[transfer.at++] : 0;
            fifo_last = (regs[CON / 4] & BIG_ENDIAN) ? lo * 256 + hi : hi * 256 + lo;
            if(transfer.at === transfer.bytes.length) next_block();
            else if(transfer.bytes.length - transfer.at < FIFO_WORDS * 2) update_fifo();
        }
        catch(error)
        {
            data_timeout();
            if(dma) return null;
        }
        return fifo_last;
    }
    function write_data(value)
    {
        if(!powered() || !transfer?.write) return false;
        const be = !!(regs[CON / 4] & BIG_ENDIAN);
        transfer.bytes[transfer.at++] = be ? value >> 8 : value & 0xFF;
        transfer.bytes[transfer.at++] = be ? value & 0xFF : value >> 8;
        if(transfer.at !== transfer.bytes.length) return true;
        try { sector_to_card(); next_block(); }
        catch(error) { data_timeout(); return false; }
        return true;
    }
    function dma_request(write)
    {
        if(!transfer || transfer.write !== write) return null;
        const bytes = (transfer.bytes?.length ?? N97_MMC_SECTOR) - transfer.at;
        const enabled = powered() && (regs[BUF / 4] & (write ? WRITE_DMA : READ_DMA));
        return { sequence: transfer.sequence, beats: enabled ? Math.min(FIFO_WORDS, (bytes + 1) >> 1) : 0 };
    }
    function select_card(slot)
    {
        if(slot !== selected && transfer) data_timeout();
        selected = slot;
    }
    function set_clock(enabled)
    {
        if(clock && !enabled)
        {
            abort();
            regs[STAT / 4] = 0;
        }
        clock = enabled;
        update_irq();
    }
    io.register_mmio(N97_MMC_BASE, 0x60, {
        name: "RAPIDO MMC/SD",
        read(offset, width)
        {
            if(width !== 2 || offset % 4) return 0;
            if(offset === DATA) return read_data();
            return regs[offset / 4];
        },
        write(offset, width, value)
        {
            if(width !== 2 || !REGISTERS.has(offset)) return;
            const word = Number(value) & 0xFFFF;
            if(offset === CMD) issue(word);
            else if(offset === DATA) write_data(word);
            else if(offset === STAT) { regs[STAT / 4] &= ~word; update_irq(); }
            else
            {
                regs[offset / 4] = word;
                if(offset === CON && !(word & POWER))
                {
                    abort();
                    regs[STAT / 4] = 0;
                }
                if(offset === BUF) update_fifo();
                update_irq();
            }
        },
    });
    reset();
    return {
        emmc, get sd() { return cards[1]?.buffer ?? null; }, reset, insert_sd, select_card, set_clock, dma_request,
        dma_generation(write) { return transfer_sequences[+write]; },
        dma_read() { return read_data(true); },
        dma_write(value) { return write_data(value); },
        status: () => ({ "emmc_bytes": emmc?.byteLength ?? null, "sd_bytes": cards[1]?.buffer.byteLength ?? null,
            "slot": selected, "commands": commands, "reads": reads, "writes": writes }),
        get_state: () => [cards.map(card => card ? [card.buffer.get_state(), card.get_state()] : null),
            regs.slice(), clock, selected, transfer ? [transfer.card, transfer.sector, transfer.count,
                transfer.write, transfer.fixed, transfer.bytes?.slice() ?? null, transfer.at, transfer.sequence] : null,
            fifo_last, commands, reads, writes, transfer_sequences.slice()],
        check_state(saved)
        {
            for(const [i, card] of cards.entries())
            {
                const snapshot = saved[0][i];
                const name = i ? "symbian_sd" : "symbian_emmc";
                if(!!snapshot !== !!card) throw new Error("Snapshot and machine must use the same Nokia N97 MMC configuration (" + name + ")");
                if(card) check_disk_state(name, card.buffer, snapshot[0]);
            }
        },
        set_state(saved)
        {
            cards.forEach((card, i) => {
                if(card)
                {
                    card.buffer.set_state(saved[0][i][0]);
                    card.set_state(saved[0][i][1]);
                }
            });
            regs.set(saved[1]);
            [, , clock, selected, , fifo_last, commands, reads, writes] = saved;
            [transfer_sequences[0], transfer_sequences[1]] = saved[9] || [0, 0];
            transfer = null;
            if(saved[4])
            {
                const [card, sector, count, write, fixed, bytes, at, sequence = ++transfer_sequences[+write]] = saved[4];
                transfer = { card, sector, count, write, fixed, bytes: bytes?.slice() ?? null, at, sequence };
            }
            update_irq();
        },
    };
}
