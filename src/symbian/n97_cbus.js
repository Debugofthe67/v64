import { word } from "./n97_devices.js";

export const N97_CBUS_BASE = 0x20030700;
export const N97_CBUS_SEMAPHORES = 0x20040204;
const CLOCK_KHZ = 4390; // Nokia RM-505/RM-506 service manual, p. 8-20.
const AVILMA = 1, ASICR = 0, IDR = 1, IMR = 2, STATUS = 0x16;
const AVILMA_ID = 0x0296; // EM0 ID in the 22.0.110 RM-505 service readout.
const PWR_IRQ = 1, PWRONX = 1 << 5;
const merge = (old, value, mask) => (old & ~mask | value & mask) >>> 0;

export function create_n97_cbus(io, clock, set_irq)
{
    const available = new Uint8Array(6);
    let enabled, data, bits, transfer, pressed, pending, masked;
    const update_irq = () => set_irq(!!(pending & ~masked));

    function reset()
    {
        available.fill(0);
        enabled = data = bits = pending = 0;
        masked = 0xFFFF;
        transfer = null;
        pressed = false;
        update_irq();
    }
    function set_power(value)
    {
        if(pressed === value) return;
        pressed = value;
        pending |= PWR_IRQ;
        update_irq();
    }
    function read_avilma(address)
    {
        switch(address)
        {
            case ASICR: return AVILMA_ID;
            case IDR: return pending;
            case IMR: return masked;
            case STATUS: return pressed ? 0 : PWRONX;
            default: return 0xFFFF;
        }
    }
    function write_avilma(address, value)
    {
        if(address === IDR) pending &= ~value;
        else if(address === IMR) masked = value & 0xFFFF;
        update_irq();
    }
    function poll(now)
    {
        if(!transfer) return 100;
        if(now < transfer[0]) return transfer[0] - now;
        const [, reading, command, payload, length] = transfer;
        transfer = null;
        // Stock hw_retu.c uses a 16-bit word on the first CBUS device.
        const addressed = !(command & ~0x1FF) && (command >>> 6) === AVILMA &&
            !!(command & 0x20) === reading && length === 16;
        if(reading) data = addressed ? read_avilma(command & 0x1F) : (2 ** length - 1) >>> 0;
        else if(addressed) write_avilma(command & 0x1F, payload);
        return 100;
    }
    function start(reading, value, mask)
    {
        if(!(mask & 0xFF)) return;
        const now = clock.now();
        poll(now);
        if(!enabled || transfer) return;
        const length = bits + 1;
        // The frame starts with 3 device, 1 direction and 5 register bits.
        transfer = [now + (9 + length) / CLOCK_KHZ, reading, (value & mask) >>> 0, data, length];
    }

    const reg = (offset, name, read, write = () => {}) => word(io, N97_CBUS_BASE + offset, "RAPIDO CBUS " + name, read, write);
    // ISASW's hw_cbus.c (+0x60B02/+0x60B68) enables the controller,
    // loads the count and command, then polls BUSY before disabling it.
    reg(0x04, "enable", () => enabled, (value, mask) => {
        poll(clock.now());
        enabled = merge(enabled, value, mask & 1);
        if(!enabled) transfer = null;
    });
    reg(0x08, "busy", () => { poll(clock.now()); return +!!transfer; });
    reg(0x18, "read command", () => 0, (value, mask) => start(true, value, mask));
    reg(0x1C, "write command", () => 0, (value, mask) => start(false, value, mask));
    reg(0x20, "data", () => { poll(clock.now()); return data; },
        (value, mask) => { poll(clock.now()); data = merge(data, value, mask); });
    reg(0x2C, "bit count", () => bits, (value, mask) => { bits = merge(bits, value, mask & 31); });

    // The original single requester initializes each token with 1, consumes
    // it on a successful word read, and releases it by writing -1.
    for(let index = 0; index < available.length; index++)
    {
        word(io, N97_CBUS_SEMAPHORES + 4 * index, "RAPIDO arbitration semaphore", () => {
            const token = available[index];
            available[index] = 0;
            return token;
        }, (value, mask) => {
            if(mask === -1 && (value === 1 || value === 0xFFFFFFFF)) available[index] = 1;
        });
    }
    reset();
    return {
        poll, reset, set_power,
        power_pressed: () => pressed,
        get_state() { return [available.slice(), enabled, data, bits, transfer?.slice() || null, pressed, pending, masked]; },
        set_state(state)
        {
            available.set(state[0]);
            [, enabled, data, bits, transfer, pressed, pending, masked] = state;
            transfer = transfer?.slice() || null;
            update_irq();
        },
    };
}
