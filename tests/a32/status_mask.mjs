#!/usr/bin/env node
import assert from "node:assert/strict";
import { build32, reference32, actual32, root, QEMU_MACHINE32 } from "./runner.mjs";
const directory = build32("status-mask", [root + "tests/a32/status_mask.c", root + "tests/a32/status_mask_asm.S"]);
const expected = await reference32(directory, { machine: QEMU_MACHINE32.replace("gic-version=3", "gic-version=2") });
assert.equal(expected.status, "ok", expected.text);
process.env.A64_JIT = "1";
process.env.A64_JIT_HOT = "1";
process.env.A64_JIT_SWITCHES = "a64_page_aarch32=1";
const got = await actual32(directory, { setup: cpu => {
    cpu.wm.exports.a64_gic_set_version(2);
    cpu.wm.exports.a64_set_cores(1);
}, timeout: 30000 });
assert.equal(got.status, "ok", got.text);
assert.equal(got.text, expected.text);
assert.match(got.text, /irq: 1 observed 1 marker 2 flags /);
assert.ok(got.page_tier.compiled > 0, "identity mapping reaches native pages");
console.log("PASS: hot CPSR c/fc, predicates, mode/bank fallback and immediate pending IRQ match QEMU");
