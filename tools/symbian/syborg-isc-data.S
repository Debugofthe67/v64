/* Nokia 5800 ISC packet controls for the linked qembian NokiaISCDriver.
 * Request already holds the factory mutex. Reuse the stand-in's descriptor
 * checks, packet queues and modem writes. Never dereference user pointers here.
 */
.syntax unified
.arch armv5te
.arm
.text

.equ client, 0x30
.equ pending_status, 0x1124
.equ pending_buffer, 0x1128
.equ pending_needed, 0x112c
.equ legacy_control, 0x82741380
.equ read_args, 0x827410b4
.equ send_data, 0x82742404
.equ try_deliver_data, 0x82742780
.equ complete_request, 0x8274337c
.equ make_ptrc8, 0x827433b4
.equ thread_des_write, 0x82742c64

.global isc_data_control
isc_data_control:
    cmp r1, #18                 @ DataSend (descriptor)
    beq .Lsend
    cmp r1, #5                  @ DataSend (status, descriptor)
    beq .Lsend
    cmp r1, #6                  @ DataReceive (status, descriptor, needed TPtr8)
    beq .Lreceive
    cmp r1, #34                 @ DataReceiveCancel
    beq .Lcancel
    ldr pc, =legacy_control

.Lsend:
    push {r4, r5, r6, lr}
    sub sp, sp, #16
    mov r4, r0
    mov r5, r1
    mov r1, r2
    mov r2, sp
    cmp r5, #5
    moveq r3, #2
    movne r3, #1
    ldr r12, =read_args
    blx r12
    cmp r0, #0
    bne .Lreturn
    mov r0, r4
    cmp r5, #5
    ldreq r1, [sp, #4]
    ldrne r1, [sp]
    ldr r12, =send_data
    blx r12
    cmp r5, #5
    bne .Lok
    mov r1, sp
    mov r2, #0                  @ KErrNone
    b .Lcomplete

.Lreceive:
    push {r4, r5, r6, lr}
    sub sp, sp, #16
    mov r4, r0
    mov r1, r2
    mov r2, sp
    mov r3, #3
    ldr r12, =read_args
    blx r12
    cmp r0, #0
    bne .Lreturn
    ldr r6, =pending_status
    ldr r3, [r4, r6]
    cmp r3, #0
    bne .Lbusy
    ldm sp, {r0-r2}
    str r0, [r4, r6]
    add r6, r4, r6
    str r1, [r6, #(pending_buffer - pending_status)]
    str r2, [r6, #(pending_needed - pending_status)]
    mov r0, r4
    ldr r12, =try_deliver_data
    blx r12
    b .Lok

.Lbusy:
    mov r1, sp
    mvn r2, #13                 @ KErrInUse
    b .Lcomplete

.Lcancel:
    push {r4, r5, r6, lr}
    sub sp, sp, #16
    mov r4, r0
    ldr r6, =pending_status
    add r1, r4, r6
    mvn r2, #2                  @ KErrCancel
.Lcomplete:
    ldr r3, [r1]
    cmp r3, #0
    beq .Lok
    ldr r0, [r4, #client]
    ldr r12, =complete_request @ clears the stored status pointer
    blx r12
.Lok:
    mov r0, #0
.Lreturn:
    add sp, sp, #16
    pop {r4, r5, r6, pc}

.global isc_data_needed
isc_data_needed:
    @ The stand-in normally writes a raw uint16. S60v5 provides a TPtr8.
    push {r4, r5, r6, lr}
    sub sp, sp, #16
    mov r4, r0
    mov r5, r1
    mov r1, r2
    mov r2, r3
    add r0, sp, #4
    ldr r12, =make_ptrc8
    blx r12
    mov r0, r4
    mov r1, r5
    add r2, sp, #4
    mov r3, #0
    str r3, [sp]
    ldr r12, =thread_des_write
    blx r12
    add sp, sp, #16
    pop {r4, r5, r6, pc}
.ltorg
