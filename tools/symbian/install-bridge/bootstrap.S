// SPDX-License-Identifier: BSD-2-Clause
// The RM-356 31.0.101 EStart import for RHandleBase::Close branches here.
// Only the call immediately after SYSSTART.EXE starts the companion process.
.syntax unified
.arm
.text
.global _start
_start:
    ldr     ip, =0x8078e68f
    cmp     lr, ip
    ldrne   pc, =0x80299829
    push    {r4, lr}
    ldr     ip, =0x80299829  // Original RHandleBase::Close
    blx     ip
    sub     sp, sp, #8
    mov     r0, #0
    str     r0, [sp]
    mov     r0, sp
    adr     r1, name
    adr     r2, args
    mov     r3, #0
    ldr     ip, =0x8078ee4c  // RProcess::Create through EStart's import
    blx     ip
    cmp     r0, #0
    bne     done
    mov     r0, sp
    ldr     ip, =0x8078ee5c  // RProcess::Resume through EStart's import
    blx     ip
    mov     r0, sp
    ldr     ip, =0x80299829
    blx     ip
done:
    add     sp, sp, #8
    pop     {r4, pc}
.balign 4
name:
    .long (name_end - name_text) / 2
name_text:
    .short 'Z', ':', 92, 's', 'y', 's', 92, 'b', 'i', 'n', 92
    .short 'v', '8', '6', '_', 'i', 'n', 's', 't', 'a', 'l', 'l', '.', 'e', 'x', 'e'
name_end:
.balign 4
args:
    .long 0
.ltorg
