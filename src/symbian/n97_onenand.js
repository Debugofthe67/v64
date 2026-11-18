// RM-505 Samsung MuxOneNAND, CS0, x16 bus. Registers use Samsung's word
// addresses (multiply by two for CPU byte addresses). See docs/symbian-n97.md.
import { check_disk_state } from "../disk_writeback.js";
import { VirtDeviceSpace } from "../virt/io.js";
import { check_n97_flash, N97_FLASH_BLOCK, N97_FLASH_HEADER, N97_FLASH_ID,
    N97_FLASH_PAGE, N97_FLASH_SIZE, N97_FLASH_SLOT, N97_FLASH_SPARE, n97_main_ecc, n97_spare_ecc } from "./n97_flash.js";

const PAGES_PER_BLOCK = N97_FLASH_BLOCK / N97_FLASH_PAGE;
const BLOCK_COUNT = N97_FLASH_SIZE / N97_FLASH_BLOCK;
const BLOCK_SLOT = PAGES_PER_BLOCK * N97_FLASH_SLOT;
const MASTER = 0x8000, READ = 0x80, WRITE = 0x40, ERASE = 0x20, RESET = 0x10;
const ERROR = 0x400, LOCK_ERROR = 0x4000;
const LOAD_ERROR = ERROR | 0x2000, PROGRAM_ERROR = ERROR | 0x1000, ERASE_ERROR = ERROR | 0x800;
const ERASE_ONGOING = 0x8800, ERASE_BATCH_LIMIT = 64;
const LOCKED = 2, UNLOCKED = 4, LOCKED_TIGHT = 1;
const CONFIG1 = 0xF221;
const IOBE = 0x20, INT_POLARITY = 0x40, ECC_BYPASS = 0x100;
const STATUS = 0xF240, INTERRUPT = 0xF241, ECC = 0xFF00;
const REGISTERS = new Set([0xF100, 0xF101, 0xF102, 0xF103, 0xF107, 0xF200, 0xF220,
    CONFIG1, STATUS, INTERRUPT, 0xF24C, ECC]);
const NAND_ID = [...N97_FLASH_ID, N97_FLASH_PAGE, 512, 0x0201, 0];

/** @param {!VirtDeviceSpace} io @param {?} buffer @param {string} rom_digest */
export function create_n97_onenand(io, buffer, rom_digest, set_interrupt = () => {})
{
    check_n97_flash(buffer, rom_digest);
    const boot = new Uint8Array(1024), boot_spare = new Uint8Array(32);
    const data = new Uint8Array(2 * N97_FLASH_PAGE), spare = new Uint8Array(2 * N97_FLASH_SPARE);
    const locks = new Uint8Array(BLOCK_COUNT);
    let regs = new Map();
    let boot_command = 0;
    let erase_queue = new Set(), failed_erases = new Set();
    const blank_block = new Uint8Array(BLOCK_SLOT);
    let reads = 0, programs = 0, erases = 0;
    const offset_page = page => N97_FLASH_HEADER + page * N97_FLASH_SLOT;
    // DFS is a die selector on DDP parts. The stock PDD still asserts it
    // for upper addresses on the single-die 0040/0121, where it is ignored.
    const selected_block = () => regs.get(0xF100) & 0x7FFF;
    // The inactive digital input represents the undriven pin when IOBE=0.
    const interrupt_level = () => !!(regs.get(CONFIG1) & IOBE) &&
        !!(regs.get(CONFIG1) & INT_POLARITY) === !!(regs.get(INTERRUPT) & MASTER);
    const update_interrupt = () => set_interrupt(interrupt_level());

    function page_bytes(page)
    {
        const value = buffer.get_from_cache(offset_page(page), N97_FLASH_SLOT);
        if(value?.length !== N97_FLASH_SLOT) throw new Error("Cannot read Nokia N97 OneNAND page");
        return value;
    }

    function write_bytes(at, bytes)
    {
        let finished = false, failure;
        buffer.set(at, bytes, error => { finished = true; failure = error; });
        if(!finished || failure) throw failure || new Error("Nokia N97 OneNAND requires synchronous writes");
    }

    function reset_registers(interrupt, config1 = 0x40C0)
    {
        regs = new Map(Array.from(REGISTERS, address => [address, 0]));
        regs.set(CONFIG1, config1);
        regs.set(INTERRUPT, MASTER | interrupt);
        boot_command = 0;
        erase_queue.clear();
        failed_erases.clear();
    }

    function reset()
    {
        reset_registers(READ);
        locks.fill(LOCKED);
        data.fill(0xFF);
        spare.fill(0xFF);
        boot.fill(0xFF);
        boot_spare.fill(0xFF);
        try
        {
            const bytes = page_bytes(0);
            for(let i = 0; i < boot.length; i++) boot[i] = bytes[i] ^ 0xFF;
            for(let i = 0; i < boot_spare.length; i++) boot_spare[i] = bytes[N97_FLASH_PAGE + i] ^ 0xFF;
        }
        catch(e)
        {
            regs.set(STATUS, LOAD_ERROR);
            regs.set(ECC, 0xAA);
        }
        update_interrupt();
    }

    function transfer(command, block, page_address = regs.get(0xF107), start = regs.get(0xF200))
    {
        const read = command === 0 || command === 0x13;
        const mode = read ? READ : WRITE;
        const oob = command === 0x13 || command === 0x1A;
        const ecc_enabled = !(regs.get(CONFIG1) & ECC_BYPASS);
        const flash_sector = page_address & 3;
        const bank = start >> 8 & 0xF;
        const sector = bank & 3;
        const count = (start & 3) || 4;
        const half = bank >> 2 & 1;
        const boot_buffer = !(bank & 8);
        const page = block * PAGES_PER_BLOCK + (page_address >> 2 & 63);
        if(block >= BLOCK_COUNT || page_address & ~0xFF || flash_sector + count > 4 || boot_buffer && (bank > 1 || count > 2))
        {
            regs.set(STATUS, ERROR);
            return mode;
        }
        if(read && boot_buffer)
        {
            regs.set(STATUS, LOCK_ERROR | LOAD_ERROR);
            return mode;
        }
        if(!read && locks[block] !== UNLOCKED)
        {
            regs.set(STATUS, LOCK_ERROR | PROGRAM_ERROR);
            return mode;
        }
        try
        {
            const bytes = page_bytes(page);
            const target = read ? bytes : bytes.slice();
            const banks = boot_buffer ? [boot, boot_spare] : [data, spare];
            for(const [ram, page_start, stride] of [[banks[0], 0, 512], [banks[1], N97_FLASH_PAGE, 16]])
            {
                if(oob && page_start === 0) continue;
                const automatic_ecc = !read && ecc_enabled && page_start !== 0;
                for(let s = 0; s < count; s++)
                {
                    const buffer_sector = half * 4 + ((sector + s) & (boot_buffer ? 1 : 3));
                    const at = buffer_sector * stride;
                    const from = page_start + (flash_sector + s) * stride;
                    for(let i = 0; i < stride; i++)
                    {
                        if(read) ram[at + i] = target[from + i] ^ 0xFF;
                        else if(!automatic_ecc || i < 8 || i > 12) target[from + i] |= ram[at + i] ^ 0xFF;
                    }
                    if(automatic_ecc)
                    {
                        // Generate codes from the bytes presented by BufferRAM.
                        // Only the NAND cells change and their zeros stay zero.
                        if(!oob)
                        {
                            const code = n97_main_ecc(banks[0], buffer_sector * 512);
                            target[from + 8] |= ~code & 0xFF;
                            target[from + 9] |= ~code >>> 8 & 0xFF;
                            target[from + 10] |= ~code >>> 16 & 0xFF;
                        }
                        const code = n97_spare_ecc(ram, at);
                        target[from + 11] |= ~code & 0xFF;
                        target[from + 12] |= ~code >>> 8 & 0xFF;
                    }
                }
            }
            if(read) reads++;
            else
            {
                write_bytes(offset_page(page), target);
                programs++;
            }
        }
        catch(e)
        {
            regs.set(STATUS, read ? LOAD_ERROR : PROGRAM_ERROR);
            // FPSX supplies error-free cells without ECC codes. A media read
            // that cannot supply data is exposed as uncorrectable; ECC bypass
            // leaves the ECC register clear and retains the controller error.
            if(read && ecc_enabled)
            {
                const sectors = 0x1111 >> ((4 - count) * 4);
                regs.set(ECC, (oob ? 2 : 10) * sectors);
            }
        }
        return mode;
    }

    // Samsung §§3.13.2–3.13.3. Address latches finish with EI set while
    // the controller still reports OnGo. Only 0x94 commits the batch.
    function queue_erase(block)
    {
        if(block >= BLOCK_COUNT || !erase_queue.has(block) && erase_queue.size === ERASE_BATCH_LIMIT - 1)
        {
            return ERASE_ERROR | (erase_queue.size ? ERASE_ONGOING : 0);
        }
        erase_queue.add(block);
        return ERASE_ONGOING;
    }

    function erase_block(block)
    {
        if(locks[block] !== UNLOCKED) return ERASE_ERROR | LOCK_ERROR;
        try
        {
            write_bytes(offset_page(block * PAGES_PER_BLOCK), blank_block);
            erases++;
            return 0;
        }
        catch(e) { return ERASE_ERROR; }
    }

    function commit_erase(block)
    {
        // A protected final address prevents the operation from starting.
        // Keep the original address latches for the next valid final address.
        const pending = erase_queue.size ? ERASE_ONGOING : 0;
        if(block >= BLOCK_COUNT) return pending | ERROR;
        if(locks[block] !== UNLOCKED) return pending | ERASE_ERROR | LOCK_ERROR;

        erase_queue.add(block);
        failed_erases.clear();
        let result = 0;
        for(const address of erase_queue)
        {
            const error = erase_block(address);
            if(error) failed_erases.add(address);
            result |= error;
        }
        erase_queue.clear();
        return result;
    }

    function verify_erase(block)
    {
        if(block >= BLOCK_COUNT || failed_erases.has(block)) return ERASE_ERROR;
        try
        {
            const bytes = buffer.get_from_cache(offset_page(block * PAGES_PER_BLOCK), BLOCK_SLOT);
            if(bytes?.length === BLOCK_SLOT && bytes.every(byte => !byte)) return 0;
        }
        catch(e) { /* An unreadable block cannot verify as erased. */ }
        return ERASE_ERROR;
    }

    function run_command(command)
    {
        regs.set(INTERRUPT, 0);
        update_interrupt();
        if(command !== 0x94 && command !== 0x95) erase_queue.clear();
        if(command === 0xF0 || command === 0xF3)
        {
            if(command === 0xF3) reset_registers(RESET, 0x4000 | regs.get(CONFIG1) & 0xE0);
            else
            {
                failed_erases.clear();
                regs.set(ECC, 0);
                regs.set(STATUS, 0);
                regs.set(INTERRUPT, MASTER | RESET);
            }
            return;
        }
        regs.set(0xF220, command);
        regs.set(STATUS, 0);
        regs.set(ECC, 0);
        const block = selected_block();
        let mode = 0;
        switch(command)
        {
            case 0: case 0x13: case 0x80: case 0x1A:
                mode = transfer(command, block);
                break;
            case 0x95:
                mode = ERASE;
                regs.set(STATUS, queue_erase(block));
                break;
            case 0x94:
                mode = ERASE;
                regs.set(STATUS, commit_erase(block));
                break;
            case 0x71: // Verify sets the master completion bit with no BufferRAM transfer.
                regs.set(STATUS, verify_erase(block));
                break;
            case 0x23: case 0x2A: case 0x2C: {
                const address = regs.get(0xF24C);
                if(address >= BLOCK_COUNT || locks[address] === LOCKED_TIGHT || command === 0x2C && locks[address] === UNLOCKED)
                    regs.set(STATUS, ERROR | LOCK_ERROR);
                else locks[address] = command === 0x23 ? UNLOCKED : command === 0x2A ? LOCKED : LOCKED_TIGHT;
                break;
            }
            case 0x27:
                for(let i = 0; i < locks.length; i++) if(locks[i] !== LOCKED_TIGHT) locks[i] = UNLOCKED;
                break;
            default:
                regs.set(STATUS, ERROR);
                break;
        }
        regs.set(INTERRUPT, MASTER | mode);
    }

    const windows = [[0, boot, true], [0x400, data, false], [0x10000, boot_spare, true], [0x10020, spare, false]];
    function write_boot(value)
    {
        const previous = boot_command;
        boot_command = value === 0x90 || value === 0xE0 ? value : 0;
        if(boot_command && erase_queue.size)
        {
            erase_queue.clear();
            regs.set(STATUS, 0);
        }
        if(value === 0xF0) run_command(0xF3);
        else if(value === 0 && previous === 0xE0)
        {
            const page = regs.get(0xF107) & 0xFC;
            regs.set(STATUS, 0);
            regs.set(ECC, 0);
            transfer(0, selected_block(), page, 0x800);
            regs.set(0xF107, (page + 4) & 0xFC);
            regs.set(INTERRUPT, MASTER | READ);
        }
        update_interrupt();
    }
    function read_half(offset)
    {
        const address = offset >> 1;
        if(address >= 0xF000 && address < 0xF000 + NAND_ID.length) return NAND_ID[address - 0xF000];
        if(address === 0xF24E) return locks[selected_block()] ?? 0;
        if(address > ECC && address <= ECC + 8) return 0;
        return regs.get(address) ?? 0xFFFF;
    }
    function write_half(offset, value)
    {
        const address = offset >> 1;
        switch(address)
        {
            case 0xF220: run_command(value); update_interrupt(); break;
            case INTERRUPT: regs.set(address, regs.get(address) & value); update_interrupt(); break;
            case CONFIG1: regs.set(address, value); update_interrupt(); break;
            case STATUS: case ECC: break;
            default: if(REGISTERS.has(address)) regs.set(address, value);
        }
    }
    io.register_mmio(0, 0x20000, {
        name: "RM-505 OneNAND CS0",
        read(offset, width)
        {
            const window = windows.find(([base, bytes]) => offset >= base && offset + width <= base + bytes.length);
            if(window)
            {
                const [base, bytes] = window;
                if(base === 0 && boot_command === 0x90 && width === 2)
                    return [NAND_ID[0], NAND_ID[1], locks[selected_block()] ?? 0][offset >> 1] ?? 0xFFFF;
                if(width === 1) return bytes[offset - base];
                const view = new DataView(bytes.buffer);
                if(width === 2) return view.getUint16(offset - base, true);
                if(width === 4) return view.getUint32(offset - base, true);
            }
            if(width === 2 && !(offset & 1)) return read_half(offset);
            if(width === 4 && !(offset & 1)) return read_half(offset) + read_half(offset + 2) * 65536;
            return -1;
        },
        write(offset, width, value)
        {
            const window = windows.find(([base, bytes]) => offset >= base && offset + width <= base + bytes.length);
            if(window)
            {
                const [base, bytes, read_only] = window;
                if(read_only)
                {
                    if(width === 2 && !(offset & 1)) write_boot(value);
                    return;
                }
                if(width === 1) bytes[offset - base] = value;
                if(width === 2) new DataView(bytes.buffer).setUint16(offset - base, value, true);
                if(width === 4) new DataView(bytes.buffer).setUint32(offset - base, value, true);
                return;
            }
            if((width === 2 || width === 4) && !(offset & 1)) write_half(offset, value & 0xFFFF);
            if(width === 4 && !(offset & 1)) write_half(offset + 2, value >>> 16);
        },
    });
    reset();
    return {
        buffer, reset, interrupt_level,
        status: () => ({ "capacity": N97_FLASH_SIZE, "manufacturer": NAND_ID[0], "device": NAND_ID[1],
            "revision": NAND_ID[2], "reads": reads, "programs": programs, "erases": erases }),
        get_state: () => [buffer.get_state(), Array.from(regs), boot.slice(), boot_spare.slice(), data.slice(), spare.slice(), locks.slice(),
            boot_command, reads, programs, erases, [...erase_queue], [...failed_erases]],
        set_state(state)
        {
            buffer.set_state(state[0]);
            regs = new Map(state[1]);
            boot.set(state[2]);
            boot_spare.set(state[3]);
            data.set(state[4]);
            spare.set(state[5]);
            locks.set(state[6]);
            [boot_command, reads, programs, erases] = state.slice(7, 11);
            erase_queue = new Set(state[11]);
            failed_erases = new Set(state[12]);
        },
        check_state: state => check_disk_state("symbian_nand", buffer, state[0]),
    };
}
