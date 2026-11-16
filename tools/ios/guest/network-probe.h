// Owner-firmware acceptance only (V86_NETWORK_PROBE). Never enabled in the
// shipped helper. DNS and HTTP run in a separate thread so utun can forward.
struct probe_host { char *name,**aliases; int family,length; unsigned char **addresses; };
extern struct probe_host *gethostbyname(const char *);
extern int setsockopt(int,int,int,const void *,unsigned);
static void *network_probe(void *unused)
{
    (void)unused;
    while(!net_is_ready)usleep(100000);
    void *sc=dlopen("/System/Library/Frameworks/SystemConfiguration.framework/SystemConfiguration",2);
    CFTypeRef (*copy)(CFTypeRef,CFStringRef)=sc?(CFTypeRef (*)(CFTypeRef,CFStringRef))dlsym(sc,"SCDynamicStoreCopyValue"):0;
    const char *keys[]={"State:/Network/Service/v86/IPv4","State:/Network/Service/v86/DNS","State:/Network/Global/IPv4","State:/Network/Global/DNS"};
    if(copy)for(unsigned i=0;i<4;i++){CFStringRef k=string(keys[i]);CFTypeRef value=copy(net_store,k);
        printf("V86 network store %s\n",keys[i]);CFShow(value);if(value)CFRelease(value);CFRelease(k);}
    int udp=socket(2,2,0);struct {long sec,usec;} udp_timeout={5,0};
    setsockopt(udp,0xffff,0x1006,&udp_timeout,sizeof(udp_timeout));
    const unsigned char server[4]={192,168,86,1};struct net_address dns_address=net_addr(server);dns_address.port=0x3500;
    const unsigned char query[]={0x12,0x34,1,0,0,1,0,0,0,0,0,0,7,'e','x','a','m','p','l','e',3,'c','o','m',0,0,1,0,1};
    int rc=connect(udp,&dns_address,sizeof(dns_address));printf("V86 network probe: UDP connect %d errno=%d\n",rc,*__error());
    rc=write(udp,query,sizeof(query));printf("V86 network probe: UDP write %d errno=%d\n",rc,*__error());
    unsigned char answer[1024];rc=read(udp,answer,sizeof(answer));printf("V86 network probe: UDP read %d errno=%d\n",rc,*__error());close(udp);
    usleep(10000000);
    CFTypeRef (*list_keys)(CFTypeRef,CFStringRef)=sc?(CFTypeRef (*)(CFTypeRef,CFStringRef))dlsym(sc,"SCDynamicStoreCopyKeyList"):0;
    if(list_keys){CFStringRef pattern=string(".*");CFTypeRef list=list_keys(net_store,pattern);CFShow(list);if(list)CFRelease(list);CFRelease(pattern);}
    if(copy)for(unsigned i=2;i<4;i++){CFStringRef k=string(keys[i]);CFTypeRef value=copy(net_store,k);
        printf("V86 network later %u\n",i);CFShow(value);if(value)CFRelease(value);CFRelease(k);}
    printf("V86 network probe: resolving example.com\n");
    struct probe_host *host=0;
    for(unsigned i=0;i<10 && !host;i++){host=gethostbyname("example.com");if(!host){printf("V86 network probe: DNS waiting %u\n",i);usleep(3000000);}}
    if(!host || host->family!=2 || host->length!=4 || !host->addresses[0]){
        printf("V86 network probe: DNS FAILED\n");return 0;}
    const unsigned char *ip=host->addresses[0];
    printf("V86 network probe: DNS %u.%u.%u.%u\n",ip[0],ip[1],ip[2],ip[3]);
    int fd=socket(2,1,0);if(fd<0)return 0;
    struct {long sec,usec;} timeout={20,0};
    setsockopt(fd,0xffff,0x1005,&timeout,sizeof(timeout));setsockopt(fd,0xffff,0x1006,&timeout,sizeof(timeout));
    struct net_address address=net_addr(ip);address.port=0x5000;
    if(connect(fd,&address,sizeof(address))<0){printf("V86 network probe: TCP FAILED errno=%d\n",*__error());close(fd);return 0;}
    const char request[]="GET / HTTP/1.0\r\nHost: example.com\r\nConnection: close\r\n\r\n";
    if(write(fd,request,sizeof(request)-1)!=sizeof(request)-1){close(fd);return 0;}
    char reply[1024];int n=read(fd,reply,sizeof(reply)-1);close(fd);
    if(n>0){reply[n]=0;printf("V86 network probe: HTTP %.100s\n",reply);}
    else printf("V86 network probe: HTTP FAILED errno=%d\n",*__error());
    return 0;
}
