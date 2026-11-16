// Native EAGL ES1 acceptance. All checks run through the public iOS API;
// no injected guest patches or renderer-side replacement of the picture.
extern void glMatrixMode(unsigned),glLoadIdentity(void),glOrthof(float,float,float,float,float,float);
extern void glTranslatex(int,int,int),glPushMatrix(void),glPopMatrix(void);
extern void glGetFloatv(unsigned,float *),glGetFixedv(unsigned,int *),glGetIntegerv(unsigned,int *);
extern void glVertexPointer(int,unsigned,int,const void *),glTexCoordPointer(int,unsigned,int,const void *);
extern void glColorPointer(int,unsigned,int,const void *),glEnableClientState(unsigned),glDisableClientState(unsigned);
extern void glColor4ub(unsigned char,unsigned char,unsigned char,unsigned char),glDrawElements(unsigned,int,unsigned,const void *);
extern void glGenBuffers(int,unsigned *),glBindBuffer(unsigned,unsigned),glBufferData(unsigned,int,const void *,unsigned),glDeleteBuffers(int,const unsigned *);
extern void glGenTextures(int,unsigned *),glBindTexture(unsigned,unsigned),glTexImage2D(unsigned,int,int,int,int,int,unsigned,unsigned,const void *);
extern void glTexParameteri(unsigned,unsigned,int),glTexParameteriv(unsigned,unsigned,const int *),glTexEnvi(unsigned,unsigned,int);
extern void glEnable(unsigned),glDisable(unsigned),glDrawTexivOES(const int *),glReadPixels(int,int,int,int,unsigned,unsigned,void *);
extern void glLightfv(unsigned,unsigned,const float *),glGetLightxv(unsigned,unsigned,int *);
extern void glCompressedTexImage2D(unsigned,int,unsigned,int,int,int,int,const void *);
static void draw(void *view)
{
    static void *context;static unsigned rb,fb;int width=320,height=300,step=1;
    if(!context) {
        context=send1(send0(objc_getClass("EAGLContext"),"alloc"),"initWithAPI:",(void *)1);
        send1(objc_getClass("EAGLContext"),"setCurrentContext:",context);
        glGenRenderbuffers(1,&rb);glBindRenderbuffer(0x8d41,rb);
        glGenFramebuffers(1,&fb);glBindFramebuffer(0x8d40,fb);
        glFramebufferRenderbuffer(0x8d40,0x8ce0,0x8d41,rb);
    }
    send1(objc_getClass("EAGLContext"),"setCurrentContext:",context);
    glBindRenderbuffer(0x8d41,rb);
    signed char storage=((signed char (*)(void *,void *,unsigned,void *))objc_msgSend)(context,
        sel_registerName("renderbufferStorage:fromDrawable:"),0x8d41,send0(view,"layer"));
    if(!storage)return;
    glBindFramebuffer(0x8d40,fb);
    glGetRenderbufferParameteriv(0x8d41,0x8d42,&width);glGetRenderbufferParameteriv(0x8d41,0x8d43,&height);
    if(glCheckFramebufferStatus(0x8d40)!=0x8cd5)goto failed;
    glViewport(0,0,width,height);glClearColor(0,0,0,1);glClear(0x4000);
    glMatrixMode(0x1701);glLoadIdentity();glOrthof(0,4,0,4,-1,1);
    glMatrixMode(0x1700);glLoadIdentity();glPushMatrix();glTranslatex(32768,65536,0);
    struct {int guard;int v[16];int end;} matrix={91,{0},92};
    glGetFixedv(0xba6,matrix.v);step=2;
    if(matrix.guard!=91||matrix.end!=92||matrix.v[12]!=32768||matrix.v[13]!=65536)goto failed;
    int bits[18];for(int i=0;i<18;i++)bits[i]=91;bits[17]=92;glGetIntegerv(0x898d,bits+1);
    if(bits[0]!=91||bits[17]!=92||bits[1]!=0x3f800000||bits[13]!=0x3f000000||bits[14]!=0x3f800000)goto failed;
    glPopMatrix();
    float light[]={0.25f,0.5f,0.75f,1};int result[6]={91,0,0,0,0,92};
    glLightfv(0x4000,0x1201,light);glGetLightxv(0x4000,0x1201,result+1);step=3;
    if(result[0]!=91||result[5]!=92||result[1]!=16384||result[2]!=32768||result[3]!=49152||result[4]!=65536)goto failed;
    // Interleaved short positions and UV, with an unused first vertex.
    const short vertices[]={99,99,99,99, 0,0,0,0, 2,0,1,0, 2,4,1,1, 0,0,0,0, 2,4,1,1, 0,4,0,1};
    glBindBuffer(0x8892,0);glVertexPointer(2,0x1402,8,vertices);
    glTexCoordPointer(2,0x1402,8,vertices+2);glEnableClientState(0x8074);glEnableClientState(0x8078);
    unsigned texture=0;glGenTextures(1,&texture);glBindTexture(0xde1,texture);
    glTexParameteri(0xde1,0x2800,0x2600);glTexParameteri(0xde1,0x2801,0x2600);
    const unsigned char white[]={255,255,255,255};glTexImage2D(0xde1,0,0x1908,1,1,0,0x1908,0x1401,white);
    glEnable(0xde1);glColor4ub(255,0,0,255);glDrawArrays(4,1,6);
    // Mixed vertex/element VBOs and a client color array. Index zero is unused.
    const float right[]={99,99, 2,0, 4,0, 4,4, 2,4};const unsigned short indices[]={99,1,2,3,1,3,4};
    const unsigned char blue[]={0,0,255,255,0,0,255,255,0,0,255,255,0,0,255,255,0,0,255,255};
    unsigned buffers[2];glGenBuffers(2,buffers);glBindBuffer(0x8892,buffers[0]);
    glBufferData(0x8892,sizeof(right),right,0x88e4);glVertexPointer(2,0x1406,0,0);
    glBindBuffer(0x8893,buffers[1]);glBufferData(0x8893,sizeof(indices),indices,0x88e4);
    glBindBuffer(0x8892,0);glColorPointer(4,0x1401,0,blue);glEnableClientState(0x8076);
    glDisableClientState(0x8078);glDisable(0xde1);glDrawElements(4,6,0x1403,(void *)2);
    glDisableClientState(0x8076);glDeleteBuffers(2,buffers);step=4;
    unsigned char red[4],b[4];glReadPixels(width/4,height/2,1,1,0x1908,0x1401,red);
    glReadPixels(3*width/4,height/4,1,1,0x1908,0x1401,b);
    if(red[0]!=255||red[1]||red[2]||b[0]||b[1]||b[2]!=255)goto failed;
    // Vector draw_texture, crop state and a modulating current color.
    int crop[]={0,0,1,1},rect[]={width/2,height/2,0,width/2,height/2};
    glBindTexture(0xde1,texture);glTexParameteriv(0xde1,0x8b9d,crop);
    glTexEnvi(0x2300,0x2200,0x2100);glEnable(0xde1);glColor4ub(0,255,255,255);glDrawTexivOES(rect);
    unsigned char cyan[4];glReadPixels(3*width/4,3*height/4,1,1,0x1908,0x1401,cyan);step=5;
    if(cyan[0]||cyan[1]!=255||cyan[2]!=255||glGetError())goto failed;
    // A compressed palette upload through the native pointer encoder,
    // followed by automatic mip generation and minified sampling.
    unsigned char palette[66]={255,0,0,255};int formats=0;
    glGetIntegerv(0x86a2,&formats);step=6;if(formats!=15)goto failed;
    glTexParameteri(0xde1,0x8191,1);glTexParameteri(0xde1,0x2801,0x2700);
    glCompressedTexImage2D(0xde1,0,0x8b91,2,2,0,sizeof(palette),palette);
    int small[]={0,0,0,1,1},full[]={0,0,2,2};glTexParameteriv(0xde1,0x8b9d,full);
    glColor4ub(255,255,255,255);glDrawTexivOES(small);
    glReadPixels(0,0,1,1,0x1908,0x1401,red);if(red[0]!=255||red[1]||red[2]||glGetError())goto failed;
    send1(context,"presentRenderbuffer:",(void *)0x8d41);
    CFStringRef text=string("ES1 PASS: matrix, light, arrays, VBO, texture, pixels");send1(label,"setText:",(void *)text);CFRelease(text);
    send1(label,"setNumberOfLines:",(void *)2);syslog(5,"V86 ES1 fixture PASS %dx%d",width,height);return;
failed:;
    char report[96];snprintf(report,sizeof(report),"ES1 FAIL step %d, error 0x%x",step,glGetError());
    CFStringRef error=string(report);send1(label,"setText:",(void *)error);CFRelease(error);syslog(5,"V86 %s",report);
}
