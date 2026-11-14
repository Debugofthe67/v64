// Pure FP helpers run between fresh GPR writes and uses, with conditions,
// exceptional FP inputs, conversions, saturation and fault exits. The
// oracle compares all GPRs and flags, not only the FP result's checksum.
    .syntax unified
    .fpu crypto-neon-fp-armv8
base:
    .word 10
    .word scalar-base,0,0
    .word conditional-base,0,0
    .word vector-base+1,0,0
    .word compare-base+1,0,0
    .word trap_arm-base,0,0x100
    .word trap_thumb-base+1,0,0x100
    .word undefined_arm-base,0,0
    .word undefined_thumb-base+1,0,0
    .word trap_after_false_arith-base,0,0x100
    .word trap_after_false_move-base,0,0x100
    .macro warm
    mov r12,#128
1:
    movw r8,#0xbeef
    movt r8,#0x1234
    add r0,r12,#7
    eor r9,r8,r0
    .endm
    .macro done
    add r7,r8,r9
    subs r12,r12,#1
    bne 1b
    svc #0
    .endm
    .macro inputs
    movw r1,#1
    movt r1,#0x3f80
    movw r2,#1
    movt r2,#0x7f80
    vmov s2,r1
    vmov s4,r2
    .endm
    .arm
    .balign 4096
scalar:
    warm
    inputs
    vadd.f32 s6,s2,s4
    vcvt.s32.f32 s8,s6
    vmov r4,s8
    vmrs r6,fpscr
    done
conditional:
    warm
    inputs
    cmp r12,#64
    vcvtgt.s32.f32 s8,s2
    vcvthi.u32.f32 s10,s4
    vmov r4,s8
    vmov r5,s10
    done
    .thumb
    .balign 4096
vector:
    warm
    inputs
    vmov d2,r1,r2
    vmov d3,r2,r1
    vcvt.s32.f32 q0,q1
    vqadd.s16 q2,q0,q0
    vmov r4,r5,d4
    vmrs r6,fpscr
    done
compare:
    warm
    inputs
    vcmpe.f32 s2,s4
    vmrs apsr_nzcv,fpscr
    it gt
    movgt r4,r8
    it lt
    movlt r5,r9
    vmrs r6,fpscr
    done
    .arm
    .balign 4096
trap_arm:
    warm
    subs r12,r12,#1
    bne 1b
    vcvt.s32.f32 s0,s2
    svc #0
    .thumb
    .balign 4096
trap_thumb:
    warm
    subs r12,r12,#1
    bne 1b
    vcvt.s32.f32 s0,s2
    svc #0
    .arm
    .balign 4096
undefined_arm:
    warm
    subs r12,r12,#1
    bne 1b
    .word 0xeef90bc0 // VJCVT: not in this CPU profile
    svc #0
    .thumb
    .balign 4096
undefined_thumb:
    warm
    subs r12,r12,#1
    bne 1b
    .inst.w 0xeef90bc0
    svc #0

    .arm
    .balign 4096
trap_after_false_arith:
    warm
    subs r12,r12,#1
    bne 1b
    cmp r12,#0
    // A false native FP condition cannot establish FP access for the VMOV.
    vaddne.f32 s0,s1,s2
    vmov s3,s2
    svc #0
    .balign 4096
trap_after_false_move:
    warm
    subs r12,r12,#1
    bne 1b
    cmp r12,#0
    vmovne s0,r4
    vadd.f32 s1,s2,s3
    svc #0
