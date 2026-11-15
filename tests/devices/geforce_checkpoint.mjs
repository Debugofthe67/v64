#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createHash} from "node:crypto";
import * as zlib from "node:zlib";
import {verify_geforce_checkpoint_bundle,read_geforce_checkpoint_state,read_geforce_checkpoint_overlay} from "../lib/geforce_checkpoint.mjs";
const directory=fs.mkdtempSync(path.join(os.tmpdir(),"nv40-checkpoint-"));
try
{
    const options={guest:"xp",vramMiB:128,osImage:"/original-os.img",gameImage:"/original-game.img"},bundle={status:"complete",...options};
    for(const [field,text] of [["state","RAM at checkpoint"],["osOverlay","pagefile sectors"],["gameOverlay","project sectors"]])
    {
        const file=path.join(directory,field),bytes=Buffer.from(text);fs.writeFileSync(file,bytes);options[field]=file;
        bundle[field]={file,bytes:bytes.length,sha256:createHash("sha256").update(bytes).digest("hex")};
    }
    const manifest=options.state+".bundle.json",save=()=>fs.writeFileSync(manifest,JSON.stringify(bundle));save();
    assert.deepEqual(await verify_geforce_checkpoint_bundle(options),bundle);
    const originalRAM=fs.readFileSync(options.state),archive=options.state+".zst";
    // A complete zstd frame with the original seventeen RAM fixture bytes.
    const encoded=Buffer.from("28b52ffd201189000052414d20617420636865636b706f696e74","hex");
    fs.writeFileSync(archive,encoded);
    assert.deepEqual(read_geforce_checkpoint_state(options.state),originalRAM,"raw RAM takes precedence");
    fs.unlinkSync(options.state);
    if(typeof zlib.zstdDecompressSync==="function")
    {
        const decoded=read_geforce_checkpoint_state(options.state);
        assert.deepEqual(decoded,originalRAM);
        assert(!fs.existsSync(options.state),"archived restore creates no decompressed state file");
        await verify_geforce_checkpoint_bundle({...options,stateBytes:decoded});
        await assert.rejects(verify_geforce_checkpoint_bundle({...options,stateBytes:decoded.subarray(1)}),/state size mismatch/);
        await assert.rejects(verify_geforce_checkpoint_bundle({...options,stateBytes:"not bytes"}),/must be bytes/);
        const altered=Buffer.from(encoded);altered[altered.length-1]^=1;fs.writeFileSync(archive,altered);
        await assert.rejects(verify_geforce_checkpoint_bundle({...options,stateBytes:read_geforce_checkpoint_state(options.state)}),/state SHA-256/);
        fs.writeFileSync(archive,encoded.subarray(0,4));assert.throws(()=>read_geforce_checkpoint_state(options.state));
        fs.writeFileSync(archive,encoded);bundle.state.bytes=8;save();
        assert.throws(()=>read_geforce_checkpoint_state(options.state),undefined,"declared RAM bytes bound decompression");
        bundle.state.bytes=originalRAM.length;save();
    }
    else assert.throws(()=>read_geforce_checkpoint_state(options.state),/Node zstd support/);
    fs.writeFileSync(options.state,"RAM xx checkpoint");
    await assert.rejects(verify_geforce_checkpoint_bundle({...options,stateBytes:read_geforce_checkpoint_state(options.state)}),/state SHA-256/);
    fs.writeFileSync(options.state,originalRAM);fs.unlinkSync(archive);
    const originalOS=fs.readFileSync(options.osOverlay),osArchive=options.osOverlay+".zst";
    // A zstd single-segment frame containing one final raw block. No encoder
    // dependency is needed to check the exact original serialized sectors.
    const frame=bytes=>Buffer.concat([Buffer.from([0x28,0xB5,0x2F,0xFD,0x20,bytes.length,bytes.length<<3|1,0,0]),bytes]);
    fs.writeFileSync(osArchive,frame(originalOS));fs.unlinkSync(options.osOverlay);
    if(typeof zlib.zstdDecompressSync==="function")
    {
        const decoded=read_geforce_checkpoint_overlay(options.osOverlay,originalOS.length);
        assert.deepEqual(decoded,originalOS);
        assert.deepEqual(read_geforce_checkpoint_overlay(osArchive),originalOS,"explicit overlay archive path");
        assert(!fs.existsSync(options.osOverlay),"overlay restore creates no decompressed disk file");
        await verify_geforce_checkpoint_bundle(options);
        await verify_geforce_checkpoint_bundle({...options,osOverlay:osArchive});
        await verify_geforce_checkpoint_bundle({...options,osOverlayBytes:decoded});
        const originalGame=fs.readFileSync(options.gameOverlay),gameArchive=options.gameOverlay+".zst";
        fs.writeFileSync(gameArchive,frame(originalGame));fs.unlinkSync(options.gameOverlay);
        await verify_geforce_checkpoint_bundle(options); // Both disk companions archived.
        assert(!fs.existsSync(options.gameOverlay));
        fs.writeFileSync(gameArchive,frame(Buffer.from("project SECTORS")));
        await assert.rejects(verify_geforce_checkpoint_bundle(options),/gameOverlay SHA-256/);
        fs.writeFileSync(options.gameOverlay,originalGame);fs.unlinkSync(gameArchive);
        await assert.rejects(verify_geforce_checkpoint_bundle({...options,osOverlayBytes:decoded.subarray(1)}),/osOverlay size mismatch/);
        await assert.rejects(verify_geforce_checkpoint_bundle({...options,osOverlayBytes:"not bytes"}),/must be bytes/);
        fs.writeFileSync(osArchive,frame(Buffer.from("pagefile SECTORS")));
        await assert.rejects(verify_geforce_checkpoint_bundle(options),/osOverlay SHA-256/);
        fs.writeFileSync(osArchive,frame(originalOS).subarray(0,4));
        assert.throws(()=>read_geforce_checkpoint_overlay(options.osOverlay));
        fs.writeFileSync(osArchive,frame(originalOS));
        assert.throws(()=>read_geforce_checkpoint_overlay(options.osOverlay,8),undefined,"declared overlay bytes bound decompression");
    }
    else assert.throws(()=>read_geforce_checkpoint_overlay(options.osOverlay),/Node zstd support/);
    for(const bound of [0,-1,1.5,0x80000000])assert.throws(()=>read_geforce_checkpoint_overlay(osArchive,bound),/Invalid NV40 archived overlay size/);
    fs.writeFileSync(options.osOverlay,originalOS);fs.writeFileSync(osArchive,Buffer.from([0]));
    assert.deepEqual(read_geforce_checkpoint_overlay(options.osOverlay),originalOS,"raw overlay takes precedence");
    fs.unlinkSync(osArchive);
    const moved=path.join(directory,"moved-os");fs.copyFileSync(options.osOverlay,moved);
    await verify_geforce_checkpoint_bundle({...options,osOverlay:moved});
    fs.writeFileSync(moved,"later disk bytes");
    await assert.rejects(verify_geforce_checkpoint_bundle({...options,osOverlay:moved}),/osOverlay SHA-256/);
    await assert.rejects(verify_geforce_checkpoint_bundle({...options,osOverlay:null}),/requires matching osOverlay/);
    await assert.rejects(verify_geforce_checkpoint_bundle({...options,gameOverlay:null}),/requires matching gameOverlay/);
    await assert.rejects(verify_geforce_checkpoint_bundle({...options,guest:"win98"}),/guest mismatch/);
    await assert.rejects(verify_geforce_checkpoint_bundle({...options,vramMiB:256}),/vramMiB mismatch/);
    await assert.rejects(verify_geforce_checkpoint_bundle({...options,gameImage:"/other-game.img"}),/gameImage mismatch/);
    bundle.memoryMiB=1024;save();
    await verify_geforce_checkpoint_bundle({...options,memoryMiB:1024});
    await assert.rejects(verify_geforce_checkpoint_bundle({...options,memoryMiB:2048}),/memoryMiB mismatch/);
    await assert.rejects(verify_geforce_checkpoint_bundle(options),/memoryMiB mismatch/);
    delete bundle.memoryMiB;save();
    await verify_geforce_checkpoint_bundle(options); // Legacy bundles remain supported.
    fs.writeFileSync(options.state,"different RAM!!!");
    await assert.rejects(verify_geforce_checkpoint_bundle(options),/state size mismatch/);
    bundle.status="writing";save();await assert.rejects(verify_geforce_checkpoint_bundle(options),/incomplete/);
    fs.unlinkSync(manifest);assert.equal(await verify_geforce_checkpoint_bundle(options),null);
    console.log("PASS: NV40 matching raw/zstd RAM and disk bundles; decoded bounds, wrong sectors, missing companions and guest/VRAM/image mismatches rejected");
}
finally {fs.rmSync(directory,{recursive:true,force:true});}
