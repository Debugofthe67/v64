// Native iOS 6 IP tunnel. ABI layouts match XNU's public BSD headers;
// this file and its link stubs contain no firmware or SDK code.
#include "app-native.h"

extern int socket(int,int,int), connect(int,const void *,unsigned), ioctl(int,unsigned long,...);
extern int getsockopt(int,int,int,void *,unsigned *), fcntl(int,int,...), getpid(void);
extern int *__error(void);
extern int pthread_create(unsigned long *,const void *,void *(*)(void *),void *), pthread_detach(unsigned long);
extern CFTypeRef CFDataCreate(CFAllocatorRef,const unsigned char *,long);
extern CFTypeRef CFPropertyListCreateWithData(CFAllocatorRef,CFTypeRef,usize,void *,void *);

struct net_address { unsigned char length,family; unsigned short port; unsigned char ip[4],zero[8]; };
struct net_alias { char name[16]; struct net_address address,peer,mask; };
struct net_control { unsigned char length,family; unsigned short system; unsigned id,unit,reserved[5]; };
struct net_ctl_info { unsigned id; char name[96]; };
struct net_route { unsigned short length; unsigned char version,type; unsigned short index,pad;
    int flags,addresses,pid,sequence,error,use; unsigned inits,metrics[14]; };
_Static_assert(sizeof(struct net_alias)==64,"Darwin ifaliasreq");
_Static_assert(sizeof(struct net_control)==32,"Darwin sockaddr_ctl");
_Static_assert(sizeof(struct net_route)==92,"Darwin rt_msghdr");

static int net_call(unsigned op,void *buffer,unsigned size,unsigned connection)
{
    for(unsigned retry=0;retry<2;retry++)
    {
        register unsigned r0 __asm__("r0")=0x86640000|op;
        register __UINTPTR_TYPE__ r1 __asm__("r1")=(__UINTPTR_TYPE__)buffer;
        register unsigned r2 __asm__("r2")=size,r3 __asm__("r3")=connection;
        __asm__ volatile(".word 0xe7f866f4":"+r"(r0):"r"(r1),"r"(r2),"r"(r3):"memory");
        if((int)r0!=-1 || !size)return (int)r0;
        volatile unsigned char *p=buffer;
        for(unsigned at=0;at<size;){unsigned char c=p[at];if(op==3)p[at]=c;
            unsigned step=4096-((__UINTPTR_TYPE__)(p+at)&4095);if(step>=size-at)break;at+=step;}
    }
    return -1;
}
static void net_status(unsigned connection,const char *phase,const char *name,const char *step)
{
    char text[512];int n=snprintf(text,sizeof(text),"V86S{\"phase\":\"%s\",\"interface\":\"%s\",\"error\":\"%s\"}",phase,name,step);
    if(n>0 && n<(int)sizeof(text))net_call(2,text,n,connection);
    printf("V86 network %s: %s %s errno=%d\n",phase,name,step,*__error());
}
static struct net_address net_addr(const unsigned char *ip)
{
    struct net_address a={16,2,0,{0},{0}};memcpy(a.ip,ip,4);return a;
}
static int net_default_route(const unsigned char *peer)
{
    struct { struct net_route header; struct net_address destination,gateway,mask; } message;
    memset(&message,0,sizeof(message));message.header.length=sizeof(message);message.header.version=5;
    message.header.type=1;message.header.flags=0x803;message.header.addresses=7;message.header.pid=getpid();message.header.sequence=1;
    const unsigned char zero[4]={0};message.destination=net_addr(zero);message.gateway=net_addr(peer);message.mask=net_addr(zero);
    int fd=socket(17,3,0);if(fd<0)return 0;
    int result=write(fd,&message,sizeof(message));int error=*__error();close(fd);
    return result==sizeof(message) || (result<0 && error==17);
}
typedef CFTypeRef (*store_create_fn)(CFAllocatorRef,CFStringRef,void *,void *);
typedef Boolean (*store_set_fn)(CFTypeRef,CFStringRef,CFTypeRef);
typedef Boolean (*store_remove_fn)(CFTypeRef,CFStringRef);
typedef CFTypeRef (*store_copy_fn)(CFTypeRef,CFStringRef);
static CFTypeRef net_store;
static store_set_fn net_store_set;
static store_remove_fn net_store_remove;
static store_copy_fn net_store_copy;
static store_remove_fn net_store_notify;
#ifdef V86_NETWORK_PROBE
static volatile int net_is_ready;
#endif
static int net_publish(const char *key,const char *xml)
{
    CFStringRef k=string(key);CFTypeRef data=CFDataCreate(0,(const unsigned char *)xml,strlen(xml));
    CFTypeRef value=data?CFPropertyListCreateWithData(0,data,0,0,0):0;
    int ok=value&&net_store_set(net_store,k,value);if(value)CFRelease(value);if(data)CFRelease(data);CFRelease(k);return ok;
}
static int net_dns(const char *name,const unsigned char *ip,const unsigned char *peer,const unsigned char *dns)
{
    void *sc=dlopen("/System/Library/Frameworks/SystemConfiguration.framework/SystemConfiguration",2);
    store_create_fn create=sc?(store_create_fn)dlsym(sc,"SCDynamicStoreCreate"):0;
    net_store_set=sc?(store_set_fn)dlsym(sc,"SCDynamicStoreSetValue"):0;
    net_store_remove=sc?(store_remove_fn)dlsym(sc,"SCDynamicStoreRemoveValue"):0;
    net_store_copy=sc?(store_copy_fn)dlsym(sc,"SCDynamicStoreCopyValue"):0;
    net_store_notify=sc?(store_remove_fn)dlsym(sc,"SCDynamicStoreNotifyValue"):0;
    if(!create || !net_store_set || !net_store_remove)return 0;
    CFStringRef label=string("v86 IP tunnel");net_store=create(0,label,0,0);CFRelease(label);if(!net_store)return 0;
    char xml[1536];
    snprintf(xml,sizeof(xml),"<plist version=\"1.0\"><dict><key>InterfaceName</key><string>%s</string>"
        "<key>Addresses</key><array><string>%u.%u.%u.%u</string></array>"
        "<key>DestAddresses</key><array><string>%u.%u.%u.%u</string></array>"
        "<key>SubnetMasks</key><array><string>255.255.255.255</string></array>"
        "<key>Router</key><string>%u.%u.%u.%u</string><key>OverridePrimary</key><integer>1</integer></dict></plist>",
        name,ip[0],ip[1],ip[2],ip[3],peer[0],peer[1],peer[2],peer[3],peer[0],peer[1],peer[2],peer[3]);
    if(!net_publish("State:/Network/Service/v86/IPv4",xml))return 0;
    snprintf(xml,sizeof(xml),"<plist version=\"1.0\"><dict><key>ServerAddresses</key><array><string>%u.%u.%u.%u</string></array>"
        "<key>SupplementalMatchDomains</key><array><string></string></array>"
        "<key>SupplementalMatchOrders</key><array><integer>0</integer></array></dict></plist>",dns[0],dns[1],dns[2],dns[3]);
    return net_publish("State:/Network/Service/v86/DNS",xml);
}
static void net_refresh(void)
{
    // The helper can publish before configd finishes loading IPMonitor.
    // IPMonitor's prime function does not scan existing service values.
    if(!net_store || !net_store_copy || !net_store_notify)return;
    CFStringRef key=string("State:/Network/Global/IPv4");CFTypeRef value=net_store_copy(net_store,key);CFRelease(key);
    int configured=0;
    if(value){CFStringRef primary=string("PrimaryService");CFStringRef service=CFDictionaryGetValue(value,primary);
        char id[32];configured=service&&CFStringGetCString(service,id,sizeof(id),0x08000100)&&!strcmp(id,"v86");
        CFRelease(primary);CFRelease(value);}
    if(configured)return;
    for(unsigned i=0;i<2;i++){key=string(i?"State:/Network/Service/v86/DNS":"State:/Network/Service/v86/IPv4");
        net_store_notify(net_store,key);CFRelease(key);}
}
static void net_unpublish(void)
{
    if(!net_store)return;
    for(unsigned i=0;i<2;i++){CFStringRef k=string(i?"State:/Network/Service/v86/DNS":"State:/Network/Service/v86/IPv4");
        net_store_remove(net_store,k);CFRelease(k);}
    CFRelease(net_store);net_store=0;
}
static int net_open(const unsigned char *config,char name[16])
{
    int fd=socket(32,2,2);if(fd<0)return -1;
    struct net_ctl_info info={0,"com.apple.net.utun_control"};
    struct net_control address={sizeof(address),32,2,0,0,{0}};
    if(ioctl(fd,0xC0644E03UL,&info)<0)goto failed;
    address.id=info.id;if(connect(fd,&address,sizeof(address))<0)goto failed;
    unsigned length=16;if(getsockopt(fd,2,2,name,&length)<0 || length>16)goto failed;name[15]=0;
    struct net_alias alias;memset(&alias,0,sizeof(alias));memcpy(alias.name,name,strlen(name));
    alias.address=net_addr(config+12);alias.peer=net_addr(config+16);
    const unsigned char mask[4]={255,255,255,255};alias.mask=net_addr(mask);
    int control=socket(2,2,0);if(control<0)goto failed;
    int result=ioctl(control,0x8040691AUL,&alias);close(control);if(result<0)goto failed;
    if(!net_default_route(config+16) || !net_dns(name,config+12,config+16,config+20))goto failed;
    if(fcntl(fd,4,4)<0)goto failed;
    return fd;
failed:close(fd);net_unpublish();return -1;
}
static void *net_disable_cellular(void *unused)
{
    (void)unused;void *pool=objc_autoreleasePoolPush();
    // Native Settings radio preference: no invented carrier or Wi-Fi SSID.
    dlopen("/System/Library/PrivateFrameworks/AppSupport.framework/AppSupport",2);
    void *cls=objc_getClass("RadiosPreferences");
    void *prefs=cls?send0(send0(cls,"alloc"),"init"):0;
    if(prefs){objc_msgSend(prefs,sel_registerName("setAirplaneMode:"),1);
        send0(prefs,"synchronize");send0(prefs,"release");}
    objc_autoreleasePoolPop(pool);return 0;
}
static void *net_main(void *unused)
{
    (void)unused;int fd=-1;char name[16]="";unsigned char packet[1504];
    for(;;)
    {
        int connection=net_call(1,"v86.ios.network",15,0);if(connection<1){usleep(5000000);continue;}
        int length=net_call(3,packet,sizeof(packet),connection);
        if(length!=24 || memcmp(packet,"V86N\1\0\0\0",8) || packet[8]!=0xdc || packet[9]!=5)goto reconnect;
        if(fd<0){fd=net_open(packet,name);if(fd<0){net_status(connection,"failed",name,"utun address, route or DNS setup failed");goto reconnect;}
            // A missing modem can delay CommCenter. Radio preferences must
            // never prevent the separate IP tunnel from forwarding packets.
            unsigned long radio;if(!pthread_create(&radio,0,net_disable_cellular,0))pthread_detach(radio);}
        net_status(connection,"ready",name,"");
#ifdef V86_NETWORK_PROBE
        net_is_ready=1;
#endif
        unsigned idle_ticks=0;
        for(;;)
        {
            unsigned count=0;
            for(;count<32;count++)
            {
                int n=read(fd,packet,sizeof(packet));if(n<0 && *__error()==35)break;
                if(n<1)goto reconnect;
#ifdef V86_NETWORK_PROBE
                static unsigned traced;if(traced++<8)printf("V86 utun packet %d: %02x %02x %02x %02x\n",n,packet[0],packet[1],packet[2],packet[3]);
#endif
                if(net_call(2,packet,n,connection)!=n)goto reconnect;
            }
            for(unsigned i=0;i<32;i++)
            {
                int n=net_call(3,packet,sizeof(packet),connection);if(n==-2)break;
                if(n<4 || write(fd,packet,n)!=n)goto reconnect;count++;
            }
            if(!count){usleep(10000);if(++idle_ticks==500){net_refresh();idle_ticks=0;}}
        }
reconnect:net_call(5,0,0,connection);usleep(1000000);
    }
    return 0;
}
#ifdef V86_NETWORK_PROBE
#include "network-probe.h"
#endif
void app_network_start(void)
{
    unsigned long thread;if(!pthread_create(&thread,0,net_main,0))pthread_detach(thread);
#ifdef V86_NETWORK_PROBE
    if(!pthread_create(&thread,0,network_probe,0))pthread_detach(thread);
#endif
}
