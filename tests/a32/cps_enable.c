// Independent QEMU oracle: hot ARM/Thumb CPSIE and its precise IRQ boundary.
#include <a32.h>
#include <stdio.h>

void enable_arm(uint32_t *, uint32_t), enable_thumb(uint32_t *, uint32_t);
void enable_pending_arm(volatile uint32_t *), enable_pending_thumb(volatile uint32_t *);
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
        uint32_t out[10], initial = 0x13 | (n & 7) << 6;
        if(n & 8) initial |= 0xA80A0000;
        for(unsigned thumb = 0; thumb < 2; thumb++)
        {
            if(thumb) enable_thumb(out,initial);
            else enable_arm(out,initial);
            printf("enable %u/%u:",n,thumb);
            for(unsigned i = 0; i < 10; i++) printf(" %x",(unsigned)out[i]);
            printf("\n");
        }
    }
    __asm__ volatile("cpsid i" ::: "memory");
    MMIO32(0x08000000) = 1;
    MMIO32(0x08000100) = 1 << 3;
    MMIO32(0x08000400) = 0xA0A0A0A0;
    MMIO32(0x08010004) = 0xF0;
    MMIO32(0x08010000) = 1;
    a32_interrupt_handler = irq;
    for(unsigned thumb = 0; thumb < 2; thumb++)
    {
        marker = observed = interrupts = saved_flags = 0;
        MMIO32(0x08000F00) = 2 << 24 | 3;
        a32_dsb();
        if(thumb) enable_pending_thumb(&marker);
        else enable_pending_arm(&marker);
        __asm__ volatile("cpsid i" ::: "memory");
        printf("irq %u: %u observed %u marker %u flags %x\n",thumb,
            (unsigned)interrupts,(unsigned)observed,(unsigned)marker,(unsigned)saved_flags);
    }
    return 0;
}
