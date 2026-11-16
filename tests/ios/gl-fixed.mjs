// Original iOS entry points -> production ES1 adapters -> independent wire
// encoder. In particular, client arrays must be read when drawing, not when
// their pointers were set, and VBO offsets must never be dereferenced.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { build32, actual32, root } from "../a32/runner.mjs";
import { gl_wrappers, gl_slot_header } from "../../tools/ios/gl-dispatch.mjs";
import { GLES_APIS } from "../../src/gles/gles_protocol.js";
import { command_of_name, encode_command } from "../../src/gles/gles_wire.js";
const cache = process.argv[2];
if(!cache) throw Error("usage: gl-fixed.mjs dyld_shared_cache_armv7");
const wrappers = gl_wrappers(fs.readFileSync(cache)), dir = path.join(root, "build/ios/fixed-wire");
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, "gl-slots.h"), gl_slot_header(wrappers));
const defs = [];
defs.push("#define v86_ElementIndexMax " + command_of_name("v86ElementIndexMax").opcode);
for(const [api, { base, commands }] of Object.entries(GLES_APIS))
    commands.forEach(([name], i) => defs.push("#define " + api + "_" + name + " " + (base + i)));
const packets = [], body = [], declarations = [], names = new Set();
function packet(api, name, args, reply = new Uint8Array())
{
    packets.push({ bytes: encode_command(api + ":" + name, args), reply: new Uint8Array(reply.buffer, reply.byteOffset, reply.byteLength) });
}
const vectorCases = [
    ["glLoadMatrixf", [], 16, false], ["glMultMatrixx", [], 16, false],
    ["glLightfv", [0x4000, 0x1201], 4, false], ["glLightfv", [0x4000, 0x1204], 3, false],
    ["glMaterialfv", [0x408, 0x1601], 1, false], ["glFogfv", [0xb66], 4, false],
    ["glLightModelfv", [0xb53], 4, false], ["glPointParameterfv", [0x8129], 3, false],
    ["glTexEnvfv", [0x2300, 0x2201], 4, false], ["glTexParameteriv", [0xde1, 0x8b9d], 4, false],
    ["glGetLightfv", [0x4000, 0x1204], 3, true], ["glGetMaterialxv", [0x404, 0x1601], 1, true],
    ["glGetTexEnviv", [0x2300, 0x2201], 4, true], ["glGetTexParameterfv", [0xde1, 0x8b9d], 4, true],
    ["glClipPlanef", [0x3000], 4, false], ["glGetClipPlanex", [0x3000], 4, true],
    ["glDrawTexsvOES", [], 5, false],
];
for(const [i, [name, args, count, output]] of vectorCases.entries())
{
    names.add(name); declarations.push(`extern void ${name}(${[...args.map(() => "unsigned"), "void *"].join(",")});`);
    const type = name === "glDrawTexsvOES" ? "short" : "int", width = type === "short" ? 2 : 4;
    const values = Array.from({ length: count }, (_, n) => 19 + n * 7);
    const bytes = width === 2 ? new Int16Array(values) : new Int32Array(values);
    packet("gles1", name, [...args, output ? width * count : new Uint8Array(bytes.buffer)], output ? new Uint8Array(bytes.buffer) : new Uint8Array());
    body.push(`{ ${type} v[]={91,${values.map(v => output ? 0 : v)},92}; ${name}(${[...args, "v+1"].join(",")});`,
        `if(v[0]!=91 || v[${count + 1}]!=92${output ? values.map((v, n) => " || v[" + (n + 1) + "]!=" + v).join("") : ""})return ${i + 1}; }`);
}
for(const name of ["glVertexPointer", "glColorPointer", "glTexCoordPointer", "glClientActiveTexture", "glEnableClientState", "glDisableClientState", "glDrawArrays", "glDrawElements", "glGetPointerv", "glGetIntegerv"])
    names.add(name);
packet("gles1", "glVertexPointerData", [2, 0x1406, 20, new Uint8Array(), 0]);
packet("gles1", "glColorPointerData", [4, 0x1401, 0, new Uint8Array(), 0]);
packet("gles1", "glClientActiveTexture", [0x84c1]);
packet("gles1", "glTexCoordPointerData", [1, 2, 0x1406, 0, new Uint8Array(), 0]);
for(const cap of [0x8074, 0x8076, 0x8078]) packet("gles1", "glEnableClientState", [cap]);
const vertices = new Float32Array(Array.from({ length: 12 }, (_, i) => i));vertices[5] = 99;
const color = Uint8Array.from({ length: 12 }, (_, i) => 40 + i), uv = new Float32Array([0, 0, 1, 0, 0, 1]);
const packedVertices=new Float32Array([vertices[0],vertices[1],vertices[5],vertices[6],vertices[10],vertices[11]]);
packet("gles1", "glVertexPointerData", [2, 0x1406, 20, new Uint8Array(packedVertices.buffer), packedVertices.byteLength]);
packet("gles1", "glColorPointerData", [4, 0x1401, 0, color, color.length]);
packet("gles1", "glTexCoordPointerData", [1, 2, 0x1406, 0, new Uint8Array(uv.buffer), uv.byteLength]);
packet("gles2", "glDrawArrays", [4, 0, 3]);
packet("gles2", "glGetIntegerv", [0x807c,4],new Int32Array([20]));
packet("gles1", "glVertexPointerOffset", [2, 0x1406, 20, 64]);
for(const cap of [0x8076, 0x8078]) packet("gles1", "glDisableClientState", [cap]);
packet("gles2", "glDrawArrays", [4, 0, 3]);
packet("gles1", "glColorPointerData", [4, 0x1401, 0, new Uint8Array(), 0]);
packet("gles1", "glEnableClientState", [0x8076]);
packets.push({bytes:encode_command("v86ElementIndexMax",[3,0x1403,2,4]),reply:new Uint8Array(new Uint32Array([2,1]).buffer)});
packet("gles1", "glColorPointerData", [4, 0x1401, 0, color, color.length]);
packet("gles2", "glDrawElementsOffset", [4,3,0x1403,2]);
packets.push({bytes:encode_command("v86ElementIndexMax",[3,0x1403,200,4]),reply:new Uint8Array(8)});
body.push(`float vertices[15];for(int i=0;i<15;i++)vertices[i]=i;
unsigned char color[12];for(int i=0;i<12;i++)color[i]=40+i;
float uv[]={0,0,1,0,0,1};
glVertexPointer(2,0x1406,20,vertices);glColorPointer(4,0x1401,0,color);
glClientActiveTexture(0x84c1);glTexCoordPointer(2,0x1406,0,uv);
glEnableClientState(0x8074);glEnableClientState(0x8076);glEnableClientState(0x8078);
vertices[5]=99;glDrawArrays(4,0,3);
int stride=0;glGetIntegerv(0x807c,&stride);if(stride!=20)return 55;
void *ptr=0;glGetPointerv(0x8092,&ptr);if(ptr!=uv)return 50;
buffer_binding=7;glVertexPointer(2,0x1406,20,(void *)64);
glDisableClientState(0x8076);glDisableClientState(0x8078);glDrawArrays(4,0,3);
glGetPointerv(0x808e,&ptr);if(ptr!=(void *)64)return 51;
buffer_binding=0;element_binding=9;glColorPointer(4,0x1401,0,color);glEnableClientState(0x8076);
glDrawElements(4,3,0x1403,(void *)2);glDrawElements(4,3,0x1403,(void *)200);
if(ctx.error!=0x502)return 54;ctx.error=0;
unsigned before=sent;glColorPointer(3,0x1401,0,color);if(ctx.error!=0x501||sent!=before)return 52;
ctx.error=0;glClientActiveTexture(0x8500);if(ctx.error!=0x500||sent!=before)return 53;
`);
const asm = [".syntax unified", ".thumb", ".text"];
for(const name of names) asm.push(".balign 4", ".global " + name, ".thumb_func", name + ":", ".byte " + wrappers.get(name).join(","));
const requests = packets.map((p, i) => `static const unsigned char request${i}[]={${p.bytes}},reply${i}[]={${p.reply.length ? [...p.reply] : 0}};`).join("\n");
const rows = packets.map((p, i) => `{request${i},sizeof(request${i}),reply${i},${p.reply.length}}`).join(",");
const c = `#include <stdio.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include "gl-slots.h"
void __aeabi_memclr8(void *p,size_t n){memset(p,0,n);}
void __aeabi_memcpy8(void *p,const void *q,size_t n){memcpy(p,q,n);}
${defs.join("\n")}
typedef size_t usize;typedef uintptr_t driver_word;
#define N90_ATTRIBS 16
struct client_attrib {const void *data;unsigned type;int size,stride;unsigned char normalized,enabled,client;};
struct context {struct {unsigned connection;int ok;}driver;unsigned error,api,framebuffer,frame_dirty,client_texture,texture_limit,unpack_row_bytes,client_storage;struct client_attrib attribs[16],fixed_arrays[36];};
${requests}
static const struct {const unsigned char *req;unsigned n;const unsigned char *reply;unsigned r;} packets[]={${rows}};
static unsigned sent,reading,read_at,buffer_binding,element_binding;
static int gles_send(unsigned conn,unsigned *p,unsigned n) {p[1]=n;
if(conn!=27||sent>=sizeof(packets)/sizeof(*packets)||n!=packets[sent].n||memcmp(p,packets[sent].req,n)) {printf("bad packet %u opcode %u bytes %u\\n",sent,p[0],n);return 0;}
if(sent&&read_at!=packets[sent-1].r)return 0;reading=sent++;read_at=0;return 1;}
static int gles_read(unsigned conn,void *out,unsigned n) {if(conn!=27||!sent||read_at+n>packets[reading].r)return 0;if(n)memcpy(out,packets[reading].reply+read_at,n);read_at+=n;return 1;}
#define SEND(c,op,...) gles_send(c,(unsigned[]){op,0,__VA_ARGS__},sizeof((unsigned[]){op,0,__VA_ARGS__}))
static int refresh_textures(struct context *c){(void)c;return 1;}
static int integer_value(struct context *c,unsigned p,int *out){(void)c;if(p!=0x8894&&p!=0x8895)return 0;*out=p==0x8894?buffer_binding:element_binding;return 1;}
#include "gli-draw.h"
#include "gli-query.h"
#include "gli-fixed.h"
${declarations.join("\n")}
extern void glVertexPointer(int,unsigned,int,const void *),glColorPointer(int,unsigned,int,const void *),glTexCoordPointer(int,unsigned,int,const void *);
extern void glClientActiveTexture(unsigned),glEnableClientState(unsigned),glDisableClientState(unsigned),glDrawArrays(unsigned,int,int),glGetPointerv(unsigned,void **);
extern void glDrawElements(unsigned,int,unsigned,const void *);
extern void glGetIntegerv(unsigned,int *);
static driver_word tls[64],table[N90_GL_TABLE_WORDS];
int main(void) {struct context ctx={.driver={27,1},.api=1,.texture_limit=4};driver_word p=(driver_word)tls;
__asm__ volatile("mcr p15,0,%0,c13,c0,3\\n\\tisb"::"r"(p):"memory");tls[30]=(driver_word)table;table[4]=(driver_word)&ctx;
install_query_functions(table+5);install_fixed_functions(table+5);install_draw_functions(table+5);
${body.join("\n")}
char extensions[]="GL_OES_EGL_image GL_OES_EGL_image_external GL_OES_draw_texture ANDROID_EMU_gles_max_version_3_1 GL_OES_point_sprite ";
native_extensions(extensions);if(strcmp(extensions,"GL_OES_draw_texture GL_OES_point_sprite"))return 61;
if(!ctx.driver.ok||sent!=sizeof(packets)/sizeof(*packets)||read_at!=packets[reading].r){printf("sent %u\\n",sent);return 60;}
puts("ES1 pointer packets and live arrays passed");return 0;}
`;
fs.writeFileSync(path.join(dir, "fixed.c"), c);fs.writeFileSync(path.join(dir, "wrappers.S"), asm.join("\n") + "\n");
const guest = build32("ios-fixed-wire", [path.join(dir, "fixed.c"), path.join(dir, "wrappers.S")],
    { cflags: ["-I", dir, "-I", path.join(root, "tools/ios/guest"), "-ffixed-r9"] });
const result = await actual32(guest, { timeout: 30000 });
assert.equal(result.status, "ok", result.text);assert.match(result.text, /ES1 pointer packets and live arrays passed/);
console.log("PASS: native ES1 vectors, guarded queries, live interleaved arrays, texture units, VBO offsets and validation");
