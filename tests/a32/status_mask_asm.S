    .syntax unified
    .arm
    .text
    .balign 4096
    .global restore_arm
restore_arm:
    push {r4-r11,lr}
    mov r10,r0
    mrs r11,cpsr
    mov r4,#17
    mov r5,#29
    mov r12,#128
1:
    cmp r12,#64
    add r4,r4,#7
    msr cpsr_c,r1
    mrs r2,cpsr
    str r2,[r10]
    eor r3,r1,#0xf8000000
    msr cpsr_fc,r3
    mrs r2,cpsr
    str r2,[r10,#4]
    cmp r12,r12
    msrne cpsr_fc,r1
    msreq cpsr_c,r1
    mrs r2,cpsr
    str r2,[r10,#8]
    // Different banks and an invalid mode must use the original path.
    bic r3,r1,#31
    orr r3,r3,#31
    msr cpsr_fc,r3
    mrs r2,cpsr
    str r2,[r10,#12]
    msr cpsr_fc,r1
    mrs r2,cpsr
    str r2,[r10,#16]
    bic r3,r1,#31
    msr cpsr_fc,r3
    mrs r2,cpsr
    str r2,[r10,#20]
    msr cpsr_c,#0x93
    mrs r2,cpsr
    str r2,[r10,#24]
    eor r5,r5,r3
    subs r12,r12,#1
    bne 1b
    str r4,[r10,#28]
    str r5,[r10,#32]
    str r12,[r10,#36]
    msr cpsr_cxsf,r11
    pop {r4-r11,pc}

    .balign 4096
    .global restore_pending
restore_pending:
    push {r4,lr}
    mov r4,r0
    mov r2,#128
2:
    cpsid i
    subs r2,r2,#1
    bne 2b
    mov r3,#1
    str r3,[r4]
    msr cpsr_fc,r1
    // A pending IRQ must be taken before this next instruction; its
    // SPSR must contain the restored NZCVQ and preserved A/GE/T bits.
    mov r3,#2
    str r3,[r4]
    pop {r4,pc}
