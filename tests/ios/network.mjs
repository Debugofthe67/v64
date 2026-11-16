import assert from "node:assert/strict";
import { test } from "node:test";
import { Bus } from "../../src/bus.js";
import { IOSNetwork, IOS_NETWORK_SERVICE } from "../../src/ios/network.js";

// A real-shaped IPv4 UDP datagram. Ethernet padding is outside its IP length.
const ip = Uint8Array.from(Buffer.from("4500001c0000000040110000c0a85664c0a8560104d2003500080000", "hex"));
const packet = new Uint8Array(4 + ip.length); packet[3] = 2; packet.set(ip, 4);
test("utun IPv4 crosses the existing Ethernet bus without exposing its AF header", () => {
    const [host, device] = Bus.create(), network = new IOSNetwork(device), frames = [];
    host.register("net0-send", bytes => frames.push(bytes));
    let mac; host.register("net0-mac", value => mac = value);
    assert.equal(network.service("wrong"), null);
    const session = network.service(IOS_NETWORK_SERVICE);
    assert.equal(mac, "52:54:00:86:00:01");
    assert.equal(session.read(8).length, 0, "a short read must not consume a datagram");
    const config = session.read(1504);
    assert.equal(Buffer.from(config.subarray(0, 4)).toString(), "V86N");
    assert.deepEqual([...config.subarray(12)], [192,168,86,100,192,168,86,1,192,168,86,1]);
    session.write(packet); assert.equal(frames.length, 1);
    assert.deepEqual(frames[0].subarray(14), ip);
    assert.deepEqual([...frames[0].subarray(12, 14)], [8, 0]);
    const padded = new Uint8Array(64); padded.set(frames[0]);
    host.send("net0-receive", padded);
    assert.deepEqual(session.read(1504), packet);
    assert.equal(network.status().sent, 1); assert.equal(network.status().received, 1);
    session.write(Uint8Array.of(0, 0, 0, 30, ...ip));
    session.write(packet.subarray(0, packet.length - 1));
    assert.equal(frames.length, 1, "IPv6 and truncated packets are rejected");
    session.close(); assert.equal(network.status().phase, "disconnected");
    assert.equal(session.available(), false);
    assert.ok(network.service(IOS_NETWORK_SERVICE), "helper can reconnect after a snapshot closes its pipe");
});
test("network input is bounded and malformed native status cannot change connectivity", () => {
    const [host, device] = Bus.create(), network = new IOSNetwork(device);
    const session = network.service(IOS_NETWORK_SERVICE); session.read(1504);
    const frame = new Uint8Array(14 + ip.length); frame[12] = 8; frame.set(ip, 14);
    for(let i = 0; i < 300; i++) host.send("net0-receive", frame);
    assert.equal(session.queue.length, 256); assert.equal(network.status().dropped, 44);
    session.write(new TextEncoder().encode('V86S{"phase":"ready","interface":"utun0"}'));
    assert.equal(network.status().phase, "ready");
    session.write(new TextEncoder().encode('V86S{"phase":"made-up"}'));
    session.write(new TextEncoder().encode("V86Sbroken"));
    assert.equal(network.status().phase, "ready");
    network.set_state([]); assert.equal(network.connection, null);
    assert.equal(session.queue.length, 0);
});
