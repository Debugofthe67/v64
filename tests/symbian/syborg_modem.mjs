import assert from "node:assert/strict";
import { test } from "node:test";
import { syborg_modem } from "../../src/symbian/syborg_modem.js";

function fixture(network = false)
{
    let now = 0, resets = 0;
    const mmio = new Map(), levels = new Map();
    const modem = syborg_modem({
        clock: { now: () => now, wall_time: () => Date.UTC(2026, 10, 20, 12, 34, 56) },
        wm: { exports: { "a64_request_reset": () => resets++ } },
        io: { register_mmio(address, size, handler) {
            assert.equal(size, 0x2000);
            mmio.set(address, handler);
        } },
    }, { source: irq => level => levels.set(irq, level) }, network);
    const port = address => {
        const { read, write } = mmio.get(address);
        function send(channel, kind, bytes = [], length = bytes.length)
        {
            bytes.forEach((byte, index) => write(0x1000 + index, 1, byte));
            write(0x04, 4, channel);
            write(0x08, 4, length);
            write(0x0C, 4, kind);
        }
        function take(channel)
        {
            assert.equal(read(0x14, 4), channel);
            assert.equal(read(0x1C, 4), 1);
            const length = read(0x18, 4);
            const bytes = Array.from({ length }, (_, i) => read(0x1800 + i, 1));
            assert.equal(read(0x1800 + length, 1), 0);
            write(0x20, 4, 1);
            return bytes;
        }
        return { read, write, send, take, count: () => read(0x10, 4) };
    };
    return { modem, first: port(0xC0019000), second: port(0xC001B000), levels, resets: () => resets,
        advance: ms => modem.poll(now += ms) };
}

const request = (resource, transaction, id, ...payload) =>
    [0, 0, 0, resource, payload.length + 4, 0, 0, 0, transaction, id, ...payload];

test("Syborg virtual SIM becomes ready and registers on its home network", () => {
    const { first, second } = fixture(true);
    const startup = 0x0123, telephony = 0x0107;
    second.send(startup, 3);
    second.send(startup, 2, [9, 0xEF]);
    second.send(startup, 1, request(9, 1, 0xC0, 0, 0));
    assert.deepEqual(second.take(startup).slice(8), [1, 0xC1, 0, 1, 1, 0, 0, 0]);
    assert.deepEqual(second.take(startup).slice(8), [0, 0xEF, 5, 0x4A]);
    first.send(telephony, 3);
    first.send(telephony, 1, request(9, 2, 0x1D, 0x2D, 0));
    assert.deepEqual(first.take(telephony).slice(8), [2, 0x1E, 0x2D, 1, 8, 0x09, 0x10, 0x10, 0x10, 0x32, 0x54, 0x76, 0x98]);
    first.send(telephony, 1, request(0x0A, 3, 0));
    const registration = first.take(telephony).slice(8);
    assert.deepEqual(registration.slice(0, 8), [3, 1, 0, 2, 0, 8, 0, 2]);
    assert.deepEqual(first.take(telephony).slice(8), [0, 2, ...registration.slice(2)]);
});

test("Syborg acknowledges and defers the reset requested after changing its SIM", () => {
    const { second, advance, resets } = fixture(true);
    second.send(0x0123, 3);
    second.send(0x0123, 1, request(0x15, 1, 6, 7, 0));
    assert.deepEqual(second.take(0x0123).slice(8), [1, 0x69, 0, 0]);
    assert.equal(advance(2999), 1);
    assert.equal(resets(), 0);
    assert.equal(advance(1), Infinity);
    assert.equal(advance(1), Infinity);
    assert.equal(resets(), 1);
});

test("Syborg modem answers offline queries on the requesting port and channel", () => {
    const { first, second, levels } = fixture();
    first.write(0x24, 4, 1);
    second.write(0x24, 4, 1);
    assert.equal(first.read(0, 4), 0xC51D0020);
    assert.equal(second.read(0, 4), 0xC51D0020);
    first.send(0x0107, 3);
    second.send(0x0123, 3);
    second.send(0x0123, 2, [9, 0xEF]);
    second.send(0x0123, 1, request(9, 73, 0xC0, 1, 0));
    assert.deepEqual(second.take(0x0123), [0, 0x6C, 0, 9, 6, 0, 35, 0, 73, 0xC1, 1, 1]);
    assert.deepEqual(second.take(0x0123).slice(8), [0, 0xEF, 5, 6]);
    second.send(0x0123, 1, request(9, 74, 0xC0, 0, 0));
    assert.deepEqual(second.take(0x0123).slice(8), [74, 0xC1, 0, 6, 0, 255, 0, 0]);
    assert.equal(second.count(), 0);
    assert.equal(first.count(), 0);
    first.send(0x0107, 1, request(0xA, 20, 0));
    assert.deepEqual(first.take(0x0107).slice(8), [20, 1, 0, 2, 0, 4, 6, 2, 9, 24, ...Array(22).fill(0)]);
    first.send(0x0107, 1, request(9, 22, 0x29, 0x37));
    assert.deepEqual(first.take(0x0107).slice(8), [22, 0x2A, 0x37, 0x24]);
    first.send(0x0107, 1, request(0x19, 23, 0x0A));
    assert.deepEqual(first.take(0x0107).slice(16, 23), [7, 234, 11, 20, 12, 34, 56]);
    assert.equal(levels.get(15), false);
    assert.equal(levels.get(16), false);
});

test("Syborg modem defers DSP completion and cancels it at close or reset", () => {
    const { first, second, modem, levels, advance } = fixture();
    const send_period = id => first.send(0x0124, 1, request(0xF3, id, 0x34, 0, 0, 0, 0, id, 0));
    first.write(0x24, 4, 1);
    second.write(0x24, 4, 1);
    first.send(0x0124, 3);
    send_period(5);
    send_period(8);
    const state = modem.get_state();
    assert.equal(advance(79), 1);
    assert.equal(first.count(), 0);
    first.send(0x0124, 4);
    first.send(0x0125, 3);
    assert.equal(advance(0), Infinity);
    assert.equal(first.count(), 0);
    modem.set_state(state);
    assert.equal(advance(1), Infinity);
    assert.equal(levels.get(15), true);
    assert.equal(levels.get(16), false);
    assert.equal(first.count(), 2);
    assert.deepEqual(first.take(0x0124).slice(8), [5, 0x35, 0, 0, 0, 0, 5, 0]);
    assert.equal(levels.get(15), true);
    assert.deepEqual(first.take(0x0124).slice(8), [8, 0x35, 0, 0, 0, 0, 8, 0]);
    assert.equal(levels.get(15), false);
    send_period(1);
    modem.reset();
    assert.equal(advance(80), Infinity);
    assert.equal(first.count(), 0);
});

test("Syborg modem bounds queues and ignores invalid frames and offline packet data", () => {
    const { first, advance } = fixture();
    first.send(0, 3);
    first.send(0, 1, request(0x15, 1, 2));
    first.send(0x0107, 3);
    first.send(0x0207, 1, request(0x15, 1, 2));
    first.send(0x0107, 1, request(0x15, 1, 2), 257);
    first.send(0x0107, 1, request(0x15, 1, 2), 9);
    first.send(0x0107, 5, [0x45, 0, 0, 0]);
    assert.equal(first.count(), 0);
    first.write(0x17FF, 4, 0x12345678);
    assert.equal(first.read(0x1800, 4), 0);
    for(let i = 0; i < 100; i++) first.send(0x0107, 1, request(8, i, 1));
    assert.equal(first.count(), 64);
    assert.equal(first.read(0x1800, 4), 0x08006C00);
    first.send(0x0107, 4);
    assert.equal(first.count(), 0);
    first.send(0x0107, 3);
    for(let i = 0; i < 20; i++) first.send(0x0107, 1, request(0xF3, i, 0x34, 0, 0, 0, 0, 0, 0));
    assert.equal(first.count(), 0);
    advance(80);
    assert.equal(first.count(), 16);
});
