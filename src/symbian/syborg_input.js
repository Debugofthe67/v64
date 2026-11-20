import { SYBORG_PROFILE } from "./syborg_profile.js";
import { syborg_registers } from "./syborg_devices.js";

const { width, height } = SYBORG_PROFILE.screen;
export const syborg_touch = (x, y, down) => Number.isInteger(x) && x >= 0 && x < width &&
    Number.isInteger(y) && y >= 0 && y < height && typeof down === "boolean";
export const syborg_key = (code, down) => Number.isInteger(code) && code >= 0 && code <= 0xFF && typeof down === "boolean";

export function syborg_keyboard(cpu, bus, set_irq)
{
    const capacity = 16;
    let fifo = [], enabled = false;
    let extended = false;
    const held = new Set();
    const update = () => set_irq(enabled && fifo.length !== 0);
    function key(code, down, translated)
    {
        const value = code | (translated ? 0x40000000 : 0);
        if(down === held.has(value)) return;
        if(fifo.length === capacity && down) return;
        if(fifo.length === capacity) fifo.shift();
        if(down) held.add(value);
        else held.delete(value);
        fifo.push((value | (down ? 0 : 0x80000000)) >>> 0);
        update();
    }
    bus.register("symbian-key", ([code, down]) => {
        if(syborg_key(code, down)) key(code, down, true);
    });
    bus.register("keyboard-code", code => {
        // The keyboard adapter sends the 0xE0 prefix as a separate byte.
        if(code === 0xE0) { extended = true; return; }
        key(code & 0x7F | (extended ? 0x80 : 0), (code & 0x80) === 0, false);
        extended = false;
    });
    syborg_registers(cpu, "Syborg keyboard", 0xC0003000, index => {
        switch(index)
        {
            case 0: return 0xC51D0002;
            case 1: {
                const value = fifo.shift();
                update();
                return value === undefined ? 0xFFFFFFFF : value;
            }
            case 2: return fifo.length;
            case 3: return Number(enabled);
            case 4: return capacity;
            default: return 0;
        }
    }, (index, value) => {
        if(index === 3) { enabled = !!value; update(); }
    });
    return {
        reset() { held.clear(); fifo.length = 0; enabled = extended = false; update(); },
        get_state() { return [fifo.slice(), enabled, Array.from(held), extended]; },
        set_state([saved, mask, pressed, prefix])
        {
            fifo = saved.slice();
            enabled = mask;
            extended = prefix;
            held.clear();
            for(const value of pressed) held.add(value);
            update();
        },
    };
}

const MOVE = 4;
const COALESCED = 8;
export function syborg_pointer(cpu, bus, set_irq)
{
    const capacity = 256;
    let fifo = [], current = [], enabled = false, down = false, x = 0, y = 0;
    let dropped = 0, coalesced = 0;
    const update = () => set_irq(enabled && fifo.length !== 0);
    bus.register("symbian-touch", ([next_x, next_y, pressed]) => {
        if(!syborg_touch(next_x, next_y, pressed) || !down && !pressed ||
            pressed === down && next_x === x && next_y === y) return;
        x = next_x;
        y = next_y;
        const event = [Math.round(x * 0x7FFF / (width - 1)), Math.round(y * 0x7FFF / (height - 1)),
            Number(pressed), pressed === down ? MOVE : pressed ? 1 : 2, Math.floor(cpu.clock.now() * 1000)];
        down = pressed;
        if(event[3] === MOVE && fifo.length >= capacity - 4 && fifo.at(-1)?.[3] & MOVE)
        {
            event[3] |= COALESCED;
            fifo[fifo.length - 1] = event;
            coalesced++;
        }
        else if(fifo.length < capacity) fifo.push(event);
        else
        {
            dropped++;
            if(event[3] !== MOVE)
            {
                const move = fifo.findIndex(item => item[3] & MOVE);
                fifo.splice(Math.max(0, move), 1);
                fifo.push(event);
            }
        }
        update();
    });
    syborg_registers(cpu, "Syborg pointer", 0xC0004000, index => {
        switch(index)
        {
            case 0: return 0xC51D0006;
            case 2: return fifo.length;
            case 3: return current[0] || 0;
            case 4: return current[1] || 0;
            case 6: return current[2] || 0;
            case 7: return Number(enabled);
            case 8: return capacity;
            case 9: return 2;
            case 10: return 0x103;
            case 12: return current[4] >>> 0;
            case 13: return Math.floor((current[4] || 0) / 0x100000000);
            case 14: return current[3] || 0;
            case 15: return (dropped & 0xFFFF) | coalesced << 16;
            default: return 0;
        }
    }, (index, value) => {
        if(index === 1 && fifo.length) current = fifo.shift();
        if(index === 7) enabled = !!value;
        update();
    });
    return {
        reset()
        {
            x = y = dropped = coalesced = 0;
            enabled = down = false;
            fifo.length = current.length = 0;
            update();
        },
        get_state() { return [fifo.map(event => event.slice()), current.slice(), enabled, down, x, y, dropped, coalesced]; },
        set_state(state)
        {
            [, , enabled, down, x, y, dropped, coalesced] = state;
            fifo = state[0].map(event => event.slice());
            current = state[1].slice();
            update();
        },
    };
}
