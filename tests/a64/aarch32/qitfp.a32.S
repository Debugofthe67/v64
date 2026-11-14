// Thumb IT blocks containing scalar VFP and vector/scalar-lane NEON.
// Both condition outcomes, exact helper fallbacks, FP traps and saved ITSTATE.
    .syntax unified
    .fpu crypto-neon-fp-armv8
    .thumb
base:
    .word 20
    .word normal_all_0 - base + 1, 0, 0x130
    .word normal_all_16 - base + 1, 0, 0x130
    .word normal_mixed_0 - base + 1, 0, 0x130
    .word normal_mixed_16 - base + 1, 0, 0x130
    .word nan_all_0 - base + 1, 0, 0x130
    .word nan_all_16 - base + 1, 0, 0x130
    .word nan_mixed_0 - base + 1, 0, 0x130
    .word nan_mixed_16 - base + 1, 0, 0x130
    .word denorm_all_0 - base + 1, 0, 0x130
    .word denorm_all_16 - base + 1, 0, 0x130
    .word denorm_mixed_0 - base + 1, 0, 0x130
    .word denorm_mixed_16 - base + 1, 0, 0x130
    .word zero_all_0 - base + 1, 0, 0x130
    .word zero_all_16 - base + 1, 0, 0x130
    .word zero_mixed_0 - base + 1, 0, 0x130
    .word zero_mixed_16 - base + 1, 0, 0x130
    .word false_fp - base + 1, 0, 0x100
    .word first_trap - base + 1, 0, 0x100
    .word second_trap - base + 1, 0, 0x100
    .word after_flags - base + 1, 0, 0x130

    .macro exercise name, value, mixed, flags
\name:
    movw r0, #(\value & 0xffff)
    movt r0, #(\value >> 16)
    vdup.32 q4, r0
    vmov.f32 q1, #0.5
    vmov.f32 d7, #1.5
    movw r0, #\flags
    movt r0, #0x00c0
    vmsr fpscr, r0
    movw r12, #128
1:  vmov d0, d8
    vmov d1, d9
    cmp r12, #0
    .if \mixed
        ittee ne
        vaddne.f32 q0, q0, q1
        vmulne.f32 d4, d0, d7[1]
        vsubeq.f32 q0, q0, q1
        vnegeq.f32 s1, s0
    .else
        itttt ne
        vaddne.f32 q0, q0, q1
        vmlane.f32 d0, d2, d7[0]
        vmovne.f32 s3, s2
        vnegne.f32 s1, s0
    .endif
    cmp r12, r12
    itt ne
    vaddne.f32 q0, q0, q1
    vmovne.f32 s0, s2
    subs r12, r12, #1
    bne 1b
    vmov r4, r5, d0
    vmov r6, r7, d1
    vmrs r3, fpscr
    svc #0
    .endm

    exercise normal_all_0, 0x3fc00000, 0, 0
    exercise normal_all_16, 0x3fc00000, 0, 16
    exercise normal_mixed_0, 0x3fc00000, 1, 0
    exercise normal_mixed_16, 0x3fc00000, 1, 16
    exercise nan_all_0, 0x7f800001, 0, 0
    exercise nan_all_16, 0x7f800001, 0, 16
    exercise nan_mixed_0, 0x7f800001, 1, 0
    exercise nan_mixed_16, 0x7f800001, 1, 16
    exercise denorm_all_0, 0x00000001, 0, 0
    exercise denorm_all_16, 0x00000001, 0, 16
    exercise denorm_mixed_0, 0x00000001, 1, 0
    exercise denorm_mixed_16, 0x00000001, 1, 16
    exercise zero_all_0, 0x80000000, 0, 0
    exercise zero_all_16, 0x80000000, 0, 16
    exercise zero_mixed_0, 0x80000000, 1, 0
    exercise zero_mixed_16, 0x80000000, 1, 16
false_fp:
    movs r0, #0
    cmp r0, #0
    itt ne
    vaddne.f32 q0,q0,q1
    vmovne.f32 s0,s1
    svc #0
first_trap:
    movs r0, #1
    cmp r0, #0
    itt ne
    vaddne.f32 q0,q0,q1
    movne r2,#7
    svc #0
second_trap:
    movs r0, #1
    cmp r0, #0
    itt ne
    movne r2,#7
    vmovne.f32 s0,s1
    svc #0
after_flags:
    vmov.f32 q0,#1.5
    vmov.f32 q1,#0.5
    movw r0,#0x10
    vmsr fpscr,r0
    movw r12,#128
1:  cmp r12,#0
    itte ne
    vmovne.f32 s2,s0
    vaddne.f32 d0,d0,d2
    vnegeq.f32 s0,s0
    subs r12,r12,#1
    bne 1b
    vmov r4,r5,d0
    vmov r6,r7,d1
    vmrs r3,fpscr
    svc #0
