import { BlockBackend, block_drop_holds } from "../block_backend.js";
import { check_disk_state, restore_disk_state } from "../disk_writeback.js";
import { WriteOverlay } from "../image/overlay.js";
import { sha256_hex } from "../image/sha256.js";
import { syborg_registers } from "./syborg_devices.js";
import { SYBORG_PROFILE } from "./syborg_profile.js";

const SECTOR_SIZE = 512;
const ID = 0, OFFSET = 1, SIZE = 2, DIRECTION = 3, EXECUTE = 4, SHARED_BASE = 5,
    SECTORS = 6, SHARED_SIZE = 7, STATUS = 8, ENABLE = 9;

// The reference launcher attaches a blank card when nvmemory2 is omitted.
// Only sectors the guest changes take host memory.
export function blank_syborg_card()
{
    const byte_length = SYBORG_PROFILE.default_card_size;
    const overlay = new WriteOverlay(byte_length, undefined, "Syborg transient E:");
    return {
        byteLength: byte_length,
        seed_identity: "blank-syborg-card",
        get(start, length, done)
        {
            const bytes = new Uint8Array(length);
            overlay.apply(start, bytes);
            done(bytes);
        },
        set(start, bytes, done) { done(overlay.write(start, bytes)); },
        get_state() { return overlay.get_state(); },
        check_state([indices, chunks]) { overlay.check_state(indices, chunks); },
        set_state([indices, chunks]) { overlay.set_state(indices, chunks); },
    };
}

export function syborg_nvmemory(cpu, address, name, disk, set_irq)
{
    const registers = new Uint32Array(10);
    const backend = disk ? new BlockBackend(cpu, disk) : null;
    const sectors = disk ? disk.byteLength / SECTOR_SIZE : 0;
    const identity = disk?.buffer instanceof ArrayBuffer ? sha256_hex(new Uint8Array(disk.buffer)) : disk?.seed_identity || null;
    let busy = false;
    let pending = false;

    function execute()
    {
        if(busy) return;
        const start = registers[OFFSET] * SECTOR_SIZE;
        const count = registers[SIZE], length = count * SECTOR_SIZE;
        const direction = registers[DIRECTION], base = registers[SHARED_BASE];
        const finish = status => {
            registers[STATUS] = status;
            busy = false;
            pending = true;
            set_irq(true);
        };
        if(!backend || !length || length > registers[SHARED_SIZE] || start + length > disk.byteLength ||
            cpu.ram_offset(base, length) < 0 || (direction !== 1 && direction !== 2))
        {
            finish(-1);
            return;
        }

        busy = true;
        if(direction === 1)
        {
            backend.read(start, length, bytes => {
                if(bytes.length !== length) { finish(-1); return; }
                cpu.write_blob_physical(bytes, base);
                finish(count);
            }, () => finish(-1));
        }
        else
        {
            backend.write(start, cpu.read_blob_physical(base, length), () => finish(count), () => finish(-1), false);
        }
    }

    // The BSP's byte-like indices (0x00, 0x04, …) are themselves word
    // offsets. In particular the guest reads capacity at base + 0x60.
    syborg_registers(cpu, name, address, word => {
        if(word & 3) return 0;
        const index = word >>> 2;
        switch(index)
        {
            case ID: return 0xDEADBEEF;
            case SECTORS: return sectors;
            case STATUS:
                pending = false;
                set_irq(false);
                return registers[STATUS];
            case OFFSET: case SIZE: case DIRECTION: case SHARED_BASE: case SHARED_SIZE: return registers[index];
            default: return 0;
        }
    }, (word, value) => {
        if(word & 3) return;
        const index = word >>> 2;
        switch(index)
        {
            case EXECUTE: execute(); break;
            case OFFSET: case SIZE: case DIRECTION: case SHARED_BASE: case SHARED_SIZE: case ENABLE:
                registers[index] = value;
                break;
        }
    });
    return {
        reset()
        {
            if(backend) { backend.reset(); block_drop_holds(backend); }
            registers.fill(0);
            pending = busy = false;
            set_irq(false);
        },
        get_state() { return [registers.slice(), pending, disk ? [sectors, identity, disk.get_state()] : null]; },
        check_state(state)
        {
            const media = state?.[2];
            if(!state || !!media !== !!disk || media && (media[0] !== sectors || media[1] !== identity))
                throw new Error("The snapshot requires the same Syborg " + name + " disk");
            if(disk) check_disk_state(name, disk, media[2]);
        },
        set_state([saved, irq, media])
        {
            registers.set(saved);
            busy = false;
            pending = irq;
            if(disk) restore_disk_state(disk, media[2]);
            set_irq(pending);
        },
    };
}
