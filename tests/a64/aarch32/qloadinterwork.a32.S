// ARM memory returns to Thumb: conditions, writeback and both fault kinds.
    .syntax unified
    .arm
base:
    .word (table_end-base-4)/12
    .macro exercise form, trial
    .subsection 0
    .word case_\@-base,0,3
    .subsection 1
    .balign 4
    .arm
case_\@:
    mov r11,sp
    movw r12,#128
    mov r6,#0
loop_\@:
    ldr r0,delta_\@
anchor_\@:
    add r0,pc,r0
    adr r1,thumb_\@+1
    str r1,[r0]
    str r1,[r0,#8]
    .if \form == 4
        add r0,r0,#12
    .endif
    .if \trial > 0
        cmp r12,#1
        bne ready_\@
        .if \trial < 3
            mov r0,#0
        .else
            mov r1,#2
            .if \trial == 4
                movw r1,#1
                movt r1,#0x8000
            .endif
            .if \form == 4
                str r1,[r0,#-4]
            .elseif \form == 2
                str r1,[r0]
            .else
                str r1,[r0,#8]
            .endif
        .endif
    .endif
ready_\@:
    adr r9,returned_\@
    .if \trial == 1
        cmp r12,#1
    .else
        cmp r6,#-1
    .endif
    .if \form == 0
        ldrne pc,[r0,#8]
    .elseif \form == 1
        ldrne pc,[r0,#8]!
    .elseif \form == 2
        ldrne pc,[r0],#12
    .elseif \form == 3
        ldmne r0!,{r4,r7,pc}
    .else
        ldmdbne r0!,{r4,r7,pc}
    .endif
returned_\@:
    subs r12,r12,#1
    bne loop_\@
    mov sp,r11
    svc #0
    .thumb
thumb_\@:
    add.w r6,r6,#1
    bx r9
    .balign 4
    .arm
delta_\@:
    .word scratch-(anchor_\@+8)
    .endm
    .irp form,0,1,2,3,4
    .irp trial,0,1,2,3,4
        exercise \form,\trial
    .endr
    .endr
    .subsection 0
table_end:
    .subsection 2
    .balign 4096
scratch:
    .word 0,0x98765432,0
