// Clear IXC: exact zero/cancellation/power-of-two arithmetic keeps it clear.
// Inexact, tiny, overflow and a single non-exact lane still use precise arithmetic.
    .syntax unified
    .fpu crypto-neon-fp-armv8
    .arm
base:
    .word 256
    .word a_d_0_add_zero - base, 0, 0x130
    .word a_d_0_add_cancel - base, 0, 0x130
    .word a_d_0_add_power - base, 0, 0x130
    .word a_d_0_add_round - base, 0, 0x130
    .word a_d_0_add_tiny - base, 0, 0x130
    .word a_d_0_add_overflow - base, 0, 0x130
    .word a_d_0_add_partial - base, 0, 0x130
    .word a_d_0_add_negzero - base, 0, 0x130
    .word a_d_0_sub_zero - base, 0, 0x130
    .word a_d_0_sub_cancel - base, 0, 0x130
    .word a_d_0_sub_power - base, 0, 0x130
    .word a_d_0_sub_round - base, 0, 0x130
    .word a_d_0_sub_tiny - base, 0, 0x130
    .word a_d_0_sub_overflow - base, 0, 0x130
    .word a_d_0_sub_partial - base, 0, 0x130
    .word a_d_0_sub_negzero - base, 0, 0x130
    .word a_d_0_mul_zero - base, 0, 0x130
    .word a_d_0_mul_cancel - base, 0, 0x130
    .word a_d_0_mul_power - base, 0, 0x130
    .word a_d_0_mul_round - base, 0, 0x130
    .word a_d_0_mul_tiny - base, 0, 0x130
    .word a_d_0_mul_overflow - base, 0, 0x130
    .word a_d_0_mul_partial - base, 0, 0x130
    .word a_d_0_mul_negzero - base, 0, 0x130
    .word a_d_0_mla_zero - base, 0, 0x130
    .word a_d_0_mla_cancel - base, 0, 0x130
    .word a_d_0_mla_power - base, 0, 0x130
    .word a_d_0_mla_round - base, 0, 0x130
    .word a_d_0_mla_tiny - base, 0, 0x130
    .word a_d_0_mla_overflow - base, 0, 0x130
    .word a_d_0_mla_partial - base, 0, 0x130
    .word a_d_0_mla_negzero - base, 0, 0x130
    .word a_d_0_mls_zero - base, 0, 0x130
    .word a_d_0_mls_cancel - base, 0, 0x130
    .word a_d_0_mls_power - base, 0, 0x130
    .word a_d_0_mls_round - base, 0, 0x130
    .word a_d_0_mls_tiny - base, 0, 0x130
    .word a_d_0_mls_overflow - base, 0, 0x130
    .word a_d_0_mls_partial - base, 0, 0x130
    .word a_d_0_mls_negzero - base, 0, 0x130
    .word a_d_1_mul_zero - base, 0, 0x130
    .word a_d_1_mul_cancel - base, 0, 0x130
    .word a_d_1_mul_power - base, 0, 0x130
    .word a_d_1_mul_round - base, 0, 0x130
    .word a_d_1_mul_tiny - base, 0, 0x130
    .word a_d_1_mul_overflow - base, 0, 0x130
    .word a_d_1_mul_partial - base, 0, 0x130
    .word a_d_1_mul_negzero - base, 0, 0x130
    .word a_d_1_mla_zero - base, 0, 0x130
    .word a_d_1_mla_cancel - base, 0, 0x130
    .word a_d_1_mla_power - base, 0, 0x130
    .word a_d_1_mla_round - base, 0, 0x130
    .word a_d_1_mla_tiny - base, 0, 0x130
    .word a_d_1_mla_overflow - base, 0, 0x130
    .word a_d_1_mla_partial - base, 0, 0x130
    .word a_d_1_mla_negzero - base, 0, 0x130
    .word a_d_1_mls_zero - base, 0, 0x130
    .word a_d_1_mls_cancel - base, 0, 0x130
    .word a_d_1_mls_power - base, 0, 0x130
    .word a_d_1_mls_round - base, 0, 0x130
    .word a_d_1_mls_tiny - base, 0, 0x130
    .word a_d_1_mls_overflow - base, 0, 0x130
    .word a_d_1_mls_partial - base, 0, 0x130
    .word a_d_1_mls_negzero - base, 0, 0x130
    .word a_q_0_add_zero - base, 0, 0x130
    .word a_q_0_add_cancel - base, 0, 0x130
    .word a_q_0_add_power - base, 0, 0x130
    .word a_q_0_add_round - base, 0, 0x130
    .word a_q_0_add_tiny - base, 0, 0x130
    .word a_q_0_add_overflow - base, 0, 0x130
    .word a_q_0_add_partial - base, 0, 0x130
    .word a_q_0_add_negzero - base, 0, 0x130
    .word a_q_0_sub_zero - base, 0, 0x130
    .word a_q_0_sub_cancel - base, 0, 0x130
    .word a_q_0_sub_power - base, 0, 0x130
    .word a_q_0_sub_round - base, 0, 0x130
    .word a_q_0_sub_tiny - base, 0, 0x130
    .word a_q_0_sub_overflow - base, 0, 0x130
    .word a_q_0_sub_partial - base, 0, 0x130
    .word a_q_0_sub_negzero - base, 0, 0x130
    .word a_q_0_mul_zero - base, 0, 0x130
    .word a_q_0_mul_cancel - base, 0, 0x130
    .word a_q_0_mul_power - base, 0, 0x130
    .word a_q_0_mul_round - base, 0, 0x130
    .word a_q_0_mul_tiny - base, 0, 0x130
    .word a_q_0_mul_overflow - base, 0, 0x130
    .word a_q_0_mul_partial - base, 0, 0x130
    .word a_q_0_mul_negzero - base, 0, 0x130
    .word a_q_0_mla_zero - base, 0, 0x130
    .word a_q_0_mla_cancel - base, 0, 0x130
    .word a_q_0_mla_power - base, 0, 0x130
    .word a_q_0_mla_round - base, 0, 0x130
    .word a_q_0_mla_tiny - base, 0, 0x130
    .word a_q_0_mla_overflow - base, 0, 0x130
    .word a_q_0_mla_partial - base, 0, 0x130
    .word a_q_0_mla_negzero - base, 0, 0x130
    .word a_q_0_mls_zero - base, 0, 0x130
    .word a_q_0_mls_cancel - base, 0, 0x130
    .word a_q_0_mls_power - base, 0, 0x130
    .word a_q_0_mls_round - base, 0, 0x130
    .word a_q_0_mls_tiny - base, 0, 0x130
    .word a_q_0_mls_overflow - base, 0, 0x130
    .word a_q_0_mls_partial - base, 0, 0x130
    .word a_q_0_mls_negzero - base, 0, 0x130
    .word a_q_1_mul_zero - base, 0, 0x130
    .word a_q_1_mul_cancel - base, 0, 0x130
    .word a_q_1_mul_power - base, 0, 0x130
    .word a_q_1_mul_round - base, 0, 0x130
    .word a_q_1_mul_tiny - base, 0, 0x130
    .word a_q_1_mul_overflow - base, 0, 0x130
    .word a_q_1_mul_partial - base, 0, 0x130
    .word a_q_1_mul_negzero - base, 0, 0x130
    .word a_q_1_mla_zero - base, 0, 0x130
    .word a_q_1_mla_cancel - base, 0, 0x130
    .word a_q_1_mla_power - base, 0, 0x130
    .word a_q_1_mla_round - base, 0, 0x130
    .word a_q_1_mla_tiny - base, 0, 0x130
    .word a_q_1_mla_overflow - base, 0, 0x130
    .word a_q_1_mla_partial - base, 0, 0x130
    .word a_q_1_mla_negzero - base, 0, 0x130
    .word a_q_1_mls_zero - base, 0, 0x130
    .word a_q_1_mls_cancel - base, 0, 0x130
    .word a_q_1_mls_power - base, 0, 0x130
    .word a_q_1_mls_round - base, 0, 0x130
    .word a_q_1_mls_tiny - base, 0, 0x130
    .word a_q_1_mls_overflow - base, 0, 0x130
    .word a_q_1_mls_partial - base, 0, 0x130
    .word a_q_1_mls_negzero - base, 0, 0x130
    .word t_d_0_add_zero - base + 1, 0, 0x130
    .word t_d_0_add_cancel - base + 1, 0, 0x130
    .word t_d_0_add_power - base + 1, 0, 0x130
    .word t_d_0_add_round - base + 1, 0, 0x130
    .word t_d_0_add_tiny - base + 1, 0, 0x130
    .word t_d_0_add_overflow - base + 1, 0, 0x130
    .word t_d_0_add_partial - base + 1, 0, 0x130
    .word t_d_0_add_negzero - base + 1, 0, 0x130
    .word t_d_0_sub_zero - base + 1, 0, 0x130
    .word t_d_0_sub_cancel - base + 1, 0, 0x130
    .word t_d_0_sub_power - base + 1, 0, 0x130
    .word t_d_0_sub_round - base + 1, 0, 0x130
    .word t_d_0_sub_tiny - base + 1, 0, 0x130
    .word t_d_0_sub_overflow - base + 1, 0, 0x130
    .word t_d_0_sub_partial - base + 1, 0, 0x130
    .word t_d_0_sub_negzero - base + 1, 0, 0x130
    .word t_d_0_mul_zero - base + 1, 0, 0x130
    .word t_d_0_mul_cancel - base + 1, 0, 0x130
    .word t_d_0_mul_power - base + 1, 0, 0x130
    .word t_d_0_mul_round - base + 1, 0, 0x130
    .word t_d_0_mul_tiny - base + 1, 0, 0x130
    .word t_d_0_mul_overflow - base + 1, 0, 0x130
    .word t_d_0_mul_partial - base + 1, 0, 0x130
    .word t_d_0_mul_negzero - base + 1, 0, 0x130
    .word t_d_0_mla_zero - base + 1, 0, 0x130
    .word t_d_0_mla_cancel - base + 1, 0, 0x130
    .word t_d_0_mla_power - base + 1, 0, 0x130
    .word t_d_0_mla_round - base + 1, 0, 0x130
    .word t_d_0_mla_tiny - base + 1, 0, 0x130
    .word t_d_0_mla_overflow - base + 1, 0, 0x130
    .word t_d_0_mla_partial - base + 1, 0, 0x130
    .word t_d_0_mla_negzero - base + 1, 0, 0x130
    .word t_d_0_mls_zero - base + 1, 0, 0x130
    .word t_d_0_mls_cancel - base + 1, 0, 0x130
    .word t_d_0_mls_power - base + 1, 0, 0x130
    .word t_d_0_mls_round - base + 1, 0, 0x130
    .word t_d_0_mls_tiny - base + 1, 0, 0x130
    .word t_d_0_mls_overflow - base + 1, 0, 0x130
    .word t_d_0_mls_partial - base + 1, 0, 0x130
    .word t_d_0_mls_negzero - base + 1, 0, 0x130
    .word t_d_1_mul_zero - base + 1, 0, 0x130
    .word t_d_1_mul_cancel - base + 1, 0, 0x130
    .word t_d_1_mul_power - base + 1, 0, 0x130
    .word t_d_1_mul_round - base + 1, 0, 0x130
    .word t_d_1_mul_tiny - base + 1, 0, 0x130
    .word t_d_1_mul_overflow - base + 1, 0, 0x130
    .word t_d_1_mul_partial - base + 1, 0, 0x130
    .word t_d_1_mul_negzero - base + 1, 0, 0x130
    .word t_d_1_mla_zero - base + 1, 0, 0x130
    .word t_d_1_mla_cancel - base + 1, 0, 0x130
    .word t_d_1_mla_power - base + 1, 0, 0x130
    .word t_d_1_mla_round - base + 1, 0, 0x130
    .word t_d_1_mla_tiny - base + 1, 0, 0x130
    .word t_d_1_mla_overflow - base + 1, 0, 0x130
    .word t_d_1_mla_partial - base + 1, 0, 0x130
    .word t_d_1_mla_negzero - base + 1, 0, 0x130
    .word t_d_1_mls_zero - base + 1, 0, 0x130
    .word t_d_1_mls_cancel - base + 1, 0, 0x130
    .word t_d_1_mls_power - base + 1, 0, 0x130
    .word t_d_1_mls_round - base + 1, 0, 0x130
    .word t_d_1_mls_tiny - base + 1, 0, 0x130
    .word t_d_1_mls_overflow - base + 1, 0, 0x130
    .word t_d_1_mls_partial - base + 1, 0, 0x130
    .word t_d_1_mls_negzero - base + 1, 0, 0x130
    .word t_q_0_add_zero - base + 1, 0, 0x130
    .word t_q_0_add_cancel - base + 1, 0, 0x130
    .word t_q_0_add_power - base + 1, 0, 0x130
    .word t_q_0_add_round - base + 1, 0, 0x130
    .word t_q_0_add_tiny - base + 1, 0, 0x130
    .word t_q_0_add_overflow - base + 1, 0, 0x130
    .word t_q_0_add_partial - base + 1, 0, 0x130
    .word t_q_0_add_negzero - base + 1, 0, 0x130
    .word t_q_0_sub_zero - base + 1, 0, 0x130
    .word t_q_0_sub_cancel - base + 1, 0, 0x130
    .word t_q_0_sub_power - base + 1, 0, 0x130
    .word t_q_0_sub_round - base + 1, 0, 0x130
    .word t_q_0_sub_tiny - base + 1, 0, 0x130
    .word t_q_0_sub_overflow - base + 1, 0, 0x130
    .word t_q_0_sub_partial - base + 1, 0, 0x130
    .word t_q_0_sub_negzero - base + 1, 0, 0x130
    .word t_q_0_mul_zero - base + 1, 0, 0x130
    .word t_q_0_mul_cancel - base + 1, 0, 0x130
    .word t_q_0_mul_power - base + 1, 0, 0x130
    .word t_q_0_mul_round - base + 1, 0, 0x130
    .word t_q_0_mul_tiny - base + 1, 0, 0x130
    .word t_q_0_mul_overflow - base + 1, 0, 0x130
    .word t_q_0_mul_partial - base + 1, 0, 0x130
    .word t_q_0_mul_negzero - base + 1, 0, 0x130
    .word t_q_0_mla_zero - base + 1, 0, 0x130
    .word t_q_0_mla_cancel - base + 1, 0, 0x130
    .word t_q_0_mla_power - base + 1, 0, 0x130
    .word t_q_0_mla_round - base + 1, 0, 0x130
    .word t_q_0_mla_tiny - base + 1, 0, 0x130
    .word t_q_0_mla_overflow - base + 1, 0, 0x130
    .word t_q_0_mla_partial - base + 1, 0, 0x130
    .word t_q_0_mla_negzero - base + 1, 0, 0x130
    .word t_q_0_mls_zero - base + 1, 0, 0x130
    .word t_q_0_mls_cancel - base + 1, 0, 0x130
    .word t_q_0_mls_power - base + 1, 0, 0x130
    .word t_q_0_mls_round - base + 1, 0, 0x130
    .word t_q_0_mls_tiny - base + 1, 0, 0x130
    .word t_q_0_mls_overflow - base + 1, 0, 0x130
    .word t_q_0_mls_partial - base + 1, 0, 0x130
    .word t_q_0_mls_negzero - base + 1, 0, 0x130
    .word t_q_1_mul_zero - base + 1, 0, 0x130
    .word t_q_1_mul_cancel - base + 1, 0, 0x130
    .word t_q_1_mul_power - base + 1, 0, 0x130
    .word t_q_1_mul_round - base + 1, 0, 0x130
    .word t_q_1_mul_tiny - base + 1, 0, 0x130
    .word t_q_1_mul_overflow - base + 1, 0, 0x130
    .word t_q_1_mul_partial - base + 1, 0, 0x130
    .word t_q_1_mul_negzero - base + 1, 0, 0x130
    .word t_q_1_mla_zero - base + 1, 0, 0x130
    .word t_q_1_mla_cancel - base + 1, 0, 0x130
    .word t_q_1_mla_power - base + 1, 0, 0x130
    .word t_q_1_mla_round - base + 1, 0, 0x130
    .word t_q_1_mla_tiny - base + 1, 0, 0x130
    .word t_q_1_mla_overflow - base + 1, 0, 0x130
    .word t_q_1_mla_partial - base + 1, 0, 0x130
    .word t_q_1_mla_negzero - base + 1, 0, 0x130
    .word t_q_1_mls_zero - base + 1, 0, 0x130
    .word t_q_1_mls_cancel - base + 1, 0, 0x130
    .word t_q_1_mls_power - base + 1, 0, 0x130
    .word t_q_1_mls_round - base + 1, 0, 0x130
    .word t_q_1_mls_tiny - base + 1, 0, 0x130
    .word t_q_1_mls_overflow - base + 1, 0, 0x130
    .word t_q_1_mls_partial - base + 1, 0, 0x130
    .word t_q_1_mls_negzero - base + 1, 0, 0x130

    .macro exercise name, shape, scalar, op, a, b, acc, last
\name:
    movw r0,#(\a & 0xffff)
    movt r0,#(\a >> 16)
    vdup.32 q1,r0
    movw r0,#(\last & 0xffff)
    movt r0,#(\last >> 16)
    .ifc \shape,q
        vmov.32 d3[1],r0
    .else
        vmov.32 d2[1],r0
    .endif
    movw r1,#(\b & 0xffff)
    movt r1,#(\b >> 16)
    vdup.32 q2,r1
    movw r2,#(\acc & 0xffff)
    movt r2,#(\acc >> 16)
    vdup.32 q4,r2
    movw r12,#128
1:  movw r0,#0
    movt r0,#0x03c0
    vmsr fpscr,r0
    vmov d0,d8
    vmov d1,d9
    .ifc \shape,q
        .if \scalar
            v\op\().f32 q0,q1,d4[1]
        .else
            v\op\().f32 q0,q1,q2
        .endif
    .else
        .if \scalar
            v\op\().f32 d0,d2,d4[1]
        .else
            v\op\().f32 d0,d2,d4
        .endif
    .endif
    subs r12,r12,#1
    bne 1b
    vmov r4,r5,d0
    vmov r6,r7,d1
    vmrs r3,fpscr
    svc #0
    .endm

    .arm
    .balign 4
    exercise a_d_0_add_zero, d, 0, add, 0x00000000, 0x3fc00000, 0x00000000, 0x00000000
    exercise a_d_0_add_cancel, d, 0, add, 0x3fc00000, 0xbfc00000, 0x00000000, 0x3fc00000
    exercise a_d_0_add_power, d, 0, add, 0x3fc00000, 0x40000000, 0xc0400000, 0x3fc00000
    exercise a_d_0_add_round, d, 0, add, 0x3f800001, 0x3f7fffff, 0xbf800000, 0x3f800001
    exercise a_d_0_add_tiny, d, 0, add, 0x00800000, 0x3f000000, 0x00000000, 0x00800000
    exercise a_d_0_add_overflow, d, 0, add, 0x7f7fffff, 0x40000000, 0x00000000, 0x7f7fffff
    exercise a_d_0_add_partial, d, 0, add, 0x00000000, 0x3fc00000, 0x00000000, 0x3f800001
    exercise a_d_0_add_negzero, d, 0, add, 0x80000000, 0x00000000, 0x80000000, 0x80000000
    exercise a_d_0_sub_zero, d, 0, sub, 0x00000000, 0x3fc00000, 0x00000000, 0x00000000
    exercise a_d_0_sub_cancel, d, 0, sub, 0x3fc00000, 0xbfc00000, 0x00000000, 0x3fc00000
    exercise a_d_0_sub_power, d, 0, sub, 0x3fc00000, 0x40000000, 0xc0400000, 0x3fc00000
    exercise a_d_0_sub_round, d, 0, sub, 0x3f800001, 0x3f7fffff, 0xbf800000, 0x3f800001
    exercise a_d_0_sub_tiny, d, 0, sub, 0x00800000, 0x3f000000, 0x00000000, 0x00800000
    exercise a_d_0_sub_overflow, d, 0, sub, 0x7f7fffff, 0x40000000, 0x00000000, 0x7f7fffff
    exercise a_d_0_sub_partial, d, 0, sub, 0x00000000, 0x3fc00000, 0x00000000, 0x3f800001
    exercise a_d_0_sub_negzero, d, 0, sub, 0x80000000, 0x00000000, 0x80000000, 0x80000000
    exercise a_d_0_mul_zero, d, 0, mul, 0x00000000, 0x3fc00000, 0x00000000, 0x00000000
    exercise a_d_0_mul_cancel, d, 0, mul, 0x3fc00000, 0xbfc00000, 0x00000000, 0x3fc00000
    exercise a_d_0_mul_power, d, 0, mul, 0x3fc00000, 0x40000000, 0xc0400000, 0x3fc00000
    exercise a_d_0_mul_round, d, 0, mul, 0x3f800001, 0x3f7fffff, 0xbf800000, 0x3f800001
    exercise a_d_0_mul_tiny, d, 0, mul, 0x00800000, 0x3f000000, 0x00000000, 0x00800000
    exercise a_d_0_mul_overflow, d, 0, mul, 0x7f7fffff, 0x40000000, 0x00000000, 0x7f7fffff
    exercise a_d_0_mul_partial, d, 0, mul, 0x00000000, 0x3fc00000, 0x00000000, 0x3f800001
    exercise a_d_0_mul_negzero, d, 0, mul, 0x80000000, 0x00000000, 0x80000000, 0x80000000
    exercise a_d_0_mla_zero, d, 0, mla, 0x00000000, 0x3fc00000, 0x00000000, 0x00000000
    exercise a_d_0_mla_cancel, d, 0, mla, 0x3fc00000, 0xbfc00000, 0x00000000, 0x3fc00000
    exercise a_d_0_mla_power, d, 0, mla, 0x3fc00000, 0x40000000, 0xc0400000, 0x3fc00000
    exercise a_d_0_mla_round, d, 0, mla, 0x3f800001, 0x3f7fffff, 0xbf800000, 0x3f800001
    exercise a_d_0_mla_tiny, d, 0, mla, 0x00800000, 0x3f000000, 0x00000000, 0x00800000
    exercise a_d_0_mla_overflow, d, 0, mla, 0x7f7fffff, 0x40000000, 0x00000000, 0x7f7fffff
    exercise a_d_0_mla_partial, d, 0, mla, 0x00000000, 0x3fc00000, 0x00000000, 0x3f800001
    exercise a_d_0_mla_negzero, d, 0, mla, 0x80000000, 0x00000000, 0x80000000, 0x80000000
    exercise a_d_0_mls_zero, d, 0, mls, 0x00000000, 0x3fc00000, 0x00000000, 0x00000000
    exercise a_d_0_mls_cancel, d, 0, mls, 0x3fc00000, 0xbfc00000, 0x00000000, 0x3fc00000
    exercise a_d_0_mls_power, d, 0, mls, 0x3fc00000, 0x40000000, 0xc0400000, 0x3fc00000
    exercise a_d_0_mls_round, d, 0, mls, 0x3f800001, 0x3f7fffff, 0xbf800000, 0x3f800001
    exercise a_d_0_mls_tiny, d, 0, mls, 0x00800000, 0x3f000000, 0x00000000, 0x00800000
    exercise a_d_0_mls_overflow, d, 0, mls, 0x7f7fffff, 0x40000000, 0x00000000, 0x7f7fffff
    exercise a_d_0_mls_partial, d, 0, mls, 0x00000000, 0x3fc00000, 0x00000000, 0x3f800001
    exercise a_d_0_mls_negzero, d, 0, mls, 0x80000000, 0x00000000, 0x80000000, 0x80000000
    exercise a_d_1_mul_zero, d, 1, mul, 0x00000000, 0x3fc00000, 0x00000000, 0x00000000
    exercise a_d_1_mul_cancel, d, 1, mul, 0x3fc00000, 0xbfc00000, 0x00000000, 0x3fc00000
    exercise a_d_1_mul_power, d, 1, mul, 0x3fc00000, 0x40000000, 0xc0400000, 0x3fc00000
    exercise a_d_1_mul_round, d, 1, mul, 0x3f800001, 0x3f7fffff, 0xbf800000, 0x3f800001
    exercise a_d_1_mul_tiny, d, 1, mul, 0x00800000, 0x3f000000, 0x00000000, 0x00800000
    exercise a_d_1_mul_overflow, d, 1, mul, 0x7f7fffff, 0x40000000, 0x00000000, 0x7f7fffff
    exercise a_d_1_mul_partial, d, 1, mul, 0x00000000, 0x3fc00000, 0x00000000, 0x3f800001
    exercise a_d_1_mul_negzero, d, 1, mul, 0x80000000, 0x00000000, 0x80000000, 0x80000000
    exercise a_d_1_mla_zero, d, 1, mla, 0x00000000, 0x3fc00000, 0x00000000, 0x00000000
    exercise a_d_1_mla_cancel, d, 1, mla, 0x3fc00000, 0xbfc00000, 0x00000000, 0x3fc00000
    exercise a_d_1_mla_power, d, 1, mla, 0x3fc00000, 0x40000000, 0xc0400000, 0x3fc00000
    exercise a_d_1_mla_round, d, 1, mla, 0x3f800001, 0x3f7fffff, 0xbf800000, 0x3f800001
    exercise a_d_1_mla_tiny, d, 1, mla, 0x00800000, 0x3f000000, 0x00000000, 0x00800000
    exercise a_d_1_mla_overflow, d, 1, mla, 0x7f7fffff, 0x40000000, 0x00000000, 0x7f7fffff
    exercise a_d_1_mla_partial, d, 1, mla, 0x00000000, 0x3fc00000, 0x00000000, 0x3f800001
    exercise a_d_1_mla_negzero, d, 1, mla, 0x80000000, 0x00000000, 0x80000000, 0x80000000
    exercise a_d_1_mls_zero, d, 1, mls, 0x00000000, 0x3fc00000, 0x00000000, 0x00000000
    exercise a_d_1_mls_cancel, d, 1, mls, 0x3fc00000, 0xbfc00000, 0x00000000, 0x3fc00000
    exercise a_d_1_mls_power, d, 1, mls, 0x3fc00000, 0x40000000, 0xc0400000, 0x3fc00000
    exercise a_d_1_mls_round, d, 1, mls, 0x3f800001, 0x3f7fffff, 0xbf800000, 0x3f800001
    exercise a_d_1_mls_tiny, d, 1, mls, 0x00800000, 0x3f000000, 0x00000000, 0x00800000
    exercise a_d_1_mls_overflow, d, 1, mls, 0x7f7fffff, 0x40000000, 0x00000000, 0x7f7fffff
    exercise a_d_1_mls_partial, d, 1, mls, 0x00000000, 0x3fc00000, 0x00000000, 0x3f800001
    exercise a_d_1_mls_negzero, d, 1, mls, 0x80000000, 0x00000000, 0x80000000, 0x80000000
    exercise a_q_0_add_zero, q, 0, add, 0x00000000, 0x3fc00000, 0x00000000, 0x00000000
    exercise a_q_0_add_cancel, q, 0, add, 0x3fc00000, 0xbfc00000, 0x00000000, 0x3fc00000
    exercise a_q_0_add_power, q, 0, add, 0x3fc00000, 0x40000000, 0xc0400000, 0x3fc00000
    exercise a_q_0_add_round, q, 0, add, 0x3f800001, 0x3f7fffff, 0xbf800000, 0x3f800001
    exercise a_q_0_add_tiny, q, 0, add, 0x00800000, 0x3f000000, 0x00000000, 0x00800000
    exercise a_q_0_add_overflow, q, 0, add, 0x7f7fffff, 0x40000000, 0x00000000, 0x7f7fffff
    exercise a_q_0_add_partial, q, 0, add, 0x00000000, 0x3fc00000, 0x00000000, 0x3f800001
    exercise a_q_0_add_negzero, q, 0, add, 0x80000000, 0x00000000, 0x80000000, 0x80000000
    exercise a_q_0_sub_zero, q, 0, sub, 0x00000000, 0x3fc00000, 0x00000000, 0x00000000
    exercise a_q_0_sub_cancel, q, 0, sub, 0x3fc00000, 0xbfc00000, 0x00000000, 0x3fc00000
    exercise a_q_0_sub_power, q, 0, sub, 0x3fc00000, 0x40000000, 0xc0400000, 0x3fc00000
    exercise a_q_0_sub_round, q, 0, sub, 0x3f800001, 0x3f7fffff, 0xbf800000, 0x3f800001
    exercise a_q_0_sub_tiny, q, 0, sub, 0x00800000, 0x3f000000, 0x00000000, 0x00800000
    exercise a_q_0_sub_overflow, q, 0, sub, 0x7f7fffff, 0x40000000, 0x00000000, 0x7f7fffff
    exercise a_q_0_sub_partial, q, 0, sub, 0x00000000, 0x3fc00000, 0x00000000, 0x3f800001
    exercise a_q_0_sub_negzero, q, 0, sub, 0x80000000, 0x00000000, 0x80000000, 0x80000000
    exercise a_q_0_mul_zero, q, 0, mul, 0x00000000, 0x3fc00000, 0x00000000, 0x00000000
    exercise a_q_0_mul_cancel, q, 0, mul, 0x3fc00000, 0xbfc00000, 0x00000000, 0x3fc00000
    exercise a_q_0_mul_power, q, 0, mul, 0x3fc00000, 0x40000000, 0xc0400000, 0x3fc00000
    exercise a_q_0_mul_round, q, 0, mul, 0x3f800001, 0x3f7fffff, 0xbf800000, 0x3f800001
    exercise a_q_0_mul_tiny, q, 0, mul, 0x00800000, 0x3f000000, 0x00000000, 0x00800000
    exercise a_q_0_mul_overflow, q, 0, mul, 0x7f7fffff, 0x40000000, 0x00000000, 0x7f7fffff
    exercise a_q_0_mul_partial, q, 0, mul, 0x00000000, 0x3fc00000, 0x00000000, 0x3f800001
    exercise a_q_0_mul_negzero, q, 0, mul, 0x80000000, 0x00000000, 0x80000000, 0x80000000
    exercise a_q_0_mla_zero, q, 0, mla, 0x00000000, 0x3fc00000, 0x00000000, 0x00000000
    exercise a_q_0_mla_cancel, q, 0, mla, 0x3fc00000, 0xbfc00000, 0x00000000, 0x3fc00000
    exercise a_q_0_mla_power, q, 0, mla, 0x3fc00000, 0x40000000, 0xc0400000, 0x3fc00000
    exercise a_q_0_mla_round, q, 0, mla, 0x3f800001, 0x3f7fffff, 0xbf800000, 0x3f800001
    exercise a_q_0_mla_tiny, q, 0, mla, 0x00800000, 0x3f000000, 0x00000000, 0x00800000
    exercise a_q_0_mla_overflow, q, 0, mla, 0x7f7fffff, 0x40000000, 0x00000000, 0x7f7fffff
    exercise a_q_0_mla_partial, q, 0, mla, 0x00000000, 0x3fc00000, 0x00000000, 0x3f800001
    exercise a_q_0_mla_negzero, q, 0, mla, 0x80000000, 0x00000000, 0x80000000, 0x80000000
    exercise a_q_0_mls_zero, q, 0, mls, 0x00000000, 0x3fc00000, 0x00000000, 0x00000000
    exercise a_q_0_mls_cancel, q, 0, mls, 0x3fc00000, 0xbfc00000, 0x00000000, 0x3fc00000
    exercise a_q_0_mls_power, q, 0, mls, 0x3fc00000, 0x40000000, 0xc0400000, 0x3fc00000
    exercise a_q_0_mls_round, q, 0, mls, 0x3f800001, 0x3f7fffff, 0xbf800000, 0x3f800001
    exercise a_q_0_mls_tiny, q, 0, mls, 0x00800000, 0x3f000000, 0x00000000, 0x00800000
    exercise a_q_0_mls_overflow, q, 0, mls, 0x7f7fffff, 0x40000000, 0x00000000, 0x7f7fffff
    exercise a_q_0_mls_partial, q, 0, mls, 0x00000000, 0x3fc00000, 0x00000000, 0x3f800001
    exercise a_q_0_mls_negzero, q, 0, mls, 0x80000000, 0x00000000, 0x80000000, 0x80000000
    exercise a_q_1_mul_zero, q, 1, mul, 0x00000000, 0x3fc00000, 0x00000000, 0x00000000
    exercise a_q_1_mul_cancel, q, 1, mul, 0x3fc00000, 0xbfc00000, 0x00000000, 0x3fc00000
    exercise a_q_1_mul_power, q, 1, mul, 0x3fc00000, 0x40000000, 0xc0400000, 0x3fc00000
    exercise a_q_1_mul_round, q, 1, mul, 0x3f800001, 0x3f7fffff, 0xbf800000, 0x3f800001
    exercise a_q_1_mul_tiny, q, 1, mul, 0x00800000, 0x3f000000, 0x00000000, 0x00800000
    exercise a_q_1_mul_overflow, q, 1, mul, 0x7f7fffff, 0x40000000, 0x00000000, 0x7f7fffff
    exercise a_q_1_mul_partial, q, 1, mul, 0x00000000, 0x3fc00000, 0x00000000, 0x3f800001
    exercise a_q_1_mul_negzero, q, 1, mul, 0x80000000, 0x00000000, 0x80000000, 0x80000000
    exercise a_q_1_mla_zero, q, 1, mla, 0x00000000, 0x3fc00000, 0x00000000, 0x00000000
    exercise a_q_1_mla_cancel, q, 1, mla, 0x3fc00000, 0xbfc00000, 0x00000000, 0x3fc00000
    exercise a_q_1_mla_power, q, 1, mla, 0x3fc00000, 0x40000000, 0xc0400000, 0x3fc00000
    exercise a_q_1_mla_round, q, 1, mla, 0x3f800001, 0x3f7fffff, 0xbf800000, 0x3f800001
    exercise a_q_1_mla_tiny, q, 1, mla, 0x00800000, 0x3f000000, 0x00000000, 0x00800000
    exercise a_q_1_mla_overflow, q, 1, mla, 0x7f7fffff, 0x40000000, 0x00000000, 0x7f7fffff
    exercise a_q_1_mla_partial, q, 1, mla, 0x00000000, 0x3fc00000, 0x00000000, 0x3f800001
    exercise a_q_1_mla_negzero, q, 1, mla, 0x80000000, 0x00000000, 0x80000000, 0x80000000
    exercise a_q_1_mls_zero, q, 1, mls, 0x00000000, 0x3fc00000, 0x00000000, 0x00000000
    exercise a_q_1_mls_cancel, q, 1, mls, 0x3fc00000, 0xbfc00000, 0x00000000, 0x3fc00000
    exercise a_q_1_mls_power, q, 1, mls, 0x3fc00000, 0x40000000, 0xc0400000, 0x3fc00000
    exercise a_q_1_mls_round, q, 1, mls, 0x3f800001, 0x3f7fffff, 0xbf800000, 0x3f800001
    exercise a_q_1_mls_tiny, q, 1, mls, 0x00800000, 0x3f000000, 0x00000000, 0x00800000
    exercise a_q_1_mls_overflow, q, 1, mls, 0x7f7fffff, 0x40000000, 0x00000000, 0x7f7fffff
    exercise a_q_1_mls_partial, q, 1, mls, 0x00000000, 0x3fc00000, 0x00000000, 0x3f800001
    exercise a_q_1_mls_negzero, q, 1, mls, 0x80000000, 0x00000000, 0x80000000, 0x80000000
    .thumb
    .balign 4
    exercise t_d_0_add_zero, d, 0, add, 0x00000000, 0x3fc00000, 0x00000000, 0x00000000
    exercise t_d_0_add_cancel, d, 0, add, 0x3fc00000, 0xbfc00000, 0x00000000, 0x3fc00000
    exercise t_d_0_add_power, d, 0, add, 0x3fc00000, 0x40000000, 0xc0400000, 0x3fc00000
    exercise t_d_0_add_round, d, 0, add, 0x3f800001, 0x3f7fffff, 0xbf800000, 0x3f800001
    exercise t_d_0_add_tiny, d, 0, add, 0x00800000, 0x3f000000, 0x00000000, 0x00800000
    exercise t_d_0_add_overflow, d, 0, add, 0x7f7fffff, 0x40000000, 0x00000000, 0x7f7fffff
    exercise t_d_0_add_partial, d, 0, add, 0x00000000, 0x3fc00000, 0x00000000, 0x3f800001
    exercise t_d_0_add_negzero, d, 0, add, 0x80000000, 0x00000000, 0x80000000, 0x80000000
    exercise t_d_0_sub_zero, d, 0, sub, 0x00000000, 0x3fc00000, 0x00000000, 0x00000000
    exercise t_d_0_sub_cancel, d, 0, sub, 0x3fc00000, 0xbfc00000, 0x00000000, 0x3fc00000
    exercise t_d_0_sub_power, d, 0, sub, 0x3fc00000, 0x40000000, 0xc0400000, 0x3fc00000
    exercise t_d_0_sub_round, d, 0, sub, 0x3f800001, 0x3f7fffff, 0xbf800000, 0x3f800001
    exercise t_d_0_sub_tiny, d, 0, sub, 0x00800000, 0x3f000000, 0x00000000, 0x00800000
    exercise t_d_0_sub_overflow, d, 0, sub, 0x7f7fffff, 0x40000000, 0x00000000, 0x7f7fffff
    exercise t_d_0_sub_partial, d, 0, sub, 0x00000000, 0x3fc00000, 0x00000000, 0x3f800001
    exercise t_d_0_sub_negzero, d, 0, sub, 0x80000000, 0x00000000, 0x80000000, 0x80000000
    exercise t_d_0_mul_zero, d, 0, mul, 0x00000000, 0x3fc00000, 0x00000000, 0x00000000
    exercise t_d_0_mul_cancel, d, 0, mul, 0x3fc00000, 0xbfc00000, 0x00000000, 0x3fc00000
    exercise t_d_0_mul_power, d, 0, mul, 0x3fc00000, 0x40000000, 0xc0400000, 0x3fc00000
    exercise t_d_0_mul_round, d, 0, mul, 0x3f800001, 0x3f7fffff, 0xbf800000, 0x3f800001
    exercise t_d_0_mul_tiny, d, 0, mul, 0x00800000, 0x3f000000, 0x00000000, 0x00800000
    exercise t_d_0_mul_overflow, d, 0, mul, 0x7f7fffff, 0x40000000, 0x00000000, 0x7f7fffff
    exercise t_d_0_mul_partial, d, 0, mul, 0x00000000, 0x3fc00000, 0x00000000, 0x3f800001
    exercise t_d_0_mul_negzero, d, 0, mul, 0x80000000, 0x00000000, 0x80000000, 0x80000000
    exercise t_d_0_mla_zero, d, 0, mla, 0x00000000, 0x3fc00000, 0x00000000, 0x00000000
    exercise t_d_0_mla_cancel, d, 0, mla, 0x3fc00000, 0xbfc00000, 0x00000000, 0x3fc00000
    exercise t_d_0_mla_power, d, 0, mla, 0x3fc00000, 0x40000000, 0xc0400000, 0x3fc00000
    exercise t_d_0_mla_round, d, 0, mla, 0x3f800001, 0x3f7fffff, 0xbf800000, 0x3f800001
    exercise t_d_0_mla_tiny, d, 0, mla, 0x00800000, 0x3f000000, 0x00000000, 0x00800000
    exercise t_d_0_mla_overflow, d, 0, mla, 0x7f7fffff, 0x40000000, 0x00000000, 0x7f7fffff
    exercise t_d_0_mla_partial, d, 0, mla, 0x00000000, 0x3fc00000, 0x00000000, 0x3f800001
    exercise t_d_0_mla_negzero, d, 0, mla, 0x80000000, 0x00000000, 0x80000000, 0x80000000
    exercise t_d_0_mls_zero, d, 0, mls, 0x00000000, 0x3fc00000, 0x00000000, 0x00000000
    exercise t_d_0_mls_cancel, d, 0, mls, 0x3fc00000, 0xbfc00000, 0x00000000, 0x3fc00000
    exercise t_d_0_mls_power, d, 0, mls, 0x3fc00000, 0x40000000, 0xc0400000, 0x3fc00000
    exercise t_d_0_mls_round, d, 0, mls, 0x3f800001, 0x3f7fffff, 0xbf800000, 0x3f800001
    exercise t_d_0_mls_tiny, d, 0, mls, 0x00800000, 0x3f000000, 0x00000000, 0x00800000
    exercise t_d_0_mls_overflow, d, 0, mls, 0x7f7fffff, 0x40000000, 0x00000000, 0x7f7fffff
    exercise t_d_0_mls_partial, d, 0, mls, 0x00000000, 0x3fc00000, 0x00000000, 0x3f800001
    exercise t_d_0_mls_negzero, d, 0, mls, 0x80000000, 0x00000000, 0x80000000, 0x80000000
    exercise t_d_1_mul_zero, d, 1, mul, 0x00000000, 0x3fc00000, 0x00000000, 0x00000000
    exercise t_d_1_mul_cancel, d, 1, mul, 0x3fc00000, 0xbfc00000, 0x00000000, 0x3fc00000
    exercise t_d_1_mul_power, d, 1, mul, 0x3fc00000, 0x40000000, 0xc0400000, 0x3fc00000
    exercise t_d_1_mul_round, d, 1, mul, 0x3f800001, 0x3f7fffff, 0xbf800000, 0x3f800001
    exercise t_d_1_mul_tiny, d, 1, mul, 0x00800000, 0x3f000000, 0x00000000, 0x00800000
    exercise t_d_1_mul_overflow, d, 1, mul, 0x7f7fffff, 0x40000000, 0x00000000, 0x7f7fffff
    exercise t_d_1_mul_partial, d, 1, mul, 0x00000000, 0x3fc00000, 0x00000000, 0x3f800001
    exercise t_d_1_mul_negzero, d, 1, mul, 0x80000000, 0x00000000, 0x80000000, 0x80000000
    exercise t_d_1_mla_zero, d, 1, mla, 0x00000000, 0x3fc00000, 0x00000000, 0x00000000
    exercise t_d_1_mla_cancel, d, 1, mla, 0x3fc00000, 0xbfc00000, 0x00000000, 0x3fc00000
    exercise t_d_1_mla_power, d, 1, mla, 0x3fc00000, 0x40000000, 0xc0400000, 0x3fc00000
    exercise t_d_1_mla_round, d, 1, mla, 0x3f800001, 0x3f7fffff, 0xbf800000, 0x3f800001
    exercise t_d_1_mla_tiny, d, 1, mla, 0x00800000, 0x3f000000, 0x00000000, 0x00800000
    exercise t_d_1_mla_overflow, d, 1, mla, 0x7f7fffff, 0x40000000, 0x00000000, 0x7f7fffff
    exercise t_d_1_mla_partial, d, 1, mla, 0x00000000, 0x3fc00000, 0x00000000, 0x3f800001
    exercise t_d_1_mla_negzero, d, 1, mla, 0x80000000, 0x00000000, 0x80000000, 0x80000000
    exercise t_d_1_mls_zero, d, 1, mls, 0x00000000, 0x3fc00000, 0x00000000, 0x00000000
    exercise t_d_1_mls_cancel, d, 1, mls, 0x3fc00000, 0xbfc00000, 0x00000000, 0x3fc00000
    exercise t_d_1_mls_power, d, 1, mls, 0x3fc00000, 0x40000000, 0xc0400000, 0x3fc00000
    exercise t_d_1_mls_round, d, 1, mls, 0x3f800001, 0x3f7fffff, 0xbf800000, 0x3f800001
    exercise t_d_1_mls_tiny, d, 1, mls, 0x00800000, 0x3f000000, 0x00000000, 0x00800000
    exercise t_d_1_mls_overflow, d, 1, mls, 0x7f7fffff, 0x40000000, 0x00000000, 0x7f7fffff
    exercise t_d_1_mls_partial, d, 1, mls, 0x00000000, 0x3fc00000, 0x00000000, 0x3f800001
    exercise t_d_1_mls_negzero, d, 1, mls, 0x80000000, 0x00000000, 0x80000000, 0x80000000
    exercise t_q_0_add_zero, q, 0, add, 0x00000000, 0x3fc00000, 0x00000000, 0x00000000
    exercise t_q_0_add_cancel, q, 0, add, 0x3fc00000, 0xbfc00000, 0x00000000, 0x3fc00000
    exercise t_q_0_add_power, q, 0, add, 0x3fc00000, 0x40000000, 0xc0400000, 0x3fc00000
    exercise t_q_0_add_round, q, 0, add, 0x3f800001, 0x3f7fffff, 0xbf800000, 0x3f800001
    exercise t_q_0_add_tiny, q, 0, add, 0x00800000, 0x3f000000, 0x00000000, 0x00800000
    exercise t_q_0_add_overflow, q, 0, add, 0x7f7fffff, 0x40000000, 0x00000000, 0x7f7fffff
    exercise t_q_0_add_partial, q, 0, add, 0x00000000, 0x3fc00000, 0x00000000, 0x3f800001
    exercise t_q_0_add_negzero, q, 0, add, 0x80000000, 0x00000000, 0x80000000, 0x80000000
    exercise t_q_0_sub_zero, q, 0, sub, 0x00000000, 0x3fc00000, 0x00000000, 0x00000000
    exercise t_q_0_sub_cancel, q, 0, sub, 0x3fc00000, 0xbfc00000, 0x00000000, 0x3fc00000
    exercise t_q_0_sub_power, q, 0, sub, 0x3fc00000, 0x40000000, 0xc0400000, 0x3fc00000
    exercise t_q_0_sub_round, q, 0, sub, 0x3f800001, 0x3f7fffff, 0xbf800000, 0x3f800001
    exercise t_q_0_sub_tiny, q, 0, sub, 0x00800000, 0x3f000000, 0x00000000, 0x00800000
    exercise t_q_0_sub_overflow, q, 0, sub, 0x7f7fffff, 0x40000000, 0x00000000, 0x7f7fffff
    exercise t_q_0_sub_partial, q, 0, sub, 0x00000000, 0x3fc00000, 0x00000000, 0x3f800001
    exercise t_q_0_sub_negzero, q, 0, sub, 0x80000000, 0x00000000, 0x80000000, 0x80000000
    exercise t_q_0_mul_zero, q, 0, mul, 0x00000000, 0x3fc00000, 0x00000000, 0x00000000
    exercise t_q_0_mul_cancel, q, 0, mul, 0x3fc00000, 0xbfc00000, 0x00000000, 0x3fc00000
    exercise t_q_0_mul_power, q, 0, mul, 0x3fc00000, 0x40000000, 0xc0400000, 0x3fc00000
    exercise t_q_0_mul_round, q, 0, mul, 0x3f800001, 0x3f7fffff, 0xbf800000, 0x3f800001
    exercise t_q_0_mul_tiny, q, 0, mul, 0x00800000, 0x3f000000, 0x00000000, 0x00800000
    exercise t_q_0_mul_overflow, q, 0, mul, 0x7f7fffff, 0x40000000, 0x00000000, 0x7f7fffff
    exercise t_q_0_mul_partial, q, 0, mul, 0x00000000, 0x3fc00000, 0x00000000, 0x3f800001
    exercise t_q_0_mul_negzero, q, 0, mul, 0x80000000, 0x00000000, 0x80000000, 0x80000000
    exercise t_q_0_mla_zero, q, 0, mla, 0x00000000, 0x3fc00000, 0x00000000, 0x00000000
    exercise t_q_0_mla_cancel, q, 0, mla, 0x3fc00000, 0xbfc00000, 0x00000000, 0x3fc00000
    exercise t_q_0_mla_power, q, 0, mla, 0x3fc00000, 0x40000000, 0xc0400000, 0x3fc00000
    exercise t_q_0_mla_round, q, 0, mla, 0x3f800001, 0x3f7fffff, 0xbf800000, 0x3f800001
    exercise t_q_0_mla_tiny, q, 0, mla, 0x00800000, 0x3f000000, 0x00000000, 0x00800000
    exercise t_q_0_mla_overflow, q, 0, mla, 0x7f7fffff, 0x40000000, 0x00000000, 0x7f7fffff
    exercise t_q_0_mla_partial, q, 0, mla, 0x00000000, 0x3fc00000, 0x00000000, 0x3f800001
    exercise t_q_0_mla_negzero, q, 0, mla, 0x80000000, 0x00000000, 0x80000000, 0x80000000
    exercise t_q_0_mls_zero, q, 0, mls, 0x00000000, 0x3fc00000, 0x00000000, 0x00000000
    exercise t_q_0_mls_cancel, q, 0, mls, 0x3fc00000, 0xbfc00000, 0x00000000, 0x3fc00000
    exercise t_q_0_mls_power, q, 0, mls, 0x3fc00000, 0x40000000, 0xc0400000, 0x3fc00000
    exercise t_q_0_mls_round, q, 0, mls, 0x3f800001, 0x3f7fffff, 0xbf800000, 0x3f800001
    exercise t_q_0_mls_tiny, q, 0, mls, 0x00800000, 0x3f000000, 0x00000000, 0x00800000
    exercise t_q_0_mls_overflow, q, 0, mls, 0x7f7fffff, 0x40000000, 0x00000000, 0x7f7fffff
    exercise t_q_0_mls_partial, q, 0, mls, 0x00000000, 0x3fc00000, 0x00000000, 0x3f800001
    exercise t_q_0_mls_negzero, q, 0, mls, 0x80000000, 0x00000000, 0x80000000, 0x80000000
    exercise t_q_1_mul_zero, q, 1, mul, 0x00000000, 0x3fc00000, 0x00000000, 0x00000000
    exercise t_q_1_mul_cancel, q, 1, mul, 0x3fc00000, 0xbfc00000, 0x00000000, 0x3fc00000
    exercise t_q_1_mul_power, q, 1, mul, 0x3fc00000, 0x40000000, 0xc0400000, 0x3fc00000
    exercise t_q_1_mul_round, q, 1, mul, 0x3f800001, 0x3f7fffff, 0xbf800000, 0x3f800001
    exercise t_q_1_mul_tiny, q, 1, mul, 0x00800000, 0x3f000000, 0x00000000, 0x00800000
    exercise t_q_1_mul_overflow, q, 1, mul, 0x7f7fffff, 0x40000000, 0x00000000, 0x7f7fffff
    exercise t_q_1_mul_partial, q, 1, mul, 0x00000000, 0x3fc00000, 0x00000000, 0x3f800001
    exercise t_q_1_mul_negzero, q, 1, mul, 0x80000000, 0x00000000, 0x80000000, 0x80000000
    exercise t_q_1_mla_zero, q, 1, mla, 0x00000000, 0x3fc00000, 0x00000000, 0x00000000
    exercise t_q_1_mla_cancel, q, 1, mla, 0x3fc00000, 0xbfc00000, 0x00000000, 0x3fc00000
    exercise t_q_1_mla_power, q, 1, mla, 0x3fc00000, 0x40000000, 0xc0400000, 0x3fc00000
    exercise t_q_1_mla_round, q, 1, mla, 0x3f800001, 0x3f7fffff, 0xbf800000, 0x3f800001
    exercise t_q_1_mla_tiny, q, 1, mla, 0x00800000, 0x3f000000, 0x00000000, 0x00800000
    exercise t_q_1_mla_overflow, q, 1, mla, 0x7f7fffff, 0x40000000, 0x00000000, 0x7f7fffff
    exercise t_q_1_mla_partial, q, 1, mla, 0x00000000, 0x3fc00000, 0x00000000, 0x3f800001
    exercise t_q_1_mla_negzero, q, 1, mla, 0x80000000, 0x00000000, 0x80000000, 0x80000000
    exercise t_q_1_mls_zero, q, 1, mls, 0x00000000, 0x3fc00000, 0x00000000, 0x00000000
    exercise t_q_1_mls_cancel, q, 1, mls, 0x3fc00000, 0xbfc00000, 0x00000000, 0x3fc00000
    exercise t_q_1_mls_power, q, 1, mls, 0x3fc00000, 0x40000000, 0xc0400000, 0x3fc00000
    exercise t_q_1_mls_round, q, 1, mls, 0x3f800001, 0x3f7fffff, 0xbf800000, 0x3f800001
    exercise t_q_1_mls_tiny, q, 1, mls, 0x00800000, 0x3f000000, 0x00000000, 0x00800000
    exercise t_q_1_mls_overflow, q, 1, mls, 0x7f7fffff, 0x40000000, 0x00000000, 0x7f7fffff
    exercise t_q_1_mls_partial, q, 1, mls, 0x00000000, 0x3fc00000, 0x00000000, 0x3f800001
    exercise t_q_1_mls_negzero, q, 1, mls, 0x80000000, 0x00000000, 0x80000000, 0x80000000
