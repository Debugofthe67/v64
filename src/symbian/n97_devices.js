// The RM-505 bootstrap uses these physical registers before the variant's
// interrupt, clock and power management drivers take over.

export const N97_RAPIDO_SELECT = 0x20030300;
export const N97_RAPIDO_REVISION = 0x113;
export const N97_CPU_PLL = 0x20032D24;
export const N97_CLOCK_DIVIDERS = 0x20032C04;
export const N97_PLL3 = 0x20032D84;
export const N97_PLL3_CONTROL = 0x20032D8C;
export const N97_PLL_POWER = 0x20032C84;
export const N97_L2_BASE = 0x50000000;
export const N97_XTI_CONTROL = 0x40000000;
export const N97_XTI_DATA = 0x401E0000;
export const N97_XTI_DOORBELL = 0x401FD800;

// The bus checks each four-byte region before invoking these callbacks. Byte
// and halfword accesses select the corresponding little-endian byte lanes.
function word(io, address, name, read, write)
{
    io.register_mmio(address, 4, {
        name,
        read(offset, width)
        {
            return ((read() >>> (offset * 8)) & (width === 4 ? -1 : 2 ** (width * 8) - 1)) >>> 0;
        },
        write(offset, width, value)
        {
            const shift = offset * 8;
            const mask = width === 4 ? -1 : (2 ** (width * 8) - 1) << shift;
            write(value << shift >>> 0, mask);
        },
    });
}

const CLOCK_WORDS = [N97_CPU_PLL, N97_CLOCK_DIVIDERS, N97_PLL_POWER, 0x20032C88, 0x20032CD8, 0x20032C10, 0x20032C34,
    0x20032CB8, N97_PLL3, N97_PLL3_CONTROL];
// ROM+0x8D948 calculates 38.4 MHz * M / (N+1) / (postdiv+1).
// Match the RAP3NAND handoff's 433.92 MHz with M=113, N=9 and postdiv=0.
const CPU_PLL_RESET = (113 << 5) | 9;
const PLL_ENABLE = 1 << 14;
const PLL_LOCKED = 1 << 4;

export function create_n97_clocks(io)
{
    const reset_values = () => CLOCK_WORDS.map(address => address === N97_CPU_PLL ? CPU_PLL_RESET : 0);
    let registers = reset_values();
    const clock_value = address => registers[CLOCK_WORDS.indexOf(address)];
    const pll_locked = () => (clock_value(N97_PLL_POWER) & PLL_ENABLE) &&
        (clock_value(N97_PLL3_CONTROL) & PLL_ENABLE) && ((clock_value(N97_PLL3) >> 5) & 0x7FF) ? PLL_LOCKED : 0;
    for(const [index, address] of CLOCK_WORDS.entries())
    {
        word(io, address, "RAPIDO clock control", () => registers[index] | (address === N97_PLL3_CONTROL ? pll_locked() : 0),
            (value, mask) => { registers[index] = merge(registers[index], value, address === N97_PLL3_CONTROL ? mask & ~PLL_LOCKED : mask); });
    }
    return {
        reset() { registers = reset_values(); },
        get_state() { return registers.slice(); },
        set_state(state) { registers = state.slice(); },
        status()
        {
            const pll = clock_value(N97_CPU_PLL);
            const divisor = ((pll & 31) + 1) * ((clock_value(N97_CLOCK_DIVIDERS) & 3) + 1);
            return { "configured_cpu_hz": Math.floor(38400000 * ((pll >>> 5) & 0x7FF) / divisor), "pll3_locked": !!pll_locked() };
        },
    };
}

function merge(old, value, mask)
{
    return ((old & ~mask) | (value & mask)) >>> 0;
}

export function create_n97_rapido_id(io)
{
    // Representative RAPIDO3G 1.13. ROM+0x1978 selects 0xA and combines
    // readback [15:8] and [19:16] into one revision number.
    const id = ((N97_RAPIDO_REVISION & 0xFF0) << 4) | ((N97_RAPIDO_REVISION & 0xF) << 16);
    let selector = 0;
    word(io, N97_RAPIDO_SELECT, "RAPIDO identity selector",
        () => selector | (selector === 0xA ? id : 0),
        (value, mask) => { selector = merge(selector, value, mask & 0xFF); });
    return {
        reset() { selector = 0; },
        get_state() { return [selector]; },
        set_state(state) { [selector] = state; },
    };
}

// ARM L2x0 CTRL, AUX_CTRL, CACHE_SYNC, INV_WAY, CLEAN_INV_WAY and DEBUG_CTRL.
// Register definitions match Linux arch/arm/include/asm/hardware/cache-l2x0.h.
const L2_CONTROL = 0x100;
const L2_AUX = 0x104;
const L2_SYNC = 0x730;
const L2_INVALIDATE_WAY = 0x77C;
const L2_CLEAN_INVALIDATE_WAY = 0x7FC;
const L2_DEBUG = 0xF40;
const L2_GEOMETRY = (1 << 17) | (8 << 13); // 8 ways of 16 KiB
const L2_AUX_CONFIG = 0x01F01FFF;

export function create_n97_l2(io)
{
    let control = 0;
    let aux_config = 0;
    let debug = 0;
    const reg = (offset, name, read, write) => word(io, N97_L2_BASE + offset, name, read, write);
    reg(L2_CONTROL, "L2x0 control", () => control, (value, mask) => { control = merge(control, value, mask & 1); });
    reg(L2_AUX, "L2x0 auxiliary control", () => aux_config | L2_GEOMETRY, (value, mask) => {
        if(!control) aux_config = merge(aux_config, value, mask & L2_AUX_CONFIG);
    });
    reg(L2_DEBUG, "L2x0 debug control", () => debug, (value, mask) => { debug = merge(debug, value, mask & 3); });
    // These maintenance operations finish synchronously on V86's coherent
    // memory. Their status is clear on read after the operation completes.
    for(const [offset, name] of [[L2_SYNC, "L2x0 cache sync"], [L2_INVALIDATE_WAY, "L2x0 invalidate by way"],
        [L2_CLEAN_INVALIDATE_WAY, "L2x0 clean/invalidate by way"]])
    {
        reg(offset, name, () => 0, () => {});
    }
    return {
        reset() { control = 0; aux_config = 0; debug = 0; },
        get_state() { return [control, aux_config, debug]; },
        set_state(state) { [control, aux_config, debug] = state; },
        enabled() { return !!control; },
    };
}

const XTI_CHANNELS = [0xE0, 0xE2];
const XTI_PACKET_BYTES = 1024;
const XTI_HISTORY = 16;

export function create_n97_xti(io)
{
    let controls = [0, 0, 0];
    let pending = XTI_CHANNELS.map(() => []);
    let packets = [];
    for(const [index, offset] of [0x04, 0x08, 0x10].entries())
    {
        word(io, N97_XTI_CONTROL + offset, "XTI control", () => controls[index],
            (value, mask) => { controls[index] = merge(controls[index], value, mask); });
    }
    // Original XIP+0x96EEC/+0x96F1C stream bytes to the channel port.
    // The doorbell byte names the channel whose record is now complete.
    for(const [index, channel] of XTI_CHANNELS.entries())
    {
        io.register_mmio(N97_XTI_DATA + ((channel - 0xE0) << 12), 1, {
            name: "XTI trace byte",
            read() { return 0; },
            write(offset, width, value)
            {
                if(pending[index].length < XTI_PACKET_BYTES) pending[index].push(value & 0xFF);
            },
        });
    }
    io.register_mmio(N97_XTI_DOORBELL, 1, {
        name: "XTI trace doorbell",
        read() { return 0; },
        write(offset, width, channel)
        {
            const index = XTI_CHANNELS.indexOf(channel);
            if(index < 0 || !pending[index].length) return;
            packets.push([channel, String.fromCharCode(...pending[index])]);
            if(packets.length > XTI_HISTORY) packets.shift();
            pending[index] = [];
        },
    });
    return {
        reset() { controls.fill(0); pending = XTI_CHANNELS.map(() => []); packets = []; },
        get_state() { return [controls.slice(), pending.map(bytes => Uint8Array.from(bytes)), packets.map(packet => packet.slice())]; },
        set_state(state)
        {
            controls = state[0].slice();
            pending = state[1].map(bytes => Array.from(bytes));
            packets = state[2].map(packet => packet.slice());
        },
        packets() { return packets.map(([channel, data]) => ({ "channel": channel, "data": data })); },
    };
}
