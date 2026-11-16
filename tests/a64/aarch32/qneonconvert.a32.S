// StandardFPSCR conversions: D/Q, signed/unsigned, both directions and
// aliases. Every loop restores its raw inputs and cumulative flags.
    .syntax unified
    .fpu neon-vfpv4
    .text
base:
    .word (table_end-base-4)/12
    .macro exercise thumb, shape, op, flags, a, b, c, d, alias
    .subsection 0
    .word case_\@-base+\thumb,0,0x130
    .subsection 1
    .balign 4
    .if \thumb
        .thumb
    .else
        .arm
    .endif
case_\@:
    movw r4,#(\a & 0xffff)
    movt r4,#(\a >> 16)
    movw r5,#(\b & 0xffff)
    movt r5,#(\b >> 16)
    movw r6,#(\c & 0xffff)
    movt r6,#(\c >> 16)
    movw r7,#(\d & 0xffff)
    movt r7,#(\d >> 16)
    vmov d4,r8,r9
    vmov d5,r10,r11
    movw r11,#(\flags & 0xffff)
    movt r11,#(\flags >> 16)
    mov r12,#64
1:  vmov d2,r4,r5
    vmov d3,r6,r7
    vmsr fpscr,r11
    .ifc \shape,q
        .if \alias
            vcvt.\op q1,q1
        .else
            vcvt.\op q2,q1
        .endif
    .else
        .if \alias
            vcvt.\op d2,d2
        .else
            vcvt.\op d4,d2
        .endif
    .endif
    subs r12,r12,#1
    bne 1b
    vmrs r0,fpscr
    .if \alias
        vmov r1,r2,d2
        vmov r3,r8,d3
    .else
        vmov r1,r2,d4
        vmov r3,r8,d5
    .endif
    vmov r9,r10,d2
    vmov r11,lr,d3
    svc #0
    .endm
    .irp thumb,0,1
    .irp shape,d,q
    .irp op,f32.s32,f32.u32,s32.f32,u32.f32
    .irp flags,0,0x10,0x90,0x81,0x11,0x91,0xa3c00091
    .irp alias,0,1
        exercise \thumb,\shape,\op,\flags,0x00000000,0x80000000,0x00000001,0x80000001,\alias
        exercise \thumb,\shape,\op,\flags,0x007fffff,0x00800000,0x807fffff,0x80800000,\alias
        exercise \thumb,\shape,\op,\flags,0x3f000000,0xbf000000,0x3fc00000,0xbfc00000,\alias
        exercise \thumb,\shape,\op,\flags,0x4effffff,0x4f000000,0xcf000000,0xcf000001,\alias
        exercise \thumb,\shape,\op,\flags,0x4f7fffff,0x4f800000,0xbf800000,0x4f000001,\alias
        exercise \thumb,\shape,\op,\flags,0x7f800000,0xff800000,0x7fc12345,0xff800001,\alias
        exercise \thumb,\shape,\op,\flags,0x7f800001,0xffc12345,0x7f7fffff,0xff7fffff,\alias
        exercise \thumb,\shape,\op,\flags,0x7fffffff,0xffffffff,0x01000001,0xfeffffff,\alias
    .endr
    .endr
    .endr
    .endr
    .endr
    .macro trap thumb
    .subsection 0
    .word trap_\@-base+\thumb,0,0x100
    .subsection 1
    .balign 4
    .if \thumb
        .thumb
    .else
        .arm
    .endif
trap_\@:
    mov r12,#128
1:  subs r12,r12,#1
    bne 1b
    vcvt.s32.f32 q2,q1
    svc #0
    .endm
    trap 0
    trap 1
    .subsection 0
table_end:
