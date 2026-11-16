import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath as file_url_to_path } from "node:url";
import { execFileSync as exec_file_sync } from "node:child_process";
const root = fs.mkdtempSync(path.join(os.tmpdir(), "v86-guest-texture-"));
try
{
    const binary = path.join(root, "test");
    exec_file_sync(process.env.HOST_CC || process.env.CC_HOST || "cc", ["-std=c11", "-Wall", "-Wextra", "-Werror", "-Wno-unused-parameter",
        file_url_to_path(new URL("guest-texture.c", import.meta.url)), "-o", binary], { stdio: "inherit" });
    exec_file_sync(binary, [], { stdio: "inherit" });
}
finally { fs.rmSync(root, { recursive: true, force: true }); }
