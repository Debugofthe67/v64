/* Native benchmark UI diagnostics. Inspect actual HWNDs, then invoke an
 * observed, visible control through its normal Windows message handler.
 * No graphics entry points, driver state or benchmark results are changed. */
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <tlhelp32.h>

static HANDLE output;
static unsigned int written, windows;
static char arguments[3][512];
static DWORD benchmark_processes[16];
static unsigned int benchmark_process_count;
static void text(const char *s)
{
    DWORD n, length=(DWORD)lstrlenA(s);
    if(written+length>65536)return;
    WriteFile(output,s,length,&n,0);written+=n;
}
static void hex(DWORD value)
{
    const char digits[]="0123456789abcdef";char s[11];s[0]='0';s[1]='x';
    for(int i=0;i<8;i++)s[i+2]=digits[value>>(28-i*4)&15];
    s[10]=0;text(s);
}
static void find_benchmarks(void)
{
    HANDLE snapshot=CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS,0);
    if(snapshot==INVALID_HANDLE_VALUE)return;
    PROCESSENTRY32 process;process.dwSize=sizeof(process);
    if(Process32First(snapshot,&process))do
    {
        const char *name=process.szExeFile,*p=name;
        for(;*p;p++)if(*p=='\\' || *p=='/')name=p+1;
        const char prefix[]="3DMARK";unsigned int i=0;
        for(;i<6 && name[i];i++)
        {char c=name[i];if(c>='a' && c<='z')c-=32;if(c!=prefix[i])break;}
        unsigned int length=(unsigned int)lstrlenA(name);
        if(i==6 && length>=10 && !lstrcmpiA(name+length-4,".exe") && benchmark_process_count<16)
        {
            benchmark_processes[benchmark_process_count++]=process.th32ProcessID;
            text("PROCESS PID=");hex(process.th32ProcessID);text(" EXE=");text(name);text("\r\n");
        }
    }while(Process32Next(snapshot,&process));
    CloseHandle(snapshot);
}
static BOOL benchmark(HWND window)
{
    DWORD process=0;GetWindowThreadProcessId(window,&process);
    for(unsigned int i=0;i<benchmark_process_count;i++)if(benchmark_processes[i]==process)return TRUE;
    return FALSE;
}
static void describe(HWND window)
{
    char type[64],title[512];RECT rectangle;
    GetClassNameA(window,type,sizeof(type));GetWindowTextA(window,title,sizeof(title));
    for(char *p=title;*p;p++)if(*p=='\r' || *p=='\n' || *p=='\t')*p=' ';
    GetWindowRect(window,&rectangle);
    text("HWND=");hex((DWORD)(ULONG_PTR)window);text(" ID=");hex((DWORD)GetDlgCtrlID(window));
    text(" STYLE=");hex((DWORD)GetWindowLongA(window,GWL_STYLE));
    DWORD_PTR checked=0;
    if(!lstrcmpiA(type,"Button"))SendMessageTimeoutA(window,BM_GETCHECK,0,0,SMTO_ABORTIFHUNG,200,&checked);
    text(" CHECK=");hex((DWORD)checked);
    text(" VISIBLE=");hex(IsWindowVisible(window));text(" ENABLED=");hex(IsWindowEnabled(window));
    text(" X=");hex(rectangle.left);text(" Y=");hex(rectangle.top);
    text(" CLASS=");text(type);text(" TEXT=");text(title);text("\r\n");
}
static BOOL CALLBACK child(HWND window,LPARAM unused)
{
    (void)unused;
    if(++windows>512)return FALSE;
    describe(window);return TRUE;
}
static BOOL CALLBACK top(HWND window,LPARAM unused)
{
    (void)unused;
    if(IsWindowVisible(window) && benchmark(window))
    {
        text("TOP ");describe(window);EnumChildWindows(window,child,0);
    }
    return windows<=512;
}
static BOOL parse(void)
{
    const char *p=GetCommandLineA();
    for(unsigned int argument=0;argument<4;argument++)
    {
        while(*p==' ' || *p=='\t')p++;
        BOOL quote=*p=='"';if(quote)p++;
        unsigned int length=0;
        while(*p && (quote?*p!='"':*p!=' ' && *p!='\t'))
        {
            if(argument){if(length>=511)return FALSE;arguments[argument-1][length++]=*p;}
            p++;
        }
        if(quote && *p=='"')p++;
    }
    return TRUE;
}
void __attribute__((stdcall)) entry(void)
{
    output=CreateFileA("D:\\NVUI.TXT",GENERIC_WRITE,FILE_SHARE_READ|FILE_SHARE_WRITE,0,CREATE_ALWAYS,0,0);
    if(output==INVALID_HANDLE_VALUE)ExitProcess(2);
    find_benchmarks();
    DWORD result=1;DWORD_PTR response=0;
    if(!parse()){text("ERROR argument too long\r\n");goto done;}
    if(!lstrcmpiA(arguments[0],"/list"))
    {
        EnumWindows(top,0);result=0;goto done;
    }
    DWORD address=0;const char *p=arguments[1];
    if(p[0]=='0' && (p[1]=='x' || p[1]=='X'))p+=2;
    for(unsigned int count=0;*p;p++,count++)
    {
        char c=*p;unsigned int digit=c>='0' && c<='9'?c-'0':c>='a' && c<='f'?c-'a'+10:c>='A' && c<='F'?c-'A'+10:16;
        if(digit>15 || count>=8){text("ERROR invalid HWND\r\n");goto done;}
        address=address*16+digit;
    }
    HWND window=(HWND)(ULONG_PTR)address;char type[64];
    if(!IsWindow(window) || !IsWindowVisible(window) || !IsWindowEnabled(window) || !benchmark(window))
    {text("ERROR target must be a visible enabled benchmark control\r\n");goto done;}
    GetClassNameA(window,type,sizeof(type));describe(window);
    if(!lstrcmpiA(arguments[0],"/click") && !lstrcmpiA(type,"Button"))
    {
        LONG style=GetWindowLongA(window,GWL_STYLE)&15;
        HWND parent=GetParent(window),root=window;
        while(GetWindowLongA(root,GWL_STYLE)&WS_CHILD)
        {
            HWND ancestor=GetParent(root);
            if(!ancestor)break;
            root=ancestor;
        }
        SetForegroundWindow(root);
        if(style==BS_CHECKBOX || style==BS_3STATE)
            result=!SendMessageTimeoutA(parent,WM_COMMAND,MAKEWPARAM(GetDlgCtrlID(window),BN_CLICKED),
                (LPARAM)window,SMTO_ABORTIFHUNG,2000,&response);
        else result=!SendMessageTimeoutA(window,BM_CLICK,0,0,SMTO_ABORTIFHUNG,2000,&response);
    }
    else if(!lstrcmpiA(arguments[0],"/text") && !lstrcmpiA(type,"Edit"))
        result=!SendMessageTimeoutA(window,WM_SETTEXT,0,(LPARAM)arguments[2],SMTO_ABORTIFHUNG,2000,&response);
    else text("ERROR action/control mismatch\r\n");
    text("ACTION_RESULT=");hex(result);text(" RESPONSE=");hex((DWORD)response);text("\r\n");
    if(result)text("MESSAGE_NOT_COMPLETED: inspect the UI before retrying; a long handler may already be running.\r\n");
done:
    FlushFileBuffers(output);CloseHandle(output);ExitProcess(result);
}
