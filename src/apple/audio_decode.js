// Bounded host decoding for AMC compressed-input jobs. The device still
// owns its DMA, buffer layout and completion interrupts; this only returns
// real interleaved PCM from WebCodecs (also available in a CPU Worker).
export class AMCAudioDecoder
{
    constructor()
    {
        this.decoder = null;
        this.key = "";
        this.timestamp = 0;
        this.busy = false;
        this.output = [];
        this.failure = null;
        this.pending = null;
    }

    close()
    {
        this.pending?.reject(new Error("AMC audio decoder closed"));
        this.pending = null;
        if(this.decoder && this.decoder["state"] !== "closed") this.decoder["close"]();
        this.decoder = null;
        this.key = "";
        this.output = [];
    }

    async decode(data, rate, channels, codec = "mp4a.40.2")
    {
        if(this.busy || !(data instanceof Uint8Array) || !data.length || data.length > 1 << 20 ||
            ![1, 2].includes(channels) || !Number.isInteger(rate) || rate < 7350 || rate > 96000)
            throw new Error("Invalid or overlapping AMC audio input");
        const Decoder = globalThis["AudioDecoder"], Chunk = globalThis["EncodedAudioChunk"];
        if(!Decoder || !Chunk) throw new Error("This browser has no compressed audio decoder");
        this.busy = true;
        try
        {
            const key = codec + ":" + rate + ":" + channels;
            if(key !== this.key)
            {
                this.close();
                const config = { "codec": codec, "sampleRate": rate, "numberOfChannels": channels };
                if(codec === "mp4a.40.2")
                {
                    const rates = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];
                    const index = rates.indexOf(rate);
                    if(index < 0) throw new Error("Unsupported AMC AAC rate");
                    config["description"] = new Uint8Array([0x10 | index >> 1, (index & 1) << 7 | channels << 3]);
                }
                const support = await Decoder["isConfigSupported"](config);
                if(!support["supported"]) throw new Error("Unsupported AMC audio codec");
                this.decoder = new Decoder({
                    "output": frame => {
                        try
                        {
                            const n = frame["numberOfFrames"], count = frame["numberOfChannels"];
                            if(n > 8192 || count !== channels || frame["sampleRate"] !== rate || this.output.length >= 64)
                                throw new Error("AMC decoded format or output limit mismatch");
                            const pcm = new Int16Array(n * count), plane = new Float32Array(n);
                            for(let ch = 0; ch < count; ch++)
                            {
                                frame["copyTo"](plane, { "planeIndex": ch, "format": "f32-planar" });
                                for(let i = 0; i < n; i++) pcm[i * count + ch] = Math.max(-32768, Math.min(32767, Math.round(plane[i] * 32768)));
                            }
                            this.output.push(pcm);
                            if(this.output.length === this.pending?.frames) this.pending.resolve();
                        }
                        catch(error) { this.failure = error;this.pending?.reject(error); }
                        finally { frame["close"](); }
                    },
                    "error": error => { this.failure = error;this.pending?.reject(error); },
                });
                this.decoder["configure"](config);
                this.key = key;
            }
            this.output = [];
            this.failure = null;
            const packets = codec === "mp3" ? mp3_packets(data, rate, channels) : [data];
            if(codec === "mp3")
            {
                // flush() drains and resets Chromium's MP3 bit reservoir.
                // Each complete MPEG packet emits one AudioData, so wait for
                // those outputs while keeping the live decoder's history.
                let timer;
                try
                {
                    await new Promise((resolve, reject) => {
                        this.pending = { frames: packets.length, resolve, reject };
                        timer = setTimeout(() => reject(new Error("AMC MP3 output timed out")), 10000);
                        for(const packet of packets)
                            this.decoder["decode"](new Chunk({ "type": "key", "timestamp": this.timestamp++, "data": packet }));
                    });
                }
                finally { clearTimeout(timer);this.pending = null; }
            }
            else
            {
                this.decoder["decode"](new Chunk({ "type": "key", "timestamp": this.timestamp++, "data": data }));
                await this.decoder["flush"]();
            }
            if(this.failure) throw this.failure;
            const size = this.output.reduce((sum, pcm) => sum + pcm.length, 0);
            if(!size || size > 1 << 19) throw new Error("AMC decoder produced no bounded PCM output");
            const samples = new Int16Array(size);
            let at = 0;
            for(const pcm of this.output) { samples.set(pcm, at); at += pcm.length; }
            return samples;
        }
        finally { this.busy = false; }
    }
}

// WebCodecs takes one MPEG audio frame per chunk. A native AMC input DMA
// contains a batch of complete packets, including Layer III's bit reservoir.
function mp3_packets(data, rate, channels)
{
    const packets = [];
    for(let at = 0; at < data.length;)
    {
        if(at + 4 > data.length) throw new Error("Truncated AMC MP3 header");
        const a = data[at + 1], b = data[at + 2], version = a >>> 3 & 3, index = b >>> 2 & 3;
        const bitrates = version === 3 ? [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320] :
            [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
        const bitrate = bitrates[b >>> 4];
        if(data[at] !== 255 || (a & 0xe6) !== 0xe2 || version === 1 || index === 3 || !bitrate ||
            [44100, 48000, 32000][index] / (version === 3 ? 1 : version === 2 ? 2 : 4) !== rate ||
            (data[at + 3] >>> 6 === 3 ? 1 : 2) !== channels)
            throw new Error("Invalid or changing AMC MP3 frame format");
        const size = Math.floor((version === 3 ? 144000 : 72000) * bitrate / rate) + (b >>> 1 & 1);
        if(size > data.length - at) throw new Error("Truncated AMC MP3 frame");
        packets.push(data.subarray(at, at + size));
        if(packets.length > 64) throw new Error("Excessive AMC MP3 packet batch");
        at += size;
    }
    return packets;
}
