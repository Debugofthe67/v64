/* Open Syborg board probe. Linked at the physical XIP address, 0x10000. */
.syntax unified
.arch armv6
.arm
.text
.global _start
_start:
    /* Validate the captured QEMU handoff before modifying APSR. */
    mrs r4, cpsr
    ldr r5, =0x400001d3
    cmp r4, r5
    bne fail
    orrs r4, r0, r1
    orrseq r4, r3, sp
    orrseq r4, r4, lr
    bne fail
    cmp r2, #0x05600000
    bne fail
    ldr r4, [r2]
    ldr r5, =0xedfe0dd0
    cmp r4, r5
    bne fail
    ldr sp, =0x1a000
    ldr r11, =0xc0006000
    mrc p15, 0, r0, c0, c0, 0
    ldr r1, =0x4107b362
    cmp r0, r1
    bne fail
    mrc p15, 0, r0, c0, c0, 1
    ldr r1, =0x1d992992
    cmp r0, r1
    bne fail
    ldr r0, [r11]
    ldr r1, =0xc51d0001
    cmp r0, r1
    bne fail
    ldr r0, =0xc0011000
    ldr r1, [r0, #12]
    cmp r1, #172
    bne fail
    ldr r0, [r0, #4]
    cmp r0, #0x1000
    bne fail
    ldr r0, =0xc0012000
    ldr r0, [r0]
    ldr r1, =0xedfe0dd0
    cmp r0, r1
    bne fail

    /* Install low-vector SVC and IRQ handlers. */
    ldr r0, =0xe59ff018
    mov r1, #0
    str r0, [r1, #0x08]
    str r0, [r1, #0x18]
    ldr r0, =svc_entry
    str r0, [r1, #0x28]
    ldr r0, =irq_entry
    str r0, [r1, #0x38]
    cps #0x12
    ldr sp, =0x1b000
    cps #0x13

    /* Map identity RAM and devices plus an alias of RAM at 0x70000000. */
    ldr r0, =0x4000
    mov r1, #0
    mov r2, #4096
1:  str r1, [r0], #4
    subs r2, #1
    bne 1b
    ldr r0, =0x4000
    ldr r1, =0xc0e
    str r1, [r0]
    ldr r2, =0x5c00
    str r1, [r2]
    bic r1, r1, #12
    ldr r2, =0x5800
    orr r3, r1, #0x60000000
    str r3, [r2]
    ldr r2, =0x7000
    orr r3, r1, #0xc0000000
    str r3, [r2]
    mcr p15, 0, r0, c2, c0, 0
    mov r0, #3
    mcr p15, 0, r0, c3, c0, 0
    mrc p15, 0, r0, c1, c0, 0
    orr r0, r0, #1
    mcr p15, 0, r0, c1, c0, 0
    nop
    nop
    blx thumb_probe
    cmp r0, #17
    bne fail
    mov r0, #5
    svc #0
    cmp r0, #6
    bne fail
    ldr r0, =0x16000
    str r4, [r0]
    ldr r1, =0x70016000
    ldr r1, [r1]
    cmp r1, r4
    bne fail
    /* Match the patched BSP's unaligned normal-memory access mode. */
    ldr r0, =0x16010
    ldr r1, =0x11223344
    str r1, [r0]
    mrc p15, 0, r3, c1, c0, 0
    orr r3, r3, #0x00400000
    mcr p15, 0, r3, c1, c0, 0
    ldr r1, [r0, #1]
    ldr r2, =0x00112233
    cmp r1, r2
    bne fail
    mov r0, #'K'
    str r0, [r11, #4]

    /* Enable a 1 ms oneshot and wait for IRQ dispatch and exception return. */
    ldr r8, =0xc0000000
    ldr r9, =0xc0002000
    ldr r10, =0x16004
    mov r0, #0
    str r0, [r10]
    mov r0, #100
    str r0, [r9, #12]
    mov r0, #1
    str r0, [r9, #8]
    str r0, [r9, #20]
    str r0, [r8, #20]
    str r0, [r9, #4]
    cpsie i
    mov r0, #0
1:  mcr p15, 0, r0, c7, c0, 4
    ldr r0, [r10]
    cmp r0, #1
    bne 1b
    cpsid i
    ldr r0, [r8, #8]
    cmn r0, #1
    bne fail
    ldr r0, [r9, #4]
    cmp r0, #0
    bne fail
    mov r0, #'I'
    str r0, [r11, #4]

    /* Program an RGB framebuffer. The test reads output through DisplayHub. */
    ldr r2, =0xc0005000
    mov r0, #2
    str r0, [r2, #8]
    str r0, [r2, #12]
    mov r0, #32
    str r0, [r2, #32]
    mov r0, #8
    str r0, [r2, #48]
    mov r0, #1
    str r0, [r2, #16]
    str r0, [r2, #52]
    ldr r1, =0x17000
    ldr r0, =0x00ff0000
    str r0, [r1]
    ldr r0, =0x0000ff00
    str r0, [r1, #4]
    ldr r0, =0x000000ff
    str r0, [r1, #8]
    ldr r0, =0x00ffffff
    str r0, [r1, #12]
    str r1, [r2, #4]

    /* ROFS survives an attempted write. */
    ldr r0, =0x60000000
    ldr r1, [r0]
    ldr r2, =0x53464f52
    cmp r1, r2
    bne fail
    str r4, [r0]
    ldr r1, [r0]
    cmp r1, r2
    bne fail

    /* Both disks deliver the IRQ and transfer one sector through RAM. */
    ldr r6, =0xc000d000
    mov r7, #14
    bl read_sector
    ldr r0, [r5]
    cmp r0, #0xee
    beq card_ready
    cmp r0, #0
    bne fail
    mov r0, #0xee
    str r0, [r5]
    mov r0, #2
    str r0, [r6, #0x30]
    str r0, [r6, #0x40]
    bl disk_complete
card_ready:
    ldr r6, =0xc0010000
    mov r7, #12
    bl read_sector
    ldr r0, [r5]
    cmp r0, #0xab
    moveq r0, #'R'
    streq r0, [r11, #4]
    beq idle
    cmp r0, #0
    bne fail
    mov r0, #0xab
    str r0, [r5]
    mov r0, #2
    str r0, [r6, #0x30]
    str r0, [r6, #0x40]
    bl disk_complete

    /* Read and acknowledge translated keys, absolute contact and UART RX. */
    ldr r5, =0xc0003000
    ldr r6, =0xc0004000
    mov r0, #1
    str r0, [r5, #12]
    str r0, [r6, #28]
    str r0, [r11, #12]
    mov r0, #2
    str r0, [r8, #20]
    mov r0, #3
    str r0, [r8, #20]
    mov r0, #5
    str r0, [r8, #20]
    mov r0, #'H'
    str r0, [r11, #4]
1:  ldr r0, [r8, #8]
    cmn r0, #1
    beq 1b
    cmp r0, #2
    bne fail
    ldr r0, [r5, #4]
    ldr r1, =0x400000a4
    cmp r0, r1
    bne fail
    ldr r0, [r5, #4]
    ldr r1, =0xc00000a4
    cmp r0, r1
    bne fail
    ldr r0, [r8, #8]
    cmp r0, #3
    bne fail
    str r0, [r6, #4]
    ldr r0, [r6, #12]
    ldr r1, =0x7fff
    cmp r0, r1
    bne fail
    ldr r0, [r6, #16]
    cmp r0, r1
    bne fail
    ldr r0, [r6, #56]
    cmp r0, #1
    bne fail
    str r0, [r6, #4]
    ldr r0, [r6, #56]
    cmp r0, #2
    bne fail
    ldr r0, [r8, #8]
    cmp r0, #5
    bne fail
    ldr r0, [r11, #4]
    cmp r0, #'u'
    bne fail
    ldr r0, [r8, #8]
    cmn r0, #1
    bne fail
    mov r0, #'P'
    str r0, [r11, #4]

    ldr r0, =0xc0011000
    mov r1, #2
    str r1, [r0, #8]
    b fail

read_sector:
    ldr r5, =0x18000
    ldr r0, [r6, #0x60]
    cmp r0, #1
    cmpne r0, #0x200000
    bne fail
    mov r0, #0
    str r0, [r6, #0x10]
    mov r0, #512
    str r0, [r6, #0x70]
    str r5, [r6, #0x50]
    str r7, [r8, #20]
    mov r0, #1
    str r0, [r6, #0x20]
    str r0, [r6, #0x30]
    str r0, [r6, #0x40]
disk_complete:
    ldr r0, [r8, #8]
    cmp r0, r7
    bne disk_complete
    ldr r0, [r6, #0x80]
    cmp r0, #1
    bne fail
    ldr r0, [r8, #8]
    cmn r0, #1
    bne fail
    bx lr

svc_entry:
    add r0, #1
    movs pc, lr

irq_entry:
    push {r0, r1}
    ldr r0, [r8, #8]
    cmp r0, #1
    bne fail
    str r0, [r9, #24]
    str r0, [r10]
    pop {r0, r1}
    subs pc, lr, #4

fail:
    ldr r11, =0xc0006000
    mov r0, #'!'
    str r0, [r11, #4]
idle:
    mov r0, #0
    mcr p15, 0, r0, c7, c0, 4
    b idle
.ltorg
.thumb
.thumb_func
thumb_probe:
    movs r0, #17
    bx lr
