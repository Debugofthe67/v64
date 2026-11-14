// Scalar-lane NEON FP: both sets, D/Q, both lane indices, Dd=Dn and scalar
// overlapping Dd. Retain two rounding steps, sticky flags and precise fallback.
    .syntax unified
    .fpu crypto-neon-fp-armv8
    .arm
base:
    .word 364
    .word a_d_mul_0_0_normal - base, 0, 0x130
    .word a_d_mul_0_0_nan - base, 0, 0x130
    .word a_d_mul_0_0_denorm - base, 0, 0x130
    .word a_d_mul_0_0_tiny - base, 0, 0x130
    .word a_d_mul_0_0_zero - base, 0, 0x130
    .word a_d_mla_0_0_normal - base, 0, 0x130
    .word a_d_mla_0_0_nan - base, 0, 0x130
    .word a_d_mla_0_0_denorm - base, 0, 0x130
    .word a_d_mla_0_0_tiny - base, 0, 0x130
    .word a_d_mla_0_0_zero - base, 0, 0x130
    .word a_d_mls_0_0_normal - base, 0, 0x130
    .word a_d_mls_0_0_nan - base, 0, 0x130
    .word a_d_mls_0_0_denorm - base, 0, 0x130
    .word a_d_mls_0_0_tiny - base, 0, 0x130
    .word a_d_mls_0_0_zero - base, 0, 0x130
    .word a_d_mul_0_1_normal - base, 0, 0x130
    .word a_d_mul_0_1_nan - base, 0, 0x130
    .word a_d_mul_0_1_denorm - base, 0, 0x130
    .word a_d_mul_0_1_tiny - base, 0, 0x130
    .word a_d_mul_0_1_zero - base, 0, 0x130
    .word a_d_mla_0_1_normal - base, 0, 0x130
    .word a_d_mla_0_1_nan - base, 0, 0x130
    .word a_d_mla_0_1_denorm - base, 0, 0x130
    .word a_d_mla_0_1_tiny - base, 0, 0x130
    .word a_d_mla_0_1_zero - base, 0, 0x130
    .word a_d_mls_0_1_normal - base, 0, 0x130
    .word a_d_mls_0_1_nan - base, 0, 0x130
    .word a_d_mls_0_1_denorm - base, 0, 0x130
    .word a_d_mls_0_1_tiny - base, 0, 0x130
    .word a_d_mls_0_1_zero - base, 0, 0x130
    .word a_d_mul_0_2_normal - base, 0, 0x130
    .word a_d_mul_0_2_nan - base, 0, 0x130
    .word a_d_mul_0_2_denorm - base, 0, 0x130
    .word a_d_mul_0_2_tiny - base, 0, 0x130
    .word a_d_mul_0_2_zero - base, 0, 0x130
    .word a_d_mla_0_2_normal - base, 0, 0x130
    .word a_d_mla_0_2_nan - base, 0, 0x130
    .word a_d_mla_0_2_denorm - base, 0, 0x130
    .word a_d_mla_0_2_tiny - base, 0, 0x130
    .word a_d_mla_0_2_zero - base, 0, 0x130
    .word a_d_mls_0_2_normal - base, 0, 0x130
    .word a_d_mls_0_2_nan - base, 0, 0x130
    .word a_d_mls_0_2_denorm - base, 0, 0x130
    .word a_d_mls_0_2_tiny - base, 0, 0x130
    .word a_d_mls_0_2_zero - base, 0, 0x130
    .word a_d_mul_1_0_normal - base, 0, 0x130
    .word a_d_mul_1_0_nan - base, 0, 0x130
    .word a_d_mul_1_0_denorm - base, 0, 0x130
    .word a_d_mul_1_0_tiny - base, 0, 0x130
    .word a_d_mul_1_0_zero - base, 0, 0x130
    .word a_d_mla_1_0_normal - base, 0, 0x130
    .word a_d_mla_1_0_nan - base, 0, 0x130
    .word a_d_mla_1_0_denorm - base, 0, 0x130
    .word a_d_mla_1_0_tiny - base, 0, 0x130
    .word a_d_mla_1_0_zero - base, 0, 0x130
    .word a_d_mls_1_0_normal - base, 0, 0x130
    .word a_d_mls_1_0_nan - base, 0, 0x130
    .word a_d_mls_1_0_denorm - base, 0, 0x130
    .word a_d_mls_1_0_tiny - base, 0, 0x130
    .word a_d_mls_1_0_zero - base, 0, 0x130
    .word a_d_mul_1_1_normal - base, 0, 0x130
    .word a_d_mul_1_1_nan - base, 0, 0x130
    .word a_d_mul_1_1_denorm - base, 0, 0x130
    .word a_d_mul_1_1_tiny - base, 0, 0x130
    .word a_d_mul_1_1_zero - base, 0, 0x130
    .word a_d_mla_1_1_normal - base, 0, 0x130
    .word a_d_mla_1_1_nan - base, 0, 0x130
    .word a_d_mla_1_1_denorm - base, 0, 0x130
    .word a_d_mla_1_1_tiny - base, 0, 0x130
    .word a_d_mla_1_1_zero - base, 0, 0x130
    .word a_d_mls_1_1_normal - base, 0, 0x130
    .word a_d_mls_1_1_nan - base, 0, 0x130
    .word a_d_mls_1_1_denorm - base, 0, 0x130
    .word a_d_mls_1_1_tiny - base, 0, 0x130
    .word a_d_mls_1_1_zero - base, 0, 0x130
    .word a_d_mul_1_2_normal - base, 0, 0x130
    .word a_d_mul_1_2_nan - base, 0, 0x130
    .word a_d_mul_1_2_denorm - base, 0, 0x130
    .word a_d_mul_1_2_tiny - base, 0, 0x130
    .word a_d_mul_1_2_zero - base, 0, 0x130
    .word a_d_mla_1_2_normal - base, 0, 0x130
    .word a_d_mla_1_2_nan - base, 0, 0x130
    .word a_d_mla_1_2_denorm - base, 0, 0x130
    .word a_d_mla_1_2_tiny - base, 0, 0x130
    .word a_d_mla_1_2_zero - base, 0, 0x130
    .word a_d_mls_1_2_normal - base, 0, 0x130
    .word a_d_mls_1_2_nan - base, 0, 0x130
    .word a_d_mls_1_2_denorm - base, 0, 0x130
    .word a_d_mls_1_2_tiny - base, 0, 0x130
    .word a_d_mls_1_2_zero - base, 0, 0x130
    .word a_q_mul_0_0_normal - base, 0, 0x130
    .word a_q_mul_0_0_nan - base, 0, 0x130
    .word a_q_mul_0_0_denorm - base, 0, 0x130
    .word a_q_mul_0_0_tiny - base, 0, 0x130
    .word a_q_mul_0_0_zero - base, 0, 0x130
    .word a_q_mla_0_0_normal - base, 0, 0x130
    .word a_q_mla_0_0_nan - base, 0, 0x130
    .word a_q_mla_0_0_denorm - base, 0, 0x130
    .word a_q_mla_0_0_tiny - base, 0, 0x130
    .word a_q_mla_0_0_zero - base, 0, 0x130
    .word a_q_mls_0_0_normal - base, 0, 0x130
    .word a_q_mls_0_0_nan - base, 0, 0x130
    .word a_q_mls_0_0_denorm - base, 0, 0x130
    .word a_q_mls_0_0_tiny - base, 0, 0x130
    .word a_q_mls_0_0_zero - base, 0, 0x130
    .word a_q_mul_0_1_normal - base, 0, 0x130
    .word a_q_mul_0_1_nan - base, 0, 0x130
    .word a_q_mul_0_1_denorm - base, 0, 0x130
    .word a_q_mul_0_1_tiny - base, 0, 0x130
    .word a_q_mul_0_1_zero - base, 0, 0x130
    .word a_q_mla_0_1_normal - base, 0, 0x130
    .word a_q_mla_0_1_nan - base, 0, 0x130
    .word a_q_mla_0_1_denorm - base, 0, 0x130
    .word a_q_mla_0_1_tiny - base, 0, 0x130
    .word a_q_mla_0_1_zero - base, 0, 0x130
    .word a_q_mls_0_1_normal - base, 0, 0x130
    .word a_q_mls_0_1_nan - base, 0, 0x130
    .word a_q_mls_0_1_denorm - base, 0, 0x130
    .word a_q_mls_0_1_tiny - base, 0, 0x130
    .word a_q_mls_0_1_zero - base, 0, 0x130
    .word a_q_mul_0_2_normal - base, 0, 0x130
    .word a_q_mul_0_2_nan - base, 0, 0x130
    .word a_q_mul_0_2_denorm - base, 0, 0x130
    .word a_q_mul_0_2_tiny - base, 0, 0x130
    .word a_q_mul_0_2_zero - base, 0, 0x130
    .word a_q_mla_0_2_normal - base, 0, 0x130
    .word a_q_mla_0_2_nan - base, 0, 0x130
    .word a_q_mla_0_2_denorm - base, 0, 0x130
    .word a_q_mla_0_2_tiny - base, 0, 0x130
    .word a_q_mla_0_2_zero - base, 0, 0x130
    .word a_q_mls_0_2_normal - base, 0, 0x130
    .word a_q_mls_0_2_nan - base, 0, 0x130
    .word a_q_mls_0_2_denorm - base, 0, 0x130
    .word a_q_mls_0_2_tiny - base, 0, 0x130
    .word a_q_mls_0_2_zero - base, 0, 0x130
    .word a_q_mul_1_0_normal - base, 0, 0x130
    .word a_q_mul_1_0_nan - base, 0, 0x130
    .word a_q_mul_1_0_denorm - base, 0, 0x130
    .word a_q_mul_1_0_tiny - base, 0, 0x130
    .word a_q_mul_1_0_zero - base, 0, 0x130
    .word a_q_mla_1_0_normal - base, 0, 0x130
    .word a_q_mla_1_0_nan - base, 0, 0x130
    .word a_q_mla_1_0_denorm - base, 0, 0x130
    .word a_q_mla_1_0_tiny - base, 0, 0x130
    .word a_q_mla_1_0_zero - base, 0, 0x130
    .word a_q_mls_1_0_normal - base, 0, 0x130
    .word a_q_mls_1_0_nan - base, 0, 0x130
    .word a_q_mls_1_0_denorm - base, 0, 0x130
    .word a_q_mls_1_0_tiny - base, 0, 0x130
    .word a_q_mls_1_0_zero - base, 0, 0x130
    .word a_q_mul_1_1_normal - base, 0, 0x130
    .word a_q_mul_1_1_nan - base, 0, 0x130
    .word a_q_mul_1_1_denorm - base, 0, 0x130
    .word a_q_mul_1_1_tiny - base, 0, 0x130
    .word a_q_mul_1_1_zero - base, 0, 0x130
    .word a_q_mla_1_1_normal - base, 0, 0x130
    .word a_q_mla_1_1_nan - base, 0, 0x130
    .word a_q_mla_1_1_denorm - base, 0, 0x130
    .word a_q_mla_1_1_tiny - base, 0, 0x130
    .word a_q_mla_1_1_zero - base, 0, 0x130
    .word a_q_mls_1_1_normal - base, 0, 0x130
    .word a_q_mls_1_1_nan - base, 0, 0x130
    .word a_q_mls_1_1_denorm - base, 0, 0x130
    .word a_q_mls_1_1_tiny - base, 0, 0x130
    .word a_q_mls_1_1_zero - base, 0, 0x130
    .word a_q_mul_1_2_normal - base, 0, 0x130
    .word a_q_mul_1_2_nan - base, 0, 0x130
    .word a_q_mul_1_2_denorm - base, 0, 0x130
    .word a_q_mul_1_2_tiny - base, 0, 0x130
    .word a_q_mul_1_2_zero - base, 0, 0x130
    .word a_q_mla_1_2_normal - base, 0, 0x130
    .word a_q_mla_1_2_nan - base, 0, 0x130
    .word a_q_mla_1_2_denorm - base, 0, 0x130
    .word a_q_mla_1_2_tiny - base, 0, 0x130
    .word a_q_mla_1_2_zero - base, 0, 0x130
    .word a_q_mls_1_2_normal - base, 0, 0x130
    .word a_q_mls_1_2_nan - base, 0, 0x130
    .word a_q_mls_1_2_denorm - base, 0, 0x130
    .word a_q_mls_1_2_tiny - base, 0, 0x130
    .word a_q_mls_1_2_zero - base, 0, 0x130
    .word t_d_mul_0_0_normal - base + 1, 0, 0x130
    .word t_d_mul_0_0_nan - base + 1, 0, 0x130
    .word t_d_mul_0_0_denorm - base + 1, 0, 0x130
    .word t_d_mul_0_0_tiny - base + 1, 0, 0x130
    .word t_d_mul_0_0_zero - base + 1, 0, 0x130
    .word t_d_mla_0_0_normal - base + 1, 0, 0x130
    .word t_d_mla_0_0_nan - base + 1, 0, 0x130
    .word t_d_mla_0_0_denorm - base + 1, 0, 0x130
    .word t_d_mla_0_0_tiny - base + 1, 0, 0x130
    .word t_d_mla_0_0_zero - base + 1, 0, 0x130
    .word t_d_mls_0_0_normal - base + 1, 0, 0x130
    .word t_d_mls_0_0_nan - base + 1, 0, 0x130
    .word t_d_mls_0_0_denorm - base + 1, 0, 0x130
    .word t_d_mls_0_0_tiny - base + 1, 0, 0x130
    .word t_d_mls_0_0_zero - base + 1, 0, 0x130
    .word t_d_mul_0_1_normal - base + 1, 0, 0x130
    .word t_d_mul_0_1_nan - base + 1, 0, 0x130
    .word t_d_mul_0_1_denorm - base + 1, 0, 0x130
    .word t_d_mul_0_1_tiny - base + 1, 0, 0x130
    .word t_d_mul_0_1_zero - base + 1, 0, 0x130
    .word t_d_mla_0_1_normal - base + 1, 0, 0x130
    .word t_d_mla_0_1_nan - base + 1, 0, 0x130
    .word t_d_mla_0_1_denorm - base + 1, 0, 0x130
    .word t_d_mla_0_1_tiny - base + 1, 0, 0x130
    .word t_d_mla_0_1_zero - base + 1, 0, 0x130
    .word t_d_mls_0_1_normal - base + 1, 0, 0x130
    .word t_d_mls_0_1_nan - base + 1, 0, 0x130
    .word t_d_mls_0_1_denorm - base + 1, 0, 0x130
    .word t_d_mls_0_1_tiny - base + 1, 0, 0x130
    .word t_d_mls_0_1_zero - base + 1, 0, 0x130
    .word t_d_mul_0_2_normal - base + 1, 0, 0x130
    .word t_d_mul_0_2_nan - base + 1, 0, 0x130
    .word t_d_mul_0_2_denorm - base + 1, 0, 0x130
    .word t_d_mul_0_2_tiny - base + 1, 0, 0x130
    .word t_d_mul_0_2_zero - base + 1, 0, 0x130
    .word t_d_mla_0_2_normal - base + 1, 0, 0x130
    .word t_d_mla_0_2_nan - base + 1, 0, 0x130
    .word t_d_mla_0_2_denorm - base + 1, 0, 0x130
    .word t_d_mla_0_2_tiny - base + 1, 0, 0x130
    .word t_d_mla_0_2_zero - base + 1, 0, 0x130
    .word t_d_mls_0_2_normal - base + 1, 0, 0x130
    .word t_d_mls_0_2_nan - base + 1, 0, 0x130
    .word t_d_mls_0_2_denorm - base + 1, 0, 0x130
    .word t_d_mls_0_2_tiny - base + 1, 0, 0x130
    .word t_d_mls_0_2_zero - base + 1, 0, 0x130
    .word t_d_mul_1_0_normal - base + 1, 0, 0x130
    .word t_d_mul_1_0_nan - base + 1, 0, 0x130
    .word t_d_mul_1_0_denorm - base + 1, 0, 0x130
    .word t_d_mul_1_0_tiny - base + 1, 0, 0x130
    .word t_d_mul_1_0_zero - base + 1, 0, 0x130
    .word t_d_mla_1_0_normal - base + 1, 0, 0x130
    .word t_d_mla_1_0_nan - base + 1, 0, 0x130
    .word t_d_mla_1_0_denorm - base + 1, 0, 0x130
    .word t_d_mla_1_0_tiny - base + 1, 0, 0x130
    .word t_d_mla_1_0_zero - base + 1, 0, 0x130
    .word t_d_mls_1_0_normal - base + 1, 0, 0x130
    .word t_d_mls_1_0_nan - base + 1, 0, 0x130
    .word t_d_mls_1_0_denorm - base + 1, 0, 0x130
    .word t_d_mls_1_0_tiny - base + 1, 0, 0x130
    .word t_d_mls_1_0_zero - base + 1, 0, 0x130
    .word t_d_mul_1_1_normal - base + 1, 0, 0x130
    .word t_d_mul_1_1_nan - base + 1, 0, 0x130
    .word t_d_mul_1_1_denorm - base + 1, 0, 0x130
    .word t_d_mul_1_1_tiny - base + 1, 0, 0x130
    .word t_d_mul_1_1_zero - base + 1, 0, 0x130
    .word t_d_mla_1_1_normal - base + 1, 0, 0x130
    .word t_d_mla_1_1_nan - base + 1, 0, 0x130
    .word t_d_mla_1_1_denorm - base + 1, 0, 0x130
    .word t_d_mla_1_1_tiny - base + 1, 0, 0x130
    .word t_d_mla_1_1_zero - base + 1, 0, 0x130
    .word t_d_mls_1_1_normal - base + 1, 0, 0x130
    .word t_d_mls_1_1_nan - base + 1, 0, 0x130
    .word t_d_mls_1_1_denorm - base + 1, 0, 0x130
    .word t_d_mls_1_1_tiny - base + 1, 0, 0x130
    .word t_d_mls_1_1_zero - base + 1, 0, 0x130
    .word t_d_mul_1_2_normal - base + 1, 0, 0x130
    .word t_d_mul_1_2_nan - base + 1, 0, 0x130
    .word t_d_mul_1_2_denorm - base + 1, 0, 0x130
    .word t_d_mul_1_2_tiny - base + 1, 0, 0x130
    .word t_d_mul_1_2_zero - base + 1, 0, 0x130
    .word t_d_mla_1_2_normal - base + 1, 0, 0x130
    .word t_d_mla_1_2_nan - base + 1, 0, 0x130
    .word t_d_mla_1_2_denorm - base + 1, 0, 0x130
    .word t_d_mla_1_2_tiny - base + 1, 0, 0x130
    .word t_d_mla_1_2_zero - base + 1, 0, 0x130
    .word t_d_mls_1_2_normal - base + 1, 0, 0x130
    .word t_d_mls_1_2_nan - base + 1, 0, 0x130
    .word t_d_mls_1_2_denorm - base + 1, 0, 0x130
    .word t_d_mls_1_2_tiny - base + 1, 0, 0x130
    .word t_d_mls_1_2_zero - base + 1, 0, 0x130
    .word t_q_mul_0_0_normal - base + 1, 0, 0x130
    .word t_q_mul_0_0_nan - base + 1, 0, 0x130
    .word t_q_mul_0_0_denorm - base + 1, 0, 0x130
    .word t_q_mul_0_0_tiny - base + 1, 0, 0x130
    .word t_q_mul_0_0_zero - base + 1, 0, 0x130
    .word t_q_mla_0_0_normal - base + 1, 0, 0x130
    .word t_q_mla_0_0_nan - base + 1, 0, 0x130
    .word t_q_mla_0_0_denorm - base + 1, 0, 0x130
    .word t_q_mla_0_0_tiny - base + 1, 0, 0x130
    .word t_q_mla_0_0_zero - base + 1, 0, 0x130
    .word t_q_mls_0_0_normal - base + 1, 0, 0x130
    .word t_q_mls_0_0_nan - base + 1, 0, 0x130
    .word t_q_mls_0_0_denorm - base + 1, 0, 0x130
    .word t_q_mls_0_0_tiny - base + 1, 0, 0x130
    .word t_q_mls_0_0_zero - base + 1, 0, 0x130
    .word t_q_mul_0_1_normal - base + 1, 0, 0x130
    .word t_q_mul_0_1_nan - base + 1, 0, 0x130
    .word t_q_mul_0_1_denorm - base + 1, 0, 0x130
    .word t_q_mul_0_1_tiny - base + 1, 0, 0x130
    .word t_q_mul_0_1_zero - base + 1, 0, 0x130
    .word t_q_mla_0_1_normal - base + 1, 0, 0x130
    .word t_q_mla_0_1_nan - base + 1, 0, 0x130
    .word t_q_mla_0_1_denorm - base + 1, 0, 0x130
    .word t_q_mla_0_1_tiny - base + 1, 0, 0x130
    .word t_q_mla_0_1_zero - base + 1, 0, 0x130
    .word t_q_mls_0_1_normal - base + 1, 0, 0x130
    .word t_q_mls_0_1_nan - base + 1, 0, 0x130
    .word t_q_mls_0_1_denorm - base + 1, 0, 0x130
    .word t_q_mls_0_1_tiny - base + 1, 0, 0x130
    .word t_q_mls_0_1_zero - base + 1, 0, 0x130
    .word t_q_mul_0_2_normal - base + 1, 0, 0x130
    .word t_q_mul_0_2_nan - base + 1, 0, 0x130
    .word t_q_mul_0_2_denorm - base + 1, 0, 0x130
    .word t_q_mul_0_2_tiny - base + 1, 0, 0x130
    .word t_q_mul_0_2_zero - base + 1, 0, 0x130
    .word t_q_mla_0_2_normal - base + 1, 0, 0x130
    .word t_q_mla_0_2_nan - base + 1, 0, 0x130
    .word t_q_mla_0_2_denorm - base + 1, 0, 0x130
    .word t_q_mla_0_2_tiny - base + 1, 0, 0x130
    .word t_q_mla_0_2_zero - base + 1, 0, 0x130
    .word t_q_mls_0_2_normal - base + 1, 0, 0x130
    .word t_q_mls_0_2_nan - base + 1, 0, 0x130
    .word t_q_mls_0_2_denorm - base + 1, 0, 0x130
    .word t_q_mls_0_2_tiny - base + 1, 0, 0x130
    .word t_q_mls_0_2_zero - base + 1, 0, 0x130
    .word t_q_mul_1_0_normal - base + 1, 0, 0x130
    .word t_q_mul_1_0_nan - base + 1, 0, 0x130
    .word t_q_mul_1_0_denorm - base + 1, 0, 0x130
    .word t_q_mul_1_0_tiny - base + 1, 0, 0x130
    .word t_q_mul_1_0_zero - base + 1, 0, 0x130
    .word t_q_mla_1_0_normal - base + 1, 0, 0x130
    .word t_q_mla_1_0_nan - base + 1, 0, 0x130
    .word t_q_mla_1_0_denorm - base + 1, 0, 0x130
    .word t_q_mla_1_0_tiny - base + 1, 0, 0x130
    .word t_q_mla_1_0_zero - base + 1, 0, 0x130
    .word t_q_mls_1_0_normal - base + 1, 0, 0x130
    .word t_q_mls_1_0_nan - base + 1, 0, 0x130
    .word t_q_mls_1_0_denorm - base + 1, 0, 0x130
    .word t_q_mls_1_0_tiny - base + 1, 0, 0x130
    .word t_q_mls_1_0_zero - base + 1, 0, 0x130
    .word t_q_mul_1_1_normal - base + 1, 0, 0x130
    .word t_q_mul_1_1_nan - base + 1, 0, 0x130
    .word t_q_mul_1_1_denorm - base + 1, 0, 0x130
    .word t_q_mul_1_1_tiny - base + 1, 0, 0x130
    .word t_q_mul_1_1_zero - base + 1, 0, 0x130
    .word t_q_mla_1_1_normal - base + 1, 0, 0x130
    .word t_q_mla_1_1_nan - base + 1, 0, 0x130
    .word t_q_mla_1_1_denorm - base + 1, 0, 0x130
    .word t_q_mla_1_1_tiny - base + 1, 0, 0x130
    .word t_q_mla_1_1_zero - base + 1, 0, 0x130
    .word t_q_mls_1_1_normal - base + 1, 0, 0x130
    .word t_q_mls_1_1_nan - base + 1, 0, 0x130
    .word t_q_mls_1_1_denorm - base + 1, 0, 0x130
    .word t_q_mls_1_1_tiny - base + 1, 0, 0x130
    .word t_q_mls_1_1_zero - base + 1, 0, 0x130
    .word t_q_mul_1_2_normal - base + 1, 0, 0x130
    .word t_q_mul_1_2_nan - base + 1, 0, 0x130
    .word t_q_mul_1_2_denorm - base + 1, 0, 0x130
    .word t_q_mul_1_2_tiny - base + 1, 0, 0x130
    .word t_q_mul_1_2_zero - base + 1, 0, 0x130
    .word t_q_mla_1_2_normal - base + 1, 0, 0x130
    .word t_q_mla_1_2_nan - base + 1, 0, 0x130
    .word t_q_mla_1_2_denorm - base + 1, 0, 0x130
    .word t_q_mla_1_2_tiny - base + 1, 0, 0x130
    .word t_q_mla_1_2_zero - base + 1, 0, 0x130
    .word t_q_mls_1_2_normal - base + 1, 0, 0x130
    .word t_q_mls_1_2_nan - base + 1, 0, 0x130
    .word t_q_mls_1_2_denorm - base + 1, 0, 0x130
    .word t_q_mls_1_2_tiny - base + 1, 0, 0x130
    .word t_q_mls_1_2_zero - base + 1, 0, 0x130
    .word arm_trap - base, 0, 0x100
    .word thumb_trap - base + 1, 0, 0x110
    .word odd_d - base, 0, 0x130
    .word odd_n - base, 0, 0x130

    .macro exercise name, shape, lane, alias, op, scalar, vector, acc
\name:
    movw r0, #(\acc & 0xffff)
    movt r0, #(\acc >> 16)
    vdup.32 q4, r0
    movw r1, #(\vector & 0xffff)
    movt r1, #(\vector >> 16)
    vdup.32 q1, r1
    movw r2, #(\scalar & 0xffff)
    movt r2, #(\scalar >> 16)
    vdup.32 d7, r2
    .if \alias == 2
        .ifc \shape,q
            vmov.32 d9[\lane], r2
        .else
            vmov.32 d8[\lane], r2
        .endif
    .endif
    movw r0, #0x10
    movt r0, #0x00c0
    vmsr fpscr, r0
    movw r12, #128
1:  vmov d0, d8
    vmov d1, d9
    .ifc \shape,q
        .if \alias == 1
            v\op\().f32 q0, q0, d7[\lane]
        .elseif \alias == 2
            v\op\().f32 q0, q1, d1[\lane]
        .else
            v\op\().f32 q0, q1, d7[\lane]
        .endif
    .else
        .if \alias == 1
            v\op\().f32 d0, d0, d7[\lane]
        .elseif \alias == 2
            v\op\().f32 d0, d2, d0[\lane]
        .else
            v\op\().f32 d0, d2, d7[\lane]
        .endif
    .endif
    subs r12, r12, #1
    bne 1b
    vmov r4, r5, d0
    vmov r6, r7, d1
    vmrs r3, fpscr
    svc #0
    .endm

    .arm
    .balign 4
    exercise a_d_mul_0_0_normal, d, 0, 0, mul, 0x3f800001, 0x3f7fffff, 0xbf800000
    exercise a_d_mul_0_0_nan, d, 0, 0, mul, 0x7f800001, 0x3f800000, 0x00000000
    exercise a_d_mul_0_0_denorm, d, 0, 0, mul, 0x00000001, 0x3f800000, 0x3fc00000
    exercise a_d_mul_0_0_tiny, d, 0, 0, mul, 0x00800000, 0x00800000, 0x00000000
    exercise a_d_mul_0_0_zero, d, 0, 0, mul, 0x80000000, 0x3f800000, 0x80000000
    exercise a_d_mla_0_0_normal, d, 0, 0, mla, 0x3f800001, 0x3f7fffff, 0xbf800000
    exercise a_d_mla_0_0_nan, d, 0, 0, mla, 0x7f800001, 0x3f800000, 0x00000000
    exercise a_d_mla_0_0_denorm, d, 0, 0, mla, 0x00000001, 0x3f800000, 0x3fc00000
    exercise a_d_mla_0_0_tiny, d, 0, 0, mla, 0x00800000, 0x00800000, 0x00000000
    exercise a_d_mla_0_0_zero, d, 0, 0, mla, 0x80000000, 0x3f800000, 0x80000000
    exercise a_d_mls_0_0_normal, d, 0, 0, mls, 0x3f800001, 0x3f7fffff, 0xbf800000
    exercise a_d_mls_0_0_nan, d, 0, 0, mls, 0x7f800001, 0x3f800000, 0x00000000
    exercise a_d_mls_0_0_denorm, d, 0, 0, mls, 0x00000001, 0x3f800000, 0x3fc00000
    exercise a_d_mls_0_0_tiny, d, 0, 0, mls, 0x00800000, 0x00800000, 0x00000000
    exercise a_d_mls_0_0_zero, d, 0, 0, mls, 0x80000000, 0x3f800000, 0x80000000
    exercise a_d_mul_0_1_normal, d, 0, 1, mul, 0x3f800001, 0x3f7fffff, 0xbf800000
    exercise a_d_mul_0_1_nan, d, 0, 1, mul, 0x7f800001, 0x3f800000, 0x00000000
    exercise a_d_mul_0_1_denorm, d, 0, 1, mul, 0x00000001, 0x3f800000, 0x3fc00000
    exercise a_d_mul_0_1_tiny, d, 0, 1, mul, 0x00800000, 0x00800000, 0x00000000
    exercise a_d_mul_0_1_zero, d, 0, 1, mul, 0x80000000, 0x3f800000, 0x80000000
    exercise a_d_mla_0_1_normal, d, 0, 1, mla, 0x3f800001, 0x3f7fffff, 0xbf800000
    exercise a_d_mla_0_1_nan, d, 0, 1, mla, 0x7f800001, 0x3f800000, 0x00000000
    exercise a_d_mla_0_1_denorm, d, 0, 1, mla, 0x00000001, 0x3f800000, 0x3fc00000
    exercise a_d_mla_0_1_tiny, d, 0, 1, mla, 0x00800000, 0x00800000, 0x00000000
    exercise a_d_mla_0_1_zero, d, 0, 1, mla, 0x80000000, 0x3f800000, 0x80000000
    exercise a_d_mls_0_1_normal, d, 0, 1, mls, 0x3f800001, 0x3f7fffff, 0xbf800000
    exercise a_d_mls_0_1_nan, d, 0, 1, mls, 0x7f800001, 0x3f800000, 0x00000000
    exercise a_d_mls_0_1_denorm, d, 0, 1, mls, 0x00000001, 0x3f800000, 0x3fc00000
    exercise a_d_mls_0_1_tiny, d, 0, 1, mls, 0x00800000, 0x00800000, 0x00000000
    exercise a_d_mls_0_1_zero, d, 0, 1, mls, 0x80000000, 0x3f800000, 0x80000000
    exercise a_d_mul_0_2_normal, d, 0, 2, mul, 0x3f800001, 0x3f7fffff, 0xbf800000
    exercise a_d_mul_0_2_nan, d, 0, 2, mul, 0x7f800001, 0x3f800000, 0x00000000
    exercise a_d_mul_0_2_denorm, d, 0, 2, mul, 0x00000001, 0x3f800000, 0x3fc00000
    exercise a_d_mul_0_2_tiny, d, 0, 2, mul, 0x00800000, 0x00800000, 0x00000000
    exercise a_d_mul_0_2_zero, d, 0, 2, mul, 0x80000000, 0x3f800000, 0x80000000
    exercise a_d_mla_0_2_normal, d, 0, 2, mla, 0x3f800001, 0x3f7fffff, 0xbf800000
    exercise a_d_mla_0_2_nan, d, 0, 2, mla, 0x7f800001, 0x3f800000, 0x00000000
    exercise a_d_mla_0_2_denorm, d, 0, 2, mla, 0x00000001, 0x3f800000, 0x3fc00000
    exercise a_d_mla_0_2_tiny, d, 0, 2, mla, 0x00800000, 0x00800000, 0x00000000
    exercise a_d_mla_0_2_zero, d, 0, 2, mla, 0x80000000, 0x3f800000, 0x80000000
    exercise a_d_mls_0_2_normal, d, 0, 2, mls, 0x3f800001, 0x3f7fffff, 0xbf800000
    exercise a_d_mls_0_2_nan, d, 0, 2, mls, 0x7f800001, 0x3f800000, 0x00000000
    exercise a_d_mls_0_2_denorm, d, 0, 2, mls, 0x00000001, 0x3f800000, 0x3fc00000
    exercise a_d_mls_0_2_tiny, d, 0, 2, mls, 0x00800000, 0x00800000, 0x00000000
    exercise a_d_mls_0_2_zero, d, 0, 2, mls, 0x80000000, 0x3f800000, 0x80000000
    exercise a_d_mul_1_0_normal, d, 1, 0, mul, 0x3f800001, 0x3f7fffff, 0xbf800000
    exercise a_d_mul_1_0_nan, d, 1, 0, mul, 0x7f800001, 0x3f800000, 0x00000000
    exercise a_d_mul_1_0_denorm, d, 1, 0, mul, 0x00000001, 0x3f800000, 0x3fc00000
    exercise a_d_mul_1_0_tiny, d, 1, 0, mul, 0x00800000, 0x00800000, 0x00000000
    exercise a_d_mul_1_0_zero, d, 1, 0, mul, 0x80000000, 0x3f800000, 0x80000000
    exercise a_d_mla_1_0_normal, d, 1, 0, mla, 0x3f800001, 0x3f7fffff, 0xbf800000
    exercise a_d_mla_1_0_nan, d, 1, 0, mla, 0x7f800001, 0x3f800000, 0x00000000
    exercise a_d_mla_1_0_denorm, d, 1, 0, mla, 0x00000001, 0x3f800000, 0x3fc00000
    exercise a_d_mla_1_0_tiny, d, 1, 0, mla, 0x00800000, 0x00800000, 0x00000000
    exercise a_d_mla_1_0_zero, d, 1, 0, mla, 0x80000000, 0x3f800000, 0x80000000
    exercise a_d_mls_1_0_normal, d, 1, 0, mls, 0x3f800001, 0x3f7fffff, 0xbf800000
    exercise a_d_mls_1_0_nan, d, 1, 0, mls, 0x7f800001, 0x3f800000, 0x00000000
    exercise a_d_mls_1_0_denorm, d, 1, 0, mls, 0x00000001, 0x3f800000, 0x3fc00000
    exercise a_d_mls_1_0_tiny, d, 1, 0, mls, 0x00800000, 0x00800000, 0x00000000
    exercise a_d_mls_1_0_zero, d, 1, 0, mls, 0x80000000, 0x3f800000, 0x80000000
    exercise a_d_mul_1_1_normal, d, 1, 1, mul, 0x3f800001, 0x3f7fffff, 0xbf800000
    exercise a_d_mul_1_1_nan, d, 1, 1, mul, 0x7f800001, 0x3f800000, 0x00000000
    exercise a_d_mul_1_1_denorm, d, 1, 1, mul, 0x00000001, 0x3f800000, 0x3fc00000
    exercise a_d_mul_1_1_tiny, d, 1, 1, mul, 0x00800000, 0x00800000, 0x00000000
    exercise a_d_mul_1_1_zero, d, 1, 1, mul, 0x80000000, 0x3f800000, 0x80000000
    exercise a_d_mla_1_1_normal, d, 1, 1, mla, 0x3f800001, 0x3f7fffff, 0xbf800000
    exercise a_d_mla_1_1_nan, d, 1, 1, mla, 0x7f800001, 0x3f800000, 0x00000000
    exercise a_d_mla_1_1_denorm, d, 1, 1, mla, 0x00000001, 0x3f800000, 0x3fc00000
    exercise a_d_mla_1_1_tiny, d, 1, 1, mla, 0x00800000, 0x00800000, 0x00000000
    exercise a_d_mla_1_1_zero, d, 1, 1, mla, 0x80000000, 0x3f800000, 0x80000000
    exercise a_d_mls_1_1_normal, d, 1, 1, mls, 0x3f800001, 0x3f7fffff, 0xbf800000
    exercise a_d_mls_1_1_nan, d, 1, 1, mls, 0x7f800001, 0x3f800000, 0x00000000
    exercise a_d_mls_1_1_denorm, d, 1, 1, mls, 0x00000001, 0x3f800000, 0x3fc00000
    exercise a_d_mls_1_1_tiny, d, 1, 1, mls, 0x00800000, 0x00800000, 0x00000000
    exercise a_d_mls_1_1_zero, d, 1, 1, mls, 0x80000000, 0x3f800000, 0x80000000
    exercise a_d_mul_1_2_normal, d, 1, 2, mul, 0x3f800001, 0x3f7fffff, 0xbf800000
    exercise a_d_mul_1_2_nan, d, 1, 2, mul, 0x7f800001, 0x3f800000, 0x00000000
    exercise a_d_mul_1_2_denorm, d, 1, 2, mul, 0x00000001, 0x3f800000, 0x3fc00000
    exercise a_d_mul_1_2_tiny, d, 1, 2, mul, 0x00800000, 0x00800000, 0x00000000
    exercise a_d_mul_1_2_zero, d, 1, 2, mul, 0x80000000, 0x3f800000, 0x80000000
    exercise a_d_mla_1_2_normal, d, 1, 2, mla, 0x3f800001, 0x3f7fffff, 0xbf800000
    exercise a_d_mla_1_2_nan, d, 1, 2, mla, 0x7f800001, 0x3f800000, 0x00000000
    exercise a_d_mla_1_2_denorm, d, 1, 2, mla, 0x00000001, 0x3f800000, 0x3fc00000
    exercise a_d_mla_1_2_tiny, d, 1, 2, mla, 0x00800000, 0x00800000, 0x00000000
    exercise a_d_mla_1_2_zero, d, 1, 2, mla, 0x80000000, 0x3f800000, 0x80000000
    exercise a_d_mls_1_2_normal, d, 1, 2, mls, 0x3f800001, 0x3f7fffff, 0xbf800000
    exercise a_d_mls_1_2_nan, d, 1, 2, mls, 0x7f800001, 0x3f800000, 0x00000000
    exercise a_d_mls_1_2_denorm, d, 1, 2, mls, 0x00000001, 0x3f800000, 0x3fc00000
    exercise a_d_mls_1_2_tiny, d, 1, 2, mls, 0x00800000, 0x00800000, 0x00000000
    exercise a_d_mls_1_2_zero, d, 1, 2, mls, 0x80000000, 0x3f800000, 0x80000000
    exercise a_q_mul_0_0_normal, q, 0, 0, mul, 0x3f800001, 0x3f7fffff, 0xbf800000
    exercise a_q_mul_0_0_nan, q, 0, 0, mul, 0x7f800001, 0x3f800000, 0x00000000
    exercise a_q_mul_0_0_denorm, q, 0, 0, mul, 0x00000001, 0x3f800000, 0x3fc00000
    exercise a_q_mul_0_0_tiny, q, 0, 0, mul, 0x00800000, 0x00800000, 0x00000000
    exercise a_q_mul_0_0_zero, q, 0, 0, mul, 0x80000000, 0x3f800000, 0x80000000
    exercise a_q_mla_0_0_normal, q, 0, 0, mla, 0x3f800001, 0x3f7fffff, 0xbf800000
    exercise a_q_mla_0_0_nan, q, 0, 0, mla, 0x7f800001, 0x3f800000, 0x00000000
    exercise a_q_mla_0_0_denorm, q, 0, 0, mla, 0x00000001, 0x3f800000, 0x3fc00000
    exercise a_q_mla_0_0_tiny, q, 0, 0, mla, 0x00800000, 0x00800000, 0x00000000
    exercise a_q_mla_0_0_zero, q, 0, 0, mla, 0x80000000, 0x3f800000, 0x80000000
    exercise a_q_mls_0_0_normal, q, 0, 0, mls, 0x3f800001, 0x3f7fffff, 0xbf800000
    exercise a_q_mls_0_0_nan, q, 0, 0, mls, 0x7f800001, 0x3f800000, 0x00000000
    exercise a_q_mls_0_0_denorm, q, 0, 0, mls, 0x00000001, 0x3f800000, 0x3fc00000
    exercise a_q_mls_0_0_tiny, q, 0, 0, mls, 0x00800000, 0x00800000, 0x00000000
    exercise a_q_mls_0_0_zero, q, 0, 0, mls, 0x80000000, 0x3f800000, 0x80000000
    exercise a_q_mul_0_1_normal, q, 0, 1, mul, 0x3f800001, 0x3f7fffff, 0xbf800000
    exercise a_q_mul_0_1_nan, q, 0, 1, mul, 0x7f800001, 0x3f800000, 0x00000000
    exercise a_q_mul_0_1_denorm, q, 0, 1, mul, 0x00000001, 0x3f800000, 0x3fc00000
    exercise a_q_mul_0_1_tiny, q, 0, 1, mul, 0x00800000, 0x00800000, 0x00000000
    exercise a_q_mul_0_1_zero, q, 0, 1, mul, 0x80000000, 0x3f800000, 0x80000000
    exercise a_q_mla_0_1_normal, q, 0, 1, mla, 0x3f800001, 0x3f7fffff, 0xbf800000
    exercise a_q_mla_0_1_nan, q, 0, 1, mla, 0x7f800001, 0x3f800000, 0x00000000
    exercise a_q_mla_0_1_denorm, q, 0, 1, mla, 0x00000001, 0x3f800000, 0x3fc00000
    exercise a_q_mla_0_1_tiny, q, 0, 1, mla, 0x00800000, 0x00800000, 0x00000000
    exercise a_q_mla_0_1_zero, q, 0, 1, mla, 0x80000000, 0x3f800000, 0x80000000
    exercise a_q_mls_0_1_normal, q, 0, 1, mls, 0x3f800001, 0x3f7fffff, 0xbf800000
    exercise a_q_mls_0_1_nan, q, 0, 1, mls, 0x7f800001, 0x3f800000, 0x00000000
    exercise a_q_mls_0_1_denorm, q, 0, 1, mls, 0x00000001, 0x3f800000, 0x3fc00000
    exercise a_q_mls_0_1_tiny, q, 0, 1, mls, 0x00800000, 0x00800000, 0x00000000
    exercise a_q_mls_0_1_zero, q, 0, 1, mls, 0x80000000, 0x3f800000, 0x80000000
    exercise a_q_mul_0_2_normal, q, 0, 2, mul, 0x3f800001, 0x3f7fffff, 0xbf800000
    exercise a_q_mul_0_2_nan, q, 0, 2, mul, 0x7f800001, 0x3f800000, 0x00000000
    exercise a_q_mul_0_2_denorm, q, 0, 2, mul, 0x00000001, 0x3f800000, 0x3fc00000
    exercise a_q_mul_0_2_tiny, q, 0, 2, mul, 0x00800000, 0x00800000, 0x00000000
    exercise a_q_mul_0_2_zero, q, 0, 2, mul, 0x80000000, 0x3f800000, 0x80000000
    exercise a_q_mla_0_2_normal, q, 0, 2, mla, 0x3f800001, 0x3f7fffff, 0xbf800000
    exercise a_q_mla_0_2_nan, q, 0, 2, mla, 0x7f800001, 0x3f800000, 0x00000000
    exercise a_q_mla_0_2_denorm, q, 0, 2, mla, 0x00000001, 0x3f800000, 0x3fc00000
    exercise a_q_mla_0_2_tiny, q, 0, 2, mla, 0x00800000, 0x00800000, 0x00000000
    exercise a_q_mla_0_2_zero, q, 0, 2, mla, 0x80000000, 0x3f800000, 0x80000000
    exercise a_q_mls_0_2_normal, q, 0, 2, mls, 0x3f800001, 0x3f7fffff, 0xbf800000
    exercise a_q_mls_0_2_nan, q, 0, 2, mls, 0x7f800001, 0x3f800000, 0x00000000
    exercise a_q_mls_0_2_denorm, q, 0, 2, mls, 0x00000001, 0x3f800000, 0x3fc00000
    exercise a_q_mls_0_2_tiny, q, 0, 2, mls, 0x00800000, 0x00800000, 0x00000000
    exercise a_q_mls_0_2_zero, q, 0, 2, mls, 0x80000000, 0x3f800000, 0x80000000
    exercise a_q_mul_1_0_normal, q, 1, 0, mul, 0x3f800001, 0x3f7fffff, 0xbf800000
    exercise a_q_mul_1_0_nan, q, 1, 0, mul, 0x7f800001, 0x3f800000, 0x00000000
    exercise a_q_mul_1_0_denorm, q, 1, 0, mul, 0x00000001, 0x3f800000, 0x3fc00000
    exercise a_q_mul_1_0_tiny, q, 1, 0, mul, 0x00800000, 0x00800000, 0x00000000
    exercise a_q_mul_1_0_zero, q, 1, 0, mul, 0x80000000, 0x3f800000, 0x80000000
    exercise a_q_mla_1_0_normal, q, 1, 0, mla, 0x3f800001, 0x3f7fffff, 0xbf800000
    exercise a_q_mla_1_0_nan, q, 1, 0, mla, 0x7f800001, 0x3f800000, 0x00000000
    exercise a_q_mla_1_0_denorm, q, 1, 0, mla, 0x00000001, 0x3f800000, 0x3fc00000
    exercise a_q_mla_1_0_tiny, q, 1, 0, mla, 0x00800000, 0x00800000, 0x00000000
    exercise a_q_mla_1_0_zero, q, 1, 0, mla, 0x80000000, 0x3f800000, 0x80000000
    exercise a_q_mls_1_0_normal, q, 1, 0, mls, 0x3f800001, 0x3f7fffff, 0xbf800000
    exercise a_q_mls_1_0_nan, q, 1, 0, mls, 0x7f800001, 0x3f800000, 0x00000000
    exercise a_q_mls_1_0_denorm, q, 1, 0, mls, 0x00000001, 0x3f800000, 0x3fc00000
    exercise a_q_mls_1_0_tiny, q, 1, 0, mls, 0x00800000, 0x00800000, 0x00000000
    exercise a_q_mls_1_0_zero, q, 1, 0, mls, 0x80000000, 0x3f800000, 0x80000000
    exercise a_q_mul_1_1_normal, q, 1, 1, mul, 0x3f800001, 0x3f7fffff, 0xbf800000
    exercise a_q_mul_1_1_nan, q, 1, 1, mul, 0x7f800001, 0x3f800000, 0x00000000
    exercise a_q_mul_1_1_denorm, q, 1, 1, mul, 0x00000001, 0x3f800000, 0x3fc00000
    exercise a_q_mul_1_1_tiny, q, 1, 1, mul, 0x00800000, 0x00800000, 0x00000000
    exercise a_q_mul_1_1_zero, q, 1, 1, mul, 0x80000000, 0x3f800000, 0x80000000
    exercise a_q_mla_1_1_normal, q, 1, 1, mla, 0x3f800001, 0x3f7fffff, 0xbf800000
    exercise a_q_mla_1_1_nan, q, 1, 1, mla, 0x7f800001, 0x3f800000, 0x00000000
    exercise a_q_mla_1_1_denorm, q, 1, 1, mla, 0x00000001, 0x3f800000, 0x3fc00000
    exercise a_q_mla_1_1_tiny, q, 1, 1, mla, 0x00800000, 0x00800000, 0x00000000
    exercise a_q_mla_1_1_zero, q, 1, 1, mla, 0x80000000, 0x3f800000, 0x80000000
    exercise a_q_mls_1_1_normal, q, 1, 1, mls, 0x3f800001, 0x3f7fffff, 0xbf800000
    exercise a_q_mls_1_1_nan, q, 1, 1, mls, 0x7f800001, 0x3f800000, 0x00000000
    exercise a_q_mls_1_1_denorm, q, 1, 1, mls, 0x00000001, 0x3f800000, 0x3fc00000
    exercise a_q_mls_1_1_tiny, q, 1, 1, mls, 0x00800000, 0x00800000, 0x00000000
    exercise a_q_mls_1_1_zero, q, 1, 1, mls, 0x80000000, 0x3f800000, 0x80000000
    exercise a_q_mul_1_2_normal, q, 1, 2, mul, 0x3f800001, 0x3f7fffff, 0xbf800000
    exercise a_q_mul_1_2_nan, q, 1, 2, mul, 0x7f800001, 0x3f800000, 0x00000000
    exercise a_q_mul_1_2_denorm, q, 1, 2, mul, 0x00000001, 0x3f800000, 0x3fc00000
    exercise a_q_mul_1_2_tiny, q, 1, 2, mul, 0x00800000, 0x00800000, 0x00000000
    exercise a_q_mul_1_2_zero, q, 1, 2, mul, 0x80000000, 0x3f800000, 0x80000000
    exercise a_q_mla_1_2_normal, q, 1, 2, mla, 0x3f800001, 0x3f7fffff, 0xbf800000
    exercise a_q_mla_1_2_nan, q, 1, 2, mla, 0x7f800001, 0x3f800000, 0x00000000
    exercise a_q_mla_1_2_denorm, q, 1, 2, mla, 0x00000001, 0x3f800000, 0x3fc00000
    exercise a_q_mla_1_2_tiny, q, 1, 2, mla, 0x00800000, 0x00800000, 0x00000000
    exercise a_q_mla_1_2_zero, q, 1, 2, mla, 0x80000000, 0x3f800000, 0x80000000
    exercise a_q_mls_1_2_normal, q, 1, 2, mls, 0x3f800001, 0x3f7fffff, 0xbf800000
    exercise a_q_mls_1_2_nan, q, 1, 2, mls, 0x7f800001, 0x3f800000, 0x00000000
    exercise a_q_mls_1_2_denorm, q, 1, 2, mls, 0x00000001, 0x3f800000, 0x3fc00000
    exercise a_q_mls_1_2_tiny, q, 1, 2, mls, 0x00800000, 0x00800000, 0x00000000
    exercise a_q_mls_1_2_zero, q, 1, 2, mls, 0x80000000, 0x3f800000, 0x80000000
    .thumb
    .balign 4
    exercise t_d_mul_0_0_normal, d, 0, 0, mul, 0x3f800001, 0x3f7fffff, 0xbf800000
    exercise t_d_mul_0_0_nan, d, 0, 0, mul, 0x7f800001, 0x3f800000, 0x00000000
    exercise t_d_mul_0_0_denorm, d, 0, 0, mul, 0x00000001, 0x3f800000, 0x3fc00000
    exercise t_d_mul_0_0_tiny, d, 0, 0, mul, 0x00800000, 0x00800000, 0x00000000
    exercise t_d_mul_0_0_zero, d, 0, 0, mul, 0x80000000, 0x3f800000, 0x80000000
    exercise t_d_mla_0_0_normal, d, 0, 0, mla, 0x3f800001, 0x3f7fffff, 0xbf800000
    exercise t_d_mla_0_0_nan, d, 0, 0, mla, 0x7f800001, 0x3f800000, 0x00000000
    exercise t_d_mla_0_0_denorm, d, 0, 0, mla, 0x00000001, 0x3f800000, 0x3fc00000
    exercise t_d_mla_0_0_tiny, d, 0, 0, mla, 0x00800000, 0x00800000, 0x00000000
    exercise t_d_mla_0_0_zero, d, 0, 0, mla, 0x80000000, 0x3f800000, 0x80000000
    exercise t_d_mls_0_0_normal, d, 0, 0, mls, 0x3f800001, 0x3f7fffff, 0xbf800000
    exercise t_d_mls_0_0_nan, d, 0, 0, mls, 0x7f800001, 0x3f800000, 0x00000000
    exercise t_d_mls_0_0_denorm, d, 0, 0, mls, 0x00000001, 0x3f800000, 0x3fc00000
    exercise t_d_mls_0_0_tiny, d, 0, 0, mls, 0x00800000, 0x00800000, 0x00000000
    exercise t_d_mls_0_0_zero, d, 0, 0, mls, 0x80000000, 0x3f800000, 0x80000000
    exercise t_d_mul_0_1_normal, d, 0, 1, mul, 0x3f800001, 0x3f7fffff, 0xbf800000
    exercise t_d_mul_0_1_nan, d, 0, 1, mul, 0x7f800001, 0x3f800000, 0x00000000
    exercise t_d_mul_0_1_denorm, d, 0, 1, mul, 0x00000001, 0x3f800000, 0x3fc00000
    exercise t_d_mul_0_1_tiny, d, 0, 1, mul, 0x00800000, 0x00800000, 0x00000000
    exercise t_d_mul_0_1_zero, d, 0, 1, mul, 0x80000000, 0x3f800000, 0x80000000
    exercise t_d_mla_0_1_normal, d, 0, 1, mla, 0x3f800001, 0x3f7fffff, 0xbf800000
    exercise t_d_mla_0_1_nan, d, 0, 1, mla, 0x7f800001, 0x3f800000, 0x00000000
    exercise t_d_mla_0_1_denorm, d, 0, 1, mla, 0x00000001, 0x3f800000, 0x3fc00000
    exercise t_d_mla_0_1_tiny, d, 0, 1, mla, 0x00800000, 0x00800000, 0x00000000
    exercise t_d_mla_0_1_zero, d, 0, 1, mla, 0x80000000, 0x3f800000, 0x80000000
    exercise t_d_mls_0_1_normal, d, 0, 1, mls, 0x3f800001, 0x3f7fffff, 0xbf800000
    exercise t_d_mls_0_1_nan, d, 0, 1, mls, 0x7f800001, 0x3f800000, 0x00000000
    exercise t_d_mls_0_1_denorm, d, 0, 1, mls, 0x00000001, 0x3f800000, 0x3fc00000
    exercise t_d_mls_0_1_tiny, d, 0, 1, mls, 0x00800000, 0x00800000, 0x00000000
    exercise t_d_mls_0_1_zero, d, 0, 1, mls, 0x80000000, 0x3f800000, 0x80000000
    exercise t_d_mul_0_2_normal, d, 0, 2, mul, 0x3f800001, 0x3f7fffff, 0xbf800000
    exercise t_d_mul_0_2_nan, d, 0, 2, mul, 0x7f800001, 0x3f800000, 0x00000000
    exercise t_d_mul_0_2_denorm, d, 0, 2, mul, 0x00000001, 0x3f800000, 0x3fc00000
    exercise t_d_mul_0_2_tiny, d, 0, 2, mul, 0x00800000, 0x00800000, 0x00000000
    exercise t_d_mul_0_2_zero, d, 0, 2, mul, 0x80000000, 0x3f800000, 0x80000000
    exercise t_d_mla_0_2_normal, d, 0, 2, mla, 0x3f800001, 0x3f7fffff, 0xbf800000
    exercise t_d_mla_0_2_nan, d, 0, 2, mla, 0x7f800001, 0x3f800000, 0x00000000
    exercise t_d_mla_0_2_denorm, d, 0, 2, mla, 0x00000001, 0x3f800000, 0x3fc00000
    exercise t_d_mla_0_2_tiny, d, 0, 2, mla, 0x00800000, 0x00800000, 0x00000000
    exercise t_d_mla_0_2_zero, d, 0, 2, mla, 0x80000000, 0x3f800000, 0x80000000
    exercise t_d_mls_0_2_normal, d, 0, 2, mls, 0x3f800001, 0x3f7fffff, 0xbf800000
    exercise t_d_mls_0_2_nan, d, 0, 2, mls, 0x7f800001, 0x3f800000, 0x00000000
    exercise t_d_mls_0_2_denorm, d, 0, 2, mls, 0x00000001, 0x3f800000, 0x3fc00000
    exercise t_d_mls_0_2_tiny, d, 0, 2, mls, 0x00800000, 0x00800000, 0x00000000
    exercise t_d_mls_0_2_zero, d, 0, 2, mls, 0x80000000, 0x3f800000, 0x80000000
    exercise t_d_mul_1_0_normal, d, 1, 0, mul, 0x3f800001, 0x3f7fffff, 0xbf800000
    exercise t_d_mul_1_0_nan, d, 1, 0, mul, 0x7f800001, 0x3f800000, 0x00000000
    exercise t_d_mul_1_0_denorm, d, 1, 0, mul, 0x00000001, 0x3f800000, 0x3fc00000
    exercise t_d_mul_1_0_tiny, d, 1, 0, mul, 0x00800000, 0x00800000, 0x00000000
    exercise t_d_mul_1_0_zero, d, 1, 0, mul, 0x80000000, 0x3f800000, 0x80000000
    exercise t_d_mla_1_0_normal, d, 1, 0, mla, 0x3f800001, 0x3f7fffff, 0xbf800000
    exercise t_d_mla_1_0_nan, d, 1, 0, mla, 0x7f800001, 0x3f800000, 0x00000000
    exercise t_d_mla_1_0_denorm, d, 1, 0, mla, 0x00000001, 0x3f800000, 0x3fc00000
    exercise t_d_mla_1_0_tiny, d, 1, 0, mla, 0x00800000, 0x00800000, 0x00000000
    exercise t_d_mla_1_0_zero, d, 1, 0, mla, 0x80000000, 0x3f800000, 0x80000000
    exercise t_d_mls_1_0_normal, d, 1, 0, mls, 0x3f800001, 0x3f7fffff, 0xbf800000
    exercise t_d_mls_1_0_nan, d, 1, 0, mls, 0x7f800001, 0x3f800000, 0x00000000
    exercise t_d_mls_1_0_denorm, d, 1, 0, mls, 0x00000001, 0x3f800000, 0x3fc00000
    exercise t_d_mls_1_0_tiny, d, 1, 0, mls, 0x00800000, 0x00800000, 0x00000000
    exercise t_d_mls_1_0_zero, d, 1, 0, mls, 0x80000000, 0x3f800000, 0x80000000
    exercise t_d_mul_1_1_normal, d, 1, 1, mul, 0x3f800001, 0x3f7fffff, 0xbf800000
    exercise t_d_mul_1_1_nan, d, 1, 1, mul, 0x7f800001, 0x3f800000, 0x00000000
    exercise t_d_mul_1_1_denorm, d, 1, 1, mul, 0x00000001, 0x3f800000, 0x3fc00000
    exercise t_d_mul_1_1_tiny, d, 1, 1, mul, 0x00800000, 0x00800000, 0x00000000
    exercise t_d_mul_1_1_zero, d, 1, 1, mul, 0x80000000, 0x3f800000, 0x80000000
    exercise t_d_mla_1_1_normal, d, 1, 1, mla, 0x3f800001, 0x3f7fffff, 0xbf800000
    exercise t_d_mla_1_1_nan, d, 1, 1, mla, 0x7f800001, 0x3f800000, 0x00000000
    exercise t_d_mla_1_1_denorm, d, 1, 1, mla, 0x00000001, 0x3f800000, 0x3fc00000
    exercise t_d_mla_1_1_tiny, d, 1, 1, mla, 0x00800000, 0x00800000, 0x00000000
    exercise t_d_mla_1_1_zero, d, 1, 1, mla, 0x80000000, 0x3f800000, 0x80000000
    exercise t_d_mls_1_1_normal, d, 1, 1, mls, 0x3f800001, 0x3f7fffff, 0xbf800000
    exercise t_d_mls_1_1_nan, d, 1, 1, mls, 0x7f800001, 0x3f800000, 0x00000000
    exercise t_d_mls_1_1_denorm, d, 1, 1, mls, 0x00000001, 0x3f800000, 0x3fc00000
    exercise t_d_mls_1_1_tiny, d, 1, 1, mls, 0x00800000, 0x00800000, 0x00000000
    exercise t_d_mls_1_1_zero, d, 1, 1, mls, 0x80000000, 0x3f800000, 0x80000000
    exercise t_d_mul_1_2_normal, d, 1, 2, mul, 0x3f800001, 0x3f7fffff, 0xbf800000
    exercise t_d_mul_1_2_nan, d, 1, 2, mul, 0x7f800001, 0x3f800000, 0x00000000
    exercise t_d_mul_1_2_denorm, d, 1, 2, mul, 0x00000001, 0x3f800000, 0x3fc00000
    exercise t_d_mul_1_2_tiny, d, 1, 2, mul, 0x00800000, 0x00800000, 0x00000000
    exercise t_d_mul_1_2_zero, d, 1, 2, mul, 0x80000000, 0x3f800000, 0x80000000
    exercise t_d_mla_1_2_normal, d, 1, 2, mla, 0x3f800001, 0x3f7fffff, 0xbf800000
    exercise t_d_mla_1_2_nan, d, 1, 2, mla, 0x7f800001, 0x3f800000, 0x00000000
    exercise t_d_mla_1_2_denorm, d, 1, 2, mla, 0x00000001, 0x3f800000, 0x3fc00000
    exercise t_d_mla_1_2_tiny, d, 1, 2, mla, 0x00800000, 0x00800000, 0x00000000
    exercise t_d_mla_1_2_zero, d, 1, 2, mla, 0x80000000, 0x3f800000, 0x80000000
    exercise t_d_mls_1_2_normal, d, 1, 2, mls, 0x3f800001, 0x3f7fffff, 0xbf800000
    exercise t_d_mls_1_2_nan, d, 1, 2, mls, 0x7f800001, 0x3f800000, 0x00000000
    exercise t_d_mls_1_2_denorm, d, 1, 2, mls, 0x00000001, 0x3f800000, 0x3fc00000
    exercise t_d_mls_1_2_tiny, d, 1, 2, mls, 0x00800000, 0x00800000, 0x00000000
    exercise t_d_mls_1_2_zero, d, 1, 2, mls, 0x80000000, 0x3f800000, 0x80000000
    exercise t_q_mul_0_0_normal, q, 0, 0, mul, 0x3f800001, 0x3f7fffff, 0xbf800000
    exercise t_q_mul_0_0_nan, q, 0, 0, mul, 0x7f800001, 0x3f800000, 0x00000000
    exercise t_q_mul_0_0_denorm, q, 0, 0, mul, 0x00000001, 0x3f800000, 0x3fc00000
    exercise t_q_mul_0_0_tiny, q, 0, 0, mul, 0x00800000, 0x00800000, 0x00000000
    exercise t_q_mul_0_0_zero, q, 0, 0, mul, 0x80000000, 0x3f800000, 0x80000000
    exercise t_q_mla_0_0_normal, q, 0, 0, mla, 0x3f800001, 0x3f7fffff, 0xbf800000
    exercise t_q_mla_0_0_nan, q, 0, 0, mla, 0x7f800001, 0x3f800000, 0x00000000
    exercise t_q_mla_0_0_denorm, q, 0, 0, mla, 0x00000001, 0x3f800000, 0x3fc00000
    exercise t_q_mla_0_0_tiny, q, 0, 0, mla, 0x00800000, 0x00800000, 0x00000000
    exercise t_q_mla_0_0_zero, q, 0, 0, mla, 0x80000000, 0x3f800000, 0x80000000
    exercise t_q_mls_0_0_normal, q, 0, 0, mls, 0x3f800001, 0x3f7fffff, 0xbf800000
    exercise t_q_mls_0_0_nan, q, 0, 0, mls, 0x7f800001, 0x3f800000, 0x00000000
    exercise t_q_mls_0_0_denorm, q, 0, 0, mls, 0x00000001, 0x3f800000, 0x3fc00000
    exercise t_q_mls_0_0_tiny, q, 0, 0, mls, 0x00800000, 0x00800000, 0x00000000
    exercise t_q_mls_0_0_zero, q, 0, 0, mls, 0x80000000, 0x3f800000, 0x80000000
    exercise t_q_mul_0_1_normal, q, 0, 1, mul, 0x3f800001, 0x3f7fffff, 0xbf800000
    exercise t_q_mul_0_1_nan, q, 0, 1, mul, 0x7f800001, 0x3f800000, 0x00000000
    exercise t_q_mul_0_1_denorm, q, 0, 1, mul, 0x00000001, 0x3f800000, 0x3fc00000
    exercise t_q_mul_0_1_tiny, q, 0, 1, mul, 0x00800000, 0x00800000, 0x00000000
    exercise t_q_mul_0_1_zero, q, 0, 1, mul, 0x80000000, 0x3f800000, 0x80000000
    exercise t_q_mla_0_1_normal, q, 0, 1, mla, 0x3f800001, 0x3f7fffff, 0xbf800000
    exercise t_q_mla_0_1_nan, q, 0, 1, mla, 0x7f800001, 0x3f800000, 0x00000000
    exercise t_q_mla_0_1_denorm, q, 0, 1, mla, 0x00000001, 0x3f800000, 0x3fc00000
    exercise t_q_mla_0_1_tiny, q, 0, 1, mla, 0x00800000, 0x00800000, 0x00000000
    exercise t_q_mla_0_1_zero, q, 0, 1, mla, 0x80000000, 0x3f800000, 0x80000000
    exercise t_q_mls_0_1_normal, q, 0, 1, mls, 0x3f800001, 0x3f7fffff, 0xbf800000
    exercise t_q_mls_0_1_nan, q, 0, 1, mls, 0x7f800001, 0x3f800000, 0x00000000
    exercise t_q_mls_0_1_denorm, q, 0, 1, mls, 0x00000001, 0x3f800000, 0x3fc00000
    exercise t_q_mls_0_1_tiny, q, 0, 1, mls, 0x00800000, 0x00800000, 0x00000000
    exercise t_q_mls_0_1_zero, q, 0, 1, mls, 0x80000000, 0x3f800000, 0x80000000
    exercise t_q_mul_0_2_normal, q, 0, 2, mul, 0x3f800001, 0x3f7fffff, 0xbf800000
    exercise t_q_mul_0_2_nan, q, 0, 2, mul, 0x7f800001, 0x3f800000, 0x00000000
    exercise t_q_mul_0_2_denorm, q, 0, 2, mul, 0x00000001, 0x3f800000, 0x3fc00000
    exercise t_q_mul_0_2_tiny, q, 0, 2, mul, 0x00800000, 0x00800000, 0x00000000
    exercise t_q_mul_0_2_zero, q, 0, 2, mul, 0x80000000, 0x3f800000, 0x80000000
    exercise t_q_mla_0_2_normal, q, 0, 2, mla, 0x3f800001, 0x3f7fffff, 0xbf800000
    exercise t_q_mla_0_2_nan, q, 0, 2, mla, 0x7f800001, 0x3f800000, 0x00000000
    exercise t_q_mla_0_2_denorm, q, 0, 2, mla, 0x00000001, 0x3f800000, 0x3fc00000
    exercise t_q_mla_0_2_tiny, q, 0, 2, mla, 0x00800000, 0x00800000, 0x00000000
    exercise t_q_mla_0_2_zero, q, 0, 2, mla, 0x80000000, 0x3f800000, 0x80000000
    exercise t_q_mls_0_2_normal, q, 0, 2, mls, 0x3f800001, 0x3f7fffff, 0xbf800000
    exercise t_q_mls_0_2_nan, q, 0, 2, mls, 0x7f800001, 0x3f800000, 0x00000000
    exercise t_q_mls_0_2_denorm, q, 0, 2, mls, 0x00000001, 0x3f800000, 0x3fc00000
    exercise t_q_mls_0_2_tiny, q, 0, 2, mls, 0x00800000, 0x00800000, 0x00000000
    exercise t_q_mls_0_2_zero, q, 0, 2, mls, 0x80000000, 0x3f800000, 0x80000000
    exercise t_q_mul_1_0_normal, q, 1, 0, mul, 0x3f800001, 0x3f7fffff, 0xbf800000
    exercise t_q_mul_1_0_nan, q, 1, 0, mul, 0x7f800001, 0x3f800000, 0x00000000
    exercise t_q_mul_1_0_denorm, q, 1, 0, mul, 0x00000001, 0x3f800000, 0x3fc00000
    exercise t_q_mul_1_0_tiny, q, 1, 0, mul, 0x00800000, 0x00800000, 0x00000000
    exercise t_q_mul_1_0_zero, q, 1, 0, mul, 0x80000000, 0x3f800000, 0x80000000
    exercise t_q_mla_1_0_normal, q, 1, 0, mla, 0x3f800001, 0x3f7fffff, 0xbf800000
    exercise t_q_mla_1_0_nan, q, 1, 0, mla, 0x7f800001, 0x3f800000, 0x00000000
    exercise t_q_mla_1_0_denorm, q, 1, 0, mla, 0x00000001, 0x3f800000, 0x3fc00000
    exercise t_q_mla_1_0_tiny, q, 1, 0, mla, 0x00800000, 0x00800000, 0x00000000
    exercise t_q_mla_1_0_zero, q, 1, 0, mla, 0x80000000, 0x3f800000, 0x80000000
    exercise t_q_mls_1_0_normal, q, 1, 0, mls, 0x3f800001, 0x3f7fffff, 0xbf800000
    exercise t_q_mls_1_0_nan, q, 1, 0, mls, 0x7f800001, 0x3f800000, 0x00000000
    exercise t_q_mls_1_0_denorm, q, 1, 0, mls, 0x00000001, 0x3f800000, 0x3fc00000
    exercise t_q_mls_1_0_tiny, q, 1, 0, mls, 0x00800000, 0x00800000, 0x00000000
    exercise t_q_mls_1_0_zero, q, 1, 0, mls, 0x80000000, 0x3f800000, 0x80000000
    exercise t_q_mul_1_1_normal, q, 1, 1, mul, 0x3f800001, 0x3f7fffff, 0xbf800000
    exercise t_q_mul_1_1_nan, q, 1, 1, mul, 0x7f800001, 0x3f800000, 0x00000000
    exercise t_q_mul_1_1_denorm, q, 1, 1, mul, 0x00000001, 0x3f800000, 0x3fc00000
    exercise t_q_mul_1_1_tiny, q, 1, 1, mul, 0x00800000, 0x00800000, 0x00000000
    exercise t_q_mul_1_1_zero, q, 1, 1, mul, 0x80000000, 0x3f800000, 0x80000000
    exercise t_q_mla_1_1_normal, q, 1, 1, mla, 0x3f800001, 0x3f7fffff, 0xbf800000
    exercise t_q_mla_1_1_nan, q, 1, 1, mla, 0x7f800001, 0x3f800000, 0x00000000
    exercise t_q_mla_1_1_denorm, q, 1, 1, mla, 0x00000001, 0x3f800000, 0x3fc00000
    exercise t_q_mla_1_1_tiny, q, 1, 1, mla, 0x00800000, 0x00800000, 0x00000000
    exercise t_q_mla_1_1_zero, q, 1, 1, mla, 0x80000000, 0x3f800000, 0x80000000
    exercise t_q_mls_1_1_normal, q, 1, 1, mls, 0x3f800001, 0x3f7fffff, 0xbf800000
    exercise t_q_mls_1_1_nan, q, 1, 1, mls, 0x7f800001, 0x3f800000, 0x00000000
    exercise t_q_mls_1_1_denorm, q, 1, 1, mls, 0x00000001, 0x3f800000, 0x3fc00000
    exercise t_q_mls_1_1_tiny, q, 1, 1, mls, 0x00800000, 0x00800000, 0x00000000
    exercise t_q_mls_1_1_zero, q, 1, 1, mls, 0x80000000, 0x3f800000, 0x80000000
    exercise t_q_mul_1_2_normal, q, 1, 2, mul, 0x3f800001, 0x3f7fffff, 0xbf800000
    exercise t_q_mul_1_2_nan, q, 1, 2, mul, 0x7f800001, 0x3f800000, 0x00000000
    exercise t_q_mul_1_2_denorm, q, 1, 2, mul, 0x00000001, 0x3f800000, 0x3fc00000
    exercise t_q_mul_1_2_tiny, q, 1, 2, mul, 0x00800000, 0x00800000, 0x00000000
    exercise t_q_mul_1_2_zero, q, 1, 2, mul, 0x80000000, 0x3f800000, 0x80000000
    exercise t_q_mla_1_2_normal, q, 1, 2, mla, 0x3f800001, 0x3f7fffff, 0xbf800000
    exercise t_q_mla_1_2_nan, q, 1, 2, mla, 0x7f800001, 0x3f800000, 0x00000000
    exercise t_q_mla_1_2_denorm, q, 1, 2, mla, 0x00000001, 0x3f800000, 0x3fc00000
    exercise t_q_mla_1_2_tiny, q, 1, 2, mla, 0x00800000, 0x00800000, 0x00000000
    exercise t_q_mla_1_2_zero, q, 1, 2, mla, 0x80000000, 0x3f800000, 0x80000000
    exercise t_q_mls_1_2_normal, q, 1, 2, mls, 0x3f800001, 0x3f7fffff, 0xbf800000
    exercise t_q_mls_1_2_nan, q, 1, 2, mls, 0x7f800001, 0x3f800000, 0x00000000
    exercise t_q_mls_1_2_denorm, q, 1, 2, mls, 0x00000001, 0x3f800000, 0x3fc00000
    exercise t_q_mls_1_2_tiny, q, 1, 2, mls, 0x00800000, 0x00800000, 0x00000000
    exercise t_q_mls_1_2_zero, q, 1, 2, mls, 0x80000000, 0x3f800000, 0x80000000
    .arm
    .balign 4
arm_trap:
    vmla.f32 q3, q11, d12[0]
    svc #0
odd_d:
    .inst 0xf3a671cc
    svc #0
odd_n:
    .inst 0xf3a761cc
    svc #0
    .thumb
    .balign 2
thumb_trap:
    vmul.f32 d1, d19, d2[0]
    svc #0
