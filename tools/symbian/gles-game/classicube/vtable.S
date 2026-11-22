// SPDX-License-Identifier: BSD-2-Clause
.syntax unified
.arm

// Reuse one native import for each method referenced by several vtables.
.macro veneer name
 .section .text.\name,"ax",%progbits
 .global __wrap_\name
 .type __wrap_\name,%function
__wrap_\name:
 b __real_\name
.endm

veneer _ZN5CBase10Extension_EjRPvS0_
veneer _ZN15MObjectProvider25MObjectProvider_Reserved1Ev
veneer _ZN15MObjectProvider25MObjectProvider_Reserved2Ev
veneer _ZN11CCoeControl9SetDimmedEi
