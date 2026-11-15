// Real-driver G0 investigation, shared by XP and Win98. Images are opened O_RDONLY.
// Never treats an absent probe, installer failure or stalled guest as acceptance.
import assert from "node:assert/strict";
import {geforce_renderer_policy} from "../lib/geforce_renderer_policy.mjs";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { serialize, deserialize } from "node:v8";
import { MemoryDisk, ReadOnlyOverlayDisk, read_fat16 } from "../smp/disk_fixture.mjs";
import { make_esp } from "../lib/fat.mjs";
import { PictureSink, save_png } from "../lib/picture_sink.mjs";
import { site_directory } from "../lib/site.mjs";
import { read_fat32_file } from "../lib/fat32_reader.mjs";
import { verify_geforce_checkpoint_bundle, read_geforce_checkpoint_state, read_geforce_checkpoint_overlay } from "../lib/geforce_checkpoint.mjs";
import { read_geforce_guest_stack } from "../lib/geforce_guest_memory.mjs";
import { geforce_present_bmp } from "../lib/geforce_present_capture.mjs";
import { watch_geforce_ide_reads } from "../lib/geforce_ide_watch.mjs";
const release_build = !!+process.env.TEST_RELEASE_BUILD;
const { V86 } = await import(release_build ? "../../build/libv86.mjs" : "../../src/main.js");

// A canvas clips transient layers during VGA mode switches. Keep the headless
// screenshot sink equally bounded when an old layer arrives after a resize.
class ProbeSink extends PictureSink
{
    constructor() { super(); this.transitions = []; }
    set_size_graphical(width, height)
    {
        super.set_size_graphical(width, height);
        const last = this.transitions[this.transitions.length - 1];
        if(!last || last[0] !== width || last[1] !== height)
        {
            if(this.transitions.length === 256) this.transitions.shift();
            this.transitions.push([width, height]);
        }
    }

    update_buffer(layers)
    {
        for(const l of layers) for(let y = 0; y < l.buffer_height; y++)
        {
            const sy = l.buffer_y + y, dy = l.screen_y + y;
            if(sy < 0 || sy >= l.pixels.height || dy < 0 || dy >= this.height) continue;
            const left = Math.max(0, -l.screen_x, -l.buffer_x);
            const right = Math.min(l.buffer_width, this.width - l.screen_x, l.pixels.width - l.buffer_x);
            if(right <= left) continue;
            const from = (sy * l.pixels.width + l.buffer_x + left) * 4;
            const to = (dy * this.width + l.screen_x + left) * 4;
            this.rgba.set(l.pixels.data.subarray(from, from + (right - left) * 4), to);
        }
    }
}

// Warm diagnostic snapshots reserve a fixed-size executable. Replace only its
// data clusters while the CPU is stopped; FAT/directory geometry stays intact.
function replace_probe(bytes, replacement)
{
    const old = read_fat16(bytes, "NVPROBE.EXE");
    assert.equal(old?.length, 65536, "probe replacement needs a snapshot made with a reserved 64 KiB executable");
    const view = new DataView(bytes.buffer, bytes.byteOffset), word = at => view.getUint16(at, true);
    const boot = view.getUint32(454, true) * 512, cluster_bytes = bytes[boot + 13] * 512;
    const fat = boot + word(boot + 14) * 512, root = fat + bytes[boot + 16] * word(boot + 22) * 512;
    const data = root + Math.ceil(word(boot + 17) * 32 / 512) * 512;
    let entry = root;
    for(; entry < data; entry += 32) if(Buffer.from(bytes.subarray(entry, entry + 11)).toString("ascii") === "NVPROBE EXE") break;
    assert(entry < data);
    let cluster = word(entry + 26), offset = 0;
    while(offset < replacement.length)
    {
        assert(cluster >= 2 && cluster < 0xFFF8);
        const count = Math.min(cluster_bytes, replacement.length - offset);
        bytes.set(replacement.subarray(offset, offset + count), data + (cluster - 2) * cluster_bytes);
        offset += count; cluster = word(fat + cluster * 2);
    }
}

// Legacy Win9x can lose the immediate make/break pairs from simulate_char
// while opening Run under load. Hold each scan code through a normal delay,
// like the manual keyboard controls, including separate Shift transitions.
function run_scancodes(text)
{
    const keys=new Map();
    for(const [row,start] of [["1234567890-=",2],["qwertyuiop[]",16],["asdfghjkl;'",30],
        ["`",41],["\\",43],["zxcvbnm,./",44],[" ",57]])
        Array.from(row).forEach((character,index)=>keys.set(character,start+index));
    const shifted="!@#$%^&*()_+{}:\"~|<>?",plain="1234567890-=[];'`\\,./",result=[];
    for(const character of text)
    {
        const index=shifted.indexOf(character),base=index<0?character.toLowerCase():plain[index];
        const shift=index>=0 || character!==base,key=keys.get(base);
        assert(key!==undefined,"Run commands require US keyboard ASCII: "+character);
        if(shift)result.push(42);
        result.push(key,key|128);
        if(shift)result.push(170);
    }
    return result;
}

export async function run_geforce_guest(win98)
{
    const root = new URL("../../", import.meta.url).pathname;
    const image = process.env[win98 ? "W98_IMAGE" : "XP_IMAGE"] || path.join(site_directory(root),
        win98 ? "windows98/windows98hdd.img" : "windowsxp/windowsxp_multidisk_C_4G.img");
    const out = path.resolve(process.env.NV_OUT || path.join(root, "build/nv40-" + (win98 ? "win98" : "xp")));
    fs.mkdirSync(out, { recursive: true });
    const disk_reserve_mb=Number(process.env.NV_DISK_RESERVE_MB ?? 8192);
    assert(Number.isSafeInteger(disk_reserve_mb) && disk_reserve_mb>=0 && disk_reserve_mb<=1048576,
        "NV_DISK_RESERVE_MB must be an integer in 0..1048576");
    const free_disk_bytes=()=>{const stat=fs.statfsSync(out);return stat.bavail*stat.bsize;};
    // NV_DRIVER may name either an installer or its extracted directory.
    const driver = path.resolve(process.env.NV_DRIVER || path.join(root, "build/nv40-fixtures", win98 ?
        "81.98_forceware_win9x_english.exe" : "93.71_forceware_winxp2k_english_whql.exe"));
    const run = (cmd, args) => { const r = spawnSync(cmd, args, { encoding: "utf8" }); assert.equal(r.status, 0, r.stderr || String(r.error)); return r; };
    const driver_dir = path.join(out, "driver");
    if(fs.statSync(driver).isFile())
    {
        fs.mkdirSync(driver_dir, { recursive: true });
        run("bsdtar", ["-xf", driver, "-C", driver_dir]);
    }
    const source = fs.statSync(driver).isDirectory() ? driver : driver_dir;
    const expected = fs.readdirSync(source).filter(n => /\.inf$/i.test(n)).flatMap(n =>
        Array.from(fs.readFileSync(path.join(source, n), "latin1").matchAll(/^([a-z0-9_]+\.[a-z0-9]{3})\s*=/gim), m => m[1]));
    const sevenzip = process.env.SEVENZIP || (fs.existsSync("/opt/homebrew/opt/sevenzip/bin/7zz") ? "/opt/homebrew/opt/sevenzip/bin/7zz" : "7z");
    const files = {};
    if(process.env.NV_DX9) files["DX9.EXE"]=fs.readFileSync(process.env.NV_DX9);
    if(process.env.NV_BENCH_LAUNCH)
    {
        assert(!win98,"catalog priming launcher is an XP compatibility helper");
        const launcher=path.join(out,"NVLAUNCH.EXE");
        run("i686-w64-mingw32-gcc",["-Os","-nostdlib","-fno-builtin","-fno-stack-protector","-mno-stack-arg-probe",
            "-Wall","-Wextra","-Werror","-Wl,--entry,_entry@0","-Wl,--subsystem,console",
            path.join(root,"tests/devices/geforce_benchmark.c"),"-lkernel32","-luser32","-o",launcher]);
        files["NVLAUNCH.EXE"]=fs.readFileSync(launcher);
        const directory=path.join(out,"NVJUNC.EXE");
        run("i686-w64-mingw32-gcc",["-Os","-nostdlib","-fno-builtin","-fno-stack-protector","-mno-stack-arg-probe",
            "-Wall","-Wextra","-Werror","-Wl,--entry,_entry@0","-Wl,--subsystem,windows",
            path.join(root,"tests/devices/geforce_directory.c"),"-lkernel32","-o",directory]);
        files["NVJUNC.EXE"]=fs.readFileSync(directory);
    }
    if(win98)
    {
        const iso = process.env.NV_WIN98_ISO || path.join(site_directory(root), "windows98/windows98se.iso");
        const cabs = path.join(out, "windows98-cabs"), pci = path.join(out, "pci");
        fs.mkdirSync(cabs, { recursive: true }); fs.mkdirSync(pci, { recursive: true });
        run(sevenzip, ["e", "-y", "-o" + cabs, iso, "win98/*.CAB"]);
        run(sevenzip, ["e", "-y", "-o" + pci, path.join(cabs, "BASE4.CAB"), "pci.vxd", "pcimp.pci", "isapnp.vxd"]);
        for(const name of ["pci.vxd", "pcimp.pci", "isapnp.vxd"]) files["PCIBUS/" + name] = fs.readFileSync(path.join(pci, name));
    }
    for(const entry of fs.readdirSync(source))
    {
        if(!fs.statSync(path.join(source, entry)).isFile()) continue;
        if(entry.endsWith("_"))
        {
            const unpack = path.join(out, "expanded", entry);
            fs.mkdirSync(unpack, { recursive: true });
            run(sevenzip, ["x", "-y", "-o" + unpack, path.join(source, entry)]);
            for(const name of fs.readdirSync(unpack))
            {
                // SZDD archives can omit the last extension letter (7z reports
                // NVCPL.HL for NVCPL.HL_); the unmodified INF supplies the name.
                const destination = expected.find(n => n.slice(0, -1).toUpperCase() === entry.slice(0, -1).toUpperCase()) || name;
                files["DRIVER/" + destination] = fs.readFileSync(path.join(unpack, name));
            }
        }
        else if(!/\.(cab|hdr|bmp|skin|ibt|iss|inx|bin)$/i.test(entry)) files["DRIVER/" + entry] = fs.readFileSync(path.join(source, entry));
    }
    if(process.env.NV_DOS_TEST)
    {
        const dos=path.join(out,"NVDOS.COM");
        run("nasm",["-f","bin",path.join(root,"tests/devices/geforce_dos.asm"),"-o",dos]);
        files["NVDOS.COM"]=fs.readFileSync(dos);
    }
    const binary = path.join(out, "NVPROBE.EXE");
    run("i686-w64-mingw32-gcc", ["-Os", "-nostdlib", "-fno-builtin", "-fno-stack-protector", "-mno-stack-arg-probe",
        "-Wl,--entry,_entry@0", "-Wl,--subsystem,console", ...(win98 ? ["-DNV_WIN98"] : []),
        ...(process.env.NV_MODE_TEST ? ["-DNV_MODE_TEST"] : []),
        ...(process.env.NV_MODE_MATRIX ? ["-DNV_MODE_MATRIX"] : []),
        ...(process.env.NV_DOS_TEST ? ["-DNV_DOS_TEST"] : []),
        ...(process.env.NV_SKIP_INSTALL ? ["-DNV_SKIP_INSTALL"] : []),
        ...(process.env.NV_AUTOSTART ? ["-DNV_AUTOSTART"] : []),
        ...(process.env.NV_REBOOT ? ["-DNV_REBOOT"] : []), "-o", binary,
        ...(process.env.NV_PROBE_ID ? ["-DNV_PROBE_ID=" + Number(process.env.NV_PROBE_ID)] : []),
        ...(process.env.NV_GDI_TEST || process.env.NV_GDI_FONT_TEST ? ["-DNV_GDI_TEST"] : []),
        ...(process.env.NV_GDI_FONT_TEST ? ["-DNV_GDI_FONT_TEST"] : []),
        ...(process.env.NV_DDRAW_TEST ? ["-DNV_DDRAW_TEST"] : []),
        ...(process.env.NV_D3D_TEST ? ["-DNV_D3D_TEST",path.join(root,"tests/devices/geforce_d3d.c")] : []),
        ...(process.env.NV_D3D_TEXTURE_TEST ? ["-DNV_D3D_TEXTURE_TEST"] : []),
        ...(process.env.NV_DX9_INSTALL ? ["-DNV_DX9_INSTALL"] : []),
        ...(process.env.NV_GDI_TEST || process.env.NV_GDI_FONT_TEST || process.env.NV_DDRAW_TEST ? [path.join(root, "tests/devices/geforce_draw.c")] : []),
        path.join(root, "tests/devices/geforce_probe.c"), "-lkernel32", "-luser32", "-lsetupapi", "-ladvapi32", "-lgdi32"]);
    const probe = new Uint8Array(65536), executable = fs.readFileSync(process.env.NV_PROBE_BINARY || binary);
    assert(executable.length <= probe.length); probe.set(executable);
    files["NVPROBE.EXE"] = probe;
    if(process.env.NV_UI_BINARY)
    {
        // Restored guests must retain the tools disk matching their RAM.
        assert(!process.env.NV_STATE_LOAD,"NV_UI_BINARY requires a cold boot");
        const ui=fs.readFileSync(process.env.NV_UI_BINARY);
        assert(ui.length>=64 && ui.length<=65536 && ui[0]===0x4D && ui[1]===0x5A,"invalid native UI helper");
        files["NVUI.EXE"]=ui;
    }
    if(process.env.NV_FILECHECK_BINARY)
    {
        const diagnostic=fs.readFileSync(process.env.NV_FILECHECK_BINARY);
        assert(diagnostic.length<=65536 && diagnostic[0]===0x4D && diagnostic[1]===0x5A,"invalid native file/memory diagnostic");
        files["NVCHECK.EXE"]=diagnostic;
    }
    if(process.env.NV_MEMORY_WATCH_BINARY)
    {
        const diagnostic=fs.readFileSync(process.env.NV_MEMORY_WATCH_BINARY);
        assert(diagnostic.length<=65536 && diagnostic[0]===0x4D && diagnostic[1]===0x5A,"invalid native memory observer");
        files["NVMEM.EXE"]=diagnostic;
    }
    const tools_bytes = make_esp(files, 120);
    tools_bytes[450] = 0x0E; // normal FAT16, visible to Win9x/XP rather than an ESP
    new DataView(tools_bytes.buffer).setUint32(440, 0x4E563430, true);
    const tools = new MemoryDisk(tools_bytes), before = fs.statSync(image), disk = new ReadOnlyOverlayDisk(image);
    const bundle_path=process.env.NV_STATE_LOAD && process.env.NV_STATE_LOAD+".bundle.json";
    const bundle_hint=bundle_path && fs.existsSync(bundle_path)?JSON.parse(fs.readFileSync(bundle_path,"utf8")):null;
    let os_overlay_bytes=process.env.NV_OVERLAY_LOAD?read_geforce_checkpoint_overlay(process.env.NV_OVERLAY_LOAD,bundle_hint?.osOverlay?.bytes):null;
    // Keep the existing writable RAM tools disk at primary-slave. Benchmarks
    // use secondary-slave, with the same read-only host backing as the OS.
    const game_path=process.env.NV_HDB && path.resolve(process.env.NV_HDB);
    const game=game_path?new ReadOnlyOverlayDisk(game_path):null,game_before=game_path?fs.statSync(game_path):null;
    let game_overlay_bytes=game && process.env.NV_GAME_OVERLAY_LOAD?read_geforce_checkpoint_overlay(process.env.NV_GAME_OVERLAY_LOAD,bundle_hint?.gameOverlay?.bytes):null;
    const sink = new ProbeSink();
    const vram_mb=Number(process.env.NV_VRAM_MB || 128);assert([128,256].includes(vram_mb));
    const memory_mb=Number(process.env.NV_MEMORY_MB || (win98?256:1024));
    assert((win98?[256,384,512]:[1024,2048]).includes(memory_mb),"invalid native guest memory size");
    let state_bytes=process.env.NV_STATE_LOAD?read_geforce_checkpoint_state(process.env.NV_STATE_LOAD):null;
    const restored_bundle=await verify_geforce_checkpoint_bundle({state:process.env.NV_STATE_LOAD,stateBytes:state_bytes,
        osOverlay:process.env.NV_OVERLAY_LOAD,gameOverlay:process.env.NV_GAME_OVERLAY_LOAD,
        osOverlayBytes:os_overlay_bytes,gameOverlayBytes:game_overlay_bytes,
        guest:win98?"win98":"xp",vramMiB:vram_mb,memoryMiB:memory_mb,osImage:image,gameImage:game_path});
    if(os_overlay_bytes){disk.set_state(deserialize(os_overlay_bytes));os_overlay_bytes=null;}
    if(game_overlay_bytes){game.set_state(deserialize(game_overlay_bytes));game_overlay_bytes=null;}
    if(restored_bundle)console.log("NV40 verified matching checkpoint RAM/disk bundle");
    const host_bc_policy=process.env.NV_HOST_BC || "auto";
    assert(["auto","cpu"].includes(host_bc_policy),"NV_HOST_BC must be auto or cpu");
    let remote=null;
    if(process.env.NV_GPU_RENDERER==="chrome")
    {
        const {create_remote_renderer}=await import("../x64/gpu_remote_renderer.mjs");
        remote=await create_remote_renderer({on_log:line=>console.log("NV40 GPU:",line)});
    }
    geforce_renderer_policy(remote?.renderer,host_bc_policy);
    const wasm_path=path.resolve(process.env.NV_WASM || path.join(root,"build",release_build?"v86.wasm":"v86-debug.wasm"));
    const vm = new V86({ ...(remote?{graphics_adapter_renderer_channel:remote.renderer}:{}), disable_jit:!!process.env.NV_DISABLE_JIT, wasm_path, graphics_adapter: "geforce_6800", vram_size: vram_mb << 20,
        bios: { url: root + "bios/seabios.bin" },
        ...(process.env.NV_ROM ? { vga_bios: { url: path.resolve(process.env.NV_ROM) } } : {}),
        // NV_FDA is a data/tools floppy. Its template boot sector must not
        // take precedence over the installed guest during a cold boot.
        hda: disk, hdb: tools, boot_order: process.env.NV_FDA ? 0x132 : 0x213, memory_size: memory_mb << 20,
        ...(win98 || process.env.NV_CDROM ? { cdrom: { url: process.env.NV_CDROM || process.env.NV_WIN98_ISO || path.join(site_directory(root), "windows98/windows98se.iso"), async: true }, boot_order: 0x132 } : {}),
        screen_adapter: sink, acpi: false, net_device: { type: "none" }, disable_speaker: true,
        autostart: !process.env.NV_STATE_LOAD && !game, log_level: 0 });
    const seconds = Number(process.env.NV_SECONDS || 360);
    const launch = Number(process.env.NV_LAUNCH_SECONDS || (process.env.NV_STATE_LOAD ? 10 : 90));
    const run_delay = Number(process.env.NV_RUN_DELAY_MS || 5000);
    assert(Number.isFinite(seconds) && seconds > 0 && seconds <= 21600);
    assert(Number.isFinite(run_delay) && run_delay>=1000 && run_delay<=30000);
    let nv, error = null, launches = 0, next_launch = launch, cancelled = false, checkpoint = false, clock_start = 0;
    let profiler=null,barrier_report=null,stall=null,guest_sampler=null,disk_pause=null;
    let ide_read_watch=null,ide_read_fd=null,ide_read_rows=0,ide_read_dropped=0;
    const cancel = () => { cancelled = true; };
    process.on("SIGINT", cancel);
    vm.add_listener("emulator-error", e => { error = String(e); });
    const started = performance.now(), elapsed = () => (performance.now() - started) / 1000;
    let control_time = 0, next_report = 30, reboot_seen = false;
    let next_capture=0,capture_index=0;
    const capture_interval=Number(process.env.NV_CAPTURE_SECONDS || 0),capture_limit=Number(process.env.NV_CAPTURE_LIMIT || 180);
    assert(Number.isFinite(capture_interval) && capture_interval>=0 && capture_limit>0 && capture_limit<=2000);
    const control_file = process.env.NV_CONTROL || path.join(out, "control.json");
    const live_artifacts=(process.env.NV_TOOLS_LIVE_ARTIFACTS||"").split(";").filter(Boolean),live_bytes=new Map();
    assert(live_artifacts.length<=32 && live_artifacts.every(name=>/^[a-zA-Z0-9_.-]+$/.test(name)),"live tool artifacts must be root filenames");
    // Called only with the CPU stopped. RAM, disk sectors and the embedded
    // tools disk must describe one point in time, not a later run's pagefile.
    const save_bundle = async (state_file,os_file=state_file+".hda-overlay.bin",game_file=state_file+".game-overlay.bin") => {
        const write=(file,bytes)=>{
            fs.writeFileSync(file,bytes);
            return {file:path.resolve(file),bytes:bytes.byteLength,sha256:createHash("sha256").update(bytes).digest("hex")};
        };
        const bundle={status:"complete",guest:win98?"win98":"xp",vramMiB:vram_mb,memoryMiB:memory_mb,osImage:path.resolve(image),gameImage:game_path,
            state:write(state_file,new Uint8Array(await vm.save_state())),
            osOverlay:write(os_file,serialize(disk.get_state())),
            gameOverlay:game?write(game_file,serialize(game.get_state())):null};
        fs.writeFileSync(state_file+".bundle.json",JSON.stringify(bundle,null,2)+"\n");
    };
    const result_text = () => Buffer.from(read_fat16(tools.bytes, "NV.TXT") || []).toString("ascii");
    const trace_report = () => ({ ...nv.trace.report(),
        rendererPolicy:{hostBC:host_bc_policy},
        clock: {mode:vm.v86.cpu.clock.mode, elapsedMs:vm.v86.cpu.clock.now()-clock_start,
            hostElapsedMs:elapsed()*1000, ...vm.v86.cpu.clock.get_diagnostics()},
        pit: {mode:Array.from(vm.v86.cpu.devices.pit.counter_mode),enabled:Array.from(vm.v86.cpu.devices.pit.counter_enabled),
            reload:Array.from(vm.v86.cpu.devices.pit.counter_reload),startTime:Array.from(vm.v86.cpu.devices.pit.counter_start_time),
            startValue:Array.from(vm.v86.cpu.devices.pit.counter_start_value)},
        registers: Array.from(nv.registers, ([offset, value]) => [offset.toString(16), value >>> 0]),
        pci: Array.from(nv.machine.pci_config()),
        cpu: {instructionCounter:vm.v86.cpu.instruction_counter[0]>>>0,eip: vm.v86.cpu.instruction_pointer[0] >>> 0, regs: Array.from(vm.v86.cpu.reg32), halted: vm.v86.cpu.in_hlt[0], flags:vm.v86.cpu.get_eflags(),
            segments:Array.from(vm.v86.cpu.segment_offsets),romHeader:Array.from(vm.v86.cpu.mem8.subarray(0xC0000,0xC0040)),romCode:Array.from(vm.v86.cpu.mem8.subarray(0xC1700,0xC1740))},
        pic:vm.v86.cpu.get_state_pic(),pirq:Array.from(vm.v86.cpu.devices.pci.isa_bridge_space8.slice(0x60,0x64)),
        gpu: nv.graph.engine3d.backend ? nv.graph.engine3d.backend.stats : null,
        ...(ide_read_watch?{ideReadWatch:{...ide_read_watch.stats,records:ide_read_rows,dropped:ide_read_dropped}}:{}),
        ...(barrier_report?{batchBarriers:barrier_report()}:{}),
        textureDecode: nv.graph.engine3d.backend ? nv.graph.engine3d.backend.textures.stats : null,
        shaderTranslation:{...nv.graph.engine3d.translation_stats,entries:nv.graph.engine3d.translated.size,bytes:nv.graph.engine3d.translation_bytes},
        scanout: sink.transitions,
        display: { crtc: Array.from(nv.display.crtc), front: nv.display.front, mode: nv.display.mode() },
        graph: nv.graph.get_state(), graphFaults: nv.graph.faults, fifo: nv.fifo.get_state(), fifoFaults:nv.fifo.faults });
    try
    {
        await new Promise((resolve, reject) => { vm.add_listener("emulator-ready", resolve); vm.add_listener("emulator-error", reject); });
        if(game)
        {
            const channel=vm.v86.cpu.devices.ide.secondary;
            // Use the active core's IDE implementation in both source and
            // release runs, rather than injecting a source/debug device.
            const Interface=channel.slave.constructor;
            channel.slave=new Interface(channel,1,game,false);
        }
        if(process.env.NV_STATE_LOAD)
        {
            await vm.restore_state(state_bytes);
            state_bytes=null;
            assert.equal(vm.v86.cpu.memory_size[0],memory_mb<<20,"restored native guest memory size mismatch");
            if(process.env.NV_PROBE_REPLACE) replace_probe(tools.bytes, probe);
            if(process.env.NV_DISABLE_JIT) vm.v86.cpu.configure_jit_backend({disable_jit:true});
            await vm.run();
        }
        else if(game) await vm.run();
        if(process.env.NV_FDA) await vm.set_fda({url:path.resolve(process.env.NV_FDA),disk_option:"read_only"});
        const cpu = vm.v86.cpu;
        nv = cpu.devices.graphics_adapter.device["nv"];
        nv.trace.enabled = process.env.NV_TRACE !== "0";
        if(process.env.NV_RESOURCE_CACHE_MIB || process.env.NV_RESOURCE_CACHE_ENTRIES)
        {
            const cache=nv.graph.engine3d.backend;assert(cache,"resource cache comparison needs a renderer");
            if(process.env.NV_RESOURCE_CACHE_MIB)
            {const mib=Number(process.env.NV_RESOURCE_CACHE_MIB);assert([64,128,256,512].includes(mib));cache.resource_byte_limit=mib*1048576;}
            if(process.env.NV_RESOURCE_CACHE_ENTRIES)
            {const entries=Number(process.env.NV_RESOURCE_CACHE_ENTRIES);assert([16,64,128,256,512].includes(entries));cache.resource_limit=entries;}
        }
        if(process.env.NV_TEXTURE_CACHE_MIB || process.env.NV_TEXTURE_CACHE_ENTRIES)
        {
            const cache=nv.graph.engine3d.backend?.textures;assert(cache,"texture cache comparison needs a renderer");
            if(process.env.NV_TEXTURE_CACHE_MIB)
            {const mib=Number(process.env.NV_TEXTURE_CACHE_MIB);assert([64,128,256,512].includes(mib));cache.cache_limit=mib*1048576;}
            if(process.env.NV_TEXTURE_CACHE_ENTRIES)
            {const entries=Number(process.env.NV_TEXTURE_CACHE_ENTRIES);assert([256,512,1024].includes(entries));cache.cache_entries=entries;}
        }
        clock_start = cpu.clock.now();
        if(process.env.NV_IDE_WATCH_FIRST!==undefined)
        {
            assert(game,"IDE read observation needs NV_HDB");
            const first=Number(process.env.NV_IDE_WATCH_FIRST),length=Number(process.env.NV_IDE_WATCH_BYTES);
            // Win9x reads this 470 MiB DAT through 1 KiB PRDT segments.
            // Keep a full pass (source plus copy records) within the bound.
            const limit=Number(process.env.NV_IDE_WATCH_LIMIT||2097152);
            assert(Number.isInteger(limit)&&limit>=1&&limit<=2097152,"invalid IDE watch record bound");
            ide_read_fd=fs.openSync(path.join(out,"ide-read-watch.ndjson"),"w");
            ide_read_watch=watch_geforce_ide_reads(cpu,game,first,length,row=>{
                if(ide_read_rows>=limit){ide_read_dropped++;return;}
                fs.writeSync(ide_read_fd,JSON.stringify(row)+"\n");ide_read_rows++;
            });
            fs.writeFileSync(path.join(out,"ide-read-watch-range.json"),JSON.stringify({first,length,limit})+"\n");
        }
        if(process.env.NV_GUEST_WRITE_PAGES)
        {
            const pages=process.env.NV_GUEST_WRITE_PAGES.split(",").map(value=>Number.parseInt(value,16));
            assert(pages.length<=16 && pages.every(page=>Number.isInteger(page)&&page>=0&&page*4096+4096<=cpu.memory_size[0]),
                "write watch needs up to 16 ordinary RAM page numbers in hex");
            const api=cpu.wm.exports;
            assert(api.ir_test_write_watch,"write watch requires an ir-test-hooks Wasm build");
            await vm.stop();
            try {pages.forEach((page,slot)=>assert(api.ir_test_write_watch(slot,page)));}
            finally {await vm.run();}
            const file=path.join(out,"guest-write-watch.json"),records=[];let next=0,dropped=0;
            const poll=()=>{
                const total=api.ir_test_write_watch_total()>>>0;
                let changed=false;
                if(total-next>4096){dropped+=total-next-4096;next=total-4096;}
                while(next<total)
                {
                    const row=Array.from({length:24},(_,word)=>api.ir_test_write_watch_word(next,word)>>>0);
                    if(records.length===65536){records.shift();dropped++;}
                    records.push(row);next++;changed=true;
                }
                if(records.length)
                {
                    const attempts=api.ir_test_write_watch_word(total-1,15)>>>0,last=records[records.length-1];
                    changed=changed||last[15]!==attempts;last[15]=attempts;
                }
                if(!changed)return;
                fs.writeFileSync(file,JSON.stringify({pages,words:["sequence","physical","bytes","eip","previousEip","cpl","cr3",
                    "eax","ecx","edx","ebx","esp","ebp","esi","edi","attempts","pagePrefix0..7"],dropped,records}));
            };
            const timer=setInterval(poll,500);timer.unref();
            guest_sampler=()=>{clearInterval(timer);poll();};
        }
        if(process.env.NV_WATCH_MMIO)
        {
            const offsets=new Set(process.env.NV_WATCH_MMIO.split(",").map(value=>Number.parseInt(value,16)));
            assert(offsets.size<=32 && [...offsets].every(value=>Number.isSafeInteger(value)&&value>=0&&value<0x1000000&&!(value&3)));
            const stackWords=Number(process.env.NV_WATCH_STACK_WORDS||16);
            assert(Number.isInteger(stackWords)&&stackWords>=16&&stackWords<=256);
            const afterDraws=Number(process.env.NV_WATCH_MMIO_AFTER_DRAWS||0);
            assert(Number.isSafeInteger(afterDraws)&&afterDraws>=0);
            const record=nv.trace.record.bind(nv.trace),accesses=[];
            nv.trace.record=(space,offset,size,write,value,implemented)=>{
                record(space,offset,size,write,value,implemented);
                if(space!=="mmio" || !offsets.has(offset) || accesses.length>=512) return;
                if(process.env.NV_WATCH_MMIO_AFTER_GRAPH_FAULT && !nv.graph.faults.length) return;
                if((nv.graph.engine3d.backend?.stats.draws||0)<afterDraws)return;
                accesses.push({elapsed:elapsed(),offset,size,write,value:value>>>0,eip:cpu.instruction_pointer[0]>>>0,
                    stack:read_geforce_guest_stack(cpu,stackWords)});
                fs.writeFileSync(path.join(out,"mmio-watch.json"),JSON.stringify(accesses,null,2));
            };
        }
        if(process.env.NV_GUEST_CPU_SAMPLES)
        {
            const limit=Number(process.env.NV_GUEST_CPU_SAMPLES),samples=[];
            assert(Number.isInteger(limit)&&limit>=1&&limit<=4096);
            const address=process.env.NV_GUEST_RAM_ADDRESS===undefined?null:Number(process.env.NV_GUEST_RAM_ADDRESS);
            assert(address===null||Number.isSafeInteger(address)&&address>=0&&address+16<=cpu.mem8.length&&!(address&3));
            const file=path.join(out,"guest-cpu-samples.json");
            const timer=setInterval(()=>{
                if(samples.length>=limit){clearInterval(timer);return;}
                const backend=nv.graph.engine3d.backend;
                samples.push({elapsed:elapsed(),instructionCounter:cpu.instruction_counter[0]>>>0,eip:cpu.instruction_pointer[0]>>>0,registers:[...cpu.reg32].map(x=>x>>>0),
                    halted:cpu.in_hlt[0],stackSegment:{selector:cpu.sreg[2],base:cpu.segment_offsets[2]>>>0,width:cpu.stack_size_32[0]?32:16},
                    stack:read_geforce_guest_stack(cpu,64),draws:backend?.stats.draws||0,
                    backendPending:!!backend?.pending,batchDraws:backend?.batch?.draws||0,
                    fifo:[0x3240,0x3244,0x3210,0x3270,0x3254].map(at=>nv.registers.get(at)||0),
                    ram:address===null?null:Array.from({length:4},(_,i)=>new DataView(cpu.mem8.buffer,cpu.mem8.byteOffset+address+i*4,4).getUint32(0,true))});
                if(samples.length%10===0||samples.length===limit)fs.writeFileSync(file,JSON.stringify({physicalAddress:address,samples}));
            },100);
            timer.unref();
            const prior_sampler=guest_sampler;
            guest_sampler=()=>{prior_sampler?.();clearInterval(timer);fs.writeFileSync(file,JSON.stringify({physicalAddress:address,samples}));};
        }
        if(process.env.NV_FIFO_FAULTS)
        {
            const record=nv.fifo.record_fault.bind(nv.fifo),captures=[],seen=new Set(),history=[],pageUpdates=[];
            const trace=nv.trace.record.bind(nv.trace);let faulted=false,after=0;
            nv.trace.record=(space,offset,size,write,value,implemented)=>{
                trace(space,offset,size,write,value,implemented);
                const instance=(nv.registers.get(0x322C)||0)*16;
                if(space==="ramin" && write && offset>=instance && offset<instance+16 && pageUpdates.length<128)
                {
                    const backend=nv.graph.engine3d.backend;
                    pageUpdates.push({elapsed:elapsed(),offset,size,value,eip:cpu.instruction_pointer[0]>>>0,
                        channel:nv.fifo.active,put:nv.registers.get(0x3240)||0,get:nv.registers.get(0x3244)||0,
                        cachePut:nv.registers.get(0x3210)||0,cacheGet:nv.registers.get(0x3270)||0,
                        graphBusy:nv.graph.busy,backendPending:!!backend?.pending,draws:backend?.stats.draws||0});
                    fs.writeFileSync(path.join(out,"fifo-page-updates.json"),JSON.stringify(pageUpdates,null,2));
                }
                if(space!=="mmio" || ![0x2100,0x2140,0x2500,0x2504,0x3204,0x3220,0x3228,0x322C,0x3230,0x3250,0x3254,0x3258,0x3270].includes(offset) ||
                    !write && offset!==0x3258 || faulted && after>=512) return;
                history.push({elapsed:elapsed(),offset,size,write,value,eip:cpu.instruction_pointer[0]>>>0,channel:nv.fifo.active,
                    cacheGet:nv.registers.get(0x3270)||0,hash:nv.registers.get(0x3258)||0});
                if(faulted){after++;fs.writeFileSync(path.join(out,"fifo-error-registers.json"),JSON.stringify(history,null,2));}
                else if(history.length>256)history.shift();
            };
            nv.fifo.record_fault=(kind,flags,reason,dmaFault)=>{
                record(kind,flags,reason,dmaFault);
                // Software DAC traps are expected driver callbacks. Preserve
                // the first real cache/pusher errors before their ISR changes
                // RAMHT entries or DMA mappings and obscures the producer.
                if(kind==="cache" && flags===0x100 || captures.length>=16) return;
                const fault=nv.fifo.faults.at(-1),key=JSON.stringify([kind,flags,fault.subc,fault.method,fault.value,reason]);
                if(seen.has(key)) return;seen.add(key);
                faulted=true;
                const config=nv.registers.get(0x2210)||0,bits=9+(config>>>16&3),base=(config&0x1F0)<<8,matches=[];
                for(let index=0;index<2**bits;index++)
                {
                    const at=base+index*8,handle=nv.dma.word(at),context=nv.dma.word(at+4);
                    if(context && handle===fault.value)matches.push({at,context,channel:context>>>23&31,instance:(context&0xFFFFF)*16,engine:context>>>20&7});
                }
                let pushbuffer;
                try {
                    const start=Math.max(0,fault.get-64),dma=nv.dma.descriptor(fault.dma),bytes=nv.dma.read(dma,start,128);
                    const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
                    pushbuffer={start,words:Array.from({length:32},(_,i)=>view.getUint32(i*4,true))};
                } catch(readError){pushbuffer={error:String(readError)};}
                const ramin="fifo-fault-"+String(captures.length).padStart(2,"0")+"-ramin.bin";
                fs.writeFileSync(path.join(out,ramin),nv.vram().subarray(nv.vram_size-(1<<20)));
                captures.push({elapsed:elapsed(),fault,hash:{config,matches},pushbuffer,ramin,history:history.slice(),pageUpdates:pageUpdates.slice(),trace:trace_report()});
                fs.writeFileSync(path.join(out,"fifo-fault-captures.json"),JSON.stringify(captures,null,2));
            };
        }
        if(process.env.NV_WATCH_DMA_WRITE)
        {
            const first=Number(process.env.NV_WATCH_DMA_WRITE),size=Number(process.env.NV_WATCH_DMA_BYTES||4096);
            const space=process.env.NV_WATCH_DMA_SPACE||"vram";
            assert(["vram","system"].includes(space));
            assert(Number.isSafeInteger(first) && first>=0 && Number.isSafeInteger(size) && size>0 && size<=1048576 &&
                first+size<=(space==="system"?cpu.mem8.length:nv.vram_size));
            const engine=nv.graph.engine2d,method=engine.method.bind(engine),write=nv.dma.write.bind(nv.dma),captures=[],seen=new Set();
            let active=null;
            engine.method=(object,at,value)=>{active={object,at,value};try {return method(object,at,value);} finally {active=null;}};
            nv.dma.write=(dma,offset,bytes)=>{
                const at=((dma.pte&0xFFFFF000)>>>0)+dma.adjust+offset;
                // Use the real checked page mappings for system RAM. A paged
                // descriptor's first PTE does not describe its later pages.
                const ranges=space==="system" && dma.target?nv.dma.ranges(dma,offset,bytes.length,true):null;
                const overlaps=ranges?ranges.filter(r=>r.at<first+size && first<r.at+r.count):
                    space==="vram" && !dma.target && dma.linear && at<first+size && first<at+bytes.length?[{at,count:bytes.length,offset:0}]:[];
                if(overlaps.length && captures.length<64)
                {
                    let destination=null,sourceRows=null;
                    if(active) try {destination=engine.surface(active.object,[0x61,0x65,0x8A,0x308A].includes(active.object.class_id)?0x19C:0x198);} catch{}
                    const key=JSON.stringify([dma.instance,offset,active?.object.instance,active?.at,active?.object.methods.get(0x304),active?.object.methods.get(0x30C),
                        active?.object.methods.get(0x408),destination]);
                    if(!seen.has(key))
                    {
                        if(active && [0x77,0x89,0x3089].includes(active.object.class_id)) try
                        {
                            const o=active.object,input=engine.dma(o,0x184),offset=o.methods.get(0x408)||0,pitch=o.methods.get(0x404)&65535;
                            sourceRows=Array.from({length:4},(_,row)=>Array.from(nv.dma.read(input,offset+row*pitch,64)));
                        } catch{}
                        seen.add(key);captures.push({elapsed:elapsed(),space,address:ranges?overlaps[0].at:at,
                            ranges:overlaps.map(r=>({...r,data:Array.from(bytes.slice(r.offset,r.offset+Math.min(64,r.count)))})),
                            eip:cpu.instruction_pointer[0]>>>0,stack:read_geforce_guest_stack(cpu,32),
                            bytes:bytes.length,data:Array.from(bytes.slice(0,64)),
                            dma,destination,sourceRows,method:active?.at,value:active?.value,object:active?{channel:active.object.channel,instance:active.object.instance,
                                class_id:active.object.class_id,methods:Array.from(active.object.methods)}:null});
                        fs.writeFileSync(path.join(out,"dma-write-captures.json"),JSON.stringify(captures,null,2));
                    }
                }
                return write(dma,offset,bytes);
            };
        }
        if(process.env.NV_BATCH_BARRIERS && nv.graph.engine3d.backend)
        {
            const backend=nv.graph.engine3d.backend,barrier=backend.barrier.bind(backend),counts=new Map();let other=0;
            backend.barrier=(object,at,value)=>{
                const result=barrier(object,at,value);
                if(result)
                {
                    const key=object.class_id+":"+at;
                    if(counts.has(key) || counts.size<256)counts.set(key,(counts.get(key)||0)+1);
                    else other++;
                }
                return result;
            };
            barrier_report=()=>({methods:Array.from(counts,([key,count])=>({class_id:Number(key.split(":")[0]),method:Number(key.split(":")[1]),count})),other});
        }
        if(process.env.NV_GRAPH_FAULTS)
        {
            const graph=nv.graph,method=graph.method.bind(graph),bind=graph.bind.bind(graph),error=graph.error.bind(graph),history=new Array(256),captures=[],seen=new Set();
            let cursor=0,total=0;
            const describe=object=>object?{channel:object.channel,instance:object.instance,class_id:object.class_id,
                methods:Array.from(object.methods).filter(([at])=>at<0x2000 || at>=0x40000&&at<0x40010 || at>=0x50000&&at<0x50008),
                streamWords:object.stream.length,streamHead:object.stream.slice(0,32)}:null;
            graph.method=(channel,subc,instance,at,value)=>{
                const object=graph.bindings.get(channel+":"+subc);
                history[cursor++&255]=[channel,subc,instance,object?.class_id??null,at,value,object?.stream.length??0];total++;
                return method(channel,subc,instance,at,value);
            };
            graph.bind=(channel,subc,instance)=>{
                const object=bind(channel,subc,instance);
                history[cursor++&255]=[channel,subc,instance,object.class_id,0,instance,object.stream.length];total++;
                return object;
            };
            graph.error=(channel,subc,at,value,source=0x40,status=0x4000,reason="unimplemented PGRAPH method")=>{
                error(channel,subc,at,value,source,status,reason);
                const object=graph.bindings.get(channel+":"+subc),key=JSON.stringify([channel,subc,object?.class_id,at,reason]);
                if(captures.length>=16 || seen.has(key)) return;
                seen.add(key);
                const references=[];
                if(object) for(let field=0x180;field<=0x1B8;field+=4) if(object.methods.has(field))
                {
                    const instance=object.methods.get(field)*16,entry={field,instance,loaded:describe(graph.objects.get(channel+":"+instance))};
                    try {entry.ramin=Array.from({length:4},(_,i)=>nv.dma.word(instance+i*4));}
                    catch(readError){entry.error=String(readError);}
                    references.push(entry);
                }
                const fifoRegisters=[0x3204,0x3210,0x3228,0x322C,0x3240,0x3244,0x3270,0x3280,0x32A8,0x32AC].map(at=>[at,nv.registers.get(at)||0]);
                let objectRAMIN=null;
                if(object) try {objectRAMIN=Array.from({length:4},(_,i)=>nv.dma.word(object.instance+i*4));}
                catch(readError){objectRAMIN=String(readError);}
                let pushbuffer=null;
                try {
                    const get=nv.registers.get(0x3244)||0,start=Math.max(0,get-64),dma=nv.dma.descriptor((nv.registers.get(0x322C)||0)*16);
                    const bytes=nv.dma.read(dma,start,128),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
                    pushbuffer={start,words:Array.from({length:32},(_,i)=>view.getUint32(i*4,true))};
                } catch(readError){pushbuffer={error:String(readError)};}
                captures.push({elapsed:elapsed(),channel,subc,method:at,value,source,status,reason:reason||"unimplemented PGRAPH method",
                    object:describe(object),objectRAMIN,fifoRegisters,pushbuffer,references,
                    history:Array.from({length:Math.min(total,256)},(_,i)=>history[(cursor-Math.min(total,256)+i)&255])});
                fs.writeFileSync(path.join(out,"graph-fault-captures.json"),JSON.stringify(captures,null,2));
            };
        }
        if(process.env.NV_DRAW_FAULTS && nv.graph.engine3d.backend)
        {
            const backend=nv.graph.engine3d.backend,draw=backend.draw.bind(backend),faults=[],seen=new Set();
            backend.draw=(object,mode,words,indices,subc)=>{
                try {return draw(object,mode,words,indices,subc);}
                catch(error)
                {
                    const reason=String(error.message || error),key=JSON.stringify([reason,object.methods.get(0x220),object.methods.get(0x208)]);
                    if(!seen.has(key) && faults.length<16)
                    {
                        let program;
                        try {program=nv.graph.engine3d.program(object);} catch(captureError){program={error:String(captureError)};}
                        seen.add(key);faults.push({elapsed:elapsed(),reason,channel:object.channel,instance:object.instance,
                            mode,subc,words:words?.length||0,indices:indices?.length||0,methods:Array.from(object.methods),program});
                        fs.writeFileSync(path.join(out,"draw-faults.json"),JSON.stringify(faults,null,2));
                    }
                    throw error;
                }
            };
        }
        if(process.env.NV_DRAW_CAPTURE && nv.graph.engine3d.backend)
        {
            const engine=nv.graph.engine3d,backend=engine.backend,draw=backend.draw.bind(backend),file=path.join(out,"draw-captures.jsonl");
            const first=Number(process.env.NV_DRAW_CAPTURE_FIRST || 0),limit=Number(process.env.NV_DRAW_CAPTURE_LIMIT || 256),
                budget=Number(process.env.NV_DRAW_CAPTURE_MB || 16)*1048576;
            assert(Number.isSafeInteger(first) && first>=0 && Number.isSafeInteger(limit) && limit>0 && limit<=4096 &&
                Number.isSafeInteger(budget) && budget>0 && budget<=64*1048576,"invalid draw capture bounds");
            let count=0,bytes=0;fs.writeFileSync(file,"");
            backend.draw=(object,mode,words,indices,subc)=>{
                const before=backend.stats.draws,result=draw(object,mode,words,indices,subc);
                if(backend.stats.draws===before && !process.env.NV_DRAW_CAPTURE_SKIPS || backend.stats.draws<first || count>=limit || bytes>=budget) return result;
                let capture={ordinal:count++,elapsed:elapsed(),draw:backend.stats.draws,mode,subc,channel:object.channel,instance:object.instance,
                    submitted:backend.stats.draws!==before,indexCount:indices?.length,inlineWordCount:words?.length};
                try
                {
                    const program=engine.program(object),attributes=[...new Set(program.vertex.instructions.flatMap(instruction=>
                        instruction.sources.filter(source=>source.type==="input").map(source=>source.index)))].sort((a,b)=>a-b);
                    const inputs=attributes.map(attribute=>[attribute,[1,0]]);
                    const stride=indices?0:Array.from({length:16},(_,i)=>engine.state.vertex_layout(object.methods.get(0x1740+i*4)||0))
                        .reduce((sum,layout)=>sum+Math.ceil(layout.bytes/4),0);
                    const vertices=indices?engine.state.array_vertices(object,indices.slice(0,64),inputs):
                        engine.state.inline_vertices(object,words.slice(0,stride*64),inputs);
                    capture={...capture,program,methods:Array.from(object.methods),attributes,vertices:{count:vertices.count,stride:vertices.stride,
                        words:Array.from(new Uint32Array(vertices.bytes.buffer,vertices.bytes.byteOffset,vertices.bytes.byteLength/4))}};
                    if(process.env.NV_DRAW_CAPTURE_TEXTURES)
                    {
                        capture.textures=[...new Set(program.fragment.instructions.filter(i=>["TEX","TXP","TXB","TXL","TXD"].includes(i.name)).map(i=>i.texture))].map(unit=>{
                            const surface=backend.textures.describe(object,unit),images=backend.textures.images(surface);
                            return {unit,surface,images:images.reduce((sum,bytes)=>sum+bytes.length,0)<=1048576?
                                images.map(bytes=>Buffer.from(bytes).toString("base64")):null};
                        });
                    }
                }
                catch(captureError){capture.error=String(captureError);}
                const line=JSON.stringify(capture)+"\n";if(bytes+line.length<=budget){fs.appendFileSync(file,line);bytes+=line.length;}
                return result;
            };
        }
        if(process.env.NV_DIAGNOSTIC_DRAW_PIXEL && nv.graph.engine3d.backend)
        {
            const [x,y]=process.env.NV_DIAGNOSTIC_DRAW_PIXEL.split(",").map(Number);
            const first=Number(process.env.NV_DIAGNOSTIC_DRAW_FIRST||0),limit=Number(process.env.NV_DIAGNOSTIC_DRAW_LIMIT||256);
            assert([x,y].every(value=>Number.isInteger(value)&&value>=0&&value<4096),"invalid diagnostic pixel");
            assert(Number.isSafeInteger(first)&&first>=0 && Number.isSafeInteger(limit)&&limit>0&&limit<=4096,"invalid diagnostic draw range");
            const engine=nv.graph.engine3d,backend=engine.backend,draw=backend.draw.bind(backend),flush=backend.flush.bind(backend),complete=backend.complete.bind(backend);
            const metadata=new Map(),events=[],file=path.join(out,"draw-pixel-history.json");let current=null,ordinal=0;
            const pixel=(bytes,at,target)=>{
                if([75,80].includes(target.d3d)) return [target.bpp===2?bytes[at]|bytes[at+1]<<8:
                    (bytes[at]|bytes[at+1]<<8|bytes[at+2]<<16|bytes[at+3]<<24)>>>0];
                if(target.bpp===4) return Array.from(bytes.subarray(at,at+4));
                const word=bytes[at]|bytes[at+1]<<8,bits=target.d3d===23?6:5;
                return [Math.round((word&31)*255/31),Math.round((word>>>5&(1<<bits)-1)*255/((1<<bits)-1)),
                    Math.round((word>>>(5+bits)&31)*255/31),255];
            };
            backend.draw=(object,mode,words,indices,subc)=>{
                const index=ordinal++;
                if(index<first || index>=first+limit){current=null;return draw(object,mode,words,indices,subc);}
                current={ordinal:index,mode,subc,instance:object.instance,methods:Array.from(object.methods),program:engine.program(object),
                    inlineWordCount:words?.length,firstWords:words?.slice(0,256),firstIndices:indices?.slice(0,64)};
                const before=backend.stats.draws,result=draw(object,mode,words,indices,subc);
                if(process.env.NV_DIAGNOSTIC_DRAW_FLUSH && backend.stats.draws!==before)backend.flush();
                return result;
            };
            backend.flush=()=>{
                const before=backend.pending,result=flush();
                if(!before && backend.pending)metadata.set(backend.pending,current);
                return result;
            };
            backend.complete=()=>{
                const pending=backend.pending;
                if(pending && pending.done && !pending.requests.size && (!pending.query || pending.query.value!==null))
                {
                    const item=metadata.get(pending);
                    const prior_events=events.length;
                    if(events.length<256 && item) for(const {target,bytes} of pending.outputs)
                    {
                        if(events.length>=256) break;
                        if(target.swizzle || ![2,4].includes(target.bpp) || target.bpp===2 && ![23,24,80].includes(target.d3d) || x>=target.width || y>=target.height) continue;
                        const offset=(y*target.width+x)*target.bpp,after=pixel(bytes,offset,target);
                        const before=pixel(nv.dma.read(target.dma,target.offset+y*target.pitch+x*target.bpp,target.bpp),0,target);
                        const depth=[75,80].includes(target.d3d);
                        if(before.some((value,index)=>value!==after[index]))events.push({elapsed:elapsed(),x,y,target:target.offset,format:target.d3d,depth,before,after,
                            draw:item?.ordinal,mode:item?.mode,fragment:item?.methods.find(([at])=>at===0x8E4)?.[1],
                            ...(process.env.NV_DIAGNOSTIC_DRAW_CAUSE_ALL || depth || after.slice(0,3).every(value=>value===0)&&before.slice(0,3).some(Boolean)?{cause:item}:{})});
                    }
                    metadata.delete(pending);
                    if(events.length!==prior_events)fs.writeFileSync(file,JSON.stringify(events,null,2));
                }
                return complete();
            };
        }
        if(process.env.NV_CPU_PROFILE)
        {
            const {Session}=await import("node:inspector"),session=new Session();session.connect();
            const post=(method)=>new Promise((resolve,reject)=>session.post(method,(error,result)=>error?reject(error):resolve(result)));
            const backend=nv.graph.engine3d.backend,pending=new Map();let pending_ms=0,releases=0;
            const counters=()=>({gpu:backend?{...backend.stats}:null,
                texture:backend?{...backend.textures.stats}:null,shader:{...nv.graph.engine3d.translation_stats},
                graphFaults:nv.graph.faults.length,front:nv.display.front});
            const close=item=>{
                if(pending.has(item)){pending_ms+=performance.now()-pending.get(item);pending.delete(item);}
            };
            if(backend)
            {
                const flush=backend.flush.bind(backend),complete=backend.complete.bind(backend),fail=backend.fail.bind(backend);
                backend.flush=()=>{
                    const before=backend.pending,result=flush();
                    if(!before && backend.pending)pending.set(backend.pending,performance.now());return result;
                };
                backend.complete=()=>{
                    const item=backend.pending;
                    if(item?.done && !item.requests.size && (!item.query || item.query.value!==null))close(item);
                    return complete();
                };
                backend.fail=reason=>{close(backend.pending);return fail(reason);};
            }
            const scene_limit=Number(process.env.NV_PROFILE_SCENES||0),scenes=[];
            assert(Number.isSafeInteger(scene_limit) && scene_limit>=0 && scene_limit<=2);
            const release=nv.display.release_semaphore.bind(nv.display);
            nv.display.release_semaphore=value=>{
                const result=release(value);releases++;
                const mode=nv.display.mode();
                if(scenes.length<scene_limit && backend && !backend.pending && !backend.stats.failures &&
                    backend.stats.draws>=[1000,10000][scenes.length] &&
                    mode?.width===1280 && mode.height===1024 && mode.bytes===4)
                {
                    const bytes=geforce_present_bmp(nv.vram(),mode,value);
                    // Initial mode switches may present black. Keep an actual
                    // nonempty original scene, bounded to two frames per run.
                    if(bytes.subarray(54).some(byte=>byte!==0))
                    {
                        const file="profile-scene-"+(scenes.length+1)+".bmp";
                        fs.writeFileSync(path.join(out,file),bytes);
                        scenes.push({file,sha256:createHash("sha256").update(bytes).digest("hex"),
                            bytes:bytes.length,release:releases,draws:backend.stats.draws,front:value,
                            mode,elapsedWindowMs:performance.now()-started});
                    }
                }
                return result;
            };
            await post("Profiler.enable");const start_requested=performance.now();await post("Profiler.start");
            const started=performance.now(),cpu_start=process.cpuUsage(),before=counters();
            pending_ms=0;pending.clear();releases=0;if(backend?.pending)pending.set(backend.pending,started);
            profiler={session,post,window:()=>({guest:win98?"win98":"xp",vramMiB:vram_mb,
                build:release_build?"release":"debug",state:process.env.NV_STATE_LOAD||null,
                textureCache:backend?{bytes:backend.textures.cache_limit,entries:backend.textures.cache_entries}:null,
                wallMs:performance.now()-started,startHandshakeMs:started-start_requested,nodeCpuUs:process.cpuUsage(cpu_start),
                backendPendingMs:pending_ms+[...pending.values()].reduce((sum,at)=>sum+performance.now()-at,0),
                primarySemaphoreReleases:releases,sceneCaptures:scenes,before,after:counters(),
                note:"Backend pending wall time includes transport, rendering and readback, and overlaps Node CPU time. Semaphore releases are not an FPS measurement."})};
        }
        if(process.env.NV_FIFO_STALL_SECONDS)
        {
            const seconds=Number(process.env.NV_FIFO_STALL_SECONDS);
            assert(Number.isFinite(seconds) && seconds>=1 && seconds<=30,"invalid FIFO stall threshold");
            stall={seconds,changed:elapsed(),progress:null,captures:[],seen:new Set()};
        }
        if(process.env.NV_WATCH_FLIP)
        {
            const original=nv.trace.record.bind(nv.trace),captures=[];
            nv.trace.record=(space,offset,size,write,value,implemented)=>{
                original(space,offset,size,write,value,implemented);
                const class_id=Math.floor(offset/0x2000),method=offset&0x1FFF;
                const graphMethod=space==="graph" && ([0x4097,0x9F].includes(class_id) && method>=0x120 && method<=0x130 ||
                    class_id===0x4097 && method>=0x1D6C && method<=0x1D74);
                if(!write || !graphMethod && !(space==="mmio" && [0x400304,0x400310,0x40032C,0x400710,0x40071C,0x400720,0x600800].includes(offset))) return;
                const position=nv.graph.flip_context_offset();
                captures.push({elapsed:elapsed(),sequence:nv.trace.sequence,space,offset,value,eip:cpu.instruction_pointer[0]>>>0,
                    current:nv.registers.get(0x40032C)||0,context:nv.graph.context,flips:nv.graph.flips.map(f=>f.slice()),
                    ramin:position===null?[]:[...nv.graph.flip_contexts.keys()].map(instance=>[instance,nv.dma.word(instance*16+position)])});
                if(captures.length>512)captures.shift();
                fs.writeFileSync(path.join(out,"flip-watch.json"),JSON.stringify(captures,null,2));
            };
        }
        if(process.env.NV_WATCH_RAMIN)
        {
            const address=Number.parseInt(process.env.NV_WATCH_RAMIN,16);assert(address>=0 && address+4<=1<<20 && !(address&3));
            const original=nv.ramin_write.bind(nv),captures=[];
            nv.ramin_write=(offset,value)=>{
                original(offset,value);
                if(offset!==address+3 || captures.length>=8) return;
                const word=nv.dma.word(address);if(word&1) return;
                captures.push({elapsed:elapsed(),sequence:nv.trace.sequence,address,word,
                    eip:cpu.instruction_pointer[0]>>>0,regs:Array.from(cpu.reg32,v=>v>>>0),
                    stack:read_geforce_guest_stack(cpu,48),fifo:nv.fifo.get_state(),graph:nv.graph.get_state(),gpu:{...nv.graph.engine3d.backend?.stats}});
                fs.writeFileSync(path.join(out,"ramin-watch.json"),JSON.stringify(captures,null,2));
            };
        }
        if(process.env.NV_WATCH_RAMHT_HANDLE)
        {
            assert(/^(?:0x)?[0-9a-f]{1,8}$/i.test(process.env.NV_WATCH_RAMHT_HANDLE));
            const handle=Number.parseInt(process.env.NV_WATCH_RAMHT_HANDLE,16);
            assert(Number.isSafeInteger(handle)&&handle>=0&&handle<=0xFFFFFFFF);
            const original=nv.ramin_write.bind(nv),lookup=nv.fifo.hash.bind(nv.fifo),writes=[],lookups=[],tracked=new Set();
            const stackWords=Number(process.env.NV_WATCH_STACK_WORDS||48);
            assert(Number.isSafeInteger(stackWords)&&stackWords>=16&&stackWords<=256);
            let failedLookups=0;
            fs.writeFileSync(path.join(out,"ramht-handle-watch.json"),JSON.stringify({handle,writes,lookups},null,2));
            const capture=item=>{
                if(item.kind==="write"&&writes.length>=128) return;
                if(item.kind==="lookup"&&!item.result)
                {if(failedLookups>=16) return;failedLookups++;}
                const backend=nv.graph.engine3d.backend,stack=cpu.reg32[4]>>>0;
                const capture={elapsed:elapsed(),...item,eip:cpu.instruction_pointer[0]>>>0,
                    stackAddress:stack,cpuRegisters:[...cpu.reg32].map(value=>value>>>0),
                    stack:item.kind==="write"||!item.result?read_geforce_guest_stack(cpu,stackWords):null,
                    channel:nv.fifo.active,registers:[0x3210,0x3270,0x3240,0x3244,0x3248,0x3228,0x3250,0x3254].map(at=>[at,nv.registers.get(at)||0]),
                    graphBusy:!!backend?.pending||nv.graph.flips.some(f=>!!f[3]),backendPending:!!backend?.pending,gpu:{...backend?.stats}};
                if(item.kind==="write")writes.push(capture);
                else {lookups.push(capture);if(lookups.length>64)lookups.shift();}
                if(item.kind==="write"||!item.result)fs.writeFileSync(path.join(out,"ramht-handle-watch.json"),JSON.stringify({handle,writes,lookups},null,2));
            };
            nv.ramin_write=(offset,value)=>{
                const config=nv.registers.get(0x2210)||0,base=(config&0x1F0)<<8,size=8*2**(9+(config>>>16&3));
                const at=offset&~7,inside=offset>=base&&offset<base+size;
                const before=inside?[nv.dma.word(at),nv.dma.word(at+4)]:null;
                if(before?.[0]===handle)tracked.add(at);
                original(offset,value);
                if(!inside||writes.length>=128) return;
                const after=[nv.dma.word(at),nv.dma.word(at+4)];
                if(after[0]===handle)tracked.add(at);
                if(tracked.has(at)&&(before[0]!==after[0]||before[1]!==after[1]))capture({kind:"write",at,offset,value,before,after});
            };
            nv.fifo.hash=value=>{
                const result=lookup(value);
                if((value>>>0)===handle)capture({kind:"lookup",handle,result});
                return result;
            };
        }

        for(; elapsed() < seconds && !error && !cancelled;)
        {
            await delay(capture_interval?Math.min(1000,Math.max(100,capture_interval*1000)):1000);
            const available=disk_reserve_mb?free_disk_bytes():Infinity;
            if(available<disk_reserve_mb*1048576)
            {
                await vm.stop();
                // Leave room for final artifacts and disk overlays as well as
                // RAM/VRAM and the embedded tools disk. Never start a second
                // automatic state write when this reserve cannot cover one.
                const minimum=(memory_mb+vram_mb+1024)*1048576+tools.bytes.byteLength;
                disk_pause={availableBytes:available,reserveBytes:disk_reserve_mb*1048576,
                    checkpointMinimumBytes:minimum,checkpoint:null};
                checkpoint=true;
                if(free_disk_bytes()>=minimum)
                {
                    const state_file=path.join(out,"checkpoint-disk-reserve-"+Date.now()+".state");
                    await save_bundle(state_file);disk_pause.checkpoint=state_file+".bundle.json";
                }
                fs.writeFileSync(path.join(out,"disk-reserve.json"),JSON.stringify(disk_pause,null,2)+"\n");
                console.log("NV40 host disk reserve reached; matching checkpoint",disk_pause.checkpoint);
                cancelled=true;break;
            }
            cpu.devices.display.request_frame(true);
            for(const name of live_artifacts)
            {
                const bytes=read_fat16(tools.bytes,name);
                if(bytes && bytes.length<=1<<20 && !Buffer.from(bytes).equals(live_bytes.get(name)||Buffer.alloc(0)))
                {
                    const copy=Buffer.from(bytes);live_bytes.set(name,copy);fs.writeFileSync(path.join(out,name),copy);
                }
            }
            if(stall)
            {
                const reg=at=>nv.registers.get(at)||0,backend=nv.graph.engine3d.backend;
                const progress=[reg(0x3244),reg(0x3270),backend?.stats.draws||0].join(":");
                if(progress!==stall.progress){stall.progress=progress;stall.changed=elapsed();}
                const queued=reg(0x3240)!==reg(0x3244) || reg(0x3210)!==reg(0x3270) || reg(0x3254)&0x10 || nv.graph.flips.some(f=>!!f[3]);
                if(queued && !backend?.pending && elapsed()-stall.changed>=stall.seconds && stall.captures.length<8)
                {
                    const key=JSON.stringify([progress,reg(0x3204),reg(0x3254),nv.graph.flips,nv.graph.context]);
                    if(!stall.seen.has(key))
                    {
                        stall.seen.add(key);let pushbuffer;
                        try {
                            const start=Math.max(0,reg(0x3244)-64),dma=nv.dma.descriptor(reg(0x322C)*16),bytes=nv.dma.read(dma,start,128);
                            const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
                            pushbuffer={start,words:Array.from({length:32},(_,i)=>view.getUint32(i*4,true))};
                        } catch(readError){pushbuffer={error:String(readError)};}
                        stall.captures.push({elapsed:elapsed(),unchangedSeconds:elapsed()-stall.changed,pushbuffer,
                            pendingBatch:backend?.batch?{draws:backend.batch.draws}:null,trace:trace_report()});
                        fs.writeFileSync(path.join(out,"fifo-stalls.json"),JSON.stringify(stall.captures,null,2));
                        if(process.env.NV_STATE_SAVE_STALL && process.env.NV_STATE_SAVE && !checkpoint)
                        {
                            await vm.stop();
                            try {await save_bundle(process.env.NV_STATE_SAVE,process.env.NV_OVERLAY_SAVE,process.env.NV_GAME_OVERLAY_SAVE);checkpoint=true;}
                            finally {await vm.run();}
                        }
                    }
                }
            }
            if(capture_interval && elapsed()>=next_capture && capture_index<capture_limit)
            {
                next_capture=elapsed()+capture_interval;
                save_png(sink,out,"capture-"+String(capture_index++).padStart(4,"0"));
            }
            if(process.env.NV_DOS_TEST && sink.graphical && (sink.width === 320 || sink.width === 640 && sink.height === 400))
                save_png(sink, out, "dos");
            if(!reboot_seen && result_text().includes("REBOOT_REQUEST"))
            {
                reboot_seen = true; launches = 0; next_launch = elapsed() + 100;
            }
            if(fs.existsSync(control_file))
            {
                const modified = fs.statSync(control_file).mtimeMs;
                if(modified > control_time)
                {
                    control_time = modified;
                    const input = fs.readFileSync(control_file, "utf8").trim();
                    const command = input.startsWith("{") ? JSON.parse(input) : { run: input };
                    if(command.stop) {cancelled=true;break;}
                    if(command.checkpoint)
                    {
                        const tag=String(command.checkpoint);assert(/^[a-zA-Z0-9_-]{1,64}$/.test(tag),"invalid checkpoint label");
                        await vm.stop();
                        try {await save_bundle(path.join(out,"checkpoint-"+tag+".state"));}
                        finally {await vm.run();}
                        console.log("NV40 checkpoint",tag,"at",Math.round(elapsed()),"seconds");
                    }
                    if(command.pointer)
                    {
                        assert(Array.isArray(command.pointer) && command.pointer.length===2 &&
                            command.pointer.every(value=>Number.isFinite(value) && Math.abs(value)<=2048),"invalid relative mouse counts");
                        vm.bus.send("mouse-pointer-lock",true);
                        vm.bus.send("mouse-delta",command.pointer);await delay(300);
                    }
                    if(command.click)
                    {
                        vm.bus.send("mouse-click",[true,false,false]);await delay(100);
                        vm.bus.send("mouse-click",[false,false,false]);
                    }
                    if(command.keys) await vm.keyboard_send_scancodes(command.keys, 30);
                    if(command.run)
                    {
                        const codes=run_scancodes(command.run);
                        await vm.keyboard_send_scancodes([184,157,170,182,0xE0,0xDB,0xE0,0xDC],30);
                        await vm.keyboard_send_scancodes([0xE0, 0x5B, 0x13, 0x93, 0xE0, 0xDB], 30);
                        await delay(run_delay);
                        await vm.keyboard_send_scancodes([29,30,158,157],30);
                        await vm.keyboard_send_scancodes(codes,30);
                        await vm.keyboard_send_scancodes([28, 156], 30);
                    }
                }
            }
            if(process.env.NV_STATE_SAVE && !checkpoint &&
                (process.env.NV_STATE_SAVE_AT && elapsed() >= Number(process.env.NV_STATE_SAVE_AT) ||
                process.env.NV_STATE_SAVE_DRAWS && nv.graph.engine3d.backend &&
                    nv.graph.engine3d.backend.stats.draws >= Number(process.env.NV_STATE_SAVE_DRAWS)))
            {
                await vm.stop();
                await save_bundle(process.env.NV_STATE_SAVE,process.env.NV_OVERLAY_SAVE,process.env.NV_GAME_OVERLAY_SAVE);
                checkpoint = true;
                await vm.run();
            }
            if(!process.env.NV_HOLD && launches < 3 && elapsed() >= next_launch && (!result_text() || reboot_seen))
            {
                launches++; next_launch = elapsed() + 45;
                for(let i = 0; i < 3; i++) { await vm.keyboard_send_scancodes([1, 129], 30); await delay(500); }
                await vm.keyboard_send_scancodes([0xE0, 0x5B, 0x13, 0x93, 0xE0, 0xDB], 30); await delay(1500);
                if(win98) await vm.keyboard_send_text("d:\\nvprobe.exe", 30);
                else await vm.keyboard_send_text("cmd /c for %d in (d e f g h i j k) do @if exist %d:\\nvprobe.exe %d:\\nvprobe.exe", 30);
                await vm.keyboard_send_scancodes([28, 156], 30);
            }
            if(elapsed() >= next_report)
            {
                next_report = elapsed() + 30;
                console.log("NV40", win98 ? "98" : "XP", Math.floor(elapsed()), "s", result_text().trim(), "registers", nv.trace.counts.size);
                save_png(sink, out, "progress");
                fs.writeFileSync(path.join(out, "progress-trace.json"), JSON.stringify(trace_report()));
            }
            if(!process.env.NV_HOLD && result_text().includes("END\r\n"))
            {
                await delay(Number(process.env.NV_GRACE_SECONDS || 5) * 1000);
                cpu.devices.display.request_frame(true);
                await delay(100);
                break;
            }
        }
    }
    catch(e) { error = e.stack || String(e); }
    finally
    {
        if(guest_sampler)guest_sampler();
        if(profiler)
        {
            try
            {
                const window=profiler.window(),stop_started=performance.now();
                const {profile}=await profiler.post("Profiler.stop");
                window.stopHandshakeMs=performance.now()-stop_started;
                fs.writeFileSync(path.join(out,"cpu-profile.cpuprofile"),JSON.stringify(profile));
                fs.writeFileSync(path.join(out,"profile-window.json"),JSON.stringify(window,null,2)+"\n");
            }
            catch(e) {error=error || e.stack || String(e);}
            finally {profiler.session.disconnect();}
        }
        await vm.stop();
        ide_read_watch?.close();if(ide_read_fd!==null)fs.closeSync(ide_read_fd);
        if(process.env.NV_FDA)fs.writeFileSync(path.join(out,"fda-final.img"),vm.get_disk_fda());
        if(process.env.NV_STATE_SAVE && !checkpoint)
            await save_bundle(process.env.NV_STATE_SAVE,process.env.NV_OVERLAY_SAVE,process.env.NV_GAME_OVERLAY_SAVE);
        if(nv)
        {
            fs.writeFileSync(path.join(out, "trace.json"), JSON.stringify(trace_report(), null, 2) + "\n");
            if(barrier_report)fs.writeFileSync(path.join(out,"batch-barriers.json"),JSON.stringify(barrier_report(),null,2)+"\n");
            if(process.env.NV_DUMP_PROGRAMS) fs.writeFileSync(path.join(out, "programs.json"),JSON.stringify(nv.graph.engine3d.programs(),null,2)+"\n");
            fs.writeFileSync(path.join(out, "ramin.bin"), nv.vram().subarray(nv.vram_size - (1 << 20)));
        }
        // Periodic captures may be disabled for profiling. Refresh from the
        // stopped guest's authoritative VRAM after any pending GPU readback.
        cpu.devices.display.request_frame(true);
        save_png(sink, out, "final");
        fs.writeFileSync(path.join(out, "screen.txt"), sink.text.join("\n"));
        for(const name of new Set(["MACHINE.INF", "NVDOS.TXT", "DXDIAG.TXT", "DDXP.TXT", "NVLAUNCH.TXT",
            ...(process.env.NV_TOOLS_ARTIFACTS||"").split(";").filter(Boolean)]))
        {
            assert(/^[a-zA-Z0-9_.-]+$/.test(name),"tool artifacts must be root filenames");
            const bytes = read_fat16(tools.bytes, name);
            if(bytes) fs.writeFileSync(path.join(out, name), bytes);
        }
        // A timed/draw-count checkpoint already saved its matching overlays.
        // Do not replace them with sectors from the end of the continued run.
        if(process.env.NV_OVERLAY_SAVE && !process.env.NV_STATE_SAVE) fs.writeFileSync(process.env.NV_OVERLAY_SAVE, serialize(disk.get_state()));
        if(game)
        {
            if(process.env.NV_GAME_OVERLAY_SAVE && !process.env.NV_STATE_SAVE)fs.writeFileSync(process.env.NV_GAME_OVERLAY_SAVE,serialize(game.get_state()));
            for(const name of (process.env.NV_GAME_ARTIFACTS || "").split(";").filter(Boolean))
            {
                const bytes=await read_fat32_file(game,name);
                if(bytes)fs.writeFileSync(path.join(out,path.basename(name.replaceAll("\\","/"))),bytes);
            }
        }
        await vm.destroy(); if(remote) await remote.close(); disk.close();
        if(game)
        {
            game.close();const after=fs.statSync(game_path);
            assert.equal(after.mtimeMs,game_before.mtimeMs);assert.equal(after.size,game_before.size);
        }
        process.off("SIGINT", cancel);
        assert.equal(fs.statSync(image).mtimeMs, before.mtimeMs);
        assert.equal(fs.statSync(image).size, before.size);
    }
    const text = result_text();
    // A successful install API alone is insufficient: the device must be started by nv.
    const initialized = win98 ? /DEVICE .* problem=0 cm=0 started=1 .*driver=\S+ description=NVIDIA GeForce 6800/m.test(text) :
        /DEVICE .* problem=0 cm=0 started=1 service=nv(?:\s|$)/m.test(text);
    const result = { status: disk_pause ? "PAUSED_DISK" : initialized ? "INITIALIZED" : "BLOCKED", seconds: Math.round(elapsed()),
        build: {javascript:release_build?"release":"source",wasm:wasm_path},
        guest: win98 ? "win98" : "xp", driver, rom: process.env.NV_ROM || "v86 G0 SeaVGABIOS",
        error, probe: text, trace: "trace.json", imageUnchanged: true,
        ...(disk_pause?{diskReserve:disk_pause}:{}),
        ...(game_path?{game:{path:game_path,slot:"secondary-slave",imageUnchanged:true}}:{}),
        reason: disk_pause ? disk_pause.checkpoint ? "host disk reserve reached; resume the matching checkpoint" : "host disk reserve reached; insufficient room for a new checkpoint" : initialized ? "native device started; rendering acceptance is recorded separately" : text ? "driver install/initialization did not complete" : "guest probe did not start" };
    fs.writeFileSync(path.join(out, "result.json"), JSON.stringify(result, null, 2) + "\n");
    console.log(JSON.stringify(result, null, 2));
    if(!initialized || disk_pause) process.exitCode = 1;
    return result;
}
