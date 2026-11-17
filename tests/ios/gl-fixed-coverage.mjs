// Core entry list from Khronos OpenGL-Registry/api/GLES/gl.h (ES 1.1).
// The owner cache supplies ABI slot identities; only API names are committed.
import assert from "node:assert/strict";
import fs from "node:fs";
import { gl_wrappers, dispatch_slot } from "../../tools/ios/gl-dispatch.mjs";
import { scalar_commands } from "../../tools/ios/guest/gl-scalar.mjs";
const cache = process.argv[2];
if(!cache) throw Error("usage: gl-fixed-coverage.mjs dyld_shared_cache_armv7");
const wrappers = gl_wrappers(fs.readFileSync(cache));
const installed = new Set(["gles2", "gles1"].flatMap(api => scalar_commands(wrappers, api).map(c => dispatch_slot(wrappers.get(c[0])))));
for(const file of ["gles-driver.h", "gli-context.c", "gli-surface.h", "gli-draw.h", "gli-texture.h", "gli-query.h", "gli-uniform.h", "gli-fixed.h"])
{
    const source = fs.readFileSync(new URL("../../tools/ios/guest/" + file, import.meta.url), "utf8");
    const names = [...source.matchAll(/(?:table|functions|primary)\[N90_(gl\w+)\s*-\s*5\]/g)].map(m => m[1]);
    if(file === "gli-fixed.h") names.push(...[...source.matchAll(/F\((gl\w+)\)/g)].map(m => m[1]));
    for(const name of names) installed.add(dispatch_slot(wrappers.get(name)));
}
const core = JSON.parse(fs.readFileSync(new URL("es1-core.json", import.meta.url), "utf8"));
const missing = core.filter(name => !wrappers.has(name) || !installed.has(dispatch_slot(wrappers.get(name))));
assert.deepEqual(missing, [], "core ES1 entry points must have a native callback");
console.log("PASS: all " + core.length + " ES 1.1 core entry points have native dispatch routes (behavior requires separate tests)");
