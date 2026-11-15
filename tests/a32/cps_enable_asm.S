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
        cpsie \masks
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
    exercise enable_arm,0
    exercise enable_thumb,1

    .macro pending name, thumb
    .balign 4096
    .if \thumb
        .thumb
        .thumb_func
    .else
        .arm
    .endif
    .global \name
\name:
    push {r4,lr}
    mov r4,r0
    mov r2,#128
2:
    cpsid i
    subs r2,r2,#1
    bne 2b
    ldr r2,=0xA80A01D3
    msr cpsr_cxsf,r2
    mov r3,#1
    str r3,[r4]
    cpsie i
    // A pending IRQ must see marker 1 and the updated A/F/NZCVQ/GE/T.
    mov r3,#2
    str r3,[r4]
    pop {r4,pc}
    .ltorg
    .endm
    pending enable_pending_arm,0
    pending enable_pending_thumb,1
