// Syborg MMIO and IRQ interface. See the pinned board and BSP in
// docs/symbian-syborg-reference.md.
export function syborg_registers(cpu, name, address, read, write)
{
    cpu.io.register_mmio(address, 0x1000, {
        name,
        read(offset, width)
        {
            const first = Number(read(offset >>> 2)) >>> 0;
            if(width === 8) return BigInt(first) | BigInt(Number(read((offset >>> 2) + 1)) >>> 0) << 32n;
            return first >>> ((offset & 3) * 8);
        },
        /** @suppress {checkTypes} Closure's bitwise operators are typed for Number only. */
        write(offset, width, value)
        {
            if(width === 8)
            {
                write(offset >>> 2, Number(value & 0xFFFFFFFFn));
                write((offset >>> 2) + 1, Number(value >> 32n));
            }
            else
            {
                write(offset >>> 2, value * 2 ** ((offset & 3) * 8) >>> 0);
            }
        },
    });
}

export function syborg_irq_controller(cpu)
{
    let levels = 0;
    let enabled = 0;
    let asserted = false;
    const update = () => {
        const next = (levels & enabled) !== 0;
        if(next === asserted) return;
        asserted = next;
        cpu.wm.exports["a32_set_interrupt_lines"](next, false);
        if(next && !cpu.in_cpu) cpu.stop_idling();
    };
    function read(index)
    {
        let pending = levels & enabled;
        switch(index)
        {
            case 0: return 0xC51D0000;
            case 1:
            {
                let count = 0;
                while(pending !== 0) { pending &= pending - 1; count++; }
                return count;
            }
            case 2: return pending ? 31 - Math.clz32(pending & -pending) : 0xFFFFFFFF;
            case 6: return 32;
            default: return 0;
        }
    }
    function write(index, value)
    {
        if(index === 3) enabled = 0;
        if(value < 32 && index === 4) enabled &= ~(1 << value);
        if(value < 32 && index === 5) enabled |= 1 << value;
        update();
    }
    syborg_registers(cpu, "Syborg IRQ controller", 0xC0000000, read, write);
    return {
        asserted() { return asserted; },
        source(index) { return level => {
            levels = level ? levels | 1 << index : levels & ~(1 << index);
            update();
        }; },
        reset() { levels = 0; enabled = 0; update(); },
        get_state() { return [levels, enabled]; },
        set_state(state)
        {
            [levels, enabled] = state;
            asserted = (levels & enabled) === 0; // refresh the line after loading core state
            update();
        },
    };
}

const TIMER_HZ = 100000;
const TIMER_TICKS_PER_MS = TIMER_HZ / 1000;

export function syborg_timer(cpu, set_irq)
{
    const clock = cpu.clock;
    let running = false, oneshot = false, limit = 0, count = 0;
    let enabled = 0, pending = 0, deadline = 0;
    const update = () => set_irq(!!(enabled & pending));
    function poll(now)
    {
        if(!running) return Infinity;
        if(now >= deadline)
        {
            pending = 1;
            if(oneshot || limit === 0)
            {
                running = false;
                count = 0;
            }
            else
            {
                const period = limit / TIMER_TICKS_PER_MS;
                deadline += (Math.floor((now - deadline) / period) + 1) * period;
            }
            update();
        }
        return running ? Math.max(0, deadline - now) : Infinity;
    }
    const remaining = now => running ? Math.max(0, Math.ceil((deadline - now) * TIMER_TICKS_PER_MS)) >>> 0 : count;
    function read(index)
    {
        const now = clock.now();
        poll(now);
        switch(index)
        {
            case 0: return 0xC51D0003;
            case 1: return Number(running);
            case 2: return Number(oneshot);
            case 3: return limit;
            case 4: return remaining(now);
            case 5: return enabled;
            case 6: return pending;
            case 7: return TIMER_HZ;
            default: return 0;
        }
    }
    function write(index, value)
    {
        const now = clock.now();
        poll(now);
        switch(index)
        {
            case 1:
                if(running && !value) count = remaining(now);
                if(!running && value) deadline = now + (count || limit) / TIMER_TICKS_PER_MS;
                running = !!value;
                break;
            case 2: oneshot = !!value; break;
            case 4:
                count = value;
                if(running) deadline = now + count / TIMER_TICKS_PER_MS;
                break;
            case 3:
                limit = count = value;
                if(running) deadline = now + count / TIMER_TICKS_PER_MS;
                break;
            case 5: enabled = value & 1; update(); break;
            case 6: pending &= ~value; update(); break;
        }
    }
    syborg_registers(cpu, "Syborg timer", 0xC0002000, read, write);
    return {
        poll,
        reset()
        {
            running = oneshot = false;
            limit = count = enabled = pending = deadline = 0;
            update();
        },
        get_state() { return [running, oneshot, limit, count, enabled, pending, deadline]; },
        set_state(state) { [running, oneshot, limit, count, enabled, pending, deadline] = state; update(); },
    };
}

const YEAR_2000 = 946684800;
const LOW_DWORD = 0xFFFFFFFFn;
export function syborg_rtc(cpu)
{
    const clock = cpu.clock;
    let offset = BigInt(Math.floor(clock.wall_time() / 1000)) * 1000000n;
    let data = 0n, wall_offset = 0;
    const wall = () => Math.floor(clock.wall_time() / 1000) - YEAR_2000;
    /** @suppress {checkTypes} Closure's bitwise operators are typed for Number only. */
    function read(index)
    {
        switch(index)
        {
            case 0: return 0xC51D0004;
            case 2: return Number(data & LOW_DWORD);
            case 3: return Number(data >> 32n);
            case 4: return wall() + wall_offset;
            case 5: return Math.floor(clock.now() * 32768 / 1000);
            default: return 0;
        }
    }
    /** @suppress {checkTypes} Closure's arithmetic operators are typed for Number only. */
    function write(index, value)
    {
        switch(index)
        {
            case 1:
            {
                const now = BigInt(Math.floor(clock.now() * 1000000));
                if(value >= 4) offset = BigInt.asIntN(64, data - now);
                else data = BigInt.asUintN(64, (now + offset) / 1000n ** BigInt(value));
                break;
            }
            case 2: data = (data & ~LOW_DWORD) | BigInt(value); break;
            case 3: data = (data & LOW_DWORD) | BigInt(value) << 32n; break;
            case 4: wall_offset = (value | 0) - wall(); break;
        }
    }
    syborg_registers(cpu, "Syborg RTC", 0xC0001000, read, write);
    return {
        get_state() { return [offset.toString(), data.toString(), wall_offset]; },
        set_state([saved_offset, saved_data, saved_wall]) { offset = BigInt(saved_offset); data = BigInt(saved_data); wall_offset = saved_wall; },
    };
}

export function syborg_uart(cpu, bus, port, set_irq)
{
    const fifo = [];
    let enabled = 0, tx_address = 0, rx_address = 0, rx_count = 0;
    const output = byte => bus.send("serial" + port + "-output-byte", byte);
    const update = () => set_irq(!!(enabled & (2 | Number(fifo.length !== 0) | Number(rx_count === 0) << 2)));
    function store(byte)
    {
        if(cpu.ram_offset(rx_address, 1) >= 0) cpu.write_blob_physical(Uint8Array.of(byte), rx_address);
        rx_address = rx_address + 1 >>> 0;
        rx_count--;
    }
    bus.register("serial" + port + "-input", byte => {
        if(rx_count) store(byte & 0xFF);
        else if(fifo.length < 16) fifo.push(byte & 0xFF);
        update();
    });
    function read(index)
    {
        switch(index)
        {
            case 0: return 0xC51D0001;
            case 1: {
                const byte = fifo.shift();
                update();
                return byte === undefined ? 0xFFFFFFFF : byte;
            }
            case 2: return fifo.length;
            case 3: return enabled;
            case 4: return tx_address;
            case 6: return rx_address;
            case 7: return rx_count;
            default: return 0;
        }
    }
    function write(index, value)
    {
        switch(index)
        {
            case 1: output(value & 0xFF); break;
            case 3: enabled = value & 7; update(); break;
            case 4: tx_address = value; break;
            case 5:
            {
                // Limit a DMA request to physical RAM and send only that span.
                const offset = cpu.ram_offset(tx_address, value);
                if(offset < 0) break;
                for(const byte of cpu.mem8.subarray(offset, offset + value)) output(byte);
                tx_address = tx_address + value >>> 0;
                break;
            }
            case 6: rx_address = value; break;
            case 7:
                rx_count = value;
                while(rx_count && fifo.length) store(fifo.shift());
                update();
                break;
        }
    }
    syborg_registers(cpu, "Syborg UART " + port, 0xC0006000 + 0x1000 * port, read, write);
    return {
        reset() { fifo.length = 0; enabled = tx_address = rx_address = rx_count = 0; update(); },
        get_state() { return [fifo.slice(), enabled, tx_address, rx_address, rx_count]; },
        set_state(state)
        {
            const [saved] = state;
            [, enabled, tx_address, rx_address, rx_count] = state;
            fifo.splice(0, fifo.length, ...saved);
            update();
        },
    };
}
