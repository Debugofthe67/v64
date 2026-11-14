// Observe a read-only test disk's callbacks and their real physical DMA
// copies. No guest translations, IRQs, payloads or callback order are changed.
import {createHash} from "node:crypto";
const hash=bytes=>createHash("sha256").update(bytes).digest("hex");
export function watch_geforce_ide_reads(cpu,disk,first,length,record)
{
    if(!Number.isSafeInteger(first)||first<0||!Number.isSafeInteger(length)||length<=0||first+length>disk.byteLength)
        throw new RangeError("IDE watch range outside disk");
    const prototype=Object.getPrototypeOf(cpu),write=prototype.write_blob_physical,get=disk.get;
    if(typeof write!=="function" || typeof get!=="function")throw new TypeError("IDE watch needs physical DMA and a disk");
    const own=Object.hasOwn(disk,"get"),stats={reads:0,payloads:0,bytes:0,mismatches:0,loggingErrors:0};
    let active=null,closed=false;
    const emit=row=>{try{record(row);}catch{stats.loggingErrors++;}};
    const overlaps=(at,size)=>at<first+length&&first<at+size;
    function observed_get(start,size,done,...options)
    {
        return get.call(this,start,size,(data,error)=>{
            if(!data || error || !overlaps(start,size))return done(data,error);
            const context={id:++stats.reads,start,size,cursor:0},previous=active;
            emit({kind:"source",id:context.id,start,bytes:data.length,sha256:hash(data)});
            active=context;
            try{return done(data,error);}
            finally{active=previous;}
        },...options);
    }
    function observed_write(bytes,address)
    {
        if(this!==cpu || !active)return write.call(this,bytes,address);
        const context=active,start=context.start+context.cursor;context.cursor+=bytes.length;
        if(!overlaps(start,bytes.length))return write.call(this,bytes,address);
        const source=hash(bytes),result=write.call(this,bytes,address);
        // These test guests have ordinary low RAM. Never perform diagnostic
        // reads of MMIO or invoke a faulting virtual translation.
        const end=address+bytes.length,limit=cpu.low_memory_size??cpu.mem8.length;
        const ordinary=Number.isSafeInteger(address)&&address>=0&&end<=limit&&(end<=0xA0000||address>=0x100000);
        const target=ordinary?hash(cpu.mem8.subarray(address,address+bytes.length)):null;
        stats.payloads++;stats.bytes+=bytes.length;if(target!==null&&source!==target)stats.mismatches++;
        emit({kind:"dma",id:context.id,start,bytes:bytes.length,address,sourceSHA256:source,targetSHA256:target,
            match:target===null?null:source===target,eip:cpu.instruction_pointer[0]>>>0});
        return result;
    }
    disk.get=observed_get;prototype.write_blob_physical=observed_write;
    return {stats,close(){
        if(closed)return;closed=true;
        if(disk.get===observed_get){if(own)disk.get=get;else delete disk.get;}
        if(prototype.write_blob_physical===observed_write)prototype.write_blob_physical=write;
    }};
}
