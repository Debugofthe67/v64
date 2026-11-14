// IT memory cache hits, false conditions and precise exception ITSTATE.
    .syntax unified
    .thumb
base:
    .word 10
    .word mixed - base + 1, 0, 0
    .word false_load - base + 1, 0, 0
    .word first_fault - base + 1, 0, 0
    .word second_fault - base + 1, 0, 0
    .word store_fault - base + 1, 0, 0
    .word writeback - base + 1, 0, 0
    .word cross_load - base + 1, 0, 0
    .word cross_store - base + 1, 0, 0
    .word third_fault - base + 1, 0, 0
    .word false_unaligned - base + 1, 0, 0
    .macro warm
    adr r0, data
    movs r12, #128
1:  cmp r12, #0
    itt ne
    ldrne r1, [r0]
    strne r1, [r0, #4]
    subs r12, r12, #1
    bne 1b
    .endm
mixed:
    warm
    movs r2, #0
    cmp r2, #0
    ite eq
    ldreq r3, [r0]
    strne r2, [r0, #4]
    svc #0
false_load:
    warm
    movs r0, #0
    cmp r0, #0
    itt ne
    ldrne r1, [r0]
    strne r1, [r0]
    svc #0
first_fault:
    warm
    movs r0, #0
    cmp r0, #0
    itt eq
    ldreq r1, [r0]
    addeq r2, #4
    svc #0
second_fault:
    warm
    movs r2, #0
    cmp r2, #0
    itt eq
    ldreq r1, [r0]
    ldreq r3, [r2]
    svc #0
store_fault:
    warm
    movs r0, #0
    cmp r0, #0
    ite eq
    streq r1, [r0]
    movne r3, #9
    svc #0
writeback:
    warm
    cmp r12, #0
    itt eq
    ldreq r2, [r0], #4
    streq r2, [r0]
    svc #0
// A cross-page access misses both native lookup forms and is retried by
// the interpreter. It must see the current mask, then finish the IT block.
cross_load:
    warm
    adr.w r0, data
    addw r0, r0, #4094
    cmp r12, #0
    itt eq
    ldreq r2, [r0]
    addeq r3, r2, #7
    svc #0
cross_store:
    warm
    adr.w r0, data
    addw r0, r0, #4094
    movw r2, #0x9876
    movt r2, #0x5432
    cmp r12, #0
    itt eq
    streq r2, [r0]
    ldreq r3, [r0]
    svc #0
third_fault:
    warm
    movs r2, #0
    cmp r2, #0
    ittte eq
    ldreq r1, [r0]
    addeq r3, r1, #7
    ldreq r4, [r2]
    movne r5, #9
    svc #0
false_unaligned:
    warm
    movs r0, #1
    cmp r0, #0
    itt eq
    ldreq r1, [r0]
    streq r1, [r0]
    svc #0
// Keep writes out of the executable page so the warm loop actually reaches
// the native cache-hit path rather than repeatedly invalidating its code.
    .balign 4096
data:
    .word 0x12345678, 0
    .space 4086
    .hword 0x1234, 0x5678, 0x9ABC
