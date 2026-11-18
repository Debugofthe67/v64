// Nokia Variant Packing Lists. The N97 manifests describe roles with FileSubType
// and FlashImage/RofsIndex, including separate Ppm files for the ROFS overlays.
// See Nokia's RM505_0576555_22.0.110_001.vpl and EKA2L1's firmware.cpp.

import { crc32 } from "../android/bytes.js";
import { SHA256, sha256_hex } from "../image/sha256.js";

export const VPL_MAX_BYTES = 1024 * 1024;

function fail(message)
{
    throw new Error(`VPL: ${message}`);
}

const ENTITIES = new Map([["amp", "&"], ["lt", "<"], ["gt", ">"], ["quot", '"'], ["apos", "'"]]);

function xml_text(text)
{
    return text.replace(/&([^&;]*;)?/g, (_, reference) => {
        const name = reference?.slice(0, -1);
        if(ENTITIES.has(name)) return ENTITIES.get(name);
        if(!name || !/^#(?:[0-9]+|x[0-9a-f]+)$/i.test(name)) fail("invalid XML character reference");
        const point = name[1].toLowerCase() === "x" ? parseInt(name.slice(2), 16) : Number(name.slice(1));
        if(point === 9 || point === 10 || point === 13 || point >= 0x20 && point <= 0xD7FF ||
            point >= 0xE000 && point <= 0xFFFD || point >= 0x10000 && point <= 0x10FFFF)
        {
            return String.fromCodePoint(point);
        }
        fail("invalid XML character reference");
    });
}

// The VPL XML uses attribute-free elements and UTF-8. Parse the same subset
// in Node and browser workers. Declarations that define entities are rejected.
function xml_root(source)
{
    if(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/.test(source)) fail("invalid XML character");
    const declaration = /^<\?xml\s+version\s*=\s*(['"])1\.0\1(?:\s+encoding\s*=\s*(['"])[Uu][Tt][Ff]-8\2)?(?:\s+standalone\s*=\s*(['"])(?:yes|no)\3)?\s*\?>/;
    const tokens = /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<(\/?)([A-Za-z_][\w.-]*)[ \t\n\r]*(\/?)>|([^<]+)/gy;
    const document = { name: "", children: [], text: "" };
    const stack = [document];
    let at = declaration.exec(source)?.[0].length || 0;
    while(at < source.length)
    {
        tokens.lastIndex = at;
        const token = tokens.exec(source);
        if(!token) fail(`unexpected XML markup at character ${at}`);
        at = tokens.lastIndex;
        const [whole, cdata, close, name, empty, text] = token;
        const parent = stack[stack.length - 1];
        if(whole.startsWith("<!--"))
        {
            const comment = whole.slice(4, -3);
            if(comment.includes("--") || comment.endsWith("-")) fail("invalid XML comment");
        }
        else if(cdata !== undefined || text !== undefined)
        {
            if(parent === document && (cdata !== undefined || /[^ \t\n\r]/.test(text))) fail("text outside the root element");
            if(text?.includes("]]>")) fail("invalid XML text");
            parent.text += cdata ?? xml_text(text);
        }
        else if(close)
        {
            if(parent.name !== name || empty) fail(`unexpected closing tag </${name}>`);
            stack.pop();
        }
        else
        {
            const element = { name, children: [], text: "" };
            if(stack.length > 32) fail("XML elements are nested too deeply");
            parent.children.push(element);
            if(!empty) stack.push(element);
        }
    }
    if(stack.length !== 1 || document.children.length !== 1) fail("expected one complete XML document");
    return document.children[0];
}

function child(element, name, required = false)
{
    if(!element) return undefined;
    if(element.text.trim()) fail(`unexpected text in <${element.name}>`);
    const matches = element.children.filter(node => node.name === name);
    if(matches.length > 1) fail(`duplicate <${name}> in <${element.name}>`);
    if(required && !matches.length) fail(`missing <${name}> in <${element.name}>`);
    return matches[0];
}

function field(element, name, required = false)
{
    const node = child(element, name, required);
    if(node?.children.length) fail(`expected text in <${name}>`);
    const value = node?.text.trim();
    if(required && !value) fail(`empty <${name}>`);
    return value;
}

function number_field(element, name)
{
    const value = field(element, name);
    if(value === undefined) return null;
    const number = Number(value);
    if(!/^\d+$/.test(value) || !Number.isSafeInteger(number)) fail(`invalid <${name}> value ${JSON.stringify(value)}`);
    return number;
}

function boolean_field(element, name)
{
    const value = field(element, name);
    if(value === undefined) return null;
    if(value === "true" || value === "1") return true;
    if(value === "false" || value === "0") return false;
    fail(`invalid <${name}> value ${JSON.stringify(value)}`);
}

function file_role(type, subtype, name)
{
    if(type.toLowerCase() !== "binary") return "metadata";
    switch(subtype?.toLowerCase())
    {
        case "mcu": return "core";
        case "ppm": return "rofs";
        case "memorycardcontent": return "mass-storage";
        case "content":
            if(/\.uda\.fpsx$/i.test(name)) return "uda";
            if(/eno/i.test(name)) return "eno";
            return "content";
        default: return "metadata";
    }
}

function parse_file(node)
{
    const name = field(node, "Name", true);
    // Only sibling basenames, including on Windows where these packages originated.
    if(!/^[a-z0-9_-][a-z0-9_. -]*$/i.test(name) || name.endsWith(".") ||
        /^(?:CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9]) *(?:\.|$)/i.test(name))
    {
        fail(`unsafe filename ${JSON.stringify(name)}`);
    }
    const file_type = field(node, "FileType", true);
    const file_subtype = field(node, "FileSubType") || null;
    const flash_image = child(node, "FlashImage");
    const crc = field(node, "Crc");
    if(crc !== undefined && !/^[0-9a-f]{1,8}$/i.test(crc)) fail(`invalid CRC-32 for ${name}`);
    return {
        name,
        file_type,
        file_subtype,
        role: file_role(file_type, file_subtype, name),
        rofs_index: number_field(flash_image, "RofsIndex"),
        flash_version: field(flash_image, "Version") || null,
        optional: boolean_field(node, "Optional") ?? false,
        signed: boolean_field(node, "Signed"),
        size: number_field(node, "FileSize"),
        crc32: crc?.toLowerCase().padStart(8, "0") ?? null,
    };
}

function parse_variant(node)
{
    const identity = child(node, "VariantIdentification", true);
    const file_list = child(node, "FileList", true);
    if(file_list.text.trim() || !file_list.children.length || file_list.children.some(file => file.name !== "File"))
    {
        fail("expected at least one <File> in <FileList>");
    }
    const files = file_list.children.map(parse_file);
    const names = new Set();
    for(const { name } of files)
    {
        const key = name.toLowerCase();
        if(names.has(key)) fail(`duplicate filename ${name}`);
        names.add(key);
    }
    return {
        type_designator: field(identity, "TypeDesignator", true).toUpperCase(),
        product_code: field(identity, "ProductCode", true).toUpperCase(),
        description: field(identity, "Description") || null,
        variant_group: field(identity, "VariantGroup") || null,
        sw_version: field(node, "SwVersion", true),
        variant_version: field(node, "VariantVersion", true),
        files,
    };
}

/** @param {!Uint8Array} bytes */
export function parse_vpl(bytes)
{
    if(bytes.length > VPL_MAX_BYTES) fail("manifest exceeds 1 MiB");
    const root = xml_root(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if(root.name !== "VariantPackingList" || root.text.trim()) fail("expected <VariantPackingList> as the root");
    const variants = root.children.filter(node => node.name === "Variant").map(parse_variant);
    if(!variants.length) fail("no variants listed");
    return { sha256: sha256_hex(bytes), variants };
}

/**
 * Read only the files named by the selected variant. A source can stream
 * Node files or browser File contents, with no platform-specific code here.
 * @param {ReturnType<typeof parse_variant>} variant
 * @param {!Iterable<{name: string, chunks: function(): !AsyncIterable<!Uint8Array>}>} sources
 */
export async function check_vpl(variant, sources)
{
    const by_name = new Map();
    for(const source of sources)
    {
        const key = source.name.toLowerCase();
        if(!by_name.has(key)) by_name.set(key, []);
        by_name.get(key).push(source);
    }

    const files = [];
    for(const file of variant.files)
    {
        const matches = by_name.get(file.name.toLowerCase());
        if(!matches)
        {
            files.push({ ...file, status: file.optional ? "optional-missing" : "missing" });
            continue;
        }
        if(matches.length !== 1)
        {
            files.push({ ...file, status: "ambiguous", matches: matches.map(match => match.name).sort() });
            continue;
        }

        const sha256 = new SHA256();
        let size = 0;
        let crc = 0;
        try
        {
            for await(const chunk of matches[0].chunks())
            {
                sha256.update(chunk);
                crc = crc32(chunk, crc);
                size += chunk.length;
            }
        }
        catch(error)
        {
            files.push({ ...file, status: "unreadable", error: error.message });
            continue;
        }
        const actual_crc32 = crc.toString(16).padStart(8, "0");
        const mismatches = [];
        if(file.size !== null && size !== file.size) mismatches.push("size");
        if(file.crc32 !== null && actual_crc32 !== file.crc32) mismatches.push("crc32");
        if(file.role === "core" && file.flash_version && file.flash_version !== variant.sw_version)
        {
            mismatches.push("flash_version");
        }
        files.push({ ...file, status: mismatches.length ? "mismatch" : "ok", mismatches,
            actual_size: size, actual_crc32, sha256: sha256.hex() });
    }
    return { ok: files.every(file => file.status === "ok" || file.status === "optional-missing"), files };
}
