// Version 1 packets carried by the Syborg DisplayDriver copied control.
// All words are little endian: "VGL1", operation, session, then arguments.
// RenderControl commands and handles remain inside the device.
import { GLES } from "../graphics_adapters/renderer_protocol.js";
import { image_bytes } from "./gles_formats.js";
import { command_of_opcode, decode_arguments, encode_command, KIND_BYTES, OutBuffer } from "./gles_wire.js";

const MAGIC = 0x314C4756;
const OPEN = 1, SUBMIT = 2, POLL = 3, RECEIVE = 4, SWAP = 5, CLOSE = 6;
const WAIT = 0, READY = 1, LOST = 2;
const ALPHA = 0x1906, RGBA = 0x1908, UBYTE = 0x1401, USHORT = 0x1403;
const UNPACK_ALIGNMENT = 0x0CF5;
const MAX_PACKET = 1 << 20, MAX_SESSIONS = 8, MAX_OBJECTS = 32;
const MAX_TEXTURES = 128;
const MAX_BUFFERS = 128, MAX_BUFFER_SIZE = 256 << 10;
const CONFIG = 2; // RGBA8888, 24-bit depth, no multisampling
export const SYBORG_GLES_COMMANDS = new Set([
    "glAttachShader", "glBindAttribLocation", "glBindTexture", "glBlendFunc", "glClear", "glClearColor",
    "glColor4f", "glCompileShader", "glCreateProgram", "glCreateShader", "glDeleteProgram", "glDeleteShader",
    "glDeleteTextures", "glDepthFunc", "glDepthMask", "glDisable", "glDisableClientState",
    "glDisableVertexAttribArray", "glDrawArrays", "glEnable", "glEnableClientState", "glEnableVertexAttribArray",
    "glGenTextures", "glGetError", "glGetProgramiv", "glGetShaderiv", "glGetUniformLocation", "glLinkProgram",
    "glLoadIdentity", "glMatrixMode", "glReadPixels", "glRotatef", "glShaderString", "glTexCoordPointerData",
    "glTexImage2D", "glTexParameteri", "glTranslatef", "glUniform1i", "glUniform4f", "glUseProgram",
    "glVertexAttribPointerData", "glVertexPointerData", "glViewport",
    "glClearColorx", "glColor4x", "glColorPointerData", "glDrawElementsData", "glHint", "glLightxv",
    "glMaterialx", "glMaterialxv", "glMultMatrixx", "glNormalPointerData", "glOrthox", "glPixelStorei",
    "glPopMatrix", "glPushMatrix", "glScissor", "glShadeModel", "glTexParameterx", "glTranslatex",
    "glBindBuffer", "glBufferData", "glBufferSubData", "glColorMask", "glDeleteBuffers", "glDetachShader",
    "glDrawElementsOffset", "glGenBuffers", "glGetIntegerv", "glGetProgramInfoLog", "glGetShaderInfoLog",
    "glTexSubImage2D", "glUniform1f", "glUniform2f", "glUniform3f", "glUniformMatrix4fv", "glVertexAttribPointerOffset",
]);

function word(number)
{
    const bytes = new Uint8Array(4);
    new DataView(bytes.buffer).setUint32(0, number, true);
    return bytes;
}

// Check boundaries and total reply bytes before the shared decoder allocates
// out pointers. Void calls can share a packet. A reply terminates the packet.
function packet_commands(api, bytes, reply)
{
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
    const commands = [];
    for(let at = 0; at < bytes.length;)
    {
        if(bytes.length - at < 8 || commands.length >= 128) return null;
        const cmd = command_of_opcode(view.getUint32(at, true)), size = view.getUint32(at + 4, true);
        const end = at + size;
        if(size < 8 || end > bytes.length || !cmd || cmd.api !== api || !SYBORG_GLES_COMMANDS.has(cmd.name)) return null;
        const encoded = bytes.subarray(at, end);
        let out = KIND_BYTES[cmd.ret];
        at += 8;
        for(const [, kind, direction] of cmd.params)
        {
            if(kind !== "ptr") at += KIND_BYTES[kind];
            else
            {
                if(at + 4 > end) return null;
                const n = view.getUint32(at, true);
                at += 4;
                if(direction === "out") out += n;
                else at += n;
            }
        }
        if(at !== end || out && (end !== bytes.length || out !== reply)) return null;
        commands.push({ cmd, encoded, args: decode_arguments(cmd, encoded), out });
    }
    return commands.at(-1)?.out === reply ? commands : null;
}

function object_count(objects, reserved)
{
    // A generated name stays reserved even after its first bind creates an object.
    let count = reserved.size;
    for(const name of objects.keys()) if(!reserved.has(name)) count++;
    return count;
}

function valid_command(client, context, { cmd, args }, unpack_alignment)
{
    switch(cmd.name)
    {
        case "glBindTexture":
            return args[1] === 0 || context.group.textures.has(args[1]) || context.group.reserved.texture.has(args[1]);
        case "glGenTextures":
            return args[0] > 0 && args[1].size === 4 * args[0] &&
                args[0] + object_count(context.group.textures, context.group.reserved.texture) <= MAX_TEXTURES;
        case "glDeleteTextures":
            return args[0] >= 0 && args[1]?.length === 4 * args[0];
        case "glBindBuffer":
            return args[1] === 0 || context.group.buffers.has(args[1]) || context.group.reserved.buffer.has(args[1]);
        case "glGenBuffers":
            return args[0] > 0 && args[1].size === 4 * args[0] &&
                args[0] + object_count(context.group.buffers, context.group.reserved.buffer) <= MAX_BUFFERS;
        case "glDeleteBuffers":
            return args[0] >= 0 && args[1]?.length === 4 * args[0];
        case "glBufferData":
            return args[1] >= 0 && args[1] <= MAX_BUFFER_SIZE && (!args[2] || args[2].length === args[1]);
        case "glBufferSubData":
            return args[1] >= 0 && args[2] >= 0 && args[1] + args[2] <= MAX_BUFFER_SIZE && args[3]?.length === args[2];
        case "glCreateProgram":
        case "glCreateShader":
            return context.group.objects.size < MAX_OBJECTS;
        case "glGetProgramiv":
        case "glGetShaderiv":
            return args[2].size === 4;
        case "glGetShaderInfoLog":
        case "glGetProgramInfoLog":
            return args[1] >= 0 && args[1] <= 4096 && args[2].size === 4 && args[3].size === args[1];
        case "glGetIntegerv":
            return args[0] === 0x0BA2 ? args[1].size === 16 : args[0] === 0x0D56 && args[1].size === 4;
        case "glDrawArrays":
            return args[1] >= 0 && args[2] >= 0 && args[1] + args[2] <= 65536;
        case "glDrawElementsData":
        {
            const [, count, type, indices, length] = args;
            const bytes = type === UBYTE ? 1 : type === USHORT ? 2 : 0;
            return bytes && count >= 0 && count <= 65536 && length === count * bytes && indices?.length === length;
        }
        case "glDrawElementsOffset":
        {
            const [, count, type, offset] = args;
            const bytes = type === UBYTE ? 1 : type === USHORT ? 2 : 0;
            return bytes && count >= 0 && count <= 98304 && offset % bytes === 0 && offset + count * bytes <= MAX_BUFFER_SIZE;
        }
        case "glVertexPointerData":
        case "glColorPointerData":
        case "glNormalPointerData":
        case "glTexCoordPointerData":
        case "glVertexAttribPointerData":
            return args.at(-2)?.length === args.at(-1);
        case "glVertexAttribPointerOffset":
            return args[0] < 16 && args[1] >= 1 && args[1] <= 4 && args[4] >= 0 && args[4] <= 255 && args[5] < MAX_BUFFER_SIZE;
        case "glLightxv":
        case "glMaterialxv":
            return [4, 12, 16].includes(args[2]?.length);
        case "glMultMatrixx":
            return args[0]?.length === 64;
        case "glTexImage2D":
        {
            const [target, level, internal_format, width, height, border, format, type, pixels] = args;
            const texel_bytes = format === RGBA ? 4 : format === ALPHA ? 1 : 0;
            return texel_bytes && target === 0x0DE1 && level === 0 && internal_format === format && !border && type === UBYTE &&
                width > 0 && height > 0 && width <= 256 && height <= 256 &&
                (!pixels || pixels.length === image_bytes(width, height, texel_bytes, unpack_alignment));
        }
        case "glTexSubImage2D":
        {
            const [target, level, x, y, width, height, format, type, pixels] = args;
            const texel_bytes = format === RGBA ? 4 : format === ALPHA ? 1 : 0;
            return texel_bytes && target === 0x0DE1 && level === 0 && x >= 0 && y >= 0 && type === UBYTE &&
                width > 0 && height > 0 && x + width <= 256 && y + height <= 256 &&
                pixels?.length === image_bytes(width, height, texel_bytes, unpack_alignment);
        }
        case "glReadPixels":
        {
            const [x, y, width, height, format, type, pixels] = args;
            return x >= 0 && y >= 0 && width > 0 && height > 0 && x + width <= client.width && y + height <= client.height &&
                format === RGBA && type === UBYTE && pixels.size === width * height * 4;
        }
        case "glShaderString":
            return args[1]?.length === args[2] && args[2] <= 16384;
        case "glUniformMatrix4fv":
            return args[1] >= 0 && args[1] <= 64 && args[2] === 0 && args[3]?.length === args[1] * 64;
        default:
            return true;
    }
}

export function create_syborg_transport(host)
{
    const clients = new Map();
    // Retain recent swap timings without growing the diagnostics with a session's duration.
    const recent = new Array(1024);
    let measured = 0;
    let next = 1, swaps1 = 0, swaps2 = 0, failed_swaps = 0;
    const empty = new Uint8Array();
    function close(id, client)
    {
        client.stream.close();
        clients.delete(id);
        host.flush();
    }

    function open(owner, version, width, height, capacity)
    {
        if(host.lost || capacity !== 4 || clients.size >= MAX_SESSIONS || version !== 1 && version !== 2 ||
            !width || !height || width > 640 || height > 640 || width * height * 4 > MAX_PACKET) return null;
        const stream = host.connect(() => {});
        stream.write(word(0)); // emugl connection flags
        function handle(name, args)
        {
            stream.write(encode_command(name, args));
            const reply = stream.read(4);
            return reply ? new DataView(reply.buffer, reply.byteOffset, 4).getUint32(0, true) : 0;
        }
        const context = handle("rcCreateContext", [CONFIG, 0, version]);
        const surface = handle("rcCreateWindowSurface", [CONFIG, width, height]);
        const color = handle("rcCreateColorBuffer", [width, height, RGBA]);
        stream.write(encode_command("rcSetWindowColorBuffer", [surface, color]));
        if(!context || !surface || !color || !handle("rcMakeCurrent", [context, surface, surface]))
        {
            stream.close();
            return null;
        }
        const id = next++;
        clients.set(id, { owner, api: version === 1 ? "gles1" : "gles2", width, height, stream, context, surface, color,
            waiting: 0, swap: null });
        return word(id);
    }

    return {
        "available": () => !host.lost,
        "summary": () => ({ "clients": clients.size, "swaps": swaps1 + swaps2, "gles1_swaps": swaps1,
            "gles2_swaps": swaps2, "failed_swaps": failed_swaps, "lost": host.lost,
            "recent_swaps": Array.from({ length: Math.min(recent.length, measured) }, (_, i) =>
                recent[(Math.max(0, measured - recent.length) + i) % recent.length]) }),
        "reset"()
        {
            for(const [id, client] of clients) close(id, client);
            swaps1 = swaps2 = failed_swaps = 0;
            measured = 0;
            recent.fill(undefined);
        },
        "check_save"()
        {
            if(clients.size) throw new Error("Close the Symbian EGL application before saving its machine state");
        },
        "submit"(owner, rights, bytes, capacity)
        {
            const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
            // The pinned driver's last close sends OWNER_FREE in kernel context.
            if(!owner && rights === 1 && !capacity && bytes.length === 12 &&
                view.getUint32(0, true) === 9 && view.getUint32(4, true) === 3)
            {
                const dead = view.getUint32(8, true);
                for(const [id, client] of clients) if(client.owner === dead) close(id, client);
                return empty;
            }
            if(!owner || ![0, 2].includes(rights) || bytes.length < 12 || view.getUint32(0, true) !== MAGIC) return null;
            const op = view.getUint32(4, true), id = view.getUint32(8, true);
            if(op === OPEN && !id && bytes.length === 24)
                return open(owner, view.getUint32(12, true), view.getUint32(16, true), view.getUint32(20, true), capacity);
            const client = clients.get(id);
            if(!client || client.owner !== owner) return null;
            if(op === CLOSE && bytes.length === 12 && !capacity) { close(id, client); return empty; }
            if(op === POLL && bytes.length === 12 && capacity === 4)
                return word(host.lost || client.swap === false ? LOST : client.swap || client.stream.available() ? READY : WAIT);
            if(host.lost) return null;
            if(op === RECEIVE && bytes.length === 12 && capacity && capacity === client.waiting)
            {
                const data = client.swap || client.stream.read(capacity);
                if(!data || data.length !== capacity) return null;
                client.waiting = 0;
                client.swap = null;
                return data;
            }
            if(capacity || client.waiting) return null;
            if(op === SUBMIT && bytes.length >= 24)
            {
                const reply = view.getUint32(12, true);
                if(reply > MAX_PACKET) return null;
                let commands;
                try { commands = packet_commands(client.api, bytes.subarray(16), reply); }
                catch{ return null; }
                if(!commands) return null;
                const context = host.shadow.context(client.context);
                let unpack_alignment = context.unpack_alignment;
                for(const command of commands)
                {
                    if(!valid_command(client, context, command, unpack_alignment)) return null;
                    if(command.cmd.name === "glPixelStorei" && command.args[0] === UNPACK_ALIGNMENT && [1, 2, 4, 8].includes(command.args[1]))
                        unpack_alignment = command.args[1];
                }
                client.waiting = reply;
                client.stream.write(bytes.subarray(16));
                return empty;
            }
            if(op === SWAP && bytes.length === 12)
            {
                const started = performance.now();
                client.waiting = client.width * client.height * 4;
                const out = new OutBuffer(client.waiting, null);
                host.rc.flush_surface(client.surface);
                const request = host.request(out, true);
                host.record(GLES.COLOR_BUFFER_READ, [client.color, 0, 0, client.width, client.height, RGBA, UBYTE, request.id]);
                host.flush();
                request.done.then(ok => {
                    if(clients.get(id) !== client) return;
                    client.swap = ok ? out.data : false;
                    if(!ok) failed_swaps++;
                    else
                    {
                        if(client.api === "gles1") swaps1++;
                        else swaps2++;
                        const finished = performance.now();
                        recent[measured++ % recent.length] = { "session": id, "api": client.api,
                            "finished_ms": finished, "readback_ms": finished - started, "bytes": out.size };
                    }
                });
                return empty;
            }
            return null;
        },
    };
}
