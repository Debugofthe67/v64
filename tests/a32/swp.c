// Cortex-A8 legacy swaps, including the exact ARM word used by DH3.
#include <a32.h>
#include <stdio.h>

#define CHECK(test) do { if(!(test)) { printf("failed at line %d\n", __LINE__); return 1; } } while(0)
#define UNCHANGED 0xBADC0DEu
#define SWAP(instructions, address, value) ({ \
    register uint32_t dst __asm__("r0") = UNCHANGED; \
    register uint32_t base __asm__("r4") = (uint32_t)(address); \
    register uint32_t src __asm__("r5") = (value); \
    __asm__ volatile(instructions : "+r"(dst) : "r"(base), "r"(src) : "r2", "r3", "cc", "memory"); \
    dst; \
})

static uint32_t table[4096] __attribute__((aligned(16384)));
static volatile uint32_t *const word = (void *)0x41000000;

int main(int argc, char **argv)
{
    (void)argc;
    (void)argv;
    for(unsigned i = 0x400; i < 0x480; i++) table[i] = (i << 20) | 0xC0E;
    table[0x440] = 0x4100840E; // PL1 read-only alias.
    a32_mcr(0, c2, c0, 0, (uint32_t)table);
    a32_mcr(0, c2, c0, 2, 0);
    a32_mcr(0, c3, c0, 0, 1);
    const uint32_t sctlr = a32_mrc(0, c1, c0, 0) & ~((1 << 10) | (1 << 1));
    a32_mcr(0, c1, c0, 0, sctlr | 1);
    a32_isb();

    struct a32_fault fault;
    *word = 0x11223344;
    if((a32_mrc(0, c0, c0, 0) >> 4 & 0xFFF) != 0xC08)
    {
        a32_expect(4);
        CHECK(SWAP(".inst 0xe1040095", word, 1) == UNCHANGED);
        CHECK(a32_caught(&fault) && fault.kind == A32_UND && *word == 0x11223344);
        return 0;
    }

    // Repeat the same page so the JIT also runs the swap through its helper.
    for(unsigned n = 0; n < 128; n++)
    {
        *word = 0x11223344;
        CHECK(SWAP(".inst 0xe1040095", word, 0xA1B2C3D4) == 0x11223344);
        CHECK(*word == 0xA1B2C3D4);
        CHECK(SWAP(".inst 0xe1440095", (uint32_t)word + 1, 0xABCDEF18) == 0xC3);
        CHECK(*word == 0xA1B218D4);
        CHECK(SWAP("cmp r5, r5\n.inst 0x11040095", word, 0) == UNCHANGED);
        CHECK(*word == 0xA1B218D4);
    }

    // With alignment checking clear, the word swap itself still requires alignment.
    a32_expect(4);
    CHECK(SWAP(".inst 0xe1040095", (uint32_t)word + 1, 1) == UNCHANGED);
    CHECK(a32_caught(&fault) && fault.kind == A32_DABT && fault.far == (uint32_t)word + 1);
    CHECK((fault.fsr & 0xF) == 1 && *word == 0xA1B218D4);

    a32_expect(4);
    CHECK(SWAP(".inst 0xe1040095", 0x44000000, 1) == UNCHANGED);
    CHECK(a32_caught(&fault) && fault.kind == A32_DABT && fault.far == 0x44000000);
    CHECK((fault.fsr & 0xF) == 0xD && *word == 0xA1B218D4);

    CHECK(SWAP("mrs r3, cpsr\norr r2, r3, #0x200\nmsr cpsr_x, r2\n"
               ".inst 0xe1040095\nmsr cpsr_x, r3", word, 0x11223344) == 0xD418B2A1);
    CHECK(*word == 0x44332211);
    return 0;
}
