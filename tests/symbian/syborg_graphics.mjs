// ABI regression checks. The corresponding browser probe verifies actual GPU output.
import assert from "node:assert/strict";
import { GLESHost } from "../../src/gles/gles_host.js";
import { encode_command } from "../../src/gles/gles_wire.js";
import { create_syborg_transport } from "../../src/gles/syborg_transport.js";
import { syborg_graphics } from "../../src/symbian/syborg_graphics.js";

const MAGIC = 0x314C4756;
const OPEN = 1, SUBMIT = 2, POLL = 3, RECEIVE = 4, SWAP = 5, CLOSE = 6;
const words = (...numbers) => {
    const bytes = new Uint8Array(numbers.length * 4), view = new DataView(bytes.buffer);
    numbers.forEach((value, index) => view.setUint32(index * 4, value, true));
    return bytes;
};
const u32 = bytes => new DataView(bytes.buffer, bytes.byteOffset).getUint32(0, true);
const renderer = { post() {}, listen(listener) { this.receive = listener; } };
const host = new GLESHost({ width: 360, height: 640, dpi: 213 }, renderer);
const backend = create_syborg_transport(host);
const send = (pid, capacity, ...request) => backend.submit(pid, 0, words(MAGIC, ...request), capacity);
const open = owner => u32(send(owner, 4, OPEN, 0, 1, 16, 12));
const submit = (owner, session, expected, command) => {
    const header = words(MAGIC, SUBMIT, session, expected);
    const bytes = new Uint8Array(header.length + command.length);
    bytes.set(header);
    bytes.set(command, header.length);
    return backend.submit(owner, 0, bytes, 0);
};

const first = open(17), second = open(31);
assert.notEqual(first, second);
assert.equal(send(17, 4, POLL, second), null);
assert.equal(send(17, 0, CLOSE, second), null);
assert.equal(send(17, 0, OPEN, 0, 1, 16, 12), null);
assert.equal(send(17, 4, OPEN, 0, 2, 640, 640), null);
assert.equal(submit(17, first, 4, encode_command("rcCreateContext", [0, 0, 1])), null);
assert.equal(submit(17, first, 4, encode_command("gles2:glGetError", [])), null);
assert.equal(submit(17, first, 4, encode_command("gles1:glGetError", []).subarray(0, 7)), null);
assert.equal(submit(17, first, 0, encode_command("gles1:glReadPixels", [0, 0, 1, 1, 0x1908, 0x1401, 0xFFFFFFFF])), null);
assert.equal(submit(17, first, 4, encode_command("gles1:glGetError", [])).length, 0);
assert.equal(u32(send(17, 4, POLL, first)), 1);
assert.equal(send(17, 0, SWAP, first), null);
assert.equal(send(17, 8, RECEIVE, first), null);
assert.equal(u32(send(17, 4, RECEIVE, first)), 0);
assert.equal(u32(send(17, 4, POLL, first)), 0);
assert.throws(() => backend.check_save(), /Close the Symbian EGL application/);

assert.equal(send(17, 0, SWAP, first).length, 0);
assert.equal(u32(send(17, 4, POLL, first)), 0);
renderer.receive({ type: "lost", reason: "test device destroyed" });
await Promise.resolve();
assert.equal(u32(send(17, 4, POLL, first)), 2);
assert.equal(send(17, 4, OPEN, 0, 1, 16, 12), null);
assert.equal(send(17, 0, CLOSE, first).length, 0);
assert.equal(backend.submit(17, 0, words(9, 3, 31), 0), null);
assert.equal(backend.submit(0, 1, words(9, 3, 31), 0).length, 0);
assert.equal(backend.summary().clients, 0);
assert.equal(host.summary().render_control.contexts, 0);
backend.check_save();

let mmio, supervisor = false;
const memory = new Uint8Array(4096);
const cpu = {
    io: { register_mmio(address, size, device) { assert.equal(address, 0xC000F000); assert.equal(size, 4096); mmio = device; } },
    ram_offset: (address, size) => address + size <= memory.length ? address : -1,
    read_blob_physical: (address, size) => memory.slice(address, address + size),
    write_blob_physical: (bytes, address) => memory.set(bytes, address),
};
const gfx = syborg_graphics(cpu, {
    available: () => true,
    submit(pid, rights, request, capacity) {
        assert.equal(pid, 17);
        assert.equal(rights, 0);
        assert.equal(capacity, 4);
        assert.deepEqual(request, words(MAGIC, POLL, 1));
        return words(0x4008);
    },
}, () => supervisor);
assert.equal(mmio.read(0, 4), 0);
mmio.write(8 * 4, 4, 89);
supervisor = true;
assert.equal(mmio.read(0, 4), 0xC51D0011);
memory.set(words(MAGIC, POLL, 1), 200);
mmio.write(2 * 4, 4, 200);
mmio.write(3 * 4, 4, 12);
mmio.write(5 * 4, 4, 400);
const state = gfx.get_state();
assert.equal(state[8], 0);
gfx.reset();
gfx.set_state(state);
mmio.write(8 * 4, 4, 17);
mmio.write(6 * 4, 4, 4);
mmio.write(4 * 4, 4, 1);
assert.equal(mmio.read(4 * 4, 4), 0);
assert.equal(u32(memory.subarray(400, 404)), 0x4008);
mmio.write(2 * 4, 4, 4100);
mmio.write(3 * 4, 4, 12);
mmio.write(4 * 4, 4, 1);
assert.equal(mmio.read(4 * 4, 4), 1);
console.log("Syborg graphics: copied control, process isolation, packet bounds, state and loss passed");
