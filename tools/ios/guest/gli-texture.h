// Copy native texture pointers into the transport. The host expands PVRTC1
// outside ARM emulation, then uploads the resulting RGBA8 texture.

static void pixel_store(struct context *ctx, unsigned pname, int value)
{
    // Apple client storage is an ownership optimization. Transport uploads
    // keep their own copy, so its boolean state need not reach the host.
    if(pname == 0x85b2) { ctx->client_storage = !!value; return; }
    if(pname == 0x8a16)
    {
        if(value < 0) draw_error(ctx, 0x501);
        else ctx->unpack_row_bytes = value;
        return;
    }
    ctx->driver.ok &= SEND(ctx->driver.connection, gles2_glPixelStorei, pname, value);
}

static unsigned texel_size(unsigned format, unsigned type)
{
    if(type == 0x8363 && format == 0x1907) return 2; // RGB565
    if((type == 0x8033 || type == 0x8034) && format == 0x1908) return 2;
    if(type != 0x1401) return 0;
    switch(format)
    {
        case 0x1906: case 0x1909: return 1;
        case 0x190a: return 2;
        case 0x1907: return 3;
        case 0x1908: case 0x80e1: return 4;
        default: return 0;
    }
}

static unsigned texture_stride(struct context *ctx, unsigned row)
{
    int align = 0;
    if(!integer_value(ctx, 0x0cf5, &align) || !(align == 1 || align == 2 || align == 4 || align == 8))
    {
        ctx->driver.ok = 0;
        return 0;
    }
    return (row + align - 1) & ~(unsigned)(align - 1);
}

static void texture_packet(struct context *ctx, unsigned op, const unsigned *fields, unsigned count,
    const void *data, unsigned size)
{
    const unsigned header = (count + 3) * 4;
    if(size > N90_MAX_PAYLOAD) { draw_error(ctx, 0x505); return; }
    unsigned *p = draw_packet(ctx, op, header + size);
    if(!p) return;
    memcpy(p + 2, fields, count * 4);
    p[2 + count] = size;
    if(size) memcpy(p + 3 + count, data, size);
    send_draw_packet(ctx, p, header + size);
}

static void upload_texture(struct context *ctx, unsigned op, const unsigned *fields, int w, int h,
    unsigned format, unsigned type, const void *data)
{
    if(w < 0 || h < 0 || w > 16384 || h > 16384) { draw_error(ctx, 0x501); return; }
    unsigned size = 0, texel = texel_size(format, type);
    void *packed = 0;
    // The host validates unsupported format/type pairs without dereferencing data.
    if(data && w && h && texel)
    {
        const unsigned row = w * texel, stride = texture_stride(ctx, row);
        if(!stride) return;
        size = (h - 1) * stride + row;
        if(size > N90_MAX_PAYLOAD) { draw_error(ctx, 0x505); return; }
        const unsigned source_stride = ctx->unpack_row_bytes ? ctx->unpack_row_bytes : stride;
        if(source_stride != stride)
        {
            unsigned span, last;
            if(__builtin_mul_overflow((unsigned)h - 1, source_stride, &span) ||
                __builtin_add_overflow(span, row - 1, &last) ||
                __builtin_add_overflow(last, (unsigned)(usize)data, &last))
            { draw_error(ctx, 0x501); return; }
            packed = calloc(1, size);
            if(!packed) { draw_error(ctx, 0x505); return; }
            for(int y = 0; y < h; y++)
                memcpy((unsigned char *)packed + y * stride, (const unsigned char *)data + y * source_stride, row);
            data = packed;
        }
    }
    texture_packet(ctx, op, fields, 8, data, size);
    free(packed);
}

static void tex_image(struct context *ctx, unsigned target, int level, int internal, int w, int h,
    int border, unsigned format, unsigned type, const void *data)
{
    // APPLE_texture_format_BGRA8888 uses RGBA internal + BGRA external.
    // The host's EXT variant requires BGRA for both; byte order is identical.
    if(internal == 0x1908 && format == 0x80e1 && type == 0x1401) internal = 0x80e1;
    const unsigned fields[] = { target, level, internal, w, h, border, format, type };
    upload_texture(ctx, gles2_glTexImage2D, fields, w, h, format, type, data);
}

static void tex_sub_image(struct context *ctx, unsigned target, int level, int x, int y, int w, int h,
    unsigned format, unsigned type, const void *data)
{
    const unsigned fields[] = { target, level, x, y, w, h, format, type };
    upload_texture(ctx, gles2_glTexSubImage2D, fields, w, h, format, type, data);
}

static void compressed_image(struct context *ctx, unsigned target, int level, unsigned format, int w, int h,
    int border, int size, const void *data)
{
    if(border) { draw_error(ctx,ctx->api == 1 && format >= 0x8b90 && format <= 0x8b99 ? 0x502 : 0x501);return; }
    if(size < 0) { draw_error(ctx, 0x501); return; }
    const unsigned fields[] = { target, level, format, w, h, border, size };
    texture_packet(ctx, gles2_glCompressedTexImage2D, fields, 7, data, data ? size : 0);
}

static void compressed_sub_image(struct context *ctx, unsigned target, int level, int x, int y, int w, int h,
    unsigned format, int size, const void *data)
{
    if(size < 0) { draw_error(ctx, 0x501); return; }
    const unsigned fields[] = { target, level, x, y, w, h, format, size };
    texture_packet(ctx, gles2_glCompressedTexSubImage2D, fields, 8, data, data ? size : 0);
}

static void install_texture_functions(driver_word *table)
{
    table[N90_glPixelStorei - 5] = (driver_word)pixel_store;
    table[N90_glTexImage2D - 5] = (driver_word)tex_image;
    table[N90_glTexSubImage2D - 5] = (driver_word)tex_sub_image;
    table[N90_glCompressedTexImage2D - 5] = (driver_word)compressed_image;
    table[N90_glCompressedTexSubImage2D - 5] = (driver_word)compressed_sub_image;
}
