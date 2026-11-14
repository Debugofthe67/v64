/* Optional windowless native memory observation during long tests.
 * Stock Win9x/XP APIs only; no benchmark hooks, suspension or clock changes. */
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
static HANDLE output;
static void number(const char *label,DWORD value)
{
    static const char digits[]="0123456789abcdef";char line[12];DWORD written;
    line[0]='0';line[1]='x';for(unsigned i=0;i<8;i++)line[i+2]=digits[value>>(28-i*4)&15];
    line[10]='\r';line[11]='\n';
    WriteFile(output,label,(DWORD)lstrlenA(label),&written,0);WriteFile(output,"=",1,&written,0);
    WriteFile(output,line,sizeof(line),&written,0);
}
void __attribute__((stdcall)) entry(void)
{
    output=CreateFileA("D:\\NVMEM.TXT",GENERIC_WRITE,FILE_SHARE_READ|FILE_SHARE_WRITE,0,CREATE_ALWAYS,0,0);
    if(output==INVALID_HANDLE_VALUE)ExitProcess(2);
    const DWORD start=GetTickCount();
    for(DWORD sample=0;sample<360;sample++)
    {
        MEMORYSTATUS memory;memory.dwLength=sizeof(memory);GlobalMemoryStatus(&memory);
        number("SAMPLE",sample);number("ELAPSED_MS",GetTickCount()-start);
        number("MEMORY_LOAD_PERCENT",memory.dwMemoryLoad);
        number("TOTAL_PHYSICAL",memory.dwTotalPhys);number("AVAILABLE_PHYSICAL",memory.dwAvailPhys);
        number("TOTAL_PAGEFILE",memory.dwTotalPageFile);number("AVAILABLE_PAGEFILE",memory.dwAvailPageFile);
        number("TOTAL_VIRTUAL",memory.dwTotalVirtual);number("AVAILABLE_VIRTUAL",memory.dwAvailVirtual);
        DWORD sectors,bytes,available,total;
        if(GetDiskFreeSpaceA("C:\\",&sectors,&bytes,&available,&total))
        {number("C_CLUSTER_BYTES",sectors*bytes);number("C_AVAILABLE_CLUSTERS",available);}
        else number("ERROR_DISK_SPACE",GetLastError());
        FlushFileBuffers(output);
        if(sample!=359)Sleep(60000);
    }
    CloseHandle(output);ExitProcess(0);
}
