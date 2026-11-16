// iOS 6's native utun socket carries IPv4 through the existing browser
// Ethernet backends. No Wi-Fi association or cellular registration is faked.
export const IOS_NETWORK_SERVICE = "v86.ios.network";
export const IOS_NETWORK_MTU = 1500;
export const IOS_NETWORK_RELAY = "wisps://wisp.mercurywork.shop/v86/";
const mac = Uint8Array.of(0x52, 0x54, 0, 0x86, 0, 1);
const router = Uint8Array.of(0x52, 0x54, 0, 1, 2, 3);
const ascii = new TextEncoder(), decoder = new TextDecoder();

function ipv4(bytes)
{
    return bytes.length >= 20 && bytes.length <= IOS_NETWORK_MTU && bytes[0] >>> 4 === 4 &&
        (bytes[0] & 15) * 4 >= 20 && (bytes[0] & 15) * 4 <= bytes.length &&
        (bytes[2] << 8 | bytes[3]) === bytes.length;
}

export class IOSNetwork
{
    constructor(bus)
    {
        this.bus = bus;
        this.connection = null;
        this.peer = { phase: "waiting", interface: "" };
        this.sent = this.received = this.dropped = 0;
        bus.register("net0-receive", frame => this.receive(frame));
    }
    status() { return { ...this.peer, sent: this.sent, received: this.received, dropped: this.dropped }; }
    progress(value)
    {
        this.peer = value;
        this.bus.send("ios-network-status", this.status());
    }
    receive(frame)
    {
        const session = this.connection;
        if(!session || !(frame instanceof Uint8Array) || frame.length < 34 || frame[12] !== 8 || frame[13] !== 0) return;
        const length = frame[16] << 8 | frame[17], ip = frame.subarray(14, 14 + length);
        if(!ipv4(ip)) return;
        if(session.queue.length >= 256) { this.dropped++; return; }
        const packet = new Uint8Array(4 + ip.length);
        packet[3] = 2; packet.set(ip, 4); session.queue.push(packet); this.received++;
    }
    service(name)
    {
        if(name !== IOS_NETWORK_SERVICE || this.connection) return null;
        // Configuration: magic, version, MTU, guest IPv4, peer/DNS IPv4.
        const config = new Uint8Array(24), v = new DataView(config.buffer);
        config.set(ascii.encode("V86N")); v.setUint32(4, 1, true); v.setUint32(8, IOS_NETWORK_MTU, true);
        config.set([192, 168, 86, 100], 12); config.set([192, 168, 86, 1], 16); config.set([192, 168, 86, 1], 20);
        let closed = false;
        const session = {
            queue: [config],
            available: () => !closed && session.queue.length > 0,
            read: maximum => {
                if(closed || !session.queue.length || maximum < session.queue[0].length) return new Uint8Array(0);
                return session.queue.shift();
            },
            write: bytes => {
                if(closed || bytes.length > IOS_NETWORK_MTU + 4) return;
                if(bytes.length >= 4 && decoder.decode(bytes.subarray(0, 4)) === "V86S")
                {
                    try
                    {
                        const status = JSON.parse(decoder.decode(bytes.subarray(4)));
                        if(["ready", "failed"].includes(status.phase)) this.progress({
                            phase: status.phase, interface: String(status.interface || "").slice(0, 16),
                            error: String(status.error || "").slice(0, 200),
                        });
                    }
                    catch(_) { /* A malformed status cannot become a network packet. */ }
                    return;
                }
                if(bytes.length < 24 || bytes[0] || bytes[1] || bytes[2] || bytes[3] !== 2 || !ipv4(bytes.subarray(4))) return;
                const frame = new Uint8Array(bytes.length + 10);
                frame.set(router); frame.set(mac, 6); frame[12] = 8; frame[13] = 0; frame.set(bytes.subarray(4), 14);
                this.sent++; this.bus.send("net0-send", frame);
            },
            close: () => {
                if(closed) return;
                closed = true; session.queue.length = 0;
                if(this.connection === session) { this.connection = null; this.progress({ phase: "disconnected", interface: "" }); }
            },
            // Live TCP/relay connections reconnect after a memory restore.
            get_state: () => null,
        };
        this.connection = session;
        this.bus.send("net0-mac", "52:54:00:86:00:01");
        this.progress({ phase: "starting", interface: "" });
        return session;
    }
    reset() { this.connection?.close(); }
    get_state() { return []; }
    set_state() { this.reset(); }
}
