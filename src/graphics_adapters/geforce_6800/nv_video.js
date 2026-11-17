// NV10/NV40 PVIDEO packed YUV overlay. Register layout: envytools
// rnndb/display/nv10_pvideo.xml and Linux nouveau dispnv04/overlay.c (MIT).
// Completion describes a buffer accepted by the scanout, never a guest
// notifier write: the original miniport services the PVIDEO interrupt.
const PARAMS=[0x8900,0x8908,0x8910,0x8918,0x8920,0x8928,0x8930,0x8938,0x8940,0x8948,0x8950,0x8958];
const clip=value=>Math.max(0,Math.min(255,Math.round(value)));

export class NVVideo
{
    constructor(device)
    {
        this.device=device;
        /** @type {?Array<number>} */
        this.active=null;
        /** @type {!Array<?Array<number>>} */
        this.pending=[null,null];
        this.last=1;this.faults=[];
        this.counter=0;this.consumer=0;this.commands=[];
    }
    reset() {this.active=null;this.pending=[null,null];this.last=1;this.faults=[];this.counter=0;this.consumer=0;this.commands=[];}
    reg(at) {return this.device.registers.get(at)||0;}
    implemented(at)
    {
        return [0x8100,0x8140,0x8700,0x8704,0x8B00,0x8B04,0x8B08,0x8B0C,0x8B10,0x8B14].includes(at) ||
            PARAMS.some(base=>at===base||at===base+4);
    }
    read(at)
    {
        if(at===0x8700)return (this.pending[0]?1:0)|(this.pending[1]?16:0);
        if(at===0x8B04)return ((this.reg(at)&0xF000FFFF)|this.counter<<16)>>>0;
        if(at===0x8B08)return ((this.reg(at)&~0x010F0FFF)|this.counter|this.consumer<<16|
            (this.commands.length?0x01000000:0))>>>0;
        return null;
    }
    capture(index) {return PARAMS.map(at=>this.reg(at+index*4)).concat(this.reg(0x8B00));}
    written(at,value)
    {
        if(at===0x8700)for(let i=0;i<2;i++)if(value&1<<(i*4))this.pending[i]=this.capture(i);
        // NV30's overlay scheduler adds a 12-bit retrace counter and a
        // pending offset slot. 175.16 feeds it from its own sixteen-entry
        // software queue, polls 8B08[24] before submitting another offset,
        // samples completed transfers at [19:16], and handles INTR bit 8.
        // These transfers never write a driver notifier on the host.
        if(at===0x8B0C&&value&0x10000&&!this.commands.length)
        {
            const job=this.capture(0);job[4]=this.reg(0x8B10);
            this.commands.push([this.reg(at)&4095,this.reg(0x8B14),job]);
            this.device.registers.set(at,this.reg(at)&~0x10000);
        }
    }
    plan(job)
    {
        const [base,limit,luma,chroma,offset,input,origin,ds,dt,point,size,format,key]=job;
        const width=input&65535,height=input>>>16,pitch=format&65535;
        const outw=size&65535,outh=size>>>16,extent=pitch*(height-1)+width*2;
        if(format&1 || format&~0x0111FFFF)throw new RangeError("NV PVIDEO unsupported format");
        if(!width||!height||width&1||width>8192||height>8192||!outw||!outh||outw>8192||outh>8192||
            pitch<width*2||!ds||!dt||offset+extent>limit+1||base+offset+extent>this.device.vram_size)
            throw new RangeError("NV PVIDEO invalid surface bounds");
        return {base:base+offset,width,height,pitch,luma,chroma,ds,dt,format,key,
            sx:origin&65535,sy:origin>>>16,x:point<<16>>16,y:point>>16,outw,outh};
    }
    on_vblank()
    {
        // 8B04[27:16] is the display-side sample used by the miniport when
        // choosing the next overlay deadline. Disabling offset scheduling
        // cannot stop that display clock or make its sample stay at zero.
        this.counter=this.counter+1&4095;
        if(this.reg(0x8B08)&0x10000000)
        {
            const command=this.commands[0];
            // A command may reach the scheduler after its target retrace.
            // Compare the wrapping deadline, rather than waiting an entire
            // 4096-retrace revolution for an equality that already passed.
            if(command&&((this.counter-command[0])&4095)<2048)
            {
                try {this.plan(command[2]);}
                catch(error)
                {
                    if(!(error instanceof RangeError))throw error;
                    if(this.faults.at(-1)!==error.message)this.faults.push(error.message);
                    return;
                }
                if(!(this.reg(0x8704)&1))this.active=command[2];
                this.commands.shift();this.consumer=this.consumer+1&15;
                this.device.registers.set(0x8100,this.reg(0x8100)|0x100);
                this.device.update_irq();
            }
        }
        if(this.reg(0x8704)&1) {this.active=null;this.pending=[null,null];return;}
        const next=this.pending[this.last^1]?this.last^1:this.last;
        const job=this.pending[next];if(!job)return;
        try {this.plan(job);}
        catch(error)
        {
            if(!(error instanceof RangeError))throw error;
            if(this.faults.at(-1)!==error.message)this.faults.push(error.message);
            if(this.faults.length>16)this.faults.shift();
            return;
        }
        this.active=job;this.last=next;this.pending[next]=null;
        this.device.registers.set(0x8700,this.read(0x8700));
        this.device.registers.set(0x8100,this.reg(0x8100)|1<<(next*4));
        this.device.update_irq();
    }
    pixel(p,vram,x,y)
    {
        x=Math.max(0,Math.min(p.width-1,x));y=Math.max(0,Math.min(p.height-1,y));
        const at=p.base+y*p.pitch+(x&~1)*2,yuyv=!!(p.format&0x10000);
        const yy=vram[at+(x&1)*2+(yuyv?0:1)];
        const u=vram[at+(yuyv?1:0)]-128,v=vram[at+(yuyv?3:2)]-128;
        const contrast=(p.luma&65535)/4096,brightness=p.luma>>16;
        const cos=(p.chroma<<16>>16)/4096,sin=(p.chroma>>16)/4096;
        const cb=u*cos+v*sin,cr=v*cos-u*sin,luma=1.164383*(yy-16)*contrast+brightness;
        const hd=!!(p.format&0x1000000);
        return [clip(luma+(hd?1.792741:1.596027)*cr),
            clip(luma-(hd?0.213249:0.391762)*cb-(hd?0.532909:0.812968)*cr),
            clip(luma+(hd?2.112402:2.017232)*cb)];
    }
    render(out,vram,width,height,keys=null)
    {
        if(!this.active)return;
        const p=this.plan(this.active);
        for(let y=Math.max(0,p.y);y<Math.min(height,p.y+p.outh);y++)
            for(let x=Math.max(0,p.x);x<Math.min(width,p.x+p.outw);x++)
        {
            const at=(y*width+x)*4;
            const key=keys?keys[y*width+x]:(out[at]<<16|out[at+1]<<8|out[at+2]);
            if(p.format&0x100000 && key!==(p.key&0xFFFFFF))continue;
            const sx=p.sx+(x-p.x)*p.ds/1048576,sy=p.sy+(y-p.y)*p.dt/1048576;
            const color=this.pixel(p,vram,Math.floor(sx),Math.floor(sy));
            out[at]=color[0];out[at+1]=color[1];out[at+2]=color[2];out[at+3]=255;
        }
    }
    get_state() {return [this.active,this.pending,this.last,this.counter,this.consumer,this.commands];}
    set_state(state)
    {
        this.reset();
        if(state)
        {
            this.active=state[0];this.pending=state[1];this.last=state[2];
            this.counter=state[3]||0;this.consumer=state[4]||0;this.commands=state[5]||[];
        }
        else
        {
            this.counter=this.reg(0x8B08)&4095;this.consumer=this.reg(0x8B08)>>>16&15;
            this.written(0x8700,this.reg(0x8700));this.written(0x8B0C,this.reg(0x8B0C));
        }
    }
}
