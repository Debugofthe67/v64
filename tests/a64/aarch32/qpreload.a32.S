// Hints to unmapped, wrapping and PC-relative addresses never fault and
// preserve all GPRs and NZCV. Both IT paths must also stay in native code.
    .syntax unified
base:
    .word 11
    .word arm_imm-base,0,0
    .word arm_negative-base,0,0
    .word arm_register-base,0,0
    .word arm_literal-base,0,0
    .word thumb_imm-base+1,0,0
    .word thumb_literal-base+1,0,0
    .word thumb_it_true-base+1,0,0
    .word thumb_it_false-base+1,0,0
    .word arm_near_load-base,0,0
    .word thumb_near_load-base+1,0,0
    .word arm_write_hint-base,0,0
    .macro warm
    mov r12,#128
    mov r0,#0
    mov r1,#0x20000000
1:
    cmp r12,#1
    mrs r11,apsr
    .endm
    .macro done
    mrs r10,apsr
    subs r12,r12,#1
    bne 1b
    svc #0
    .endm
    .arm
    .balign 4096
arm_imm:
    warm
    pld [r0,#64]
    pli [r1,#4095]
    done
arm_negative:
    warm
    pld [r0,#-4095]
    pli [r0,#-64]
    done
arm_register:
    warm
    pld [r0,r1,lsl #3]
    pli [r1,-r0,lsl #2]
    done
arm_literal:
    warm
    pld [pc,#64]
    pli [pc,#-64]
    done
arm_write_hint:
    warm
    pldw [r0,#64]
    pldw [r1,r0,lsl #3]
    done
    .thumb
    .balign 4096
thumb_imm:
    warm
    pld [r1,#64]
    pli [r0,#4095]
    done
thumb_literal:
    warm
    pld [pc,#64]
    pli [pc,#128]
    done
thumb_it_true:
    warm
    cmp r12,#0
    itt ne
    pldne [r0,#64]
    pline [r1,#4095]
    done
thumb_it_false:
    warm
    cmp r12,#0
    itt eq
    pldeq [r0,#64]
    plieq [r1,#4095]
    done
    .arm
    .balign 4096
arm_near_load:
    // A neighboring LDRB encoding still performs memory access and faults.
    mov r1,#0
    ldrb r2,[r1,#64]
    svc #0
    .thumb
    .balign 4096
thumb_near_load:
    mov r1,#0
    ldrb.w r2,[r1,#64]
    svc #0
