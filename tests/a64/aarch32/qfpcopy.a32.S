// Complete-span FP register copies, including unaligned register starts,
// writeback, non-power-of-two lengths and precise fallback at page crossings.
    .syntax unified
    .fpu neon-vfpv4
base:
    .word 22
    .word asload-base,0,0
    .word asstore-base,0,0
    .word adload-base,0,0
    .word adstore-base,0,0
    .word tsload-base+1,0,0
    .word tsstore-base+1,0,0
    .word tdload-base+1,0,0
    .word tdstore-base+1,0,0
    .word avld1-base,0,0
    .word avst1-base,0,0
    .word tvld1-base+1,0,0
    .word tvst1-base+1,0,0
    .word maxload-base,0,0
    .word maxstore-base+1,0,0
    .word small-base,0,0
    .word skipped-base,0,0
    .word unalignedload-base,0,0
    .word unalignedstore-base+1,0,0
    .word crossload-base,0,0
    .word crossstore-base+1,0,0
    .word trapload-base,0,0x100
    .word trapstore-base+1,0,0x100
    .macro setup
    sub r10,sp,#256
    stmia r10,{r0-r9,r11,lr}
    .irp OFFSET,48,52,56,60,64,68,72,76,80,84,88,92,96,100,104,108,112,116,120,124
    str r8,[r10,#\OFFSET]
    .endr
    str r0,[r10,#128]
    vmov d0,r0,r1
    vmov d1,r2,r3
    vmov d2,r4,r5
    vmov d3,r6,r7
    vmov d4,r8,r9
    vmov d5,r11,lr
    .irp N,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31
    vmov d\N,r8,r9
    .endr
    vmov d16,r0,r1
    mov r11,r10
    mov r2,#16
    mov r12,#128
1:  mov r10,r11
    .endm
    .macro done
    subs r12,r12,#1
    bne 1b
    sub r12,r10,r11
    // Observe every stored word and the trailing sentinel, before VMOV
    // replaces the scratch GPRs with the final FP register contents.
    mov lr,#0
    .irp OFFSET,0,4,8,12,16,20,24,28,32,36,40,44,48,52,56,60,64,68,72,76,80,84,88,92,96,100,104,108,112,116,120,124,128
    ldr r0,[r11,#\OFFSET]
    eor lr,r0,lr,ror #1
    .endr
    vmov r0,r1,d0
    vmov r2,r3,d1
    vmov r4,r5,d2
    vmov r6,r7,d3
    vmov r8,r9,d4
    vmov r10,r11,d5
    svc #0
    .endm
    .arm
    .balign 4096
asload: setup
    vldmia r10, {s3-s6}
    done
    .arm
    .balign 4096
asstore: setup
    vstmia r10, {s3-s6}
    done
    .arm
    .balign 4096
adload: setup
    vldmia r10!, {d1-d4}
    done
    .arm
    .balign 4096
adstore: setup
    vstmia r10!, {d1-d4}
    done
    .thumb
    .balign 4096
tsload: setup
    vldmia r10!, {s3-s6}
    done
    .thumb
    .balign 4096
tsstore: setup
    vstmia r10!, {s3-s6}
    done
    .thumb
    .balign 4096
tdload: setup
    vldmia r10, {d1-d4}
    done
    .thumb
    .balign 4096
tdstore: setup
    vstmia r10, {d1-d4}
    done
    .arm
    .balign 4096
avld1: setup
    vld1.32 {d1,d2}, [r10]!
    done
    .arm
    .balign 4096
avst1: setup
    vst1.32 {d1,d2,d3}, [r10],r2
    done
    .thumb
    .balign 4096
tvld1: setup
    vld1.8 {d1,d2,d3,d4}, [r10]!
    done
    .thumb
    .balign 4096
tvst1: setup
    vst1.16 {d1,d2}, [r10],r2
    done
    .arm
    .balign 4096
maxload: setup
    vldmia r10!, {d0-d15}
    vmov r8,r9,d15
    vmov d4,r8,r9
    vmov r8,r9,d16
    vmov d5,r8,r9
    done
    .thumb
    .balign 4096
maxstore: setup
    vstmia r10!, {d0-d15}
    done
    .arm
    .balign 4096
small: setup
    vldmia r10, {s3-s5}
    done
    .arm
    .balign 4096
skipped: setup
    cmp r12,r12
    vldmiane r10!, {s3-s6}
    vstmiane r10!, {d1-d4}
    done
    .arm
    .balign 4096
unalignedload: setup
    add r10,r10,#1
    vld1.8 {d1,d2}, [r10]!
    done
    .thumb
    .balign 4096
unalignedstore: setup
    add r10,r10,#1
    vst1.8 {d1,d2}, [r10]!
    done
    .arm
    .balign 4096
crossload: setup
    sub r10,sp,#4096
    bic r10,r10,#0xff0
    bic r10,r10,#15
    add r10,r10,#4080
    vldmia r10!, {d1-d4}
    done
    .thumb
    .balign 4096
crossstore: setup
    sub r10,sp,#4096
    bic r10,r10,#0xff0
    bic r10,r10,#15
    add r10,r10,#4080
    vstmia r10!, {d1-d4}
    done
    .arm
    .balign 4096
trapload:
    mov r12,#128
1:  subs r12,r12,#1
    bne 1b
    vldmia r0,{d0-d3}
    svc #0
    .thumb
    .balign 4096
trapstore:
    mov r12,#128
1:  subs r12,r12,#1
    bne 1b
    vstmia r0,{s3-s6}
    svc #0

