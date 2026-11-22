// BB5 mailbox used by the 5800's ISC drivers. Register and ISI wire
// formats follow the Syborg reference in docs/symbian-syborg-reference.md.
import { syborg_packet_data } from "./syborg_packet_data.js";

const TX_BUFFER = 0x1000;
const RX_BUFFER = 0x1800;
const BUFFER_SIZE = 0x800;
const ISC_MESSAGE_SIZE = 256;
const QUEUE_LIMIT = 64;
const DELAYED_LIMIT = 16;
const SUBSCRIPTION_LIMIT = 128;

// Resource/request -> response ID and payload. These are the fixed replies
// exercised by the offline RM-356 boot and desktop in the reference run.
const REPLIES = new Map([
    [0x0801, [0x02, "0000"]],             // Lock code state
    [0x0867, [0x68, "0100000000"]],       // Lock disabled and unlocked
    [0x0909, [0x0A, "9720"]],
    [0x0931, [0x32, "3b24"]],
    [0x0962, [0x63, "4d24"]],
    [0x09DE, [0xDF, "0101000000010190000801000000"]],
    [0x0A00, [0x01, "0002000406020918" + "00".repeat(22)]], // No service, no SIM
    [0x0A0B, [0x0C, "000104040000"]],
    [0x0A36, [0x37, "00012c08010100000000"]],
    [0x0A40, [0x41, "010000"]],           // RM-356 network mode query
    [0x0B00, [0x01, "0100"]],             // Audio control
    [0x0B04, [0x05, "0000"]],
    [0x0B14, [0x15, "0000"]],
    [0x0B19, [0x1A, "0000"]],
    [0x1B02, [0x03, "00014708000101000000"]],
    [0x1B2E, [0x2F, "0001f0001000" + "00".repeat(12)]],
    [0x1C38, [0x39, "00000000000100010000"]], // No accessory
    [0x3111, [0x12, "01"]],
    [0x3119, [0x1A, "000000000000000000000003"]],
    [0x3130, [0x31, "000001005555"]],
    [0x3500, [0x01, "0000"]],             // Hardware self-test acknowledgment
    [0x3502, [0x03, "0000"]],
    [0x4706, [0x07, "0000"]],
    [0x540D, [0x0E, "0100"]],
    [0x5450, [0x51, "0000"]],
    [0x5473, [0x74, "0000"]],
    [0x5942, [0x43, "0000"]],
    [0x7701, [0x09, "0000"]],
    [0xDB01, [0x02, "0001000100000000003100330000"]],
    [0xDB05, [0x06, "0000"]],
    [0xF330, [0x31, "00".repeat(58)]],    // DSP memory query
    [0xF332, [0x33, "000000020200"]],
    [0xF33B, [0x3C, "00000000"]],
    [0xF33D, [0x3E, "00000000"]],
    [0xF33F, [0x40, "0000"]],
    [0xF341, [0x42, "0000"]],
].map(([request, [id, payload]]) => [request, [id, Uint8Array.from(
    payload.match(/../g), byte => parseInt(byte, 16))]]));

const EM_BLOCKS = new Map([
    [0x00, [[0x00, 2, 0], [0x01, 0, 0], [0x02, 0, 0], [0x03, 0, 0]]],
    [0x08, [[0x13, 1, 0], [0x14, 0, 0]]],
    [0x0A, [[0x15, 1, 0], [0x16, 7, 7], [0x17, 0, 0], [0x18, 0, 0], [0x25, 255, 255]]],
]);
const SIM_DISCONNECTED_READS = new Set([0x13, 0x23, 0x2D, 0x60, 0xBA, 0xDC]);
const SIM_UNAVAILABLE_READS = new Set([0x1D, 0x1F, 0x29]);

function em_status(id, mask)
{
    const blocks = EM_BLOCKS.get(id);
    if(!mask || mask >= 1 << blocks.length) return [2, 0];
    const result = [1, 0];
    for(let bit = 0; bit < blocks.length; bit++)
    {
        if(!(mask & 1 << bit)) continue;
        const [block_id, first, second] = blocks[bit];
        result.push(block_id, 4, first, second);
        result[1]++;
    }
    return result;
}

function rtc_status(wall_time)
{
    const now = new Date(wall_time);
    const year = now.getUTCFullYear();
    return [1, 2, 1, 12, 1, 0, year >>> 8, year & 255, now.getUTCMonth() + 1, now.getUTCDate(),
        now.getUTCHours(), now.getUTCMinutes(), now.getUTCSeconds(), 0, 4, 4, 1, 0];
}

function encode_reply(channel, resource, transaction, id, payload)
{
    const bytes = new Uint8Array(payload.length + 10);
    const length = bytes.length - 6;
    bytes.set([0, 0x6C, 0, resource, length & 255, length >>> 8, channel & 255, 0, transaction, id]);
    bytes.set(payload, 10);
    return bytes;
}

function subscribed(channel, resource, id)
{
    const pairs = channel.subscriptions;
    for(let i = 0; i + 1 < pairs.length; i += 2)
        if(pairs[i] === resource && pairs[i + 1] === id) return true;
    return false;
}

function create_port(cpu, address, set_irq, respond, send_data, close_channel)
{
    const tx = new Uint8Array(BUFFER_SIZE);
    let channel_number = 0;
    let length = 0;
    let enabled = false;
    let rx = [];
    let pending = [];
    const channels = new Map(); // ISC handles are unique within a port.
    const update_irq = () => set_irq(enabled && rx.some(frame => frame[2]));
    function enqueue(channel, frame, delay)
    {
        if(delay)
        {
            if(pending.length < DELAYED_LIMIT) pending.push([channel, frame, cpu.clock.now() + delay]);
        }
        else if(rx.length < QUEUE_LIMIT)
        {
            rx.push([channel, frame, false]);
        }
    }

    function execute(kind)
    {
        const number = channel_number & 255;
        const handle = channel_number >>> 8;
        if(number >= 64 || handle === 0 || handle >= 64) return;
        if(kind === 3 || kind === 4) // Open or close discards the handle's earlier lifetime.
        {
            const previous = channels.get(handle);
            if(previous) close_channel(handle << 8 | previous.number);
            channels.delete(handle);
            rx = rx.filter(([channel]) => channel >>> 8 !== handle);
            pending = pending.filter(([channel]) => channel >>> 8 !== handle);
            update_irq();
            if(kind === 3) channels.set(handle, { number, subscriptions: [], mtc_sent: false, sim_sent: false });
            return;
        }
        const channel = channels.get(handle);
        if(channel?.number !== number) return;
        const reply = (resource, transaction, id, payload, delay = 0) => {
            const frame = encode_reply(channel_number, resource, transaction, id, payload);
            enqueue(channel_number, frame, delay);
        };
        if(kind === 2)
        {
            channel.subscriptions = tx.slice(0, Math.min(length, SUBSCRIPTION_LIMIT));
            if(!channel.mtc_sent && subscribed(channel, 0x15, 0xC0))
            {
                channel.mtc_sent = true;
                reply(0x15, 0, 0xC0, [1, 3]);
            }
        }
        if(kind === 1 && length >= 10 && length <= ISC_MESSAGE_SIZE)
            respond(channel, tx.subarray(0, length), reply);
        if(kind === 5 && length >= 20 && length <= BUFFER_SIZE)
            send_data(channel_number, tx.subarray(0, length));
    }

    function deliver(key, bytes, kind)
    {
        if(channels.get(key >>> 8)?.number !== (key & 255) || rx.length >= QUEUE_LIMIT) return false;
        rx.push([key, bytes, true, kind]);
        update_irq();
        return true;
    }

    cpu.io.register_mmio(address, 0x2000, {
        name: "Syborg modem",
        read(offset, width)
        {
            if(width > 4) return 0;
            const head = rx[0];
            if(offset >= RX_BUFFER)
            {
                let value = 0;
                for(let i = 0; i < width; i++) value |= (head?.[1][offset - RX_BUFFER + i] || 0) << (i * 8);
                return value >>> 0;
            }
            switch(offset)
            {
                case 0: return 0xC51D0020;
                case 0x10: return rx.length;
                case 0x14: return head?.[0] || 0;
                case 0x18: return head?.[1].length || 0;
                case 0x1C: return head ? head[3] || 1 : 0;
                case 0x24: return Number(enabled);
                default: return 0;
            }
        },
        /** @suppress {checkTypes} */
        write(offset, width, value)
        {
            if(width > 4) return;
            if(offset >= TX_BUFFER && offset < RX_BUFFER)
            {
                for(let i = 0; i < width && offset - TX_BUFFER + i < tx.length; i++)
                    tx[offset - TX_BUFFER + i] = value >>> (i * 8);
                return;
            }
            switch(offset)
            {
                case 0x04: channel_number = value >>> 0; break;
                case 0x08: length = value >>> 0; break;
                case 0x0C: execute(value); break;
                case 0x20: rx.shift(); update_irq(); break;
                case 0x24: enabled = !!(value & 1); update_irq(); break;
            }
        },
    });

    return {
        channel_key(number)
        {
            let key = 0;
            for(const [handle, channel] of channels)
                if(channel.number === number) key = handle << 8 | number;
            return key;
        },
        indicate(key, resource, id, payload) { deliver(key, encode_reply(key, resource, 0, id, payload), 1); },
        receive_data(key, packet) { return deliver(key, packet, 3); },
        poll(now)
        {
            if(!pending.length) return Infinity;
            let next = Infinity;
            const remaining = [];
            for(const [channel, frame, deadline] of pending)
            {
                if(deadline <= now)
                {
                    if(rx.length < QUEUE_LIMIT) rx.push([channel, frame, true]);
                }
                else
                {
                    next = Math.min(next, deadline - now);
                    remaining.push([channel, frame, deadline]);
                }
            }
            if(remaining.length !== pending.length) update_irq();
            pending = remaining;
            return next;
        },
        reset()
        {
            channel_number = length = 0;
            enabled = false;
            tx.fill(0);
            rx = [];
            pending = [];
            channels.clear();
            update_irq();
        },
        get_state()
        {
            return [channel_number, length, enabled, tx.slice(), rx.slice(), pending.slice(),
                Array.from(channels, ([handle, channel]) =>
                    [handle, channel.number, channel.subscriptions, channel.mtc_sent, channel.sim_sent])];
        },
        set_state(state)
        {
            [channel_number, length, enabled] = state;
            tx.set(state[3]);
            rx = state[4].slice();
            pending = state[5].slice();
            channels.clear();
            for(const [handle, number, subscriptions, mtc_sent, sim_sent] of state[6])
                channels.set(handle, { number, subscriptions, mtc_sent, sim_sent });
            update_irq();
        },
    };
}

// S60's PN_NETWORK home registration, using the test PLMN 001/01.
// See qembian docs/research/isi-external-references.md and n8-sim-present-mock.md
// for the ISI sub-block formats and SIM-ready notifications.
const HOME_REGISTRATION = [
    0, 2,
    0, 8, 0, 2, 0, 0, 0, 0, // registration status: home, automatic selection
    9, 24, 0, 1, 0, 0, 0, 1, 0, 0xF1, 0x10, 0, 0, 1, 1, 1, ...Array(8).fill(0),
];
const TEST_SIM_IMSI = [8, 0x09, 0x10, 0x10, 0x10, 0x32, 0x54, 0x76, 0x98];
const RESET_DELAY_MS = 3000;

export function syborg_modem(cpu, irq, network = false, bus = null, audio = null)
{
    let mtc_state = 1;
    let reset_at = null;
    function respond(port, channel, request, send)
    {
        const resource = request[3], transaction = request[8], id = request[9];
        const parameter = request[10] || 0;
        const reply = (reply_id, payload) => send(resource, transaction, reply_id, payload);
        if(network && resource === 0x08 && id === 0x11)
            return reply(0x12, [5, 0x16, 0, 0, 0, 0]); // Security startup complete, no PIN prompt.
        if(resource === 0x09)
        {
            if(id === 0xC0)
            {
                const ready = network && parameter === 0;
                const status = parameter === 1 || ready ? 1 : 6;
                reply(0xC1, parameter ? [parameter, status] : [0, status, Number(ready), ready ? 0 : 255, 0, 0]);
                if(ready && channel.number === 35 && subscribed(channel, 9, 0xEF))
                {
                    // RM-356's startup service distinguishes SIM-readable
                    // (0x4A) from SIM-usable (0x49). Its security check waits
                    // for the latter after processing SIM_STATUS.
                    send(9, 0, 0xEF, [5, 0x4A], 250);
                    send(9, 0, 0xEF, [5, 0x49], 500);
                }
                else if(!channel.sim_sent && subscribed(channel, 9, 0xEF))
                {
                    const indication = !network && channel.number === 35 ? [5, 6] :
                        network && channel.number === 7 ? [0x0D, 0x0B, 8, 0, 0] : null;
                    if(indication)
                    {
                        channel.sim_sent = true;
                        send(9, 0, 0xEF, indication);
                    }
                }
                return;
            }
            if(network && id === 0x1D && parameter === 0x2D) return reply(0x1E, [parameter, 1, ...TEST_SIM_IMSI]);
            if(network && id === 0x2D && parameter === 4)
                return reply(0x2E, [4, 1, 0, 0, 0, 1, 1, 0xA7, 0, 16, 1, 0, 0, 0xF1, 0x10, 0, 0, 0, 0, 0, 0, 0]);
            if(network && id === 0x29 && parameter === 0x35) return reply(0x2A, [parameter, 1, 0, 0, 0, 0]);
            if(network && id === 0x29 && parameter === 0x36) return reply(0x2A, [parameter, 1]);
            // The SIM query uses a boolean cause (0x31 = false, 0x30 = true).
            if(network && id === 0x60 && parameter === 0xFA) return reply(0x61, [parameter, 0x31]);
            if(SIM_DISCONNECTED_READS.has(id)) return reply(id + 1, [parameter, 0xFB]);
            if(SIM_UNAVAILABLE_READS.has(id)) return reply(id + 1, [parameter, 0x24]);
        }
        if(network && resource === 2 && (id === 6 || id === 0x18))
            return reply(id + 1, [0, 0]); // Accept the TSY's SMS routing registration.
        if(network && resource === 0x0A)
        {
            if(id === 0)
            {
                reply(1, HOME_REGISTRATION);
                send(resource, 0, 2, HOME_REGISTRATION);
                return;
            }
            if(id === 0x36) return reply(0x37, [0, 1, 0x2C, 8, 2, 0, 0, 0, 0, 0]);
        }
        if(resource === 0x15)
        {
            if(id === 1)
            {
                if(request.length > 10) mtc_state = parameter;
                return reply(0x64, [0, 0]);
            }
            if(id === 2)
            {
                reply(0x65, [mtc_state, mtc_state, 0, 0]);
                send(0x15, 0, 0xC0, [1, 3]);
                return;
            }
            // Startup asks the modem to reset after detecting a changed SIM.
            // Let the guest finish its disk writes before making the reset visible.
            if(network && id === 6)
            {
                reply(0x69, [0, 0]);
                reset_at = cpu.clock.now() + RESET_DELAY_MS;
                return;
            }
            if(id === 0x16) return reply(0x79, [0, Number(mtc_state === 1 || mtc_state === 4 || mtc_state === 5)]);
        }
        if(resource === 0x17 && EM_BLOCKS.has(id)) return reply(id + 1, em_status(id, parameter));
        if(resource === 0x19 && id === 0x0A) return reply(0x0B, rtc_status(cpu.clock.wall_time()));
        if(resource === 0x1B)
        {
            if(id === 0)
                return reply(1, [0, 1, 0x41, 0x14, 0, 15, ...new TextEncoder().encode("490154203237518"), 0]);
            if(id === 0x29) return reply(0x2A, request.subarray(10));
        }
        if(resource === 0x3A && request.length > 10)
        {
            const payload = request.slice(10, 138);
            payload[0] = 0;
            return reply(id + 1, payload);
        }
        if(resource === 0xF3 && id === 0x34 && request.length >= 16)
        {
            const data = new DataView(request.buffer, request.byteOffset, request.byteLength);
            const delay = audio?.data_written(data.getUint16(10), data.getUint32(12)) ?? 80;
            send(resource, transaction, 0x35, request.subarray(10, 16), delay);
            return;
        }
        if(packet_data?.control(port, request, send)) return;
        const fixed = REPLIES.get(resource << 8 | id);
        if(fixed) reply(...fixed);
    }

    const ports = [0xC0019000, 0xC001B000].map((address, index) =>
        create_port(cpu, address, irq.source(15 + index),
            (channel, request, send) => respond(index, channel, request, send),
            (key, packet) => packet_data?.send_data(index, key, packet),
            key => packet_data?.close_channel(index, key)));
    const packet_data = network && bus ? syborg_packet_data(bus, ports) : null;
    return {
        poll(now)
        {
            if(reset_at !== null && reset_at <= now)
            {
                reset_at = null;
                cpu.wm.exports["a64_request_reset"]();
            }
            return Math.min(ports[0].poll(now), ports[1].poll(now), reset_at === null ? Infinity : reset_at - now);
        },
        reset()
        {
            mtc_state = 1;
            reset_at = null;
            packet_data?.reset();
            ports.forEach(port => port.reset());
        },
        get_state()
        {
            const state = [mtc_state, ports.map(port => port.get_state())];
            if(reset_at !== null || packet_data) state.push(reset_at);
            if(packet_data) state.push(packet_data.get_state());
            return state;
        },
        set_state([mode, state, deadline = null, packet_state = null])
        {
            mtc_state = mode;
            reset_at = deadline;
            ports.forEach((port, index) => port.set_state(state[index]));
            if(packet_state) packet_data?.set_state(packet_state);
            else packet_data?.reset();
        },
        network_status() { return packet_data?.status() || null; },
    };
}
