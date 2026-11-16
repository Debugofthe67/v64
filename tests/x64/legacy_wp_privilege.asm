; CR0.WP=0 permits supervisor writes, never user writes, to a user RO page.
; Warm the same user store, downgrade its mapping, write it from CPL0, then
; retry the compiled store at CPL3 without invalidating the kernel's TLB fill.
bits 32
org 0x100000
%define RESULT 0x380000
%define PD 0x200000
%define PT 0x201000
%define PDPT 0x202000
%define IDT 0x280000
%define TARGET 0x4000000
%define BACKING 0x400000
header:
    dd 0x1BADB002, 0x10000, -(0x1BADB002 + 0x10000)
    dd header, header, finish, finish, start
start:
    cli
    cld
    lgdt [gdtr]
    jmp 8:protected
protected:
    mov ax, 0x10
    mov ds, ax
    mov es, ax
    mov ss, ax
    mov esp, 0x3F0000
    mov eax, tss
    mov word [gdt+5*8+2], ax
    shr eax, 16
    mov byte [gdt+5*8+4], al
    mov byte [gdt+5*8+7], ah
    mov ax, 0x28
    ltr ax
    mov edi, IDT
    mov ecx, 256
    mov eax, unexpected
    mov ebx, eax
    and eax, 0xFFFF
    or eax, 8<<16
    and ebx, 0xFFFF0000
    or ebx, 0x8E00
.idt:
    stosd
    xchg eax, ebx
    stosd
    xchg eax, ebx
    loop .idt
%macro gate 3
    mov eax, %2
    mov word [IDT+%1*8], ax
    shr eax, 16
    mov word [IDT+%1*8+6], ax
    mov byte [IDT+%1*8+5], %3
%endmacro
    gate 14, page_fault, 0x8E
    gate 0x80, downgrade, 0xEE
    gate 0x81, done, 0xEE
    lidt [idtr]
%ifdef PAE
    mov dword [PDPT], PD|1
    mov edi, PD
    mov eax, 0x87
    mov ecx, 8
.identity:
    stosd
    mov dword [edi], 0
    add edi, 4
    add eax, 0x200000
    loop .identity
%ifdef LARGE
    mov dword [PD+32*8], BACKING|0x87
%define PERMISSION PD+32*8
%else
    mov dword [PD+32*8], PT|7
    mov dword [PT], BACKING|7
%define PERMISSION PT
%endif
    mov eax, (1<<4)|(1<<5)
    mov cr4, eax
    mov eax, PDPT
%else
    mov dword [PD], 0x87
    mov dword [PD+4], BACKING|0x87
%ifdef LARGE
    mov dword [PD+16*4], BACKING|0x87
%define PERMISSION PD+16*4
%else
    mov dword [PD+16*4], PT|7
    mov dword [PT], BACKING|7
%define PERMISSION PT
%endif
    mov eax, 1<<4
    mov cr4, eax
    mov eax, PD
%endif
    mov cr3, eax
    mov eax, cr0
    and eax, ~(1<<16)
    or eax, 1<<31
    mov cr0, eax
    mov ecx, 8192
    push dword 0x23
    push dword 0x3D0000
    push dword 2
    push dword 0x1B
    push dword user
    iretd
align 4096
user:
    mov ax, 0x23
    mov ds, ax
    mov es, ax
.store:
    mov dword [TARGET], 0xDEADBEEF
.after:
    cmp dword [RESULT+16], 1
    je .finish
    dec ecx
    jnz .store
    int 0x80
%ifdef READ_FIRST
    mov eax, [TARGET]
    mov [RESULT+20], eax
%endif
    jmp .store
.finish:
    int 0x81
    ud2
downgrade:
    and dword [PERMISSION], ~2
    invlpg [TARGET]
    mov dword [TARGET], 0x11223344
    mov dword [RESULT+16], 1
    iretd
page_fault:
    push eax
    mov eax, [esp+4]
    mov [RESULT+4], eax
    mov eax, cr2
    mov [RESULT+8], eax
    inc dword [RESULT]
    mov dword [esp+8], user.after
    pop eax
    add esp, 4
    iretd
done:
    mov eax, [BACKING]
    mov [RESULT+12], eax
    mov dword [RESULT+24], 0xD0D0
.halt:
    hlt
    jmp .halt
unexpected:
    mov dword [RESULT+28], 1
    jmp done.halt
align 8
gdt:
    dq 0, 0x00CF9A000000FFFF, 0x00CF92000000FFFF
    dq 0x00CFFA000000FFFF, 0x00CFF2000000FFFF, 0x0000890000000067
gdtr: dw 6*8-1
    dd gdt
idtr: dw 256*8-1
    dd IDT
align 16
tss:
    dd 0, 0x3F0000, 0x10
    times 104-($-tss) db 0
finish:
