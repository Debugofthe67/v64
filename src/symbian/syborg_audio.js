// PCM ring interface used by qembian's AAMdaifDriver stand-in in the 5800 ROM.
import { syborg_registers } from "./syborg_devices.js";

const ID = 0xC51D0012, BASE = 0xC000E000;
const SLOT_COUNT = 3, SLOT_BASE = 0x100 / 4, SLOT_WORDS = 0x40 / 4;
const OUTPUT_RATE = 48000, PERIOD_MS = 10, PERIOD_FRAMES = OUTPUT_RATE * PERIOD_MS / 1000;
const FORMAT = 1, RATE = 2, CHANNELS = 3, ADDRESS = 4, SIZE = 5;
const GAIN = 9, CLASS = 10, STATUS = 11, PLANAR = 14;
const S16 = 0, S24 = 5, S32 = 6;

function new_slot()
{
    const regs = new Uint32Array(SLOT_WORDS);
    regs[GAIN] = 256;
    return { regs, read: 0, written: 0, phase: 0 };
}

// The stereo streams store groups of N left samples followed by N right
// samples. The counters still advance in bytes per complete stereo frame.
function geometry(regs)
{
    const bytes = regs[FORMAT] === S16 ? 2 : 4;
    const channels = regs[CHANNELS];
    const frame_bytes = channels * bytes;
    return { bytes, frame_bytes, group_bytes: frame_bytes * (regs[PLANAR] || 1) };
}

function sample(view, offset, format)
{
    if(format === S16) return view.getInt16(offset, true) / 0x8000;
    const word = view.getInt32(offset, true);
    return format === S24 ? Math.max(-1, Math.min(1, word / 0x800000)) : word / 0x80000000;
}

export function syborg_audio(cpu, bus)
{
    const slots = Array.from({ length: SLOT_COUNT }, new_slot);
    let deadline = null, master = 256, route = 0, frames = 0, speaker = false;

    function ready(slot)
    {
        const regs = slot.regs;
        if(regs[STATUS] !== 1) return false;
        const { group_bytes } = geometry(regs);
        return slot.written - slot.written % group_bytes > slot.read;
    }

    function mix_slot(slot, left, right)
    {
        const regs = slot.regs;
        const { bytes, frame_bytes, group_bytes } = geometry(regs);
        const size = regs[SIZE];
        const offset = cpu.ram_offset(regs[ADDRESS], size);
        const view = new DataView(cpu.mem8.buffer, cpu.mem8.byteOffset + offset, size);
        const end = slot.written - slot.written % group_bytes;
        const gain = master * regs[GAIN] / 65536;
        for(let i = 0; i < PERIOD_FRAMES && slot.read < end; i++)
        {
            const position = slot.read % size;
            const planar = regs[PLANAR];
            const group = position % group_bytes;
            const first = planar ? position - group + group / 2 : position;
            const a = sample(view, first, regs[FORMAT]);
            const b = regs[CHANNELS] === 1 ? a : sample(view, first + (planar || 1) * bytes, regs[FORMAT]);
            left[i] += a * gain;
            right[i] += b * gain;
            slot.phase += regs[RATE];
            const advance = Math.floor(slot.phase / OUTPUT_RATE) * frame_bytes;
            slot.phase %= OUTPUT_RATE;
            slot.read = Math.min(end, slot.read + advance);
        }
    }

    function poll(now)
    {
        if(!slots.some(ready)) deadline = null;
        if(deadline === null) return Infinity;
        if(now < deadline) return deadline - now;

        // Limit the number of stale packets sent to the speaker if the host
        // was stalled. The guest can have at most one full ring per slot.
        deadline = Math.max(deadline, now - 40);
        while(deadline <= now && slots.some(ready))
        {
            const left = new Float32Array(PERIOD_FRAMES), right = new Float32Array(PERIOD_FRAMES);
            for(const slot of slots) if(ready(slot)) mix_slot(slot, left, right);
            for(let i = 0; i < PERIOD_FRAMES; i++)
            {
                left[i] = Math.max(-1, Math.min(1, left[i]));
                right[i] = Math.max(-1, Math.min(1, right[i]));
            }
            if(!speaker)
            {
                bus.send("dac-tell-sampling-rate", OUTPUT_RATE);
                bus.send("dac-enable");
                speaker = true;
            }
            bus.send("dac-send-data", [left, right], [left.buffer, right.buffer]);
            frames += PERIOD_FRAMES;
            deadline += PERIOD_MS;
        }
        if(!slots.some(ready)) deadline = null;
        return deadline === null ? Infinity : Math.max(0, deadline - now);
    }

    function start(slot)
    {
        const r = slot.regs;
        const { group_bytes } = geometry(r);
        const valid = (r[FORMAT] === S16 || r[FORMAT] === S24 || r[FORMAT] === S32) &&
            r[RATE] >= 8000 && r[RATE] <= 192000 && (r[CHANNELS] === 1 || r[CHANNELS] === 2) &&
            (!r[PLANAR] || r[CHANNELS] === 2) && group_bytes <= 8192 && r[SIZE] >= 16 && r[SIZE] <= 0x20000 &&
            r[SIZE] % group_bytes === 0 && cpu.ram_offset(r[ADDRESS], r[SIZE]) >= 0;
        r[STATUS] = valid ? 1 : 8;
        slot.read = slot.written = slot.phase = 0;
    }

    function publish(slot, advance, now)
    {
        slot.written += advance;
        const { group_bytes } = geometry(slot.regs);
        const oldest = slot.written - slot.regs[SIZE];
        if(oldest > slot.read)
        {
            slot.read = Math.ceil(oldest / group_bytes) * group_bytes;
            slot.phase = 0;
        }
        if(deadline === null && ready(slot)) deadline = now + PERIOD_MS;
    }

    function read(index)
    {
        if(index >= SLOT_BASE)
        {
            const slot = slots[Math.floor((index - SLOT_BASE) / SLOT_WORDS)];
            const reg = (index - SLOT_BASE) % SLOT_WORDS;
            if(!slot) return 0;
            if(reg === 6) return slot.written >>> 0;
            if(reg === 7) return slot.read >>> 0;
            return slot.regs[reg];
        }
        switch(index)
        {
            case 0: return ID;
            case 1: return SLOT_COUNT << 8;
            case 2: return frames >>> 0;
            case 3: return Math.floor(frames / 0x100000000);
            case 4: return master;
            case 5: return route;
            case 8: return SLOT_COUNT - 1;
            default: return 0;
        }
    }

    function write(index, value)
    {
        const now = cpu.clock.now();
        if(index === 4 || index === 5)
        {
            poll(now);
            if(index === 4) master = Math.min(256, value);
            else route = value;
            return;
        }
        if(index < SLOT_BASE) return;
        const slot = slots[Math.floor((index - SLOT_BASE) / SLOT_WORDS)];
        if(!slot) return;
        const reg = (index - SLOT_BASE) % SLOT_WORDS, r = slot.regs;
        switch(reg)
        {
            case 0:
                poll(now);
                if(value & 2) r[STATUS] = 0;
                if(value & 1) start(slot);
                if(value & 4 && r[STATUS] === 1) r[STATUS] = 0x21;
                if(value & 8 && r[STATUS] === 0x21) r[STATUS] = 1;
                if(deadline === null && ready(slot)) deadline = now + PERIOD_MS;
                break;
            case 6:
            {
                if(!(r[STATUS] & 1)) return;
                poll(now);
                const delta = (value - slot.written) >>> 0;
                if(delta <= r[SIZE] - (slot.written - slot.read)) publish(slot, delta, now);
                break;
            }
            case GAIN: poll(now); r[GAIN] = Math.min(256, value); break;
            case CLASS: r[CLASS] = value; break;
            case FORMAT: case RATE: case CHANNELS: case ADDRESS: case SIZE: case PLANAR:
                if(!(r[STATUS] & 1)) r[reg] = value;
                break;
        }
    }

    syborg_registers(cpu, "Syborg PCM audio", BASE, read, write);
    return {
        poll,
        // F3 34 supplies the ring-relative producer position. Reply when
        // playback has freed most of the ring, retaining 25% as a lead.
        data_written(type, position)
        {
            const slot = slots[type];
            if(!slot || slot.regs[STATUS] !== 1) return null;
            const now = cpu.clock.now(), size = slot.regs[SIZE];
            const { frame_bytes } = geometry(slot.regs);
            poll(now);
            const advance = (position % size + size - slot.written % size) % size;
            publish(slot, advance, now);
            const pending = Math.max(0, slot.written - slot.read - size / 4);
            const periods = Math.ceil(pending * 1000 / (frame_bytes * slot.regs[RATE] * PERIOD_MS));
            return periods && deadline !== null ? Math.max(1, deadline - now + (periods - 1) * PERIOD_MS) : PERIOD_MS;
        },
        reset()
        {
            for(let i = 0; i < slots.length; i++) slots[i] = new_slot();
            deadline = null;
            master = 256;
            route = frames = 0;
            if(speaker)
            {
                bus.send("dac-reset");
                bus.send("dac-disable");
                speaker = false;
            }
        },
        get_state()
        {
            return [deadline, master, route, frames, slots.map(({ regs, read, written, phase }) => [regs.slice(), read, written, phase])];
        },
        set_state(state)
        {
            this.reset();
            if(!state) return;
            [deadline, master, route, frames] = state;
            state[4].forEach(([regs, read, written, phase], i) => {
                slots[i].regs.set(regs);
                if(regs[STATUS] & 1) start(slots[i]);
                if(regs[STATUS] === 0x21 && slots[i].regs[STATUS] === 1) slots[i].regs[STATUS] = 0x21;
                Object.assign(slots[i], { read, written, phase });
            });
        },
    };
}
