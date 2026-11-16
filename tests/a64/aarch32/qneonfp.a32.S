// Standard NEON FP fast path: ARM/Thumb, D/Q, overlapping destination,
// FPSCR RMode ignored, initially clear/sticky IXC, exceptional last lane,
// and preserved other half for D forms. Compare with QEMU and MMU page JIT.
    .syntax unified
    .fpu crypto-neon-fp-armv8
    .arm
base:
    .word 180
    .word a_d_add_normal - base, 0, 0x130
    .word a_d_add_denorm - base, 0, 0x130
    .word a_d_add_nan - base, 0, 0x130
    .word a_d_add_zero - base, 0, 0x130
    .word a_d_add_tiny - base, 0, 0x130
    .word a_d_add_overflow - base, 0, 0x130
    .word a_d_add_cleared - base, 0, 0x130
    .word a_d_sub_normal - base, 0, 0x130
    .word a_d_sub_denorm - base, 0, 0x130
    .word a_d_sub_nan - base, 0, 0x130
    .word a_d_sub_zero - base, 0, 0x130
    .word a_d_sub_tiny - base, 0, 0x130
    .word a_d_sub_overflow - base, 0, 0x130
    .word a_d_sub_cleared - base, 0, 0x130
    .word a_d_mul_normal - base, 0, 0x130
    .word a_d_mul_denorm - base, 0, 0x130
    .word a_d_mul_nan - base, 0, 0x130
    .word a_d_mul_zero - base, 0, 0x130
    .word a_d_mul_tiny - base, 0, 0x130
    .word a_d_mul_overflow - base, 0, 0x130
    .word a_d_mul_cleared - base, 0, 0x130
    .word a_d_mla_normal - base, 0, 0x130
    .word a_d_mla_denorm - base, 0, 0x130
    .word a_d_mla_nan - base, 0, 0x130
    .word a_d_mla_zero - base, 0, 0x130
    .word a_d_mla_tiny - base, 0, 0x130
    .word a_d_mla_overflow - base, 0, 0x130
    .word a_d_mla_cleared - base, 0, 0x130
    .word a_d_mls_normal - base, 0, 0x130
    .word a_d_mls_denorm - base, 0, 0x130
    .word a_d_mls_nan - base, 0, 0x130
    .word a_d_mls_zero - base, 0, 0x130
    .word a_d_mls_tiny - base, 0, 0x130
    .word a_d_mls_overflow - base, 0, 0x130
    .word a_d_mls_cleared - base, 0, 0x130
    .word a_q_add_normal - base, 0, 0x130
    .word a_q_add_denorm - base, 0, 0x130
    .word a_q_add_nan - base, 0, 0x130
    .word a_q_add_zero - base, 0, 0x130
    .word a_q_add_tiny - base, 0, 0x130
    .word a_q_add_overflow - base, 0, 0x130
    .word a_q_add_cleared - base, 0, 0x130
    .word a_q_sub_normal - base, 0, 0x130
    .word a_q_sub_denorm - base, 0, 0x130
    .word a_q_sub_nan - base, 0, 0x130
    .word a_q_sub_zero - base, 0, 0x130
    .word a_q_sub_tiny - base, 0, 0x130
    .word a_q_sub_overflow - base, 0, 0x130
    .word a_q_sub_cleared - base, 0, 0x130
    .word a_q_mul_normal - base, 0, 0x130
    .word a_q_mul_denorm - base, 0, 0x130
    .word a_q_mul_nan - base, 0, 0x130
    .word a_q_mul_zero - base, 0, 0x130
    .word a_q_mul_tiny - base, 0, 0x130
    .word a_q_mul_overflow - base, 0, 0x130
    .word a_q_mul_cleared - base, 0, 0x130
    .word a_q_mla_normal - base, 0, 0x130
    .word a_q_mla_denorm - base, 0, 0x130
    .word a_q_mla_nan - base, 0, 0x130
    .word a_q_mla_zero - base, 0, 0x130
    .word a_q_mla_tiny - base, 0, 0x130
    .word a_q_mla_overflow - base, 0, 0x130
    .word a_q_mla_cleared - base, 0, 0x130
    .word a_q_mls_normal - base, 0, 0x130
    .word a_q_mls_denorm - base, 0, 0x130
    .word a_q_mls_nan - base, 0, 0x130
    .word a_q_mls_zero - base, 0, 0x130
    .word a_q_mls_tiny - base, 0, 0x130
    .word a_q_mls_overflow - base, 0, 0x130
    .word a_q_mls_cleared - base, 0, 0x130
    .word t_d_add_normal - base + 1, 0, 0x130
    .word t_d_add_denorm - base + 1, 0, 0x130
    .word t_d_add_nan - base + 1, 0, 0x130
    .word t_d_add_zero - base + 1, 0, 0x130
    .word t_d_add_tiny - base + 1, 0, 0x130
    .word t_d_add_overflow - base + 1, 0, 0x130
    .word t_d_add_cleared - base + 1, 0, 0x130
    .word t_d_sub_normal - base + 1, 0, 0x130
    .word t_d_sub_denorm - base + 1, 0, 0x130
    .word t_d_sub_nan - base + 1, 0, 0x130
    .word t_d_sub_zero - base + 1, 0, 0x130
    .word t_d_sub_tiny - base + 1, 0, 0x130
    .word t_d_sub_overflow - base + 1, 0, 0x130
    .word t_d_sub_cleared - base + 1, 0, 0x130
    .word t_d_mul_normal - base + 1, 0, 0x130
    .word t_d_mul_denorm - base + 1, 0, 0x130
    .word t_d_mul_nan - base + 1, 0, 0x130
    .word t_d_mul_zero - base + 1, 0, 0x130
    .word t_d_mul_tiny - base + 1, 0, 0x130
    .word t_d_mul_overflow - base + 1, 0, 0x130
    .word t_d_mul_cleared - base + 1, 0, 0x130
    .word t_d_mla_normal - base + 1, 0, 0x130
    .word t_d_mla_denorm - base + 1, 0, 0x130
    .word t_d_mla_nan - base + 1, 0, 0x130
    .word t_d_mla_zero - base + 1, 0, 0x130
    .word t_d_mla_tiny - base + 1, 0, 0x130
    .word t_d_mla_overflow - base + 1, 0, 0x130
    .word t_d_mla_cleared - base + 1, 0, 0x130
    .word t_d_mls_normal - base + 1, 0, 0x130
    .word t_d_mls_denorm - base + 1, 0, 0x130
    .word t_d_mls_nan - base + 1, 0, 0x130
    .word t_d_mls_zero - base + 1, 0, 0x130
    .word t_d_mls_tiny - base + 1, 0, 0x130
    .word t_d_mls_overflow - base + 1, 0, 0x130
    .word t_d_mls_cleared - base + 1, 0, 0x130
    .word t_q_add_normal - base + 1, 0, 0x130
    .word t_q_add_denorm - base + 1, 0, 0x130
    .word t_q_add_nan - base + 1, 0, 0x130
    .word t_q_add_zero - base + 1, 0, 0x130
    .word t_q_add_tiny - base + 1, 0, 0x130
    .word t_q_add_overflow - base + 1, 0, 0x130
    .word t_q_add_cleared - base + 1, 0, 0x130
    .word t_q_sub_normal - base + 1, 0, 0x130
    .word t_q_sub_denorm - base + 1, 0, 0x130
    .word t_q_sub_nan - base + 1, 0, 0x130
    .word t_q_sub_zero - base + 1, 0, 0x130
    .word t_q_sub_tiny - base + 1, 0, 0x130
    .word t_q_sub_overflow - base + 1, 0, 0x130
    .word t_q_sub_cleared - base + 1, 0, 0x130
    .word t_q_mul_normal - base + 1, 0, 0x130
    .word t_q_mul_denorm - base + 1, 0, 0x130
    .word t_q_mul_nan - base + 1, 0, 0x130
    .word t_q_mul_zero - base + 1, 0, 0x130
    .word t_q_mul_tiny - base + 1, 0, 0x130
    .word t_q_mul_overflow - base + 1, 0, 0x130
    .word t_q_mul_cleared - base + 1, 0, 0x130
    .word t_q_mla_normal - base + 1, 0, 0x130
    .word t_q_mla_denorm - base + 1, 0, 0x130
    .word t_q_mla_nan - base + 1, 0, 0x130
    .word t_q_mla_zero - base + 1, 0, 0x130
    .word t_q_mla_tiny - base + 1, 0, 0x130
    .word t_q_mla_overflow - base + 1, 0, 0x130
    .word t_q_mla_cleared - base + 1, 0, 0x130
    .word t_q_mls_normal - base + 1, 0, 0x130
    .word t_q_mls_denorm - base + 1, 0, 0x130
    .word t_q_mls_nan - base + 1, 0, 0x130
    .word t_q_mls_zero - base + 1, 0, 0x130
    .word t_q_mls_tiny - base + 1, 0, 0x130
    .word t_q_mls_overflow - base + 1, 0, 0x130
    .word t_q_mls_cleared - base + 1, 0, 0x130

    .word a_d_add_underflow - base, 0, 0x130
    .word a_d_add_negzero - base, 0, 0x130
    .word a_d_sub_underflow - base, 0, 0x130
    .word a_d_sub_negzero - base, 0, 0x130
    .word a_d_mul_underflow - base, 0, 0x130
    .word a_d_mul_negzero - base, 0, 0x130
    .word a_d_mla_underflow - base, 0, 0x130
    .word a_d_mla_negzero - base, 0, 0x130
    .word a_d_mls_underflow - base, 0, 0x130
    .word a_d_mls_negzero - base, 0, 0x130
    .word a_q_add_underflow - base, 0, 0x130
    .word a_q_add_negzero - base, 0, 0x130
    .word a_q_sub_underflow - base, 0, 0x130
    .word a_q_sub_negzero - base, 0, 0x130
    .word a_q_mul_underflow - base, 0, 0x130
    .word a_q_mul_negzero - base, 0, 0x130
    .word a_q_mla_underflow - base, 0, 0x130
    .word a_q_mla_negzero - base, 0, 0x130
    .word a_q_mls_underflow - base, 0, 0x130
    .word a_q_mls_negzero - base, 0, 0x130
    .word t_d_add_underflow - base + 1, 0, 0x130
    .word t_d_add_negzero - base + 1, 0, 0x130
    .word t_d_sub_underflow - base + 1, 0, 0x130
    .word t_d_sub_negzero - base + 1, 0, 0x130
    .word t_d_mul_underflow - base + 1, 0, 0x130
    .word t_d_mul_negzero - base + 1, 0, 0x130
    .word t_d_mla_underflow - base + 1, 0, 0x130
    .word t_d_mla_negzero - base + 1, 0, 0x130
    .word t_d_mls_underflow - base + 1, 0, 0x130
    .word t_d_mls_negzero - base + 1, 0, 0x130
    .word t_q_add_underflow - base + 1, 0, 0x130
    .word t_q_add_negzero - base + 1, 0, 0x130
    .word t_q_sub_underflow - base + 1, 0, 0x130
    .word t_q_sub_negzero - base + 1, 0, 0x130
    .word t_q_mul_underflow - base + 1, 0, 0x130
    .word t_q_mul_negzero - base + 1, 0, 0x130
    .word t_q_mla_underflow - base + 1, 0, 0x130
    .word t_q_mla_negzero - base + 1, 0, 0x130
    .word t_q_mls_underflow - base + 1, 0, 0x130
    .word t_q_mls_negzero - base + 1, 0, 0x130

    .macro exercise name, op, shape, special, flags, input=0x3fc00000
\name:
    movw r0, #\flags
    movt r0, #0x00c0
    vmsr fpscr, r0
    vmov.f32 q2, #1.5
    vmov.f32 q1, #0.5
    movw r1, #(\input & 0xffff)
    movt r1, #(\input >> 16)
    .ifc \shape,q
    vmov.32 d5[1], r1
    .else
    vmov.32 d4[1], r1
    .endif
    movw r2, #(\special & 0xffff)
    movt r2, #(\special >> 16)
    .ifc \shape,q
    vmov.32 d3[1], r2
    .else
    vmov.32 d2[1], r2
    .endif
    movw r12, #128
1:  vmov d0, d4
    vmov d1, d5
    .ifc \shape,q
    v\op\().f32 q0, q0, q1
    .else
    v\op\().f32 d0, d0, d2
    .endif
    subs r12, r12, #1
    bne 1b
    vmov r4, r5, d0
    vmov r6, r7, d1
    vmrs r3, fpscr
    svc #0
    .endm
    exercise a_d_add_normal, add, d, 0x3dcccccd, 0x10
    exercise a_d_add_denorm, add, d, 0x00000001, 0x10
    exercise a_d_add_nan, add, d, 0x7f800001, 0x10
    exercise a_d_add_zero, add, d, 0x00000000, 0x10
    exercise a_d_add_tiny, add, d, 0x00800000, 0x10
    exercise a_d_add_overflow, add, d, 0x7f7fffff, 0x10
    exercise a_d_add_cleared, add, d, 0x3dcccccd, 0
    exercise a_d_sub_normal, sub, d, 0x3dcccccd, 0x10
    exercise a_d_sub_denorm, sub, d, 0x00000001, 0x10
    exercise a_d_sub_nan, sub, d, 0x7f800001, 0x10
    exercise a_d_sub_zero, sub, d, 0x00000000, 0x10
    exercise a_d_sub_tiny, sub, d, 0x00800000, 0x10
    exercise a_d_sub_overflow, sub, d, 0x7f7fffff, 0x10
    exercise a_d_sub_cleared, sub, d, 0x3dcccccd, 0
    exercise a_d_mul_normal, mul, d, 0x3dcccccd, 0x10
    exercise a_d_mul_denorm, mul, d, 0x00000001, 0x10
    exercise a_d_mul_nan, mul, d, 0x7f800001, 0x10
    exercise a_d_mul_zero, mul, d, 0x00000000, 0x10
    exercise a_d_mul_tiny, mul, d, 0x00800000, 0x10
    exercise a_d_mul_overflow, mul, d, 0x7f7fffff, 0x10
    exercise a_d_mul_cleared, mul, d, 0x3dcccccd, 0
    exercise a_d_mla_normal, mla, d, 0x3dcccccd, 0x10
    exercise a_d_mla_denorm, mla, d, 0x00000001, 0x10
    exercise a_d_mla_nan, mla, d, 0x7f800001, 0x10
    exercise a_d_mla_zero, mla, d, 0x00000000, 0x10
    exercise a_d_mla_tiny, mla, d, 0x00800000, 0x10
    exercise a_d_mla_overflow, mla, d, 0x7f7fffff, 0x10
    exercise a_d_mla_cleared, mla, d, 0x3dcccccd, 0
    exercise a_d_mls_normal, mls, d, 0x3dcccccd, 0x10
    exercise a_d_mls_denorm, mls, d, 0x00000001, 0x10
    exercise a_d_mls_nan, mls, d, 0x7f800001, 0x10
    exercise a_d_mls_zero, mls, d, 0x00000000, 0x10
    exercise a_d_mls_tiny, mls, d, 0x00800000, 0x10
    exercise a_d_mls_overflow, mls, d, 0x7f7fffff, 0x10
    exercise a_d_mls_cleared, mls, d, 0x3dcccccd, 0
    exercise a_q_add_normal, add, q, 0x3dcccccd, 0x10
    exercise a_q_add_denorm, add, q, 0x00000001, 0x10
    exercise a_q_add_nan, add, q, 0x7f800001, 0x10
    exercise a_q_add_zero, add, q, 0x00000000, 0x10
    exercise a_q_add_tiny, add, q, 0x00800000, 0x10
    exercise a_q_add_overflow, add, q, 0x7f7fffff, 0x10
    exercise a_q_add_cleared, add, q, 0x3dcccccd, 0
    exercise a_q_sub_normal, sub, q, 0x3dcccccd, 0x10
    exercise a_q_sub_denorm, sub, q, 0x00000001, 0x10
    exercise a_q_sub_nan, sub, q, 0x7f800001, 0x10
    exercise a_q_sub_zero, sub, q, 0x00000000, 0x10
    exercise a_q_sub_tiny, sub, q, 0x00800000, 0x10
    exercise a_q_sub_overflow, sub, q, 0x7f7fffff, 0x10
    exercise a_q_sub_cleared, sub, q, 0x3dcccccd, 0
    exercise a_q_mul_normal, mul, q, 0x3dcccccd, 0x10
    exercise a_q_mul_denorm, mul, q, 0x00000001, 0x10
    exercise a_q_mul_nan, mul, q, 0x7f800001, 0x10
    exercise a_q_mul_zero, mul, q, 0x00000000, 0x10
    exercise a_q_mul_tiny, mul, q, 0x00800000, 0x10
    exercise a_q_mul_overflow, mul, q, 0x7f7fffff, 0x10
    exercise a_q_mul_cleared, mul, q, 0x3dcccccd, 0
    exercise a_q_mla_normal, mla, q, 0x3dcccccd, 0x10
    exercise a_q_mla_denorm, mla, q, 0x00000001, 0x10
    exercise a_q_mla_nan, mla, q, 0x7f800001, 0x10
    exercise a_q_mla_zero, mla, q, 0x00000000, 0x10
    exercise a_q_mla_tiny, mla, q, 0x00800000, 0x10
    exercise a_q_mla_overflow, mla, q, 0x7f7fffff, 0x10
    exercise a_q_mla_cleared, mla, q, 0x3dcccccd, 0
    exercise a_q_mls_normal, mls, q, 0x3dcccccd, 0x10
    exercise a_q_mls_denorm, mls, q, 0x00000001, 0x10
    exercise a_q_mls_nan, mls, q, 0x7f800001, 0x10
    exercise a_q_mls_zero, mls, q, 0x00000000, 0x10
    exercise a_q_mls_tiny, mls, q, 0x00800000, 0x10
    exercise a_q_mls_overflow, mls, q, 0x7f7fffff, 0x10
    exercise a_q_mls_cleared, mls, q, 0x3dcccccd, 0
    .thumb
    exercise t_d_add_normal, add, d, 0x3dcccccd, 0x10
    exercise t_d_add_denorm, add, d, 0x00000001, 0x10
    exercise t_d_add_nan, add, d, 0x7f800001, 0x10
    exercise t_d_add_zero, add, d, 0x00000000, 0x10
    exercise t_d_add_tiny, add, d, 0x00800000, 0x10
    exercise t_d_add_overflow, add, d, 0x7f7fffff, 0x10
    exercise t_d_add_cleared, add, d, 0x3dcccccd, 0
    exercise t_d_sub_normal, sub, d, 0x3dcccccd, 0x10
    exercise t_d_sub_denorm, sub, d, 0x00000001, 0x10
    exercise t_d_sub_nan, sub, d, 0x7f800001, 0x10
    exercise t_d_sub_zero, sub, d, 0x00000000, 0x10
    exercise t_d_sub_tiny, sub, d, 0x00800000, 0x10
    exercise t_d_sub_overflow, sub, d, 0x7f7fffff, 0x10
    exercise t_d_sub_cleared, sub, d, 0x3dcccccd, 0
    exercise t_d_mul_normal, mul, d, 0x3dcccccd, 0x10
    exercise t_d_mul_denorm, mul, d, 0x00000001, 0x10
    exercise t_d_mul_nan, mul, d, 0x7f800001, 0x10
    exercise t_d_mul_zero, mul, d, 0x00000000, 0x10
    exercise t_d_mul_tiny, mul, d, 0x00800000, 0x10
    exercise t_d_mul_overflow, mul, d, 0x7f7fffff, 0x10
    exercise t_d_mul_cleared, mul, d, 0x3dcccccd, 0
    exercise t_d_mla_normal, mla, d, 0x3dcccccd, 0x10
    exercise t_d_mla_denorm, mla, d, 0x00000001, 0x10
    exercise t_d_mla_nan, mla, d, 0x7f800001, 0x10
    exercise t_d_mla_zero, mla, d, 0x00000000, 0x10
    exercise t_d_mla_tiny, mla, d, 0x00800000, 0x10
    exercise t_d_mla_overflow, mla, d, 0x7f7fffff, 0x10
    exercise t_d_mla_cleared, mla, d, 0x3dcccccd, 0
    exercise t_d_mls_normal, mls, d, 0x3dcccccd, 0x10
    exercise t_d_mls_denorm, mls, d, 0x00000001, 0x10
    exercise t_d_mls_nan, mls, d, 0x7f800001, 0x10
    exercise t_d_mls_zero, mls, d, 0x00000000, 0x10
    exercise t_d_mls_tiny, mls, d, 0x00800000, 0x10
    exercise t_d_mls_overflow, mls, d, 0x7f7fffff, 0x10
    exercise t_d_mls_cleared, mls, d, 0x3dcccccd, 0
    exercise t_q_add_normal, add, q, 0x3dcccccd, 0x10
    exercise t_q_add_denorm, add, q, 0x00000001, 0x10
    exercise t_q_add_nan, add, q, 0x7f800001, 0x10
    exercise t_q_add_zero, add, q, 0x00000000, 0x10
    exercise t_q_add_tiny, add, q, 0x00800000, 0x10
    exercise t_q_add_overflow, add, q, 0x7f7fffff, 0x10
    exercise t_q_add_cleared, add, q, 0x3dcccccd, 0
    exercise t_q_sub_normal, sub, q, 0x3dcccccd, 0x10
    exercise t_q_sub_denorm, sub, q, 0x00000001, 0x10
    exercise t_q_sub_nan, sub, q, 0x7f800001, 0x10
    exercise t_q_sub_zero, sub, q, 0x00000000, 0x10
    exercise t_q_sub_tiny, sub, q, 0x00800000, 0x10
    exercise t_q_sub_overflow, sub, q, 0x7f7fffff, 0x10
    exercise t_q_sub_cleared, sub, q, 0x3dcccccd, 0
    exercise t_q_mul_normal, mul, q, 0x3dcccccd, 0x10
    exercise t_q_mul_denorm, mul, q, 0x00000001, 0x10
    exercise t_q_mul_nan, mul, q, 0x7f800001, 0x10
    exercise t_q_mul_zero, mul, q, 0x00000000, 0x10
    exercise t_q_mul_tiny, mul, q, 0x00800000, 0x10
    exercise t_q_mul_overflow, mul, q, 0x7f7fffff, 0x10
    exercise t_q_mul_cleared, mul, q, 0x3dcccccd, 0
    exercise t_q_mla_normal, mla, q, 0x3dcccccd, 0x10
    exercise t_q_mla_denorm, mla, q, 0x00000001, 0x10
    exercise t_q_mla_nan, mla, q, 0x7f800001, 0x10
    exercise t_q_mla_zero, mla, q, 0x00000000, 0x10
    exercise t_q_mla_tiny, mla, q, 0x00800000, 0x10
    exercise t_q_mla_overflow, mla, q, 0x7f7fffff, 0x10
    exercise t_q_mla_cleared, mla, q, 0x3dcccccd, 0
    exercise t_q_mls_normal, mls, q, 0x3dcccccd, 0x10
    exercise t_q_mls_denorm, mls, q, 0x00000001, 0x10
    exercise t_q_mls_nan, mls, q, 0x7f800001, 0x10
    exercise t_q_mls_zero, mls, q, 0x00000000, 0x10
    exercise t_q_mls_tiny, mls, q, 0x00800000, 0x10
    exercise t_q_mls_overflow, mls, q, 0x7f7fffff, 0x10
    exercise t_q_mls_cleared, mls, q, 0x3dcccccd, 0
    .arm
    exercise a_d_add_underflow, add, d, 0x00800000, 0x10, 0x00800000
    exercise a_d_add_negzero, add, d, 0x00000000, 0x10, 0xbfc00000
    exercise a_d_sub_underflow, sub, d, 0x00800000, 0x10, 0x00800000
    exercise a_d_sub_negzero, sub, d, 0x00000000, 0x10, 0xbfc00000
    exercise a_d_mul_underflow, mul, d, 0x00800000, 0x10, 0x00800000
    exercise a_d_mul_negzero, mul, d, 0x00000000, 0x10, 0xbfc00000
    exercise a_d_mla_underflow, mla, d, 0x00800000, 0x10, 0x00800000
    exercise a_d_mla_negzero, mla, d, 0x00000000, 0x10, 0xbfc00000
    exercise a_d_mls_underflow, mls, d, 0x00800000, 0x10, 0x00800000
    exercise a_d_mls_negzero, mls, d, 0x00000000, 0x10, 0xbfc00000
    exercise a_q_add_underflow, add, q, 0x00800000, 0x10, 0x00800000
    exercise a_q_add_negzero, add, q, 0x00000000, 0x10, 0xbfc00000
    exercise a_q_sub_underflow, sub, q, 0x00800000, 0x10, 0x00800000
    exercise a_q_sub_negzero, sub, q, 0x00000000, 0x10, 0xbfc00000
    exercise a_q_mul_underflow, mul, q, 0x00800000, 0x10, 0x00800000
    exercise a_q_mul_negzero, mul, q, 0x00000000, 0x10, 0xbfc00000
    exercise a_q_mla_underflow, mla, q, 0x00800000, 0x10, 0x00800000
    exercise a_q_mla_negzero, mla, q, 0x00000000, 0x10, 0xbfc00000
    exercise a_q_mls_underflow, mls, q, 0x00800000, 0x10, 0x00800000
    exercise a_q_mls_negzero, mls, q, 0x00000000, 0x10, 0xbfc00000
    .thumb
    exercise t_d_add_underflow, add, d, 0x00800000, 0x10, 0x00800000
    exercise t_d_add_negzero, add, d, 0x00000000, 0x10, 0xbfc00000
    exercise t_d_sub_underflow, sub, d, 0x00800000, 0x10, 0x00800000
    exercise t_d_sub_negzero, sub, d, 0x00000000, 0x10, 0xbfc00000
    exercise t_d_mul_underflow, mul, d, 0x00800000, 0x10, 0x00800000
    exercise t_d_mul_negzero, mul, d, 0x00000000, 0x10, 0xbfc00000
    exercise t_d_mla_underflow, mla, d, 0x00800000, 0x10, 0x00800000
    exercise t_d_mla_negzero, mla, d, 0x00000000, 0x10, 0xbfc00000
    exercise t_d_mls_underflow, mls, d, 0x00800000, 0x10, 0x00800000
    exercise t_d_mls_negzero, mls, d, 0x00000000, 0x10, 0xbfc00000
    exercise t_q_add_underflow, add, q, 0x00800000, 0x10, 0x00800000
    exercise t_q_add_negzero, add, q, 0x00000000, 0x10, 0xbfc00000
    exercise t_q_sub_underflow, sub, q, 0x00800000, 0x10, 0x00800000
    exercise t_q_sub_negzero, sub, q, 0x00000000, 0x10, 0xbfc00000
    exercise t_q_mul_underflow, mul, q, 0x00800000, 0x10, 0x00800000
    exercise t_q_mul_negzero, mul, q, 0x00000000, 0x10, 0xbfc00000
    exercise t_q_mla_underflow, mla, q, 0x00800000, 0x10, 0x00800000
    exercise t_q_mla_negzero, mla, q, 0x00000000, 0x10, 0xbfc00000
    exercise t_q_mls_underflow, mls, q, 0x00800000, 0x10, 0x00800000
    exercise t_q_mls_negzero, mls, q, 0x00000000, 0x10, 0xbfc00000
