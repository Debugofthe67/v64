/* Original D3D9 HAL 16-bit UNORM and float-texture/filter control. No proxy or driver patch. */
#define WIN32_LEAN_AND_MEAN
#define COBJMACROS
#include <windows.h>
#include <d3d9.h>

static HANDLE output;
static void zero(void *p, UINT n) { BYTE *b=p;while(n--)*b++=0; }
static void report(const char *label, DWORD value)
{
    DWORD n;char line[96];UINT at=0;const char hex[]="0123456789abcdef";
    while(*label)line[at++]=*label++;
    line[at++]='=';
    for(int i=7;i>=0;i--)line[at++]=hex[value>>(i*4)&15];
    line[at++]='\r';line[at++]='\n';WriteFile(output,line,at,&n,0);FlushFileBuffers(output);
}

void WINAPI entry(void)
{
    output=CreateFileA("D:\\NVFLOAT.TXT",GENERIC_WRITE,FILE_SHARE_READ|FILE_SHARE_WRITE,0,CREATE_ALWAYS,0,0);
    if(output==INVALID_HANDLE_VALUE)ExitProcess(1);
    HMODULE library=LoadLibraryA("d3d9.dll");
    typedef IDirect3D9 *(WINAPI *create_t)(UINT);
    union { FARPROC raw; create_t call; } symbol;
    symbol.raw=library?GetProcAddress(library,"Direct3DCreate9"):0;
    IDirect3D9 *d3d=symbol.call?symbol.call(D3D_SDK_VERSION):0;
    IDirect3DDevice9 *device=0;IDirect3DSurface9 *target=0,*readback=0;
    IDirect3DPixelShader9 *shader=0,*scalar_shader=0;HWND window=0;DWORD failures=0;
    if(!d3d){report("NO_RUNTIME",1);failures++;goto done;}
    window=CreateWindowExA(0,"STATIC","Native float texture control",WS_OVERLAPPEDWINDOW,
        0,0,160,160,0,0,GetModuleHandleA(0),0);
    ShowWindow(window,SW_SHOW);UpdateWindow(window);
    D3DDISPLAYMODE mode;IDirect3D9_GetAdapterDisplayMode(d3d,0,&mode);
    D3DPRESENT_PARAMETERS present;zero(&present,sizeof(present));
    present.BackBufferWidth=64;present.BackBufferHeight=64;present.BackBufferFormat=mode.Format;
    present.BackBufferCount=1;present.SwapEffect=D3DSWAPEFFECT_DISCARD;
    present.Windowed=TRUE;present.hDeviceWindow=window;
    HRESULT hr=IDirect3D9_CreateDevice(d3d,0,D3DDEVTYPE_HAL,window,
        D3DCREATE_SOFTWARE_VERTEXPROCESSING|D3DCREATE_FPU_PRESERVE,&present,&device);
    report("DEVICE",hr);if(FAILED(hr)){failures++;goto done;}
    hr=IDirect3DDevice9_GetRenderTarget(device,0,&target);
    report("TARGET",hr);if(FAILED(hr)){failures++;goto done;}
    hr=IDirect3DDevice9_CreateOffscreenPlainSurface(device,64,64,mode.Format,D3DPOOL_SYSTEMMEM,&readback,0);
    report("READBACK_SURFACE",hr);if(FAILED(hr)){failures++;goto done;}
    const DWORD program[]={0xffff0300,
        0x0200001f,0x80000005,0x90030000,
        0x0200001f,0x90000000,0xa00f0800,
        0x03000042,0x800f0000,0x90e40000,0xa0e40800,
        0x02000001,0x800f0800,0x80e40000,0xffff};
    hr=IDirect3DDevice9_CreatePixelShader(device,program,&shader);
    report("CREATE_SHADER",hr);if(FAILED(hr)){failures++;goto done;}
    DWORD scalar_program[sizeof(program)/sizeof(program[0])];
    for(UINT i=0;i<sizeof(program)/sizeof(program[0]);i++)scalar_program[i]=program[i];
    scalar_program[13]=0x80000000; /* Replicate sampled R, independent of missing-channel defaults. */
    hr=IDirect3DDevice9_CreatePixelShader(device,scalar_program,&scalar_shader);
    report("CREATE_SCALAR_SHADER",hr);if(FAILED(hr)){failures++;goto done;}
    IDirect3DDevice9_SetPixelShader(device,shader);
    IDirect3DDevice9_SetRenderState(device,D3DRS_LIGHTING,FALSE);
    IDirect3DDevice9_SetRenderState(device,D3DRS_CULLMODE,D3DCULL_NONE);
    IDirect3DDevice9_SetRenderState(device,D3DRS_ZENABLE,FALSE);
    IDirect3DDevice9_SetRenderState(device,D3DRS_ALPHABLENDENABLE,FALSE);
    IDirect3DDevice9_SetFVF(device,D3DFVF_XYZRHW|D3DFVF_TEX1);
    IDirect3DDevice9_SetSamplerState(device,0,D3DSAMP_ADDRESSU,D3DTADDRESS_CLAMP);
    IDirect3DDevice9_SetSamplerState(device,0,D3DSAMP_ADDRESSV,D3DTADDRESS_CLAMP);
    IDirect3DDevice9_SetSamplerState(device,0,D3DSAMP_MIPFILTER,D3DTEXF_NONE);
    struct vertex {float x,y,z,w,u,v;} vertices[3]={{0,0,0,1,.375f,.375f},
        {0,128,0,1,.375f,.375f},{128,0,0,1,.375f,.375f}};
    const WORD values[]={0x3000,0x3400,0x3800,0x3c00}; /* .125,.25,.5,1 */
    const float full_values[]={.125f,.25f,.5f,1};
    const WORD unorm_values[]={8192,16384,32768,65535};
    const UINT formats[]={34,36,111,112,113,114,115,116};
    for(UINT test=0;test<sizeof(formats)/sizeof(formats[0]);test++)
    {
        UINT format=formats[test],channels=format==36||format==113||format==116?4:format==34||format==112||format==115?2:1;
        IDirect3DDevice9_SetPixelShader(device,shader);
        IDirect3DTexture9 *texture=0;report("FORMAT",format);
        hr=IDirect3D9_CheckDeviceFormat(d3d,0,D3DDEVTYPE_HAL,mode.Format,0,D3DRTYPE_TEXTURE,(D3DFORMAT)format);
        report("TEXTURE_CAPS",hr);
        if(FAILED(hr)){report("SKIPPED_UNSUPPORTED_FORMAT",format);continue;}
        hr=IDirect3DDevice9_CreateTexture(device,4,4,1,0,(D3DFORMAT)format,D3DPOOL_MANAGED,&texture,0);
        report("CREATE_TEXTURE",hr);if(FAILED(hr)){failures++;continue;}
        D3DLOCKED_RECT locked;hr=IDirect3DTexture9_LockRect(texture,0,&locked,0,0);
        report("LOCK_TEXTURE",hr);
        if(FAILED(hr)){failures++;IDirect3DTexture9_Release(texture);continue;}
        report("SOURCE_PITCH",locked.Pitch);
        for(UINT y=0;y<4;y++)for(UINT x=0;x<4;x++)for(UINT c=0;c<channels;c++)
        {
            if(format>=114)*(float*)((BYTE*)locked.pBits+y*locked.Pitch+(x*channels+c)*4)=full_values[c];
            else *(WORD*)((BYTE*)locked.pBits+y*locked.Pitch+(x*channels+c)*2)=format<111?unorm_values[c]:values[c];
        }
        IDirect3DTexture9_UnlockRect(texture,0);
        IDirect3DDevice9_SetTexture(device,0,(IDirect3DBaseTexture9*)texture);
        for(UINT filter=1;filter<=(format>=114?1U:2U);filter++)
        {
            report("FILTER",filter);
            IDirect3DDevice9_SetSamplerState(device,0,D3DSAMP_MINFILTER,filter);
            IDirect3DDevice9_SetSamplerState(device,0,D3DSAMP_MAGFILTER,filter);
            IDirect3DDevice9_Clear(device,0,0,D3DCLEAR_TARGET,0xff102030,1,0);
            hr=IDirect3DDevice9_BeginScene(device);
            if(SUCCEEDED(hr))
            {
                hr=IDirect3DDevice9_DrawPrimitiveUP(device,D3DPT_TRIANGLELIST,1,vertices,sizeof(vertices[0]));
                IDirect3DDevice9_EndScene(device);
            }
            report("DRAW",hr);if(FAILED(hr))failures++;
            hr=IDirect3DDevice9_GetRenderTargetData(device,target,readback);report("READBACK",hr);
            if(FAILED(hr))failures++;
            else
            {
                hr=IDirect3DSurface9_LockRect(readback,&locked,0,D3DLOCK_READONLY);report("LOCK",hr);
                if(FAILED(hr))failures++;
                else
                {
                    DWORD pixel=*(DWORD*)((BYTE*)locked.pBits+16*locked.Pitch+16*4);report("PIXEL",pixel);
                    DWORD expected=channels==1?0x0020ffff:channels==2?0x002040ff:0x00204080;
                    report("EXPECTED_RGB",expected);
                    for(UINT c=0;c<3;c++)
                    {
                        int delta=(int)(pixel>>(c*8)&255)-(int)(expected>>(c*8)&255);
                        if(delta < -1 || delta > 1)failures++;
                    }
                    IDirect3DSurface9_UnlockRect(readback);
                }
            }
            Sleep(500);
        }
        IDirect3DDevice9_SetTexture(device,0,0);IDirect3DTexture9_Release(texture);
    }
done:
    report("FAILURES",failures);
    if(scalar_shader)IDirect3DPixelShader9_Release(scalar_shader);
    if(shader)IDirect3DPixelShader9_Release(shader);
    if(readback)IDirect3DSurface9_Release(readback);
    if(target)IDirect3DSurface9_Release(target);
    if(device)IDirect3DDevice9_Release(device);
    if(d3d)IDirect3D9_Release(d3d);
    if(window)DestroyWindow(window);
    CloseHandle(output);ExitProcess(failures?1:0);
}
