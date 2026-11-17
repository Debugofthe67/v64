// Exercise the production ARM-independent upload encoder with real row data.
#include <assert.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <stdio.h>
typedef size_t usize;
typedef uintptr_t driver_word;
struct context { struct { unsigned connection, ok; } driver; unsigned error, unpack_row_bytes, client_storage, api; };
#define N90_MAX_PAYLOAD ((80u << 20) - 32)
enum { gles2_glPixelStorei, gles2_glTexImage2D, gles2_glTexSubImage2D,
    gles2_glCompressedTexImage2D, gles2_glCompressedTexSubImage2D,
    gles2_glGetIntegerv, gles2_glGetFloatv, gles2_glGetBooleanv,
    gles2_glGetRenderbufferParameteriv, gles2_glGetShaderiv, gles2_glGetProgramiv,
    gles2_glGetShaderInfoLog, gles2_glGetProgramInfoLog, gles2_glGetShaderSource,
    gles2_glGetActiveUniform, gles2_glGetActiveAttrib };
enum { N90_glPixelStorei=5, N90_glTexImage2D, N90_glTexSubImage2D,
    N90_glCompressedTexImage2D, N90_glCompressedTexSubImage2D,
    N90_glGetIntegerv, N90_glGetFloatv, N90_glGetBooleanv,
    N90_glGetRenderbufferParameteriv, N90_glGetShaderiv, N90_glGetProgramiv,
    N90_glGetShaderInfoLog, N90_glGetProgramInfoLog, N90_glGetShaderSource,
    N90_glGetActiveUniform, N90_glGetActiveAttrib };
static unsigned char *packet;
static unsigned packet_size, alignment=8, forwarded;
static void draw_error(struct context *ctx,unsigned code){if(!ctx->error)ctx->error=code;}
static int integer_value(struct context *ctx,unsigned pname,int *out)
{(void)ctx;assert(pname==0xcf5);*out=alignment;return 1;}
#define SEND(...) (++forwarded,1)
static int gles_read(unsigned connection,void *out,unsigned size)
{(void)connection;(void)out;(void)size;assert(!"Apple state queries must stay local");return 0;}
static unsigned *draw_packet(struct context *ctx,unsigned op,unsigned bytes)
{(void)ctx;unsigned *p=calloc(1,bytes);assert(p);p[0]=op;return p;}
static void send_draw_packet(struct context *ctx,unsigned *p,unsigned bytes)
{(void)ctx;free(packet);packet=(unsigned char *)p;packet_size=bytes;}
#include "../../tools/ios/guest/gli-texture.h"
#include "../../tools/ios/guest/gli-query.h"
static void reset(struct context *c){free(packet);packet=0;packet_size=0;c->error=0;}
int main(void)
{
    struct context c={0},other={0};driver_word slots[32]={0};
    install_texture_functions(slots);install_query_functions(slots);
    assert(slots[0]==(driver_word)pixel_store);
    pixel_store(&c,0x85b2,7);assert(c.client_storage==1&&!c.error&&!forwarded);
    pixel_store(&c,0x8a16,5);assert(c.unpack_row_bytes==5&&!c.error&&!forwarded);
    int i=-1;float f=-1;unsigned char boolean=0;
    get_integers(&c,0x8a16,&i);get_floats(&c,0x8a16,&f);get_booleans(&c,0x85b2,&boolean);
    assert(i==5&&f==5&&boolean==1&&!forwarded);
    get_integers(&other,0x8a16,&i);assert(i==0);
    get_booleans(&other,0x85b2,&boolean);assert(boolean==0);
    get_integers(&c,0x8a16,0);assert(c.error==0x501);reset(&c);
    pixel_store(&c,0x8a16,-1);assert(c.error==0x501&&c.unpack_row_bytes==5);
    reset(&c);
    // A 3-byte RGB row with two bytes of source padding overrides alignment 8.
    const unsigned char rgb[]={1,2,3,99,98,4,5,6};
    tex_image(&c,0xde1,0,0x1907,1,2,0,0x1907,0x1401,rgb);
    const unsigned char expected[]={1,2,3,0,0,0,0,0,4,5,6};
    assert(!c.error&&packet_size==44+sizeof(expected));
    assert(((unsigned *)packet)[10]==sizeof(expected));
    assert(!memcmp(packet+44,expected,sizeof(expected))&&rgb[3]==99);
    reset(&c);
    // Apple's RGBA/BGRA pair maps to the wire's EXT BGRA storage, without
    // swizzling or reading padding as pixels; subimage uses the same bytes.
    const unsigned char bgra[]={9,8,7,255,88,6,5,4,255};
    tex_image(&c,0xde1,0,0x1908,1,2,0,0x80e1,0x1401,bgra);
    assert(!c.error&&((unsigned *)packet)[4]==0x80e1);
    assert(!memcmp(packet+44,bgra,4)&&!memcmp(packet+52,bgra+5,4));
    reset(&c);
    tex_sub_image(&c,0xde1,0,1,2,1,2,0x80e1,0x1401,bgra);
    assert(!c.error&&((unsigned *)packet)[0]==gles2_glTexSubImage2D);
    assert(!memcmp(packet+44,bgra,4)&&!memcmp(packet+52,bgra+5,4));
    reset(&c);
    // Zero resets row bytes; null allocations must never dereference pixels.
    pixel_store(&c,0x8a16,0);pixel_store(&c,0x85b2,0);
    assert(!c.unpack_row_bytes&&!c.client_storage);
    tex_image(&c,0xde1,0,0x1908,2,2,0,0x1908,0x1401,0);
    assert(!c.error&&packet_size==44&&((unsigned *)packet)[10]==0);
    reset(&c);
    pixel_store(&c,0x8a16,0x7fffffff);
    tex_image(&c,0xde1,0,0x1908,1,4,0,0x1908,0x1401,bgra);
    assert(c.error==0x501&&!packet);
    reset(&c);
    tex_image(&c,0xde1,0,0x1908,16384,16384,0,0x1908,0x1401,bgra);
    assert(c.error==0x505&&!packet);
    reset(&c);
    c.api=1;compressed_image(&c,0xde1,0,0x8b91,4,4,1,100,(void *)1);
    assert(c.error==0x502&&!packet);reset(&c);
    c.api=2;compressed_image(&c,0xde1,0,0x8c00,4,4,1,32,(void *)1);
    assert(c.error==0x501&&!packet);reset(&c);
    puts("PASS: native Apple BGRA uploads, row-byte override, query isolation, padding, reset, palette border and bounds");
}
