// Register a disconnected Ethernet interface immediately after lo0 attaches.
// XNU 10B329 copies ifnet_init_params and the supplied sockaddr_dl during
// allocation and attach. The interface starts down. Output owns and drops
// the packets, with ENETDOWN returned to the caller.
// Assemble for armv7-none-eabi and link with n90-ethernet.ld and
// --oformat=binary to regenerate ETHERNET_ROUTINE in n90_compat.js.
.syntax unified
.thumb

.section .text,"ax",%progbits
.thumb_func
.global attach_network_identity
attach_network_identity:
    push {r4, lr}
    bl ifnet_attach
    cbnz r0, 5f
    sub sp, #8
    adr r0, if_name
    mov r1, sp
    bl ifnet_find_by_name
    cbnz r0, 1f
    ldr r0, [sp]
    bl ifnet_release
    b 4f
1:
    adr r0, if_params
    mov r1, sp
    bl ifnet_allocate
    cbnz r0, 4f
    ldr r4, [sp]
    mov r0, r4
    movw r1, #1500
    bl ifnet_set_mtu
    mov r0, r4
    movs r1, #6
    bl ifnet_set_addrlen
    mov r0, r4
    movs r1, #14
    bl ifnet_set_hdrlen
    mov r0, r4
    adr r1, link_address
    bl ifnet_attach
    cbz r0, 4f
    mov r0, r4
    bl ifnet_release
4:
    add sp, #8
    movs r0, #0
5:
    pop {r4, pc}

.thumb_func
ethernet_down:
    push {r4, lr}
    mov r0, r1
    bl mbuf_freem
    movs r0, #50
    pop {r4, pc}

.balign 4
if_name: .asciz "en0"
if_prefix: .asciz "en"
.balign 4
broadcast: .byte 255,255,255,255,255,255
.balign 4
link_address:
    .byte 14,18,0,0,6,0,6,0
mac_address:
    .byte 0x52,0x54,0,0x86,0,1
.balign 4
if_params:
    .word mac_address, 6, if_prefix, 0, 2, 6
    .word ethernet_down, ether_demux+1, ether_add_proto+1, ether_del_proto+1
    .word ether_check_multi+1, ether_frameout+1, 0, 0, 0, 0, 0
    .word broadcast, 6
