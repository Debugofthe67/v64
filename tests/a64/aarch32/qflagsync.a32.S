// NZCV must cross helpers, VMRS, a page chain and precise fault retries.
    .syntax unified
    .fpu neon-vfpv4
base:
    .word 9
    .word afp-base,0,0
    .word tfp-base+1,0,0
    .word afpscr-base,0,0
    .word tfpscr-base+1,0,0
    .word afault-base,0,0
    .word tfault-base+1,0,0
    .word askip-base,0,0x100
    .word atrap-base,0,0x100
    .word chain-base,0,0
    .macro setup
    vmov.f32 s0,#1.0
    vmov.f32 s1,#2.0
    movw r7,#0
    movt r7,#0xa000
    mov r12,#128
1:
    .endm
    .macro done
    subs r12,r12,#1
    bne 1b
    vmov r2,s2
    vmrs r10,fpscr
    mrs r11,apsr
    svc #0
    .endm
    .arm
    .balign 4096
afp: setup
    cmp r12,#64
    vdivne.f32 s2,s0,s1
    mrs r4,apsr
    adcs r5,r5,#0
    msr apsr_nzcvq,r7
    adc r6,r6,#0
    done
    .thumb
    .balign 4096
tfp: setup
    cmp r12,#64
    it ne
    vdivne.f32 s2,s0,s1
    mrs r4,apsr
    adcs r5,r5,#0
    msr apsr_nzcvq,r7
    adc r6,r6,#0
    done
    .arm
    .balign 4096
afpscr: setup
    vcmp.f32 s0,s1
    vmrs apsr_nzcv,fpscr
    addmi r4,r4,#1
    vdivmi.f32 s2,s0,s1
    adc r5,r5,#0
    done
    .thumb
    .balign 4096
tfpscr: setup
    vcmp.f32 s0,s1
    vmrs apsr_nzcv,fpscr
    it mi
    addmi r4,r4,#1
    it mi
    vdivmi.f32 s2,s0,s1
    adc r5,r5,#0
    done
    .arm
    .balign 4096
afault:
    mov r12,#128
1:  subs r12,r12,#1
    bne 1b
    cmp r12,#1
    mov r0,#0
    ldr r3,[r0]
    svc #0
    .thumb
    .balign 4096
tfault:
    mov r12,#128
1:  subs r12,r12,#1
    bne 1b
    cmp r12,#1
    mov.w r0,#0
    ldr r3,[r0]
    svc #0
    .arm
    .balign 4096
askip:
    mov r12,#128
1:  cmp r12,r12
    vdivne.f32 s2,s0,s1
    subs r12,r12,#1
    bne 1b
    mrs r11,apsr
    svc #0
    .balign 4096
atrap:
    mov r12,#128
1:  subs r12,r12,#1
    bne 1b
    cmp r12,r12
    vdiveq.f32 s2,s0,s1
    svc #0
    .balign 4096
chain:
    mov r12,#128
1:  cmp r12,#64
    b chain_target
    .balign 4096
chain_target:
    adc r4,r4,#0
    addeq r5,r5,#1
    msr apsr_nzcvq,r7
    subs r12,r12,#1
    bne 1b
    mrs r11,apsr
    svc #0
