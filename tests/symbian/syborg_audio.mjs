import assert from "node:assert/strict";
import { test } from "node:test";
import { syborg_audio } from "../../src/symbian/syborg_audio.js";

function fixture()
{
    let now = 0, mmio;
    const mem8 = new Uint8Array(128 * 1024);
    const output = [];
    const audio = syborg_audio({
        clock: { now: () => now }, mem8,
        ram_offset: (addr, size) => addr + size <= mem8.length ? addr : -1,
        io: { register_mmio(addr, size, handler) {
            assert.equal(addr, 0xC000E000);
            mmio = handler;
        } },
    }, { send: (name, data) => output.push([name, data]) });
    function configure(format, rate, channels, size, planar = 0, address = 0)
    {
        for(const [i, value] of [format, rate, channels, address, size].entries()) mmio.write(0x104 + i * 4, 4, value);
        mmio.write(0x138, 4, planar);
        mmio.write(0x100, 4, 1);
    }
    return { audio, mmio, output, configure, mem: new DataView(mem8.buffer), advance: ms => audio.poll(now += ms) };
}

test("Syborg audio converts planar S24 stereo PCM, and consumes a wrapped DSP ring on its clock", () => {
    const { audio, mmio, output, configure, mem, advance } = fixture();
    assert.equal(mmio.read(0, 4), 0xC51D0012);
    configure(5, 48000, 2, 7680, 240);
    assert.equal(mmio.read(0x12C, 4), 1);
    for(let group = 0; group < 4; group++)
    {
        for(let i = 0; i < 480; i++) mem.setInt32(group * 1920 + i * 4, (i < 240 ? 1 : -1) * 0x400000, true);
    }
    assert.equal(audio.data_written(0, 5760), 10);
    assert.equal(advance(9), 1);
    assert.equal(output.length, 0);
    assert.equal(advance(1), 10);
    assert.deepEqual(output.slice(0, 2), [["dac-tell-sampling-rate", 48000], ["dac-enable", undefined]]);
    const [left, right] = output.at(-1)[1];
    assert.ok(left.every(value => value === 0.5));
    assert.ok(right.every(value => value === -0.5));
    assert.equal(mmio.read(0x11C, 4), 3840);
    assert.equal(audio.data_written(0, 1920), 10);
    assert.equal(mmio.read(0x118, 4), 9600);

    const saved = audio.get_state();
    audio.set_state(saved);
    assert.equal(mmio.read(0x11C, 4), 3840);
    assert.equal(advance(20), Infinity);
    assert.equal(mmio.read(0x11C, 4), 9600);
    assert.ok(output.at(-1)[1][0].slice(0, 240).every(value => value === 0.5));
    assert.ok(output.at(-1)[1][0].slice(240).every(value => value === 0));
});

test("Syborg audio rejects invalid DMA and plays mono at its actual sample rate", () => {
    const { audio, mmio, output, configure, mem, advance } = fixture();
    configure(0, 16000, 1, 640, 0, 0x20000);
    assert.equal(mmio.read(0x12C, 4), 8);
    assert.equal(audio.data_written(0, 320), null);
    configure(0, 16000, 1, 640);
    mmio.write(0x124, 4, 128);
    for(let i = 0; i < 160; i++) mem.setInt16(i * 2, i % 2 ? 16384 : -16384, true);
    mmio.write(0x118, 4, 320);
    mmio.write(0x100, 4, 4);
    assert.equal(advance(500), Infinity);
    assert.equal(output.length, 0);
    mmio.write(0x100, 4, 8);
    assert.equal(advance(10), Infinity);
    const [left, right] = output.at(-1)[1];
    assert.deepEqual(Array.from(left.slice(0, 6)), [-0.25, -0.25, -0.25, 0.25, 0.25, 0.25]);
    assert.deepEqual(left, right);
    audio.reset();
    assert.equal(mmio.read(0x12C, 4), 0);
    assert.deepEqual(output.slice(-2), [["dac-reset", undefined], ["dac-disable", undefined]]);
});
