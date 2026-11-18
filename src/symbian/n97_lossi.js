import { word } from "./n97_devices.js";

export const N97_LOSSI_BASE = 0x20032100;

// lossi.dll 0x80114274 writes raw command/data ports, waits for TX ready
// and idle, then (for reads) acknowledges RX before fetching the RX latch.
export function create_n97_lossi(io, clock, panel)
{
    const TX_READY = 1, TX_IDLE = 2, RX_READY = 4;
    // The original timing calculation gets the source clock from the board.
    // Use the board's 38.4 MHz reference for the functional serial model.
    const CLOCK_KHZ = 38400;
    let control, timing, fifo_config, tx, read_next, rx, rx_ready;
    let transferred, dropped, last_command;
    const reg = (offset, name, read, write = () => {}) => word(io, N97_LOSSI_BASE + offset, "RAPIDO LoSSI " + name, read, write);
    const merge = (old, value, mask) => (old & ~mask | value & mask) >>> 0;
    const cycle = (bits, config) => bits * ((config & 0x7F) + 1) / CLOCK_KHZ;
    function reset()
    {
        control = timing = fifo_config = 0;
        tx = null;
        read_next = rx_ready = false;
        rx = 0;
        transferred = dropped = 0;
        last_command = [-1, -1];
    }
    function poll(now)
    {
        if(tx)
        {
            if(now < tx[0]) return tx[0] - now;
            const [deadline, cs, command, value, width, reading] = tx;
            tx = null;
            transferred++;
            if(command)
            {
                last_command[cs] = value & 255;
                if(reading)
                {
                    rx = panel.read(cs, value & 255, deadline);
                    rx_ready = true;
                }
                else panel.write_command(cs, value & 255, deadline);
            }
            else
            {
                if(width === 2) panel.write_data(cs, value >>> 8 & 255);
                panel.write_data(cs, value & 255);
            }
        }
        return 100;
    }
    function start(cs, command, value, mask)
    {
        if(!(mask & 255)) return;
        const now = clock.now();
        poll(now);
        if(tx) { dropped++; return; }
        const reading = command && read_next;
        if(reading) read_next = false;
        const width = !command && (timing & 0x80) && (mask & 0xFF00) ? 2 : 1;
        tx = [now + cycle((width * 8 + 1) + (reading ? 8 : 0), timing), cs, command, value, width, reading];
    }
    reg(0, "control", () => control | 4, (value, mask) => {
        // lossi.dll 0x801147A0 writes 3 and reads back 5 immediately.
        if(value & mask & 2) reset();
        control = merge(control, value, mask & 1);
    });
    for(const cs of [0, 1])
    {
        reg(4 + 8 * cs, "command CS" + cs, () => 0, (value, mask) => start(cs, true, value, mask));
        reg(8 + 8 * cs, "data CS" + cs, () => 0, (value, mask) => start(cs, false, value, mask));
    }
    reg(0x14, "RX latch", () => { poll(clock.now()); return rx; });
    reg(0x18, "status", () => {
        poll(clock.now());
        return (tx ? 0 : TX_READY | TX_IDLE) | (rx_ready ? RX_READY : 0);
    });
    reg(0x1C, "read request", () => +read_next, (value, mask) => { if(mask & 1) read_next = !!(value & 1); });
    reg(0x20, "RX acknowledge", () => 0, (value, mask) => { if(value & mask & 1) rx_ready = false; });
    reg(0x24, "timing and transfer configuration", () => timing, (value, mask) => { timing = merge(timing, value, mask); });
    reg(0x28, "FIFO configuration", () => fifo_config, (value, mask) => { fifo_config = merge(fifo_config, value, mask); });
    reset();
    return {
        reset, poll,
        status() { return { "transferred": transferred, "dropped": dropped, "last_command": last_command.slice() }; },
        get_state()
        {
            return [control, timing, fifo_config, tx?.slice() || null,
                read_next, rx, rx_ready, transferred, dropped, last_command.slice()];
        },
        set_state(state)
        {
            [control, timing, fifo_config, tx, read_next, rx, rx_ready, transferred, dropped, last_command] = state;
            tx = tx?.slice() || null;
            last_command = last_command.slice();
        },
    };
}
