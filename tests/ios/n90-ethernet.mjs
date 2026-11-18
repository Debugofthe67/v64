import assert from "node:assert/strict";
import { n90_ethernet } from "../../src/apple/n90_compat.js";

const ram = new Uint8Array(0x300000);
const kernel = { uuid: "3bfc23e42eb53dad9d909e79ac235537" };
const hook = 0xE2BF2, routine = 0x2B6200;
const surrounding = Uint8Array.of(0x20, 0x68, 0x00, 0x21, 0xFB, 0xF7, 0x3D, 0xF9, 0x02, 0x46, 0x5A, 0xB1);
ram.set(surrounding, hook - 4);
const original = ram.slice();

n90_ethernet(ram, { uuid: "other" });
assert.deepEqual(ram, original);

ram[hook] ^= 1;
assert.throws(() => n90_ethernet(ram, kernel), /Unexpected 10B329/);
assert.deepEqual(ram.subarray(routine, routine + 208), new Uint8Array(208));
ram.set(surrounding, hook - 4);

ram[routine + 207] = 1;
assert.throws(() => n90_ethernet(ram, kernel), /Unexpected 10B329/);
assert.deepEqual(ram.subarray(hook - 4, hook + 8), surrounding);
ram[routine + 207] = 0;

n90_ethernet(ram, kernel);
assert.deepEqual(ram.subarray(hook - 4, hook), surrounding.subarray(0, 4));
assert.deepEqual(ram.subarray(hook + 4, hook + 8), surrounding.subarray(8));
assert.deepEqual(ram.subarray(hook, hook + 4), Uint8Array.of(0xD3, 0xF1, 0x05, 0xFB));
assert.deepEqual(ram.subarray(routine + 0x74, routine + 0x82),
    Uint8Array.of(14, 18, 0, 0, 6, 0, 6, 0, 0x52, 0x54, 0, 0x86, 0, 1));
console.log("PASS: stock 10B329 en0 bootstrap validates its call site and unused space before patching");
