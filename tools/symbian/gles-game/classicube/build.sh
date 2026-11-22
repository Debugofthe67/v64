#!/bin/sh
# SPDX-License-Identifier: BSD-2-Clause
set -eu
if [ "$#" -ne 7 ]; then
    echo 'Usage: sh build.sh <native-sdk> <S60v5-epoc32> <source.tar.gz> <author.sis> <makesis> <signsis> <output-directory>' >&2
    exit 2
fi
sdk=$(cd "$1" && pwd -P)
epoc=$(cd "$2" && pwd -P)
archive="$(cd "$(dirname "$3")" && pwd -P)/$(basename "$3")"
original="$(cd "$(dirname "$4")" && pwd -P)/$(basename "$4")"
makesis=$(command -v "$5")
signsis=$(command -v "$6")
case "$makesis" in /*) ;; *) makesis="$PWD/$makesis" ;; esac
case "$signsis" in /*) ;; *) signsis="$PWD/$signsis" ;; esac
mkdir -p "$7"
out=$(cd "$7" && pwd -P)
src=$(cd "$(dirname "$0")" && pwd -P)
probe=$(cd "$src/../../gles-probe" && pwd -P)
notes=$(cd "$src/../../notes" && pwd -P)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
umask 077
cd "$work"

python3 "$src/prepare.py" assets "$archive" "$original" "$epoc" "$work"
node "$probe/opcodes.mjs" > resources/opcodes.h
python3 "$src/build_objects.py" "$sdk" "$epoc" "$probe" "$work"
for unit in "$probe/egl_window.cc" "$src/boot.cc" "$src/egl_gles2.cc"; do
    "$sdk/bin/clang++" --target=armv6-none-eabi -march=armv6 -marm -mfpu=none -mfloat-abi=soft -mabi=aapcs -O2 \
        -fno-pic -fshort-wchar -ffreestanding -fno-exceptions -fno-rtti -fno-threadsafe-statics -fno-use-cxa-atexit \
        -fno-unwind-tables -fno-asynchronous-unwind-tables -std=c++17 -nostdinc -fdeclspec -Wno-ignored-attributes \
        -D_UNICODE -D__GCC32__ -D__GCCV3__ -D__EABI__ -D__EPOC32__ -D__MARM__ -D__MARM_ARMV5__ \
        -D__SYMBIAN32__ -D__LONG_LONG_SUPPORTED -include "$sdk/cmake/native_cpp_compat.h" \
        -isystem "$sdk/include/native" -isystem "$sdk/include" -isystem "$sdk/include/compiler" \
        -isystem "$sdk/include/platform" -isystem "$sdk/include/c++" -isystem "$sdk/include/config" \
        -isystem "$sdk/include/openc" -isystem "$sdk/include/libc" -isystem "$sdk/include/graphics" \
        -isystem "$sdk/include/abseil" -I "$probe" -I resources -c "$unit" -o "objects/$(basename "$unit" .cc).o"
done
"$sdk/bin/clang++" --target=armv6-none-eabi -marm -mfpu=none -mfloat-abi=soft -mabi=aapcs -O2 \
    -fno-pic -fshort-wchar -ffreestanding -fno-exceptions -fno-rtti -std=c++17 -nostdinc \
    --sysroot="$sdk" -D__SYMBIAN32__ -isystem "$sdk/include/abseil" -isystem "$sdk/include" \
    -isystem "$sdk/include/config" -isystem "$sdk/include/c++" -isystem "$sdk/include/compiler" \
    -isystem "$sdk/include/platform" -isystem "$sdk/include/openc" \
    -c "$sdk/cmake/native_leave_personality.cc" -o objects/native_leave_personality.o
"$sdk/bin/clang" --target=armv6-none-eabi -c "$notes/start.S" -o objects/start.o
"$sdk/bin/clang" --target=armv6-none-eabi -c "$sdk/cmake/native_leave_personality.S" -o objects/personality_dep.o
"$sdk/bin/clang" --target=armv6-none-eabi -c "$src/vtable.S" -o objects/vtable_veneers.o

set --
for library in avkon featdiscovery euser apgrfx cone fbscli ws32 hal efsrv apparc eikcore eikdlg \
    mediaclientaudiostream estor bafl eikcoctl libc libm libdl libpthread drtaeabi dfpaeabi scppnwdl gdi ecrt0; do
    stub="$epoc/release/armv5/lib/$library.dso"
    [ -f "$stub" ] || continue
    mkdir -p "proxies/$library"
    proxy="proxies/$library"
    python3 "$notes/ordinal_proxy.py" "$stub" > "$proxy/exports.def"
    "$sdk/bin/symbian-native" proxy-sources --definition "$proxy/exports.def" --target-dll "$library.dll" --output "$proxy"
    "$sdk/bin/clang" --target=armv5t-none-eabi -c "$proxy/exports.S" -o "$proxy/exports.o"
    "$sdk/bin/ld.lld" -m armelf -shared --hash-style=sysv --build-id=none --soname="$library.dso" \
        --version-script="$proxy/exports.map" -T "$proxy/proxy.ld" "$proxy/exports.o" -o "$proxy/$library.dso"
    set -- "$@" "$proxy/$library.dso"
done
# The runtime keeps a one-past-end pointer next to its destructor records.
sed '/\.bss (NOLOAD)/s/COMMON) /COMMON) . += 4; /' "$sdk/cmake/exe_unwind_image.ld" > classicube.ld
"$sdk/bin/ld.lld" -m armelf --target1-abs --no-undefined --emit-relocs --hash-style=sysv --build-id=none \
    --gc-sections --as-needed -z nocopyreloc -z notext --undefined=symbian_native_leave_personalities \
    '--undefined=Symbian$$CPP$$Exception$$Descriptor' \
    --wrap=_ZN5CBase10Extension_EjRPvS0_ --wrap=_ZN15MObjectProvider25MObjectProvider_Reserved1Ev \
    --wrap=_ZN15MObjectProvider25MObjectProvider_Reserved2Ev --wrap=_ZN11CCoeControl9SetDimmedEi \
    --defsym=__symbian_code_start=__ro_base --defsym=__symbian_exidx_start=__exidx_start \
    --defsym=__symbian_exidx_end=__exidx_end -T classicube.ld -o classicube.elf objects/*.o "$@" \
    "$epoc/release/armv5/urel/usrt2_2.lib" "$sdk/lib/armv6/libsymbian_guest_runtime.a"
for proxy in "$@"; do
    shift
    set -- "$@" --import-proxy "$proxy"
done
"$sdk/bin/symbian-native" convert-exe --input classicube.elf --uid3 0xE212A5C2 "$@" --output classicube-raw.exe
"$sdk/bin/uidcrc" 0x1000007A 0x100039CE 0xE212A5C2 uid.bin
python3 "$src/prepare.py" image classicube-raw.exe uid.bin ClassiCube.exe

cat > classicube.pkg <<'EOF'
&EN
#{"ClassiCube (Syborg GLES2)"},(0xE212A5C2),1,3,17
[0x1028315F],0,0,0,{"S60ProductID"}
%{"ClassiCube"}
:"ClassiCube"
"ClassiCube.exe"-"!:\sys\bin\ClassiCube.exe"
"resources/classicube.rsc"-"!:\resource\apps\classicube.rsc"
"resources/classicube_icon.mif"-"!:\resource\apps\classicube_icon.mif"
"resources/classicube_reg.rsc"-"!:\private\10003a3f\import\apps\classicube_reg.rsc"
"resources/classicube.zip"-"!:\private\e212a5c2\texpacks\classicube.zip"
EOF
"$makesis" classicube.pkg unsigned.sis
openssl req -x509 -newkey rsa:2048 -sha1 -nodes -days 3650 -set_serial 1 \
    -config "$notes/test-signer.cnf" -keyout test.key -out test.pem >/dev/null 2>&1
openssl rsa -in test.key -traditional -out signer.key 2>/dev/null
"$signsis" -s unsigned.sis ClassiCube.sisx test.pem signer.key
cp ClassiCube.exe ClassiCube.sisx "$out/"
