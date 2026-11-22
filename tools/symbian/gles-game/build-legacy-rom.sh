#!/bin/sh
# SPDX-License-Identifier: BSD-2-Clause
set -eu
if [ "$#" -ne 4 ]; then
    echo 'Usage: sh tools/symbian/gles-game/build-legacy-rom.sh <native-sdk> <S60v5-epoc32> <S0-reference-directory> <output-directory>' >&2
    exit 2
fi
sdk=$(cd "$1" && pwd -P)
epoc=$(cd "$2" && pwd -P)
ref=$(cd "$3" && pwd -P)
mkdir -p "$4"
out=$(cd "$4" && pwd -P)
[ "$out" != "$ref" ] || { echo 'Choose a separate output directory for the game ROM' >&2; exit 2; }
src=$(cd "$(dirname "$0")" && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

for library in euser ws32 fbscli gdi cone libgles_cm; do
    python3 "$src/../notes/ordinal_proxy.py" "$epoc/release/armv5/lib/$library.dso" > "$work/$library.def"
done
node "$src/../gles-probe/opcodes.mjs" > "$work/opcodes.h"
for unit in "$src/../gles-probe/egl_window.cc" "$src/legacy.cc"; do
    "$sdk/bin/clang++" --target=armv6-none-eabi -march=armv6 -marm -mfpu=none -mfloat-abi=soft -mabi=aapcs -O2 \
        -fno-pic -fshort-wchar -ffreestanding -fno-exceptions -fno-rtti -fno-threadsafe-statics -fno-use-cxa-atexit \
        -fno-unwind-tables -fno-asynchronous-unwind-tables -std=c++17 -nostdinc \
        -D_UNICODE -D__GCC32__ -D__GCCV3__ -D__EABI__ -D__EPOC32__ -D__MARM__ -D__MARM_ARMV5__ \
        -D__SYMBIAN32__ -D__LONG_LONG_SUPPORTED -include "$sdk/cmake/native_cpp_compat.h" \
        -isystem "$sdk/include/native" -isystem "$sdk/include" -isystem "$sdk/include/compiler" \
        -isystem "$sdk/include/platform" -isystem "$sdk/include/c++" -isystem "$sdk/include/config" \
        -isystem "$sdk/include/openc" -isystem "$sdk/include/libc" \
        -I "$src/../gles-probe" -I "$work" -c "$unit" -o "$work/$(basename "$unit" .cc).o"
done
"$sdk/bin/llvm-nm" --undefined-only "$work/legacy.o" "$work/egl_window.o" > "$work/undefined.txt"
"$sdk/bin/llvm-nm" --defined-only "$work/legacy.o" "$work/egl_window.o" > "$work/implementation.txt"
node "$src/rom-link.mjs" imports "$ref" "$out" "$work"
for asm in imports entries; do
    "$sdk/bin/clang" --target=armv6-none-eabi -c "$work/$asm.S" -o "$work/$asm.o"
done
"$sdk/bin/ld.lld" -m armelf --no-undefined --build-id=none -T "$src/legacy.ld" -e v86_entry_eglInitialize \
    "$work/legacy.o" "$work/egl_window.o" "$work/imports.o" "$work/entries.o" -o "$work/legacy.elf"
"$sdk/bin/ld.lld" -m armelf --no-undefined --build-id=none -T "$src/legacy.ld" --oformat=binary \
    "$work/legacy.o" "$work/egl_window.o" "$work/imports.o" "$work/entries.o" -o "$work/legacy.bin"
"$sdk/bin/llvm-nm" --defined-only "$work/legacy.elf" > "$work/symbols.txt"
node "$src/rom-link.mjs" image "$ref" "$out" "$work"
