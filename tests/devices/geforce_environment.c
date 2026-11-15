/* Native XP benchmark environment: read actual OS idle policy, or explicitly
 * disable screen saving and idle power actions before starting a long test.
 * Uses ordinary Windows settings APIs; no graphics, driver or clock hooks. */
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <powrprof.h>
#ifndef NV_ENV_OUTPUT
#define NV_ENV_OUTPUT "D:\\NVENV.TXT"
#endif

static HANDLE output;
static void text(const char *s)
{
    DWORD count;WriteFile(output,s,lstrlenA(s),&count,0);
}
static void value(const char *name,DWORD number)
{
    char digits[11];const char hex[]="0123456789abcdef";
    digits[0]='0';digits[1]='x';digits[10]=0;
    for(unsigned int i=0;i<8;i++)digits[i+2]=hex[number>>(28-i*4)&15];
    text(name);text("=");text(digits);text("\r\n");
}
static BOOL prefix(const char *s,const char *p)
{
    while(*p)if(*s++!=*p++)return FALSE;
    return TRUE;
}
static BOOL idle_policy(POWER_POLICY *policy,UINT *scheme)
{
    BOOL saver=FALSE;UINT timeout=0;
    BOOL ok=SystemParametersInfoA(SPI_GETSCREENSAVEACTIVE,0,&saver,0) &&
        SystemParametersInfoA(SPI_GETSCREENSAVETIMEOUT,0,&timeout,0);
    value("SCREEN_SAVER_QUERY",ok);value("SCREEN_SAVER_ACTIVE",saver);
    value("SCREEN_SAVER_TIMEOUT",timeout);
    BOOL power=GetActivePwrScheme(scheme) && ReadPwrScheme(*scheme,policy);
    value("POWER_QUERY",power);
    if(power)
    {
        value("SCHEME",*scheme);
        value("DISPLAY_AC",policy->user.VideoTimeoutAc);value("DISPLAY_DC",policy->user.VideoTimeoutDc);
        value("IDLE_AC",policy->user.IdleTimeoutAc);value("IDLE_DC",policy->user.IdleTimeoutDc);
        value("HIBERNATE_AC",policy->mach.DozeS4TimeoutAc);value("HIBERNATE_DC",policy->mach.DozeS4TimeoutDc);
    }
    return ok && power;
}
void __attribute__((stdcall)) entry(void)
{
    output=CreateFileA(NV_ENV_OUTPUT,GENERIC_WRITE,FILE_SHARE_READ|FILE_SHARE_WRITE,0,CREATE_ALWAYS,0,0);
    if(output==INVALID_HANDLE_VALUE)ExitProcess(2);
    text("NVENV BEGIN\r\n");value("REQUEST_TICK",GetTickCount());
    POWER_POLICY policy;UINT scheme=0;BOOL ok=idle_policy(&policy,&scheme);
    const char *command=GetCommandLineA();BOOL disable=FALSE;
    for(;*command;command++)if(prefix(command,"/disable-idle"))disable=TRUE;
    if(disable && ok)
    {
        text("APPLY_DISABLE_IDLE\r\n");
        BOOL saver=SystemParametersInfoA(SPI_SETSCREENSAVEACTIVE,FALSE,0,SPIF_UPDATEINIFILE|SPIF_SENDCHANGE);
        policy.user.VideoTimeoutAc=policy.user.VideoTimeoutDc=0;
        policy.user.IdleTimeoutAc=policy.user.IdleTimeoutDc=0;
        policy.mach.DozeS4TimeoutAc=policy.mach.DozeS4TimeoutDc=0;
        BOOL power=SetActivePwrScheme(scheme,0,&policy);
        value("SCREEN_SAVER_SET",saver);value("POWER_SET",power);
        text("AFTER\r\n");ok=idle_policy(&policy,&scheme) && saver && power;
        BOOL active=TRUE;
        ok=ok && SystemParametersInfoA(SPI_GETSCREENSAVEACTIVE,0,&active,0) && !active &&
            !policy.user.VideoTimeoutAc && !policy.user.VideoTimeoutDc &&
            !policy.user.IdleTimeoutAc && !policy.user.IdleTimeoutDc &&
            !policy.mach.DozeS4TimeoutAc && !policy.mach.DozeS4TimeoutDc;
    }
    value("RESULT",ok?0:1);text("NVENV END\r\n");
    FlushFileBuffers(output);CloseHandle(output);ExitProcess(ok?0:1);
}
