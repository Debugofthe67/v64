#!/usr/bin/env node

import { constants } from "node:fs";
import { createHash } from "node:crypto";
import { lstat, mkdir, open, readdir, rmdir, unlink } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { check_n97_firmware } from "../../src/symbian/n97_firmware.js";
import { extract_n97_images } from "../../src/symbian/n97_images.js";
import { parse_vpl, VPL_MAX_BYTES } from "../../src/symbian/vpl.js";

const usage = `Usage:
  node tools/symbian/vpl.mjs list <firmware directory or VPL>
  node tools/symbian/vpl.mjs check <firmware directory or VPL>
    [--product-code <code>] [--sw-version <version>] [--variant-version <version>]
  node tools/symbian/vpl.mjs extract <firmware directory or VPL> <new output directory>
    [--product-code <code>] [--sw-version <version>] [--variant-version <version>] [--raw-onenand | --bml-only-onenand]`;

async function* file_chunks(filename, max_size = Infinity)
{
    const entry = await lstat(filename);
    if(!entry.isFile()) throw new Error("expected a regular file");
    const fd = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try
    {
        const before = await fd.stat();
        if(!before.isFile() || before.dev !== entry.dev || before.ino !== entry.ino)
        {
            throw new Error("the file changed before reading");
        }
        if(before.size > max_size) throw new Error(`file exceeds ${max_size} bytes`);

        const buffer = Buffer.allocUnsafe(Math.min(before.size, 1024 * 1024));
        let offset = 0;
        while(offset < before.size)
        {
            const length = Math.min(buffer.length, before.size - offset);
            const { bytesRead } = await fd.read(buffer, 0, length, offset);
            if(!bytesRead) throw new Error("the file was truncated while reading");
            offset += bytesRead;
            yield buffer.subarray(0, bytesRead);
        }
        const after = await fd.stat();
        if(after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs)
        {
            throw new Error("the file changed while reading");
        }
    }
    finally
    {
        await fd.close();
    }
}

function manifest_name(name)
{
    return /\.vpl$/i.test(name);
}

async function list_variants(directory, manifests)
{
    const variants = [];
    const errors = [];
    for(const manifest of manifests)
    {
        try
        {
            const chunks = [];
            for await(const chunk of file_chunks(join(directory, manifest), VPL_MAX_BYTES))
            {
                chunks.push(Buffer.from(chunk));
            }
            const parsed = parse_vpl(Buffer.concat(chunks));
            for(const variant of parsed.variants)
            {
                variants.push({ ...variant, manifest, manifest_sha256: parsed.sha256 });
            }
        }
        catch(error)
        {
            errors.push({ manifest, error: error.message });
        }
    }
    return { variants, errors };
}

function print(result)
{
    console.log(JSON.stringify(result, null, 2));
}

async function read_images(directory, names, files)
{
    const inputs = {};
    for(const file of files)
    {
        if(file.status !== "ok" || !["core", "rofs", "uda", "eno"].includes(file.role)) continue;
        const role = file.role === "rofs" ? `rofs${file.rofs_index}` : file.role;
        if(inputs[role]) throw new Error(`Multiple sources for ${role}`);
        const name = names.find(name => name.toLowerCase() === file.name.toLowerCase());
        const bytes = Buffer.allocUnsafe(file.actual_size);
        let at = 0;
        for await(const chunk of file_chunks(join(directory, name), bytes.length))
        {
            at += chunk.copy(bytes, at);
        }
        if(at !== bytes.length || createHash("sha256").update(bytes).digest("hex") !== file.sha256)
        {
            throw new Error(`${file.name} changed after VPL preflight`);
        }
        inputs[role] = bytes;
    }
    return inputs;
}

async function save_extraction(directory, files, report)
{
    await mkdir(directory, { mode: 0o700 });
    const written = [];
    try
    {
        const metadata = Buffer.from(JSON.stringify(report, null, 2) + "\n");
        for(const { name, bytes, size, chunks } of [...files, { name: "firmware.json", bytes: metadata, size: metadata.length }])
        {
            const filename = join(directory, name);
            const fd = await open(filename, "wx", 0o600);
            written.push(filename);
            try
            {
                if(chunks)
                {
                    for(const { at, bytes: part } of chunks())
                    {
                        if((await fd.write(part, 0, part.length, at)).bytesWritten !== part.length) throw new Error("Short write to " + name);
                    }
                    await fd.truncate(size);
                }
                else
                {
                    await fd.writeFile(bytes);
                    if(bytes.length < size) await fd.truncate(size);
                }
            }
            finally
            {
                await fd.close();
            }
        }
    }
    catch(error)
    {
        await Promise.allSettled(written.map(path => unlink(path)));
        await rmdir(directory).catch(() => {});
        throw error;
    }
}

async function main()
{
    const { positionals, values } = parseArgs({
        allowPositionals: true,
        options: {
            help: { type: "boolean", short: "h" },
            "product-code": { type: "string" },
            "sw-version": { type: "string" },
            "variant-version": { type: "string" },
            "raw-onenand": { type: "boolean" },
            "bml-only-onenand": { type: "boolean" },
        },
    });
    if(values.help)
    {
        console.log(usage);
        return 0;
    }
    const [command, source, destination] = positionals;
    const raw = values["raw-onenand"], bml_only = values["bml-only-onenand"];
    if(positionals.length !== (command === "extract" ? 3 : 2) || !["list", "check", "extract"].includes(command) ||
        command === "list" && Object.keys(values).length || command !== "extract" && (raw || bml_only) || raw && bml_only ||
        Object.values(values).some(value => !value))
    {
        throw new Error(usage);
    }

    const path = resolve(source);
    const is_directory = (await lstat(path)).isDirectory();
    if(!is_directory && !manifest_name(path)) throw new Error("expected a firmware directory or .vpl file");
    const directory = is_directory ? path : dirname(path);
    const names = await readdir(directory);
    const manifests = is_directory ? names.filter(manifest_name).sort() : [basename(path)];
    if(!manifests.length) throw new Error("no .vpl files in the selected directory");
    const { variants, errors } = await list_variants(directory, manifests);
    const summaries = variants.map(({ files, ...variant }) => ({ ...variant, file_count: files.length }));
    if(command === "list")
    {
        print({ variants: summaries, errors });
        return variants.length ? 0 : 1;
    }

    const candidates = variants.filter(variant => variant.type_designator === "RM-505" &&
        (!values["product-code"] || values["product-code"].toUpperCase() === variant.product_code) &&
        (!values["sw-version"] || values["sw-version"] === variant.sw_version) &&
        (!values["variant-version"] || values["variant-version"] === variant.variant_version));
    if(candidates.length !== 1)
    {
        const error = candidates.length === 0 ? "No RM-505 VPL variant matches the selection." :
            "More than one RM-505 variant matches. Select a .vpl file or specify the product code and versions.";
        print({ ok: false, error, variants: summaries, errors });
        return 1;
    }

    const variant = candidates[0];
    const sources = names.map(name => ({ name, chunks: () => file_chunks(join(directory, name)) }));
    const checked = await check_n97_firmware(variant, sources);
    const { files, ...identity } = variant;
    if(command === "extract" && checked.ok)
    {
        const result = extract_n97_images(await read_images(directory, names, checked.files),
            { initialize_bml: !raw, initialize_stl: !raw && !bml_only });
        const images = result.files.map(({ name, bytes, size, source_bytes, sha256 }) => ({ name, size, source_bytes: source_bytes ?? bytes.length, sha256 }));
        const report = { ...identity, ...checked, ...result.report, images };
        await save_extraction(resolve(destination), result.files, report);
        print(report);
        return 0;
    }
    print({ ...identity, ...checked, errors });
    return checked.ok ? 0 : 1;
}

try
{
    process.exitCode = await main();
}
catch(error)
{
    console.error(error.message);
    process.exitCode = 1;
}
