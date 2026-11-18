import assert from "node:assert/strict";
import { test } from "node:test";
import { create_n97_board_config, create_n97_boot_source, create_n97_clocks, create_n97_interrupts, create_n97_l2, create_n97_os_timer,
    create_n97_rapido_id, create_n97_xti,
    N97_BOOT_SOURCE, N97_CPU_PLL, N97_CPU_PLL_CONTROL, N97_L2_BASE, N97_PLL3, N97_PLL3_CONTROL, N97_PLL_POWER, N97_POWER_INIT, N97_POWER_REQUEST,
    N97_RAPIDO_SELECT, N97_RESET_STATUS, N97_SDRC_POWER, N97_SHARED_CONTROL,
    N97_XTI_CONTROL, N97_XTI_DATA, N97_XTI_DOORBELL } from "../../src/symbian/n97_devices.js";

function bus()
{
    const registers = new Map();
    return {
        has: address => registers.has(address),
        register_mmio(address, size, handler)
        {
            assert.ok(!registers.has(address));
            registers.set(address, { size, handler });
        },
        read(address, width = 4, offset = 0)
        {
            const reg = registers.get(address);
            assert.ok(offset + width <= reg.size);
            return reg.handler.read(offset, width);
        },
        write(address, value, width = 4, offset = 0)
        {
            const reg = registers.get(address);
            assert.ok(offset + width <= reg.size);
            reg.handler.write(offset, width, value);
        },
    };
}

test("the RAPIDO board settings retain guest writes without shadowing adjacent hardware", () => {
    const io = bus(), config = create_n97_board_config(io);
    assert.equal(io.has(0x20031C80), false);
    assert.equal(io.has(0x20031D54), false);
    assert.equal(io.read(0x20031C10), 0);
    io.write(0x20031C10, 0xAAAAAAAA);
    io.write(0x20031C10, 0x55, 1, 1);
    assert.equal(io.read(0x20031C10), 0xAAAA55AA);
    const saved = config.get_state();
    config.reset();
    assert.equal(io.read(0x20031C10), 0);
    config.set_state(saved);
    assert.equal(io.read(0x20031C10), 0xAAAA55AA);
});

test("RAPIDO SDRC power preserves idle self-refresh policy and keeps nearby addresses unmapped", () => {
    const io = bus(), config = create_n97_board_config(io);
    assert.equal(io.has(N97_SDRC_POWER - 4), false);
    assert.equal(io.has(N97_SDRC_POWER + 4), false);
    assert.equal(io.read(N97_SDRC_POWER), 0x85);
    const legacy = config.get_state().slice(0, -1);
    io.write(N97_SDRC_POWER, io.read(N97_SDRC_POWER) | 0x40);
    assert.equal(io.read(N97_SDRC_POWER), 0xC5);
    io.write(N97_SDRC_POWER, 0xFFFF, 2, 2);
    const saved = config.get_state();
    assert.equal(io.read(N97_SDRC_POWER), 0x00FF00C5);
    config.reset();
    assert.equal(io.read(N97_SDRC_POWER), 0x85);
    config.set_state(saved);
    assert.equal(io.read(N97_SDRC_POWER), 0x00FF00C5);
    config.set_state(legacy);
    assert.equal(io.read(N97_SDRC_POWER), 0x85);
});

test("RAPIDO power initialization accepts the stock writes at their exact ports", () => {
    const io = bus(), clocks = create_n97_clocks(io);
    assert.equal(io.has(N97_POWER_REQUEST + 4), false);
    assert.equal(io.has(N97_POWER_INIT + 4), false);
    assert.equal(io.read(N97_POWER_REQUEST), 0);
    const saved = clocks.get_state();
    saved[saved.length - 1] = 0x1800;
    clocks.set_state(saved);
    io.write(N97_POWER_REQUEST + 8, 0x800);
    assert.equal(io.read(N97_POWER_REQUEST), 0x1000);
    assert.throws(() => io.write(N97_POWER_REQUEST + 8, 0x1000), /unsupported/);
    assert.doesNotThrow(() => io.write(N97_POWER_INIT, 0));
    assert.throws(() => io.write(N97_POWER_INIT, 1), /unsupported/);
    assert.throws(() => io.read(N97_POWER_INIT), /unmodeled/);
    clocks.reset();
    assert.equal(io.read(N97_POWER_REQUEST), 0);
});

test("the CPU PLL control follows halfword enable and multiplier without changing ACCPLL", () => {
    const io = bus(), clocks = create_n97_clocks(io);
    const old_state = clocks.get_state().slice(0, -2);
    assert.equal(io.read(N97_CPU_PLL_CONTROL), 0);
    io.write(N97_CPU_PLL_CONTROL, 0xD480, 2);
    assert.equal(io.read(N97_CPU_PLL_CONTROL, 2), 0xD490);
    io.write(N97_CPU_PLL_CONTROL, 0x9480, 2);
    assert.equal(io.read(N97_CPU_PLL_CONTROL, 2), 0x9480);
    io.write(N97_CPU_PLL_CONTROL, 0x9410, 2);
    assert.equal(io.read(N97_CPU_PLL_CONTROL, 2), 0x9400);
    io.write(N97_CPU_PLL_CONTROL, 0xD480, 2);
    const saved = clocks.get_state();
    io.write(N97_CPU_PLL, 0);
    assert.equal(io.read(N97_CPU_PLL_CONTROL, 2), 0xD480);
    assert.equal(io.read(N97_PLL3_CONTROL, 2), 0);
    clocks.set_state(saved);
    assert.equal(io.read(N97_CPU_PLL_CONTROL, 2), 0xD490);
    clocks.set_state(old_state);
    assert.equal(io.read(N97_CPU_PLL_CONTROL, 2), 0);
});

test("the RAPIDO boot source and shared control retain their SET/CLR lanes across reset and restore", () => {
    const io = bus(), boot = create_n97_boot_source(io);
    assert.equal(io.read(N97_BOOT_SOURCE), 0);
    assert.equal(io.read(N97_RESET_STATUS), 0);
    assert.equal(io.has(N97_BOOT_SOURCE + 0x0C), false);
    assert.equal(io.has(N97_RESET_STATUS + 4), false);
    io.write(N97_BOOT_SOURCE, 0xFA0FFF03);
    assert.equal(io.read(N97_BOOT_SOURCE), 3);
    io.write(N97_BOOT_SOURCE + 4, 0xA0, 1, 2);
    io.write(N97_BOOT_SOURCE + 8, 0x20, 1, 2);
    assert.equal(io.read(N97_BOOT_SOURCE), 0x00800003);
    io.write(N97_BOOT_SOURCE, 0x50, 1, 2);
    assert.equal(io.read(N97_BOOT_SOURCE), 0x00500003);
    assert.equal(io.read(N97_BOOT_SOURCE, 1, 2), 0x50);
    io.write(N97_SHARED_CONTROL + 4, 0x3FE);
    io.write(N97_SHARED_CONTROL + 8, 0x1FE);
    assert.equal(io.read(N97_SHARED_CONTROL), 0x200);
    io.write(N97_RESET_STATUS, 0xFFFFFFFF);
    assert.equal(io.read(N97_RESET_STATUS), 0);
    const saved = boot.get_state();
    boot.reset();
    assert.equal(io.read(N97_BOOT_SOURCE), 0);
    assert.equal(io.read(N97_SHARED_CONTROL), 0);
    boot.set_state(saved);
    assert.equal(io.read(N97_BOOT_SOURCE), 0x00500003);
    assert.equal(io.read(N97_SHARED_CONTROL), 0x200);
});

test("the RAPIDO tick counts down, drives only an unmasked IRQ, and resumes an in-flight interval", () => {
    const io = bus(), base = 0x20400000, timer_base = 0x20040180;
    let now = 0, lines;
    const irq = create_n97_interrupts(io, (...levels) => { lines = levels; });
    const timer = create_n97_os_timer(io, { now: () => now }, level => irq.set_timer(level));
    assert.equal(io.has(base + 0x28), false);
    assert.equal(io.has(timer_base + 0x38), false);
    io.write(base + 4, 1);
    io.write(base + 0x20, 35);
    io.write(base + 0x24, 2);
    io.write(timer_base + 4, 1);
    io.write(timer_base + 8, 3);
    io.write(timer_base + 0x24, 9600);
    assert.equal(timer.poll(now), 1);
    now = 0.25;
    assert.equal(io.read(timer_base + 0x44), 7200);
    const armed = timer.get_state();
    now = 1;
    timer.poll(now);
    assert.deepEqual(lines, [false, false]);
    assert.equal(io.read(base + 8), 0xFFFFFFFF);
    io.write(base + 0xC, 35);
    assert.deepEqual(lines, [true, false]);
    assert.equal(io.read(base + 8), 35);
    assert.deepEqual(lines, [false, false]);
    assert.equal(io.read(timer_base + 0x44), 0);
    io.write(timer_base + 0x44, 9600);
    assert.equal(io.read(base + 0x80), 0);
    assert.equal(io.read(base + 8), 0xFFFFFFFF);
    const unmasked = irq.get_state();
    irq.reset();
    timer.reset();
    now = 0.5;
    irq.set_state(unmasked);
    timer.set_state(armed);
    assert.equal(io.read(timer_base + 0x44), 4800);
    now = 1;
    assert.equal(timer.poll(now), 0);
    assert.deepEqual(lines, [true, false]);
    io.write(base + 0x10, 35);
    assert.deepEqual(lines, [false, false]);
    assert.equal(io.read(base + 8), 0xFFFFFFFF);
});

test("RAPIDO identity follows the documented firmware selector and retains reset state", () => {
    const io = bus(), id = create_n97_rapido_id(io);
    assert.equal(io.read(N97_RAPIDO_SELECT), 0);
    io.write(N97_RAPIDO_SELECT, 0xA, 1);
    assert.equal(io.read(N97_RAPIDO_SELECT), 0x0003110A);
    assert.equal(io.read(N97_RAPIDO_SELECT, 2, 2), 3);
    const selected = id.get_state();
    io.write(N97_RAPIDO_SELECT, 3);
    assert.equal(io.read(N97_RAPIDO_SELECT), 3);
    id.reset();
    assert.equal(io.read(N97_RAPIDO_SELECT), 0);
    id.set_state(selected);
    assert.equal(io.read(N97_RAPIDO_SELECT), 0x0003110A);
});

test("L2x0 control, geometry, byte lanes, maintenance completion and restored state", () => {
    const io = bus(), l2 = create_n97_l2(io);
    const control = N97_L2_BASE + 0x100, aux = N97_L2_BASE + 0x104, debug = N97_L2_BASE + 0xF40;
    assert.equal(io.read(aux), 0x30000);
    io.write(aux, 5, 1);
    io.write(control, 1);
    io.write(aux, 6, 1);
    assert.equal(io.read(aux), 0x30005);
    io.write(debug, 0xFF);
    assert.equal(io.read(debug), 3);
    const invalidate = N97_L2_BASE + 0x77C;
    io.write(invalidate, 0xFF);
    assert.equal(io.read(invalidate), 0);
    const saved = l2.get_state();
    l2.reset();
    assert.equal(io.read(control), 0);
    assert.equal(io.read(aux), 0x30000);
    assert.equal(io.read(debug), 0);
    l2.set_state(saved);
    assert.equal(io.read(control), 1);
    assert.equal(io.read(aux), 0x30005);
    assert.equal(io.read(debug), 3);
});

test("RAPIDO PLL lock follows the programmed multiplier, enable and power bits", () => {
    const io = bus(), clocks = create_n97_clocks(io);
    assert.deepEqual(clocks.status(), { configured_cpu_hz: 433920000, pll3_locked: false });
    assert.equal(io.read(N97_CPU_PLL), 0xE29);
    io.write(N97_PLL3_CONTROL, 0xD490);
    assert.equal(io.read(N97_PLL3_CONTROL), 0xD480);
    io.write(N97_PLL3, 5 << 5);
    assert.equal(io.read(N97_PLL3_CONTROL), 0xD480);
    io.write(N97_PLL_POWER, 0x4000);
    assert.equal(io.read(N97_PLL3_CONTROL), 0xD490);
    assert.equal(clocks.status().pll3_locked, true);
    io.write(N97_PLL_POWER, 0x80, 1, 1); // ISASW sets bit 15 after the AP enabled bit 14.
    assert.equal(io.read(N97_PLL_POWER - 4), 0xC000);
    assert.equal(io.read(N97_PLL3_CONTROL), 0xD490);
    io.write(N97_PLL_POWER + 4, 0x8000);
    assert.equal(io.read(N97_PLL_POWER - 4), 0x4000);
    io.write(0x20032CA8, 0x3000);
    io.write(0x20032C44, 0x18);
    const saved = clocks.get_state();
    io.write(N97_PLL_POWER + 4, 0x4000);
    assert.equal(io.read(N97_PLL3_CONTROL), 0xD480);
    io.write(N97_PLL3_CONTROL, 0x9480);
    assert.equal(io.read(N97_PLL3_CONTROL), 0x9480);
    clocks.reset();
    assert.equal(io.read(N97_PLL3), 0);
    clocks.set_state(saved);
    assert.equal(io.read(N97_PLL3_CONTROL), 0xD490);
    assert.equal(io.read(0x20032CA8), 0x3000);
    assert.equal(io.read(0x20032C44), 0x18);
    clocks.set_state(saved.slice(0, 10));
    assert.equal(io.read(N97_PLL3_CONTROL), 0xD490);
    assert.equal(io.read(0x20032CA8), 0);
    assert.equal(io.read(0x20032C44), 0);
});

test("original XTI channel bytes commit the corresponding packet across a save/restore", () => {
    const io = bus(), xti = create_n97_xti(io);
    io.write(N97_XTI_CONTROL + 8, 0x1234);
    io.write(N97_XTI_DATA, 0xC0, 1);
    io.write(N97_XTI_DATA, 0x41, 1);
    const pending = xti.get_state();
    io.write(N97_XTI_DATA + 0x2000, 0xC0, 1);
    io.write(N97_XTI_DATA + 0x2000, 0x42, 1);
    io.write(N97_XTI_DOORBELL, 0xE2, 1);
    assert.deepEqual(xti.packets(), [{ channel: 0xE2, data: "ÀB" }]);
    io.write(N97_XTI_DOORBELL, 0xE0, 1);
    assert.deepEqual(xti.packets().at(-1), { channel: 0xE0, data: "ÀA" });
    xti.reset();
    assert.deepEqual(xti.packets(), []);
    assert.equal(io.read(N97_XTI_CONTROL + 8), 0);
    xti.set_state(pending);
    assert.equal(io.read(N97_XTI_CONTROL + 8), 0x1234);
    io.write(N97_XTI_DATA, 0, 1);
    io.write(N97_XTI_DOORBELL, 0xE0, 1);
    assert.deepEqual(xti.packets(), [{ channel: 0xE0, data: "ÀA\0" }]);
});
