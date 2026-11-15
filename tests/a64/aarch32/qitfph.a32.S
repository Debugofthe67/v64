// Predicated scalar FP helpers must preserve dirty GPR locals, FPSCR and
// precise ITSTATE on a disabled-FP retry; a false predicate must not trap.
    .syntax unified
    .fpu neon-vfpv4
    .thumb
base:
    .word 12
    .word one-base+1,0,0
    .word skipped-base+1,0,0
    .word then2-base+1,0,0
    .word else2-base+1,0,0
    .word then3-base+1,0,0
    .word mixed3-base+1,0,0
    .word then4-base+1,0,0
    .word doubles-base+1,0,0
    .word compare-base+1,0,0
    .word trapfirst-base+1,0,0x100
    .word traplast-base+1,0,0x100
    .word skipdisabled-base+1,0,0x100
    .macro setup
    vmov s0,r0
    vmov s1,r1
    vmov s2,r2
    vmov s3,r3
    vmov d2,r6,r7
    vmov d3,r8,r9
    mov r12,#128
1:  add r4,r4,#3
    cmp r12,#64
    .endm
    .macro done
    add r5,r5,#7
    subs r12,r12,#1
    bne 1b
    vmov r0,s0
    vmov r1,s1
    vmov r2,s2
    vmov r3,s3
    vmov r6,r7,d2
    vmov r8,r9,d3
    vmrs r11,fpscr
    svc #0
    .endm
    .balign 4096
one: setup
    it ne
    vaddne.f32 s0,s0,s2
    done
    .balign 4096
skipped: setup
    // Z stays set for every iteration, including when the JIT is hot.
    cmp r12,r12
    it ne
    vaddne.f32 s0,s0,s2
    done
    .balign 4096
then2: setup
    itt ne
    vsubne.f32 s0,s0,s2
    vmulne.f32 s1,s1,s3
    done
    .balign 4096
else2: setup
    ite ne
    vdivne.f32 s0,s0,s2
    vmoveq.f32 s1,s3
    done
    .balign 4096
then3: setup
    ittt ne
    vabsne.f32 s0,s2
    vnegne.f32 s1,s3
    vaddne.f32 s0,s0,s1
    done
    .balign 4096
mixed3: setup
    itte ne
    vaddne.f32 s0,s0,s2
    vsubne.f32 s1,s1,s3
    vmuleq.f32 s0,s0,s1
    done
    .balign 4096
then4: setup
    itttt ne
    vabsne.f32 s0,s2
    vnegne.f32 s1,s3
    vaddne.f32 s0,s0,s1
    vsubne.f32 s1,s1,s0
    done
    .balign 4096
doubles: setup
    ite gt
    vaddgt.f64 d0,d0,d1
    vmovle.f64 d2,d3
    done
    .balign 4096
compare: setup
    itt ne
    vcmpne.f32 s0,s2
    vcmpne.f64 d1,#0
    done
    .macro warm
    mov r12,#128
1:  add r4,r4,#3
    subs r12,r12,#1
    bne 1b
    .endm
    .balign 4096
trapfirst: warm
    it eq
    vaddeq.f32 s0,s0,s2
    svc #0
    .balign 4096
traplast: warm
    itte eq
    addeq r4,r4,#5
    moveq r5,#37
    vaddne.f32 s0,s0,s2
    // The first two instructions change neither NZCV nor the predicate.
    // This final NE slot is false, so a separate IT must cause the trap.
    itt eq
    addeq r6,r6,#7
    vaddeq.f64 d0,d0,d1
    svc #0
    .balign 4096
skipdisabled: warm
    it ne
    vaddne.f32 s0,s0,s2
    svc #0
