import assert from "node:assert/strict";
import {nv40_changed_bytes} from "../../src/graphics_adapters/geforce_6800/nv40_render.js";

let seed=0x12345678;
const random=()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return seed>>>0;};
function check(a,b)
{
    const indices=[];
    for(let i=0;i<b.length;i++)if(a[i]!==b[i])indices.push(i);
    assert.deepEqual(nv40_changed_bytes(a,b),indices.length?[indices[0],indices.at(-1)+1]:null);
}
// Exercise every tail length and independent aligned views. Byte indices provide
// an independent oracle for the optimized word scans' exact upload interval.
for(let length=0;length<=131;length++)for(let left=0;left<16;left+=4)for(let right=0;right<16;right+=4)
{
    const a=new Uint8Array(length+left).subarray(left),b=new Uint8Array(length+right).subarray(right);
    a.forEach((_,i)=>a[i]=b[i]=random());check(a,b);
    for(const at of new Set([0,1,3,4,7,15,31,32,63,64,length>>>1,length-1]))if(at>=0&&at<length)
    {b[at]^=1;check(a,b);b[at]^=1;}
    if(length>1){b[0]^=1;b[length-1]^=128;check(a,b);}
}
for(let trial=0;trial<4096;trial++)
{
    const length=1+random()%513,left=(random()%4)*4,right=(random()%4)*4;
    const a=new Uint8Array(length+left).subarray(left),b=new Uint8Array(length+right).subarray(right);
    a.forEach((_,i)=>a[i]=b[i]=random());
    for(let count=random()%8;count;count--)b[random()%length]^=1+random()%255;
    check(a,b);
}
const a=new Uint8Array(4<<20),b=new Uint8Array(a.length);
for(const at of [0,1,31,32,4095,4096,a.length>>>1,a.length-4,a.length-1])
{b[at]=255;assert.deepEqual(nv40_changed_bytes(a,b),[at,at+1]);b[at]=0;}
assert.equal(nv40_changed_bytes(a,b),null);assert.equal(nv40_changed_bytes(a,a),null);
assert.deepEqual(nv40_changed_bytes(null,b),[0,b.length]);
assert.deepEqual(nv40_changed_bytes(a,b.subarray(4)),[0,b.length-4]);
console.log("PASS: exact changed-byte intervals across aligned views and every tail, sparse changes and native-sized images");
