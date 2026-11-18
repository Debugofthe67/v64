import assert from "node:assert/strict";
import { test } from "node:test";
import { create_n97_clocks, create_n97_l2, create_n97_rapido_id, create_n97_xti,
    N97_CPU_PLL, N97_L2_BASE, N97_PLL3, N97_PLL3_CONTROL, N97_PLL_POWER, N97_RAPIDO_SELECT,
    N97_XTI_CONTROL, N97_XTI_DATA, N97_XTI_DOORBELL } from "../../src/symbian/n97_devices.js";

function bus()
{
    const registers = new Map();
    return {
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
    const saved = clocks.get_state();
    io.write(N97_PLL3_CONTROL, 0x9480);
    assert.equal(io.read(N97_PLL3_CONTROL), 0x9480);
    clocks.reset();
    assert.equal(io.read(N97_PLL3), 0);
    clocks.set_state(saved);
    assert.equal(io.read(N97_PLL3_CONTROL), 0xD490);
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
