/* Native XP fixture setup. 3DMark05's original Boost path code rejects an
 * executable at a drive root. A new NTFS directory junction presents the
 * unchanged benchmark disk through C:\NV05RUN without duplicating its DAT.
 * Refuse an existing directory; never overwrite or delete guest files. */
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <winioctl.h>
static HANDLE out;
static void report(const char *name,DWORD value)
{
    DWORD n;const char hex[]="0123456789abcdef";char line[64];unsigned i=0;
    while(name[i]){line[i]=name[i];i++;}
    line[i++]='=';
    for(unsigned j=0;j<8;j++)line[i++]=hex[value>>(28-j*4)&15];
    line[i++]='\r';line[i++]='\n';WriteFile(out,line,i,&n,0);
}
void __attribute__((stdcall)) entry(void)
{
    out=CreateFileA("D:\\NVUI.TXT",GENERIC_WRITE,FILE_SHARE_READ|FILE_SHARE_WRITE,0,CREATE_ALWAYS,0,0);
    if(out==INVALID_HANDLE_VALUE)ExitProcess(1);
    if(!CreateDirectoryW(L"C:\\NV05RUN",0))
    {
        report("CREATE_ERROR",GetLastError());CloseHandle(out);ExitProcess(2);
    }
    HANDLE dir=CreateFileW(L"C:\\NV05RUN",GENERIC_WRITE,0,0,OPEN_EXISTING,
        FILE_FLAG_OPEN_REPARSE_POINT|FILE_FLAG_BACKUP_SEMANTICS,0);
    if(dir==INVALID_HANDLE_VALUE)
    {
        report("OPEN_ERROR",GetLastError());CloseHandle(out);ExitProcess(3);
    }
    // Mount-point offsets and lengths are bytes relative to path[], excluding
    // each terminating NUL. Substitute name is \\??\\E:\\; print name is E:\\.
    struct
    {
        DWORD tag;
        WORD length,reserved,subOffset,subLength,printOffset,printLength;
        WCHAR path[12];
    } data={0xA0000003,32,0,0,14,16,6,
        {L'\\',L'?',L'?',L'\\',L'E',L':',L'\\',0,L'E',L':',L'\\',0}};
    DWORD n;
    BOOL ok=DeviceIoControl(dir,FSCTL_SET_REPARSE_POINT,&data,sizeof(data),0,0,&n,0);
    report("SET_REPARSE",ok);
    if(!ok)report("SET_ERROR",GetLastError());
    CloseHandle(dir);
    report("EXE_ATTRIBUTES",GetFileAttributesW(L"C:\\NV05RUN\\3DMark05.exe"));
    FlushFileBuffers(out);CloseHandle(out);ExitProcess(ok?0:4);
}
