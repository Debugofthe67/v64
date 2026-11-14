// Warm conditional returns before testing a false condition, data abort,
// ARM interworking, or an earlier instruction in the same IT block.
// QEMU comparison requires A64_MMU=1: physical address 0 is platform specific.
    .syntax unified
    .text
base:
    .word (table_end-base-4)/12
    .macro exercise form, trial, mask=0
    .subsection 0
    .word case_\@-base+1,0,0
    .subsection 1
    .balign 4
    .thumb
case_\@:
    mov r11,sp
    movw r12,#128
loop_\@:
    ldr r0,delta_\@
anchor_\@:
    add r0,pc
    adr.w r1,returned_\@
    orr r1,r1,#1
    str r1,[r0,#8]
    movs r2,#0
    .if \trial == 1
        // False final condition must not access an invalid address.
        cmp r12,#1
        it eq
        moveq r0,#0
        cmp r12,#1
        it eq
        moveq r2,#1
    .elseif \trial == 2
        cmp r12,#1
        it eq
        moveq r0,#0
    .elseif \trial == 3
        // The native return must retry before any register/SP write.
        cmp r12,#1
        bne target_ready_\@
        adr.w r1,arm_\@
        str r1,[r0,#8]
    .endif
target_ready_\@:
    adr.w r9,returned_\@
    orr r9,r9,#1
    mov sp,r0
    cmp r2,#0
    .if \mask == 1
        ite ne
        movne r6,#7
    .elseif \mask == 2
        itt eq
        moveq r6,#7
    .else
        it eq
    .endif
    .if \form == 0
        popeq {r4,r7,pc}
    .elseif \form == 1
        popeq.w {r4,r7,pc}
    .elseif \form == 2
        ldreq.w pc,[r0,#8]
    .elseif \form == 3
        ldreq.w pc,[r0,#8]!
    .else
        ldreq.w pc,[r0],#12
    .endif
    movs r5,#0
    b after_\@
returned_\@:
    movs r5,#1
after_\@:
    mov sp,r11
    subs r12,r12,#1
    bne loop_\@
    svc #0
    .balign 4
    .arm
arm_\@:
    bx r9
    .balign 4
delta_\@:
    .word scratch-(anchor_\@+4)
    .endm
    .irp form,0,1,2,3
    .irp trial,0,1,2,3
        exercise \form,\trial
    .endr
        exercise \form,0,1
        exercise \form,2,1
        exercise \form,0,2
        exercise \form,2,2
    .endr
    .subsection 0
table_end:

    .subsection 2
    .balign 4096
scratch:
    .word 0x12345678,0x98765432,0
