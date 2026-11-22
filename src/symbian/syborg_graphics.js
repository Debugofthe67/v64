// Physical side of the pinned DisplayDriver's copied GL control (0x7f11).
// DisplayDriver supplies a process ID and two contiguous kernel buffers.
// The user-mapped register and virtual-address controls are unsupported.
const ID = 0xC51D0011;
const MAX_PACKET = 1 << 20;
const REG = { ID: 0, CAPS: 1, IN: 2, SIZE: 3, EXEC: 4, OUT: 5, CAPACITY: 6, PID: 8, RIGHTS: 9 };

export function syborg_graphics(cpu, backend, privileged)
{
    const regs = new Uint32Array(10);
    function execute()
    {
        const input = regs[REG.IN], size = regs[REG.SIZE], output = regs[REG.OUT], capacity = regs[REG.CAPACITY];
        const owner = regs[REG.PID], rights = regs[REG.RIGHTS];
        regs.fill(0);
        regs[REG.EXEC] = 1;
        if(size < 8 || size > MAX_PACKET || capacity > MAX_PACKET ||
            cpu.ram_offset(input, size) < 0 || capacity && cpu.ram_offset(output, capacity) < 0) return;
        const response = backend["submit"](owner, rights, cpu.read_blob_physical(input, size), capacity);
        if(!response || response.length !== capacity) return;
        if(capacity) cpu.write_blob_physical(response, output);
        regs[REG.EXEC] = 0;
    }
    cpu.io.register_mmio(0xC000F000, 0x1000, {
        name: "Syborg EGL/GLES",
        read(offset, width)
        {
            if(width !== 4 || offset & 3 || !privileged()) return 0;
            const reg = offset >>> 2;
            if(reg === REG.ID) return ID;
            if(reg === REG.CAPS) return +backend["available"]();
            return reg === REG.EXEC ? regs[reg] : 0;
        },
        write(offset, width, value)
        {
            if(width !== 4 || offset & 3 || !privileged()) return;
            const reg = offset >>> 2;
            if(reg < REG.IN || reg >= regs.length || reg === 7) return;
            if(reg === REG.EXEC) execute();
            else regs[reg] = value >>> 0;
        },
    });
    return {
        reset() { regs.fill(0); },
        get_state() { return regs.slice(); },
        set_state(state) { regs.set(state); },
    };
}
