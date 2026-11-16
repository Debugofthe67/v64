/* Native D3D9 HAL compiler/readback control. No proxy or driver patch. */
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
    output=CreateFileA("D:\\NVSAT.TXT",GENERIC_WRITE,FILE_SHARE_READ|FILE_SHARE_WRITE,0,CREATE_ALWAYS,0,0);
    if(output==INVALID_HANDLE_VALUE)ExitProcess(1);
    HMODULE library=LoadLibraryA("d3d9.dll");
    typedef IDirect3D9 *(WINAPI *create_t)(UINT);
    union { FARPROC raw; create_t call; } symbol;
    symbol.raw=library?GetProcAddress(library,"Direct3DCreate9"):0;
    create_t create=symbol.call;
    IDirect3D9 *d3d=create?create(D3D_SDK_VERSION):0;
    IDirect3DDevice9 *device=0;IDirect3DSurface9 *target=0,*readback=0;
    HWND window=0;DWORD failures=0;
    if(!d3d){report("NO_RUNTIME",1);goto done;}
    window=CreateWindowExA(0,"STATIC","Native shader saturation control",WS_OVERLAPPEDWINDOW,
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
    IDirect3DDevice9_SetRenderState(device,D3DRS_LIGHTING,FALSE);
    IDirect3DDevice9_SetRenderState(device,D3DRS_CULLMODE,D3DCULL_NONE);
    IDirect3DDevice9_SetRenderState(device,D3DRS_ZENABLE,FALSE);
    IDirect3DDevice9_SetRenderState(device,D3DRS_ALPHABLENDENABLE,FALSE);
    IDirect3DDevice9_SetFVF(device,D3DFVF_XYZRHW);
    const float constants[3][4]={{-.5f,.25f,1.5f,-.5f},{.25f,.25f,-.25f,.25f},{1,0,0,1}};
    IDirect3DDevice9_SetPixelShaderConstantF(device,0,constants[0],3);
    const DWORD full[]={0xffff0300,0x02000001,0x801f0000,0xa0e40000,
        0x03000002,0x800f0800,0x80e40000,0xa0e40001,0xffff};
    const DWORD partial[]={0xffff0300,0x02000001,0x803f0000,0xa0e40000,
        0x03000002,0x800f0800,0x80e40000,0xa0e40001,0xffff};
    const DWORD dot_move[]={0xffff0300,0x02000001,0x800f0002,0xa0e40002,
        0x03000008,0x80280000,0xa0e40000,0x80e40002,
        0x02000001,0x80380000,0x80ff0000,
        0x03000002,0x800f0800,0x80ff0000,0xa0e40001,0xffff};
    const DWORD dot_multiply[]={0xffff0300,0x02000001,0x800f0002,0xa0e40002,
        0x03000008,0x80280000,0xa0e40000,0x80e40002,
        0x03000005,0x80380000,0x80ff0000,0xa0000002,
        0x03000002,0x800f0800,0x80ff0000,0xa0e40001,0xffff};
    const DWORD *programs[]={full,partial,dot_move,dot_multiply};
    const DWORD expected[]={0x004080bf,0x004080bf,0x00404000,0x00404000};
    struct vertex {float x,y,z,w;} vertices[3]={{0,0,0,1},{0,128,0,1},{128,0,0,1}};
    for(UINT test=0;test<4;test++)
    {
        IDirect3DPixelShader9 *shader=0;report("CASE",test);
        hr=IDirect3DDevice9_CreatePixelShader(device,programs[test],&shader);
        report("CREATE_SHADER",hr);if(FAILED(hr)){failures++;continue;}
        IDirect3DDevice9_SetPixelShader(device,shader);
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
            D3DLOCKED_RECT locked;hr=IDirect3DSurface9_LockRect(readback,&locked,0,D3DLOCK_READONLY);
            report("LOCK",hr);
            if(FAILED(hr))failures++;
            else
            {
                DWORD pixel=*(DWORD*)((BYTE*)locked.pBits+16*locked.Pitch+16*4);
                report("PIXEL",pixel);report("EXPECTED_RGB",expected[test]);
                for(UINT lane=0;lane<3;lane++)
                {
                    int delta=(int)(pixel>>(lane*8)&255)-(int)(expected[test]>>(lane*8)&255);
                    if(delta < -1 || delta > 1)failures++;
                }
                IDirect3DSurface9_UnlockRect(readback);
            }
        }
        IDirect3DDevice9_SetPixelShader(device,0);IDirect3DPixelShader9_Release(shader);
        Sleep(500);
    }
done:
    report("FAILURES",failures);
    if(readback)IDirect3DSurface9_Release(readback);
    if(target)IDirect3DSurface9_Release(target);
    if(device)IDirect3DDevice9_Release(device);
    if(d3d)IDirect3D9_Release(d3d);
    if(window)DestroyWindow(window);
    if(library)FreeLibrary(library);
    CloseHandle(output);ExitProcess(failures?1:0);
}
