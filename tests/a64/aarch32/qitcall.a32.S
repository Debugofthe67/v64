// Conditional calls/branches in the last IT slot: LR, skipped bad targets,
// ARM/Thumb interworking, and a fault in the preceding conditional load.
    .syntax unified
    .text
base:
    .word (table_end-base-4)/12
    .macro exercise form, trial
    .subsection 0
    .word case_\@-base+1,0,0
    .subsection 1
    .thumb
    .balign 4096
case_\@:
    sub r10,sp,#16
    str r8,[r10]
    movw r12,#128
loop_\@:
    .if \form == 1 || \form == 3 || \form == 5
        adr.w r0,arm_\@
    .else
        adr.w r0,thumb_\@
        orr r0,r0,#1
    .endif
    adr.w r9,returned_\@
    orr r9,r9,#1
    add.w r4,r4,#3
    .if \trial == 1
        cmp r12,r12
    .elseif \trial == 2
        // The last condition is false, even with an invalid register target.
        cmp r12,#1
        it eq
        moveq r0,#0
        cmp r12,#1
    .elseif \trial == 3
        cmp r12,#1
        it eq
        moveq r10,#0
        cmp r12,#64
    .else
        cmp r12,#64
    .endif
    .if \trial >= 2
        itt ne
        ldrne r1,[r10]
    .else
        it ne
    .endif
    .if \form == 0
        blne thumb_\@
    .elseif \form == 1
        blxne arm_\@
    .elseif \form == 2 || \form == 3
        blxne r0
    .elseif \form == 4 || \form == 5
        bxne r0
    .elseif \form == 6
        bne.n thumb_\@
    .else
        bne.w thumb_\@
    .endif
returned_\@:
    add.w r5,r5,#7
    subs.w r12,r12,#1
    bne loop_\@
    svc #0
    .balign 4
thumb_\@:
    add.w r7,r7,#1
    mov r8,lr
    .if \form <= 3
        bx lr
    .else
        bx r9
    .endif
    .balign 4
    .arm
arm_\@:
    add r7,r7,#1
    mov r8,lr
    .if \form <= 3
        bx lr
    .else
        bx r9
    .endif
    .endm
    .irp form,0,1,2,3,4,5,6,7
    .irp trial,0,1,2,3
        exercise \form,\trial
    .endr
    .endr
    .subsection 0
table_end:
