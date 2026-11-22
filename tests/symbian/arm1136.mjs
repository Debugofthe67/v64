// Run after building build/v86-arm64.wasm. No stock firmware is required.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { STATE_OFFSETS } from "../../src/arm/state_layout.js";
import { check_machine_options } from "../../src/machine_options.js";
import { SYBORG_DIAGNOSTIC, SYBORG_MACHINE, SYBORG_PROFILE } from "../../src/symbian/syborg_profile.js";
import { V86 } from "../../src/main.js";

const wasm = fileURLToPath(new URL("../../build/v86-arm64.wasm", import.meta.url));
const source = fileURLToPath(new URL("./arm1136.S", import.meta.url));

function run(command, args)
{
    const result = spawnSync(command, args, { encoding: "utf8" });
    assert.equal(result.status, 0, result.error?.message || result.stderr);
    return result.stdout.trim();
}

assert.deepEqual(check_machine_options({ machine_type: SYBORG_MACHINE }), {
    cpu_type: "arm32", cpu_profile: SYBORG_PROFILE.cpu, machine_type: SYBORG_MACHINE,
});
assert.equal(check_machine_options({ machine_type: "s5l8930" }).cpu_profile, "cortex-a8");
assert.equal(check_machine_options({ machine_type: "ranchu", cpu_type: "arm32" }).cpu_profile, "cortex-a15");
assert.throws(() => check_machine_options({ machine_type: SYBORG_MACHINE, cpu_profile: "cortex-a15" }), /takes cpu_profile/);
assert.throws(() => check_machine_options({ machine_type: SYBORG_MACHINE, cpu_cores: 2 }), /one ARM32 core/);

const directory = mkdtempSync(join(tmpdir(), "v86-arm1136-"));
try
{
    const object = join(directory, "guest.o"), binary = join(directory, "guest.bin");
    run(process.env.CLANG || "clang", ["--target=arm-none-eabi", "-mcpu=arm1136jf-s", "-c", "-o", object, source]);
    const sysroot = run("rustc", ["--print", "sysroot"]);
    const host = run("rustc", ["-vV"]).match(/^host: (.*)$/m)[1];
    const lld = process.env.LD_LLD || join(sysroot, "lib", "rustlib", host, "bin", "rust-lld");
    run(lld, ["-flavor", "gnu", "-m", "armelf", "--image-base=0", "-Ttext=0", "--oformat=binary", "-o", binary, object]);
    const emulator = new V86({ machine_type: SYBORG_MACHINE, graphics_adapter: "none", disable_jit: true, autostart: false,
        wasm_path: wasm, log_level: 0, symbian: { [SYBORG_DIAGNOSTIC]: true, rom: { url: binary } } });
    try
    {
        await new Promise((resolve, reject) => {
            emulator.add_listener("emulator-loaded", resolve);
            emulator.add_listener("emulator-error", reject);
        });
        const cpu = emulator.v86.cpu;
        const { a32_set_interrupt_lines, a64_worker_slice } = cpu.wm.exports;
        cpu.write_blob_physical(readFileSync(binary), 0);
        assert.equal(cpu.profile, SYBORG_PROFILE.cpu);
        assert.equal(cpu.ram_offset(0, 4), 0);
        assert.equal(cpu.ram_offset(0x40000000, 4), -1);
        assert.deepEqual([...cpu.mem8.subarray(0, 4)], [...readFileSync(binary).subarray(0, 4)]);
        const result = new DataView(cpu.wasm_memory.buffer, cpu.mem8.byteOffset + 0x800, 172);
        const registers = new DataView(cpu.wasm_memory.buffer, cpu.state_base);
        const value = offset => result.getUint32(offset, true);
        const saved_remap = () => [0, 4, 8, 12].map(offset => registers.getUint32(STATE_OFFSETS.a32_mem_remap + offset, true));
        const step = until => {
            for(let i = 0; i < 250 && !until(); i++) a64_worker_slice(1);
            assert.ok(until(), `probe timed out at ${cpu.read_pc()}`);
        };
        step(() => value(20) === 1);
        a32_set_interrupt_lines(true, false);
        step(() => value(24) === 3);
        a32_set_interrupt_lines(false, false);
        step(() => value(40) !== 0);
        assert.deepEqual(Array.from({ length: 14 }, (_, i) => value(i * 4)),
            [0x4107B362, 0x00050078, 7, 73, 0x1D3, 1, 3, 0x4107B362, 5, 0x01000000, 0xAA, 0x1D992992, 0x44, 0x98]);
        assert.deepEqual([56, 60, 64, 68].map(value), [0x11223344, 0x77, 0x885566AA, 0x11223344]);
        assert.deepEqual([72, 76, 80].map(value), [0x11223344, 1, 0x871]);
        assert.deepEqual([84, 88, 92, 112].map(value), [0x42, 0x80D, 0x300870, 0x11223344]);
        const reset_remap = 0x01C97CC8;
        const remap = [0x01097CC8, 0x00C97CC8, 0x01D97CC8, 0x20000013];
        const encoded = remap.map((word, index) => index === 3 ? word : word ^ reset_remap);
        assert.deepEqual([120, 124, 128, 132].map(value), [reset_remap, reset_remap, reset_remap, 0]);
        assert.deepEqual([136, 140, 144, 148].map(value), remap);
        assert.deepEqual([152, 156, 160, 164, 168].map(value), [0, 0, 4, 0, 9]);
        assert.deepEqual(saved_remap(), encoded);
        const wrong = cpu.get_state(true);
        wrong[4].at(-1)[0] = "other ROM";
        assert.throws(() => cpu.validate_state(wrong), /same Syborg firmware/);
        const old_board = cpu.get_state(true);
        old_board[103][0] = "nokia-n97";
        assert.throws(() => cpu.validate_state(old_board), /snapshot is from a machine with machine_type/);
        const state = await emulator.save_state();
        await emulator.restart("power-on");
        assert.equal(value(40), 0);
        assert.equal(Number(cpu.read_pc()), 0);
        assert.equal(registers.getUint32(STATE_OFFSETS.a32_fpinst2, true), 0);
        assert.deepEqual(saved_remap(), [0, 0, 0, 0]);
        await emulator.restore_state(state);
        assert.equal(value(40), 0xAA);
        assert.equal(registers.getUint32(STATE_OFFSETS.a32_fpinst2, true), 0x98);
        assert.deepEqual(saved_remap(), encoded);
        const pre_remap = cpu.save_core_state().subarray(0, -40);
        cpu.load_core_state(pre_remap);
        assert.deepEqual(saved_remap(), [0, 0, 0, 0]);
        assert.equal(registers.getUint32(STATE_OFFSETS.a32_fpinst2, true), 0x98);
        cpu.load_core_state(pre_remap.subarray(0, -8));
        assert.equal(registers.getUint32(STATE_OFFSETS.a32_fpinst2, true), 0);
        console.log("PASS: ARM1136 identity, VFPv2 context, ARM/Thumb interworking, exceptions, MMU and CP15 remap");
    }
    finally
    {
        await emulator.destroy();
    }
}
finally
{
    rmSync(directory, { recursive: true, force: true });
}
