.syntax unified
.arch armv6k
.fpu vfp
.text
.arm
.global _start

_start:
    b startup
    b unexpected
    b svc_handler
    b unexpected
    b data_abort
    b unexpected
    b irq_handler
    b unexpected

startup:
    mov r10, #0x800
    mrc p15, 0, r0, c0, c0, 0
    str r0, [r10]
    mrc p15, 0, r0, c1, c0, 0
    str r0, [r10, #4]
    mrc p15, 0, r0, c1, c0, 1
    str r0, [r10, #8]
    mrc p15, 0, r0, c0, c0, 1
    str r0, [r10, #44]

    @ VFPv2 saves two exception instruction registers in a thread context.
    mov r0, #0x00f00000
    mcr p15, 0, r0, c1, c0, 2
    mov r0, #0x40000000
    vmsr fpexc, r0
    mov r0, #0x44
    vmsr fpinst, r0
    mov r0, #0x98
    vmsr fpinst2, r0
    vmrs r0, fpinst
    str r0, [r10, #48]
    vmrs r0, fpinst2
    str r0, [r10, #52]

    adr r0, thumb_step
    orr r0, r0, #1
    blx r0
    str r0, [r10, #12]
    svc #9

    cpsie i
    mov r0, #1
    str r0, [r10, #20]
wait_irq:
    ldr r1, [r10, #24]
    cmp r1, #0
    beq wait_irq
    cpsid i

    @ Extended ARMv6 short descriptors: identity and a section alias.
    mov r2, #0x4000
    mov r0, #0x0c00
    orr r0, r0, #10
    str r0, [r2]
    str r0, [r2, #8]
    mcr p15, 0, r2, c2, c0, 0
    mov r0, #1
    mcr p15, 0, r0, c3, c0, 0
    mrc p15, 0, r0, c1, c0, 0
    orr r0, r0, #(1 << 23)
    orr r0, r0, #1
    mcr p15, 0, r0, c1, c0, 0
    mcr p15, 0, r0, c7, c5, 4

    add r0, r10, #0x00200000
    ldr r0, [r0]
    str r0, [r10, #28]
    mov r0, #0x01000000
    ldr r1, [r0]
    mov r0, #0xaa
    str r0, [r10, #40]
    b .

svc_handler:
    mrs r0, spsr
    str r0, [r10, #16]
    movs pc, lr

irq_handler:
    mov r0, #3
    str r0, [r10, #24]
    subs pc, lr, #4

data_abort:
    mrc p15, 0, r1, c5, c0, 0
    str r1, [r10, #32]
    mrc p15, 0, r1, c6, c0, 0
    str r1, [r10, #36]
    subs pc, lr, #4

unexpected:
    mov r0, #0xee
    str r0, [r10, #40]
    b .

.thumb
.balign 4
thumb_step:
    movs r0, #73
    bx lr
