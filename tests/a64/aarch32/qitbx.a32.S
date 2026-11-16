// Narrow last-slot BX LR: predicates, preceding loads, faults and ISA switch.
    .syntax unified
    .text
base:
    .word 7
    .macro exercise name, slots, trial, arm_target
    .subsection 0
    .word \name-base+1,0,0
    .subsection 1
    .thumb
    .balign 4096
\name:
    sub r10,sp,#16
    str r8,[r10]
    movw r12,#128
loop_\@:
    adr.w lr,target_\@
    .if !\arm_target
        orr lr,lr,#1
    .endif
    adr.w r9,returned_\@
    orr r9,r9,#1
    add.w r4,r4,#3
    .if \trial == 1
        mov.w lr,#0
        mov.w r10,#0
        cmp r12,r12
    .else
        .if \trial == 2
            cmp r12,#1
            it eq
            moveq r10,#0
        .endif
        cmp r12,#64
    .endif
    .if \slots == 3
        ittt ne
        addne.w r7,r7,#5
        ldrne r1,[r10]
    .elseif \slots == 2
        itt ne
        ldrne r1,[r10]
    .else
        it ne
    .endif
    bxne lr
    add.w r5,r5,#7
    b returned_\@
    .balign 4
    .if \arm_target
        .arm
    .endif
target_\@:
    add r6,r6,#11
    .if \arm_target
        bx r9
        .thumb
    .else
        b returned_\@
    .endif
returned_\@:
    subs r12,r12,#1
    bne loop_\@
    mrs r11,apsr
    svc #0
    .endm
    exercise single,1,0,0
    exercise skipped,1,1,0
    exercise load,2,0,0
    exercise skipped_load,2,1,0
    exercise triple,3,0,0
    exercise interwork,1,0,1
    exercise fault,2,2,0
