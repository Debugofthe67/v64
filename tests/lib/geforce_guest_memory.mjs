// Diagnostic reads must not invoke the CPU's faulting translation API: a
// missing stack page would inject #PF into the driver being investigated.
// Walk the current x86 page tables in ordinary RAM without A/D or TLB writes.
export function read_geforce_guest_stack(cpu, count)
{
    const memory=cpu.mem8,cr=cpu.cr,stack32=!cpu.stack_size_32 || !!cpu.stack_size_32[0];
    const offset=stack32?cpu.reg32[4]>>>0:cpu.reg32[4]&65535;
    const base=cpu.segment_offsets?cpu.segment_offsets[2]>>>0:0;
    const width=stack32?0x100000000:0x10000;
    const word=at=>{
        if(!Number.isSafeInteger(at)||at<0||at+4>memory.length) return null;
        return (memory[at]|memory[at+1]<<8|memory[at+2]<<16|memory[at+3]<<24)>>>0;
    };
    const entry=at=>{
        const low=word(at),high=word(at+4);
        if(low===null||high===null||!(low&1)) return null;
        return {low,base:((low&0xFFFFF000)>>>0)+(high&0xFFFFF)*0x100000000};
    };
    const translate=address=>{
        if(!(cr[0]&0x80000000)) return address;
        if(cr[4]&32)
        {
            const pdpt=entry(((cr[3]&~31)>>>0)+(address>>>30)*8);
            if(!pdpt) return null;
            const pde=entry(pdpt.base+(address>>>21&511)*8);
            if(!pde) return null;
            if(pde.low&128) return pde.base-pde.base%0x200000+(address&0x1FFFFF);
            const pte=entry(pde.base+(address>>>12&511)*8);
            return pte?pte.base+(address&4095):null;
        }
        const pde=word(((cr[3]&0xFFFFF000)>>>0)+(address>>>22)*4);
        if(pde===null||!(pde&1)) return null;
        if(pde&128)
        {
            if(!(cr[4]&16)||pde&0x1FE000) return null; // PSE-36 above ordinary RAM
            return ((pde&0xFFC00000)>>>0)+(address&0x3FFFFF);
        }
        const pte=word(((pde&0xFFFFF000)>>>0)+(address>>>12&1023)*4);
        return pte!==null&&pte&1?((pte&0xFFFFF000)>>>0)+(address&4095):null;
    };
    const pages=new Map(),read=address=>{
        const page=address&~4095;
        if(!pages.has(page))pages.set(page,translate(page>>>0));
        const base=pages.get(page),at=base===null?null:base+(address&4095);
        return at!==null&&at>=0&&at<memory.length?memory[at]:null;
    };
    return Array.from({length:count},(_,i)=>{
        const displacement=offset+i*4,at=base+displacement;
        // A 16-bit SS uses SP, even when ESP retains unrelated high bits.
        // Do not wrap a diagnostic read through the stack-width boundary.
        if(displacement+4>width || at+4>0x100000000) return null;
        const bytes=Array.from({length:4},(_,j)=>read(at+j));
        return bytes.includes(null)?null:(bytes[0]|bytes[1]<<8|bytes[2]<<16|bytes[3]<<24)>>>0;
    });
}
