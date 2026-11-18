#!/usr/bin/env node
// Observes an unmodified RM-505 22.0.110 XIP with the selected board handoff.
// NAND changes stay in memory, including when tracing the downstream ROM entry.
// --reject-probe supplies only a Thumb caller-return test with status zero.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { open, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { STATE_OFFSETS } from "../../src/arm/state_layout.js";
import { V86 } from "../../src/main.js";
import { fpsx_group_data, parse_fpsx } from "../../src/symbian/fpsx.js";
import { N97_BOOT_TOC, N97_RAM_BASE, N97_RAM_SIZE, N97_ROM_ADDRESS } from "../../src/symbian/n97_board.js";
import { read_n97_boot_media } from "../../src/symbian/n97_boot_media.js";
import { N97_BOOT_SOURCE, N97_CPU_PLL, N97_L2_BASE, N97_PLL3, N97_PLL3_CONTROL, N97_PLL_POWER, N97_RAPIDO_SELECT, N97_RESET_STATUS,
    N97_SHARED_CONTROL } from "../../src/symbian/n97_devices.js";
import { N97_DISPC_BASE } from "../../src/symbian/n97_dispc.js";
import { N97_FLASH_IMAGE_SIZE } from "../../src/symbian/n97_flash.js";
import { N97_LOSSI_BASE } from "../../src/symbian/n97_lossi.js";
import { N97_COMPAT_XIP } from "../../src/symbian/n97_rapido_compat.js";

const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    "ap-only": { type: "boolean" }, "boot-media": { type: "string" }, "boot-rom": { type: "string" }, "reject-probe": { type: "boolean" },
    "nand": { type: "string" }, "isa-probe": { type: "string" }, "rapido-compat-rom": { type: "boolean" },
    "compat-negative": { type: "string" }, "original-core": { type: "string" }, "display-evidence": { type: "boolean" },
} });
const compat = values["rapido-compat-rom"];
const negative = values["compat-negative"];
const original_core = values["original-core"];
const display_evidence = values["display-evidence"];
const negative_outcome = new Map([["descriptor", "request"], ["toc-size", "request"], ["toc-name", "request"], ["root", "keys"], ["keys-signature", "keys"],
    ["modem-key", "keys"], ["certificate", "isasw"], ["certificate-trailer", "isasw"], ["isasw-payload", "isasw"], ["dsp0-payload", "dsp0"]]);
if(positionals.length !== 1 || (values["boot-rom"] || values["reject-probe"]) && !values["boot-media"] ||
    values["ap-only"] && values["boot-media"] || values["boot-rom"] && values["reject-probe"] || values["isa-probe"] && !values["ap-only"] ||
    compat && (!values["boot-media"] || !values.nand || values["boot-rom"] || values["reject-probe"]) ||
    negative !== undefined && (!compat || !negative_outcome.has(negative)) ||
    original_core !== undefined && !original_core || (original_core || display_evidence) && (!compat || negative !== undefined))
{
    throw new Error("Usage: node tools/symbian/boot-n97.mjs <rom.xip.bin> [--nand <onenand.img>] [--ap-only [--isa-probe <rapido-boot.bin>] | --boot-media <rapido-boot.bin> [--boot-rom <dump> | --reject-probe | --rapido-compat-rom [--compat-negative <" + [...negative_outcome.keys()].join("|") + ">] [--original-core <RM-505_22.0.110_prd.core.C00>] [--display-evidence]]]");
}
const rom = await readFile(positionals[0]);
const sha256 = digest(rom);
assert.equal(sha256, N97_COMPAT_XIP, "expected RM-505 22.0.110 XIP");
const wasm_path = fileURLToPath(new URL("../../build/v86-arm64.wasm", import.meta.url));

const instructions_per_ms = 8000;
function digest(bytes)
{
    return createHash("sha256").update(bytes).digest("hex");
}

async function read_exact(path, size)
{
    const fd = await open(path, "r");
    try
    {
        const stat = await fd.stat();
        assert.ok(stat.isFile() && stat.size === size, `${path}: expected a ${size}-byte file`);
        const bytes = Buffer.allocUnsafe(size);
        for(let at = 0; at < size;)
        {
            const { bytesRead } = await fd.read(bytes, at, size - at, at);
            assert.ok(bytesRead, `${path}: truncated while reading`);
            at += bytesRead;
        }
        return bytes;
    }
    finally
    {
        await fd.close();
    }
}

const image = async path => path ? { buffer: Uint8Array.from(await readFile(path)).buffer } : undefined;
async function nand_image(path)
{
    if(!path) return undefined;
    const bytes = await read_exact(path, N97_FLASH_IMAGE_SIZE);
    return { buffer: bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength ?
        bytes.buffer : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
}
function rejection_image()
{
    const bytes = new Uint8Array(0x2000);
    bytes.set([0x00, 0x20, 0x70, 0x47], 0x1208); // movs r0, #0; bx lr
    return { buffer: bytes.buffer };
}
const vm = new V86({ machine_type: "nokia-n97", graphics_adapter: "none", disable_jit: true,
    autostart: false, log_level: 0, wasm_path, cpu_clock: { mode: "deterministic", instructions_per_ms },
    symbian: { rom: { buffer: Uint8Array.from(rom).buffer }, rom_sha256: sha256, application_processor_only: values["ap-only"],
        boot_media: await image(values["boot-media"]), bootrom: values["reject-probe"] ? rejection_image() : await image(values["boot-rom"]),
        nand: await nand_image(values.nand), rapido_compat_rom: compat } });

// The original TOC lookup and stores publish the physical pointer before the
// chip-ROM call, even when the original lookup finds no ISASW entry.
function observe_isasw_record(record, pc, step, register, word)
{
    if(pc === N97_ROM_ADDRESS + 0x2594) Object.assign(record, { step, pc, address: register(7),
        found: { physical: register(0), bytes: register(1) } });
    if(pc === N97_ROM_ADDRESS + 0x259C)
    {
        record.published = { physical: word(record.address + 0x20), bytes: word(record.address + 0x24) };
        assert.deepEqual(record.published, record.found);
    }
}

// Diagnostic regressions flip bytes after the original loader publishes its
// record. The flash cases flip a private copy of the decoded page on read.
function apply_compat_negative(cpu, media, descriptor)
{
    const ram_address = new Map([["descriptor", descriptor], ["toc-size", N97_BOOT_TOC + 36], ["toc-name", N97_BOOT_TOC + 52],
        ["certificate", media.isa.address + 0x80],
        ["certificate-trailer", media.isa.address + 0x200], ["isasw-payload", media.isa.address + media.isa.bytes.length - 1],
        ["dsp0-payload", media.dsp.address + media.dsp.bytes.length - 1]]).get(negative);
    if(ram_address !== undefined)
    {
        const bytes = cpu.read_blob_physical(ram_address, 1).slice();
        bytes[0] ^= 1;
        cpu.write_blob_physical(bytes, ram_address);
        return;
    }
    const nand = cpu.devices.n97_onenand;
    const read = nand.read_main_page;
    const offset = new Map([["root", 0xC], ["keys-signature", 0x444], ["modem-key", 0x21C]]).get(negative);
    assert.ok(offset !== undefined);
    nand.read_main_page = page => {
        const bytes = read(page);
        assert.equal(page, 0x105);
        bytes[0x200 + offset] ^= 1;
        return bytes;
    };
}

function observe_rapido_service(cpu, pc_now, field, register, word, display_visit)
{
    const wasm = cpu.wm.exports;
    const media = cpu.boot_files.media;
    const isasw_record = {};
    let service, result;
    for(let step = 0; step < 500000; step++)
    {
        const pc = pc_now();
        display_visit?.(pc, step);
        observe_isasw_record(isasw_record, pc, step, register, word);
        if(pc === 0xFFFF1208 && !service)
        {
            service = { step, pc, thumb: !!(field("pstate") & 32), registers: [0, 1, 2, 3].map(register), lr: register(14) };
            assert.deepEqual(service.registers, [N97_ROM_ADDRESS + 0x2A08, 0, media.isa.address, 0]);
            assert.equal(service.thumb, true);
            assert.equal(service.lr, N97_ROM_ADDRESS + 0x2890);
            service.return_thumb = !!(service.lr & 1);
            service.descriptor_words = [0, 4, 8, 12].map(offset => word(service.registers[0] + offset));
            service.isasw_header = { magic: word(media.isa.address), startup_offset: word(media.isa.address + 0x148),
                expanded_bytes: word(media.isa.address + 0x3D8), load_address: word(media.isa.address + 0x3DC) };
            assert.deepEqual(service.isasw_header, { magic: 0x809795A3, startup_offset: 0x1000,
                expanded_bytes: media.isa.bytes.length, load_address: media.isa.address });
            if(negative) apply_compat_negative(cpu, media, service.registers[0]);
        }
        if(service && pc === service.lr)
        {
            result = { step, pc, return_value: register(0) };
            wasm["a64_worker_slice"](1);
            display_visit?.(pc_now(), step + 1);
            wasm["a64_worker_slice"](1);
            result.next_branch = pc_now();
            break;
        }
        if(service && (pc === 0xC || pc === 0xFFFF000C))
        {
            result = { step, pc, ifsr: field("a32_ifsr") };
            break;
        }
        wasm["a64_worker_slice"](1);
    }
    assert.ok(service && result, "the retail bootstrap should reach the RAPIDO ROM service");
    assert.deepEqual(isasw_record.published, { physical: media.isa.address, bytes: media.isa.bytes.length });
    if(!cpu.boot_files.bootrom) assert.deepEqual(result, { step: service.step + 1, pc: 0x0C, ifsr: 8 });
    if(values["reject-probe"]) assert.deepEqual(result, { step: service.step + 2, pc: service.lr, return_value: 0,
        next_branch: N97_ROM_ADDRESS + 0x2898 });
    if(result.return_value !== undefined) assert.equal(result.next_branch, result.return_value === 1 ? 0x0890289C : 0x08902898);
    const verification = cpu.devices.n97_rapido_compat?.status();
    if(compat)
    {
        assert.equal(verification, negative ? negative_outcome.get(negative) : "verified");
        assert.equal(result.return_value, negative ? 0 : 1);
    }
    const handoff = compat && !negative && observe_retail_handoff(cpu, result.step + 2, isasw_record, pc_now, field, register, word, display_visit);
    return { sha256, boot_media_sha256: media.digest, bootrom_sha256: !compat && cpu.boot_files.bootrom_digest || null,
        diagnostic_rejection: !!values["reject-probe"], onenand: cpu.devices.n97_onenand?.status(),
        isasw_record, service, result, verification, negative, handoff: handoff || undefined };
}

function observe_retail_handoff(cpu, service_step, isasw_record, pc_now, field, register, word, display_visit)
{
    const wasm = cpu.wm.exports;
    const handoff = { boot_registers: [], cp15: [] };
    const cp15_reads = new Map([[0xC666B36C, ["data_remap", 0]], [0xC666B374, ["instruction_remap", 0]],
        [0xC666B37C, ["peripheral_remap", 0]], [0xC666B660, ["cache_dirty", 1]], [0xC666B6AC, ["block_status", 0]]]);
    const observed = new Set([N97_RAPIDO_SELECT, N97_BOOT_SOURCE, N97_BOOT_SOURCE + 4, N97_BOOT_SOURCE + 8, N97_RESET_STATUS,
        N97_SHARED_CONTROL + 4, N97_SHARED_CONTROL + 8, 0x20032CA8, 0x20032C44, N97_PLL_POWER, N97_PLL_POWER + 4, N97_PLL3, N97_PLL3_CONTROL]);
    let step = service_step;
    function record(owner, offset, width, direction, value)
    {
        const address = cpu.io.ranges[owner].base + Number(offset);
        if(observed.has(address) && handoff.boot_registers.length < 48)
            handoff.boot_registers.push({ pc: pc_now(), step, direction, address, width, value: Number(value) });
    }
    const read_mmio = cpu.io.mmio_read.bind(cpu.io), write_mmio = cpu.io.mmio_write.bind(cpu.io);
    cpu.io.mmio_read = (owner, offset, width) => {
        const value = read_mmio(owner, offset, width);
        record(owner, offset, width, "read", value);
        return value;
    };
    cpu.io.mmio_write = (owner, offset, width, value) => {
        write_mmio(owner, offset, width, value);
        record(owner, offset, width, "write", value);
    };
    cpu.clock.resume();
    for(let elapsed = 0; elapsed < 5000000; elapsed++)
    {
        if(elapsed && elapsed % 32 === 0) cpu.run_hardware_timers(null, cpu.clock.advance_instructions(32));
        const pc = pc_now(), thumb = !!(field("pstate") & 32);
        step = service_step + elapsed;
        display_visit?.(pc, step);
        if((pc === N97_ROM_ADDRESS + 0x2394 || pc === 0x80002394) && !handoff.mapped)
        {
            const record = field("sctlr_el1") & 1 ? supervisor_physical(register(7), field, word) : register(7);
            handoff.mapped = { pc, step, record, virtual: word(record + 0x20), bytes: word(record + 0x24), physical: word(record + 0x74) };
        }
        if(pc === 0x800B3B40 && !handoff.sisa)
        {
            const physical = supervisor_physical(register(4), field, word);
            handoff.sisa = { pc, step, image: register(5), physical, bytes: word(physical + 0x24) };
        }
        if(pc === 0xC6301000 && !handoff.isa_entry)
        {
            handoff.isa_entry = { pc, step, args: [0, 1, 2, 3].map(register), lr: register(14) };
        }
        if(pc === 0xC636280A && !handoff.irq_callback)
        {
            const read = address => word(supervisor_physical(address, field, word));
            const irq = read_hw_conf(handoff.isa_entry.args[2], read).find(record => record.type === 0x0B);
            handoff.irq_callback = { pc, step, table: read(0xC68020C8), slot: irq.payload[1], published: read(irq.payload[1]) };
            assert.equal(handoff.irq_callback.table, irq.payload[0]);
        }
        if(pc === handoff.isa_entry?.lr && !handoff.isa_return) handoff.isa_return = { pc, step, r0: register(0) };
        if(thumb && (pc === 0xC6371454 || pc === 0xC666B72C))
        {
            handoff.rom_dispatch ??= [];
            if(!handoff.rom_dispatch.some(event => event.pc === pc))
            {
                const args = [0, 1, 2, 3].map(register);
                const descriptor = [0, 4, 8, 12].map(offset => word(args[0] + offset));
                const event = { pc, step, args, descriptor, lr: register(14) };
                if(pc === 0xC6371454)
                {
                    // The original caller passes the translated address of the word after its completion field.
                    const virtual = register(4);
                    event.parameter_block = {
                        virtual: virtual + 4,
                        physical: supervisor_physical(virtual + 4, field, word),
                        completion_word: word(supervisor_physical(virtual, field, word)),
                    };
                    event.ttbr = [field("ttbr0_el1"), field("ttbr1_el1")];
                    assert.equal(event.parameter_block.physical, args[2]);
                }
                handoff.rom_dispatch.push(event);
            }
        }
        if(thumb && pc === 0xC666B740 && !handoff.rom_selection)
        {
            // R3 is the original selector read masked by the driver's own code.
            handoff.rom_selection = { pc, step, masked_id: register(3) };
        }
        if(thumb && pc === 0xC666B7F8 && handoff.rom_selection && handoff.rom_selection.arm === undefined)
        {
            const live_word = address => word(supervisor_physical(address, field, word));
            Object.assign(handoff.rom_selection, { arm: live_word(0xC6807000), thumb: live_word(0xC6807004) });
            // The wrapper translates a Thumb address taken from its literal pool
            // and saves it on the stack before transferring to the ROM.
            const virtual = live_word(0xC666B410);
            handoff.rom_continuation = { virtual, physical: supervisor_physical(virtual, field, word) };
        }
        if(pc === handoff.mmu_branch?.target && !handoff.rom_entry)
        {
            const sp = register(13);
            handoff.rom_entry = { pc, step, args: [0, 1, 2, 3].map(register), r8: register(8), lr: register(14), sp,
                stack_top: word(sp), thumb, sctlr: field("sctlr_el1") };
            assert.equal(handoff.rom_entry.stack_top, handoff.rom_continuation?.physical);
        }
        if(pc === 0xC666B6A4) handoff.cp15.push({ pc, step, write: "peripheral_remap", value: register(0) });
        if(pc === 0xC666B6F0 && (field("sctlr_el1") & 1))
        {
            const branch = supervisor_physical(pc + 4, field, word), target = register(1);
            handoff.mmu_off = { pc, step, before: field("sctlr_el1"), ttbr0: field("ttbr0_el1"), ttbr1: field("ttbr1_el1"),
                ttbcr: field("a32_ttbcr"), branch, branch_opcode: word(branch), target,
                target_opcode: cpu.ram_offset(target, 4) < 0 ? undefined : word(target) };
        }
        wasm["a64_worker_slice"](1);
        const vector = pc_now();
        if(cp15_reads.has(pc) && vector === pc + 4)
        {
            const [name, reg] = cp15_reads.get(pc);
            handoff.cp15.push({ pc, step, read: name, value: register(reg) });
        }
        if(pc === handoff.mmu_off?.pc) Object.assign(handoff.mmu_off, { after: field("sctlr_el1"), next_pc: vector });
        if(pc === handoff.mmu_off?.next_pc && vector === handoff.mmu_off.target)
            handoff.mmu_branch ??= { pc, step, target: vector };
        if(vector === 4 || vector === 0xFFFF0004)
        {
            const event = { pc, step: step + 1, vector, lr: register(14) };
            handoff.first_undefined ??= event;
            if(handoff.isa_entry && !handoff.isa_undefined)
            {
                let opcode;
                if(!thumb)
                {
                    const address = field("sctlr_el1") & 1 ? supervisor_physical(pc, field, word) : pc;
                    opcode = word(address);
                }
                handoff.isa_undefined = { ...event, thumb, opcode };
            }
        }
        if([12, 16, 0xFFFF000C, 0xFFFF0010].includes(vector))
        {
            const prefetch = vector % 0x100 === 0xC;
            const far = field("far_el1", prefetch ? 4 : 0), fsr = field(prefetch ? "a32_ifsr" : "esr_el1");
            const physical = vector % 0x100 === 0x10 && (fsr & 0x40F) === 8 && (field("sctlr_el1") & 1) ?
                supervisor_physical(far, field, word) : undefined;
            handoff.abort = { pc, step: step + 1, vector, far, fsr, physical, lr: register(14) };
            break;
        }
    }
    cpu.io.mmio_read = read_mmio;
    cpu.io.mmio_write = write_mmio;
    if(!handoff.abort) handoff.last = { pc: pc_now(), step: step + 1 };
    assert.deepEqual([handoff.mapped?.virtual, handoff.mapped?.physical, handoff.mapped?.bytes],
        [0xC6300000, isasw_record.published.physical, isasw_record.published.bytes]);
    assert.equal(handoff.sisa?.image, handoff.mapped.virtual);
    assert.equal(handoff.isa_entry?.lr, 0x800B3BA0);
    assert.equal(handoff.irq_callback?.published, 0xC6679028);
    const source = handoff.boot_registers.filter(access => access.address === N97_BOOT_SOURCE);
    assert.deepEqual(source.slice(0, 3).map(access => [access.direction, access.width, access.value]),
        [["read", 4, 0], ["read", 4, 0], ["write", 4, 0]]);
    assert.ok(handoff.boot_registers.some(access => access.address === N97_RESET_STATUS && access.direction === "read" && access.value === 0));
    assert.ok(handoff.boot_registers.some(access => access.address === N97_PLL3_CONTROL && access.direction === "read" &&
        access.pc >= 0xC6300000 && (access.value & 0x10)), "the original ISASW must observe the shared PLL lock");
    assert.ok(handoff.cp15.some(access => access.read === "data_remap" && access.value === 0x01C97CC8));
    assert.ok(handoff.cp15.some(access => access.write === "peripheral_remap" && access.value === 0x20000013));
    assert.ok(handoff.mmu_off && !(handoff.mmu_off.after & 1), "original ISASW must reach the MMU disable");
    assert.equal(handoff.mmu_off.branch_opcode, 0xE1A0F001);
    assert.equal(handoff.rom_entry?.pc, 0xFFFF8A94, "original MOV PC,R1 must reach the second RAPIDO ROM entry");
    assert.equal(handoff.rom_entry.thumb, false);

    // The exact stock XIP was SHA-256 checked before starting. These are
    // SecLdd.LDD literal-pool words, observed statically without invoking it.
    const xip_word = address => rom.readUInt32LE(address - 0x80000000);
    const descriptor_address = xip_word(0x800B9720);
    handoff.secldd_selection = { descriptor_address, descriptor: [0, 4, 8, 12].map(offset => xip_word(descriptor_address + offset)),
        selector_pc: 0x800BD820, masked_ids: [0x800BD878, 0x800BD87C].map(xip_word),
        arm: xip_word(0x800BD8B0), thumb: xip_word(0x800BD86C) };
    assert.deepEqual(handoff.secldd_selection.descriptor, handoff.rom_dispatch[0].descriptor);
    assert.equal(handoff.rom_selection.arm, handoff.secldd_selection.arm);
    assert.equal(handoff.rom_selection.thumb, handoff.secldd_selection.thumb);
    assert.equal(handoff.rom_entry.r8, handoff.rom_selection.thumb);
    assert.ok(handoff.secldd_selection.masked_ids.includes(handoff.rom_selection.masked_id));
    return handoff;
}

// Observe the retail cold start from the XIP handoff, without invoking
// any display routine or changing the guest. The XIP digest guards these TRomImageHeader addresses.
function observe_retail_display(cpu, register)
{
    const xip_base = 0x80000000;
    const xip_end = N97_ROM_ADDRESS + rom.length;
    const modules = [
        ["LightPdd.Pdd", 0x800DA050],
        ["LightLdd.Ldd", 0x800DD2E0],
        ["lossi.dll", 0x80113FC0],
        ["d_display.ldd", 0x80120260],
        ["r_display_kernel.dll", 0x80144620],
        ["r_display.dll", 0x8073DAD0],
    ].map(([name, header]) => {
        const code = rom.readUInt32LE(header - xip_base + 20);
        const entry = (rom.readUInt32LE(header - xip_base + 16) & ~1) >>> 0;
        return { name, code, end: code + rom.readUInt32LE(header - xip_base + 32), entry, visits: 0, entry_calls: [] };
    });
    const mmio = { dispc: { reads: 0, writes: 0 }, lossi: { reads: 0, writes: 0 } };
    const { display: hub, n97_dispc: controller, n97_lossi: lossi, n97_panel: panel } = cpu.devices;
    const { io } = cpu;
    const read = io.mmio_read, write = io.mmio_write, update_buffer = hub.sink.update_buffer;
    let frame = null, output_frames = 0, non_black_frames = 0;
    const active_calls = [];
    function count_mmio(owner, offset, direction)
    {
        const address = io.ranges[owner].base + Number(offset);
        if(address >= N97_DISPC_BASE && address < N97_DISPC_BASE + 0x200) mmio.dispc[direction]++;
        if(address >= N97_LOSSI_BASE && address < N97_LOSSI_BASE + 0x30) mmio.lossi[direction]++;
    }
    io.mmio_read = function(owner, offset, width) {
        count_mmio(owner, offset, "reads");
        return read.call(io, owner, offset, width);
    };
    io.mmio_write = function(owner, offset, width, value) {
        count_mmio(owner, offset, "writes");
        return write.call(io, owner, offset, width, value);
    };
    hub.sink.update_buffer = function(layers) {
        // DISPC presents a single opaque RGBA layer.
        const { width, height, data } = layers[0].pixels;
        let non_black_pixels = 0;
        for(let i = 0; i < data.length; i += 4)
            if(data[i] || data[i + 1] || data[i + 2]) non_black_pixels++;
        frame = { width, height, non_black_pixels, rgba_sha256: digest(data) };
        output_frames++;
        if(non_black_pixels) non_black_frames++;
        update_buffer.call(hub.sink, layers);
    };
    return {
        visit(pc, step)
        {
            const active = active_calls.at(-1);
            if(active && pc === ((active.lr & ~1) >>> 0))
            {
                active.returned = { step, result: register(0) | 0 };
                active_calls.pop();
            }
            const address = pc >= N97_ROM_ADDRESS && pc < xip_end ? pc - N97_ROM_ADDRESS + xip_base : pc;
            if(address < modules[0].code || address >= modules.at(-1).end) return;
            const module = modules.find(item => address >= item.code && address < item.end);
            if(module)
            {
                module.visits++;
                if(address === module.entry)
                {
                    const called = { pc, step, reason: register(0) | 0, lr: register(14) };
                    module.entry_calls.push(called);
                    active_calls.push(called);
                }
            }
        },
        report()
        {
            const state = { controller: controller.status(), lossi: lossi.status(), panel: panel.status() };
            hub.request_frame(true);
            assert.ok(frame, "the N97 display source must publish its current frame");
            return { modules, mmio, ...state, output_frames, non_black_frames, frame };
        },
        close()
        {
            io.mmio_read = read;
            io.mmio_write = write;
            hub.sink.update_buffer = update_buffer;
        },
    };
}

// Inventory the exact RM-505 CORE from the original VPL. Matches are byte
// provenance only. This probe does not execute any embedded toolbox image.
async function inventory_original_core(filename, descriptor)
{
    const bytes = await read_exact(filename, 111_508_110);
    const sha256 = digest(bytes);
    assert.equal(sha256, "d5b3cd2467edb812ab3a582b67168a962b47e40d222f90c52e89428bdbcf8a20", "expected stock RM-505 0576555 CORE");
    const parsed = parse_fpsx(bytes);
    const group = name => parsed.groups.find(item => item.label === name);
    const loader = Buffer.from(fpsx_group_data(parsed, group("RAP3NAND")));
    const key = Buffer.alloc(16);
    descriptor.forEach((word, i) => key.writeUInt32LE(word, 4 * i));
    const loader_descriptor = loader.indexOf(key);
    const tlv = parsed.tlvs.find(item => item.type === 0xFA);
    const toolbox = bytes.subarray(tlv.data_offset, tlv.data_offset + tlv.size);
    const toolbox_loader = toolbox.indexOf(loader);
    assert.equal(loader_descriptor, 0x15068);
    assert.ok(toolbox_loader >= 0, "the stock toolbox contains a copy of the outer loader");
    const toolbox_matches = [];
    for(let at = toolbox.indexOf(key); at !== -1; at = toolbox.indexOf(key, at + 1))
        toolbox_matches.push(at);
    const pa_records = ["PASUBTOC", "PAPUBKEYS"].map(label => {
        const { certificates } = group(label);
        const { type, start, end } = certificates[0];
        return { label, type, start, end, alternatives: certificates.length };
    });
    const flash_targets = [...new Set(parsed.groups.map(item => item.space.join(",")))];
    return { sha256, flash_targets, pa_records, loader: { bytes: loader.length, sha256: digest(loader), descriptor_offset: loader_descriptor },
        toolbox: { bytes: toolbox.length, loader_offset: toolbox_loader, descriptor_matches: toolbox_matches } };
}

// Observe a supervisor mapping from the live short-descriptor tables.
function supervisor_descriptor(address, field)
{
    const n = field("a32_ttbcr") & 7;
    const use_ttbr1 = !!n && address >>> (32 - n) !== 0;
    const table = (field(use_ttbr1 ? "ttbr1_el1" : "ttbr0_el1") & (-1 << (use_ttbr1 ? 14 : 14 - n))) >>> 0;
    const index = (address >>> 20) & (use_ttbr1 ? 0xFFF : (1 << (12 - n)) - 1);
    return table + 4 * index;
}

function supervisor_physical(address, field, word)
{
    const first = word(supervisor_descriptor(address, field));
    if((first & 3) === 2) return ((first & 0xFFF00000) | (address & 0xFFFFF)) >>> 0;
    assert.equal(first & 3, 1);
    const page = word(((first & 0xFFFFFC00) >>> 0) + (address >>> 12 & 255) * 4);
    if(page & 2) return ((page & 0xFFFFF000) | (address & 0xFFF)) >>> 0;
    assert.equal(page & 3, 1);
    return ((page & 0xFFFF0000) | (address & 0xFFFF)) >>> 0;
}

function read_hw_conf(start, read)
{
    const records = [];
    let address = start;
    for(let n = 0; n < 64; n++)
    {
        const type = read(address), length = read(address + 4);
        assert.ok(length >= 8 && length <= 256 && !(length % 4), "invalid original HW_CONF record length");
        const payload = Array.from({ length: length / 4 - 2 }, (_, i) => read(address + 8 + i * 4));
        records.push({ address, type, length, payload });
        if(type === 2) return records;
        address = type === 3 ? payload[0] : address + length;
    }
    throw new Error("original HW_CONF did not terminate");
}

// Execute the original ISASW entry on a restored diagnostic copy of the AP
// state. Supply the mappings and variant record fields that AP-only omitted,
// then let the original wrapper inspect the image and make the call.
function observe_isa_entry(isa, sisa, cpu, state, pc_now, field, register, word)
{
    assert.equal(pc_now(), sisa.pc);
    assert.equal(sisa.record.image, 0);
    const base = 0xC6300000, payload = base + 0x400;
    const entry_offset = new DataView(isa.bytes.buffer, isa.bytes.byteOffset).getUint32(0x148, true);
    assert.equal(entry_offset, 0x1000);
    const entry = base + entry_offset;
    const read = address => word(supervisor_physical(address, field, word));
    const irq_record = sisa.hw_conf.find(record => record.type === 0x0B);
    assert.equal(irq_record.payload.length, 2);
    const previous_callback = read(irq_record.payload[1]);
    const align_page = size => Math.ceil(size / 0x1000) * 0x1000;
    const assert_unused = (address, size) => assert.ok(cpu.read_blob_physical(address, size).every(byte => !byte),
        "diagnostic scratch range is already used at 0x" + address.toString(16));
    let next_table = 0x0A284000;
    function map_pages(virtual, physical, size, read_only = false)
    {
        assert_unused(physical, align_page(size));
        for(let offset = 0; offset < size; offset += 0x1000)
        {
            const address = virtual + offset;
            const slot = supervisor_descriptor(address, field);
            let first = word(slot);
            if(!first)
            {
                assert_unused(next_table, 0x400);
                first = next_table | 1;
                next_table += 0x400;
                cpu.write32_physical(slot, first);
            }
            assert.equal(first & 3, 1);
            const page_slot = ((first & 0xFFFFFC00) >>> 0) + 4 * (address >>> 12 & 255);
            assert.equal(word(page_slot), 0, "the new diagnostic page must not replace a mapped page");
            // ARMv6 extended small page: AP=3, APX set only for image pages.
            cpu.write32_physical(page_slot, physical + offset | (read_only ? 0x232 : 0x32));
        }
    }
    map_pages(base, isa.address, isa.bytes.length, true);
    map_pages(0xC6800000, 0x0A000000, 0x280000); // XIP +0x208C reserves this extent for ISASW.
    map_pages(0xC60F0000, 0x0A280000, 0x2000); // XIP +0x233C uses an 8 KiB mapping.
    cpu.write_blob_physical(isa.bytes, isa.address);
    const sp = register(13), return_address = read(sp + 12);
    assert.equal(return_address, 0x800B3BA0);
    const saved_regs = [0, 4, 8].map(offset => read(sp + offset));
    cpu.write32_physical(sisa.record.physical + 0x20, base);
    cpu.write32_physical(sisa.record.physical + 0x24, isa.bytes.length);
    const wrapper = 0x800B3B38; // ldr r5, [r4, #0x20]
    state.setUint32(STATE_OFFSETS.pc, wrapper, true);
    const wasm = cpu.wm.exports;
    wasm["a64_restored"]();
    const checkpoints = new Map([[entry, "entry"], [payload + 0x62326, "early_init"], [payload + 0x623E4, "irq_services_record"],
        [payload + 0x62408, "publish_irq_callback"]]);
    const visits = [];
    cpu.clock.resume();
    let result, entry_context;
    for(let step = 0; step < 100000; step++)
    {
        const pc = pc_now();
        if(checkpoints.has(pc)) visits.push({ step, pc, stage: checkpoints.get(pc), thumb: !!(field("pstate") & 32) });
        if(pc === entry)
        {
            entry_context = { args: [0, 1, 2, 3].map(register), saved_regs: [4, 5, 6].map(register), sp: register(13), lr: register(14) };
            assert.deepEqual(entry_context, { args: sisa.startup_args, saved_regs, sp: sp + 16, lr: return_address });
        }
        if(pc === payload + 0x6240A)
        {
            result = { step, pc };
            break;
        }
        if(step && step % 32 === 0) cpu.run_hardware_timers(null, cpu.clock.advance_instructions(32));
        wasm["a64_worker_slice"](1);
    }
    assert.ok(result, "original ISASW probe must publish the IRQ bridge");
    assert.deepEqual(visits.map(({ pc, thumb }) => [pc, thumb]), Array.from(checkpoints.keys(), pc => [pc, pc !== entry]));
    const irq_callback_table = read(0xC68020C8), irq_callback = read(irq_record.payload[1]);
    assert.equal(irq_callback_table, irq_record.payload[0]);
    assert.equal(irq_callback, 0xC6679028);
    assert.notEqual(irq_callback, previous_callback, "the original ISASW callback must be published by the original code");
    return { kind: "isolated_ap_diagnostic", wrapper, entry, entry_context, visits, result,
        irq_callback_table, previous_callback, irq_callback };
}

try
{
    await new Promise((resolve, reject) => {
        vm.add_listener("emulator-loaded", resolve);
        vm.add_listener("emulator-error", reject);
    });
    const cpu = vm.v86.cpu;
    const wasm = cpu.wm.exports;
    const state = new DataView(cpu.wasm_memory.buffer, cpu.state_base);
    const pc_now = () => Number(cpu.read_pc());
    const field = (name, offset = 0) => state.getUint32(STATE_OFFSETS[name] + offset, true);
    const register = n => state.getUint32(STATE_OFFSETS.x + n * 8, true);
    const word = address => {
        const offset = cpu.ram_offset(address, 4);
        assert.ok(offset >= 0, "diagnostic expects SDRAM at 0x" + address.toString(16));
        return new DataView(cpu.mem8.buffer, cpu.mem8.byteOffset + offset, 4).getUint32(0, true);
    };
    assert.equal(cpu.profile, "arm1136");
    assert.equal(pc_now(), N97_ROM_ADDRESS);
    if(values["boot-media"])
    {
        const display = display_evidence ? observe_retail_display(cpu, register) : null;
        try
        {
            const boot = observe_rapido_service(cpu, pc_now, field, register, word, display?.visit);
            if(display) boot.display = display.report();
            if(original_core) boot.original_core = await inventory_original_core(original_core, boot.handoff.rom_dispatch[0].descriptor);
            console.log(JSON.stringify(boot, null, 2));
        }
        finally
        {
            display?.close();
        }
    }
    else
    {
        await observe_kernel(cpu, wasm, state, pc_now, field, register, word);
    }
}
finally
{
    await vm.destroy();
}

async function observe_kernel(cpu, wasm, state, pc_now, field, register, word)
{
    const boot_registers = Array.from({ length: 4 }, (_, i) => register(i));
    const toc_entry = { start: N97_BOOT_TOC + (word(N97_BOOT_TOC) | 0), bytes: word(N97_BOOT_TOC + 4) };
    assert.deepEqual(toc_entry, { start: 0x088FF000, bytes: 4096 + rom.length });

    const mmio = [];
    let step = 0;
    function log_access(owner, offset, width, direction, value)
    {
        mmio.push({ step, pc: pc_now(), direction, address: cpu.io.ranges[owner].base + Number(offset), width, value: Number(value) });
    }
    const read = cpu.io.mmio_read.bind(cpu.io);
    const write = cpu.io.mmio_write.bind(cpu.io);
    cpu.io.mmio_read = (owner, offset, width) => {
        const value = read(owner, offset, width);
        log_access(owner, offset, width, "read", value);
        return value;
    };
    cpu.io.mmio_write = (owner, offset, width, value) => {
        write(owner, offset, width, value);
        log_access(owner, offset, width, "write", value);
    };

    const entry = 0x8004F110;
    const variant_start = 0x800973C4;
    const variant_clock_exit = 0x8009746C;
    let configuration, mmu_enabled_at, first_linked_pc, ekern, variant, irq, dma, next_abort;
    const isasw_record = {};
    let sisa, before_sisa;
    const dma_entry = 0x8009D114;
    const first_instructions = [];
    const init_poll_interval = 32;
    cpu.clock.resume();
    for(; step < (values["ap-only"] ? 5000000 : 3500000); step++)
    {
        // This tool single-steps with the VM stopped. Let the normal
        // clock and device scheduler advance for the instructions just run.
        if(step && step % init_poll_interval === 0)
        {
            cpu.run_hardware_timers(null, cpu.clock.advance_instructions(init_poll_interval));
        }
        const pc = pc_now();
        observe_isasw_record(isasw_record, pc, step, register, word);
        const pstate = field("pstate");
        const sctlr = field("sctlr_el1");
        if(first_instructions.length < 4) first_instructions.push(pc - N97_ROM_ADDRESS);
        if(!mmu_enabled_at && (sctlr & 1)) mmu_enabled_at = { pc, step, sctlr };
        if(!first_linked_pc && pc >= 0x80000000 && pc < 0x80000000 + rom.length) first_linked_pc = pc;
        if(pc === N97_ROM_ADDRESS + 0x1978)
        {
            const superpage = register(10);
            configuration = { superpage, ram_base: word(superpage + 0x102C), ram_size: word(superpage + 0x1030),
                mcu_hz: word(superpage + 0x105C), startup_reason: word(superpage + 0x4C), toc_address: word(superpage + 0x1620) };
        }
        if(pc === entry) ekern = { pc, step, sctlr, registers: [register(0), register(1)] };
        if(pc === variant_start) variant = { pc, step };
        if(pc === variant_clock_exit) variant.clocks_returned_at = step;
        if(!irq && pc === 0xFFFF0018)
        {
            irq = { pc, step, mode: pstate & 31, lr: register(14),
                spsr: state.getUint32(STATE_OFFSETS.a32_spsr + 4, true) };
        }
        if(irq && !irq.scheduler && pc === 0x8004F31C) irq.scheduler = { pc, step, mode: pstate & 31 };
        if(values["ap-only"] && !dma && pc === dma_entry) dma = { pc, step, lr: register(14) };
        if(dma && !dma.first_request && pc === 0x8009D13C)
        {
            dma.first_request = { pc, step, address: (register(0) + 0x484) >>> 0, width: 4, value: register(6) };
        }
        if(dma && !dma.returned && pc === dma.lr) dma.returned = { pc, step };
        if(values["ap-only"] && pc === 0x800B3B40 && !sisa)
        {
            const virtual = register(4), physical = supervisor_physical(virtual, field, word);
            sisa = { pc, step, record: { virtual, physical, image: word(physical + 0x20), bytes: word(physical + 0x24) },
                address_read: register(5), expected_magic: register(0), startup_args: [0x78, 0x7C, 0x80, 0x84].map(offset => word(physical + offset)) };
            assert.equal(sisa.address_read, sisa.record.image);
            assert.equal(sisa.expected_magic, 0x809795A3);
            sisa.hw_conf = read_hw_conf(sisa.startup_args[2], address => word(supervisor_physical(address, field, word)));
            if(values["isa-probe"]) before_sisa = await vm.save_state();
        }
        wasm["a64_worker_slice"](1);
        if(irq && !irq.returned && (pstate & 31) === 0x12 && [0x8004F354, 0x8004F370, 0x8008D120].includes(pc))
        {
            irq.returned = { instruction: pc, pc: pc_now(), step: step + 1, cpsr: (field("pstate") | field("nzcv")) >>> 0 };
        }
        if(pc === entry) ekern.pc_after_first_instruction = pc_now();
        if(!values["ap-only"] && irq?.returned) break;
        if(!next_abort && [0xC, 0x10, 0xFFFF000C, 0xFFFF0010].includes(pc_now()))
        {
            if(!dma?.returned)
                assert.fail(`Unexpected abort after PC 0x${pc.toString(16)} at VA 0x${field("far_el1").toString(16)}`);
            next_abort = { pc, step: step + 1, vector: pc_now(), far: field("far_el1"),
                fsr: field(pc_now() % 0x100 === 0x10 ? "esr_el1" : "a32_ifsr") };
        }
        if(next_abort && step % init_poll_interval === 0 && (step - next_abort.step > 50000 ||
            cpu.devices.n97_xti.packets().some(packet => /FAULT: Exception/.test(packet.data)))) break;
    }

    assert.deepEqual(first_instructions, [0, 0x1880, 0x1884, 0x1888]);
    const sram = cpu.devices.n97_sram.get_state()[1];
    const stored = new DataView(sram.buffer, sram.byteOffset, sram.byteLength);
    assert.deepEqual(Array.from({ length: 4 }, (_, n) => stored.getUint32(0x10 + n * 4, true)), boot_registers);
    assert.deepEqual(configuration, { superpage: values["ap-only"] ? 0x0FF00000 : 0x0FD00000, ram_base: N97_RAM_BASE, ram_size: N97_RAM_SIZE,
        mcu_hz: 433920000, startup_reason: 0x00012400, toc_address: N97_BOOT_TOC });
    assert.equal(mmu_enabled_at?.pc, 0x08900A88);
    assert.equal(mmu_enabled_at.sctlr, 0x00C52879);
    assert.equal(first_linked_pc, 0x80000A90);
    assert.deepEqual(ekern, { pc: entry, step: ekern?.step, sctlr: 0x00C5387D,
        registers: [0x80000000, 0xC0000000], pc_after_first_instruction: 0x8004F114 });
    assert.ok(mmu_enabled_at.step < ekern.step && ekern.step < variant.step && variant.step < variant.clocks_returned_at);
    for(const [address, value] of [[N97_RAPIDO_SELECT, 0x3110A], [N97_L2_BASE + 0x77C, 0], [N97_L2_BASE + 0x104, 0x30000],
        [N97_CPU_PLL, 0xE29], [N97_PLL3_CONTROL, 0xD490]])
    {
        assert.ok(mmio.some(read => read.direction === "read" && read.address === address && read.width === 4 && read.value === value));
    }
    assert.equal(irq?.mode, 0x12, "the board timer must enter the original IRQ vector");
    assert.equal(irq.scheduler?.mode, 0x13, "the original IRQ path must enter the SVC scheduler");
    assert.equal(irq.returned?.pc, irq.lr - 4, "the exception return must resume the interrupted instruction");
    assert.equal(irq.returned.cpsr, irq.spsr, "the exception return must restore the interrupted CPSR");
    const board_init = mmio.filter(access => access.pc >= 0x800974A4 && access.pc < 0x8009759C &&
        access.direction === "write" && access.address >= 0x20031C10 && access.address <= 0x20031D30);
    assert.equal(board_init.length, 18);
    assert.equal(new Set(board_init.map(access => access.address)).size, board_init.length);
    const tick_ports = new Set([0x200401A4, 0x200401C4, 0x20400008, 0x2040000C, 0x20400080]);
    const first_interval = mmio.find(access => access.pc === 0x8008E4B0 && access.address === 0x200401A4);
    assert.ok(first_interval, "the original variant must arm the millisecond timer");
    const tick_bus = mmio.filter(access => access.step >= first_interval.step && access.step <= irq.returned.step &&
        tick_ports.has(access.address));
    assert.deepEqual(tick_bus.map(({ direction, address, value }) => [direction, address, value]), [
        ["write", 0x200401A4, 9600], ["write", 0x2040000C, 35], ["read", 0x20400008, 35],
        ["read", 0x200401C4, 0], ["write", 0x200401C4, 9600], ["read", 0x20400008, 0xFFFFFFFF],
        ["read", 0x20400080, 0],
    ]);
    if(values["ap-only"])
    {
        assert.deepEqual(isasw_record.published, { physical: 0, bytes: 0 });
        assert.ok(sisa && next_abort?.pc === sisa.pc && next_abort.far === 0 && next_abort.fsr === 5,
            "the AP diagnostic must observe the original ISASW consumer fault on its absent image");
        assert.equal(sisa.record.physical, isasw_record.address);
        assert.ok(dma?.first_request && dma.step > irq.returned.step, "the AP diagnostic must reach the original DMA extension");
        assert.equal(dma.first_request.address, 0xC6040C04);
        assert.equal(dma.first_request.value, 1);
        assert.ok(dma.returned?.step > dma.step, "the original DMA channel initialization must return");
        for(let channel = 0; channel < 6; channel++)
        {
            const base = 0x20040C00 + channel * 0x400;
            const access = mmio.filter(({ address }) => address >= base && address <= base + 8);
            assert.deepEqual(access.slice(0, 6).map(({ direction, address, width, value }) => [direction, address - base, width, value]),
                [["write", 4, 4, 1], ["write", 0, 4, 2], ["read", 0, 4, 0x6E],
                    ["write", 8, 4, 0], ["read", 8, 4, 0], ["write", 4, 4, 0]]);
        }
    }
    const devices = cpu.get_diagnostics().symbian;
    assert.equal(devices.l2_enabled, true);
    assert.equal(devices.clocks.configured_cpu_hz, 433920000);
    const stop_pc = pc_now();
    const tick_state = cpu.devices.n97_os_timer.get_state();
    const interrupt_state = cpu.devices.n97_interrupts.get_state();
    const snapshot = await vm.save_state();
    await vm.restart("power-on");
    assert.equal(pc_now(), N97_ROM_ADDRESS);
    const reset_devices = cpu.get_diagnostics().symbian;
    assert.equal(reset_devices.l2_enabled, false);
    assert.equal(reset_devices.clocks.pll3_locked, false);
    assert.equal(cpu.devices.n97_os_timer.get_state()[4], null);
    await vm.restore_state(snapshot);
    assert.equal(pc_now(), stop_pc);
    assert.deepEqual(cpu.get_diagnostics().symbian, devices);
    assert.deepEqual(cpu.devices.n97_os_timer.get_state(), tick_state);
    assert.deepEqual(cpu.devices.n97_interrupts.get_state(), interrupt_state);
    let isa_probe;
    if(before_sisa)
    {
        await vm.restore_state(before_sisa);
        const media = read_n97_boot_media(await readFile(values["isa-probe"]), sha256);
        assert.equal(media.digest, "de16da82ffe3a83fc376fefaa494470850648d5b0aec6d4507c931ada1075e74", "original 0576555 boot media");
        isa_probe = observe_isa_entry(media.isa, sisa, cpu, state, pc_now, field, register, word);
    }
    console.log(JSON.stringify({ sha256, load_address: N97_ROM_ADDRESS, boot_registers, first_instructions,
        configuration, toc_entry, mmu_enabled_at, first_linked_pc, ekern, variant, instructions_per_ms,
        irq, tick_bus, dma, isasw_record, sisa, next_abort, isa_probe, devices, reset_devices, mmio }, null, 2));
}
