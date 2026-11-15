// Hot PL1 thread-ID accesses on identity-mapped RAM, in both instruction
// sets. QEMU supplies the independent register/condition oracle.
#include <a32.h>
#include <stdio.h>

void thread_arm(uint32_t *out, uint32_t seed);
void thread_thumb(uint32_t *out, uint32_t seed);
static uint32_t table[4096] __attribute__((aligned(16384)));

int main(int argc, char **argv)
{
    for(unsigned i = 0x400; i < 0x480; i++) table[i] = i << 20 | 0xC0E;
    table[0x090] = 0x09000C02; // PL011 if the runtime needs it.
    a32_mcr(0,c2,c0,0,(uint32_t)table);
    a32_mcr(0,c2,c0,2,0);
    a32_mcr(0,c3,c0,0,1);
    a32_isb();
    a32_mcr(0,c1,c0,0,a32_mrc(0,c1,c0,0) | 1);
    a32_isb();
    for(unsigned n = 0; n < 6; n++)
    {
        uint32_t out[10];
        if(n & 1) thread_thumb(out,0xF1234567u + 0x1020304u * n);
        else thread_arm(out,0x81234567u + 0x1020304u * n);
        printf("tid %u:",n);
        for(unsigned i = 0; i < 10; i++) printf(" %x",(unsigned)out[i]);
        printf("\n");
    }
    return 0;
}
