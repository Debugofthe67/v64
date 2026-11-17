import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { prepare_ipa } from "../../src/ios/ipa_prepare.js";
import { inspect_ipa } from "../../src/ios/ipa.js";
import { sign_macho, macho_entitlements, macho_link_library, macho_embed_info } from "../../src/ios/codesign.js";
import { cdhashes, SYSTEM_GL_LIBRARY } from "../../src/ios/guest_load.js";
import { plist_encode, plist_parse } from "../../src/ios/plist.js";
import { zip_read } from "../../src/android/zip.js";
import { macho_parse } from "../../src/apple/macho.js";
import { make_zip } from "../android/fixtures.mjs";

function image(subtype = 9)
{
    const b = new Uint8Array(0x900), v = new DataView(b.buffer), put = (a, n) => v.setUint32(a, n, true);
    put(0, 0xFEEDFACE); put(4, 12); put(8, subtype); put(12, 2); put(16, 2); put(20, 180);
    put(28, 1); put(32, 124); b.set(new TextEncoder().encode("__TEXT"), 36);
    put(52, 0x1000); put(56, 0x1000); put(64, 0x800); put(76, 1);
    b.set(new TextEncoder().encode("__text"), 84); put(116, 0x1400); put(120, 0x100); put(124, 0x400);
    put(152, 1); put(156, 56); b.set(new TextEncoder().encode("__LINKEDIT"), 160);
    put(176, 0x2000); put(180, 0x1000); put(184, 0x800); put(188, 0x100);
    b.fill(0x42, 0x400, 0x500); return b;
}
test("ad-hoc signatures preserve entitlements, seal pages, and detect code mutation", () => {
    const entitlements = { "application-identifier": "org.v86.Test", "get-task-allow": true };
    const signed = sign_macho(image(), { identifier: "org.v86.Test", entitlements });
    const buffer = Buffer.from(signed), original = Buffer.from(buffer);
    sign_macho(buffer, { identifier: "org.v86.Replacement", entitlements });
    assert.deepEqual(buffer, original, "Node Buffer inputs must not be modified through Buffer.slice()");
    assert.deepEqual(macho_entitlements(signed), entitlements);
    assert.equal(cdhashes(signed).length, 1);
    const linked = macho_link_library(signed, SYSTEM_GL_LIBRARY);
    const final = sign_macho(linked, { identifier: "org.v86.Test", entitlements });
    assert.notDeepEqual(cdhashes(final), cdhashes(signed));
    const broken = final.slice(); broken[0x401] ^= 1;
    assert.throws(() => cdhashes(broken), /Invalid signed page/);
});
test("preparation produces an inspectable IPA, final hashes, graphics dependency and resource seal", async () => {
    const info = plist_encode({ CFBundleIdentifier: "org.v86.Test", CFBundleExecutable: "Test", CFBundleVersion: "1", MinimumOSVersion: "6.0" });
    const b = make_zip([{ name: "Payload/Test.app/Info.plist", data: info },
        { name: "Payload/Test.app/Test", data: image() },
        { name: "Payload/Test.app/texture.bin", data: Uint8Array.of(1, 2, 3) },
        { name: "Container/Documents/previous-save.dat", data: Uint8Array.of(4, 5, 6) },
        { name: "Payload/Test.app/embedded.mobileprovision", data: Uint8Array.of(9) }]);
    const original = b.slice(), parts = [];
    const manifest = await prepare_ipa((a, n) => b.subarray(a, a + n), b.length, data => parts.push(data.slice()));
    const out = Buffer.concat(parts), read = (a, n) => out.subarray(a, a + n), app = await inspect_ipa(read, out.length);
    assert.deepEqual(b, original); assert.equal(manifest.prepared_size, out.length);
    assert.equal(manifest.prepared_sha256, createHash("sha256").update(out).digest("hex"));
    assert.ok(app.main.parsed.dylibs.includes(SYSTEM_GL_LIBRARY));
    const embedded=app.main.parsed.segments.flatMap(s=>s.sections).find(s=>s.name==="__info_plist");
    assert.ok(embedded,"the binary-path native validator must see the signed Info component");
    assert.deepEqual(app.main.bytes.subarray(embedded.offset,embedded.offset+embedded.size),info);
    assert.equal(manifest.trusted[0].cdhashes[0], Buffer.from(cdhashes(app.main.bytes)[0]).toString("hex"));
    assert.ok(!app.entries.some(e => e.name.endsWith("embedded.mobileprovision")));
    assert.ok(!Buffer.from(out).includes(Buffer.from("Container/")), "previous sandbox data is not sent to the native installer");
    const seal = plist_parse(await zip_read(read, app.entries.find(e => e.name.endsWith("_CodeSignature/CodeResources"))));
    assert.deepEqual(Buffer.from(seal.files["texture.bin"]), createHash("sha1").update(Uint8Array.of(1, 2, 3)).digest());
    assert.equal(app.entries.find(e => e.name.endsWith("/Test")).unix_mode, 0o100755);
});
test("preparation reports unsupported header layout instead of modifying it", () => {
    const b = image(), v = new DataView(b.buffer); v.setUint32(124, 212, true);
    assert.throws(() => macho_link_library(b, SYSTEM_GL_LIBRARY), /header padding/);
    const original=image(),copy=original.slice();
    assert.throws(()=>macho_embed_info(original,new Uint8Array(5000)),/padding.*Info.plist/);
    assert.deepEqual(original,copy);
});
function crowded_image()
{
    const b=image(6),v=new DataView(b.buffer);
    v.setUint32(16,3,true);v.setUint32(20,740,true);
    v.setUint32(208,0x1b,true);v.setUint32(212,560,true);
    return b;
}
test("signed Info.plist can occupy unused __TEXT tail without moving code or segments", () => {
    const source=Buffer.from(macho_link_library(crowded_image(),SYSTEM_GL_LIBRARY)),original=Buffer.from(source);
    const info=new Uint8Array(600).fill(0x7a),embedded=macho_embed_info(source,info),parsed=macho_parse(embedded);
    const section=parsed.segments[0].sections.find(s=>s.name==="__info_plist");
    assert.equal(section.offset,0x500);assert.equal(section.addr,0x1500);
    assert.deepEqual(embedded.subarray(section.offset,section.offset+section.size),info);
    assert.deepEqual(embedded.subarray(0x400,0x500),new Uint8Array(source.subarray(0x400,0x500)));
    assert.deepEqual(parsed.segments.map(s=>[s.vmaddr,s.vmsize,s.fileoff,s.filesize]),
        macho_parse(source).segments.map(s=>[s.vmaddr,s.vmsize,s.fileoff,s.filesize]));
    assert.deepEqual(source,original);
    const signed=sign_macho(embedded,{identifier:"org.v86.Crowded",info});
    assert.equal(cdhashes(signed).length,1);
    const broken=signed.slice();broken[section.offset]^=1;
    assert.throws(()=>cdhashes(broken),/Invalid signed page/);
});
test("Info.plist tail fallback refuses occupied, nonzero and truncated ranges atomically", () => {
    for(const kind of ["nonzero","section","symbols","truncated"])
    {
        const b=crowded_image(),v=new DataView(b.buffer);
        if(kind==="nonzero")b.fill(1,0x500,0x800);
        if(kind==="section")v.setUint32(120,0x400,true);
        if(kind==="symbols")
        {
            v.setUint32(208,2,true);v.setUint32(216,0x500,true);v.setUint32(220,32,true);
            v.setUint32(224,0x680,true);v.setUint32(228,0x180,true);
        }
        if(kind==="truncated")v.setUint32(64,0x2000,true);
        const copy=b.slice();
        assert.throws(()=>macho_embed_info(b,new Uint8Array(600)),/Code signature:/,kind);
        assert.deepEqual(b,copy,kind);
    }
});
test("adding a TEXT section updates nlist and local relocation ordinals exactly once", () => {
    const b=new Uint8Array(0xb00),v=new DataView(b.buffer),put=(a,n)=>v.setUint32(a,n,true),name=(a,s)=>b.set(new TextEncoder().encode(s),a);
    put(0,0xfeedface);put(4,12);put(8,6);put(12,2);put(16,5);put(20,408);
    for(const [at,segment,vm,fileoff,filesize,nsects] of [[28,"__TEXT",0x1000,0,0x600,1],
        [152,"__DATA",0x2000,0x600,0x200,1],[276,"__LINKEDIT",0x3000,0x800,0x300,0]])
    {
        put(at,1);put(at+4,56+68*nsects);name(at+8,segment);put(at+24,vm);put(at+28,0x1000);
        put(at+32,fileoff);put(at+36,filesize);put(at+48,nsects);
        if(nsects){name(at+56,segment==="__TEXT"?"__text":"__data");name(at+72,segment);
            put(at+88,vm+(fileoff?0:0x400));put(at+92,0x100);put(at+96,fileoff||0x400);}
    }
    put(332,2);put(336,24);put(340,0x800);put(344,2);put(348,0x820);put(352,16);
    b[0x804]=b[0x810]=0xe;b[0x805]=1;b[0x811]=2;
    // This table is referenced both by a section and LC_DYSYMTAB.
    put(256,0x840);put(260,5);put(356,11);put(360,80);put(428,0x840);put(432,5);
    const flags=[2,0x08000002,0x10000002,2,0];
    for(let i=0;i<5;i++){put(0x840+i*8,i===3?0x80000000:i*4);put(0x844+i*8,flags[i]);}
    const before=b.slice(),out=macho_embed_info(b,new Uint8Array([1,2,3])),o=new DataView(out.buffer);
    assert.deepEqual(b,before);assert.equal(out[0x805],1);assert.equal(out[0x811],3);
    assert.deepEqual(flags.map((_,i)=>o.getUint32(0x844+i*8,true)),[3,...flags.slice(1)]);
    for(const at of [0x800,0x80c])assert.equal(o.getUint32(at+8,true),v.getUint32(at+8,true),"symbol VM value stays fixed");
});
test("a crowded ARMv6 IPA prepares with exact plist bytes and verifiable final identity", async () => {
    const info=plist_encode({CFBundleIdentifier:"org.v86.Crowded",CFBundleExecutable:"Legacy",CFBundleVersion:"1",
        MinimumOSVersion:"2.1",description:"x".repeat(250)});
    assert.ok(info.length>256&&info.length<=768);
    const b=make_zip([{name:"Payload/Legacy.app/Info.plist",data:info},{name:"Payload/Legacy.app/Legacy",data:crowded_image()}]);
    const parts=[],manifest=await prepare_ipa((a,n)=>b.subarray(a,a+n),b.length,data=>parts.push(data.slice()));
    const out=Buffer.concat(parts),app=await inspect_ipa((a,n)=>out.subarray(a,a+n),out.length);
    const section=app.main.parsed.segments[0].sections.find(s=>s.name==="__info_plist");
    assert.equal(section.offset,0x500);assert.equal(manifest.architecture,"armv6");
    assert.deepEqual(app.main.bytes.subarray(section.offset,section.offset+section.size),info);
    assert.equal(manifest.trusted[0].cdhashes[0],Buffer.from(cdhashes(app.main.bytes)[0]).toString("hex"));
});
test("ARMv6 preparation preserves the subtype while linking, sealing and signing code", async () => {
    const info = plist_encode({ CFBundleIdentifier: "org.v86.Legacy", CFBundleExecutable: "Legacy", CFBundleVersion: "1", MinimumOSVersion: "2.2.1" });
    const b = make_zip([{ name: "Payload/Legacy.app/Info.plist", data: info }, { name: "Payload/Legacy.app/Legacy", data: image(6) }]);
    const parts = [], manifest = await prepare_ipa((a, n) => b.subarray(a, a + n), b.length, data => parts.push(data.slice()));
    const out = Buffer.concat(parts), app = await inspect_ipa((a, n) => out.subarray(a, a + n), out.length);
    assert.equal(manifest.architecture, "armv6"); assert.equal(app.main.parsed.cpusubtype, 6);
    assert.ok(app.main.parsed.dylibs.includes(SYSTEM_GL_LIBRARY));
    assert.equal(manifest.trusted[0].cdhashes[0], Buffer.from(cdhashes(app.main.bytes)[0]).toString("hex"));
});
