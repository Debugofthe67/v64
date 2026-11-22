// Open checks through the normal V86 constructor and ARM Wasm run loop.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { V86 } from "../../src/main.js";
import { check_machine_options } from "../../src/machine_options.js";
import { SYBORG_DIAGNOSTIC, SYBORG_MACHINE } from "../../src/symbian/syborg_profile.js";

const wasm_path = fileURLToPath(new URL("../../build/v86-arm64.wasm", import.meta.url));
const source = fileURLToPath(new URL("./syborg_board.S", import.meta.url));
const [open_rom, open_dtb] = process.argv.slice(2);
assert.equal(!!open_rom, !!open_dtb, "Pass both the built qembian diagnostic ROM and its DTB");

function run(command, args)
{
    const result = spawnSync(command, args, { encoding: "utf8" });
    assert.equal(result.status, 0, result.error?.message || result.stderr);
    return result.stdout.trim();
}

function wait_for(vm, event)
{
    return new Promise((resolve, reject) => {
        const done = value => { cleanup(); resolve(value); };
        const failed = error => { cleanup(); reject(error); };
        const cleanup = () => {
            vm.remove_listener(event, done);
            vm.remove_listener("emulator-error", failed);
        };
        vm.add_listener(event, done);
        vm.add_listener("emulator-error", failed);
    });
}

const options = { machine_type: SYBORG_MACHINE, cpu_type: "arm32", graphics_adapter: "none", wasm_path, autostart: false, log_level: 0 };
assert.throws(() => new V86(options), /Syborg requires symbian.manifest/);
assert.throws(() => check_machine_options({ ...options, cpu_cores: 2 }), /one ARM32 core/);
assert.throws(() => check_machine_options({ ...options, cpu_type: "arm64" }), /one ARM32 core/);
assert.throws(() => check_machine_options({ ...options, net_device: { type: "virtio" } }), /network adapters set to none/);
assert.throws(() => check_machine_options({ ...options, cpu_worker: true, symbian: { [SYBORG_DIAGNOSTIC]: true } }), /local CPU/);

const directory = await mkdtemp(join(tmpdir(), "v86-syborg-"));
try
{
    const object = join(directory, "guest.o"), binary = join(directory, "guest.bin");
    run(process.env.CLANG || "clang", ["--target=arm-none-eabi", "-mcpu=arm1136jf-s", "-c", "-o", object, source]);
    const sysroot = run("rustc", ["--print", "sysroot"]);
    const host = run("rustc", ["-vV"]).match(/^host: (.*)$/m)[1];
    const lld = process.env.LD_LLD || join(sysroot, "lib", "rustlib", host, "bin", "rust-lld");
    run(lld, ["-flavor", "gnu", "-m", "armelf", "--image-base=0", "-Ttext=0x10000", "--oformat=binary", "-o", binary, object]);

    for(const disable_jit of [true, false])
    {
        const c_path = join(directory, disable_jit ? "c-interpreter.img" : "c-jit.img");
        await writeFile(c_path, Buffer.alloc(512));
        const e_bytes = new Uint8Array(512);
        e_bytes[0] = 0xEE;
        let frame;
        const screen_adapter = {
            set_mode() {}, set_size_graphical() {}, continue() {}, pause() {}, destroy() {},
            update_buffer(layers) { frame = layers[0].pixels.data.slice(); },
        };
        const vm = new V86({ ...options, disable_jit, screen_adapter, jit_switches: { a64_page_hot: 1 },
            symbian: {
                [SYBORG_DIAGNOSTIC]: true, rom: { url: binary },
                rofs: { buffer: new TextEncoder().encode("ROFS").buffer },
                devicetree: { buffer: Uint8Array.of(0xD0, 0x0D, 0xFE, 0xED).buffer },
                nvmemory: { url: c_path, disk_option: "read_write" },
                nvmemory2: disable_jit ? { buffer: e_bytes.buffer } : undefined,
            },
        });
        let output = "", deadline;
        try
        {
            await wait_for(vm, "emulator-loaded");
            const cpu = vm.v86.cpu;
            assert.equal(cpu.read_pc(), "0x0");
            assert.equal(cpu.profile, "arm1136-r2");
            assert.deepEqual(vm.disk_buffers().map(([name]) => name), ["symbian_nvmemory", "symbian_nvmemory2"]);
            await new Promise((resolve, reject) => {
                deadline = setTimeout(() => reject(new Error("Guest timed out at " + cpu.read_pc() + " with UART " + output)), 10000);
                vm.add_listener("serial0-output-byte", byte => {
                    output += String.fromCharCode(byte);
                    if(byte === 33) reject(new Error("Guest failed at " + cpu.read_pc() + " with UART " + output));
                    if(byte === 72) globalThis.queueMicrotask(() => {
                        cpu.devices.display.request_frame(true);
                        vm.symbian_send_key(0xA4, true);
                        vm.symbian_send_key(0xA4, false);
                        vm.symbian_set_touch(359, 639, true);
                        vm.symbian_set_touch(359, 639, false);
                        vm.serial0_send("u");
                    });
                    if(byte === 82) resolve();
                });
                vm.run().catch(reject);
            });
            assert.equal(output, "KIHPKIR");
            assert.deepEqual([...frame], [0, 0, 255, 255, 255, 0, 0, 255, 255, 255, 255, 255, 0, 255, 0, 255]);
            await vm.stop();
            assert.equal((await readFile(c_path))[0], 0xAB);
            const { compiled, uncached_accesses } = cpu.page_tier_stats();
            assert.equal(compiled > 0, !disable_jit, "exercise the selected interpreter or JIT entry");
            if(!disable_jit) assert.ok(uncached_accesses > 100, "JIT must reach Device-mapped RAM at Syborg's physical base");
            const state = await vm.save_state();
            const saved = cpu.get_state(true);
            saved[4].find(device => typeof device?.[0] === "string" && device[0].startsWith("diagnostic:"))[0] = "different firmware";
            assert.throws(() => cpu.validate_state(saved), /same Syborg firmware/);
            await vm.restart("power-on");
            assert.equal(cpu.read_pc(), "0x0");
            await vm.restore_state(state);
            console.log("PASS: Syborg handoff, ARM/Thumb, MMU, alignment, SVC, timer IRQ and return, UART, rotated pixels, input, ROFS, NVMemory and reboot (" +
                (disable_jit ? "interpreter" : compiled + " JIT compilations") + ")");
        }
        finally
        {
            clearTimeout(deadline);
            await vm.destroy();
        }
    }

    if(open_rom)
    {
        const open_card = join(directory, "open-e.img");
        await writeFile(open_card, Buffer.alloc(0));
        await truncate(open_card, 1024 * 1024 * 1024);
        for(const disable_jit of [true, false])
        {
            const vm = new V86({ ...options, disable_jit, symbian: {
                [SYBORG_DIAGNOSTIC]: true, rom: { url: open_rom }, devicetree: { url: open_dtb },
                nvmemory: { buffer: new ArrayBuffer(64 * 1024 * 1024) }, nvmemory2: { url: open_card, disk_option: "read_write" },
            } });
            let serial = "", deadline;
            try
            {
                await wait_for(vm, "emulator-loaded");
                await new Promise((resolve, reject) => {
                    deadline = setTimeout(() => reject(new Error("Open BSP timed out at " + vm.v86.cpu.read_pc() + "\n" + serial)), 15000);
                    vm.add_listener("serial0-output-byte", byte => {
                        serial += String.fromCharCode(byte);
                        if(byte === 10 && serial.includes("FAULT:")) reject(new Error(serial));
                        if(serial.includes("Thread svphostfs.exe::Main Killed -44")) resolve();
                    });
                    vm.run().catch(reject);
                });
                assert.match(serial, /SYBPROP: estart\.exe::Main sets 101f75b6\/1020e34e = 65535/);
                const compiled = vm.v86.cpu.page_tier_stats().compiled;
                assert.equal(compiled > 0, !disable_jit);
                console.log("PASS: qembian’s open EKA2 Syborg BSP reaches EStart (" + (disable_jit ? "interpreter" : compiled + " JIT compilations") + ")");
            }
            finally
            {
                clearTimeout(deadline);
                await vm.destroy();
            }
        }
    }
}
finally
{
    await rm(directory, { recursive: true, force: true });
}
