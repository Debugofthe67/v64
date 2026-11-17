// Build diagnostic copies beside the normal artifacts without replacing them.
import { build } from "esbuild";
await build({
    entryPoints: ["tests/ios/desktop-profile-worker.js"],
    outfile: "build/ios-desktop-profile-worker.js", bundle: true, minify: true,
    format: "iife", target: "es2022",
    define: { DEBUG: "false", V86_BUNDLE: "true", "import.meta.url": "self.location.href" },
    external: ["node:*", "fs", "crypto", "path", "perf_hooks"],
    logOverride: { "commonjs-variable-in-esm": "silent" },
});
await build({ entryPoints: ["tests/ios/desktop-profile-gles.js"],
    outfile: "build/ios-desktop-profile-gles.js", bundle: true, minify: true,
    format: "iife", target: "es2020", legalComments: "none" });
