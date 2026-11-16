// ES 1.1 uses the same native GLI dispatch ABI as ES 2, with a host
// fixed-function context. Client pointers remain guest addresses; upload
// their live bytes at draw time and transport VBO offsets as offsets.
// PointerData keeps stride as query metadata but packs each element,
// matching emugl's client-array encoder (including Android's ES1 path).
static void native_extensions(char *text)
{
    // iOS has no EGLImage handle API. Keep host-only EGL/Android tokens
    // out of its native extension string; IOSurface uses the GLI path.
    char *dst=text,*src=text;
    while(*src) {
        while(*src==' ')src++;
        char *start=src;while(*src && *src!=' ')src++;
        unsigned n=src-start;
        if(n && !(n>=16 && !memcmp(start,"GL_OES_EGL_image",16)) &&
            !(n>=12 && !memcmp(start,"ANDROID_EMU_",12))) {
            if(dst!=text)*dst++=' ';
            while(n--)*dst++=*start++;
        }
    }
    *dst=0;
}

static unsigned fixed_slot(struct context *ctx, unsigned array)
{
    switch(array) {
        case 0x8074: return 0; case 0x8076: return 1;
        case 0x8075: return 2; case 0x8b9c: return 3;
        case 0x8078: return 4 + ctx->client_texture;
        default: return ~0u;
    }
}
static void fixed_client_texture(struct context *ctx, unsigned unit)
{
    if(unit < 0x84c0 || unit - 0x84c0 >= ctx->texture_limit) { draw_error(ctx,0x500); return; }
    ctx->client_texture = unit - 0x84c0;
    ctx->driver.ok &= SEND(ctx->driver.connection, gles1_glClientActiveTexture, unit);
}
static void fixed_client_state(struct context *ctx, unsigned array, int enabled)
{
    unsigned slot = fixed_slot(ctx,array);
    if(slot == ~0u) { draw_error(ctx,0x500); return; }
    ctx->fixed_arrays[slot].enabled = enabled;
    ctx->driver.ok &= SEND(ctx->driver.connection, enabled ? gles1_glEnableClientState : gles1_glDisableClientState, array);
}
static void fixed_enable(struct context *ctx,unsigned array) { fixed_client_state(ctx,array,1); }
static void fixed_disable(struct context *ctx,unsigned array) { fixed_client_state(ctx,array,0); }

static int fixed_array_packet(struct context *ctx,unsigned slot,unsigned vertices)
{
    const struct client_attrib *a = ctx->fixed_arrays + slot;
    static const unsigned ops[] = { gles1_glVertexPointerData, gles1_glColorPointerData,
        gles1_glNormalPointerData, gles1_glPointSizePointerData, gles1_glTexCoordPointerData };
    unsigned fields[4], count = 0, index = slot < 4 ? slot : 4;
    if(slot >= 4) fields[count++] = slot - 4;
    if(slot < 2 || slot >= 4) fields[count++] = a->size;
    fields[count++] = a->type; fields[count++] = a->stride;
    unsigned element = a->size * component_bytes(a->type), stride = a->stride ? (unsigned)a->stride : element;
    unsigned length = 0, span, last;
    if(vertices && (!a->data || __builtin_mul_overflow(vertices, element, &length) || length > N90_MAX_PAYLOAD ||
        __builtin_mul_overflow(vertices - 1, stride, &span) || __builtin_add_overflow(span, element - 1, &last) ||
        __builtin_add_overflow((unsigned)(usize)a->data, last, &last)))
    { draw_error(ctx,a->data ? 0x505 : 0x502); return 0; }
    const unsigned head = (count + 3) * 4, bytes = head + length + 4;
    unsigned *p = draw_packet(ctx,ops[index],bytes); if(!p) return 0;
    memcpy(p+2,fields,count*4);p[count+2]=length;
    if(length) {
        if(stride == element)memcpy((unsigned char *)p+head,a->data,length);
        else for(unsigned i=0;i<vertices;i++)memcpy((unsigned char *)p+head+i*element,(const unsigned char *)a->data+i*stride,element);
    }
    memcpy((unsigned char *)p+head+length,&length,4);
    send_draw_packet(ctx,p,bytes);return ctx->driver.ok;
}
static void fixed_pointer(struct context *ctx,unsigned slot,int size,unsigned type,int stride,const void *data)
{
    if(stride < 0 || ((slot == 0 || slot >= 4) && (size < 2 || size > 4)) || (slot == 1 && size != 4))
    { draw_error(ctx,0x501);return; }
    int position_type = type == 0x1400 || type == 0x1402 || type == 0x1406 || type == 0x140c;
    int valid = slot == 1 ? type == 0x1401 || type == 0x1406 || type == 0x140c :
        slot == 3 ? type == 0x1406 || type == 0x140c : position_type;
    if(!valid) { draw_error(ctx,0x500);return; }
    int buffer = 0;if(!integer_value(ctx,0x8894,&buffer)) { ctx->driver.ok=0;return; }
    struct client_attrib *a=ctx->fixed_arrays+slot;
    a->data=data;a->type=type;a->size=size;a->stride=stride;a->client=!buffer;
    if(!buffer) { fixed_array_packet(ctx,slot,0);return; }
    unsigned opcode;
    if(slot >= 4) opcode=gles1_glTexCoordPointerOffset;
    else {static const unsigned ops[]={gles1_glVertexPointerOffset,gles1_glColorPointerOffset,gles1_glNormalPointerOffset,gles1_glPointSizePointerOffset};opcode=ops[slot];}
    if(slot < 2 || slot >= 4) ctx->driver.ok &= SEND(ctx->driver.connection,opcode,size,type,stride,(unsigned)(usize)data);
    else ctx->driver.ok &= SEND(ctx->driver.connection,opcode,type,stride,(unsigned)(usize)data);
}
static void fixed_vertex(struct context *c,int n,unsigned t,int s,const void *p) { fixed_pointer(c,0,n,t,s,p); }
static void fixed_color(struct context *c,int n,unsigned t,int s,const void *p) { fixed_pointer(c,1,n,t,s,p); }
static void fixed_normal(struct context *c,unsigned t,int s,const void *p) { fixed_pointer(c,2,3,t,s,p); }
static void fixed_point_size(struct context *c,unsigned t,int s,const void *p) { fixed_pointer(c,3,1,t,s,p); }
static void fixed_texcoord(struct context *c,int n,unsigned t,int s,const void *p) { fixed_pointer(c,4+c->client_texture,n,t,s,p); }
static int send_fixed_arrays(struct context *ctx,unsigned vertices)
{
    for(unsigned i=0;i<4+ctx->texture_limit;i++)
        if(ctx->fixed_arrays[i].enabled && ctx->fixed_arrays[i].client && !fixed_array_packet(ctx,i,vertices))return 0;
    return 1;
}
static void fixed_get_pointer(struct context *ctx,unsigned pname,void **out)
{
    unsigned array;
    switch(pname) {
        case 0x808e:array=0x8074;break;case 0x808f:array=0x8075;break;
        case 0x8090:array=0x8076;break;case 0x8092:array=0x8078;break;
        case 0x898c:array=0x8b9c;break;
        default:draw_error(ctx,0x500);return;
    }
    if(!out) {draw_error(ctx,0x501);return;}
    *out=(void *)ctx->fixed_arrays[fixed_slot(ctx,array)].data;
}

// Every core vector form has a bounded, pname-dependent size. Output
// pointers are guest-local and only their byte counts cross the transport.
static unsigned fixed_vector_count(unsigned pname)
{
    switch(pname) {
        case 0x1200:case 0x1201:case 0x1202:case 0x1203:case 0x1600:case 0x1602:
        case 0xb53:case 0xb66:case 0x2201:case 0x8b9d:return 4;
        case 0x1204:case 0x8129:return 3;
        default:return 1;
    }
}
static void fixed_vector(struct context *ctx,unsigned opcode,const unsigned *args,unsigned count,void *data,unsigned words,int output)
{
    if(!data) {draw_error(ctx,0x501);return;}
    unsigned size=words*4,head=(count+3)*4,bytes=head+(output?0:size);
    unsigned *p=draw_packet(ctx,opcode,bytes);if(!p)return;
    memcpy(p+2,args,count*4);p[count+2]=size;
    if(!output)memcpy(p+count+3,data,size);
    send_draw_packet(ctx,p,bytes);
    if(output && !gles_read(ctx->driver.connection,data,size))ctx->driver.ok=0;
}
#define FIXED_VECTOR0(name,words) \
static void fixed_##name(struct context *c,void *v) {fixed_vector(c,gles1_##name,0,0,v,words,0);}
#define FIXED_VECTOR1(name,words,out) \
static void fixed_##name(struct context *c,unsigned p,void *v) {fixed_vector(c,gles1_##name,&p,1,v,words,out);}
#define FIXED_VECTOR2(name,out) \
static void fixed_##name(struct context *c,unsigned a,unsigned p,void *v) {unsigned args[]={a,p};fixed_vector(c,gles1_##name,args,2,v,fixed_vector_count(p),out);}
FIXED_VECTOR0(glLoadMatrixf,16) FIXED_VECTOR0(glLoadMatrixx,16)
FIXED_VECTOR0(glMultMatrixf,16) FIXED_VECTOR0(glMultMatrixx,16)
FIXED_VECTOR1(glClipPlanef,4,0) FIXED_VECTOR1(glClipPlanex,4,0)
FIXED_VECTOR1(glGetClipPlanef,4,1) FIXED_VECTOR1(glGetClipPlanex,4,1)
FIXED_VECTOR1(glFogfv,fixed_vector_count(p),0) FIXED_VECTOR1(glFogxv,fixed_vector_count(p),0)
FIXED_VECTOR1(glLightModelfv,fixed_vector_count(p),0) FIXED_VECTOR1(glLightModelxv,fixed_vector_count(p),0)
FIXED_VECTOR1(glPointParameterfv,fixed_vector_count(p),0) FIXED_VECTOR1(glPointParameterxv,fixed_vector_count(p),0)
FIXED_VECTOR2(glLightfv,0) FIXED_VECTOR2(glLightxv,0)
FIXED_VECTOR2(glMaterialfv,0) FIXED_VECTOR2(glMaterialxv,0)
FIXED_VECTOR2(glTexEnvfv,0) FIXED_VECTOR2(glTexEnviv,0) FIXED_VECTOR2(glTexEnvxv,0)
FIXED_VECTOR2(glTexParameterfv,0) FIXED_VECTOR2(glTexParameteriv,0) FIXED_VECTOR2(glTexParameterxv,0)
FIXED_VECTOR2(glGetLightfv,1) FIXED_VECTOR2(glGetLightxv,1)
FIXED_VECTOR2(glGetMaterialfv,1) FIXED_VECTOR2(glGetMaterialxv,1)
FIXED_VECTOR2(glGetTexEnvfv,1) FIXED_VECTOR2(glGetTexEnviv,1) FIXED_VECTOR2(glGetTexEnvxv,1)
FIXED_VECTOR2(glGetTexParameterfv,1) FIXED_VECTOR2(glGetTexParameteriv,1) FIXED_VECTOR2(glGetTexParameterxv,1)
FIXED_VECTOR2(glGetBufferParameteriv,1)
#undef FIXED_VECTOR0
#undef FIXED_VECTOR1
#undef FIXED_VECTOR2
static void fixed_get_fixed(struct context *c,unsigned p,void *out) {state_query(c,p,out,gles1_glGetFixedv,4);}
static void fixed_attachment_query(struct context *c,unsigned t,unsigned a,unsigned p,int *out)
{
    if(!out) {draw_error(c,0x501);return;}
    if(!SEND(c->driver.connection,gles1_glGetFramebufferAttachmentParameterivOES,t,a,p,4) ||
        !gles_read(c->driver.connection,out,4))c->driver.ok=0;
}
#define FIXED_DRAW_VECTOR(name,type) \
static void fixed_##name(struct context *c,const type *v) { \
    if(!v) {draw_error(c,0x501);return;} \
    unsigned n=5*sizeof(type),*p=draw_packet(c,gles1_##name,12+n);if(!p)return; \
    p[2]=n;memcpy(p+3,v,n);send_draw_packet(c,p,12+n); }
FIXED_DRAW_VECTOR(glDrawTexfvOES,float) FIXED_DRAW_VECTOR(glDrawTexivOES,int)
FIXED_DRAW_VECTOR(glDrawTexxvOES,int) FIXED_DRAW_VECTOR(glDrawTexsvOES,short)
#undef FIXED_DRAW_VECTOR

static void install_fixed_functions(driver_word *table)
{
#define F(name) table[N90_##name-5]=(driver_word)fixed_##name;
    table[N90_glClientActiveTexture-5]=(driver_word)fixed_client_texture;
    table[N90_glEnableClientState-5]=(driver_word)fixed_enable;
    table[N90_glDisableClientState-5]=(driver_word)fixed_disable;
    table[N90_glVertexPointer-5]=(driver_word)fixed_vertex;
    table[N90_glColorPointer-5]=(driver_word)fixed_color;
    table[N90_glNormalPointer-5]=(driver_word)fixed_normal;
    table[N90_glTexCoordPointer-5]=(driver_word)fixed_texcoord;
    table[N90_glPointSizePointerOES-5]=(driver_word)fixed_point_size;
    table[N90_glGetPointerv-5]=(driver_word)fixed_get_pointer;
    F(glLoadMatrixf) F(glLoadMatrixx) F(glMultMatrixf) F(glMultMatrixx)
    F(glClipPlanef) F(glClipPlanex) F(glGetClipPlanef) F(glGetClipPlanex)
    F(glFogfv) F(glFogxv) F(glLightModelfv) F(glLightModelxv)
    F(glPointParameterfv) F(glPointParameterxv) F(glLightfv) F(glLightxv)
    F(glMaterialfv) F(glMaterialxv) F(glTexEnvfv) F(glTexEnviv) F(glTexEnvxv)
    F(glTexParameterfv) F(glTexParameteriv) F(glTexParameterxv)
    F(glGetLightfv) F(glGetLightxv) F(glGetMaterialfv) F(glGetMaterialxv)
    F(glGetTexEnvfv) F(glGetTexEnviv) F(glGetTexEnvxv)
    F(glGetTexParameterfv) F(glGetTexParameteriv) F(glGetTexParameterxv)
    F(glGetBufferParameteriv)
    table[N90_glGetFixedv-5]=(driver_word)fixed_get_fixed;
    table[N90_glGetFramebufferAttachmentParameterivOES-5]=(driver_word)fixed_attachment_query;
    F(glDrawTexfvOES) F(glDrawTexivOES) F(glDrawTexxvOES) F(glDrawTexsvOES)
#undef F
}
