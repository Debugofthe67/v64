import { N97_MATRIX_CODES } from "./n97_keymap.js";

export const N97_KEYBOARD_ADDRESS = 0x42;
const IRQ_KEY = 1;
const IRQ_ERROR = 8;
const IRQ_NOINIT = 16;
const ERR_PARAMETER = 1;
const ERR_COMMAND = 2;
const ERR_FIFO_OVERRUN = 0x40;
const FIFO_DEPTH = 14;

// Host-visible commands used by the NSC backend of keypad_exp.dll. Register
// defaults, byte order and event encoding follow TI SNLS273A.
const COMMANDS = new Map([
    [0x80, 0], [0x81, 1], [0x82, 0], [0x83, 1], [0x84, 2], [0x85, 2], [0x86, 2],
    [0x87, 0], [0x88, 0], [0x89, 0], [0x8A, 0], [0x8B, 1], [0x8C, 0], [0x8E, 0],
    [0x8F, 1], [0x90, 1], [0x91, 0], [0x92, 0], [0x93, 1], [0x94, 0],
]);

export function create_n97_keyboard(set_irq)
{
    let config, size, active, debounce, clock, pull_down, direction, port;
    let interrupt, error, command, fifo, previous, contacts = new Set(), scanned;
    const irq_update = () => set_irq(!!interrupt);
    function reset()
    {
        config = 0x80;
        size = 0x33;
        active = 125;
        debounce = 3;
        clock = pull_down = direction = port = 0;
        interrupt = IRQ_NOINIT;
        command = error = 0;
        fifo = [];
        previous = [];
        scanned = new Set();
        irq_update();
    }
    function fail(reason)
    {
        interrupt |= IRQ_ERROR;
        error |= reason;
        irq_update();
    }
    function report(code)
    {
        if(fifo.length === FIFO_DEPTH) fail(ERR_FIFO_OVERRUN);
        else
        {
            fifo.push(code);
            interrupt |= IRQ_KEY;
            irq_update();
        }
    }
    function scan()
    {
        if(interrupt & IRQ_NOINIT) return;
        const rows = size >> 4, columns = size & 15;
        const visible = new Set(Array.from(contacts).filter(code => {
            const row = code >> 4, col = code & 15;
            return row < rows && (col === 15 || col <= columns && !contacts.has((row << 4) | 15));
        }));
        for(const code of scanned) if(!visible.has(code)) report(code);
        for(const code of visible) if(!scanned.has(code)) report(code | 0x80);
        scanned = visible;
    }
    function write(bytes)
    {
        const [next, high, low] = bytes;
        const count = COMMANDS.get(next);
        if(count === undefined) { fail(ERR_COMMAND); return; }
        if(bytes.length !== count + 1) { fail(ERR_PARAMETER); return; }
        command = next;
        switch(command)
        {
            case 0x81:
                config = high;
                interrupt &= ~IRQ_NOINIT;
                irq_update();
                scan();
                break;
            case 0x83:
                if(high === 0xAA) reset();
                else fail(ERR_PARAMETER);
                break;
            case 0x84: pull_down = high << 8 | low; break;
            case 0x85: direction = high << 8 | low; break;
            case 0x86: port = high << 8 | low; break;
            case 0x8B: active = high; break;
            case 0x8F:
                if(high && (!active || high <= active)) debounce = high;
                else fail(ERR_PARAMETER);
                break;
            case 0x90:
                if((high >> 4) < 3 || (high >> 4) > 8 || (high & 15) < 3 || (high & 15) > 12) fail(ERR_PARAMETER);
                else { size = high; scan(); }
                break;
            case 0x93: clock = high; break;
        }
    }
    function read(count)
    {
        switch(command)
        {
            case 0x80: return [0, 0]; // Representative NSC identity; no retail revision is claimed.
            case 0x82:
            {
                const value = interrupt;
                if(!(interrupt & IRQ_NOINIT)) interrupt = 0;
                irq_update();
                return [value];
            }
            case 0x87: return [direction >> 8, direction & 255];
            case 0x88:
            {
                const value = port & (direction | ~pull_down);
                return [value >> 8, value & 255];
            }
            case 0x89:
                previous = fifo.splice(0, count);
                return previous.slice();
            case 0x8A: return previous.slice();
            case 0x8C:
            {
                const value = error;
                error = 0;
                return [value];
            }
            case 0x8E: return [0]; // No rotary input is connected to the handset keypad.
            case 0x91: return [size];
            case 0x92: return [config];
            case 0x94: return [clock];
            default: fail(ERR_COMMAND); return [];
        }
    }
    reset();
    return {
        write, read,
        press(code, down)
        {
            if(!N97_MATRIX_CODES.has(code) || typeof down !== "boolean" || contacts.has(code) === down) return;
            if(down) contacts.add(code);
            else contacts.delete(code);
            scan();
        },
        release()
        {
            contacts.clear();
            scan();
        },
        reset() { contacts.clear(); reset(); },
        status()
        {
            return { "configured": !(interrupt & IRQ_NOINIT), "pressed": Array.from(contacts),
                "scanned": Array.from(scanned), "fifo_events": fifo.length, "interrupt": interrupt };
        },
        get_state()
        {
            return [config, size, active, debounce, clock, pull_down, direction, port, interrupt, error,
                command, fifo.slice(), previous.slice(), Array.from(contacts), Array.from(scanned)];
        },
        set_state(state)
        {
            [config, size, active, debounce, clock, pull_down, direction, port, interrupt, error, command] = state;
            fifo = state[11].slice();
            previous = state[12].slice();
            contacts = new Set(state[13]);
            scanned = new Set(state[14]);
            irq_update();
        },
    };
}
