// Each hot loop occupies its own page and references only a few GPRs.
// The EL0 oracle compares ALL R0-R14, including untouched and false writes.
    .syntax unified
base:
    .word 8
    .word small-base,0,0
    .word shift-base,0,0
    .word false_write-base,0,0
    .word thumb_high-base+1,0,0
    .word fp_helper-base+1,0,0
    .word dual-base,0,0
    .word multiple-base,0,0
    .word vector-base+1,0,0
    .macro warm
    mov r12,#128
1:
    .endm
    .macro done
    subs r12,r12,#1
    bne 1b
    svc #0
    .endm
    .macro pointer
    ldr r10,2f
3:  add r10,pc
    .endm
    .macro delta adjust
    .balign 4
2:  .word scratch-(3b+\adjust)
    .endm
    .arm
    .balign 4096
small:
    warm
    movw r8,#0x5678
    movt r8,#0x1234
    done
    .balign 4096
shift:
    warm
    mov r3,#5
    mov r1,r8,lsl r3
    done
    .balign 4096
false_write:
    warm
    cmp r12,#0
    movweq r6,#0x1234
    movtne r9,#0x5678
    done
    .thumb
    .balign 4096
thumb_high:
    warm
    movw r9,#0x1234
    mov r2,r9
    done
    .balign 4096
fp_helper:
    warm
    vmov d2,r8,r9
    vmov d3,r8,r9
    vmov d4,r5,r6
    vmov d5,r5,r6
    // Ordinary values whose inexact addition takes the exact FP helper.
    vadd.f32 q0,q1,q2
    vmov r2,r3,d0
    done
    .arm
    .balign 4096
dual:
    pointer
    warm
    strd r6,r7,[r10]
    ldrd r2,r3,[r10]
    done
    delta 8
    .balign 4096
multiple:
    pointer
    warm
    stmia r10,{r1,r5,r11}
    ldmia r10,{r2,r6,r9}
    done
    delta 8
    .thumb
    .balign 4096
vector:
    pointer
    warm
    mov r8,#32
    vld1.32 {d2,d3},[r10],r8
    sub r10,r10,r8
    vst1.32 {d2,d3},[r10]
    vmov r6,r7,d2
    done
    delta 4
    .balign 4096
scratch:
    .word 0x12345678,0x87654321,0xAABBCCDD,0x01020304
    .space 64
