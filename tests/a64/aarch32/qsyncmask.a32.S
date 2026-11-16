// Synchronization helpers on otherwise small-register pages. Compare all
// GPRs, flags, failed/cleared reservations, aliases, spin yield and aborts.
    .syntax unified
base:
    .word 20
    .word aw-base,0,0
    .word ab-base,0,0
    .word ah-base,0,0
    .word ad-base,0,0
    .word tw-base+1,0,0
    .word tb-base+1,0,0
    .word th-base+1,0,0
    .word td-base+1,0,0
    .word aclear-base,0,0
    .word tclear-base+1,0,0
    .word afail-base,0,0
    .word tfail-base+1,0,0
    .word afalse-base,0,0
    .word talias-base+1,0,0
    .word aalias-base,0,0
    .word aspin-base,0,0
    .word tspin-base+1,0,0
    .word aunaligned-base,0,0
    .word tunaligned-base+1,0,0
    .word afault-base,0,0
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
aw: setup
    ldrex r4,[r10]
    strex r2,r4,[r10]
    done
    .balign 4096
ab: setup
    ldrexb r4,[r10]
    strexb r2,r4,[r10]
    done
    .balign 4096
ah: setup
    ldrexh r4,[r10]
    strexh r2,r4,[r10]
    done
    .balign 4096
ad: setup
    ldrexd r4,r5,[r10]
    strexd r2,r4,r5,[r10]
    done
    .thumb
    .balign 4096
tw: setup
    ldrex r4,[r10,#4]
    strex r2,r4,[r10,#4]
    done
    .balign 4096
tb: setup
    ldrexb r4,[r10]
    strexb r2,r4,[r10]
    done
    .balign 4096
th: setup
    ldrexh r4,[r10]
    strexh r2,r4,[r10]
    done
    .balign 4096
td: setup
    ldrexd r4,r8,[r10]
    strexd r2,r4,r8,[r10]
    done
    .arm
    .balign 4096
aclear: setup
    ldrex r4,[r10]
    clrex
    dmb sy
    dsb sy
    isb sy
    strex r2,r4,[r10]
    done
    .thumb
    .balign 4096
tclear: setup
    ldrex r4,[r10]
    clrex
    dmb sy
    dsb sy
    isb sy
    strex r2,r4,[r10]
    done
    .arm
    .balign 4096
afail: setup
    clrex
    strexd r2,r8,r9,[r10]
    done
    .thumb
    .balign 4096
tfail: setup
    clrex
    strexd r2,r8,r9,[r10]
    done
    .arm
    .balign 4096
afalse: setup
    cmp r12,#0
    ldrexeq r4,[r10]
    strexeq r2,r8,[r10]
    done
    .thumb
    .balign 4096
talias: setup
    mov r0,r10
    ldrexd r4,r0,[r0]
    clrex
    done
    .arm
    .balign 4096
aalias: setup
    mov r1,r10
    ldrexd r0,r1,[r1]
    clrex
    done
    .balign 4096
aspin: setup
    ldrex r4,[r10]
    done
    .thumb
    .balign 4096
tspin: setup
    ldrex r4,[r10]
    done
    .arm
    .balign 4096
aunaligned: setup
    cmp r12,#1
    addeq r10,r10,#1
    ldrex r4,[r10]
    clrex
    done
    .thumb
    .balign 4096
tunaligned: setup
    cmp r12,#1
    it eq
    addeq r10,r10,#1
    ldrexd r4,r8,[r10]
    clrex
    done
    .arm
    .balign 4096
afault: setup
    cmp r12,#1
    moveq r10,#0x60000000
    ldrex r4,[r10]
    done
