#!/usr/bin/env python3
"""Emit the function ordinals from an S60v5 SDK import library."""
from pathlib import Path
from struct import unpack_from
import re
import sys


def definition(blob):
    if blob[:6] != b"\x7fELF\x01\x01" or unpack_from("<H", blob, 18)[0] != 40:
        raise ValueError("Expected an ARM ELF32 little-endian import library")
    sections_at = unpack_from("<I", blob, 32)[0]
    stride, count = unpack_from("<HH", blob, 46)
    sections = [unpack_from("<10I", blob, sections_at + stride * i) for i in range(count)]
    edges = {}
    for symbols in sections:
        if symbols[1] != 11:  # SHT_DYNSYM
            continue
        strings = sections[symbols[6]]
        for at in range(symbols[4] + symbols[9], symbols[4] + symbols[5], symbols[9]):
            name_at, address, _, info, _, section = unpack_from("<IIIBBH", blob, at)
            kind = info & 15
            if kind != 2 or not 0 < section < count:  # STT_FUNC
                continue
            target = sections[section]
            offset = target[4] + address - target[3]
            ordinal = unpack_from("<I", blob, offset)[0]
            name_at += strings[4]
            name = blob[name_at:blob.index(0, name_at)].decode("ascii")
            if name.startswith('"_._.absent_export_'):
                continue
            if not re.fullmatch(r"[A-Za-z_$][\w$.]*", name) or not 0 < ordinal < 65536:
                raise ValueError(f"Invalid ARM import-ordinal entry {name!r}")
            edges[ordinal] = name
    if not edges:
        raise ValueError("No ordinals in import library")
    return "EXPORTS\n" + "".join(f"    {name} @ {at} NONAME\n" for at, name in sorted(edges.items()))


if __name__ == "__main__":
    sys.stdout.write(definition(Path(sys.argv[1]).read_bytes()))
