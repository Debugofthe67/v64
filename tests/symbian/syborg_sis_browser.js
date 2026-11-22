import { V86 } from "../../build/libv86.mjs";
import { check_installed_notes, load_transfer_card } from "./syborg_sis_checks.js";

const result = document.querySelector("#result");
const log = document.querySelector("#log");
const screen = document.querySelector("#screen");
const canvas = screen.querySelector("canvas");
const buttons = document.querySelectorAll("button");
const disk_name = "syborg-s4-" + crypto.randomUUID();
const directory = new URL("/build/syborg-s0/reference/", location.href);
const image = name => ({ url: new URL(name, directory).href });
const option = name => ({ url: "opfs:v86/disks/" + name + ".img", disk_option: "read_write" });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const held_keys = new Set();
let manifest, c_disk, vm, touch, busy = true, ready = false, boot_count = 0;

function log_line(text)
{
    log.append(text + "\n");
}

function enable_controls(enabled)
{
    busy = !enabled;
    if(!enabled) release_input();
    for(const button of buttons) button.disabled = !enabled;
}

function send_key(code, down)
{
    if(down === held_keys.has(code)) return;
    if(down) held_keys.add(code);
    else held_keys.delete(code);
    vm.symbian_send_key(code, down);
}

function release_input()
{
    if(touch)
    {
        vm.symbian_set_touch(...touch.point, false);
        touch = null;
    }
    for(const code of held_keys) send_key(code, false);
}

async function setup_disk(disks, name, source)
{
    const handle = await disks.getFileHandle(name + ".img", { create: true });
    await source.pipeTo(await handle.createWritable());
    return handle;
}

async function boot()
{
    ready = false;
    const phone = new V86({
        cpu_type: "arm32", machine_type: "symbian-syborg", cpu_worker: true, autostart: false,
        graphics_adapter: "none", screen_container: screen, net_device: { type: "none" },
        wasm_path: "/build/v86-arm64.wasm", cpu_worker_url: "/build/cpu-worker.js",
        disable_speaker: true, disable_keyboard: true, disable_mouse: true,
        symbian: {
            manifest: image("manifest.json"), rom: image(manifest.files.rom.name),
            rofs: image(manifest.files.rofs.name), devicetree: image(manifest.files.devicetree.name),
            nvmemory: option(disk_name),
            nvmemory2: option(disk_name + "-card"),
        },
    });
    vm = phone;
    let line = "";
    phone.add_listener("serial0-output-byte", byte => {
        if(byte === 13) return;
        if(byte !== 10) { line += String.fromCharCode(byte); return; }
        if(line === "SYBPROP: Home screen::Home screen sets 101f8766/43 = 101" ||
            /^(SYBROFS:|System start ok|SYBPROP: installserver\.exe::!InstallServer)/i.test(line))
            log_line(line);
        line = "";
    });
    await new Promise((resolve, reject) => {
        phone.add_listener("emulator-error", error => {
            if(vm === phone)
            {
                ready = false;
                enable_controls(false);
                result.textContent = "FAIL " + (error?.message || error);
            }
            reject(error);
        });
        phone.add_listener("emulator-loaded", () => phone.run().then(resolve, reject));
    });
    ready = true;
    boot_count++;
    result.textContent = "Phone running in Worker " + boot_count;
}

async function perform(operation)
{
    if(busy) return;
    enable_controls(false);
    try { await operation(); }
    catch(error) { log_line("FAIL " + error.message); }
    finally { enable_controls(ready); }
}

document.querySelector("#reopen").onclick = () => perform(async () => {
    result.textContent = "Stopping the phone and flushing C:…";
    await vm.stop();
    await vm.destroy();
    await boot();
    log_line("Cold reopened the same OPFS C: disk");
});

for(const button of document.querySelectorAll("button[data-version]"))
    button.onclick = () => perform(async () => {
        const version = Number(button.dataset.version);
        await vm.stop();
        try
        {
            await check_installed_notes(await c_disk.getFile(), version);
            log_line(version ? "Verified Notes " + version + ".0 and saved text on C:" : "Verified Notes is absent from C:");
        }
        finally { await vm.run(); }
    });

for(const button of document.querySelectorAll("button[data-key]"))
    button.onclick = async () => {
        const phone = vm, code = Number(button.dataset.key);
        send_key(code, true);
        await sleep(220);
        if(vm === phone) send_key(code, false);
    };

function coordinates(event)
{
    const rect = canvas.getBoundingClientRect();
    const x = Math.min(359, Math.max(0, Math.floor((event.clientX - rect.left) * 360 / rect.width)));
    const y = Math.min(639, Math.max(0, Math.floor((event.clientY - rect.top) * 640 / rect.height)));
    return [x, y];
}

canvas.onpointerdown = event => {
    if(busy || touch) return;
    const point = coordinates(event);
    touch = { id: event.pointerId, point };
    canvas.setPointerCapture(event.pointerId);
    vm.symbian_set_touch(...point, true);
};
canvas.onpointermove = event => {
    if(touch?.id !== event.pointerId) return;
    touch.point = coordinates(event);
    vm.symbian_set_touch(...touch.point, true);
};
canvas.onpointerup = canvas.onpointercancel = canvas.onlostpointercapture = event => {
    if(touch?.id !== event.pointerId) return;
    vm.symbian_set_touch(...touch.point, false);
    touch = null;
};

window.addEventListener("keydown", event => {
    if(busy || event.repeat || !/^[0-9]$/.test(event.key)) return;
    send_key(event.key.charCodeAt(0), true);
    event.preventDefault();
});
window.addEventListener("keyup", event => {
    if(!/^[0-9]$/.test(event.key)) return;
    send_key(event.key.charCodeAt(0), false);
    event.preventDefault();
});
window.addEventListener("blur", release_input);

async function start()
{
    const [response, card] = await Promise.all([fetch(image("manifest.json").url), load_transfer_card()]);
    if(!response.ok) throw new Error("Missing the local S0 firmware artifact directory");
    manifest = await response.json();
    const seed = await fetch(image(manifest.files.c_seed.name).url);
    if(!seed.ok) throw new Error("Could not open the local C: seed");
    let disks = await navigator.storage.getDirectory();
    for(const part of ["v86", "disks"]) disks = await disks.getDirectoryHandle(part, { create: true });
    c_disk = await setup_disk(disks, disk_name, seed.body);
    await setup_disk(disks, disk_name + "-card", card.stream());
    await boot();
    enable_controls(true);
}

enable_controls(false);
start().catch(error => { result.textContent = "FAIL " + (error?.message || error); });
