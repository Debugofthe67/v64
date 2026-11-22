// Physical Syborg board and the reset stub captured in S0.
// Register contracts follow the pinned qembian board and Symbian BSP.
// See docs/symbian-syborg-reference.md.
import { DisplayHub } from "../display.js";
import { sha256_hex } from "../image/sha256.js";
import { syborg_accelerometer, syborg_orientation } from "./syborg_accelerometer.js";
import { syborg_audio } from "./syborg_audio.js";
import { syborg_irq_controller, syborg_rtc, syborg_timer, syborg_uart } from "./syborg_devices.js";
import { syborg_framebuffer } from "./syborg_framebuffer.js";
import { syborg_graphics } from "./syborg_graphics.js";
import { validate_syborg_artifacts } from "./syborg_import.js";
import { syborg_keyboard, syborg_pointer } from "./syborg_input.js";
import { enable_syborg_isc_data } from "./syborg_isc_data.js";
import { syborg_install_channel } from "./syborg_install_channel.js";
import { syborg_install_rom } from "./syborg_install_rom.js";
import { syborg_modem } from "./syborg_modem.js";
import { blank_syborg_card, syborg_nvmemory } from "./syborg_nvmemory.js";
import { SYBORG_DIAGNOSTIC, SYBORG_PROFILE, SYBORG_MIB } from "./syborg_profile.js";

export const SYBORG_LAYOUT_VERSION = 2;
const PLATFORM_ADDRESS = SYBORG_PROFILE.devicetree_address - 0x1000;
const DTB_OFFSET = 0x1000, CONFIG_OFFSET = 0x400, DEVICE_ID_OFFSET = 0x800;
const BOOT_DTB_ADDRESS = SYBORG_PROFILE.ram_size / 2;
const STUB = Uint8Array.from([
    0x00, 0x00, 0xA0, 0xE3, // mov r0, #0
    0x04, 0x10, 0x9F, 0xE5, // ldr r1, [pc, #4]
    0x04, 0x20, 0x9F, 0xE5, // ldr r2, [pc, #4]
    0x04, 0xF0, 0x9F, 0xE5, // ldr pc, [pc, #4]
    0x00, 0x00, 0x00, 0x00, // Board ID
    0x00, 0x00, 0x60, 0x05, // r2, reference boot information address
    0x00, 0x00, 0x01, 0x00, // XIP physical entry
]);

// ARM's boot loader passes a tree adjusted for the installed RAM. Only the
// pinned, hash-checked 5800 tree uses this layout. The platform window still
// exposes the original bytes, as it does in QEMU.
function syborg_boot_dtb(source, memory_size)
{
    const view = new DataView(source.buffer, source.byteOffset, source.byteLength);
    const struct_end = view.getUint32(8) + view.getUint32(36);
    const root_end = struct_end - 8;
    const chosen = Uint8Array.of(0, 0, 0, 1, 0x63, 0x68, 0x6F, 0x73, 0x65, 0x6E, 0, 0, 0, 0, 0, 2);
    const tree = new Uint8Array(source.length + chosen.length);
    tree.set(source.subarray(0, root_end));
    tree.set(chosen, root_end);
    tree.set(source.subarray(root_end), root_end + chosen.length);
    const output = new DataView(tree.buffer);
    output.setUint32(4, tree.length);
    output.setUint32(12, view.getUint32(12) + chosen.length);
    output.setUint32(36, view.getUint32(36) + chosen.length);
    // Second cell of /memory@0's reg property in the pinned input tree.
    output.setUint32(0x10C, memory_size);
    return tree;
}

export async function syborg_boot_files(settings)
{
    const media = settings.syborg_media;
    const rom = new Uint8Array(media["rom"]);
    const rofs = new Uint8Array(media["rofs"]);
    const devicetree = new Uint8Array(media["devicetree"]);
    const manifest_bytes = new Uint8Array(media["manifest"]);
    const diagnostic = settings.symbian[SYBORG_DIAGNOSTIC] === true;
    const identity = diagnostic ? "diagnostic:" + [rom, rofs, devicetree].map(bytes => sha256_hex(bytes)).join(":") : sha256_hex(manifest_bytes);
    if(settings.symbian["manifest_sha256"] !== undefined && settings.symbian["manifest_sha256"] !== identity)
        throw new Error("Syborg manifest differs from the imported firmware");
    const validation = diagnostic ? null : await validate_syborg_artifacts(manifest_bytes, { rom, rofs, devicetree });
    const profile = validation?.profile || SYBORG_PROFILE;
    if(rom.length < 4 || rom.length > BOOT_DTB_ADDRESS - profile.rom_address || rofs.length > profile.rofs_window_size ||
        devicetree.length > 0x7000)
        throw new Error("Syborg boot artifacts exceed their physical windows");
    const disks = [media["nvmemory"] || null, media["nvmemory2"] || blank_syborg_card()];
    for(const disk of disks)
        if(disk && (!disk.byteLength || disk.byteLength % 512 || disk.byteLength / 512 > 0xFFFFFFFF))
            throw new Error("Syborg NVMemory image size must be a positive multiple of 512 bytes, within 2 TiB");
    const platform_dtb = devicetree.slice();
    const boot_dtb = validation ? syborg_boot_dtb(devicetree, profile.ram_size) : platform_dtb;
    const network = settings.symbian["network"] === true;
    const install_rom = validation && media["nvmemory2"] && settings.symbian["install_bridge"] === true ?
        syborg_install_rom(rom, validation.xip, BOOT_DTB_ADDRESS - profile.rom_address) : null;
    const boot_rom = install_rom || rom.slice();
    if(network && validation) enable_syborg_isc_data(boot_rom, validation.xip);
    return { profile, rom: boot_rom, rofs, devicetree: platform_dtb, boot_dtb, disks, identity, network, install_bridge: !!install_rom };
}

export function load_syborg_rom(cpu, boot)
{
    cpu.write_blob_physical(STUB, 0);
    cpu.write_blob_physical(boot.rom, boot.profile.rom_address);
    if(boot.boot_dtb.length) cpu.write_blob_physical(boot.boot_dtb, BOOT_DTB_ADDRESS);
    cpu.wm.exports["a32_boot_with_registers"](0, 0, 0, 0, 0);
}

function create_platform(cpu, boot)
{
    const data = new Uint8Array(0x8000);
    new DataView(data.buffer).setUint32(0, 0xC51D1000, true);
    new DataView(data.buffer).setUint32(4, DTB_OFFSET, true);
    new DataView(data.buffer).setUint32(12, boot.profile.ram_size / SYBORG_MIB, true);
    const encoder = new TextEncoder();
    data.set(encoder.encode(boot.profile.platform_config), CONFIG_OFFSET);
    data.set(encoder.encode(boot.profile.id), DEVICE_ID_OFFSET);
    data.set(boot.devicetree, DTB_OFFSET);
    cpu.io.register_mmio(PLATFORM_ADDRESS, data.length, {
        name: "Syborg platform",
        read(offset, width)
        {
            let value = 0n;
            for(let i = 0; i < width; i++) value |= BigInt(data[offset + i] || 0) << BigInt(8 * i);
            return value;
        },
        write(offset, width, value)
        {
            if(offset !== 8 || width > 4) return;
            if(value === 1) cpu.wm.exports["a64_request_power_off"]();
            if(value === 2) cpu.wm.exports["a64_request_reset"]();
        },
    });
}

// Other board drivers see down or absent hardware in this offline profile.
function map_offline_slots(cpu, accelerated)
{
    for(const [address, length, name, id] of [
        [0xC000A000, 0x2000, "Syborg hostfs and snapshot slots", 0],
        [0xC000C000, 0x1000, "Syborg offline Ethernet", 0xC51D0040],
        ...(accelerated ? [] : [[0xC000F000, 0x1000, "Syborg optional graphics slot", 0]]),
    ])
    {
        cpu.io.register_mmio(address, length, {
            name,
            read(offset) { return offset < 4 ? id >>> (offset * 8) : 0; },
            write() {},
        });
    }
}

export function create_syborg_board(cpu, boot, bus, screen, graphics = null, privileged = () => false)
{
    const backing = cpu.memory_size[0];
    const flash = boot.profile.rofs_address;
    const length = boot.profile.rofs_window_size;
    const wasm = cpu.wm.exports;
    if(!wasm["a64_bus_map_rom"](flash, 0, length, 0, backing))
        throw new Error("Syborg could not map its read-only ROFS window");
    new Uint8Array(cpu.wasm_memory.buffer, cpu.mem8.byteOffset + backing, length).set(boot.rofs);
    wasm["a64_bus_written"](backing, boot.rofs.length);
    boot.rofs = null;

    create_platform(cpu, boot);
    map_offline_slots(cpu, !!graphics);
    const accelerometer = syborg_accelerometer(cpu, bus);
    const gpu = graphics ? syborg_graphics(cpu, graphics, privileged) : null;
    const hub = new DisplayHub(bus, screen);
    const irq = syborg_irq_controller(cpu);
    const timer = syborg_timer(cpu, irq.source(1));
    const audio = syborg_audio(cpu, bus);
    const modem = syborg_modem(cpu, irq, boot.network, bus, audio);
    const install = syborg_install_channel(bus, bytes => ports[1].queue_packet(bytes), boot.install_bridge);
    const ports = [0, 1, 2, 3].map(port => syborg_uart(cpu, bus, port, irq.source(5 + port),
        port === 1 && boot.install_bridge ? install.receive : null));
    const [nvmemory, nvmemory2] = boot.disks;
    const disks = [
        syborg_nvmemory(cpu, 0xC0010000, "NVMemory C:", nvmemory, irq.source(12)),
        syborg_nvmemory(cpu, 0xC000D000, "NVMemory E:", nvmemory2, irq.source(14)),
    ];
    const rtc = syborg_rtc(cpu);
    const keyboard = syborg_keyboard(cpu, bus, irq.source(2));
    const pointer = syborg_pointer(cpu, bus, irq.source(3), () => framebuffer.rotation());
    const framebuffer = syborg_framebuffer(cpu, hub, irq.source(4));
    const devices = [
        irq, timer, rtc, keyboard, pointer, framebuffer, ...ports, modem, ...disks,
    ];
    return {
        nvmemory, nvmemory2,
        timer(now)
        {
            const was_asserted = irq.asserted();
            const next = Math.min(timer.poll(now), hub.timer(now), audio.poll(now), modem.poll(now));
            return !was_asserted && irq.asserted() ? 0 : next;
        },
        reset() { for(const device of devices) device.reset?.(); gpu?.reset(); audio.reset(); install.reset(); },
        get_state()
        {
            return [boot.identity, devices.map(device => device.get_state()), gpu?.get_state() ?? null,
                boot.network, audio.get_state(), install.get_state(), accelerometer.get_state()];
        },
        check_state(state)
        {
            if(state?.[0] !== boot.identity || state[1]?.length !== devices.length)
                throw new Error("The snapshot requires the same Syborg firmware and device layout");
            if(!!state[2] !== !!gpu || gpu && (!(state[2] instanceof Uint32Array) || state[2].length !== 10))
                throw new Error("The snapshot requires the original Syborg graphics backend");
            if((state[3] === true) !== !!boot.network)
                throw new Error("The snapshot requires the original Syborg network mode");
            if(state[6] !== undefined && (!Array.isArray(state[6]) || !syborg_orientation(state[6][0]) ||
                state[6][1] !== (state[6][1] >>> 0)))
                throw new Error("The snapshot has invalid Syborg accelerometer state");
            disks[0].check_state(state[1][devices.length - 2]);
            disks[1].check_state(state[1][devices.length - 1]);
        },
        set_state(state)
        {
            devices.forEach((device, index) => device.set_state(state[1][index]));
            gpu?.set_state(state[2]);
            audio.set_state(state[4]);
            install.set_state(state[5]);
            accelerometer.set_state(state[6]);
        },
        network_status() { return modem.network_status(); },
        display: hub,
    };
}
