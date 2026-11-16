#!/usr/bin/env node
// Clone ONLY closed disposable Chrome profiles, preserving the RAM/NAND
// checkpoint pair. cp -cR uses APFS sharing instead of copying gigabytes.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
const root = fileURLToPath(new URL("../../build/ios/", import.meta.url));
if(process.platform !== "darwin" || process.argv.length !== 4)
    throw Error("usage on macOS/APFS: clone-battle-profile.mjs source-profile work-profile");
const source = fs.realpathSync(process.argv[2]), target = path.resolve(process.argv[3]);
if(!source.startsWith(root) || !fs.realpathSync(path.dirname(target)).startsWith(root) ||
    source === target || source.startsWith(target + path.sep) || target.startsWith(source + path.sep))
    throw Error("Source and work profiles must be separate directories inside build/ios");
for(const directory of [source, target])
{
    if(!fs.existsSync(directory)) continue;
    if(!fs.statSync(path.join(directory, "Default")).isDirectory()) throw Error("Not a browser profile: " + directory);
    let closed = false;
    for(let attempt = 0; attempt < 15; attempt++)
    {
        let alive = false;
        try
        {
            const pid = Number(fs.readlinkSync(path.join(directory, "SingletonLock")).match(/-(\d+)$/)?.[1]);
            if(pid) { process.kill(pid, 0);alive = true; }
        }
        catch(error) { if(!["ENOENT", "ESRCH"].includes(error.code)) throw error; }
        const opened = spawnSync("lsof", ["-t", "+D", directory], { encoding: "utf8" });
        if(opened.error || ![0, 1].includes(opened.status)) throw Error("Cannot check profile handles: " + opened.stderr);
        if(!alive && !opened.stdout.trim()) { closed = true;break; }
        await sleep(1000);
    }
    if(!closed) throw Error("Browser still owns profile; close it before cloning: " + directory);
}
fs.rmSync(target, { recursive: true, force: true });
if(fs.existsSync(target)) throw Error("Work profile cleanup did not complete");
const copied = spawnSync("/bin/cp", ["-cR", source, target], { stdio: "inherit" });
if(copied.status !== 0) throw Error("APFS profile clone failed");
console.log("Cloned closed browser profile with APFS sharing");
