// Independent QEMU oracle for guarded same-mode CPSR mask restoration.
#include <a32.h>
#include <stdio.h>

void restore_arm(uint32_t *, uint32_t);
void restore_pending(volatile uint32_t *, uint32_t);
static uint32_t table[4096] __attribute__((aligned(16384)));
static volatile uint32_t marker, observed, interrupts, saved_flags;
#define MMIO32(a) (*(volatile uint32_t *)(a))

static void irq(struct a32_frame *frame, int kind)
{
    uint32_t iar = MMIO32(0x0801000C);
    observed = marker;
    saved_flags = frame->cpsr;
    interrupts++;
    MMIO32(0x08010010) = iar;
    (void)kind;
}

int main(int argc, char **argv)
{
    for(unsigned i = 0x400; i < 0x480; i++) table[i] = i << 20 | 0xC0E;
    table[0x080] = 0x08000C02;
    table[0x090] = 0x09000C02;
    a32_mcr(0,c2,c0,0,(uint32_t)table);
    a32_mcr(0,c2,c0,2,0);
    a32_mcr(0,c3,c0,0,1);
    a32_isb();
    a32_mcr(0,c1,c0,0,a32_mrc(0,c1,c0,0) | 1);
    a32_isb();
    for(unsigned n = 0; n < 16; n++)
    {
        // Source E/T bits are ignored by c/fc; A and GE are preserved.
        uint32_t out[10], value = 0x233 | (n & 3) << 6;
        if(n & 4) value |= 0xA8000000;
        uint32_t ge = n & 8 ? 0xA0000 : 0;
        __asm__ volatile("msr apsr_g,%0" :: "r"(ge) : "memory");
        restore_arm(out,value);
        printf("restore %u:",n);
        for(unsigned i = 0; i < 10; i++) printf(" %x",(unsigned)out[i]);
        printf("\n");
    }
    __asm__ volatile("cpsid i" ::: "memory");
    MMIO32(0x08000000) = 1;
    MMIO32(0x08000100) = 1 << 3;
    MMIO32(0x08000400) = 0xA0A0A0A0;
    MMIO32(0x08010004) = 0xF0;
    MMIO32(0x08010000) = 1;
    a32_interrupt_handler = irq;
    MMIO32(0x08000F00) = 2 << 24 | 3;
    a32_dsb();
    restore_pending(&marker,0xA8000273);
    __asm__ volatile("cpsid i" ::: "memory");
    printf("irq: %u observed %u marker %u flags %x\n",(unsigned)interrupts,
        (unsigned)observed,(unsigned)marker,(unsigned)saved_flags);
    return 0;
}
