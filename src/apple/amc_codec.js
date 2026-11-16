import { AMCAudioDecoder } from "./audio_decode.js";
import { begin_state_io } from "../state_io.js";

const RESULT = 0x18000, DMA_DONE = 1 << 20, PORT = 0x8480002c;
// The MP3 program also starts with a ready interrupt. Its memory windows,
// rather than the entry alone, identify the decoder and its buffer contract.
const MP3_PREFIX = [0x21000004, 0xb623a100, 0x58100000, 0x00080a30];
// AppleAMC-176 also loads its type-0 Layer III program at this entry.
// Its parameter mask and two 0x1200-byte output buffers use the same ABI.
const MP3_TYPE0_PREFIX = [0x01c2006a, 0x080001d7, 0x428007c8, 0x083ed008];
const view = bytes => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

// HLE of the observed 10B329 AAC/MP3 programs, not a DSP instruction emulator.
// The descriptor protocol and local addresses are hardware interfaces;
// unknown programs stay unsupported rather than receiving fake PCM.
export class AMCCodec
{
    constructor(device, dma)
    {
        this.device = device;
        this.cpu = device.cpu;
        this.dma = dma;
        this.generation = 0;
        /** @type {?AMCAudioDecoder} */
        this.decoder = null;
        this.busy = false;
        this.initialized = false;
        this.program = "";
        this.input = 0;
        this.resume = 0;
        this.moves = [];
        this.output = [];
        this.fifo = new Uint8Array(0);
        this.slot = 0;
        this.input_pending = false;
        this.polling = false;
        this.stats = { initialized: 0, mp3_initialized: 0, inputs: 0, decoded_samples: 0, pcm_bytes: 0, failures: 0, errors: [] };
        this.reset();
        device.on_job = (offset, value) => this.write(offset, value);
        dma.ports.set(PORT, () => this.poll());
    }

    reset()
    {
        this.generation++;
        this.decoder?.close();
        this.decoder = null;
        this.busy = false;
        this.initialized = false;
        this.program = "";
        this.input = 0;
        this.resume = 0;
        this.moves = [];
        this.output = [];
        this.fifo = new Uint8Array(0);
        this.slot = 0;
        this.input_pending = false;
        this.polling = false;
    }

    get_state()
    {
        if(this.busy) throw new Error("Stop the AMC audio stream before saving a snapshot");
        const decoder = this.decoder ? this.decoder.get_state() : null;
        return [2, this.initialized, this.program, this.input, this.resume,
            this.moves.map(move => [move.bytes, move.from, move.to]),
            this.output.map(block => block.slice()), this.fifo.slice(), this.slot, this.input_pending, decoder];
    }

    set_state(state)
    {
        this.reset();
        // Legacy snapshots contain no evidence of an issued start command.
        // Do not infer completion merely from code in local memory.
        if(!state) return;
        if(![1, 2].includes(state[0]) || !["", "aac", "mp3"].includes(state[2])) throw new Error("Unsupported AMC codec snapshot");
        this.initialized = state[1];
        this.program = state[2];
        this.input = state[3];
        this.resume = state[4];
        this.moves = state[5].map(move => ({ bytes: move[0], from: move[1], to: move[2] }));
        this.output = state[6].map(block => block.slice());
        this.fifo = state[7].slice();
        this.slot = state[8];
        this.input_pending = state[9];
        // Source bits and the result header belong to the device snapshot;
        // restoring an already acknowledged program cannot raise ready again.
        if(state[0] === 2 && state[10]) this.restore_decoder(state[10]);
    }

    async restore_decoder(state)
    {
        const generation = this.generation;
        const complete = begin_state_io(this.cpu);
        this.busy = true;
        const decoder = this.decoder = new AMCAudioDecoder();
        try { await decoder.restore_state(state); }
        catch(error) { if(generation === this.generation) this.failure(error); }
        finally { if(generation === this.generation) this.busy = false;complete(); }
    }

    failure(error)
    {
        this.stats.failures++;
        if(this.stats.errors.length < 12) this.stats.errors.push(String(error?.message || error));
        this.input = 0;
        this.input_pending = false;
        this.output = [];
        this.moves = [];
        this.resume = 0;
        this.fifo = new Uint8Array(0);
        // The native driver has an explicit codec error word. A failure is
        // not a silent decoded frame and must never reuse stale PCM.
        const m = view(this.device.memory());
        m.setUint16(RESULT + 0x7f28, 1, true);
        m.setUint16(RESULT + 0x7f2a, 100, true);
        this.device.complete(DMA_DONE);
    }

    write(offset, value)
    {
        if(offset === 0x99c)
        {
            this.reset();this.device.pending.fill(0);
            const m = this.device.memory();
            m.fill(0, RESULT, RESULT + 0x12);
            m.fill(0, RESULT + 0x7f28, RESULT + 0x7f2c);
        }
        else if(offset === 0x984)
        {
            const regs = this.device.regs, m = view(this.device.memory());
            if(regs[0x940 >>> 2] === 0x84004600)
            {
                if(regs[0x960 >>> 2] !== 0xc6005c00 || regs[0x964 >>> 2] !== 0x8544602f ||
                    regs[0x968 >>> 2] !== 0xc013f7fb ||
                    ![MP3_PREFIX, MP3_TYPE0_PREFIX].some(prefix =>
                        prefix.every((word, i) => m.getUint32(0x4600 + i * 4, true) === word))) return;
                this.program = "mp3";
                this.stats.mp3_initialized++;
            }
            else if(regs[0x940 >>> 2] === 0x83007020) this.program = "aac";
            else return;
            m.setUint16(RESULT + 2, 2, true);
            m.setUint16(RESULT + 4, this.program === "mp3" ? 2304 : 2048, true);
            this.initialized = true;
            this.stats.initialized++;
            this.device.complete(4); // program initialized its buffer contract
        }
        else if(offset === 0x100) this.input = value;
        else if(offset === 0x110 && value === 0x20) this.device.pending[0] &= ~DMA_DONE;
        else if(offset === 0 && value) this.engine0(value);
    }

    read_link(pointer)
    {
        const local = (pointer & 3) === 2, at = (pointer & ~3) >>> 0;
        if(local)
        {
            if(!this.device.local(at, 12)) throw new Error("AMC input descriptor outside local memory");
            return view(this.device.memory().subarray(at, at + 12));
        }
        if((pointer & 3) !== 1 || this.cpu.ram_offset(at, 12) < 0)
            throw new Error("AMC input descriptor outside DRAM");
        return view(this.cpu.read_blob_physical(at, 12));
    }

    async decode(head)
    {
        const generation = this.generation;
        const complete = begin_state_io(this.cpu);
        this.busy = true;
        this.input_pending = true;
        try
        {
            const parts = [], seen = new Set();
            let total = 0;
            while(head)
            {
                if(seen.has(head) || seen.size >= 64) throw new Error("Cyclic or excessive AMC input descriptors");
                seen.add(head);
                const d = this.read_link(head), count = d.getUint32(4, true) >>> 16, src = d.getUint32(8, true);
                if(!count || !this.device.local(src, count) || count > (1 << 20) - total)
                    throw new Error("Invalid AMC compressed input range");
                parts.push(this.device.memory().slice(src, src + count));total += count;
                head = d.getUint32(0, true);
            }
            if(!total) throw new Error("Empty AMC compressed input");
            const input = new Uint8Array(total);
            let at = 0;
            for(const part of parts) { input.set(part, at);at += part.length; }
            const config = view(this.device.memory());
            let rate, channels, codec;
            if(this.program === "mp3")
            {
                // MPEG-1/2/2.5 Layer III header; the native MP3 parameter
                // block contains only the field mask, not an AAC rate.
                const version = input[1] >>> 3 & 3, index = input[2] >>> 2 & 3;
                if(config.getUint16(RESULT + 0x7f00, true) !== 1 || input[0] !== 255 ||
                    (input[1] & 0xe6) !== 0xe2 || version === 1 || index === 3)
                    throw new Error("Unsupported AMC MP3 stream parameters");
                rate = [44100, 48000, 32000][index] / (version === 3 ? 1 : version === 2 ? 2 : 4);
                channels = input[3] >>> 6 === 3 ? 1 : 2;
                codec = "mp3";
            }
            else
            {
                if(config.getUint16(RESULT + 0x7f00, true) !== 0x1f)
                    throw new Error("Unsupported AMC AAC stream parameters");
                rate = config.getUint16(RESULT + 0x7f04, true) * 65536 + config.getUint16(RESULT + 0x7f06, true);
                channels = input[0] >>> 5 === 1 ? 2 : 1;
                codec = "mp4a.40.2";
            }
            if(!this.decoder) this.decoder = new AMCAudioDecoder();
            const samples = await this.decoder.decode(input, rate, channels, codec);
            if(generation !== this.generation) return;
            this.stats.inputs++;
            this.stats.decoded_samples += samples.length;
            // One linked input batch can contain many AAC access units;
            // the native output ring still retires one decoded frame at a time.
            for(const block of this.decoder.output) this.output.push(block.slice());
        }
        catch(error) { if(generation === this.generation) this.failure(error); }
        finally { if(generation === this.generation) this.busy = false;complete(); }
    }

    engine0(head)
    {
        let job = null;
        const seen = new Set();
        try
        {
            while(head)
            {
                const at = (head & ~3) >>> 0;
                if(seen.has(at) || seen.size >= 1024 || !this.device.local(at, 16))
                    throw new Error("Invalid AMC output command list");
                seen.add(at);
                const m = view(this.device.memory()), next = m.getUint32(at, true), control = m.getUint32(at + 4, true);
                const src = m.getUint32(at + 8, true), dst = m.getUint32(at + 12, true), n = control >>> 16;
                if(!n || n > 64 || n & 3 || !this.device.local(src, n)) throw new Error("Invalid AMC output command source");
                const data = this.device.memory().slice(src, src + n), space = control >>> 2 & 3;
                if(space === 2)
                {
                    if(!dst || dst & 3 || dst > 0x3000 - n) throw new Error("Invalid AMC output register target");
                    const words = view(data);
                    for(let i = 0; i < n; i += 4) this.device.write(dst + i, words.getUint32(i, true));
                }
                else if(space === 1)
                {
                    if(!this.device.local(dst, n)) throw new Error("Invalid AMC output memory target");
                    this.device.memory().set(data, dst);
                }
                else
                {
                    if(dst !== 0x303060) throw new Error("Unsupported AMC transfer unit");
                    if(n === 20)
                    {
                        const w = view(data);
                        job = { bytes: w.getUint32(4, true), from: w.getUint32(8, true), to: w.getUint32(16, true) };
                    }
                    else if(job)
                    {
                        if(!job.bytes || job.bytes > 32768 || !this.device.local(job.from, job.bytes) ||
                            !this.device.local(job.to, job.bytes) || this.moves.length >= 8)
                            throw new Error("Invalid AMC PCM transfer");
                        this.moves.push(job);this.resume = next;return;
                    }
                }
                head = next;
            }
        }
        catch(error) { this.failure(error); }
    }

    poll()
    {
        if(this.polling) return;
        this.polling = true;
        try
        {
            if(this.input && this.initialized && !this.busy && !this.input_pending)
            {
                const head = this.input;this.input = 0;this.device.regs[0x100 >>> 2] = 0;
                this.decode(head);
            }
            if(this.output.length && this.moves.length && !this.fifo.length)
            {
                const move = this.moves[0], samples = this.output[0], wide = move.bytes === samples.length * 4;
                const at = move.from, size = samples.length * (wide ? 4 : 2);
                const m = this.device.memory(), header = view(m);
                if((size !== move.bytes) || at < RESULT + 0x100 || at + size > RESULT + 0x7f00)
                    throw new Error("AMC PCM slot does not match decoded output");
                if(!header.getUint16(RESULT + 0xa + 4 * this.slot, true))
                {
                    const pcm = new Uint8Array(size), v = view(pcm);
                    for(let i = 0; i < samples.length; i++)
                        if(wide) v.setInt32(i * 4, samples[i] * 256, true);
                        else v.setInt16(i * 2, samples[i], true);
                    m.set(pcm, at);
                    header.setUint16(RESULT + 0xa + 4 * this.slot, 1, true);
                    header.setUint16(RESULT + 0xc + 4 * this.slot, samples.length, true);
                    this.slot ^= 1;
                    this.output.shift();this.moves.shift();
                    if(move.to === 0x38000) this.fifo = pcm;
                    else m.set(pcm, move.to);
                    if(this.resume) { const next = this.resume;this.resume = 0;this.engine0(next); }
                }
            }
            if(this.fifo.length)
            {
                for(let n = 1; n < 38 && this.fifo.length; n++)
                {
                    const i = n * 8;
                    if(!(this.dma.channel[i] & 1) || this.dma.channel[i + 2] !== PORT) continue;
                    const before = this.dma.channel[i + 3], bytes = this.fifo.subarray(0, Math.min(before, this.fifo.length));
                    this.dma.transfer(PORT, bytes, true);
                    const used = Math.min(bytes.length, before - this.dma.channel[i + 3]);
                    this.fifo = this.fifo.slice(used);this.stats.pcm_bytes += used;
                }
            }
            if(this.input_pending && !this.busy && !this.output.length && !this.fifo.length)
            {
                this.input_pending = false;this.device.complete(DMA_DONE);
            }
        }
        catch(error) { this.failure(error); }
        finally { this.polling = false; }
    }
}
