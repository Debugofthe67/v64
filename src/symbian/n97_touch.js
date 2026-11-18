// TSC2004 (N500), Nokia RM-505/RM-507 schematics pp. 2 and 10.
// The control bytes, data register order, and PINTDAV follow TI SBAS408E.
export const N97_TOUCH_ADDRESS = 0x4A; // AD1 = VIO, AD0 = ground
export const N97_TOUCH_WIDTH = 640;
export const N97_TOUCH_HEIGHT = 360;

const STATUS = 7, CFR0 = 12, CFR1 = 13, CFR2 = 14, CFN = 15;
const PSM = 0x8000, STS = 0x4000, RM = 0x2000;
const RESET_MS = 0.01; // minimum guaranteed external reset pulse, figure 38
const BATCH_MS = [1, 1, 2, 4, 10, 20, 40, 100];
const CONVERSION_CHANNELS = [0xF, 3, 1, 2, 0xC]; // XYZ, XY, X, Y, Z1/Z2
// Physical ADC X positions for the two touch-key regions. With ADC Y = 15,
// exyin.dll sees X = 1008, outside the LCD calibration and inside both regions.
const TOUCH_KEY_X = new Map([["send", 720], ["end", 293]]);

export function n97_control(control, pressed)
{
    return typeof pressed === "boolean" && (control === "lock" || TOUCH_KEY_X.has(control));
}

export function n97_touch_point(x, y, down)
{
    return Number.isInteger(x) && x >= 0 && x < N97_TOUCH_WIDTH &&
        Number.isInteger(y) && y >= 0 && y < N97_TOUCH_HEIGHT && typeof down === "boolean";
}

export function create_n97_touch(clock, set_pint)
{
    const regs = new Uint16Array(16);
    let contact = null, x = 0, y = 0, mode, selector, available, deadline, reset_seen, power_bias, samples;
    const blocked_contacts = new Set();
    let reset_at = null, held_reset = false;
    function pint_high()
    {
        if(held_reset) return true;
        if(regs[CFR2] & 0x4000) return !available; // active-low DAV, the retail configuration
        if(regs[CFR2] & 0x8000) return !contact;
        return !contact && !available;
    }
    const update = () => set_pint(pint_high());
    function reset_registers()
    {
        regs.fill(0);
        regs[8] = regs[10] = 0xFFF;
        mode = deadline = null;
        selector = available = 0;
        power_bias = reset_seen = false;
        samples = 0;
        update();
    }
    function reset()
    {
        contact = null;
        blocked_contacts.clear();
        reset_at = null;
        held_reset = false;
        x = y = 0;
        reset_registers();
    }
    function convert(now)
    {
        const channels = CONVERSION_CHANNELS[mode];
        if(held_reset || !contact || !channels) return;
        // exyin.dll at 0x8016DB30 turns the ADC inputs into (1023 - Y, X)
        // before the default calibration maps (30..973, 54..973) to 640x360.
        const adc_x = contact === "screen" ? 54 + Math.round((y + 0.5) * 919 / N97_TOUCH_HEIGHT) : TOUCH_KEY_X.get(contact);
        const adc_y = contact === "screen" ? 993 - Math.round((x + 0.5) * 943 / N97_TOUCH_WIDTH) : 15;
        const scale = regs[CFR0] & RM ? 4 : 1;
        const sample = [adc_x, adc_y, 400, 450];
        for(let index = 0; index < sample.length; index++)
        {
            if(!(channels & 1 << index)) continue;
            regs[index] = sample[index] * scale;
            available |= 0x8000 >>> index;
        }
        samples++;
        if(mode < 2) deadline = now + BATCH_MS[regs[CFR1] & 7];
        else mode = deadline = null;
        update();
    }
    function set_contact(source, down, next_x = x, next_y = y)
    {
        if(!down)
        {
            blocked_contacts.delete(source);
            if(contact === source)
            {
                if(source === "screen") { x = next_x; y = next_y; }
                lift();
            }
            return;
        }
        if(blocked_contacts.has(source)) return;
        if(contact && contact !== source)
        {
            // A second contact cannot take over the resistive panel on a move
            // or key repeat. It can start a new contact after its own release.
            blocked_contacts.add(source);
            return;
        }
        const start = contact === null;
        contact = source;
        if(source === "screen") { x = next_x; y = next_y; }
        if(start && regs[CFR0] & PSM) convert(clock.now());
        update();
    }
    function lift()
    {
        contact = null;
        deadline = null;
        // An unread conversion remains in the chip. The original pen status
        // poll sees pen-up even if it still needs to drain that conversion.
        if(!(regs[CFR0] & PSM)) mode = null;
        update();
    }
    function release()
    {
        blocked_contacts.clear();
        lift();
    }
    function write(bytes)
    {
        for(let at = 0; at < bytes.length;)
        {
            const command = bytes[at++];
            if(command & 0x80)
            {
                if(command & 2) reset_registers();
                else
                {
                    regs[CFR0] = regs[CFR0] & ~RM | (command & 4 ? RM : 0);
                    mode = command & 1 ? null : command >> 3 & 15;
                    deadline = null;
                }
                continue;
            }
            if(command & 4) break; // Reserved in CB0.
            power_bias = !!(command & 2);
            const index = command >> 3;
            if(command & 1) { selector = index; continue; }
            if(at + 2 > bytes.length) break;
            const value = bytes[at++] << 8 | bytes[at++];
            if(index >= 8 && index <= 11) regs[index] = value & 0xFFF;
            if(index === CFR0)
            {
                regs[index] = value & ~STS;
                if(value & STS) mode = deadline = null;
            }
            if(index === CFR1) regs[index] = value & 0x0F07;
            if(index === CFR2) regs[index] = value & 0xFFDF;
        }
        if(deadline === null && mode !== null) convert(clock.now());
        update();
    }
    function read(length)
    {
        const bytes = [];
        for(let index = selector; bytes.length < length; index = index + 1 & 15)
        {
            let value = regs[index];
            if(index === CFR0) value = value & ~PSM | (contact ? PSM : 0) | (deadline === null ? STS : 0);
            if(index === CFN) value = mode === null ? 0 : 1 << mode;
            if(index === STATUS) value = available | (reset_seen ? 0x80 : 0) | (contact && power_bias ? 0 : 4);
            bytes.push(value >> 8);
            if(bytes.length === length) break;
            bytes.push(value & 255);
            if(index <= 6) available &= ~(0x8000 >>> index);
            if(index === STATUS) reset_seen = true;
        }
        update();
        return bytes;
    }
    function reset_if_due(now)
    {
        if(reset_at === null || now < reset_at) return;
        reset_at = null;
        held_reset = true;
        reset_registers();
    }
    function set_reset(high)
    {
        const now = clock.now();
        reset_if_due(now);
        if(high)
        {
            reset_at = null;
            held_reset = false;
        }
        else if(!held_reset && reset_at === null) reset_at = now + RESET_MS;
        update();
    }
    reset_registers();
    return {
        read, write, release, reset, set_reset,
        set_touch(x, y, down)
        {
            if(n97_touch_point(x, y, down)) set_contact("screen", down, x, y);
        },
        set_key(key, down)
        {
            if(TOUCH_KEY_X.has(key) && typeof down === "boolean") set_contact(key, down);
        },
        restore_reset(high)
        {
            reset_at = null;
            held_reset = !high;
            reset_registers();
        },
        acknowledges() { reset_if_due(clock.now()); return !held_reset; },
        poll(now)
        {
            reset_if_due(now);
            if(deadline !== null && now >= deadline) convert(now);
            return Math.min(deadline === null ? 100 : deadline - now, reset_at === null ? 100 : reset_at - now);
        },
        status() { return { "pressed": !!contact, "contact": contact, "x": x, "y": y, "pint_high": pint_high(), "samples": samples }; },
        get_state()
        {
            return [regs.slice(), mode, selector, available, deadline, reset_seen,
                power_bias, samples, !!contact, x, y, reset_at, held_reset, contact];
        },
        set_state(state)
        {
            regs.set(state[0]);
            let pressed;
            [, mode, selector, available, deadline, reset_seen, power_bias, samples, pressed, x, y, reset_at, held_reset] = state;
            contact = state.length > 13 ? state[13] : pressed ? "screen" : null;
            blocked_contacts.clear();
            update();
        },
    };
}
