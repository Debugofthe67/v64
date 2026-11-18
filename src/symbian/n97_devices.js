// The RM-505 bootstrap uses these physical registers before the variant's
// interrupt, clock and power management drivers take over.

import { N97_MMC_IRQ } from "./n97_mmc.js";
import { N97_I2C_IRQ } from "./n97_i2c.js";
import { N97_DMA_IRQS } from "./n97_dma.js";

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
export function word(io, address, name, read, write)
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

export function create_n97_board_config(io, mmc = () => null)
{
    // These are the board settings written by the variant at XIP+0x974A4.
    // Adjacent offsets also host active devices; only map the actual words.
    const words = [0x1C10, 0x1C20, 0x1C30, 0x1C40, 0x1C50, 0x1C60, 0x1C70,
        0x1C90, 0x1CA0, 0x1CB0, 0x1CC0, 0x1CD0, 0x1CE0, 0x1CF0, 0x1D00, 0x1D10, 0x1D20, 0x1D30];
    const platform = latches(io, 0x20030000, "RAPIDO board configuration", words, (offset, value) => {
        if(offset === 0x1C90) mmc()?.set_clock(!!(value & 0x4000));
        if(offset === 0x1CC0) mmc()?.select_card(value >> 12 & 1);
    });
    // Variant MMC clock gating and egpio bank 1's GENIO44 output set/clear.
    for(const offset of [0x1C90, 0x1CC0])
    {
        word(io, 0x20030000 + offset + 4, "RAPIDO output set", () => 0,
            (value, mask) => platform.write_word(offset, -1, value & mask));
        word(io, 0x20030000 + offset + 8, "RAPIDO output clear", () => 0,
            (value, mask) => platform.write_word(offset, 0, value & mask));
    }
    return platform;
}

function latches(io, base, name, offsets, on_write = undefined)
{
    const reset = () => offsets.map(() => 0);
    let registers = reset();
    function write_word(offset, value, mask)
    {
        const index = offsets.indexOf(offset);
        registers[index] = merge(registers[index], value, mask);
        on_write?.(offset, registers[index]);
    }
    for(const [index, offset] of offsets.entries())
    {
        word(io, base + offset, name, () => registers[index], (value, mask) => {
            write_word(offset, value, mask);
        });
    }
    return {
        reset() { registers = reset(); },
        get_state() { return registers.slice(); },
        set_state(state) { registers = state.slice(); },
        write_word,
    };
}

export const N97_KEYBOARD_IRQ = 249;
export const N97_AVILMA_IRQ = 250;
export const N97_SLIDER_IRQ = 248;
export const N97_PANEL_IRQ = 234;
export const N97_NAND_IRQ = 245;
const N97_DISPC_IRQ = 131;
const ICU_BASE = 0x20400000;
const NO_INTERRUPT = 0xFFFFFFFF;
const MS_TICK_INTERRUPT = 35;
const TIMER_BASE = 0x20040100;
const MS_TICK_INITIAL_COUNT = 0x200401A4;
const MS_TICK_COUNT = 0x200401C4;
const MS_TICK_COUNTS_PER_MS = 9600;

export function create_n97_interrupts(io, set_lines)
{
    // RM-505 dispatches IRQ from +0x08 (XIP+0x8CFF8) and FIQ
    // from +0x48 (+0x8D178), with -1 as the empty ID on either port.
    const configuration = latches(io, ICU_BASE, "RAPIDO interrupt configuration", [0x1C, 0x84, 0x88, 0x90, 0x9C, 0x94]);
    const priority = new Uint8Array(256);
    const sources = [MS_TICK_INTERRUPT, N97_MMC_IRQ, N97_I2C_IRQ, N97_KEYBOARD_IRQ, N97_SLIDER_IRQ,
        ...N97_DMA_IRQS, N97_PANEL_IRQ, N97_DISPC_IRQ, N97_NAND_IRQ, N97_AVILMA_IRQ];
    const unmasked = new Set(), asserted = new Set();
    let enabled = 0, selected = 0, active = NO_INTERRUPT;
    const pending = () => {
        if(!enabled || active !== NO_INTERRUPT) return NO_INTERRUPT;
        let id = NO_INTERRUPT, best = 0;
        for(const source of sources)
        {
            if(priority[source] > best && unmasked.has(source) && asserted.has(source))
            {
                id = source;
                best = priority[id];
            }
        }
        return id;
    };
    const update = () => set_lines(pending() !== NO_INTERRUPT, false);
    const reg = (offset, name, read, write) => word(io, ICU_BASE + offset, name, read, write);
    reg(0x04, "RAPIDO interrupt enable", () => enabled, (value, mask) => { enabled = merge(enabled, value, mask & 1); update(); });
    reg(0x08, "RAPIDO IRQ claim", () => {
        const id = pending();
        if(id !== NO_INTERRUPT)
        {
            active = id;
            if(N97_DMA_IRQS.includes(id)) asserted.delete(id);
            update();
        }
        return id;
    }, () => {});
    // The firmware calls the +0x0C command with the bound tick ID
    // immediately after programming the first interval.
    reg(0x0C, "RAPIDO IRQ unmask", () => 0, (value, mask) => {
        const id = (value & mask) >>> 0;
        if(sources.includes(id)) unmasked.add(id);
        if(id === active) active = NO_INTERRUPT;
        update();
    });
    reg(0x10, "RAPIDO IRQ mask", () => 0, (value, mask) => {
        const id = (value & mask) >>> 0;
        if(id === NO_INTERRUPT) unmasked.clear();
        else unmasked.delete(id);
        if(id === NO_INTERRUPT || id === active) active = NO_INTERRUPT;
        update();
    });
    reg(0x20, "RAPIDO interrupt select", () => selected, (value, mask) => { selected = merge(selected, value, mask & 0xFF); });
    reg(0x24, "RAPIDO interrupt priority", () => priority[selected], (value, mask) => {
        priority[selected] = merge(priority[selected], value, mask & 7);
        update();
    });
    // FIQ has no connected sources. Bootstrap reads the GPIO claim ports
    // with all banks disabled, before egpio.dll binds the active inputs.
    reg(0x48, "RAPIDO FIQ claim", () => NO_INTERRUPT, () => {});
    reg(0x50, "RAPIDO FIQ clear", () => 0, () => {});
    reg(0x40, "RAPIDO FIQ mux status", () => 0, () => {});
    reg(0x80, "RAPIDO IRQ completion", () => {
        active = NO_INTERRUPT;
        update();
        return 0;
    }, () => {});
    // ISASW's hw_irq_1.c brackets CBUS and interrupt registration using
    // +0x88/+0x8C and +0x94/+0x98. These command pairs retain separate state
    // from the AP's IRQ claim path.
    for(const offset of [0x88, 0x94])
        reg(offset + 4, "RAPIDO interrupt critical-section release", () => 0,
            (value, mask) => configuration.write_word(offset, 0, value & mask));
    function line(id, level)
    {
        if(level) asserted.add(id);
        else asserted.delete(id);
        update();
    }
    return {
        set_timer(level) { line(MS_TICK_INTERRUPT, level); },
        set_mmc(level) { line(N97_MMC_IRQ, level); },
        set_dma(source, level) { line(source, level); },
        set_i2c(level) { line(N97_I2C_IRQ, level); },
        set_keyboard(level) { line(N97_KEYBOARD_IRQ, level); },
        set_avilma(level) { line(N97_AVILMA_IRQ, level); },
        set_slider(level) { line(N97_SLIDER_IRQ, level); },
        set_panel(level) { line(N97_PANEL_IRQ, level); },
        set_dispc(level) { line(N97_DISPC_IRQ, level); },
        set_nand(level) { line(N97_NAND_IRQ, level); },
        reset()
        {
            configuration.reset();
            priority.fill(0);
            enabled = selected = 0;
            active = NO_INTERRUPT;
            unmasked.clear();
            asserted.clear();
            update();
        },
        get_state()
        {
            // Preserve the timer/MMC pairs in older N97 snapshots.
            return [configuration.get_state(), Array.from(priority), enabled, selected, active,
                ...sources.flatMap(id => [unmasked.has(id), asserted.has(id)])];
        },
        set_state(state)
        {
            configuration.set_state(state[0]);
            priority.set(state[1]);
            [, , enabled, selected, active] = state;
            unmasked.clear();
            asserted.clear();
            sources.forEach((id, index) => {
                if(state[5 + index * 2]) unmasked.add(id);
                if(state[6 + index * 2]) asserted.add(id);
            });
            update();
        },
    };
}

// egpio.dll's bank layout. Pen DAV (GENIO38) and the lock switch (GENIO40)
// share IRQ234. Hall (GENIO58) and microSD detect (GENIO45) share the bank.
export function create_n97_gpio_input(io, base, direction_set, pin, initial_high, set_irq, other_inputs = () => 0)
{
    const pins = [];
    const irq_groups = new Map();
    let bank_enabled = false;
    const pending = line => line.pending || (line.input && !line.edge && line.trigger === (line.high ? 2 : 1) ? line.bit : 0);
    const update = () => {
        for(const [set_irq, group] of irq_groups)
            set_irq(bank_enabled && group.some(line => line.enabled & pending(line)));
    };
    const bitmap = value => pins.reduce((mask, line) => mask | value(line), 0);
    const change = (value, mask, modify) => {
        for(const line of pins) if(value & mask & line.bit) modify(line);
        update();
    };
    const reg = (offset, name, read, write = () => {}) => word(io, base + offset, name, read, write);
    reg(0x04, "RAPIDO GENIO IRQ gate", () => +bank_enabled, (value, mask) => {
        if(mask & 1) bank_enabled = !!(value & 1);
        update();
    });
    word(io, direction_set, "RAPIDO GENIO direction input", () => 0,
        (value, mask) => change(value, mask, line => { line.input = true; }));
    word(io, direction_set + 4, "RAPIDO GENIO direction output", () => 0,
        (value, mask) => change(value, mask, line => { line.input = false; }));
    reg(0x08, "RAPIDO GENIO inputs", () => other_inputs() | bitmap(line => line.high && line.input ? line.bit : 0));
    reg(0x0C, "RAPIDO GENIO IRQ pending", () => bitmap(pending));
    reg(0x10, "RAPIDO GENIO IRQ enable", () => 0, (value, mask) => change(value, mask, line => { line.enabled = line.bit; }));
    reg(0x14, "RAPIDO GENIO IRQ disable", () => 0, (value, mask) => change(value, mask, line => { line.enabled = 0; }));
    reg(0x18, "RAPIDO GENIO IRQ enabled", () => bitmap(line => line.enabled));
    // Original ISR uses the enable/pending bitmaps and W1C, whereas the
    // bootstrap probes the empty claim port with the bank disabled.
    reg(0x20, "RAPIDO GENIO IRQ acknowledge", () => 0, (value, mask) => change(value, mask, line => { line.pending = 0; }));
    for(const [offset, detect_edge] of [[0x28, true], [0x2C, false]])
        reg(offset, "RAPIDO GENIO IRQ detection", () => 0, (value, mask) => change(value, mask, line => { line.edge = detect_edge; }));
    for(const [offset, mode] of [[0x34, 2], [0x38, 1]])
        reg(offset, "RAPIDO GENIO IRQ trigger", () => 0, (value, mask) => change(value, mask, line => { line.trigger = mode; }));
    reg(0x3C, "RAPIDO GENIO IRQ claim", () => NO_INTERRUPT);
    function connect(pin, high, set_irq)
    {
        const primary = pins.length === 0;
        const line = { bit: 1 << pin, high, input: true, enabled: 0, pending: 0, edge: false, trigger: 0 };
        pins.push(line);
        if(!irq_groups.has(set_irq)) irq_groups.set(set_irq, []);
        irq_groups.get(set_irq).push(line);
        return {
            connect,
            set_input(level)
            {
                if(line.input && line.edge && line.high !== level && line.trigger === (level ? 2 : 1)) line.pending = line.bit;
                line.high = level;
                update();
            },
            read_input() { return line.high; },
            reset()
            {
                if(primary) bank_enabled = false;
                line.input = true;
                line.edge = false;
                line.enabled = line.pending = line.trigger = 0;
                update();
            },
            get_state() { return [line.high, bank_enabled, line.enabled, line.pending, line.edge, line.trigger, line.input]; },
            set_state(state)
            {
                if(primary) bank_enabled = state[1];
                [line.high, , line.enabled, line.pending, line.edge, line.trigger, line.input] = state;
                update();
            },
        };
    }
    return connect(pin, initial_high, set_irq);
}

export function create_n97_nand_bus(io, set_irq)
{
    // mednand.pdd 0x800DF9B0 programs this flash-bus word before opening
    // the device. Retain its configuration without changing address decode.
    const timing = latches(io, 0x20034094, "RAPIDO OneNAND bus configuration", [0]);
    // RM-505 board p.2: combo memory D3000 INTo goes to GENIO22.
    const gpio = create_n97_gpio_input(io, 0x20031D40, 0x20031CE4, 22, false, set_irq);
    return {
        set_input: gpio.set_input,
        reset() { timing.reset(); gpio.reset(); gpio.set_input(false); },
        get_state() { return [timing.get_state(), gpio.get_state()]; },
        set_state(state) { timing.set_state(state[0]); gpio.set_state(state[1]); },
    };
}

export function create_n97_os_timer(io, clock, set_irq)
{
    const other = latches(io, TIMER_BASE, "RAPIDO timer configuration", [0x04, 0x08, 0x20, 0x24, 0x28, 0x2C, 0x30, 0x504]);
    let control = 0, mode = 0, count = 0, deadline = null, expired = false;
    function start(now)
    {
        deadline = control & 1 && mode === 3 && count ? now + count / MS_TICK_COUNTS_PER_MS : null;
    }
    function poll(now)
    {
        if(deadline === null) return 100;
        if(now < deadline) return deadline - now;
        count = 0;
        deadline = null;
        expired = true;
        set_irq(true);
        return 0;
    }
    function remaining(now)
    {
        poll(now);
        return deadline === null ? count : Math.ceil((deadline - now) * MS_TICK_COUNTS_PER_MS);
    }
    word(io, TIMER_BASE + 0x84, "RAPIDO millisecond timer control", () => control, (value, mask) => {
        const now = clock.now();
        count = remaining(now);
        control = merge(control, value, mask);
        start(now);
    });
    word(io, TIMER_BASE + 0x88, "RAPIDO millisecond timer mode", () => mode, (value, mask) => {
        const now = clock.now();
        count = remaining(now);
        mode = merge(mode, value, mask);
        start(now);
    });
    function reload(value, mask)
    {
        const now = clock.now();
        count = merge(remaining(now), value, mask);
        expired = false;
        set_irq(false);
        start(now);
    }
    // XIP+0x8E4B0 loads the first interval. The ISR at XIP+0x8DE88
    // uses the separate read/reload port to wait for zero and schedule the next millisecond.
    word(io, MS_TICK_INITIAL_COUNT, "RAPIDO millisecond timer initial count", () => remaining(clock.now()), reload);
    word(io, MS_TICK_COUNT, "RAPIDO millisecond timer count", () => remaining(clock.now()), reload);
    return {
        poll,
        reset()
        {
            other.reset();
            control = mode = count = 0;
            deadline = null;
            expired = false;
            set_irq(false);
        },
        get_state() { return [other.get_state(), control, mode, count, deadline, expired]; },
        set_state(state)
        {
            other.set_state(state[0]);
            [, control, mode, count, deadline, expired] = state;
            set_irq(expired);
        },
    };
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
        [L2_CLEAN_INVALIDATE_WAY, "L2x0 clean/invalidate by way"], [0x770, "L2x0 invalidate line by PA"],
        [0x7B0, "L2x0 clean line by PA"], [0x7F0, "L2x0 clean/invalidate line by PA"]])
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
