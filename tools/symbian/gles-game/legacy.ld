/* SPDX-License-Identifier: BSD-2-Clause */
SECTIONS {
    . = 0x80260000;
    .text : { *(.text .text.*) }
    .rodata : { *(.rodata .rodata.*) }
    .data : { *(.data .data.*) }
    .bss : { *(.bss .bss.* COMMON) }
    /DISCARD/ : { *(.ARM.exidx* .ARM.extab* .comment .note* .ARM.attributes) }
}
ASSERT(SIZEOF(.data) == 0 && SIZEOF(.bss) == 0, "The ROM shim must have no writable static data")
