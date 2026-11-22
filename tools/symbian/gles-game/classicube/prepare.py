# SPDX-License-Identifier: BSD-2-Clause
"""Prepare the pinned S60v5 ClassiCube source, assets and E32 import names."""
from hashlib import sha256
from pathlib import Path
from struct import pack, pack_into, unpack_from
import subprocess
import sys
from zlib import crc32, decompress


SOURCE_SHA256 = "a3ca75c48a4631fccc5e3ef9a75341755c8df43565593dbd020cb268c036d3c2"
PACKAGE_SHA256 = "3d0f7fdc04a88b1a5eee207808bcb897f6391628deea44c2812d79cb13030d5a"

# The first supported Syborg image retains these RM-356 modules.
XIP_UIDS = {
    "apgrfx": 0x10003A3C, "apparc": 0x10003A3D, "avkon": 0x100056C6,
    "bafl": 0x10003A0F, "cone": 0x10003A41, "dfpaeabi": 0, "drtaeabi": 0,
    "eikcoctl": 0x1000489E, "eikcore": 0x10004892, "eikdlg": 0x10004898,
    "estor": 0x10003B0D, "euser": 0x100039E5, "fbscli": 0x10003A15,
    "featdiscovery": 0x10200C89, "hal": 0x100039E8,
    "mediaclientaudiostream": 0x10003996, "ws32": 0x10003B21,
}
ROFS_UIDS = {
    "libc": 0x10207369, "libdl": 0x10281F32, "libm": 0x102750D2,
    "libpthread": 0x10275065,
}


def sis_fields(data, array=False):
    element_type = unpack_from("<I", data)[0] if array else None
    offset = 4 if array else 0
    while offset < len(data):
        kind = element_type if array else unpack_from("<I", data, offset)[0]
        length = unpack_from("<I", data, offset if array else offset + 4)[0]
        start = offset + (4 if array else 8)
        end = start + length
        offset = (end + 3) & ~3
        if offset > len(data):
            raise ValueError("Invalid field in pinned ClassiCube SIS")
        yield kind, data[start:end]


def field(data, kind):
    return next(value for code, value in sis_fields(data) if code == kind)


def replace_once(text, old, new):
    if text.count(old) != 1:
        raise ValueError("Unexpected ClassiCube source")
    return text.replace(old, new, 1)


def prepare_assets(archive, package, epoc, work):
    if sha256(archive.read_bytes()).hexdigest() != SOURCE_SHA256:
        raise ValueError("Use the pinned ClassiCube source archive")
    original = package.read_bytes()
    if sha256(original).hexdigest() != PACKAGE_SHA256:
        raise ValueError("Use the author's pinned ClassiCube SIS")
    source = work / "source"
    resources = work / "resources"
    source.mkdir()
    resources.mkdir()
    subprocess.run(["tar", "-xf", str(archive), "--strip-components=1", "-C", str(source)], check=True)

    platform = source / "src/symbian/Platform_Symbian.cpp"
    text = platform.read_text()
    text = replace_once(text, "\tsignal(SIGCHLD, SIG_IGN);\n", "")
    text = replace_once(text, "\t/* So writing to closed socket doesn't raise SIGPIPE */\n\tsignal(SIGPIPE, SIG_IGN);\n", "")
    platform.write_text(text)
    graphics = source / "src/Graphics_GL2.c"
    text = replace_once(graphics.read_text(), "static cc_uint16 gl_indices[GFX_MAX_INDICES];\n", "")
    text = replace_once(text, "\tcc_uint16 gl_indices[GFX_MAX_INDICES];\n#endif",
                        "\tcc_uint16 gl_indices[GFX_MAX_INDICES];\n#else\n"
                        '\tcc_uint16* gl_indices = Mem_Alloc(count, sizeof(cc_uint16), "index data");\n#endif')
    text = replace_once(text, "glBufferData(GL_ELEMENT_ARRAY_BUFFER, size, gl_indices, GL_STATIC_DRAW);",
                        "glBufferData(GL_ELEMENT_ARRAY_BUFFER, size, gl_indices, GL_STATIC_DRAW);\n"
                        "#ifdef GL_INDICES\n\tMem_Free(gl_indices);\n#endif")
    graphics.write_text(text)

    header = (epoc / "include/biditext.h").read_text()
    (resources / "biditext.h").write_text(replace_once(header, "enum CGraphicsContext::TTextAlign;\n", ""))
    (resources / "classicube.rsg").write_text("#define R_QUERY_DIALOG 0x122b1005\n#define R_TEXT_QUERY 0x122b1006\n")

    data = field(field(original[16:], 12), 30)
    unit = next(sis_fields(field(data, 2), array=True))[1]
    files = [value for _, value in sis_fields(field(unit, 2), array=True)]
    for index, name in {3: "classicube.rsc", 4: "classicube_icon.mif", 8: "classicube_reg.rsc", 9: "classicube.zip"}.items():
        raw = field(files[index], 3)
        encoding, size = unpack_from("<IQ", raw)
        contents = raw[12:] if encoding == 0 else decompress(raw[12:])
        if len(contents) != size:
            raise ValueError("Invalid data size in pinned ClassiCube SIS")
        (resources / name).write_bytes(contents)


def patch_image(path, uid_header, output):
    image = bytearray(path.read_bytes())
    if image[16:20] != b"EPOC" or unpack_from("<I", image, 0x1C)[0]:
        raise ValueError("Expected an uncompressed E32 image")
    code = unpack_from("<I", image, 0x64)[0]
    imports, code_relocs, data_relocs = unpack_from("<III", image, 0x6C)
    count = unpack_from("<I", image, 0x54)[0]
    if not code < imports < code_relocs < data_relocs < len(image):
        raise ValueError("Unexpected E32 tables")
    modules = {}
    cursor = imports + 4
    for _ in range(count):
        name_offset, slots = unpack_from("<II", image, cursor)
        name_start = imports + name_offset
        name_end = image.index(0, name_start, code_relocs)
        dll = image[name_start:name_end].decode("ascii").removesuffix(".dll")
        end = cursor + 8 + slots * 4
        modules[dll] = image[cursor + 4:end]
        cursor = end
    if modules.keys() != XIP_UIDS.keys() | ROFS_UIDS.keys():
        raise ValueError("Unexpected ClassiCube dependencies")

    names_offset = cursor - imports
    blocks, names = bytearray(), bytearray()
    for dll, slots in modules.items():
        version = 0xA0000 if dll in XIP_UIDS else 0x10000
        uid = (XIP_UIDS if dll in XIP_UIDS else ROFS_UIDS)[dll]
        identity = f"[{uid:08x}]" if uid else ""
        blocks.extend(pack("<I", names_offset + len(names)))
        blocks.extend(slots)
        names.extend(f"{dll}{{{version:08x}}}{identity}.dll\0".encode("ascii"))
    table = blocks + names
    table.extend(bytes(-len(table) % 4))
    table = pack("<I", len(table) + 4) + table
    delta = len(table) - (code_relocs - imports)
    image[imports:code_relocs] = table
    pack_into("<II", image, 0x70, code_relocs + delta, data_relocs + delta)
    pack_into("<I", image, 0x7C, len(image) - code)

    image[:16] = uid_header.read_bytes()
    pack_into("<III", image, 0x38, 0x80000, 0x4000000, 0x14000)
    pack_into("<I", image, 0x88, 0x1A000)  # Same user capabilities as the author's S60v5 build.
    pack_into("<I", image, 0x14, 0xC90FDAA2)
    pack_into("<I", image, 0x14, ~crc32(image[:code], 0xFFFFFFFF) & 0xFFFFFFFF)
    output.write_bytes(image)


if __name__ == "__main__":
    action, *args = sys.argv[1:]
    if action == "assets":
        prepare_assets(*map(Path, args))
    elif action == "image":
        patch_image(*map(Path, args))
    else:
        raise SystemExit("Expected assets or image")
