/* Standalone native D3D8 compiler probe. The unmodified runtime and NVIDIA
 * driver compile SPEC with two eye constants, then variable-eye VSPEC.
 * API success alone is not rendering acceptance: inspect PGRAPH/GPU traces. */
#define WIN32_LEAN_AND_MEAN
#define COBJMACROS
#include <windows.h>
#include <d3d8.h>
static HANDLE log_file;
static void zero(void*p,UINT n){BYTE*b=p;while(n--)*b++=0;}
static void text(const char*s){DWORD n;WriteFile(log_file,s,lstrlenA(s),&n,0);FlushFileBuffers(log_file);}
static void result(const char*s,DWORD v){char b[11];const char*h="0123456789abcdef";b[0]='0';b[1]='x';for(int i=0;i<8;i++)b[i+2]=h[v>>(28-4*i)&15];b[10]=0;text(s);text(b);text("\r\n");}
void WINAPI entry(void){
 log_file=CreateFileA("D:\\NVSPEC.TXT",GENERIC_WRITE,FILE_SHARE_READ,0,CREATE_ALWAYS,0,0);text("BEGIN NATIVE D3D8 SPEC PROBE\r\n");
 HMODULE dll=LoadLibraryA("d3d8.dll");typedef IDirect3D8*(WINAPI*create_t)(UINT);create_t create=dll?(create_t)GetProcAddress(dll,"Direct3DCreate8"):0;
 IDirect3D8*d=create?create(D3D_SDK_VERSION):0;IDirect3DDevice8*dev=0;IDirect3DTexture8*normal=0;IDirect3DCubeTexture8*cube=0;
 if(!d){text("NO D3D8\r\n");goto done;}
 HWND window=CreateWindowExA(0,"STATIC","Native unmodified D3D8 compiler",WS_OVERLAPPEDWINDOW,0,0,160,160,0,0,GetModuleHandleA(0),0);ShowWindow(window,SW_SHOW);UpdateWindow(window);
 D3DPRESENT_PARAMETERS pp;D3DDISPLAYMODE dm;zero(&pp,sizeof(pp));IDirect3D8_GetAdapterDisplayMode(d,0,&dm);pp.BackBufferWidth=64;pp.BackBufferHeight=64;pp.BackBufferFormat=dm.Format;pp.BackBufferCount=1;pp.SwapEffect=D3DSWAPEFFECT_DISCARD;pp.Windowed=TRUE;pp.hDeviceWindow=window;
 HRESULT hr=IDirect3D8_CreateDevice(d,0,D3DDEVTYPE_HAL,window,D3DCREATE_SOFTWARE_VERTEXPROCESSING|D3DCREATE_FPU_PRESERVE,&pp,&dev);result("DEVICE=",hr);if(FAILED(hr))goto done;
 hr=IDirect3DDevice8_CreateTexture(dev,4,4,1,0,D3DFMT_A8R8G8B8,D3DPOOL_MANAGED,&normal);result("NORMAL=",hr);if(FAILED(hr))goto done;
 D3DLOCKED_RECT lock;IDirect3DTexture8_LockRect(normal,0,&lock,0,0);for(int y=0;y<4;y++)for(int x=0;x<4;x++)*(DWORD*)((BYTE*)lock.pBits+y*lock.Pitch+x*4)=0xFF8080FF;IDirect3DTexture8_UnlockRect(normal,0);
 hr=IDirect3DDevice8_CreateCubeTexture(dev,4,1,0,D3DFMT_A8R8G8B8,D3DPOOL_MANAGED,&cube);result("CUBE=",hr);if(FAILED(hr))goto done;
 const DWORD colors[]={0xffff0000,0xff00ff00,0xff0000ff,0xffffff00,0xffff00ff,0xff00ffff};
 for(int f=0;f<6;f++){IDirect3DCubeTexture8_LockRect(cube,(D3DCUBEMAP_FACES)f,0,&lock,0,0);for(int y=0;y<4;y++)for(int x=0;x<4;x++)*(DWORD*)((BYTE*)lock.pBits+y*lock.Pitch+x*4)=colors[f];IDirect3DCubeTexture8_UnlockRect(cube,(D3DCUBEMAP_FACES)f,0);}
 IDirect3DDevice8_SetTexture(dev,0,(IDirect3DBaseTexture8*)normal);IDirect3DDevice8_SetTexture(dev,3,(IDirect3DBaseTexture8*)cube);
 struct vertex{float x,y,z,rhw;DWORD color;float t[4][4];}v[3];zero(v,sizeof(v));
 for(int i=0;i<3;i++){v[i].x=i==2?128:0;v[i].y=i==1?128:0;v[i].rhw=1;v[i].color=0xffffffff;v[i].t[0][0]=v[i].t[0][1]=.25f;for(int k=1;k<4;k++){v[i].t[k][k-1]=1;v[i].t[k][3]=(float)k*.25f;}}
 IDirect3DDevice8_SetVertexShader(dev,D3DFVF_XYZRHW|D3DFVF_DIFFUSE|D3DFVF_TEX4|D3DFVF_TEXCOORDSIZE4(0)|D3DFVF_TEXCOORDSIZE4(1)|D3DFVF_TEXCOORDSIZE4(2)|D3DFVF_TEXCOORDSIZE4(3));
 IDirect3DDevice8_SetRenderState(dev,D3DRS_LIGHTING,FALSE);IDirect3DDevice8_SetRenderState(dev,D3DRS_CULLMODE,D3DCULL_NONE);IDirect3DDevice8_SetRenderState(dev,D3DRS_ZENABLE,FALSE);
 const DWORD spec[]={0xffff0101,D3DSIO_TEX,0xb00f0000,D3DSIO_TEXM3x3PAD,0xb00f0001,0xb0e40000,D3DSIO_TEXM3x3PAD,0xb00f0002,0xb0e40000,D3DSIO_TEXM3x3SPEC,0xb00f0003,0xb0e40000,0xa0e40000,D3DSIO_MOV,0x800f0000,0xb0e40003,D3DSIO_END};
 const DWORD vspec[]={0xffff0101,D3DSIO_TEX,0xb00f0000,D3DSIO_TEXM3x3PAD,0xb00f0001,0xb0e40000,D3DSIO_TEXM3x3PAD,0xb00f0002,0xb0e40000,D3DSIO_TEXM3x3VSPEC,0xb00f0003,0xb0e40000,D3DSIO_MOV,0x800f0000,0xb0e40003,D3DSIO_END};
 for(int test=0;test<3;test++){DWORD shader=0;result("CASE=",test);float eye[4]={test?.5f:.25f,.5f,1,1};hr=IDirect3DDevice8_CreatePixelShader(dev,test==2?vspec:spec,&shader);result("CREATE_SHADER=",hr);if(FAILED(hr))continue;IDirect3DDevice8_SetPixelShaderConstant(dev,0,eye,1);IDirect3DDevice8_SetPixelShader(dev,shader);IDirect3DDevice8_Clear(dev,0,0,D3DCLEAR_TARGET,0xff102030,1,0);hr=IDirect3DDevice8_BeginScene(dev);if(SUCCEEDED(hr)){hr=IDirect3DDevice8_DrawPrimitiveUP(dev,D3DPT_TRIANGLELIST,1,v,sizeof(v[0]));IDirect3DDevice8_EndScene(dev);}result("DRAW=",hr);hr=IDirect3DDevice8_Present(dev,0,0,0,0);result("PRESENT=",hr);IDirect3DDevice8_SetPixelShader(dev,0);IDirect3DDevice8_DeletePixelShader(dev,shader);Sleep(500);}
done:
 text("END\r\n");if(cube)IDirect3DCubeTexture8_Release(cube);if(normal)IDirect3DTexture8_Release(normal);if(dev)IDirect3DDevice8_Release(dev);if(d)IDirect3D8_Release(d);CloseHandle(log_file);ExitProcess(0);
}
