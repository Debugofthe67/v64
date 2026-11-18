ENTRY(attach_network_identity)
SECTIONS
{
    . = 0x802b6200;
    .text : { *(.text) }
    /DISCARD/ : { *(.ARM.attributes) }
}
ifnet_attach = 0x800dde71;
ifnet_find_by_name = 0x800eebcd;
ifnet_release = 0x800ed73d;
ifnet_allocate = 0x800ed235;
ifnet_set_mtu = 0x800edea1;
ifnet_set_addrlen = 0x800eded1;
ifnet_set_hdrlen = 0x800edef1;
mbuf_freem = 0x801e803d;
ether_demux = 0x800e1cbc;
ether_add_proto = 0x800e1a48;
ether_del_proto = 0x800e19d8;
ether_check_multi = 0x800e1fe0;
ether_frameout = 0x800e1ee0;
