import { V86 } from "../../build/libv86.mjs";
import { measure_syborg_game } from "./syborg_game_metrics.js";

const screen = document.querySelector("#screen");
const canvas = screen.querySelector("canvas");
const result = document.querySelector("#result");
const log = document.querySelector("#log");
const lose = document.querySelector("#lose");
const query = new URLSearchParams(location.search);
const mode = query.get("gpu");
const game = query.get("game");
const bantumi = game === "bantumi";
const game_fixture = "/build/syborg-s0/s7-games/";
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const firmware = path => ({ url: (bantumi ? game_fixture + "firmware/" : "/build/syborg-s0/reference/") + path });
let renderer, vm, home_ready = false;

if(mode === "unavailable" && navigator.gpu)
    Object.defineProperty(navigator.gpu, "requestAdapter", { value: async () => null });
const create_renderer = globalThis.V86SVGARenderer;
if(create_renderer)
    globalThis.V86SVGARenderer = (...args) => (renderer = create_renderer(...args));

function key(code)
{
    vm.symbian_send_key(code, true);
    return sleep(180).then(() => vm.symbian_send_key(code, false));
}

async function tap(x, y)
{
    vm.symbian_set_touch(x, y, true);
    await sleep(180);
    vm.symbian_set_touch(x, y, false);
}

for(const button of document.querySelectorAll("[data-key]"))
    button.onclick = () => key(Number(button.dataset.key));
canvas.onpointerdown = event =>
{
    if(!vm) return;
    const bounds = canvas.getBoundingClientRect();
    tap(Math.floor((event.clientX - bounds.left) * 360 / bounds.width),
        Math.floor((event.clientY - bounds.top) * 640 / bounds.height));
};
lose.onclick = () =>
{
    if(!renderer?.executor.device) return;
    renderer.executor.device.destroy();
    lose.disabled = true;
};

function pixels(points)
{
    const ctx = canvas.getContext("2d");
    return points.map(([x, y]) => [...ctx.getImageData(x, y, 1, 1).data.slice(0, 3)]);
}

function diagnostics()
{
    const gles = renderer?.gles;
    return vm.get_diagnostics().then(cpu => ({
        cpu: cpu.syborg_graphics,
        gpu: gles && window.structuredClone(gles.stats),
        ready: home_ready,
        adapter: !!renderer?.executor.device,
    }));
}

async function measure_scene()
{
    // GLES coordinates mapped to the top-down Window Server bitmap at (24,116).
    const points = [[69,234], [170,234], [69,140], [170,140], [96,198], [96,178]];
    const expected = [[230,40,20], [10,210,30], [20,60,240], [230,210,20], [125,50,130], [20,60,240]];
    const before = await diagnostics();
    for(let attempt = 0; attempt < 100; attempt++)
    {
        const after = await diagnostics();
        if(after.cpu?.lost) throw new Error("WebGPU device was lost during measurement");
        if(after.adapter && after.cpu.swaps - before.cpu.swaps >= 8)
        {
            const colors = pixels(points);
            if(after.cpu.failed_swaps || after.gpu.errors.length || after.gpu.draws - before.gpu.draws < 24 ||
                !colors.every((pixel, i) => pixel.every((byte, j) => Math.abs(byte - expected[i][j]) <= 2)))
                throw new Error("Unexpected GPU presentation " + JSON.stringify({ colors, before, after }));
            return { colors, before, after };
        }
        await sleep(150);
    }
    throw new Error("No continuous native WebGPU presentation");
}

async function save_picture(name)
{
    await fetch("/__artifact?name=" + name + ".png", { method: "POST", body: await new Promise(resolve => canvas.toBlob(resolve)) });
}

async function start()
{
    if(game && !bantumi && game !== "classicube") throw new Error("Unsupported native game fixture " + game);
    const seed_name = query.get("seed") === "fallback" ? "C-fallback.img" : "C.img";
    const fixture_name = game ? "syborg-s7-" + game : "syborg-s6";
    const storage_key = fixture_name + "-" + seed_name;
    let filename = window.sessionStorage.getItem(storage_key);
    let disks = await navigator.storage.getDirectory();
    for(const dir of ["v86", "disks"]) disks = await disks.getDirectoryHandle(dir, { create: true });
    if(!filename)
    {
        const fixture = bantumi ? game_fixture : game === "classicube" ? game_fixture + "classicube/" : "/build/syborg-s0/s6-probe/";
        const card_name = query.get("seed") === "fallback" ? "E-fallback.img" : "E.img";
        const [seed, card] = await Promise.all([fetch(fixture + seed_name), fetch(fixture + card_name)]);
        if(!seed.ok || !card.ok) throw new Error("Prepare " + seed_name + " and " + card_name + " in " + fixture);
        filename = fixture_name + "-" + crypto.randomUUID() + ".img";
        const disk = await disks.getFileHandle(filename, { create: true });
        const transfer = await disks.getFileHandle("card-" + filename, { create: true });
        await seed.body.pipeTo(await disk.createWritable());
        await card.body.pipeTo(await transfer.createWritable());
        window.sessionStorage.setItem(storage_key, filename);
    }
    const disk = await disks.getFileHandle(filename);
    vm = new V86({
        machine_type: "symbian-syborg", cpu_type: "arm32", cpu_profile: "arm1136-r2",
        graphics_adapter: "none", net_device: { type: "none" },
        cpu_worker: true, screen_container: screen, wasm_path: "/build/v86-arm64.wasm", cpu_worker_url: "/build/cpu-worker.js",
        disable_mouse: true, disable_keyboard: true, disable_speaker: true,
        symbian: { manifest: firmware("manifest.json"), rom: firmware("ROM.img"), rofs: firmware("ROM.rofs"),
            devicetree: firmware("syborg.dtb"), webgpu: mode !== "off",
            nvmemory: { url: "opfs:v86/disks/" + filename, disk_option: "read_write" },
            nvmemory2: { url: "opfs:v86/disks/card-" + filename, disk_option: "read_write" } },
    });
    window.s6 = { vm, disk, tap, key, diagnostics, pixels, measure_scene, save_picture,
        measure_game: (api, duration) => measure_syborg_game(vm, renderer, api, duration),
        result: message => { result.textContent = message; } };
    let line = "";
    vm.add_listener("serial0-output-byte", byte =>
    {
        if(byte === 13) return;
        if(byte !== 10) { line += String.fromCharCode(byte); return; }
        if(line === "SYBPROP: Home screen::Home screen sets 101f8766/43 = 101") home_ready = true;
        if(home_ready && /Home screen|DisplayDriver host GL|installserver|System start|Bantumi|ClassiCube/.test(line))
            log.append(line + "\n");
        line = "";
    });
    await new Promise((resolve, reject) =>
    {
        vm.add_listener("emulator-error", reject);
        vm.add_listener("emulator-loaded", () => vm.run().then(resolve, reject));
    });
    result.textContent = "Phone running in CPU Worker";
    for(const button of document.querySelectorAll("[data-key]")) button.disabled = false;
    lose.disabled = mode === "off" || mode === "unavailable";
}
start().catch(error => { result.textContent = "FAIL " + (error.message || error); });
