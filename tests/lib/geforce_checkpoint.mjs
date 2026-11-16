// Checkpoint companions must match the RAM save, including the OS pagefile.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {createHash} from "node:crypto";
import * as zlib from "node:zlib";

// Keep NV_STATE_LOAD and its paired manifest at their logical .state path.
// Inactive investigation RAM may be archived without creating another large
// decompressed file just to restore it. The verifier hashes decoded RAM.
export function read_geforce_checkpoint_state(file)
{
    if(fs.existsSync(file)) return fs.readFileSync(file);
    assert.equal(typeof zlib.zstdDecompressSync,"function","Archived NV40 RAM requires Node zstd support or a restored raw state file");
    const manifest=file+".bundle.json";
    const expected=fs.existsSync(manifest)?JSON.parse(fs.readFileSync(manifest,"utf8")).state.bytes:null;
    const limit=expected??0x7FFFFFFF;
    assert(Number.isSafeInteger(limit)&&limit>0&&limit<=0x7FFFFFFF,"Invalid NV40 archived RAM size");
    const bytes=zlib.zstdDecompressSync(fs.readFileSync(file+".zst"),{maxOutputLength:limit});
    assert(bytes.byteLength>0,"NV40 archived RAM is empty or incomplete");
    if(expected!==null)assert.equal(bytes.byteLength,expected,"NV40 archived RAM size mismatch");
    return bytes;
}

// Disk companions are losslessly archivable too. Their logical paths and
// manifest hashes continue to name decoded v8 overlay bytes, never a different
// set of sectors. Loading does not create another large raw file on disk.
export function read_geforce_checkpoint_overlay(file,expected=null)
{
    const limit=expected??0x7FFFFFFF;
    assert(Number.isSafeInteger(limit)&&limit>0&&limit<=0x7FFFFFFF,"Invalid NV40 archived overlay size");
    const archive=file.endsWith(".zst");
    if(!archive && fs.existsSync(file))
    {
        const size=fs.statSync(file).size;
        assert(size>0 && size<=limit,"NV40 overlay size exceeds decoded bound");
        if(expected!==null)assert.equal(size,expected,"NV40 archived overlay size mismatch");
        return fs.readFileSync(file);
    }
    assert.equal(typeof zlib.zstdDecompressSync,"function","Archived NV40 overlays require Node zstd support or restored raw overlay files");
    const bytes=zlib.zstdDecompressSync(fs.readFileSync(archive?file:file+".zst"),{maxOutputLength:limit});
    assert(bytes.byteLength>0,"NV40 archived overlay is empty or incomplete");
    if(expected!==null)assert.equal(bytes.byteLength,expected,"NV40 archived overlay size mismatch");
    return bytes;
}

export async function verify_geforce_checkpoint_bundle(options)
{
    if(!options.state) return null;
    const manifest=options.state+".bundle.json";
    if(!fs.existsSync(manifest)) return null; // Legacy investigation snapshots.
    const bundle=JSON.parse(fs.readFileSync(manifest,"utf8"));
    assert.equal(bundle.status,"complete","NV40 checkpoint bundle is incomplete");
    for(const field of ["guest","vramMiB"])assert.equal(bundle[field],options[field],"NV40 checkpoint "+field+" mismatch");
    if(bundle.memoryMiB!==undefined)assert.equal(bundle.memoryMiB,options.memoryMiB,"NV40 checkpoint memoryMiB mismatch");
    for(const field of ["osImage","gameImage"])
        assert.equal(bundle[field]?path.resolve(bundle[field]):null,options[field]?path.resolve(options[field]):null,"NV40 checkpoint "+field+" mismatch");
    for(const field of ["state","osOverlay","gameOverlay"])
    {
        const expected=bundle[field],file=options[field];
        if(!expected){assert(!file,"NV40 checkpoint has no "+field);continue;}
        assert(file,"NV40 checkpoint requires matching "+field);
        const hash=createHash("sha256");
        const supplied=options[field+"Bytes"];
        if(supplied)
        {
            assert(supplied instanceof Uint8Array,"NV40 decoded "+(field==="state"?"RAM":field)+" must be bytes");
            assert.equal(supplied.byteLength,expected.bytes,"NV40 checkpoint "+field+" size mismatch");
            hash.update(supplied);
        }
        else if(field!=="state" && (file.endsWith(".zst") || !fs.existsSync(file)))
            hash.update(read_geforce_checkpoint_overlay(file,expected.bytes));
        else
        {
            assert.equal(fs.statSync(file).size,expected.bytes,"NV40 checkpoint "+field+" size mismatch");
            for await (const bytes of fs.createReadStream(file,{highWaterMark:4<<20}))hash.update(bytes);
        }
        assert.equal(hash.digest("hex"),expected.sha256,"NV40 checkpoint "+field+" SHA-256 mismatch");
    }
    return bundle;
}
