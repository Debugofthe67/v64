// Diagnostic local-drive adapter for the RM-505 ROFS probe. r0 is a proxy
// with its partition base at +4. EABI aligns the 64-bit position to r2/r3.
// The caller supplies a local TPtr8, its offset, and an in-bounds extent.
.syntax unified
.arch armv6
.arm
    push    {r4-r11,r12,lr}
    ldr     r4,[r0,#4]
    add     r4,r4,r2           // physical byte position
    ldr     r5,[sp,#40]        // bytes remaining
    ldr     r6,[sp,#44]        // local descriptor
    ldr     r7,[r6,#8]
    ldr     r0,[sp,#52]
    add     r7,r7,r0           // destination, including descriptor offset
    ldr     r8,=0x0dc01000     // private 2 KiB page buffer
    ldr     r9,=0x08002ce9     // retail RAP3NAND read-page (Thumb)
    ldr     r10,=2047
next_page:
    cmp     r5,#0
    beq     complete
    mov     r0,#0
    mov     r1,r4,lsr #11
    mov     r2,r8
    blx     r9
    cmp     r0,#0
    bne     done
    and     r11,r4,r10
    rsb     r12,r11,#2048
    cmp     r12,r5
    movhi   r12,r5
    add     r4,r4,r12
    sub     r5,r5,r12
    add     r11,r8,r11
copy:
    ldrb    r0,[r11],#1
    strb    r0,[r7],#1
    subs    r12,r12,#1
    bne     copy
    b       next_page
complete:
    ldr     r0,[r6]
    and     r0,r0,#0xf0000000  // preserve TDes8 kind and return length
    ldr     r1,[sp,#40]
    ldr     r2,[sp,#52]
    add     r1,r1,r2
    orr     r0,r0,r1
    str     r0,[r6]
    mov     r0,#0
done:
    pop     {r4-r11,r12,pc}
.ltorg
