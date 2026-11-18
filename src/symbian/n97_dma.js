// Word-oriented RAPIDO GDMASS. The register paths are from TRapDmac in the
// RM-505 22.0.110 ROM (dma.dll) and the original EPBUSMV client.
import { N97_MMC_DMA_PORT } from "./n97_mmc.js";

export const N97_DMA_BASE = 0x20040780;
export const N97_DMA_PHYSICAL_OFFSET = 0x480;
export const N97_DMA_PHYSICAL_STRIDE = 0x400;
export const N97_DMA_IRQS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

const PHYSICAL_CHANNELS = 6;
const PHYSICAL_RESET = 2, PHYSICAL_IDLE_STATUS = 0x6E;
const TX = 1, RX = 2;
const MMC_TX_REQUEST = 16, MMC_RX_REQUEST = 15;

const P_STATUS = 0, P_GATE = 4, P_MODE = 8, P_FIFO_DATA = 0xC, P_FIFO_BITS = 0x10;
const P_SOURCE = 0x14, P_SOURCE_STEP = 0x18, P_SOURCE_BITS = 0x1C;
const P_DEST = 0x20, P_DEST_STEP = 0x24, P_DEST_BITS = 0x28;
const P_COUNT = 0x2C, P_FLAGS = 0x34;
const PHYSICAL_REGISTERS = [P_STATUS, P_GATE, P_MODE, P_FIFO_DATA, P_FIFO_BITS,
    P_SOURCE, P_SOURCE_STEP, P_SOURCE_BITS, P_DEST, P_DEST_STEP, P_DEST_BITS, P_COUNT, P_FLAGS];

// Interleaved logical channel registers, offsets in the GDMASS aperture.
const MODE = 0x1CC0, COUNT = 0x1D00;
const PAUSE = 0x1D80, WIDTH = 0x1DC0, FLAGS = 0x1E00;
const PERIPHERAL = 0x1E40, RAM = 0x1E80, INIT = 0x1EC0;
const LIMIT = 0x1F00, PROGRESS = 0x1F40, REQUEST_ENABLE = 0x1F80;
const LOGICAL_REGISTERS = [MODE, COUNT, PAUSE, WIDTH, FLAGS, PERIPHERAL, RAM, INIT, LIMIT, PROGRESS, REQUEST_ENABLE];

export function create_n97_dma(io, cpu, mmc, set_irq)
{
    const channels = N97_DMA_IRQS.map(irq => {
        const physical = irq < PHYSICAL_CHANNELS;
        const offsets = physical ? PHYSICAL_REGISTERS : LOGICAL_REGISTERS;
        return { irq, physical, offsets, regs: new Uint32Array(offsets.length), selector: 0, transfer: null };
    });
    const global = new Uint32Array(7);
    let request = 0, sync_command = 0, sync_address = 0, sync_width = 0;
    let resets = 0, completed = 0, transferred = 0, errors = 0;

    function word(offset, name, read, write)
    {
        io.register_mmio(N97_DMA_BASE + offset, 4, {
            name,
            read(lane, width) { return lane === 0 && width === 4 ? read() : 0; },
            write(lane, width, value) { if(lane === 0 && width === 4) write(value >>> 0); },
        });
    }
    const get = (channel, offset) => channel.regs[channel.offsets.indexOf(offset)];
    const set = (channel, offset, value) => { channel.regs[channel.offsets.indexOf(offset)] = value; };
    function stop(channel)
    {
        channel.transfer = null;
        set(channel, channel.physical ? P_MODE : MODE, 0);
        if(!channel.physical) request &= ~(1 << (channel.irq - PHYSICAL_CHANNELS));
        set_irq(channel.irq, false);
    }
    function valid_ram(address, beats)
    {
        return !(address & 1) && beats > 0 && cpu.dma_classify(address, beats * 2) !== -2;
    }
    function begin(channel, write, ram, beats)
    {
        // Bind to the active command in this direction or reserve the next one.
        // A cancellation before the first bus handshake preserves that boundary.
        const host = mmc();
        const sequence = host?.dma_request(write)?.sequence ?? (host?.dma_generation(write) ?? 0) + 1;
        channel.transfer = { write, ram, beats, sequence, started: false };
    }
    function start_physical(channel, mode)
    {
        stop(channel);
        if(!mode) return;
        if(!get(channel, P_GATE) || mode !== 2) { errors++; return; }
        const write = channel.selector === MMC_TX_REQUEST;
        const ram = get(channel, write ? P_SOURCE : P_DEST);
        const endpoint = get(channel, write ? P_DEST : P_SOURCE);
        const ram_step = get(channel, write ? P_SOURCE_STEP : P_DEST_STEP);
        const ram_width = get(channel, write ? P_SOURCE_BITS : P_DEST_BITS);
        const endpoint_step = get(channel, write ? P_DEST_STEP : P_SOURCE_STEP);
        const endpoint_width = get(channel, write ? P_DEST_BITS : P_SOURCE_BITS);
        const beats = get(channel, P_COUNT) + 1;
        if((!write && channel.selector !== MMC_RX_REQUEST) || endpoint !== N97_MMC_DMA_PORT || endpoint_step ||
            endpoint_width !== 16 || (ram_step !== 2 && ram_step !== 4) || ram_width !== 8 * ram_step ||
            ram % ram_step || get(channel, P_FLAGS) !== 1 || get(channel, P_FIFO_BITS) || !valid_ram(ram, beats))
        {
            errors++;
            return;
        }
        set(channel, P_MODE, mode);
        begin(channel, write, ram, beats);
    }
    function start_logical(channel, mode)
    {
        stop(channel);
        if(!mode) return;
        const beats = get(channel, COUNT), ram = get(channel, RAM);
        if((mode !== TX && mode !== RX) || get(channel, PERIPHERAL) !== N97_MMC_DMA_PORT ||
            channel.selector !== (mode === TX ? MMC_TX_REQUEST : MMC_RX_REQUEST) ||
            get(channel, WIDTH) !== 2 || get(channel, FLAGS) || !get(channel, INIT) || !get(channel, REQUEST_ENABLE) ||
            get(channel, LIMIT) !== beats * 8 || !valid_ram(ram, beats))
        {
            errors++;
            return;
        }
        set(channel, MODE, mode);
        set(channel, PROGRESS, 0);
        begin(channel, mode === TX, ram, beats);
    }

    // Global configuration written by the reset and physical-channel setup
    // routines. The timeout clock and the non-MMC endpoints are independent.
    for(const [index, offset] of [0, 4, 8, 0x84, 0x1C84, 0x1C88, 0x1C8C].entries())
    {
        word(offset, "RAPIDO DMA configuration", () => global[index], value => { global[index] = value; });
    }
    word(0x1C98, "RAPIDO DMA synchronization command", () => sync_command, value => {
        sync_command = value;
        if(value === 4 && [1, 2, 4].includes(sync_width) && sync_address % sync_width === 0 &&
            cpu.dma_classify(sync_address, sync_width) !== -2)
        {
            // Writes already reach V86's coherent RAM. The original logical
            // RX and cancel routines poll this synchronization command.
            sync_command = 0;
        }
    });
    word(0x1C9C, "RAPIDO DMA synchronization address", () => sync_address, value => { sync_address = value; });
    word(0x1CA0, "RAPIDO DMA synchronization width", () => sync_width, value => { sync_width = value; });
    for(const channel of channels)
    {
        const { irq, physical, offsets } = channel;
        word(0x88 + irq * 4, "RAPIDO DMA request selector", () => channel.selector, value => { channel.selector = value; });
        if(physical)
        {
            const base = N97_DMA_PHYSICAL_OFFSET + irq * N97_DMA_PHYSICAL_STRIDE;
            for(const reg of offsets)
            {
                word(base + reg, "RAPIDO physical DMA", () => get(channel, reg), value => {
                    if(reg === P_MODE) start_physical(channel, value);
                    else if(reg === P_STATUS)
                    {
                        if(get(channel, P_GATE) && value === PHYSICAL_RESET)
                        {
                            stop(channel);
                            channel.regs.fill(0);
                            set(channel, P_GATE, 1);
                            set(channel, P_STATUS, PHYSICAL_IDLE_STATUS);
                            resets++;
                        }
                    }
                    else if(reg === P_GATE)
                    {
                        set(channel, P_GATE, value & 1);
                        if(!(value & 1)) stop(channel);
                    }
                    else set(channel, reg, value);
                });
            }
        }
        else
        {
            const lane = (irq - PHYSICAL_CHANNELS) * 4;
            word(0x1CA8 + lane, "RAPIDO logical DMA active/request", () => +!!channel.transfer, value => {
                // The TX request bitmap aliases the channel 1 active read.
                if(lane === 4) request |= value & 0xF;
            });
            for(const reg of offsets)
            {
                word(reg + lane, "RAPIDO logical DMA", () => get(channel, reg), value => {
                    if(reg === MODE) start_logical(channel, value);
                    else if(reg === INIT)
                    {
                        if(value & 1)
                        {
                            stop(channel);
                            channel.regs.fill(0);
                            set(channel, INIT, 1);
                        }
                    }
                    else set(channel, reg, value);
                });
            }
        }
    }

    function burst(channel)
    {
        const { transfer, irq, physical } = channel, host = mmc();
        if(!transfer || !host) return false;
        const signal = host.dma_request(transfer.write);
        if(host.dma_generation(transfer.write) < transfer.sequence) return false;
        if(!signal || signal.sequence !== transfer.sequence)
        {
            stop(channel);
            errors++;
            return false;
        }
        if(!physical && (get(channel, PAUSE) || transfer.write && !(request & (1 << (irq - PHYSICAL_CHANNELS)))))
            return false;
        if(!signal.beats || channels.some(other => other !== channel && other.transfer?.started &&
            other.transfer.sequence === signal.sequence && other.transfer.write === transfer.write)) return false;
        transfer.started = true;
        const beats = Math.min(transfer.beats, signal.beats);
        const bytes = transfer.write ? cpu.read_blob_physical(transfer.ram, beats * 2) : new Uint8Array(beats * 2);
        let moved = 0;
        for(; moved < beats; moved++)
        {
            const i = moved * 2;
            if(transfer.write)
            {
                if(!host.dma_write(bytes[i] | bytes[i + 1] << 8)) break;
            }
            else
            {
                const value = host.dma_read();
                if(value === null) break;
                bytes[i] = value;
                bytes[i + 1] = value >> 8;
            }
        }
        if(!transfer.write && moved) cpu.write_blob_physical(bytes.subarray(0, moved * 2), transfer.ram);
        transfer.ram += moved * 2;
        transfer.beats -= moved;
        transferred += moved * 2;
        if(physical) set(channel, P_COUNT, (transfer.beats - 1) & 0xFFFFFF);
        else
        {
            set(channel, COUNT, transfer.beats);
            set(channel, PROGRESS, get(channel, PROGRESS) + moved);
        }
        if(moved !== beats)
        {
            errors++;
            stop(channel);
        }
        else if(!transfer.beats)
        {
            stop(channel);
            completed++;
            set_irq(irq, true);
        }
        return moved > 0;
    }

    return {
        poll()
        {
            let moved = false;
            for(const channel of channels) moved = burst(channel) || moved;
            return moved ? 0.01 : 100;
        },
        reset()
        {
            for(const channel of channels)
            {
                stop(channel);
                channel.regs.fill(0);
                channel.selector = 0;
            }
            global.fill(0);
            request = sync_command = sync_address = sync_width = resets = completed = transferred = errors = 0;
        },
        status() { return { "physical_resets": resets, "completed": completed, "bytes": transferred, "errors": errors }; },
        get_state()
        {
            return [channels.map(({ regs, selector, transfer }) => [regs.slice(), selector,
                transfer ? [transfer.write, transfer.ram, transfer.beats, transfer.sequence, transfer.started] : null]),
                global.slice(), request, sync_command, sync_address, sync_width, resets, completed, transferred, errors];
        },
        set_state(state)
        {
            channels.forEach((channel, i) => {
                const [regs, selector, job] = state[0][i];
                channel.regs.set(regs);
                channel.selector = selector;
                if(job)
                {
                    const [write, ram, beats, sequence, started] = job;
                    channel.transfer = { write, ram, beats, sequence, started };
                }
                else channel.transfer = null;
            });
            global.set(state[1]);
            [, , request, sync_command, sync_address, sync_width, resets, completed, transferred, errors] = state;
        },
    };
}
