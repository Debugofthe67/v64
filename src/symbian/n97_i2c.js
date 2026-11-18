import { N97_KEYBOARD_ADDRESS } from "./n97_keyboard.js";

export const N97_I2C_BASE = 0x20032200;
export const N97_I2C_IRQ = 135;

const NACK = 2;
const ARDY = 4;
const RRDY = 8;
const XRDY = 16;
const BB = 0x1000;
const SINGLE_BYTE = 0x8000;
const EN = 0x8000;
const MST = 0x0400;
const TRX = 0x0200;
const XA = 0x0100;
const STP = 2;
const STT = 1;

// i2c.dll uses the OMAP-compatible register layout and low-byte-first
// halfword DATA port (0x800D9048, 0x800D9124). Only N2850 is on this modelled bus.
export function create_n97_i2c(io, target, set_irq)
{
    let ie, events, remaining, control, busy, transfer, part, address;
    let own_address, prescaler, scl_low, scl_high, buffer_config;
    const status = () => events | (busy ? BB : 0) | (transfer === "tx" ? XRDY :
        transfer === "rx" ? RRDY | (remaining === 1 ? SINGLE_BYTE : 0) : 0);
    const update = () => set_irq(!!(control & EN && ie & status()));
    function reset()
    {
        ie = events = remaining = control = address = own_address = prescaler = scl_low = scl_high = buffer_config = 0;
        busy = false;
        transfer = "";
        part = [];
        update();
    }
    function complete()
    {
        if(transfer === "tx") target.write(part);
        transfer = "";
        part = [];
        events |= ARDY;
        if(control & STP)
        {
            control &= ~(STP | MST);
            busy = false;
        }
        update();
    }
    function command(value)
    {
        control = value & ~STT;
        if(!(control & EN))
        {
            busy = false;
            transfer = "";
            part = [];
            events = 0;
        }
        else if((value & (MST | STT)) === (MST | STT))
        {
            busy = true;
            transfer = "";
            part = [];
            events = 0;
            if(value & XA || address !== N97_KEYBOARD_ADDRESS)
            {
                complete();
                events |= NACK;
            }
            else if(!remaining) complete();
            else if(value & TRX) transfer = "tx";
            else
            {
                part = target.read(remaining);
                transfer = "rx";
            }
        }
        else if(value & STP)
        {
            busy = false;
            transfer = "";
            part = [];
            control &= ~(STP | MST);
        }
        update();
    }
    function read_data(width)
    {
        if(transfer !== "rx") return 0;
        let data = 0;
        for(let n = 0; n < width && remaining; n++, remaining--) data |= (part.shift() ?? 0) << (n * 8);
        if(!remaining) complete();
        else update();
        return data;
    }
    function write_data(value, width)
    {
        if(transfer !== "tx") return;
        for(let n = 0; n < width && remaining; n++, remaining--) part.push(value >> (n * 8) & 255);
        if(!remaining) complete();
        else update();
    }
    function reg(offset, read, write = () => {})
    {
        io.register_mmio(N97_I2C_BASE + offset, 2, {
            name: "RAPIDO I2C",
            read(lane, width) { return read(width, lane) >>> (lane * 8) & (width === 2 ? 0xFFFF : 255); },
            write(lane, width, value) { write(value << (lane * 8), (width === 2 ? 0xFFFF : 255) << (lane * 8), width, lane); },
        });
    }
    const merge = (old, value, mask) => (old & ~mask) | (value & mask);
    reg(0x04, () => ie, (value, mask) => { ie = merge(ie, value, mask & 0x1F); update(); });
    reg(0x08, status, value => { events &= ~value; update(); });
    reg(0x10, () => 1); // SYSS.RESETDONE after the synchronously reset peripheral.
    reg(0x14, () => buffer_config, (value, mask) => { buffer_config = merge(buffer_config, value, mask & 0x8080); });
    reg(0x18, () => remaining, (value, mask) => { remaining = merge(remaining, value, mask); });
    reg(0x1C, (width, lane) => lane === 0 ? read_data(width) : 0,
        (value, mask, width, lane) => { if(lane === 0) write_data(value, width); });
    reg(0x20, () => 0, value => { if(value & 2) reset(); }); // SYSC.SRST
    reg(0x24, () => control, (value, mask) => command(merge(control, value, mask)));
    reg(0x28, () => own_address, (value, mask) => { own_address = merge(own_address, value, mask & 0x3FF); });
    reg(0x2C, () => address, (value, mask) => { address = merge(address, value, mask & 0x3FF); });
    reg(0x30, () => prescaler, (value, mask) => { prescaler = merge(prescaler, value, mask & 255); });
    reg(0x34, () => scl_low, (value, mask) => { scl_low = merge(scl_low, value, mask & 255); });
    reg(0x38, () => scl_high, (value, mask) => { scl_high = merge(scl_high, value, mask & 255); });
    reset();
    return {
        reset,
        get_state()
        {
            return [ie, events, remaining, control, busy, transfer, part.slice(), address, own_address, prescaler, scl_low, scl_high, buffer_config];
        },
        set_state(state)
        {
            [ie, events, remaining, control, busy, transfer, part, address, own_address, prescaler, scl_low, scl_high, buffer_config] = state;
            part = part.slice();
            update();
        },
    };
}
