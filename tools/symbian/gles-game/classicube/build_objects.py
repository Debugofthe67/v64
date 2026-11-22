# SPDX-License-Identifier: BSD-2-Clause
from concurrent.futures import ThreadPoolExecutor
import os
from pathlib import Path
import subprocess
import sys

sdk, epoc, adapter, work = map(Path, sys.argv[1:])
source = work / "source"
resources = work / "resources"
objects = work / "objects"
objects.mkdir()
(resources / "egl").mkdir()
(resources / "egl/egl.h").symlink_to(sdk / "include/graphics/EGL/egl.h")
(resources / "include").mkdir()
(resources / "include/bitmap.h").symlink_to(epoc / "include/bitmap.h")

flags = (
    "--target=armv6-none-eabi -marm -march=armv6 -mfpu=none -mfloat-abi=soft -mabi=aapcs "
    "-fshort-wchar -ffreestanding -fno-exceptions -nostdinc -fdeclspec -Wno-ignored-attributes "
    "-Wno-nonportable-include-path -Wno-c++11-narrowing -Wno-incompatible-pointer-types "
    "-Wno-int-conversion -O2 -ffunction-sections -fdata-sections "
    "-D_UNICODE -D__GCC32__ -D__GCCV3__ -D__EABI__ -D__EPOC32__ -D__MARM__ "
    "-D__MARM_ARMV5__ -D__SYMBIAN32__ -D__LONG_LONG_SUPPORTED -D_POSIX_C_SOURCE=200112L "
    "-DEKA2 -DCC_BUILD_SYMBIAN_S60V5 -DCC_GFX_BACKEND=CC_GFX_BACKEND_GL2 "
    "-DCC_BUILD_FPU_MODE=CC_FPU_MODE_LIMITED -DSYMBIAN_OE_POSIX_SIGNALS"
).split()
for include in [resources, source / "src", source / "src/freetype", source / "third_party/bearssl", adapter]:
    flags.extend(["-I", str(include)])
for include in ["config", "c++", "compiler", "graphics", "platform", "openc"]:
    flags.extend(["-isystem", str(sdk / "include" / include)])
flags.extend(["-isystem", str(epoc / "include"), "-isystem", str(epoc / "include/stdapis")])

units = []
for line in (source / "misc/symbian/common.mmh").read_text().splitlines():
    fields = line.split()
    if fields and fields[0] == "SOURCEPATH":
        directory = (source / "misc/symbian" / fields[1]).resolve()
    if fields and fields[0] == "SOURCE":
        units.extend(directory / name for name in fields[1:])


def compile_unit(path):
    native_cpp = path.suffix in (".cc", ".cpp")
    language = ["-std=gnu99", "-DIMPORT_C=", "-D__SOFTFP="]
    if native_cpp:
        language = ["-std=c++17", "-fno-rtti", "-fexceptions", "-D__LEAVE_EQUALS_THROW__",
                    "-D__SUPPORT_CPP_EXCEPTIONS__", "-include", str(sdk / "cmake/native_cpp_compat.h")]
    compiler = sdk / "bin" / ("clang++" if native_cpp else "clang")
    output = objects / (path.stem + ".o")
    result = subprocess.run([str(compiler), *flags, *language, "-c", str(path), "-o", str(output)],
                            capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError(f"{path.name}\n{result.stderr}")


if len({path.stem for path in units}) != len(units):
    raise RuntimeError("Duplicate ClassiCube object names")
with ThreadPoolExecutor(max_workers=min(12, os.cpu_count() or 1)) as executor:
    list(executor.map(compile_unit, units))
