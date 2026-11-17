// iOS 6 ad-hoc signatures: SHA-1 CodeDirectory with page and special-slot
// hashes, empty requirements, and preserved XML entitlements. No CMS signing.
import { SHA1 } from "./crypto.js";
import { macho_parse } from "../apple/macho.js";
import { plist_parse, plist_encode } from "./plist.js";

const view = b => new DataView(b.buffer, b.byteOffset, b.byteLength);
const sha1 = bytes => new SHA1().update(bytes).digest();
const align = n => Math.ceil(n / 16) * 16;
const expect = (ok, message) => { if(!ok) throw new Error("Code signature: " + message); };

function commands(bytes)
{
    const parsed = macho_parse(bytes), v = view(bytes), result = [];
    expect(!parsed.is64, "only 32-bit ARM is supported");
    for(let at = 28, i = 0; i < v.getUint32(16, true); i++, at += v.getUint32(at + 4, true))
        result.push({ at, cmd: v.getUint32(at, true), size: v.getUint32(at + 4, true) });
    return { parsed, result };
}

export function macho_signature_blobs(bytes)
{
    const { result } = commands(bytes), command = result.find(c => c.cmd === 29), blobs = new Map();
    if(!command) return blobs;
    const v = view(bytes), at = v.getUint32(command.at + 8, true), size = v.getUint32(command.at + 12, true);
    expect(at + size <= bytes.length && size >= 12 && v.getUint32(at) === 0xFADE0CC0, "invalid SuperBlob");
    const length = v.getUint32(at + 4), count = v.getUint32(at + 8);
    expect(length <= size && 12 + count * 8 <= length, "invalid SuperBlob index");
    for(let i = 0; i < count; i++)
    {
        const type = v.getUint32(at + 12 + i * 8), offset = v.getUint32(at + 16 + i * 8);
        expect(offset >= 12 + count * 8 && offset + 8 <= length && !blobs.has(type), "invalid signature blob offset");
        const n = v.getUint32(at + offset + 4);
        expect(n >= 8 && offset + n <= length, "truncated signature blob");
        blobs.set(type, new Uint8Array(bytes.subarray(at + offset, at + offset + n)));
    }
    return blobs;
}

export function macho_entitlements(bytes)
{
    const blob = macho_signature_blobs(bytes).get(5);
    if(!blob) return {};
    expect(view(blob).getUint32(0) === 0xFADE7171, "unsupported entitlements blob");
    const result = plist_parse(blob.subarray(8));
    expect(result && typeof result === "object" && !Array.isArray(result), "entitlements must be a dictionary");
    return result;
}

// Inject a weak load without changing original dependency ordinals. Signing
// is deliberately separate, so the final CDHash describes all modifications.
export function macho_link_library(original, path)
{
    const { parsed } = commands(original);
    if(parsed.dylibs.includes(path)) return new Uint8Array(original);
    expect(!path.includes("\0") && path.startsWith("/"), "invalid library path");
    const name = new TextEncoder().encode(path), size = Math.ceil((25 + name.length) / 4) * 4;
    const bytes = new Uint8Array(original), v = view(bytes), end = 28 + v.getUint32(20, true);
    const first = Math.min(...parsed.segments.flatMap(s => s.sections).map(s => s.offset).filter(Boolean));
    expect(Number.isFinite(first) && end + size <= first && bytes.subarray(end, end + size).every(b => !b),
        "insufficient Mach-O header padding for the graphics adapter");
    v.setUint32(end, 0x80000018, true); v.setUint32(end + 4, size, true); v.setUint32(end + 8, 24, true);
    bytes.set(name, end + 24); v.setUint32(16, v.getUint32(16, true) + 1, true);
    v.setUint32(20, v.getUint32(20, true) + size, true);
    return bytes;
}

// File-backed sections and linker tables are occupied even when their bytes
// happen to be zero. Keep their offsets, and every original VM address, fixed.
function info_layout(bytes, parsed, result, text)
{
    const v = view(bytes), ranges = [], relocations = [];
    const range = (at, size) => {
        expect(at + size <= bytes.length, "linker data exceeds image");
        if(size) ranges.push([at, at + size]);
    };
    const relocs = (at, count) => { range(at, count * 8); if(count) relocations.push([at, count]); };
    for(const segment of parsed.segments)
    {
        if(segment !== text) range(segment.fileoff, segment.filesize);
        for(const section of segment.sections)
            if(![1, 12, 18].includes(section.flags & 255)) range(section.offset, section.size);
    }
    for(const c of result)
    {
        const get = offset => v.getUint32(c.at + offset, true);
        if(c.cmd === 1)
            for(let i = 0; i < get(48); i++) relocs(get(56 + i * 68 + 48), get(56 + i * 68 + 52));
        else if(c.cmd === 2)
        {
            range(get(8), get(12) * 12); range(get(16), get(20));
        }
        else if(c.cmd === 11)
        {
            expect(c.size >= 80, "truncated dynamic symbol command");
            for(const [offset, width] of [[32, 8], [40, 52], [48, 4], [56, 4]]) range(get(offset), get(offset + 4) * width);
            relocs(get(64), get(68)); relocs(get(72), get(76));
        }
        else if(c.cmd === 0x22 || c.cmd === 0x80000022)
        {
            expect(c.size >= 48, "truncated dyld info command");
            for(let offset = 8; offset < 48; offset += 8) range(get(offset), get(offset + 4));
        }
        else if(c.cmd === 0x16)
        {
            expect(c.size >= 16, "truncated two-level hints command");
            range(get(8), get(12) * 4);
        }
        else if([0x1d, 0x1e, 0x26, 0x29, 0x2b, 0x2e, 0x80000033, 0x80000034].includes(c.cmd))
        {
            expect(c.size >= 16, "truncated linkedit data command");
            range(get(8), get(12));
        }
    }
    return { ranges, relocations };
}

function insert_section_ordinals(bytes, parsed, text, relocations)
{
    const v = view(bytes), ordinal = parsed.segments.slice(0, parsed.segments.indexOf(text) + 1)
        .reduce((n, segment) => n + segment.sections.length, 0);
    if(parsed.symtab)
        for(let i = 0, at = parsed.symtab.symoff; i < parsed.symtab.nsyms; i++, at += 12)
            if(bytes[at + 5] > ordinal)
            {
                expect(bytes[at + 5] < 255, "section ordinal exceeds nlist capacity");
                bytes[at + 5]++;
            }
    const visited = new Set();
    for(const [start, count] of relocations)
        for(let i = 0, at = start; i < count; i++, at += 8)
        {
            if(visited.has(at)) continue;
            visited.add(at);
            const address = v.getUint32(at, true), flags = v.getUint32(at + 4, true), section = flags & 0xFFFFFF;
            // Scattered relocations use VM addresses. External relocations use
            // symbol indices; ARM_RELOC_PAIR's payload is not a section ordinal.
            if(!(address & 0x80000000) && !(flags & 0x8000000) && flags >>> 28 !== 1 && section > ordinal)
            {
                expect(section < 0xFFFFFF, "relocation section ordinal overflow");
                v.setUint32(at + 4, (flags & 0xFF000000) | section + 1, true);
            }
        }
}

// installd passes a binary path to iOS 6 libmis. Its Mach-O disk reader
// obtains the signed Info component from __TEXT,__info_plist, rather than
// from the containing directory. Bind the exact bundle plist in both places.
export function macho_embed_info(original, info)
{
    const { parsed, result } = commands(original), text=parsed.segments.find(s=>s.name==="__TEXT");
    expect(text && text.fileoff===0,"missing file-backed __TEXT segment");
    const command=result.find(c=>c.cmd===1&&view(original).getUint32(c.at+24,true)===text.vmaddr);
    expect(command,"missing __TEXT command");
    const bytes=new Uint8Array(original),v=view(bytes),count=v.getUint32(command.at+48,true);
    expect(text.filesize<=text.vmsize && text.filesize<=bytes.length,"invalid file-backed __TEXT bounds");
    let section=-1;
    for(let i=0;i<count;i++){
        const at=command.at+56+i*68;
        if(new TextDecoder().decode(bytes.subarray(at,at+16)).replace(/\0.*$/,"")==="__info_plist")section=at;
    }
    if(section>=0){
        const at=v.getUint32(section+40,true),size=v.getUint32(section+36,true);
        expect(at+size<=text.filesize,"embedded Info.plist exceeds __TEXT");
        expect(info.length<=size,"insufficient space in embedded Info.plist");
        bytes.fill(0,at,at+size);bytes.set(info,at);v.setUint32(section+36,info.length,true);return bytes;
    }
    const end=28+v.getUint32(20,true),first=Math.min(...parsed.segments.flatMap(s=>s.sections).map(s=>s.offset).filter(Boolean));
    // Leave room for LC_CODE_SIGNATURE when signing an originally unsigned image.
    const { ranges, relocations }=info_layout(original,parsed,result,text);
    const free=(at,size)=>at+size<=text.filesize && !ranges.some(([a,b])=>at<b && at+size>a) &&
        bytes.subarray(at,at+size).every(b=>!b);
    expect(end+68+16<=first && free(end,68+16),"insufficient Mach-O header padding for the Info.plist section command");
    let at=align(end+68+16);
    if(at+info.length>first || !free(at,info.length))
        at=align(Math.max(end+68+16,...ranges.filter(([a,b])=>a<text.filesize && b>0).map(([,b])=>b)));
    expect(free(at,info.length),
        "insufficient Mach-O header padding for the signed Info.plist");
    section=command.at+command.size;
    bytes.copyWithin(section+68,section,end);bytes.fill(0,section,section+68);
    bytes.set(new TextEncoder().encode("__info_plist"),section);bytes.set(new TextEncoder().encode("__TEXT"),section+16);
    v.setUint32(section+32,text.vmaddr+at,true);v.setUint32(section+36,info.length,true);v.setUint32(section+40,at,true);v.setUint32(section+44,4,true);
    v.setUint32(command.at+4,command.size+68,true);v.setUint32(command.at+48,count+1,true);v.setUint32(20,end-28+68,true);
    insert_section_ordinals(bytes,parsed,text,relocations);
    bytes.set(info,at);return bytes;
}

export function sign_macho(original, { identifier, info = null, resources = null, entitlements = null })
{
    expect(typeof identifier === "string" && identifier.length && !identifier.includes("\0"), "invalid signing identifier");
    const { parsed, result } = commands(original), old = result.find(c => c.cmd === 29), link = result.find(c => c.cmd === 1 &&
        parsed.segments.find(s => s.name === "__LINKEDIT")?.fileoff === view(original).getUint32(c.at + 32, true));
    expect(link, "missing __LINKEDIT segment");
    const bytes = new Uint8Array(original), v = view(bytes);
    let command = old?.at;
    if(command === undefined)
    {
        command = 28 + v.getUint32(20, true);
        const first = Math.min(...parsed.segments.flatMap(s => s.sections).map(s => s.offset).filter(Boolean));
        expect(command + 16 <= first && bytes.subarray(command, command + 16).every(b => !b), "no room for signature command");
        v.setUint32(16, v.getUint32(16, true) + 1, true); v.setUint32(20, v.getUint32(20, true) + 16, true);
        v.setUint32(command, 29, true); v.setUint32(command + 4, 16, true);
    }
    const oldOffset = old ? v.getUint32(command + 8, true) : bytes.length;
    const oldSize = old ? v.getUint32(command + 12, true) : 0;
    expect(oldOffset <= bytes.length && oldOffset + oldSize <= bytes.length &&
        bytes.subarray(oldOffset + oldSize).every(b => !b), "signature is not at the end of the image");
    const limit = align(oldOffset), slots = Math.ceil(limit / 4096), identity = new TextEncoder().encode(identifier + "\0");
    const entitlementBytes = entitlements === null ? null : plist_encode(entitlements);
    const entitlementBlob = entitlementBytes ? new Uint8Array(8 + entitlementBytes.length) : null;
    if(entitlementBlob) { view(entitlementBlob).setUint32(0, 0xFADE7171); view(entitlementBlob).setUint32(4, entitlementBlob.length); entitlementBlob.set(entitlementBytes, 8); }
    const requirements = new Uint8Array(12); view(requirements).setUint32(0, 0xFADE0C01); view(requirements).setUint32(4, 12);
    const special = entitlementBlob ? 5 : resources ? 3 : 2;
    const hashOffset = Math.ceil((48 + identity.length) / 4) * 4 + special * 20;
    const directory = new Uint8Array(hashOffset + slots * 20), d = view(directory);
    d.setUint32(0, 0xFADE0C02); d.setUint32(4, directory.length); d.setUint32(8, 0x20100); d.setUint32(12, 2);
    d.setUint32(16, hashOffset); d.setUint32(20, 48); d.setUint32(24, special); d.setUint32(28, slots); d.setUint32(32, limit);
    directory.set([20, 1, 0, 12], 36); directory.set(identity, 48);
    for(const [slot, data] of [[1, info], [2, requirements], [3, resources], [5, entitlementBlob]])
        if(data) directory.set(sha1(data), hashOffset - slot * 20);
    // Match the platform signer's ad-hoc container: include an empty CMS
    // wrapper and align each embedded blob to a word boundary.
    const cms = new Uint8Array(8); view(cms).setUint32(0, 0xFADE0B01); view(cms).setUint32(4, 8);
    const blobs = [[0, directory], [2, requirements], ...(entitlementBlob ? [[5, entitlementBlob]] : []), [0x10000, cms]];
    const signatureSize = 12 + blobs.length * 8 + blobs.reduce((sum, [, b]) => sum + Math.ceil(b.length / 4) * 4, 0);
    const size = limit + signatureSize, output = new Uint8Array(size), out = view(output);
    output.set(bytes.subarray(0, oldOffset));
    out.setUint32(command + 8, limit, true); out.setUint32(command + 12, signatureSize, true);
    const linkoff = v.getUint32(link.at + 32, true);
    out.setUint32(link.at + 36, size - linkoff, true); out.setUint32(link.at + 28, Math.ceil((size - linkoff) / 4096) * 4096, true);
    for(let i = 0; i < slots; i++) directory.set(sha1(output.subarray(i * 4096, Math.min(limit, (i + 1) * 4096))), hashOffset + i * 20);
    out.setUint32(limit, 0xFADE0CC0); out.setUint32(limit + 4, signatureSize); out.setUint32(limit + 8, blobs.length);
    let at = 12 + blobs.length * 8;
    for(const [i, [type, blob]] of blobs.entries())
    {
        out.setUint32(limit + 12 + i * 8, type); out.setUint32(limit + 16 + i * 8, at);
        output.set(blob, limit + at); at += Math.ceil(blob.length / 4) * 4;
    }
    return output;
}
