// Release v86's own signed ARMv7 bridge without shipping the owner's cache.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { check_guest_library, cdhashes } from "../../src/ios/guest_load.js";

export const GRAPHICS_LIBRARY = "libv86gles.dylib";
export const GRAPHICS_SOURCES = [
    ...[
        "build-gles.sh", "eagl.c", "gli-context.c", "gli-photo.c", "gli-gates.s",
        "gles-transport.h", "gles-driver.h", "gli-surface.h", "gli-draw.h",
        "gli-texture.h", "gli-query.h", "gli-uniform.h", "gli-fixed.h", "gles-opcodes.mjs",
        "gl-frame-wrappers.mjs", "gl-scalar.mjs",
    ].map(name => "tools/ios/guest/" + name),
    "tools/ios/gl-dispatch.mjs", "src/apple/macho.js",
    "src/gles/gles_protocol.js", "src/gles/gles_wire.js",
];
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const source_hashes = root => Object.fromEntries(GRAPHICS_SOURCES.map(name =>
    [name, hash(fs.readFileSync(path.join(root, name)))]));
const release_directory = root => path.join(root, "bios/ios-guest");
const build_directory = root => path.join(root, "build/ios-guest");

function check_library(bytes)
{
    if(bytes.length > (2 << 20)) throw Error("Oversized iPhone graphics adapter");
    check_guest_library(bytes);
    cdhashes(bytes);
}

export function read_graphics_asset(root)
{
    const directory = release_directory(root);
    const manifest = JSON.parse(fs.readFileSync(path.join(directory, "manifest.json"), "utf8"));
    if(manifest.format !== "v86-ios-graphics-assets" || manifest.version !== 1 ||
        manifest.build !== "10B329" || manifest.mode !== "host-contexts")
        throw Error("Unrecognized iPhone graphics manifest");
    const sources = source_hashes(root);
    if(Object.keys(manifest.sources || {}).length !== GRAPHICS_SOURCES.length)
        throw Error("Incomplete iPhone graphics source manifest");
    for(const [name, digest] of Object.entries(sources))
        if(manifest.sources[name] !== digest)
            throw Error("iPhone graphics sources changed: " + name + "; rebuild with make ios-graphics-assets-refresh on macOS");
    const bytes = fs.readFileSync(path.join(directory, GRAPHICS_LIBRARY));
    if(hash(bytes) !== manifest.files?.[GRAPHICS_LIBRARY]) throw Error("Corrupt iPhone graphics asset");
    check_library(bytes);
    return bytes;
}

export function prepare_graphics_asset(root)
{
    // Validate everything before touching an existing local adapter.
    const bytes = read_graphics_asset(root), directory = build_directory(root);
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, GRAPHICS_LIBRARY), bytes);
    return bytes;
}

function refresh_graphics_asset(root)
{
    const bytes = fs.readFileSync(path.join(build_directory(root), GRAPHICS_LIBRARY));
    check_library(bytes);
    const manifest = { format: "v86-ios-graphics-assets", version: 1, build: "10B329", mode: "host-contexts",
        sources: source_hashes(root), files: { [GRAPHICS_LIBRARY]: hash(bytes) } };
    const directory = release_directory(root);
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, GRAPHICS_LIBRARY), bytes);
    fs.writeFileSync(path.join(directory, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
}

if(process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
{
    const root = path.resolve(import.meta.dirname, "../.."), args = process.argv.slice(2);
    if(!args.length)
    {
        prepare_graphics_asset(root);
        console.log("Verified and copied original iPhone graphics adapter");
    }
    else if(args.length === 1 && args[0] === "--refresh")
    {
        refresh_graphics_asset(root);
        console.log("Recorded original iPhone graphics adapter and source provenance");
    }
    else throw Error("usage: graphics-assets.mjs [--refresh]");
}
