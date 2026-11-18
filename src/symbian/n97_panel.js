import { N97_TOUCH_WIDTH as WIDTH, N97_TOUCH_HEIGHT as HEIGHT } from "./n97_touch.js";

const BLACK = 0xFF000000;
const SLEEP_EXIT_MS = 5; // DCS 1.2 stabilization interval after exit_sleep_mode
const PARAMETER_COUNT = new Map([[0x36, 1], [0x3A, 1]]);

// Nokia L3/4 Figure 76: CS0 controls the UPD809400 display buffer and CS1
// the downstream TFT. ViSSI supplies pixels to CS0; the TFT receives CDP.
export function create_n97_panel(changed)
{
    let gram = null, managed = false, pixel_count = 0;
    let targets;
    function new_target()
    {
        return { sleeping: true, wake_at: null, on: false, address_mode: 0, format: 0,
            columns: [0, WIDTH - 1], pages: [0, HEIGHT - 1], command: -1, params: [], cursor: 0 };
    }
    function reset()
    {
        gram = null;
        managed = false;
        pixel_count = 0;
        targets = [new_target(), new_target()];
        changed();
    }
    function write_command(cs, command, now)
    {
        const target = targets[cs];
        target.command = command;
        target.params = [];
        switch(command)
        {
            case 0x01: // DCS soft reset keeps the frame memory
                targets[cs] = new_target();
                break;
            case 0x10: target.sleeping = true; target.wake_at = null; break;
            case 0x11:
                if(target.sleeping) target.wake_at = now + SLEEP_EXIT_MS;
                break;
            case 0x28: target.on = false; break;
            case 0x29: target.on = true; break;
            case 0x2C: target.cursor = 0; break;
        }
        // Keep the raw raster path for diagnostics and snapshots predating
        // the panel. When the guest programs either target, use the panel.
        const first_command = !managed;
        managed = true;
        if(first_command || command === 0x01 || command === 0x10 || command === 0x28 || command === 0x29) changed();
    }
    function write_data(cs, byte)
    {
        const target = targets[cs];
        const column = target.command === 0x2A;
        const window = column || target.command === 0x2B;
        // The buffer takes two 24-bit endpoints. The TFT uses DCS 16-bit
        // endpoints. See d_display.ldd 0x80138E5C vs. 0x8013FDBC.
        const bytes = cs === 0 ? 3 : 2;
        const count = window ? bytes * 2 : PARAMETER_COUNT.get(target.command);
        if(!count || target.params.length >= count) return;
        target.params.push(byte);
        if(target.params.length !== count) return;
        if(window)
        {
            const endpoint = index => target.params.slice(index, index + bytes).reduce((n, b) => n * 256 + b, 0);
            const start = endpoint(0), end = endpoint(bytes);
            const limit = (column !== !!(target.address_mode & 0x20) ? WIDTH : HEIGHT) - 1;
            if(start <= end && end <= limit)
            {
                if(column) target.columns = [start, end];
                else target.pages = [start, end];
            }
        }
        else if(target.command === 0x36) target.address_mode = byte;
        else target.format = byte;
    }
    function read(cs, command, now)
    {
        poll(now);
        const target = targets[cs];
        if(command === 0x0A) return (target.sleeping ? 0 : 0x10) | (target.on ? 4 : 0) | 8;
        if(command === 0x0B) return target.address_mode;
        if(command === 0x0C) return target.format;
        // Vendor replies (including 5A/5B) have no identified source here.
        return 0xFF;
    }
    function poll(now)
    {
        let delay = 100;
        for(const target of targets)
        {
            if(target.wake_at === null) continue;
            if(now < target.wake_at) delay = Math.min(delay, target.wake_at - now);
            else
            {
                target.sleeping = false;
                target.wake_at = null;
                changed();
            }
        }
        return delay;
    }
    function expecting_pixels()
    {
        const target = targets[0];
        const count = (target.columns[1] - target.columns[0] + 1) * (target.pages[1] - target.pages[0] + 1);
        return !target.sleeping && (target.format & 0x70) === 0x70 &&
            (target.command === 0x2C || target.command === 0x3C) && target.cursor < count;
    }
    function receive(pixels, count)
    {
        if(!expecting_pixels()) return 0;
        const target = targets[0], mode = target.address_mode;
        const [x0, x1] = target.columns, [y0, y1] = target.pages;
        const width = x1 - x0 + 1, height = y1 - y0 + 1;
        const copied = Math.min(count, width * height - target.cursor);
        // Addresses are hard-bounded again when an address-mode change swaps
        // the axes of an already programmed window.
        if((mode & 0x20 ? x1 >= HEIGHT || y1 >= WIDTH : x1 >= WIDTH || y1 >= HEIGHT) || !copied) return 0;
        if(!gram) gram = new Uint32Array(WIDTH * HEIGHT).fill(BLACK);
        for(let i = 0; i < copied; i++)
        {
            const col = target.cursor % width, row = Math.floor(target.cursor / width);
            target.cursor++;
            const x = mode & 0x40 ? x1 - col : x0 + col;
            const y = mode & 0x80 ? y1 - row : y0 + row;
            const color = pixels[i];
            gram[mode & 0x20 ? x * WIDTH + y : y * WIDTH + x] = mode & 8 ?
                (color & 0xFF00FF00) | (color >>> 16 & 255) | (color & 255) << 16 : color;
        }
        pixel_count += copied;
        changed();
        return copied;
    }
    function visible()
    {
        return managed && !targets[0].sleeping && !targets[1].sleeping && targets[1].on;
    }
    reset();
    return {
        reset, poll, write_command, write_data, read, expecting_pixels, receive,
        managed: () => managed,
        frame: () => visible() ? gram : null,
        status()
        {
            return { "managed": managed, "display_on": targets[1].on, "sleeping": targets[1].sleeping, "buffer_sleeping": targets[0].sleeping,
                "visible": visible(), "columns": targets[0].columns.slice(), "pages": targets[0].pages.slice(),
                "pixel_format": targets[0].format, "lcd_pixel_format": targets[1].format,
                "pixels_received": pixel_count };
        },
        get_state()
        {
            return [managed, pixel_count, gram?.slice() || null, targets.map(t =>
                [t.sleeping, t.wake_at, t.on, t.address_mode, t.format, t.columns.slice(), t.pages.slice(),
                    t.command, t.params.slice(), t.cursor])];
        },
        set_state(state)
        {
            [managed, pixel_count] = state;
            gram = state[2]?.slice() || null;
            targets = state[3].map(([sleeping, wake_at, on, address_mode, format, columns, pages, command, params, cursor]) =>
                ({ sleeping, wake_at, on, address_mode, format, columns: columns.slice(), pages: pages.slice(), command,
                    params: params.slice(), cursor }));
            changed();
        },
    };
}
