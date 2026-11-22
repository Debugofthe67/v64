// BB5 packet data over GPDS (context control) and PIPE (DATAPORT).
// Wire formats: qembian docs/research/n8-packet-data-mock.md and
// n8-activate-completion.md. The ISC driver carries bare IPv4 separately.
const GPDS = 0x31, PIPE = 0xD9;
const GUEST_IP = [192, 168, 86, 100], GATEWAY_IP = [192, 168, 86, 1];
const GUEST_MAC = [0x52, 0x54, 0, 0x86, 0, 2], ROUTER_MAC = [0x52, 0x54, 0, 1, 2, 3];
const MTU = 1400; // A DATAPORT receive descriptor can be smaller than the ISC mailbox.
const ETHERNET_HEADER = 14;

export const SYBORG_WISP_OPTIONS = {
    "id": 0, "mtu": MTU, "vm_ip": GUEST_IP.join("."), "router_ip": GATEWAY_IP.join("."),
    "router_mac": ROUTER_MAC.map(byte => byte.toString(16)).join(":"),
};

/** @param {Uint8Array} packet */
function ipv4_length(packet)
{
    if(packet.length < 20 || packet[0] >>> 4 !== 4) return 0;
    const header = (packet[0] & 15) * 4;
    const length = packet[2] << 8 | packet[3];
    return header >= 20 && length >= header && length <= packet.length ? length : 0;
}

/** @param {Uint8Array} request */
function context_apn(request)
{
    for(let offset = 16; offset + 2 <= request.length;)
    {
        const size = request[offset + 1];
        if(size < 2 || offset + size > request.length) break;
        if(request[offset] === 5 && size >= 3 && request[offset + 2] <= size - 3)
            return Array.from(request.subarray(offset, offset + size));
        offset += size;
    }
    return [];
}

export function syborg_packet_data(bus, ports)
{
    // The virtual modem supplies a single IPv4 address for an Internet
    // connection. Track context and pipe identities separately so a stale
    // channel or a different IAP cannot transmit through the active context.
    let attached = true, active = 0;
    let contexts = new Map(), pipes = new Map();
    let next_context = 1, next_pipe = 1;
    let sent = 0, received = 0;
    const guest_mac = GUEST_MAC.map(byte => byte.toString(16).padStart(2, "0")).join(":");
    bus.send("net0-mac", guest_mac);

    function peer(port, number)
    {
        const key = ports[port].channel_key(number);
        if(key) return [port, key];
        const alternate = port ^ 1;
        const other_key = ports[alternate].channel_key(number);
        return other_key ? [alternate, other_key] : null;
    }

    function endpoint()
    {
        return attached && pipes.get(contexts.get(active)?.pipe)?.peer || null;
    }

    function receive(frame)
    {
        const target = endpoint();
        if(!target || !(frame instanceof Uint8Array) || frame[12] !== 8 || frame[13] !== 0) return;
        const packet = frame.subarray(ETHERNET_HEADER);
        const length = ipv4_length(packet);
        if(!length || length > MTU || !GUEST_IP.every((byte, i) => packet[16 + i] === byte)) return;
        if(ports[target[0]].receive_data(target[1], packet.slice(0, length))) received++;
    }
    bus.register("net0-receive", receive);

    function send_data(port, key, packet)
    {
        const target = endpoint();
        const length = ipv4_length(packet);
        if(!target || target[0] !== port || target[1] !== key || !length || length !== packet.length ||
            length > 1500 || !GUEST_IP.every((byte, i) => packet[12 + i] === byte)) return;
        const frame = new Uint8Array(ETHERNET_HEADER + length);
        frame.set(ROUTER_MAC);
        frame.set(GUEST_MAC, 6);
        frame[12] = 8;
        frame.set(packet, ETHERNET_HEADER);
        sent++;
        bus.send("net0-send", frame);
    }

    function pipe_control(port, request, reply)
    {
        const id = request[9], handle = request[10];
        if(id === 0)
        {
            if(request.length < 20 || request[12] !== 0x6C || pipes.size >= 16)
            {
                reply(1, [0, 2, 0, 0]);
                return true;
            }
            while(pipes.has(next_pipe)) next_pipe = next_pipe % 254 + 1;
            const pipe = next_pipe;
            next_pipe = next_pipe % 254 + 1;
            const target = peer(port, request[13]);
            pipes.set(pipe, { peer: target });
            reply(1, [pipe, 0, 0, 0]);
            if(target) ports[target[0]].indicate(target[1], PIPE, 0x40, [pipe, request[10], request[18], 0, 0, 0]);
            return true;
        }
        if(id === 2 || id === 4 || id === 6 || id === 0x0A)
        {
            const pipe = pipes.get(handle);
            reply(id + 1, [handle, pipe ? 0 : 2]);
            if(!pipe) return true;
            const target = pipe.peer;
            if(target && id !== 4)
            {
                const indication = id === 6 ? 0x46 : id === 0x0A ? 0x4A : 0x42;
                ports[target[0]].indicate(target[1], PIPE, indication, [handle, 0]);
            }
            if(id === 2) pipes.delete(handle);
            if((id === 2 || id === 0x0A) && contexts.get(active)?.pipe === handle) active = 0;
            return true;
        }
        return id === 0x41 || id === 0x43 || id === 0x47 || id === 0x4B || id === 0x60;
    }

    function gpds_control(request, reply, indicate)
    {
        const id = request[9], cid = request[10] || 0;
        const context = contexts.get(cid);
        switch(id)
        {
            case 0x00: // LL_CONFIGURE
            case 0x20: // LL_BIND
                if(context && pipes.has(request[11])) context.pipe = request[11];
                reply(id + 1, [cid, context ? 1 : 2]);
                return true;
            case 0x02: // CONTEXT_ID_CREATE
                if(contexts.size >= 11)
                {
                    reply(3, [0, 2]);
                    return true;
                }
                while(contexts.has(next_context)) next_context = next_context % 253 + 1;
                contexts.set(next_context, { pipe: 0, pdp: 0x21, apn: [] });
                reply(3, [next_context, 1]);
                indicate(4, [next_context]);
                next_context = next_context % 253 + 1;
                return true;
            case 0x06: // CONTEXT_CONFIGURE (FE is the default profile).
                if(context)
                {
                    context.pdp = request[11] || 0x21;
                    const apn = context_apn(request);
                    if(apn.length) context.apn = apn;
                }
                reply(7, [cid, context || cid === 0xFE ? 1 : 2]);
                return true;
            case 0x08: // CONTEXT_ACTIVATE
                if(!attached || !context || !pipes.get(context.pipe)?.peer || (active && active !== cid))
                {
                    reply(9, [cid, 2, 0]);
                    return true;
                }
                reply(9, [cid, 1, 0]);
                indicate(0x25, [cid, 0, context.pdp, 0, 0, Number(!!context.apn.length), ...context.apn]);
                indicate(0x0A, [cid, 3,
                    4, 8, 0, 4, ...GUEST_IP,
                    0x0D, 8, 0, 4, ...GATEWAY_IP,
                    0x0E, 8, 0, 4, ...GATEWAY_IP]);
                indicate(0x1E, [1, 2]);
                active = cid;
                return true;
            case 0x0B: // CONTEXT_DEACTIVATE
                if(active === cid) active = 0;
                reply(0x0C, [cid, 1]);
                indicate(0x0D, [cid, 0]);
                return true;
            case 0x13: // ATTACH
                attached = true;
                reply(0x14, [1, 1, 0]);
                indicate(0x15, [1, 0]);
                return true;
            case 0x16: // DETACH
                attached = false;
                active = 0;
                reply(0x17, [1, 0]);
                indicate(0x18, [0, 0]);
                return true;
            case 0x19: // STATUS
                reply(0x1A, [Number(attached), 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
                return true;
            case 0x3A: // CONTEXTS_CLEAR
                contexts.clear();
                active = 0;
                reply(0x3B, [1, 0]);
                return true;
            default:
                return false;
        }
    }

    return {
        control(port, request, send)
        {
            const resource = request[3], transaction = request[8];
            const reply = (id, bytes) => send(resource, transaction, id, bytes);
            if(resource === GPDS) return gpds_control(request, reply, (id, bytes) => send(resource, 0, id, bytes));
            if(resource === PIPE) return pipe_control(port, request, reply);
            return false;
        },
        send_data,
        close_channel(port, key)
        {
            for(const [handle, pipe] of pipes)
            {
                if(pipe.peer?.[0] !== port || pipe.peer[1] !== key) continue;
                pipes.delete(handle);
                if(contexts.get(active)?.pipe === handle) active = 0;
            }
        },
        reset()
        {
            attached = true;
            active = 0;
            next_context = next_pipe = 1;
            contexts.clear();
            pipes.clear();
            sent = received = 0;
        },
        get_state()
        {
            return [attached, active, next_context, next_pipe,
                Array.from(contexts, ([id, { pipe, pdp, apn }]) => [id, pipe, pdp, apn]),
                Array.from(pipes, ([id, pipe]) => [id, pipe.peer])];
        },
        set_state([attached_state, active_id, context_id, pipe_id, context_entries, pipe_entries])
        {
            attached = attached_state;
            active = active_id;
            next_context = context_id;
            next_pipe = pipe_id;
            contexts = new Map(context_entries.map(([id, pipe, pdp, apn]) => [id, { pipe, pdp, apn }]));
            pipes = new Map(pipe_entries.map(([id, target]) => [id, { peer: target }]));
            sent = received = 0;
        },
        status() { return { "attached": attached, "active": !!endpoint(), "sent": sent, "received": received }; },
    };
}
