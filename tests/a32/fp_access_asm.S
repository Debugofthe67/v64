    .syntax unified
    .fpu neon-vfpv4
    .text
    .arm
    .balign 4096
    .global fp_disable_arm, fp_disable_arm_fault
fp_disable_arm:
    movw r0,#0
    movt r0,#0x3f80
    vmov s0,r0
    vadd.f32 s1,s0,s0
    mov r1,#0
    vmsr fpexc,r1
fp_disable_arm_fault:
    vmov r0,s1
    mov r1,#0x40000000
    vmsr fpexc,r1
    vmov r0,s1
    bx lr

    .thumb
    .balign 4096
    .global fp_disable_thumb, fp_disable_thumb_fault
    .thumb_func
fp_disable_thumb:
    movw r0,#0
    movt r0,#0x3f80
    vmov s0,r0
    vadd.f32 s1,s0,s0
    mov r1,#0
    vmsr fpexc,r1
    // A false FP condition must neither fault nor authorize the next VMOV.
    cmp r1,#0
    it ne
    vaddne.f32 s0,s0,s0
fp_disable_thumb_fault:
    vmov r0,s1
    mov r1,#0x40000000
    vmsr fpexc,r1
    vmov r0,s1
    bx lr
