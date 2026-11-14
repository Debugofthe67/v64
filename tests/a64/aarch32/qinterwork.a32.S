// Hot ARM/Thumb BLX immediate and BLX LR in both directions, including
// backward displacements, H=1, and a Thumb call site at address 2 mod 4.
// MMU mode is required for the final branch/fetch fault cases.
    .syntax unified
    .text
base:
    .word (table_end-base-4)/12
    .macro callee name, thumb, pad
    .balign 4
    .if \thumb
        .arm
\name:
        add r4,r4,#1
        mov r5,lr
        bx lr
    .else
        .thumb
        .if \pad
            nop
        .endif
\name:
        add.w r4,r4,#1
        mov r5,lr
        bx lr
    .endif
    .endm
    .macro exercise thumb, pad, reg, reverse, fault=0
    .subsection 0
    .word case_\@-base+\thumb,0,0xA
    .subsection 1
    .if \reverse
        callee callee_\@,\thumb,\pad
    .endif
    .balign 4
    .if \thumb
        .thumb
    .else
        .arm
    .endif
case_\@:
    movw r12,#128
    movw r4,#0
loop_\@:
    .if \reg
        .if \thumb
            adr.w lr,callee_\@
        .else
            adr lr,callee_\@+1
        .endif
    .endif
    .balign 4
    .if \thumb * \pad
        nop
    .endif
    .if \reg
        blx lr
    .else
        blx callee_\@
    .endif
    mrs r6,apsr
    .if \thumb
        subs.w r12,r12,#1
    .else
        subs r12,r12,#1
    .endif
    bne loop_\@
    .if \fault == 1
        // A Thumb -> ARM target with bit 1 set faults on the next fetch.
        movw r0,#2
        bx r0
    .elseif \fault == 2
        // A32 -> Thumb changes T before an unmapped instruction fetch.
        movw r0,#1
        movt r0,#0x8000
        bx r0
    .elseif \fault == 3
        // Reserved low bit of BLX immediate stays an interpreted UNDEFINED.
        .inst.w 0xf000e801
    .endif
    svc #0
    .if !\reverse
        callee callee_\@,\thumb,\pad
    .endif
    .endm
    .irp thumb,0,1
    .irp pad,0,1
    .irp reg,0,1
    .irp reverse,0,1
        exercise \thumb,\pad,\reg,\reverse
    .endr
    .endr
    .endr
    .endr
    exercise 1,0,0,0,1
    exercise 0,0,0,0,2
    exercise 1,1,1,1,3
    .subsection 0
table_end:
