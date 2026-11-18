import assert from "node:assert/strict";
import { test } from "node:test";
import { create_n97_gpio_input, create_n97_interrupts, N97_KEYBOARD_IRQ, N97_SLIDER_IRQ } from "../../src/symbian/n97_devices.js";
import { create_n97_i2c, N97_I2C_BASE, N97_I2C_IRQ } from "../../src/symbian/n97_i2c.js";
import { create_n97_keyboard } from "../../src/symbian/n97_keyboard.js";
import { N97_KEY_CODES } from "../../src/symbian/n97_keymap.js";

const ICU = 0x20400000;
const BANK1 = 0x20031D80;
const BANK2 = 0x20031DC0;
const HALL = 1 << 26;
const KEYPAD = 4;
const EMPTY = 0xFFFFFFFF;

function board()
{
    const ports = [];
    const io = {
        register_mmio(base, size, handler)
        {
            assert.ok(!ports.some(port => base < port.base + port.size && port.base < base + size));
            ports.push({ base, size, handler });
        },
    };
    function access(at, width, value)
    {
        const port = ports.find(port => port.base <= at && at + width <= port.base + port.size);
        assert.ok(port, "mapped port at " + at.toString(16));
        return value === undefined ? port.handler.read(at - port.base, width) : port.handler.write(at - port.base, width, value);
    }
    const r = (pa, width = 4) => access(pa, width), w = (pa, value, width = 4) => access(pa, width, value);
    const read = (offset, width = 2) => r(N97_I2C_BASE + offset, width);
    const write = (offset, value, width = 2) => w(N97_I2C_BASE + offset, value, width);
    let cpu_irq, card = false;
    const irq = create_n97_interrupts(io, level => { cpu_irq = level; });
    const gpio = create_n97_gpio_input(io, BANK2, 0x20031D04, 2, true, level => irq.set_keyboard(level));
    const slider = create_n97_gpio_input(io, BANK1, 0x20031CF4, 26, false, level => irq.set_slider(level), () => card ? 0 : 1 << 13);
    const keys = create_n97_keyboard(level => gpio.set_input(!level));
    const i2c = create_n97_i2c(io, keys, level => irq.set_i2c(level));
    function arm(source)
    {
        w(ICU + 4, 1);
        w(ICU + 0x20, source);
        w(ICU + 0x24, 2);
        w(ICU + 0x0C, source);
    }
    function send(bytes, stop = true)
    {
        write(0x2C, 0x42);
        write(0x18, bytes.length);
        write(0x24, stop ? 0x8603 : 0x8601);
        for(let i = 0; i < bytes.length; i += 2)
        {
            assert.ok(read(8) & 16);
            write(0x1C, bytes[i] | ((bytes[i + 1] || 0) << 8));
            write(8, 16);
        }
        assert.ok(read(8) & 4);
        write(8, 4);
    }
    function receive(length)
    {
        write(0x18, length);
        write(0x24, 0x8403);
        const bytes = [];
        for(let i = 0; i < length; i += 2)
        {
            assert.ok(read(8) & 8);
            assert.equal(!!(read(8) & 0x8000), i === length - 1);
            const word = read(0x1C);
            bytes.push(word & 255);
            if(i + 1 < length) bytes.push(word >> 8);
            write(8, 8);
        }
        assert.equal(read(8), 4);
        write(8, 4);
        return bytes;
    }
    function query(command, count)
    {
        send([command], false);
        assert.ok(read(8) & 0x1000);
        return receive(count);
    }
    function start_keyboard()
    {
        send([0x81, 0]);
        send([0x90, 0x59]);
    }
    function contact(key, down) { keys.press(N97_KEY_CODES.get(key), down); }
    return { keys, i2c, gpio, slider, irq, r, w, read, write, query, send, receive, arm, contact, start_keyboard,
        card(inserted) { card = inserted; }, irq_line() { return cpu_irq; } };
}

test("RAPIDO I²C claims IRQ 135, transfers low-byte-first and NACKs an absent slave", () => {
    const { r, w, arm, read, write, query, irq_line } = board();
    assert.deepEqual(query(0x80, 2), [0, 0]);
    arm(N97_I2C_IRQ);
    write(0x04, 0x1F);
    write(0x2C, 0x43);
    write(0x18, 1);
    write(0x24, 0x8603);
    assert.equal(irq_line(), true);
    assert.equal(r(ICU + 8), 135);
    assert.equal(read(8) & 0x101A, 2);
    write(8, 6);
    r(ICU + 0x80);
    assert.equal(irq_line(), false);
    write(0x29, 2, 1);
    write(0x28, 0x34, 1);
    assert.equal(read(0x28), 0x234);
    write(0x14, 0x8082);
    assert.equal(read(0x14), 0x8080);
    assert.equal(read(0x28), 0x234);
    write(0x20, 2);
    assert.equal(read(0x28), 0);
    assert.equal(read(0x10), 1);
    w(ICU + 0x10, 135);
});

test("N2850 reports held modifiers, presses/breaks, controls and the active-low GENIO66 IRQ", () => {
    const { arm, contact, irq_line, keys, query, r, start_keyboard, w } = board();
    assert.equal(r(BANK2 + 8) & KEYPAD, 0, "unconfigured chip holds its IRQ low");
    assert.deepEqual(query(0x82, 1), [16]);
    contact("Q", true);
    contact("Q", false);
    assert.equal(keys.status().fifo_events, 0, "only a configured chip reports keys");
    start_keyboard();
    assert.equal(r(BANK2 + 8) & KEYPAD, KEYPAD);
    arm(N97_KEYBOARD_IRQ);
    w(BANK2 + 0x28, KEYPAD);
    w(BANK2 + 0x38, KEYPAD);
    w(BANK2 + 4, 1);
    w(BANK2 + 0x10, KEYPAD);
    contact("Shift", true);
    contact("Q", true);
    contact("Q", true); // Repeat keeps the contact down.
    contact("Q", false);
    contact("Shift", false);
    assert.equal(irq_line(), true);
    assert.equal(r(ICU + 8), N97_KEYBOARD_IRQ);
    assert.equal(r(BANK2 + 0x18) & r(BANK2 + 0x0C), KEYPAD);
    w(BANK2 + 0x20, KEYPAD);
    r(ICU + 0x80);
    assert.equal(irq_line(), false, "GPIO acknowledges the falling edge while the expander remains low");
    assert.equal(r(BANK2 + 8) & KEYPAD, 0);
    assert.deepEqual(query(0x82, 1), [1]);
    assert.equal(r(BANK2 + 8) & KEYPAD, KEYPAD);
    const events = [0xB1, 0x81, 0x01, 0x31, ...Array(10).fill(0)];
    assert.deepEqual(query(0x89, 14), events);
    assert.deepEqual(query(0x8A, 14), events);
    assert.deepEqual(query(0x89, 14), Array(14).fill(0));

    contact("Q", true);
    contact("CameraFocus", true); // SF switch grounds Q's row.
    contact("CameraShutter", true);
    contact("CameraShutter", false);
    contact("CameraFocus", false);
    contact("Q", false);
    assert.deepEqual(query(0x89, 8), [0x81, 0x01, 0x8F, 0x9F, 0x1F, 0x0F, 0x81, 0x01]);
});

test("Hall IRQ 248 follows the stock rearm sequence without changing microSD detect", () => {
    const { arm, card, r, slider, w, irq_line } = board();
    arm(N97_SLIDER_IRQ);
    w(0x20031CF4, HALL);
    w(BANK1 + 0x28, HALL);
    w(BANK1 + 0x34, HALL); // Closed slider, arm rising.
    w(BANK1 + 4, 1);
    w(BANK1 + 0x10, HALL);
    assert.equal(r(BANK1 + 8), 0x2000);
    slider.set_input(true);
    assert.equal(r(BANK1 + 8), HALL | 0x2000);
    assert.equal(irq_line(), true);
    assert.equal(r(ICU + 8), N97_SLIDER_IRQ);
    assert.equal(r(BANK1 + 0x18) & r(BANK1 + 0x0C), HALL);
    w(BANK1 + 0x20, HALL);
    w(BANK1 + 0x38, HALL); // Open slider, arm falling.
    r(ICU + 0x80);
    assert.equal(r(ICU + 8), EMPTY);
    card(true);
    assert.equal(r(BANK1 + 8), HALL);
    slider.set_input(false);
    assert.equal(r(BANK1 + 8), 0);
    assert.equal(r(ICU + 8), N97_SLIDER_IRQ);
    assert.equal(r(BANK1 + 0x0C), HALL);
});

test("N2850 and an in-flight I²C read survive restored state; reset and FIFO overrun remain observable", () => {
    const a = board();
    a.start_keyboard();
    a.contact("Q", true);
    a.contact("W", true);
    a.contact("W", false);
    a.send([0x89], false);
    a.write(0x18, 4);
    a.write(0x24, 0x8403);
    assert.equal(a.read(0x1C), 0x8281);
    a.slider.set_input(true);
    const b = board();
    for(const key of ["irq", "gpio", "keys", "i2c", "slider"]) b[key].set_state(a[key].get_state());
    assert.equal(b.read(0x1C), 0x02);
    assert.equal(b.read(8), 4);
    assert.equal(b.slider.read_input(), true);
    b.keys.release();
    assert.deepEqual(b.query(0x89, 2), [1, 0]);
    for(let i = 0; i < 16; i++) b.contact("Q", !(i & 1));
    assert.ok(b.query(0x82, 1)[0] & 8);
    assert.deepEqual(b.query(0x8C, 1), [0x40]);
    assert.deepEqual(b.query(0x8C, 1), [0]);
    b.send([0x83, 0xAA]);
    assert.deepEqual(b.query(0x82, 1), [16]);
    assert.deepEqual(b.query(0x91, 1), [0x33]);
});
