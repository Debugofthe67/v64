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
    mov r12,#128
1:
    add r1,r1,#37
    mvn r2,r1
    eor r3,r1,#0x80000000
    mcr p15,0,r1,c13,c0,2
    mcr p15,0,r2,c13,c0,3
    mcr p15,0,r3,c13,c0,4
    mrc p15,0,r4,c13,c0,2
    mrc p15,0,r5,c13,c0,3
    mrc p15,0,r6,c13,c0,4
    cmp r12,r12
    .if \thumb
        it ne
    .endif
    mcrne p15,0,r0,c13,c0,3
    mrc p15,0,r7,c13,c0,3
    cmp r12,#64
    .if \thumb
        it eq
    .endif
    mcreq p15,0,r1,c13,c0,4
    mrc p15,0,r8,c13,c0,4
    mrs r9,apsr
    stmia r10,{r1-r9}
    subs r12,r12,#1
    bne 1b
    str r12,[r10,#36]
    pop {r4-r11,pc}
    .endm
    exercise thread_arm,0
    exercise thread_thumb,1
