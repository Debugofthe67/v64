import { word } from "./n97_devices.js";
import { N97_TOUCH_WIDTH as PANEL_WIDTH, N97_TOUCH_HEIGHT as PANEL_HEIGHT } from "./n97_touch.js";

// d_display.ldd's DispC uses VA 0xC6024800 (PA 0x20024800).
// The LCD/GFX register layout matches TI SPRUF98Y §15.7.2.2.
export const N97_DISPC_BASE = 0x20024800;
const REVISION = 0x00, SYSCONFIG = 0x10, SYSSTATUS = 0x14, IRQSTATUS = 0x18, IRQENABLE = 0x1C;
const CONTROL = 0x40, CONFIG = 0x44, BG_COLOR = 0x4C, LINE_STATUS = 0x5C, LINE_NUMBER = 0x60;
const TIMING_H = 0x64, TIMING_V = 0x68, POL_FREQ = 0x6C, DIVISOR = 0x70;
const LCD_SIZE = 0x7C, GFX_BA0 = 0x80, GFX_BA1 = 0x84, GFX_POS = 0x88, GFX_SIZE = 0x8C;
const GFX_ATTRIBUTES = 0xA0, GFX_FIFO_THRESHOLD = 0xA4, GFX_FIFO_SIZE = 0xA8;
const GFX_ROW_INC = 0xAC, GFX_PIXEL_INC = 0xB0, GFX_WINDOW_SKIP = 0xB4, GFX_TABLE_BA = 0xB8;
const VID1_FIFO_THRESHOLD = 0xD0, VID2_FIFO_THRESHOLD = 0x160;
const LCD_ENABLE = 1, GO_LCD = 1 << 5, STALL_MODE = 1 << 11;
const FRAMEDONE = 1, VSYNC = 1 << 1, PROGRAMMED_LINE = 1 << 5, GFX_UNDERFLOW = 1 << 6;
const IRQ_MASK = 0x7FFF;
const SYSCONFIG_MASK = 0x331D;
const FRAME_MS = 1000 / 60;
const SHADOW = [CONFIG, BG_COLOR, LINE_NUMBER, TIMING_H, TIMING_V, POL_FREQ, DIVISOR, LCD_SIZE, GFX_BA0, GFX_BA1,
    GFX_POS, GFX_SIZE, GFX_ATTRIBUTES, GFX_FIFO_THRESHOLD, GFX_ROW_INC, GFX_PIXEL_INC, GFX_WINDOW_SKIP, GFX_TABLE_BA,
    VID1_FIFO_THRESHOLD, VID2_FIFO_THRESHOLD];
const PIXEL_BYTES = new Map([[6, 2], [8, 4]]);
const size = word => [1 + (word & 0x7FF), 1 + (word >>> 16 & 0x7FF)];

export function create_n97_dispc(cpu, hub, set_irq, panel)
{
    const regs = new Uint32Array((VID2_FIFO_THRESHOLD + 4) / 4), active = regs.slice();
    const rgba = new Uint8ClampedArray(PANEL_WIDTH * PANEL_HEIGHT * 4);
    const pixels = new Uint32Array(rgba.buffer), next_pixels = new Uint32Array(pixels.length);
    let landscape = false, width = PANEL_HEIGHT, height = PANEL_WIDTH;
    let frame_at = 0, line_signalled = false, draining = false, scan_pending = true, dirty = true, scanouts = 0;
    let wire_pixels = null;
    const get = offset => regs[offset >>> 2];
    const raster_running = () => (get(CONTROL) & (LCD_ENABLE | STALL_MODE)) === LCD_ENABLE;
    const reg = (offset, name, read, write = () => {}) => word(cpu.io, N97_DISPC_BASE + offset, "RAPIDO DISPC " + name, read, write);
    const set = (offset, value) => { regs[offset >>> 2] = value; };
    const update_irq = () => set_irq(!!(get(IRQSTATUS) & get(IRQENABLE)));
    const set_flags = flags => { set(IRQSTATUS, get(IRQSTATUS) | flags); update_irq(); };
    function apply_shadow()
    {
        for(const offset of SHADOW) active[offset >>> 2] = get(offset);
        set(CONTROL, get(CONTROL) & ~GO_LCD);
        scan_pending = true;
    }
    function reset()
    {
        regs.fill(0);
        active.fill(0);
        set(SYSCONFIG, 1);
        for(const address of [GFX_ROW_INC, GFX_PIXEL_INC]) set(address, 1);
        line_signalled = draining = false;
        frame_at = scanouts = 0;
        hub.last_vblank = hub.next_vblank = 0;
        update_irq();
        invalidate();
    }
    function invalidate() { scan_pending = dirty = true; }
    function set_slider(open)
    {
        if(landscape === open) return;
        landscape = open;
        width = open ? PANEL_WIDTH : PANEL_HEIGHT;
        height = open ? PANEL_HEIGHT : PANEL_WIDTH;
        hub.set_size_graphical(width, height, width, height, 32);
        invalidate();
    }
    function line_status()
    {
        if(!raster_running() && !draining) return 0;
        const [, lines] = size(active[LCD_SIZE >>> 2]);
        return Math.max(0, Math.min(lines - 1, Math.floor((cpu.clock.now() - frame_at) / FRAME_MS * lines)));
    }
    // OMAP-compatible DISPC 3.1 and 1 KiB graphics FIFO geometry. The
    // retail code selects its thresholds using REVISION below/at 0x31.
    reg(REVISION, "REVISION", () => 0x31);
    reg(GFX_FIFO_SIZE, "GFX_FIFO_SIZE_STATUS", () => 0x400);
    reg(SYSCONFIG, "SYSCONFIG", () => get(SYSCONFIG), (value, mask) => {
        if(value & mask & 2) reset();
        else set(SYSCONFIG, (get(SYSCONFIG) & ~mask | value & mask) & SYSCONFIG_MASK);
    });
    reg(SYSSTATUS, "SYSSTATUS", () => 1); // A software reset completes synchronously.
    reg(IRQSTATUS, "IRQSTATUS", () => get(IRQSTATUS), (value, mask) => {
        set(IRQSTATUS, get(IRQSTATUS) & ~(value & mask));
        update_irq();
    });
    reg(IRQENABLE, "IRQENABLE", () => get(IRQENABLE), (value, mask) => {
        set(IRQENABLE, (get(IRQENABLE) & ~mask | value & mask) & IRQ_MASK);
        update_irq();
    });
    reg(CONTROL, "CONTROL", () => get(CONTROL), (value, mask) => {
        const was_running = raster_running();
        set(CONTROL, get(CONTROL) & ~mask | value & mask);
        if(was_running === raster_running()) return;
        if(raster_running())
        {
            frame_at = cpu.clock.now();
            hub.last_vblank = frame_at;
            hub.next_vblank = frame_at + FRAME_MS;
            line_signalled = draining = false;
            apply_shadow();
        }
        else
        {
            // The current raster frame can finish after LCDENABLE clears.
            // The separate DIF/stall bus cannot complete a transfer here.
            draining = !(get(CONTROL) & LCD_ENABLE);
            scan_pending = true;
        }
    });
    reg(LINE_STATUS, "LINE_STATUS", line_status);
    for(const offset of SHADOW)
    {
        const writable = offset === GFX_PIXEL_INC ? 0xFFFF : -1;
        reg(offset, "configuration", () => get(offset),
            (value, mask) => set(offset, get(offset) & ~mask | value & mask & writable));
    }

    function fetch_layout()
    {
        const [lcd_width, lcd_height] = size(active[LCD_SIZE >>> 2]);
        const attributes = active[GFX_ATTRIBUTES >>> 2], format = attributes >>> 1 & 15;
        const [plane_width, plane_height] = size(active[GFX_SIZE >>> 2]);
        const position = active[GFX_POS >>> 2], x = position & 0x7FF, y = position >>> 16 & 0x7FF;
        const bytes = attributes & 0x400 ? 0 : PIXEL_BYTES.get(format) || 0;
        const base = active[GFX_BA0 >>> 2];
        // Each signed increment counts from the last byte of its pixel.
        const pixel_inc = active[GFX_PIXEL_INC >>> 2] << 16 >> 16, row_inc = active[GFX_ROW_INC >>> 2] | 0;
        const dx = pixel_inc + bytes - 1, dy = (plane_width - 1) * dx + row_inc + bytes - 1;
        const span_x = (plane_width - 1) * dx, span_y = (plane_height - 1) * dy;
        const low = base + Math.min(0, span_x) + Math.min(0, span_y);
        const high = base + Math.max(0, span_x) + Math.max(0, span_y) + bytes;
        const enabled = !!(attributes & 1) && !(attributes & 0x100); // GFX routed to LCD.
        const offset = enabled && bytes && pixel_inc && row_inc && high <= 0x100000000 ? cpu.ram_offset(low, high - low) : -1;
        return { lcd_width, lcd_height, plane_width, plane_height, format, bytes, x, y, dx, dy, enabled,
            replicate: !!(attributes & 0x20),
            start: offset < 0 ? -1 : offset + base - low };
    }
    function on_vblank()
    {
        if((raster_running() || draining) && panel.expecting_pixels())
        {
            const layout = fetch_layout();
            const { lcd_width, lcd_height } = layout;
            const count = lcd_width * lcd_height;
            if((lcd_width <= PANEL_WIDTH && lcd_height <= PANEL_HEIGHT || lcd_width <= PANEL_HEIGHT && lcd_height <= PANEL_WIDTH) &&
                (!layout.enabled || layout.start >= 0))
            {
                if(!wire_pixels) wire_pixels = new Uint32Array(PANEL_WIDTH * PANEL_HEIGHT);
                draw_raster(wire_pixels, layout, lcd_width, lcd_height);
                panel.receive(wire_pixels, count);
            }
        }
        if(raster_running())
        {
            frame_at = hub.last_vblank;
            line_signalled = false;
            if(get(CONTROL) & GO_LCD) apply_shadow();
            const layout = fetch_layout();
            set_flags(VSYNC | (layout.enabled && layout.bytes && layout.start < 0 ? GFX_UNDERFLOW : 0));
        }
        else if(draining) set_flags(FRAMEDONE);
        draining = false;
        if(!panel.managed()) scan_pending = true;
    }
    function poll_line(now)
    {
        const [, lines] = size(active[LCD_SIZE >>> 2]);
        const line = active[LINE_NUMBER >>> 2] & 0x7FF;
        if(line_signalled || line >= lines) return 100;
        const deadline = frame_at + line * FRAME_MS / lines;
        if(now < deadline) return deadline - now;
        line_signalled = true;
        set_flags(PROGRAMMED_LINE);
        return 100;
    }
    function poll(now)
    {
        if(!raster_running() && !draining) return 100;
        poll_line(now);
        const next = hub.timer(now);
        return raster_running() || draining ? Math.min(next, poll_line(now)) : next;
    }
    function draw_raster(target, layout, view_width, view_height)
    {
        const { lcd_width, lcd_height, plane_width, plane_height, x, y, format, start, dx, dy, replicate } = layout;
        const color = active[BG_COLOR >>> 2];
        target.fill(0xFF000000 | (color & 255) << 16 | color & 0xFF00 | color >>> 16 & 255, 0, view_width * view_height);
        if(start >= 0)
        {
            const mem = cpu.mem8;
            const cols = Math.min(plane_width, lcd_width - x), rows = Math.min(plane_height, lcd_height - y);
            const direct = lcd_width === view_width;
            const native = lcd_width === PANEL_WIDTH;
            const walk_pixel = direct ? 1 : native ? view_width : -view_width;
            for(let row = 0; row < rows; row++)
            {
                const sy = y + row;
                let dest = direct ? sy * view_width + x :
                    native ? x * view_width + PANEL_HEIGHT - 1 - sy : (PANEL_HEIGHT - 1 - x) * view_width + sy;
                for(let col = 0, at = start + row * dy; col < cols; col++, at += dx, dest += walk_pixel)
                {
                    const lo = mem[at], mid = mem[at + 1];
                    if(format === 6)
                    {
                        const b = lo & 31, g = mid << 3 & 56 | lo >>> 5, r = mid >>> 3;
                        const extension = replicate ? (b >>> 2) << 16 | (g >>> 4) << 8 | r >>> 2 : 0;
                        target[dest] = 0xFF000000 | b << 19 | g << 10 | r << 3 | extension;
                    }
                    else target[dest] = 0xFF000000 | lo << 16 | mid << 8 | mem[at + 2];
                }
            }
        }
    }
    function render()
    {
        if(!scan_pending) return;
        scan_pending = false;
        if(panel.managed())
        {
            const gram = panel.frame();
            if(!gram) next_pixels.fill(0xFF000000);
            else if(landscape) next_pixels.set(gram);
            else
            {
                for(let y = 0; y < PANEL_HEIGHT; y++)
                    for(let x = 0; x < PANEL_WIDTH; x++)
                        next_pixels[x * PANEL_HEIGHT + PANEL_HEIGHT - 1 - y] = gram[y * PANEL_WIDTH + x];
            }
        }
        else
        {
            const layout = fetch_layout();
            const { lcd_width, lcd_height } = layout;
            const native = lcd_width === PANEL_WIDTH && lcd_height === PANEL_HEIGHT;
            const portrait = lcd_width === PANEL_HEIGHT && lcd_height === PANEL_WIDTH;
            if((raster_running() || draining) && (native || portrait)) draw_raster(next_pixels, layout, width, height);
            else next_pixels.fill(0xFF000000);
        }
        if(!dirty && next_pixels.every((pixel, index) => pixel === pixels[index])) return;
        dirty = false;
        pixels.set(next_pixels);
        scanouts++;
        hub.update_buffer([{ pixels: { data: rgba, width, height }, screen_x: 0, screen_y: 0,
            buffer_x: 0, buffer_y: 0, buffer_width: width, buffer_height: height }]);
    }
    const source = {
        render, invalidate, on_vblank, reset, set_slider, poll,
        vblank_period: () => FRAME_MS,
        status() {
            const { lcd_width, lcd_height, format } = fetch_layout();
            return { "enabled": !!(get(CONTROL) & LCD_ENABLE), "stall": !!(get(CONTROL) & STALL_MODE),
                "width": lcd_width, "height": lcd_height, "format": format, "frames": scanouts };
        },
        get_state()
        {
            return [regs.slice(), active.slice(), frame_at, draining, hub.last_vblank, hub.next_vblank, scanouts, line_signalled];
        },
        set_state(state)
        {
            regs.set(state[0]);
            active.set(state[1]);
            [, , frame_at, draining, hub.last_vblank, hub.next_vblank, scanouts, line_signalled] = state;
            update_irq();
            invalidate();
        },
    };
    reset();
    hub.add_source(source);
    hub.set_mode(true);
    hub.set_size_graphical(width, height, width, height, 32);
    return source;
}
