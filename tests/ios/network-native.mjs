// Owner-firmware acceptance: build the helper with V86_NETWORK_PROBE=1,
// then prepare a disposable --serve --policy NAND with that helper.
// node tests/ios/network-native.mjs path/to/disposable-probe-directory
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { V86 } from "../../src/main.js";

const directory = process.argv[2];
if(!directory) throw Error("Provide a disposable NAND directory prepared with V86_NETWORK_PROBE=1");
const nand = path.resolve(directory, "flash.img");
const emulator = new V86({
    machine_type: "s5l8930", graphics_adapter: "none", log_level: 0, autostart: true,
    jit_switches: { a64_page: 1 }, gles_backdoor: true,
    graphics_adapter_renderer_channel: { post() {}, listen() {} },
    wasm_path: "build/v86-arm64.wasm", net_device: { type: "none" },
    network_relay_url: "wisps://wisp.mercurywork.shop/v86/",
    ios: { nand_boot: true, network: true, nand: { url: nand, size: fs.statSync(nand).size },
        boot_args: "-v serial=3 rd=disk0s1s1" },
});
let serial = "";
emulator.add_listener("serial0-output-byte", byte => serial += String.fromCharCode(byte));
try
{
    await new Promise((resolve, reject) => {
        emulator.add_listener("emulator-loaded", resolve);
        emulator.add_listener("emulator-error", reject);
    });
    const deadline = Date.now() + 600000;
    while(!serial.includes("V86 network probe: HTTP HTTP/1."))
    {
        assert.ok(!serial.includes("panic(cpu"), serial.slice(-4000));
        assert.ok(!/V86 network probe: (DNS|TCP|HTTP) FAILED/.test(serial), serial.slice(-4000));
        assert.ok(Date.now() < deadline, "Timed out waiting for native DNS/TCP/HTTP");
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
    assert.match(serial, /V86 network probe: DNS \d+\.\d+\.\d+\.\d+/);
    assert.match(serial, /V86 network probe: HTTP HTTP\/1\.[01] 200 OK/);
    const network = (await emulator.get_diagnostics()).ios_network;
    assert.equal(network.phase, "ready");
    assert.ok(network.sent > 0 && network.received > 0);
    console.log("PASS: native iOS DNS, TCP and HTTP 200", network);
}
finally
{
    fs.writeFileSync(path.join(directory, "network-serial.log"), serial);
    await emulator.destroy();
}
