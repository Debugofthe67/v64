#!/bin/sh
# Build the v86 EGL probe for Nokia 5800 firmware 31.0.101.
set -eu
if [ "$#" -ne 5 ]; then
    echo 'Usage: sh tools/symbian/gles-probe/build.sh <native-sdk> <S60v5-epoc32> <makesis> <signsis> <output-directory>' >&2
    exit 2
fi
sdk=$(cd "$1" && pwd)
epoc=$(cd "$2" && pwd)
legacy="$epoc/release/armv5/lib"
makesis=$(command -v "$3")
signsis=$(command -v "$4")
case "$makesis" in /*) ;; *) makesis="$PWD/$makesis" ;; esac
case "$signsis" in /*) ;; *) signsis="$PWD/$signsis" ;; esac
mkdir -p "$5"
out=$(cd "$5" && pwd)
src=$(cd "$(dirname "$0")" && pwd)
notes="$src/../notes"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
umask 077
proxies=
for library in euser ws32 gdi fbscli; do
    proxy="$work/proxies/$library"
    mkdir -p "$proxy"
    python3 "$notes/ordinal_proxy.py" "$legacy/$library.dso" > "$proxy/exports.def"
    "$sdk/bin/symbian-native" proxy-sources --definition "$proxy/exports.def" \
        --target-dll "$library.dll" --output "$proxy"
    "$sdk/bin/clang" --target=armv5t-none-eabi -c "$proxy/exports.S" -o "$proxy/exports.o"
    "$sdk/bin/ld.lld" -m armelf -shared --hash-style=sysv --build-id=none --soname="$library.dso" \
        --version-script="$proxy/exports.map" -T "$proxy/proxy.ld" "$proxy/exports.o" -o "$proxy/$library.dso"
    proxies="${proxies:+$proxies;}$proxy/$library.dso"
done
project="$work/project"
mkdir -p "$project"
cp "$src/CMakeLists.txt" "$src/symbian.toml" "$src/app.cc" "$src/egl_window.cc" "$src/egl_window.h" "$notes/start.S" "$project/"
node "$src/opcodes.mjs" > "$project/opcodes.h"
node -e 'console.log(JSON.stringify({ sdk: process.argv[1] }))' "$sdk" > "$project/sdk-location.json"
"$sdk/bin/cmake" -S "$project" -B "$project/build" -G Ninja \
    -DCMAKE_MAKE_PROGRAM="$sdk/bin/ninja" -DCMAKE_TOOLCHAIN_FILE="$sdk/cmake/symbian-arm.cmake" \
    -DSYMBIAN_TARGET_ARCH=armv6 -DCMAKE_BUILD_TYPE=Release "-DSYMBIAN_IMPORT_PROXIES=$proxies"
"$sdk/bin/cmake" --build "$project/build"
for kind in reg loc; do
    sed -e 's/0xE0860505/0xE0860506/g' -e 's/v86_notes/v86_gles/g' -e 's/v86 Notes/v86 EGL/g' -e 's/"Notes"/"v86 EGL"/g' \
        "$notes/v86_notes_$kind.rss" > "$work/v86_gles_$kind.rss"
    "$sdk/bin/clang" -E -P -x c -I "$epoc/include" "$work/v86_gles_$kind.rss" -o "$work/v86_gles_$kind.rpp"
    "$sdk/bin/rcomp" -u "-s$work/v86_gles_$kind.rpp" "-o$work/v86_gles_$kind.rsc" "-h$work/v86_gles_$kind.rsg"
done
cp "$project/build/e32/v86_gles.exe" "$work/v86_gles.exe"
cp "$src/v86_gles.pkg" "$work/"
openssl req -x509 -newkey rsa:2048 -sha1 -nodes -days 3650 -set_serial 1 -config "$notes/test-signer.cnf" \
    -keyout "$work/test.key" -out "$work/test.pem" >/dev/null 2>&1
openssl rsa -in "$work/test.key" -traditional -out "$work/rsa.key" 2>/dev/null
(
    cd "$work"
    "$makesis" v86_gles.pkg unsigned.sis
    "$signsis" -s unsigned.sis v86_gles.sisx test.pem rsa.key
)
cp "$work/v86_gles.exe" "$work/v86_gles.sisx" "$out/"
