    .syntax unified
    .text
    .macro exercise name, thumb
    .balign 4096
    .if \thumb
        .thumb
        .thumb_func
    .else
        .arm
    .endif
    .global \name
\name:
    push {r4-r11,lr}
    mov r10,r0
    mrs r11,cpsr
    mov r4,#17
    mov r5,#29
    mov r12,#128
1:
    .macro one masks, index
        msr cpsr_cxsf,r1
        add r4,r4,#3
        eor r5,r5,#(1 << \index)
        cpsid \masks
        mrs r2,cpsr
        str r2,[r10,#(4 * \index)]
    .endm
    one a,0
    one i,1
    one f,2
    one ai,3
    one af,4
    one if,5
    one aif,6
    .purgem one
    subs r12,r12,#1
    bne 1b
    str r4,[r10,#28]
    str r5,[r10,#32]
    str r12,[r10,#36]
    msr cpsr_cxsf,r11
    pop {r4-r11,pc}
    .endm
    exercise mask_arm,0
    exercise mask_thumb,1

    // A pending SGI must stay masked through this hot sequence. CPSIE
    // afterwards retains its existing interrupt observation boundary.
    .balign 4096
    .arm
    .global mask_pending
mask_pending:
    mov r1,#128
2:
    cpsid i
    mov r2,#1
    str r2,[r0]
    cpsid af
    subs r1,r1,#1
    bne 2b
    bx lr
