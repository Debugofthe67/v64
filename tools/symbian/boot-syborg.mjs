#!/usr/bin/env node
// Run the same local Syborg import set through the regular V86 constructor.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { V86 } from "../../src/main.js";
import { parse_syborg_manifest, SYBORG_MANIFEST_NAME } from "../../src/symbian/syborg_import.js";

const usage = "Usage: node tools/symbian/boot-syborg.mjs ARTIFACT_DIR [--interpreter] [--system-start] [--timeout SECONDS]";
const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    interpreter: { type: "boolean" },
    "system-start": { type: "boolean" },
    timeout: { type: "string", default: "120" },
    help: { type: "boolean" },
} });

async function boot(directory, timeout)
{
    const milestone = values["system-start"] ? "System startup" : "File server bootstrap";
    const ready = values["system-start"] ? /^System start ok$/ : /^(Thread efile\.exe::|About to start system)/i;
    const manifest_bytes = await readFile(join(directory, SYBORG_MANIFEST_NAME));
    const manifest = parse_syborg_manifest(manifest_bytes);
    const image = bytes => ({ buffer: bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength ?
        bytes.buffer : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) });
    const files = manifest["files"];
    const [rom, rofs, devicetree, nvmemory] = await Promise.all(["rom", "rofs", "devicetree", "c_seed"]
        .map(async role => image(await readFile(join(directory, files[role]["name"])))));

    const vm = new V86({
        cpu_type: "arm32",
        machine_type: "symbian-syborg",
        graphics_adapter: "none",
        net_device: { type: "none" },
        autostart: false,
        disable_jit: !!values.interpreter,
        jit_switches: { a64_page_aarch32: !values.interpreter },
        wasm_path: fileURLToPath(new URL("../../build/v86-arm64.wasm", import.meta.url)),
        log_level: 0,
        symbian: { manifest: image(manifest_bytes), rom, rofs, devicetree, nvmemory },
    });

    let deadline;
    let last_line = "";
    try
    {
        await new Promise((resolve, reject) => {
            deadline = setTimeout(() => reject(new Error(
                `${milestone} timed out after ${timeout}s (${vm.get_instruction_counter()} instructions, last serial line: ${last_line || "none"})`)),
            timeout * 1000);
            let line = "";
            let rofs_ready = false;
            vm.add_listener("serial0-output-byte", byte => {
                if(byte === 13) return;
                if(byte !== 10)
                {
                    line += String.fromCharCode(byte);
                    return;
                }
                last_line = line;
                line = "";
                console.log(last_line);
                if(last_line.startsWith("FAULT:")) reject(new Error(last_line));
                if(last_line.startsWith("SYBROFS:")) rofs_ready = true;
                if(rofs_ready && ready.test(last_line)) resolve();
            });
            vm.add_listener("emulator-error", failure => reject(new Error(failure?.message || String(failure))));
            vm.add_listener("emulator-loaded", () => vm.run().catch(reject));
        });
        const compiled = vm.v86.cpu.page_tier_stats()?.compiled ?? 0;
        if(values.interpreter ? compiled !== 0 : compiled <= 0)
        {
            throw new Error(`Unexpected ARM JIT compilation count: ${compiled}`);
        }
        console.log(`${milestone} reached (${vm.get_instruction_counter()} instructions, ${compiled} JIT compilations)`);
    }
    finally
    {
        clearTimeout(deadline);
        await vm.destroy();
    }
}

if(values.help)
{
    console.log(usage);
}
else
{
    const timeout = Number(values.timeout);
    if(positionals.length !== 1 || !Number.isInteger(timeout) || timeout <= 0 || timeout > 86400)
    {
        throw new Error(usage);
    }
    await boot(positionals[0], timeout);
}
