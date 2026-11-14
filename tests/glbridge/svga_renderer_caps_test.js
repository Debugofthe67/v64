"use strict";
const assert=require("node:assert/strict");
const {createSVGARenderer}=require("../../src/browser/glbridge/svga_renderer.js");
(async()=>{
    for(const enabled of [false,true]) {
        let listener;const replies=[];
        class Executor {
            constructor(){this.device=null;this.submits=0;}
            async submit(){this.submits++;this.device={features:new Set(enabled?["texture-compression-bc"]:[])};}
            async checkpointIdle(){}
            async resetForReplay(){}
        }
        global.D3D9WebGPUExecutor=Executor;
        const renderer=createSVGARenderer({listen:fn=>{listener=fn;},post:reply=>replies.push(reply)},{canvas:{}});
        listener({type:"hello"});
        assert.deepEqual(replies.pop(),{type:"caps",present:false,textureCompressionBC:false});
        assert.equal(renderer.executor.submits,0,"hello must not acquire a GPU for a 2D-only device");
        listener({type:"submit",seq:1,bytes:new Uint8Array()});await renderer.idle();
        assert.deepEqual(replies.find(x=>x.type==="caps"),enabled?{type:"caps",present:false,textureCompressionBC:true}:undefined);
        assert.deepEqual(replies.at(-1),{type:"done",seq:1},"enabled capabilities precede the batch completion");
        replies.length=0;listener({type:"submit",seq:2,bytes:new Uint8Array()});await renderer.idle();
        assert.equal(replies.filter(x=>x.type==="caps").length,0,"unchanged feature bits do not add per-batch messages");
        listener({type:"hello"});assert.equal(replies.at(-1).textureCompressionBC,enabled,"hello always answers with actual enabled features");
        renderer.destroy();
    }
    console.log("PASS: renderer BC caps require an acquired, enabled device; hello stays lazy and unchanged batches stay quiet");
})().catch(error=>{console.error(error);process.exitCode=1;});
