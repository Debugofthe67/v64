// Run RM-505 erofs.fsy header validation, directory lookup, file open and
// section reads against physical flash. Scratch RAM supplies the file server's
// objects and local-drive proxy. No running file server or merged Z: is assumed.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { copyFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { V86 } from "../../src/main.js";
import { STATE_OFFSETS } from "../../src/arm/state_layout.js";
import { parse_fpsx, fpsx_group_data } from "../../src/symbian/fpsx.js";
import { N97_FLASH_NAME } from "../../src/symbian/n97_flash.js";
import { llvm_mc } from "../../tests/a64/oracle/decode.mjs";

const [directory, core_file] = process.argv.slice(2);
if(process.argv.length !== 4) throw new Error("Usage: node tools/symbian/rofs-n97.mjs <extraction-directory> <retail CORE.C00>");
const core = parse_fpsx(await readFile(core_file));
const loader = fpsx_group_data(core, core.groups.find(group => group.label === "RAP3NAND"));
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
assert.equal(sha256(loader), "0d7305dd3c057210cd5b67fb1b994ed02291cd68899bd64c0b0dbc29bb94f4b8");
const manifest = JSON.parse(await readFile(join(directory, "firmware.json"), "utf8"));
assert.equal(manifest.manifest_sha256, "c779d64d3a5d4e5cc1e3a9611e28c3115857a14dce430118a9d8187bf6972c38");

const assembler = llvm_mc().path;
const object = execFileSync(assembler, ["-triple=armv6-none-eabi", "-filetype=obj",
    fileURLToPath(new URL("rofs-read-proxy.s", import.meta.url))]);
const proxy_code = execFileSync(join(dirname(assembler), "llvm-objcopy"),
    ["-O", "binary", "--only-section=.text", "-", "-"], { input: object });

// Independent complete-file digests. The same path has different data on
// ROFS1 and ROFS2. Selection between volumes belongs to the composite FS.
const examples = [
    [["\\system\\data\\wsini.ini", "b05dc683e95de5f38a386847ff0c0ac27ccbdacfcd09e42ee3cb9fc1e891951e"],
        ["\\data\\bookmarkimportsample.txt", "6ee62c22d1ab9ff722fe6239af01a6bb799cc3e1e1222571c559b205820200d7"]],
    [["\\data\\bookmarkimportsample.txt", "7f029ba3d69197b9d868c2f3156d4844a3f7a80fb9c7787155bfc28d9674d5b4"],
        ["\\resource\\versions\\langsw.txt", "6febba2fef38bc622fddaa06eec0f30bc07586a677a9bafd60b7db742703300f"]],
    [["\\resource\\versions\\customersw.txt", "de620a9f32a9d7dabf5ed7838d7ee7431bf9f48af5e949f2f6738775ad5b4a4a"],
        ["\\resource\\versions\\fwid3.txt", "2b2efa46e442566657cace7508c06d2d766e36db9019c7e220f18ec4bbf98626"]],
];
const temporary = await mkdtemp(join(tmpdir(), "v86-n97-rofs-"));
let vm;
try
{
    const nand = join(temporary, N97_FLASH_NAME);
    await copyFile(join(directory, N97_FLASH_NAME), nand, constants.COPYFILE_FICLONE);
    vm = new V86({ machine_type: "nokia-n97", graphics_adapter: "none", disable_jit: true, log_level: 0,
        wasm_path: fileURLToPath(new URL("../../build/v86-arm64.wasm", import.meta.url)), symbian: {
            rom: { url: join(directory, "rom.xip.bin") }, boot_media: { url: join(directory, "rapido-boot.bin") },
            nand: { url: nand, disk_option: "read_write" },
        } });
    await new Promise((resolve, reject) => {
        vm.add_listener("emulator-loaded", resolve);
        vm.add_listener("emulator-error", reject);
    });
    const cpu = vm.v86.cpu, wasm = cpu.wm.exports;
    assert.equal(cpu.boot_files.rom_digest, "9c0863e379d243f953d3cfcd87d11c98231f2d0469e69244d9ee059472c99194");
    const state = new DataView(cpu.wasm_memory.buffer, cpu.state_base);
    const reg = (n, value) => state.setUint32(STATE_OFFSETS.x + n * 8, value, true);
    const write = (address, bytes) => cpu.write_blob_physical(bytes, address);
    const words = (address, ...values) => write(address, new Uint8Array(Uint32Array.from(values).buffer));
    const word = address => cpu.read32_physical(address) >>> 0;
    const base = 0x0DC00000, setup = base + 0x100, dispatch = setup + 0x30, stop = setup + 0x40;
    const table_address = base + 0x4000, stack = base + 0xFD000;
    const mount = base + 0x8000, cache = base + 0x8200, path_descriptor = base + 0x8300, file = base + 0x8480;
    const local_descriptor = base + 0x8600, message = base + 0x8700;
    const proxy = base + 0x9000, vtable = proxy + 0x100, read_proxy = base + 0xA000;
    const directory_tree = base + 0x10000, directory_files = base + 0x30000, output = base + 0x90000;
    const table = new Uint32Array(4096);
    function section(va, pa) { table[va >>> 20] = pa | 0xC02; }
    for(const address of [0, 0x08000000, base, 0x30000000]) section(address, address);
    for(let offset = 0; offset < cpu.boot_files.rom.byteLength; offset += 0x100000)
        section(0x80000000 + offset, 0x08900000 + offset);
    write(0x08000000, loader);
    write(read_proxy, proxy_code);
    write(table_address, new Uint8Array(table.buffer));
    // Set ARMv6 TTBR0/DACR and SCTLR.M; flush prefetch and branch to r4.
    words(setup, 0xEE020F10, 0xEE031F10, 0xEE112F10, 0xE3822001, 0xEE012F10, 0xEE073F95, 0xE12FFF14);
    words(dispatch, 0xE12FFF1C); // BX r12 accepts either ARM or Thumb functions
    words(stop, 0xEAFFFFFE); // B .
    function run()
    {
        for(let i = 0; i < 40000 && Number(cpu.read_pc()) !== stop; i++) wasm.a64_worker_slice(256);
        assert.equal(Number(cpu.read_pc()), stop, "guest routine did not return");
    }
    wasm.a32_boot_with_registers(setup, table_address, -1, 0, 0);
    reg(4, stop);
    run();
    function call(entry, ...args)
    {
        args.slice(0, 4).forEach((value, n) => reg(n, value));
        if(args.length > 4) words(stack, ...args.slice(4));
        reg(13, stack);
        reg(14, stop);
        reg(12, entry);
        state.setUint32(STATE_OFFSETS.pc, dispatch, true);
        run();
        return state.getUint32(STATE_OFFSETS.x, true);
    }
    function read_extent(position, size, destination)
    {
        words(local_descriptor, 0x20000000, size, destination); // TPtr8
        assert.equal(call(read_proxy, proxy, 0, position, 0, size, local_descriptor, -1, 0), 0);
        assert.equal(word(local_descriptor), 0x20000000 + size);
    }
    call(0x08002EB5, 0); // initialize RAP3NAND and identify CS0
    words(vtable + 0x30, read_proxy);
    words(message, -1); // KLocalMessageHandle
    for(const [index, files] of examples.entries())
    {
        const reference = await readFile(join(directory, "rofs" + (index + 1) + ".img"));
        const volume = manifest.rofs[index];
        words(proxy, vtable, volume.flash_address);
        words(mount + 0x44, proxy);
        words(mount + 0x90, reference.length, 0); // physical media extent for CheckHeader
        read_extent(0, 48, mount + 0x58);
        assert.equal(call(0x8028B3C5, mount), 0); // CRofsMountCB::CheckHeader
        assert.equal(call(0x8028C0FD, cache, mount, proxy, mount + 0x58), cache);
        const tree_size = word(cache + 0x10), files_size = word(cache + 0x18);
        assert.ok(tree_size + 4 <= directory_files - directory_tree && files_size + 4 <= output - directory_files);
        read_extent(word(cache + 0x0C), tree_size, directory_tree + 4);
        read_extent(word(cache + 0x14), files_size, directory_files + 4);
        words(directory_tree, tree_size); // HBufC8 layout in the diagnostic arena
        words(directory_files, files_size);
        words(cache + 0x1C, directory_tree, directory_files);
        words(mount + 0x88, cache);
        for(const [path, expected_sha256] of files)
        {
            words(path_descriptor, path.length);
            write(path_descriptor + 4, Buffer.from(path, "utf16le"));
            call(0x8028B64F, mount, path_descriptor, 0, 0, file); // FileOpenL
            const size = word(file + 0x1C), offset = word(file + 0x68);
            assert.ok(size > 3 && output + size + 32 < stack && offset + size <= reference.length);
            const expected = reference.subarray(offset, offset + size);
            assert.equal(sha256(expected), expected_sha256);
            // Resolve the same absolute path through the stock case-folding lookup.
            write(path_descriptor + 4, Buffer.from(path.toUpperCase(), "utf16le"));
            for(const position of [0, Math.min(2047, size - 1), size - 3])
            {
                const requested = position === 0 ? size + 32 : Math.min(5000, size + 32);
                const length = Math.min(requested, size - position);
                words(local_descriptor, 0x20000000, requested, output);
                write(output, new Uint8Array(requested + 1).fill(0xAD));
                call(0x8028B93D, mount, path_descriptor, position, local_descriptor, requested, message); // ReadSectionL
                assert.equal(word(local_descriptor), 0x20000000 + length);
                assert.deepEqual(Buffer.from(cpu.read_blob_physical(output, length)), expected.subarray(position, position + length));
                assert.equal(cpu.read_blob_physical(output + length, 1)[0], 0xAD);
            }
            console.log(JSON.stringify({ volume: index + 1, path, offset, size, sha256: expected_sha256 }));
        }
    }
    const device = cpu.devices.n97_onenand.status();
    assert.ok(device.reads > 0);
    assert.equal(device.programs + device.erases, 0);
    console.log(JSON.stringify(device));
}
finally
{
    try { await vm?.destroy(); }
    finally { await rm(temporary, { recursive: true, force: true }); }
}
