// Hot PL1 FP code with the MMU on: changing FPEXC through a helper must
// invalidate any earlier FP-access proof, in both instruction sets.
#include <a32.h>
#include <stdio.h>

static uint32_t table[4096] __attribute__((aligned(16384)));
uint32_t fp_disable_arm(void), fp_disable_thumb(void);
extern char fp_disable_arm_fault[], fp_disable_thumb_fault[];

int main(int argc, char **argv)
{
    for(unsigned i = 0x400; i < 0x440; i++) table[i] = i << 20 | 0xC0E;
    a32_mcr(0, c2, c0, 2, 0);
    a32_mcr(0, c2, c0, 0, (uint32_t)table);
    a32_mcr(0, c3, c0, 0, 1);
    a32_mcr(0, c1, c0, 2, 0xF << 20);
    a32_dsb();
    a32_isb();
    a32_mcr(0, c1, c0, 0, a32_mrc(0, c1, c0, 0) | 1);
    a32_isb();

    for(unsigned thumb = 0; thumb < 2; thumb++)
    {
        for(unsigned round = 0; round < 128; round++)
        {
            __asm__ volatile("vmsr fpexc, %0" :: "r"(1 << 30));
            a32_expect(4);
            uint32_t value = thumb ? fp_disable_thumb() : fp_disable_arm();
            struct a32_fault f;
            a32_caught(&f);
            uint32_t at = (uint32_t)(thumb ? fp_disable_thumb_fault : fp_disable_arm_fault);
            if(!f.taken || f.kind != A32_UND || f.pc != at || value != 0x40000000)
                a64_fail("FP access after FPEXC change");
        }
        printf("FP access %s: 128 precise faults, result 0x40000000\n", thumb ? "Thumb" : "ARM");
    }
    return 0;
}
