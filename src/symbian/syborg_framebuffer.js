import { SYBORG_PROFILE } from "./syborg_profile.js";
import { syborg_registers } from "./syborg_devices.js";

const BASE = 1, HEIGHT = 2, WIDTH = 3, ORIENTATION = 4, BLANK = 5, MASK = 6, CAUSE = 7;
const BPP = 8, PITCH = 12, ENABLED = 13, PARTIAL_START = 14, PARTIAL_END = 15, PARTIAL_MODE = 16;
const FRAME_COUNT = 17, REFRESH_RATE = 18;
const VSYNC = 1, BASE_UPDATE = 2, REFRESH = 60;

export function syborg_framebuffer(cpu, hub, set_irq)
{
    const registers = new Uint32Array(23);
    const palette = new Uint32Array(256);
    let update_base = true;
    let pixels = null;
    let invalid = true;
    const update = () => set_irq(!!(registers[MASK] & registers[CAUSE]));
    function resize()
    {
        const width = registers[WIDTH], height = registers[HEIGHT];
        if(width === 0 || height === 0 || width > 2048 || height > 2048) return;
        if(!pixels || width !== pixels.width || height !== pixels.height)
        {
            pixels = { data: new Uint8ClampedArray(4 * width * height), width, height };
            invalid = true;
            // Switch the presenter into graphics mode before it requests the
            // first frame, including when the CPU lives in a worker.
            hub.set_mode(true);
            hub.set_size_graphical(width, height, width, height, 32);
        }
    }
    function reset()
    {
        registers.fill(0);
        registers[WIDTH] = SYBORG_PROFILE.screen.width;
        registers[HEIGHT] = SYBORG_PROFILE.screen.height;
        palette.fill(0);
        update_base = invalid = true;
        resize();
        update();
    }
    function render()
    {
        if(!pixels || registers[WIDTH] !== pixels.width || registers[HEIGHT] !== pixels.height) return;
        const { width, height } = pixels;
        const rotation = registers[ORIENTATION];
        const picture_width = rotation & 1 ? height : width;
        const picture_height = rotation & 1 ? width : height;
        const pitch = registers[PITCH] || 4 * picture_width;
        const span = (picture_height - 1) * pitch + 4 * picture_width;
        const base = registers[BASE];
        const offset = base && registers[BPP] === 32 && pitch >= 4 * picture_width ? cpu.ram_offset(base, span) : -1;
        const picture = offset < 0 ? null : new DataView(cpu.mem8.buffer, cpu.mem8.byteOffset + offset, span);
        const partial = registers[PARTIAL_MODE];
        const dim = registers[BLANK] || !registers[ENABLED];
        const data = pixels.data;
        let changed = invalid;
        for(let y = 0, dest = 0; y < height; y++)
        {
            for(let x = 0; x < width; x++, dest += 4)
            {
                let px = x, py = y;
                switch(rotation)
                {
                    case 1: px = y; py = picture_height - 1 - x; break;
                    case 2: px = picture_width - 1 - x; py = picture_height - 1 - y; break;
                    case 3: px = picture_width - 1 - y; py = x; break;
                }
                const band = partial & 4 ? py : px;
                let color = picture ? picture.getUint32(py * pitch + 4 * px, true) : 0;
                if(partial & 1)
                {
                    if(band < registers[PARTIAL_START] || band > registers[PARTIAL_END]) color = 0;
                    else if(!(partial & 2)) color = (color & 0x808080) >>> 7;
                    if(!(partial & 2)) color *= 255;
                }
                const red = (color >>> 16 & 255) >> (dim ? 2 : 0);
                const green = (color >>> 8 & 255) >> (dim ? 2 : 0);
                const blue = (color & 255) >> (dim ? 2 : 0);
                if(data[dest] === red && data[dest + 1] === green && data[dest + 2] === blue && data[dest + 3] === 255) continue;
                data[dest] = red;
                data[dest + 1] = green;
                data[dest + 2] = blue;
                data[dest + 3] = 255;
                changed = true;
            }
        }
        if(changed)
        {
            invalid = false;
            hub.update_buffer([{ pixels, screen_x: 0, screen_y: 0, buffer_x: 0, buffer_y: 0, buffer_width: width, buffer_height: height }]);
        }
    }
    syborg_registers(cpu, "Syborg framebuffer", 0xC0005000, index => {
        if(index >= 0x100 && index < 0x200) return palette[index - 0x100];
        if(index === 0) return 0xC51D0006;
        if(index === REFRESH_RATE) return REFRESH;
        return registers[index] || 0;
    }, (index, value) => {
        if(index >= 0x100 && index < 0x200)
        {
            palette[index - 0x100] = value;
            return;
        }
        if(index === FRAME_COUNT || index === REFRESH_RATE || index < BASE || index >= registers.length) return;
        if(index === BASE) update_base = true;
        if(index === ORIENTATION) value &= 3;
        if(index === MASK) value &= 3;
        if(index === CAUSE) value = registers[CAUSE] & ~value;
        if(index === ENABLED) value = Number(!!value);
        if(index === PARTIAL_MODE) value &= 7;
        registers[index] = value;
        if(index === WIDTH || index === HEIGHT) resize();
        update();
    });
    hub.add_source({
        vblank_period: () => 1000 / REFRESH,
        on_vblank()
        {
            registers[FRAME_COUNT]++;
            registers[CAUSE] |= VSYNC | (update_base ? BASE_UPDATE : 0);
            update_base = false;
            update();
        },
        render,
        invalidate() { invalid = true; },
    });
    reset();
    return {
        reset,
        get_state() { return [registers.slice(), palette.slice(), update_base, hub.last_vblank, hub.next_vblank]; },
        set_state([saved, colors, base_pending, last, next])
        {
            registers.set(saved);
            palette.set(colors);
            update_base = base_pending;
            hub.last_vblank = last;
            hub.next_vblank = next;
            invalid = true;
            resize();
            update();
        },
    };
}
