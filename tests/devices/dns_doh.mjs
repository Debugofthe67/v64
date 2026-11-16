import assert from "node:assert/strict";
import { test } from "node:test";
import { create_eth_encoder_buf, handle_fake_networking } from "../../src/browser/fake_network.js";

const query = Uint8Array.from(Buffer.from("123401000001000000000000076578616d706c6503636f6d0000010001", "hex"));
function request()
{
    const frame = new Uint8Array(42 + query.length), v = new DataView(frame.buffer);
    frame.set([82,84,0,1,2,3,82,84,0,134,0,1,8,0]);
    frame[14] = 0x45; v.setUint16(16, 28 + query.length); frame[22] = 64; frame[23] = 17;
    frame.set([192,168,86,100,192,168,86,1], 26);
    v.setUint16(34, 12345); v.setUint16(36, 53); v.setUint16(38, 8 + query.length);
    frame.set(query, 42); return frame;
}
async function resolve(fetcher, config = {})
{
    const original = globalThis.fetch;
    globalThis.fetch = fetcher;
    try
    {
        return await new Promise(resolve => handle_fake_networking(request(), {
            ...config, router_mac: Uint8Array.of(82,84,0,1,2,3), router_ip: Uint8Array.of(192,168,86,1),
            eth_encoder_buf: create_eth_encoder_buf(), receive: frame => resolve(frame.slice()),
        }));
    }
    finally { globalThis.fetch = original; }
}
test("DoH falls back after a connection failure and preserves the DNS reply", async () => {
    const urls = [], answer = query.slice(); answer[2] |= 0x80;
    const frame = await resolve(async url => {
        urls.push(url);
        if(urls.length === 1) throw new Error("connection reset");
        return new Response(answer);
    });
    assert.deepEqual(urls, ["https://cloudflare-dns.com/dns-query", "https://dns.google/dns-query"]);
    assert.deepEqual(frame.subarray(42, 42 + answer.length), answer);
});
test("an explicit resolver failure returns SERVFAIL without using another provider", async () => {
    const urls = [];
    const frame = await resolve(async url => { urls.push(url); return new Response("bad gateway", { status: 502 }); },
        { doh_server: "resolver.example" });
    assert.deepEqual(urls, ["https://resolver.example/dns-query"]);
    assert.equal(frame[44] & 0x80, 0x80); assert.equal(frame[45] & 15, 2);
    assert.deepEqual(frame.subarray(42,44), query.subarray(0,2));
});
