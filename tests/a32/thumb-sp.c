#include <a32.h>

static uint32_t table[4096] __attribute__((aligned(16384)));

// Return SP's displacement from R7, with the Z flag in bit 0.
__attribute__((naked)) static int restore_sp(int subtract)
{
    __asm__ volatile(
        "push {r4, r7, lr}\n"
        "mov r4, sp\n"
        "mov r7, sp\n"
        "sub sp, #64\n"
        "cmp r0, #0\n"
        "bne 1f\n"
        ".inst.w 0xf1a70d00\n"
        "b 2f\n"
        "1: cmp r0, r0\n"
        ".inst.w 0xf1a70d18\n"
        "2: mrs r1, apsr\n"
        "mov r0, sp\n"
        "subs r0, r7, r0\n"
        "ubfx r1, r1, #30, #1\n"
        "orrs r0, r1\n"
        "mov sp, r4\n"
        "pop {r4, r7, pc}\n");
}

int main(int argc, char **argv)
{
    (void)argc;
    (void)argv;
    for(unsigned i = 0x400; i < 0x480; i++) table[i] = (i << 20) | 0xC0E;
    a32_mcr(0, c2, c0, 0, (uint32_t)table);
    a32_mcr(0, c2, c0, 2, 0);
    a32_mcr(0, c3, c0, 0, 1);
    a32_mcr(0, c1, c0, 0, a32_mrc(0, c1, c0, 0) | 1);
    a32_isb();
    if(((a32_mrc(0, c0, c0, 0) >> 4) & 0xFFF) == 0xC08)
    {
        for(unsigned i = 0; i < 128; i++)
        {
            if(restore_sp(0) != 1 || restore_sp(1) != 25) return 1;
        }
    }
    else
    {
        struct a32_fault fault;
        a32_expect(4);
        if(restore_sp(0) != 65 || !a32_caught(&fault) || fault.kind != A32_UND) return 2;
    }
    return 0;
}
