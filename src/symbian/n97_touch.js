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

export function n97_touch_point(x, y, down)
{
    return Number.isInteger(x) && x >= 0 && x < N97_TOUCH_WIDTH &&
        Number.isInteger(y) && y >= 0 && y < N97_TOUCH_HEIGHT && typeof down === "boolean";
}

export function create_n97_touch(clock, set_pint)
{
    const regs = new Uint16Array(16);
    let pressed = false, x = 0, y = 0, mode, selector, available, deadline, reset_seen, power_bias, samples;
    let reset_at = null, held_reset = false;
    function pint_high()
    {
        if(held_reset) return true;
        if(regs[CFR2] & 0x4000) return !available; // active-low DAV, the retail configuration
        if(regs[CFR2] & 0x8000) return !pressed;
        return !pressed && !available;
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
        pressed = false;
        reset_at = null;
        held_reset = false;
        x = y = 0;
        reset_registers();
    }
    function convert(now)
    {
        const channels = CONVERSION_CHANNELS[mode];
        if(held_reset || !pressed || !channels) return;
        // exyin.dll at 0x8016DB30 turns the ADC inputs into (1023 - Y, X)
        // before the default calibration maps (30..973, 54..973) to 640x360.
        const adc_x = 54 + Math.round((y + 0.5) * 919 / N97_TOUCH_HEIGHT);
        const adc_y = 993 - Math.round((x + 0.5) * 943 / N97_TOUCH_WIDTH);
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
    function set_touch(next_x, next_y, down)
    {
        if(!n97_touch_point(next_x, next_y, down)) return;
        const start = down && !pressed;
        pressed = down;
        x = next_x;
        y = next_y;
        if(!down) release();
        else if(start && regs[CFR0] & PSM) convert(clock.now());
        update();
    }
    function release()
    {
        pressed = false;
        deadline = null;
        // An unread conversion remains in the chip. The original pen status
        // poll sees pen-up even if it still needs to drain that conversion.
        if(!(regs[CFR0] & PSM)) mode = null;
        update();
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
            if(index === CFR0) value = value & ~PSM | (pressed ? PSM : 0) | (deadline === null ? STS : 0);
            if(index === CFN) value = mode === null ? 0 : 1 << mode;
            if(index === STATUS) value = available | (reset_seen ? 0x80 : 0) | (pressed && power_bias ? 0 : 4);
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
        read, write, set_touch, release, reset, set_reset,
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
        status() { return { "pressed": pressed, "x": x, "y": y, "pint_high": pint_high(), "samples": samples }; },
        get_state()
        {
            return [regs.slice(), mode, selector, available, deadline, reset_seen,
                power_bias, samples, pressed, x, y, reset_at, held_reset];
        },
        set_state(state)
        {
            regs.set(state[0]);
            [, mode, selector, available, deadline, reset_seen, power_bias, samples, pressed, x, y, reset_at, held_reset] = state;
            update();
        },
    };
}
