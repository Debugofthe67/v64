/* Native benchmark UI diagnostics. Inspect actual HWNDs, then invoke an
 * observed, visible control through its normal Windows message handler.
 * No graphics entry points, driver state or benchmark results are changed. */
#define WIN32_LEAN_AND_MEAN
#define COBJMACROS
#include <windows.h>
#include <tlhelp32.h>
#include <oleacc.h>
#ifndef NV_UI_OUTPUT
#define NV_UI_OUTPUT "D:\\NVUI.TXT"
#endif

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
    /* GetWindowText reads another process's caption, not its control value.
     * WM_GETTEXT is marshalled by USER32; keep the query bounded and skip
     * password edits so diagnostics never request their contents. */
    if((!lstrcmpiA(type,"Edit") && !(GetWindowLongA(window,GWL_STYLE)&ES_PASSWORD)) ||
        !lstrcmpiA(type,"ComboBox") || !lstrcmpiA(type,"Button"))
    {
        char value[512]={0};DWORD_PTR copied=0;
        if(SendMessageTimeoutA(window,WM_GETTEXT,sizeof(value),(LPARAM)value,SMTO_ABORTIFHUNG,200,&copied))
        {value[sizeof(value)-1]=0;lstrcpyA(title,value);}
    }
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
// MSAA exposes the list label as Name and the remaining columns as
// Description. Read the original control without remote process memory or
// changing selection, scrolling, benchmark settings or result data.
static DWORD rows(HWND window)
{
    HMODULE ole=LoadLibraryA("ole32.dll"),acc=LoadLibraryA("oleacc.dll"),aut=LoadLibraryA("oleaut32.dll");
    union {FARPROC raw;HRESULT (WINAPI *call)(LPVOID);} initialize;
    union {FARPROC raw;void (WINAPI *call)(void);} uninitialize;
    union {FARPROC raw;HRESULT (WINAPI *call)(HWND,DWORD,REFIID,void**);} accessible;
    union {FARPROC raw;void (WINAPI *call)(BSTR);} free_string;
    if(!ole || !acc || !aut){text("ERROR accessibility library unavailable\r\n");return 1;}
    initialize.raw=GetProcAddress(ole,"CoInitialize");uninitialize.raw=GetProcAddress(ole,"CoUninitialize");
    accessible.raw=GetProcAddress(acc,"AccessibleObjectFromWindow");free_string.raw=GetProcAddress(aut,"SysFreeString");
    if(!initialize.raw || !uninitialize.raw || !accessible.raw || !free_string.raw)
    {text("ERROR accessibility API unavailable\r\n");return 1;}
    HRESULT initialized=initialize.call(0);
    if(FAILED(initialized)){text("ERROR CoInitialize=");hex((DWORD)initialized);text("\r\n");return 1;}
    static const IID iid={0x618736e0,0x3c3d,0x11cf,{0x81,0x0c,0x00,0xaa,0x00,0x38,0x9b,0x71}};
    IAccessible *object=0;HRESULT status=accessible.call(window,OBJID_CLIENT,&iid,(void**)&object);DWORD result=1;
    if(SUCCEEDED(status) && object)
    {
        LONG count=0;status=IAccessible_get_accChildCount(object,&count);
        if(SUCCEEDED(status) && count>=0 && count<=1024)
        {
            text("ACCESSIBLE_ROWS=");hex((DWORD)count);text("\r\n");result=0;
            for(LONG i=1;i<=count;i++)
            {
                if(written>60000){text("ERROR remaining rows exceed output budget\r\n");result=1;break;}
                VARIANT child={0};child.vt=VT_I4;child.lVal=i;
                text("ROW=");hex((DWORD)i);
                for(unsigned int column=0;column<2;column++)
                {
                    BSTR value=0;char utf8[2048];
                    status=column?IAccessible_get_accDescription(object,child,&value):IAccessible_get_accName(object,child,&value);
                    text(column?" COLUMNS=":" NAME=");
                    if(SUCCEEDED(status) && value)
                    {
                        int size=WideCharToMultiByte(CP_UTF8,0,value,-1,utf8,sizeof(utf8),0,0);
                        if(size)text(utf8);else {text("[conversion failed]");result=1;}
                    }
                    if(value)free_string.call(value);
                }
                text("\r\n");
            }
        }
        else {text("ERROR accessibility row count\r\n");hex((DWORD)status);}
        IAccessible_Release(object);
    }
    else {text("ERROR AccessibleObjectFromWindow=");hex((DWORD)status);text("\r\n");}
    uninitialize.call();return result;
}
void __attribute__((stdcall)) entry(void)
{
    output=CreateFileA(NV_UI_OUTPUT,GENERIC_WRITE,FILE_SHARE_READ|FILE_SHARE_WRITE,0,CREATE_ALWAYS,0,0);
    if(output==INVALID_HANDLE_VALUE)ExitProcess(2);
    text("REQUEST_TICK=");hex(GetTickCount());text("\r\n");
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
    for(HWND ancestor=window;ancestor;)
    {
        if(!IsWindowEnabled(ancestor))
        {text("ERROR target belongs to a disabled dialog; close its modal window first\r\n");goto done;}
        if(!(GetWindowLongA(ancestor,GWL_STYLE)&WS_CHILD))break;
        ancestor=GetParent(ancestor);
    }
    GetClassNameA(window,type,sizeof(type));describe(window);
    if(!lstrcmpiA(arguments[0],"/point") &&
        (!lstrcmpiA(type,"SysTreeView32") || !lstrcmpiA(type,"Button")))
    {
        DWORD coords[2]={0,0};const char *p=arguments[2];
        for(unsigned int axis=0;axis<2;axis++)
        {
            unsigned int digits=0;
            while(*p>='0' && *p<='9')
            {if(digits++>=4){text("ERROR bounded control point\r\n");goto done;}coords[axis]=coords[axis]*10+*p++-'0';}
            if(!digits || (axis==0?*p++!=',':*p!=0)){text("ERROR expected tree point x,y\r\n");goto done;}
        }
        RECT client;POINT point={(LONG)coords[0],(LONG)coords[1]};
        GetClientRect(window,&client);ClientToScreen(window,&point);
        const int width=GetSystemMetrics(SM_CXSCREEN),height=GetSystemMetrics(SM_CYSCREEN);
        if(coords[0]>=(DWORD)client.right || coords[1]>=(DWORD)client.bottom ||
            width<2 || height<2 || point.x<0 || point.y<0 || point.x>=width || point.y>=height)
        {text("ERROR point outside visible control client\r\n");goto done;}
        HWND root=window;
        while(GetWindowLongA(root,GWL_STYLE)&WS_CHILD){HWND parent=GetParent(root);if(!parent)break;root=parent;}
        SetForegroundWindow(root);
        // Stock absolute mouse input keeps MFC's GetMessagePos hit testing,
        // tree notifications and Win9x skinned buttons on their UI path.
        // /click still rejects foreign-thread BM_CLICK on Win9x BS_OWNERDRAW.
        mouse_event(MOUSEEVENTF_MOVE|MOUSEEVENTF_ABSOLUTE,(DWORD)point.x*65535/(width-1),(DWORD)point.y*65535/(height-1),0,0);
        Sleep(100);mouse_event(MOUSEEVENTF_LEFTDOWN,0,0,0,0);Sleep(50);mouse_event(MOUSEEVENTF_LEFTUP,0,0,0,0);
        result=0;
    }
    else if(!lstrcmpiA(arguments[0],"/items") && !lstrcmpiA(type,"ComboBox"))
    {
        DWORD_PTR count=0,selected=0;
        if(!SendMessageTimeoutA(window,CB_GETCOUNT,0,0,SMTO_ABORTIFHUNG,2000,&count) || count>128)
        {text("ERROR bounded combo count\r\n");goto done;}
        if(!SendMessageTimeoutA(window,CB_GETCURSEL,0,0,SMTO_ABORTIFHUNG,2000,&selected))
        {text("ERROR combo selection\r\n");goto done;}
        text("ITEM_COUNT=");hex((DWORD)count);text(" SELECTED_INDEX=");hex((DWORD)selected);text("\r\n");
        for(DWORD index=0;index<count;index++)
        {
            char value[512];DWORD_PTR length=0;
            if(!SendMessageTimeoutA(window,CB_GETLBTEXTLEN,index,0,SMTO_ABORTIFHUNG,2000,&length) || length>=sizeof(value) ||
                !SendMessageTimeoutA(window,CB_GETLBTEXT,index,(LPARAM)value,SMTO_ABORTIFHUNG,2000,&response))
            {text("ERROR combo item\r\n");goto done;}
            value[length]=0;text("ITEM_INDEX=");hex(index);text(" TEXT=");text(value);text("\r\n");
        }
        result=0;
    }
    else if(!lstrcmpiA(arguments[0],"/select") && !lstrcmpiA(type,"ComboBox"))
    {
        DWORD index=0;const char *digit=arguments[2];unsigned int digits=0;
        for(;*digit;digit++,digits++)
        {
            if(*digit<'0' || *digit>'9' || digits>=3){text("ERROR decimal combo index\r\n");goto done;}
            index=index*10+*digit-'0';
        }
        DWORD_PTR count=0;
        if(!digits || !SendMessageTimeoutA(window,CB_GETCOUNT,0,0,SMTO_ABORTIFHUNG,2000,&count) || count>128 || index>=count)
        {text("ERROR combo index outside observed items\r\n");goto done;}
        result=!SendMessageTimeoutA(window,CB_SETCURSEL,index,0,SMTO_ABORTIFHUNG,2000,&response);
        if(!result && response==index)
            result=!SendMessageTimeoutA(GetParent(window),WM_COMMAND,MAKEWPARAM(GetDlgCtrlID(window),CBN_SELCHANGE),
                (LPARAM)window,SMTO_ABORTIFHUNG,2000,&response);
        else if(!result)result=1;
    }
    else if(!lstrcmpiA(arguments[0],"/rows") && !lstrcmpiA(type,"SysListView32"))
        result=rows(window);
    else if(!lstrcmpiA(arguments[0],"/click") && !lstrcmpiA(type,"Button"))
    {
        LONG style=GetWindowLongA(window,GWL_STYLE)&15;
        // The native Win9x skinned registration flow faulted in USER.EXE
        // after a cross-thread BM_CLICK. Keep this diagnostic conservative:
        // use actual keyboard/mouse input for these application-owned buttons.
        if((GetVersion()&0x80000000) && style==BS_OWNERDRAW)
        {text("ERROR Win9x owner-drawn button requires native keyboard or mouse input\r\n");goto done;}
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
