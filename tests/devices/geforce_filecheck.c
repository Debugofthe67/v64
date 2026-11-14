/* Read-only Win9x/XP file diagnostic. Compare sequential ReadFile and bounded
 * MapViewOfFile CRC32s with a host checksum; do not hook the tested process. */
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <tlhelp32.h>

static HANDLE output;
static DWORD table[256];
static BYTE buffer[65536];

static void text(const char *s)
{
    DWORD written;
    WriteFile(output,s,(DWORD)lstrlenA(s),&written,0);
}
static void number(const char *name,DWORD value)
{
    const char digits[]="0123456789abcdef";char result[11];result[0]='0';result[1]='x';
    for(unsigned i=0;i<8;i++)result[i+2]=digits[value>>(28-i*4)&15];
    result[10]=0;text(name);text("=");text(result);text("\r\n");FlushFileBuffers(output);
}
static DWORD crc(DWORD value,const BYTE *bytes,DWORD count)
{
    for(DWORD i=0;i<count;i++)value=table[(value^bytes[i])&255]^(value>>8);
    return value;
}
static void finish_dump(HANDLE dump,const char *path,const char *label,const char *raw_label)
{
    if(dump==INVALID_HANDLE_VALUE)return;
    if(!FlushFileBuffers(dump))number("ERROR_DUMP_FLUSH",GetLastError());
    CloseHandle(dump);
    HANDLE check=CreateFileA(path,GENERIC_READ,FILE_SHARE_READ,0,OPEN_EXISTING,0,0);
    if(check==INVALID_HANDLE_VALUE){number("ERROR_DUMP_REOPEN",GetLastError());return;}
    DWORD high=0,size=GetFileSize(check,&high);
    if(high || size>0x100000){text("ERROR dump exceeds 1 MiB bound\r\n");CloseHandle(check);return;}
    DWORD value=0xFFFFFFFF,count;
    for(;;)
    {
        if(!ReadFile(check,buffer,sizeof(buffer),&count,0))
        {number("ERROR_DUMP_READ",GetLastError());CloseHandle(check);return;}
        if(!count)break;
        value=crc(value,buffer,count);
    }
    number(label,value^0xFFFFFFFF);CloseHandle(check);
    // Separate the guest cache's readback from what its storage stack returns
    // without file buffering. These are diagnostic copies, never the source.
    if(size&511){text("DUMP_RAW_SKIPPED_UNALIGNED\r\n");return;}
    BYTE *aligned=VirtualAlloc(0,sizeof(buffer),MEM_RESERVE|MEM_COMMIT,PAGE_READWRITE);
    if(!aligned){number("ERROR_DUMP_ALLOC",GetLastError());return;}
    check=CreateFileA(path,GENERIC_READ,FILE_SHARE_READ,0,OPEN_EXISTING,FILE_FLAG_NO_BUFFERING,0);
    if(check==INVALID_HANDLE_VALUE)number("ERROR_DUMP_RAW_OPEN",GetLastError());
    else
    {
        value=0xFFFFFFFF;DWORD position=0;
        while(position<size)
        {
            DWORD request=size-position;if(request>sizeof(buffer))request=sizeof(buffer);
            if(!ReadFile(check,aligned,request,&count,0) || count!=request)
            {number("ERROR_DUMP_RAW_READ",GetLastError());break;}
            value=crc(value,aligned,count);position+=count;
        }
        if(position==size)number(raw_label,value^0xFFFFFFFF);
        CloseHandle(check);
    }
    VirtualFree(aligned,0,MEM_RELEASE);
}
static void dump_bytes(HANDLE dump,const BYTE *bytes,DWORD count)
{
    if(dump==INVALID_HANDLE_VALUE)return;
    DWORD written=0;
    if(!WriteFile(dump,bytes,count,&written,0) || written!=count)
    {number("ERROR_DUMP_WRITE",GetLastError());number("DUMP_WRITTEN",written);}
}
static BOOL argument(const char **input,DWORD *value)
{
    const char *p=*input;while(*p==' ')p++;
    if(p[0]=='0' && (p[1]=='x' || p[1]=='X'))p+=2;
    unsigned digits=0;*value=0;
    while(*p && *p!=' ')
    {
        unsigned digit=*p>='0' && *p<='9'?*p-'0':*p>='a' && *p<='f'?*p-'a'+10:*p>='A' && *p<='F'?*p-'A'+10:16;
        if(digit>15 || digits++>=8)return FALSE;
        *value=*value*16+digit;p++;
    }
    *input=p;return digits!=0;
}
static void memory_status(void)
{
    MEMORYSTATUS memory;memory.dwLength=sizeof(memory);GlobalMemoryStatus(&memory);
    text("READ_ONLY_MEMORY_STATUS\r\n");
    number("MEMORY_LOAD_PERCENT",memory.dwMemoryLoad);
    number("TOTAL_PHYSICAL",memory.dwTotalPhys);number("AVAILABLE_PHYSICAL",memory.dwAvailPhys);
    number("TOTAL_PAGEFILE",memory.dwTotalPageFile);number("AVAILABLE_PAGEFILE",memory.dwAvailPageFile);
    number("TOTAL_VIRTUAL",memory.dwTotalVirtual);number("AVAILABLE_VIRTUAL",memory.dwAvailVirtual);
    DWORD sectors,bytes,available,total;
    if(GetDiskFreeSpaceA("C:\\",&sectors,&bytes,&available,&total))
    {number("C_CLUSTER_BYTES",sectors*bytes);number("C_AVAILABLE_CLUSTERS",available);number("C_TOTAL_CLUSTERS",total);}
    else number("ERROR_DISK_SPACE",GetLastError());
    HANDLE snapshot=CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS|TH32CS_SNAPTHREAD,0);
    if(snapshot==INVALID_HANDLE_VALUE){number("ERROR_SNAPSHOT",GetLastError());return;}
    PROCESSENTRY32 process;process.dwSize=sizeof(process);
    BOOL more=Process32First(snapshot,&process);unsigned count=0;
    while(more && count++<128)
    {
        number("PROCESS_ID",process.th32ProcessID);text("PROCESS_EXE=");text(process.szExeFile);text("\r\n");
        number("PROCESS_THREADS",process.cntThreads);
        more=Process32Next(snapshot,&process);
    }
    THREADENTRY32 thread;thread.dwSize=sizeof(thread);more=Thread32First(snapshot,&thread);count=0;
    while(more && count++<512)
    {
        number("THREAD_ID",thread.th32ThreadID);number("THREAD_PROCESS_ID",thread.th32OwnerProcessID);
        number("THREAD_BASE_PRIORITY",thread.tpBasePri);number("THREAD_DELTA_PRIORITY",thread.tpDeltaPri);
        more=Thread32Next(snapshot,&thread);
    }
    CloseHandle(snapshot);
}
void __attribute__((stdcall)) entry(void)
{
    output=CreateFileA("D:\\NVFILE.TXT",GENERIC_WRITE,FILE_SHARE_READ|FILE_SHARE_WRITE,0,CREATE_ALWAYS,0,0);
    if(output==INVALID_HANDLE_VALUE)ExitProcess(2);
    const char *p=GetCommandLineA();BOOL quoted=*p=='"';if(quoted)p++;
    while(*p && (quoted?*p!='"':*p!=' '))p++;
    if(quoted && *p)p++;
    while(*p==' ')p++;
    char path[MAX_PATH];unsigned length=0;quoted=*p=='"';if(quoted)p++;
    while(*p && (quoted?*p!='"':*p!=' '))
    {if(length>=MAX_PATH-1){text("ERROR path too long\r\n");ExitProcess(2);}path[length++]=*p++;}
    path[length]=0;
    if(quoted && *p)p++;
    while(*p==' ')p++;
    if(!lstrcmpiA(path,"/memory"))
    {memory_status();text("END\r\n");CloseHandle(output);ExitProcess(0);}
    HANDLE file=CreateFileA(path,GENERIC_READ,FILE_SHARE_READ,0,OPEN_EXISTING,FILE_ATTRIBUTE_NORMAL,0);
    if(file==INVALID_HANDLE_VALUE){number("ERROR_OPEN",GetLastError());ExitProcess(2);}
    DWORD high=0,size=GetFileSize(file,&high);
    if(high || size>0x40000000){text("ERROR file exceeds 1 GiB bound\r\n");CloseHandle(file);ExitProcess(2);}
    DWORD first=0,end=size,count=0;BOOL range=*p!=0;
    if(range)
    {
        if(!argument(&p,&first) || !argument(&p,&count) || first>size || count>size-first || !count || count>0x100000)
        {text("ERROR expected hex offset and 1..100000 hex bytes within file\r\n");CloseHandle(file);ExitProcess(2);}
        end=first+count;
    }
    text("READ_ONLY_FILE_CHECK\r\nPATH=");text(path);text("\r\n");number("BYTES",size);number("FIRST",first);number("COUNT",end-first);
    for(DWORD i=0;i<256;i++)
    {DWORD value=i;for(unsigned bit=0;bit<8;bit++)value=value>>1^(value&1?0xEDB88320:0);table[i]=value;}
    HANDLE dump=range?CreateFileA("D:\\NVDATA.BIN",GENERIC_WRITE,FILE_SHARE_READ,0,CREATE_ALWAYS,0,0):INVALID_HANDLE_VALUE;
    DWORD value=0xFFFFFFFF,position=first,start=GetTickCount();
    SetFilePointer(file,first,0,FILE_BEGIN);
    while(position<end)
    {
        DWORD count=0,request=end-position;if(request>sizeof(buffer))request=sizeof(buffer);
        if(!ReadFile(file,buffer,request,&count,0) || count!=request)
        {number("ERROR_READ_OFFSET",position);number("ERROR_READ",GetLastError());CloseHandle(file);ExitProcess(2);}
        value=crc(value,buffer,count);position+=count;
        dump_bytes(dump,buffer,count);
        if(!(position&0x3FFFFFF))number("READ_PROGRESS",position);
    }
    finish_dump(dump,"D:\\NVDATA.BIN","DUMP_READFILE_CRC32","DUMP_READFILE_RAW_CRC32");
    DWORD sequential=value^0xFFFFFFFF;number("READFILE_CRC32",sequential);number("READFILE_MS",GetTickCount()-start);
    text("MAPPING_BEGIN\r\n");FlushFileBuffers(output);
    HANDLE mapping=CreateFileMappingA(file,0,PAGE_READONLY,0,0,0);
    if(!mapping){number("ERROR_MAPPING",GetLastError());CloseHandle(file);ExitProcess(2);}
    text("MAPPING_CREATED\r\n");FlushFileBuffers(output);
    dump=range?CreateFileA("D:\\NVMAP.BIN",GENERIC_WRITE,FILE_SHARE_READ,0,CREATE_ALWAYS,0,0):INVALID_HANDLE_VALUE;
    value=0xFFFFFFFF;position=first;start=GetTickCount();DWORD post_write=0xFFFFFFFF;
    while(position<end)
    {
        DWORD base=position&~0xFFFF,delta=position-base,count=end-position;if(count>0x100000-delta)count=0x100000-delta;
        const BYTE *view=MapViewOfFile(mapping,FILE_MAP_READ,0,base,count+delta);
        if(!view){number("ERROR_VIEW_OFFSET",position);number("ERROR_VIEW",GetLastError());CloseHandle(mapping);CloseHandle(file);ExitProcess(2);}
        value=crc(value,view+delta,count);
        dump_bytes(dump,view+delta,count);
        if(range)post_write=crc(post_write,view+delta,count);
        UnmapViewOfFile(view);position+=count;
        if(!(position&0x3FFFFFF))number("MAP_PROGRESS",position);
    }
    finish_dump(dump,"D:\\NVMAP.BIN","DUMP_MAPPED_CRC32","DUMP_MAPPED_RAW_CRC32");
    number("MAPPED_CRC32",value^0xFFFFFFFF);number("MAPPED_MS",GetTickCount()-start);
    if(range)number("MAPPED_POST_WRITE_CRC32",post_write^0xFFFFFFFF);
    number("MATCH",sequential==(value^0xFFFFFFFF));text("END\r\n");
    CloseHandle(mapping);CloseHandle(file);CloseHandle(output);ExitProcess(0);
}
