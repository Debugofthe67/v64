// v86 checks STREX alignment/permissions even when its local reservation
// is absent. QEMU can fail the reservation first. Compare these choices
// with v86's interpreter (aarch32_page), not with the QEMU exit oracle.
    .syntax unified
base:
    .word 4
    .word astoreunaligned-base,0,0
    .word tstoreunaligned-base+1,0,0
    .word astorefault-base,0,0
    .word tstorefault-base+1,0,0
    .macro setup
    sub r10,sp,#32
    str r8,[r10]
    str r9,[r10,#4]
    mov r12,#128
1:
    .endm
    .macro done
    subs r12,r12,#1
    bne 1b
    svc #0
    .endm
    .arm
    .balign 4096
astoreunaligned: setup
    clrex
    cmp r12,#1
    addeq r10,r10,#1
    strex r2,r8,[r10]
    done
    .thumb
    .balign 4096
tstoreunaligned: setup
    ldrexd r4,r8,[r10]
    cmp r12,#1
    it eq
    addeq r10,r10,#1
    strexd r2,r4,r8,[r10]
    done
    .arm
    .balign 4096
astorefault: setup
    clrex
    cmp r12,#1
    moveq r10,#0x60000000
    strex r2,r8,[r10]
    done
    .thumb
    .balign 4096
tstorefault: setup
    clrex
    cmp r12,#1
    it eq
    moveq r10,#0x60000000
    strex r2,r8,[r10]
    done
