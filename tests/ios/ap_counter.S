    .syntax unified
    .arm
    .text
    .global main
main:
    cpsid if
    ldr r0,=0x42000000
    mcr p15,0,r0,c2,c0,0
    mov r0,#0
    mcr p15,0,r0,c2,c0,2
    mov r0,#1
    mcr p15,0,r0,c3,c0,0
    dsb sy
    isb
    mrc p15,0,r0,c1,c0,0
    orr r0,r0,#1
    mcr p15,0,r0,c1,c0,0
    isb
    ldr r4,=0x43000000
1:
    ldr r0,[r4]
    ldr r8,[r4,#4]
    cmp r8,#0
    beq 2f
    // This pair must retain the original device access path.
    ldm r0,{r1,r3}
    b 3f
2:
    ldr r1,[r0]
    ldr r3,[r0,#4]
3:
    str r1,[r4,#16]
    str r3,[r4,#20]
    b 1b
    .ltorg
