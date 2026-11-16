// A real ARM guest must leave the AMC startup polling loop. No Apple
// firmware is required: these instructions implement the driver's public
// start/status/ack protocol against the actual Wasm MMIO bus.
import assert from "node:assert/strict";
import path from "node:path";
import { V86 } from "../../src/main.js";
import { dt_serialize } from "../../src/apple/devicetree.js";

// A tiny independent Mach-O/tree boots the actual N90 board without owner
// firmware. The test then replaces its entry with the driver below.
const kernel = new Uint8Array(4096), k = new DataView(kernel.buffer);
const words = (at, ...values) => values.forEach((value, i) => k.setUint32(at + 4 * i, value, true));
words(0, 0xfeedface, 12, 9, 2, 2, 140, 0);
words(28, 1, 56);kernel.set(new TextEncoder().encode("__TEXT"), 36);
words(52, 0x80001000, 4096, 0, 4096, 7, 5, 0, 0);
words(84, 5, 84, 1, 17);words(160, 0x80001800, 0x13);
const property = (name, value) => ({ name, value: new TextEncoder().encode(value + "\0"), placeholder: false });
const node = (name, children = []) => ({ properties: [property("name", name)], children });
const tree = node("device-tree", [node("chosen"), node("cpus", [node("cpu0")]),
    node("memory"), node("vram"), node("pram"), node("arm-io")]);
tree.properties.push(property("compatible", "N90AP"));
const emulator = new V86({ machine_type: "s5l8930", cpu_type: "arm32", graphics_adapter: "none", memory_size: 512 << 20,
    autostart: false, log_level: 0, wasm_path: path.resolve(process.env.A64_WASM || "build/v86-arm64.wasm"),
    ios: { kernelcache: { buffer: kernel.buffer }, devicetree: { buffer: dt_serialize(tree).buffer } } });
try
{
    await new Promise((resolve, reject) => {
        emulator.add_listener("emulator-loaded", resolve);emulator.add_listener("emulator-error", reject);
    });
    const cpu = emulator.v86.cpu;
    const amc = cpu.devices.apple_amc;
    const base = 0x40010000, result = 0x40020000;
    const code = new Uint32Array([
        0xe3000000, 0xe3480410, // r0 = 0x84100000, AMC registers
        0xe3004000, 0xe3444002, // r4 = result
        0xe3085000, 0xe3485401, // r5 = 0x84018000, buffer contract
        0xe3a01003, 0xe580199c, // reset program
        0xe3a01000, 0xe5801984, // start program
        0xe5902a98, 0xe3120004, 0x0afffffc, // read status; test ready; retry
        0xe1d520b2, 0xe5842004, // save buffer count
        0xe1d520b4, 0xe5842008, // save samples per buffer
        0xe3a01004, 0xe5801c48, // acknowledge ready
        0xe5902a98, 0xe584200c, // save status after acknowledgement
        0xe3a01001, 0xe5841000, // reached the end of the handshake
        0xe320f003, 0xeafffffd, // WFI; stay idle
    ]);
    cpu.write_blob_physical(new Uint8Array(code.buffer), base);
    let reads = 0;
    const read = amc.read.bind(amc);
    amc.read = offset => { if(offset === 0xa98) reads++;return read(offset); };
    const start = prefix => {
        const bytes = amc.memory(), memory = new DataView(bytes.buffer, bytes.byteOffset);
        prefix.forEach((word, i) => memory.setUint32(0x4600 + i * 4, word, true));
        for(const [reg, value] of [[0x940, 0x84004600], [0x960, 0xc6005c00],
            [0x964, 0x8544602f], [0x968, 0xc013f7fb]]) amc.write(reg, value);
        cpu.write_blob_physical(new Uint8Array(16), result);
        reads = 0;cpu.boot(base, 0);cpu.run_cores();
        assert.equal(cpu.undefined_instructions().el1, 0, "guest instructions and MMIO must execute normally");
    };
    for(const [name, prefix] of [
        ["MP3 bootstrap", [0x21000004, 0xb623a100, 0x58100000, 0x00080a30]],
        ["resident type-0 MP3 restart", [0x01c2006a, 0x080001d7, 0x428007c8, 0x083ed008]],
    ])
    {
        start(prefix);
        assert.equal(cpu.read32_physical(result), 1, name + " leaves the native polling loop");
        assert.equal(cpu.read32_physical(result + 4), 2);
        assert.equal(cpu.read32_physical(result + 8), 2304);
        assert.equal(cpu.read32_physical(result + 12), 0, "guest acknowledgement clears ready");
        assert.equal(reads, 2, "one ready read and one acknowledged read, without spinning");
        assert.equal(amc.codec.stats.pcm_bytes, 0, "startup does not invent decoded audio");
        console.log("PASS: ARM guest " + name + " completes and acknowledges initialization in two status reads");
    }
    start([0, 0, 0, 0]);
    assert.equal(cpu.read32_physical(result), 0, "an unsupported program cannot pass the guest handshake");
    assert.equal(amc.pending[0], 0);
    assert.ok(reads > 100, "the negative control really executes the polling loop");
    console.log("PASS: unknown AMC program remains pending instead of manufacturing ready");
}
finally { await emulator.destroy(); }
