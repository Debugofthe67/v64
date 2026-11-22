const SIGNATURE = [86, 56, 73]; // V8I

export function syborg_install_channel(bus, queue_packet, available)
{
    let ready = false, request = null, reply = [];
    const complete = (id, status) => bus.send("symbian-install-result", [id, status]);
    bus.register("symbian-install-package", ([id, bytes]) => {
        if(!available) return complete(id, -5);
        if(!ready || request !== null) return complete(id, -18);
        if(!(bytes instanceof Uint8Array) || bytes.length !== 512 || !queue_packet(bytes)) return complete(id, -6);
        request = id;
        ready = false;
    });
    return {
        receive(byte)
        {
            if(reply.length < SIGNATURE.length && byte !== SIGNATURE[reply.length])
            {
                reply = byte === SIGNATURE[0] ? [byte] : [];
                return;
            }
            reply.push(byte);
            if(reply.length === 4 && byte !== 61)
            {
                if(byte === 43) ready = true;
                reply = [];
            }
            if(reply.length === 8)
            {
                const status = reply[4] | reply[5] << 8 | reply[6] << 16 | reply[7] << 24;
                if(request !== null) complete(request, status);
                request = null;
                reply = [];
            }
        },
        reset()
        {
            if(request !== null) complete(request, -3);
            ready = false; request = null; reply = [];
        },
        get_state() { return [ready, request, reply.slice()]; },
        set_state([saved_ready = false, saved_request = null, saved_reply = []] = [])
        {
            ready = saved_ready;
            request = saved_request;
            reply = saved_reply.slice();
        },
    };
}
