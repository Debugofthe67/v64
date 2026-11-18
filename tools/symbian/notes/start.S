// SPDX-License-Identifier: BSD-2-Clause
.syntax unified
.arm
.section .text.startup,"ax",%progbits
.global _E32Startup
.type _E32Startup,%function
_E32Startup:
    .word 0xE31F0000  // EKA2 entry marker, tst pc,#0
    cmp r4,#1
    b 1f
    .word 0           // Loader writes the code-segment identifier here.
1:
    mov r0,r4
    mov r1,sp
    bic sp,sp,#7
    bl RunNotesThread
2:
    b 2b
.size _E32Startup, . - _E32Startup
.section .rodata.symbian_exception,"a",%progbits
.balign 4
.global Symbian$$CPP$$Exception$$Descriptor
.type Symbian$$CPP$$Exception$$Descriptor,%object
Symbian$$CPP$$Exception$$Descriptor:
    .word __symbian_exidx_start, __symbian_exidx_end, __symbian_code_start, __ro_end
.size Symbian$$CPP$$Exception$$Descriptor, 16
.section .note.GNU-stack,"",%progbits
