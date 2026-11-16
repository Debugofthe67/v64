bits 32
org 0x100000
header:
    dd 0x1BADB002, 0x10000, -(0x1BADB002 + 0x10000)
    dd header, header, finish, finish, start
start:
    cli
    cld
    mov esp, 0x3F0000
    mov eax, cr0
    and eax, ~12
    mov cr0, eax
    mov eax, cr4
    or eax, 0x600
    mov cr4, eax
    mov ecx, 20000
hot:
scalar:
    mov [0x400100], ecx
rmw:
    xor dword [0x400104], ecx
    dec ecx
    jnz hot
    mov ecx, 100
coalesce:
    mov [0x400200], ecx
    dec ecx
    jnz coalesce
    mov dword [0x500000], 0x12345678
    mov dword [0x500004], 0x89ABCDEF
    mov esi, 0x500000
    mov edi, 0x400FFC
    mov ecx, 2
copy:
    rep movsd
    mov edi, 0x401020
    mov eax, 0x55AA55AA
    mov ecx, 8
fill:
    rep stosd
    pcmpeqd xmm0, xmm0
vector:
    movdqu [0x400FF8], xmm0
exchange:
    xchg [0x400018], eax
    mov edi, 0x380004
    mov esi, locations
    mov ecx, 6
    rep movsd
    mov dword [0x380000], 0xD0D0
halt:
    hlt
    jmp halt
locations: dd scalar, rmw, copy, fill, vector, exchange
finish:
