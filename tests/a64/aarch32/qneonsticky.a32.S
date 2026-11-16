// Standard NEON's exceptional lanes after all arithmetic flags are sticky.
// Both sets, D/Q, vector/scalar forms and aliases; reset FPSCR on every loop.
// Mixed lanes expose input FZ, default NaNs, two rounding steps, and missing
// sticky bits must still take the precise path and raise the right flags.
    .syntax unified
    .fpu crypto-neon-fp-armv8
    .text
base:
    .word (table_end - base - 4) / 12

    .macro exercise thumb, shape, scalar, op, a, last, b, acc, flags, alias=0
    .subsection 0
    .word case_\@ - base + \thumb, 0, 0x130
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
    movw r5,#(\last & 0xffff)
    movt r5,#(\last >> 16)
    movw r6,#(\b & 0xffff)
    movt r6,#(\b >> 16)
    movw r7,#(\acc & 0xffff)
    movt r7,#(\acc >> 16)
    movw r12,#64
1:  vdup.32 q1,r4
    .ifc \shape,q
        vmov.32 d3[1],r5
    .else
        vmov.32 d2[1],r5
    .endif
    vdup.32 q2,r6
    vdup.32 q0,r7
    .if \alias == 1
        vmov q0,q1
    .elseif \alias == 2
        vmov q0,q2
    .endif
    movw r0,#(\flags & 0xffff)
    movt r0,#(\flags >> 16)
    vmsr fpscr,r0
    .ifc \shape,q
        .if \alias == 1
            v\op\().f32 q0,q0,q2
        .elseif \scalar
            .if \alias == 2
                v\op\().f32 q0,q1,d0[\scalar-1]
            .else
                v\op\().f32 q0,q1,d4[\scalar-1]
            .endif
        .else
            v\op\().f32 q0,q1,q2
        .endif
    .else
        .if \alias == 1
            v\op\().f32 d0,d0,d4
        .elseif \scalar
            .if \alias == 2
                v\op\().f32 d0,d2,d0[\scalar-1]
            .else
                v\op\().f32 d0,d2,d4[\scalar-1]
            .endif
        .else
            v\op\().f32 d0,d2,d4
        .endif
    .endif
    subs r12,r12,#1
    bne 1b
    vmrs r3,fpscr
    vmov r4,r5,d0
    vmov r6,r7,d1
    svc #0
    .endm

    .irp thumb,0,1
    .irp shape,d,q
    .irp scalar,0,1,2
    .irp op,add,sub,mul,mla,mls
    .set include,1
    .if \scalar
        .ifc \op,add
            .set include,0
        .endif
        .ifc \op,sub
            .set include,0
        .endif
    .endif
    .if include
        // Finite input FZ must raise a previously clear IDC even when the
        // normalized operation is exact (including signed zeros/aliases).
        .irp flags,0,0x10,0x1d,0x80,0x8800001f
            exercise \thumb,\shape,\scalar,\op,0x00000001,0x807fffff,0xbf800000,0x80000000,\flags
            exercise \thumb,\shape,\scalar,\op,0x3f800000,0x80000000,0x800001ff,0x00800000,\flags
            exercise \thumb,\shape,\scalar,\op,0x007fffff,0x807fffff,0x00000000,0x807fffff,\flags
            exercise \thumb,\shape,\scalar,\op,0x00000001,0x800009b9,0x3f000000,0x80000a16,\flags,1
        .endr
        // RN/FZ/DN for NEON ignore FPSCR's directed mode and clear FZ/DN.
        exercise \thumb,\shape,\scalar,\op,0x3f800001,0xffffff26,0x3f7fffff,0xbf800000,0x08c0009d
        exercise \thumb,\shape,\scalar,\op,0x3bc363c6,0x00000a16,0xbc380000,0x800009b9,0x2000009d
        exercise \thumb,\shape,\scalar,\op,0x7f800001,0xff800123,0x00000000,0x7fc01234,0x8040009f
        exercise \thumb,\shape,\scalar,\op,0x7f800000,0xff800000,0x00000000,0xff800000,0x0040009d
        exercise \thumb,\shape,\scalar,\op,0x7f7fffff,0xff7fffff,0x40000000,0xff7fffff,0x03c0009d
        exercise \thumb,\shape,\scalar,\op,0x00800000,0x80800000,0x3f7fffff,0x00000000,0x0000009d
        exercise \thumb,\shape,\scalar,\op,0x00800000,0x80800000,0x3f000000,0x00800000,0x0000009d
        exercise \thumb,\shape,\scalar,\op,0x3f000000,0xbf000000,0x00800000,0x80000000,0x0000009d
        exercise \thumb,\shape,\scalar,\op,0x00800001,0x80800001,0x80800000,0x00800000,0x0000009d
        exercise \thumb,\shape,\scalar,\op,0x80000000,0x00000000,0x00000001,0x80000000,0x0000009d
        exercise \thumb,\shape,\scalar,\op,0x00000001,0x807fffff,0xff800000,0x00000001,0x0000009d
        exercise \thumb,\shape,\scalar,\op,0x7fc00000,0xffc01234,0x00800000,0x7f800001,0x0000009d
        .if !\scalar
            exercise \thumb,\shape,\scalar,\op,0x3f800001,0xffffff26,0x000009b9,0x7fc00000,0x0000009d,1
        .else
            exercise \thumb,\shape,\scalar,\op,0x3f800001,0xffffff26,0x000009b9,0x7fc00000,0x0000009d,2
        .endif
    .endif
    .endr
    .endr
    .endr
    // Every absent flag and DZC/QC/NZCV preservation, with one ordinary lane.
    .irp flags,0x9c,0x99,0x95,0x8d,0x1d,0,0x8000009f
    .irp op,add,sub,mul,mla,mls
        exercise \thumb,q,0,\op,0x7f800001,0x3f800001,0x00000001,0xff7fffff,\flags
        exercise \thumb,d,0,\op,0x7fc00000,0x3f7fffff,0x7f7fffff,0x7f800001,\flags
    .endr
    .endr
    .endr
    .subsection 0
table_end:
