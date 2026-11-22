import { syborg_registers } from "./syborg_devices.js";

export const syborg_orientation = angle => angle === 0 || angle === 90;

// qembian syborg-sensor register interface and the RM-356 accssy driver info.
export function syborg_accelerometer(cpu, bus)
{
    const info = new Uint32Array(248 / 4);
    info[0x10 / 4] = 1; // XYZ
    info[0x2C / 4] = 1; // Wake-up channel in accssy's static channel list
    info[0x78 / 4] = 1; // Double-tap channel in accssy's static channel list
    let angle = 0, sequence = 0;

    bus.register("symbian-orientation", next => {
        if(!syborg_orientation(next) || next === angle) return;
        angle = next;
        sequence = (sequence + 1) >>> 0;
    });
    syborg_registers(cpu, "Syborg accelerometer", 0xC001D000, index => {
        if(index >= 0x100 / 4) return info[index - 0x100 / 4] || 0;
        // Device axes, in milli-g. Clockwise puts the left edge at the top.
        switch(index)
        {
            case 0: return 0xC51D0030;
            case 1: return angle === 90 ? -1000 : 0;
            case 2: return angle === 90 ? 0 : 1000;
            case 4: return sequence;
            case 5: return info.byteLength;
            default: return 0;
        }
    }, () => {});

    return {
        get_state() { return [angle, sequence]; },
        set_state([saved_angle, saved_sequence] = [0, 0])
        {
            angle = saved_angle;
            sequence = saved_sequence;
            bus.send("symbian-orientation-restored", angle);
        },
    };
}
