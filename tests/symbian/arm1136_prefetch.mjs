// ARM1136 MMU transition with different opcodes at the old and new physical addresses.
import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { STATE_OFFSETS } from "../../src/arm/state_layout.js";
import { V86 } from "../../src/main.js";

const wasm_path = fileURLToPath(new URL("../../build/v86-arm64.wasm", import.meta.url));
const alias = 0x100000;
const switch_off = alias + 0x204;
const switch_on = alias + 0x300;
const write_sctlr = 0xEE010F10; // MCR p15, 0, r0, c1, c0, 0
const flush_prefetch = 0xEE070F95; // MCR p15, 0, r0, c7, c5, 4
const irq_return = 0xE25EF004; // SUBS pc, lr, #4
const old_next = 0xE3A02011;   // MOV r2, #0x11
const new_next = 0xE3A02022;   // MOV r2, #0x22

function bare_rom()
{
    const buffer = new ArrayBuffer(0x4008);
    const view = new DataView(buffer);
    const emit = (address, ...words) => words.forEach((word, i) => view.setUint32(address + i * 4, word, true));
    emit(0, 0xEA00003E); // B 0x100
    emit(0x18, irq_return);
    emit(0x100,
        0xEE020F10, // MCR TTBR0, r0
        0xEE031F10, // MCR DACR, r1
        0xEE110F10, // MRC SCTLR, r0
        0xE3800001, // ORR r0, r0, #1
        write_sctlr,
        0xF1080080, // CPSIE i
        0xE3A04080, // MOV r4, #128
        0xE51FF004, // LDR pc, [pc, #-4]
        alias + 0x1F8);
    emit(0x1F8,
        0xE2544001, // SUBS r4, r4, #1 (heat the page through actual guest execution)
        0x1AFFFFFD, // BNE 0x1F8
        0xE3C00001, // BIC r0, r0, #1
        write_sctlr,
        old_next,
        0xE3A03033, // MOV r3, #0x33
        0xE3A06033, // MOV r6, #0x33 (beyond the retained window)
        0x11223344); // distinct data at the old alias
    emit(0x304, 0xE3A050AA, 0xE3A06066, write_sctlr); // MOV r5,#0xAA; MOV r6,#0x66; SCTLR.M unchanged
    emit(0x4000, 0xC02, 0xC02); // two short-descriptor sections both backed by physical 0
    return buffer;
}

for(const jit of [false, true])
{
    test(`two ARM1136 fetches retain their opcodes across SCTLR.M (JIT ${jit ? "enabled" : "disabled"})`, async () => {
        const emulator = new V86({ machine_type: "nokia-n97", graphics_adapter: "none", disable_jit: !jit, autostart: false,
            wasm_path, log_level: 0, ir_sync_publication: true,
            jit_switches: { a64_page: +jit, a64_page_hot: 1, a64_page_aarch32: 1 },
            symbian: { rom: { buffer: bare_rom() }, load_address: 0, boot_registers: [0x4000, 1, 0, 0] } });
        try
        {
            await new Promise((resolve, reject) => {
                emulator.add_listener("emulator-loaded", resolve);
                emulator.add_listener("emulator-error", reject);
            });
            const cpu = emulator.v86.cpu;
            const { a32_set_interrupt_lines, a64_worker_slice: step } = cpu.wm.exports;
            const state = () => new DataView(cpu.wasm_memory.buffer, cpu.state_base);
            const pending = () => state().getUint32(STATE_OFFSETS.a32_prefetch + 8, true);
            const pc = () => Number(cpu.read_pc());
            const reg = n => state().getUint32(STATE_OFFSETS.x + n * 8, true);
            const set_reg = (n, value) => state().setUint32(STATE_OFFSETS.x + n * 8, value, true);
            const redirect = address => state().setBigUint64(STATE_OFFSETS.pc, BigInt(address), true);
            const old_address = switch_off - alias;
            const flat_target = switch_off + 16;

            cpu.write32_physical(switch_off + 4, new_next);
            cpu.write32_physical(switch_off + 8, 0xE3A03044); // MOV r3, #0x44
            cpu.write32_physical(switch_off + 12, 0xE3A06044); // MOV r6, #0x44
            cpu.write32_physical(flat_target, 0xEAFFFFFE); // park at the end of the transition
            cpu.write32_physical(switch_off + 20, 0xEAFFFFFA); // B switch_off+4 under the flat mapping
            cpu.write32_physical(switch_on - 4, 0xE3800001); // ORR r0, r0, #1
            cpu.write32_physical(switch_on, write_sctlr);
            cpu.write32_physical(switch_on + 4, 0xE3A05055); // MOV r5, #0x55
            cpu.write32_physical(switch_on + 8, 0xE3A06055); // MOV r6, #0x55

            const check_enable = () => {
                redirect(switch_on - 4);
                step(2);
                assert.equal(pc(), switch_on + 4);
                assert.ok(pending());
                step(2);
                assert.deepEqual([reg(5), reg(6)], [0x55, 0x55], "enabling the MMU also retains two fetches");
                if(!jit)
                {
                    step(1);
                    assert.equal(pc(), switch_on + 16);
                    assert.equal(pending(), 0, "an SCTLR write that leaves M unchanged does not queue an opcode");
                }
            };
            const check_disable = () => {
                assert.equal(pc(), flat_target);
                assert.deepEqual([reg(2), reg(3), reg(6)], [0x11, 0x33, 0x44], "the third opcode uses the new mapping");
            };
            if(jit)
            {
                for(let i = 0; i < 10 && pc() !== flat_target; i++) step(64);
                check_disable();
                assert.ok(cpu.page_tier_stats().instructions > 0, "the hot alias page must run native templates");
                assert.ok(cpu.step_stats().a32_stepped_words.some(event => event.word === "0xee010f10"),
                    "a JIT activation steps the SCTLR write");
                check_enable();
                return;
            }

            for(let i = 0; i < 300 && pc() !== switch_off; i++) step(1);
            assert.equal(pc(), switch_off);
            const before_switch = cpu.save_core_state();
            step(4);
            check_disable();

            cpu.load_core_state(before_switch);
            step(1);
            assert.equal(pc(), switch_off + 4);
            assert.ok(pending());
            const saved = await emulator.save_state();
            const with_prefetch = cpu.save_core_state();
            cpu.load_core_state(with_prefetch.subarray(0, -24));
            assert.equal(pending(), 0, "pre-existing snapshots have no queued fetch");
            step(1);
            assert.equal(reg(2), 0x22);

            cpu.load_core_state(with_prefetch.subarray(0, -12));
            assert.ok(pending(), "the first entry retains its layout in a former snapshot");
            step(2);
            assert.deepEqual([reg(2), reg(3)], [0x11, 0x44]);

            await emulator.restore_state(saved);
            cpu.write32_physical(old_address + 4, 0xE3A02099);
            cpu.write32_physical(old_address + 8, 0xE3A03099); // change the already fetched backing words
            step(1);
            assert.equal(reg(2), 0x11);
            assert.ok(pending());
            const halfway = await emulator.save_state();
            step(1);
            assert.equal(reg(3), 0x33);
            assert.equal(pending(), 0);

            await emulator.restore_state(halfway);
            step(1);
            assert.equal(reg(3), 0x33, "the remaining opcode survives a snapshot between the two fetches");

            await emulator.restore_state(halfway);
            a32_set_interrupt_lines(true, false);
            step(1);
            assert.equal(pc(), 0x18);
            assert.equal(pending(), 0, "an IRQ flushes the pending opcode");
            a32_set_interrupt_lines(false, false);
            step(2);
            assert.equal(reg(3), 0x44, "IRQ return fetches again with the MMU off");

            await emulator.restore_state(saved);
            redirect(switch_off + 20);
            step(2);
            assert.equal(reg(2), 0x22, "another PC discards the cached opcode before branching back");

            check_enable();

            for(const { first, user } of [
                { first: 0xEAFFFFFF, user: false }, // B to the next address
                { first: flush_prefetch, user: false },
                { first: flush_prefetch, user: true },
            ])
            {
                cpu.load_core_state(before_switch);
                cpu.write32_physical(old_address + 4, first);
                step(1);
                if(user)
                {
                    const cpsr = state().getUint32(STATE_OFFSETS.pstate, true);
                    state().setUint32(STATE_OFFSETS.pstate, cpsr & ~0x1F | 0x10, true);
                }
                step(1);
                assert.equal(pc(), switch_off + 8);
                assert.equal(pending(), 0, "branch to the next PC or explicit flush invalidates remaining fetches");
                step(1);
                assert.equal(reg(3), 0x44);
            }

            cpu.load_core_state(before_switch);
            cpu.write32_physical(old_address + 4, 0xE5912000); // LDR r2, [r1], prefetched under the old translation
            cpu.write32_physical(flat_target, 0x55667788);
            set_reg(1, flat_target);
            step(2);
            assert.equal(reg(2), 0x55667788, "a retained instruction reads data through the new mapping");

            cpu.load_core_state(before_switch);
            cpu.write32_physical(old_address + 4, 0xE1A00000); // NOP
            cpu.write32_physical(old_address + 8, 0xE1A0F001); // MOV pc, r1 (original UPDAPP handoff shape)
            cpu.write32_physical(flat_target, 0xE3A02077); // MOV r2, #0x77
            set_reg(1, flat_target);
            step(3);
            assert.equal(pc(), flat_target);
            assert.equal(pending(), 0);
            step(1);
            assert.equal(reg(2), 0x77);

            await emulator.restore_state(saved);
            assert.ok(pending());
            await emulator.restart("power-on");
            assert.equal(pc(), 0);
            assert.equal(pending(), 0);
        }
        finally
        {
            await emulator.destroy();
        }
    });
}
