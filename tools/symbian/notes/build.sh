#!/bin/sh
# Build with symbian-platform plus S60v5 import libraries and SIS tools.
set -eu
if [ "$#" -ne 5 ]; then
    echo 'Usage: sh tools/symbian/notes/build.sh <sdk-directory> <S60v5-SDK-epoc32> <makesis-command> <signsis-command> <output-directory>' >&2
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
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
umask 077
proxies=
for library in euser efsrv ws32 gdi; do
    proxy="$work/proxies/$library"
    mkdir -p "$proxy"
    python3 "$src/ordinal_proxy.py" "$legacy/$library.dso" > "$proxy/exports.def"
    "$sdk/bin/symbian-native" proxy-sources --definition "$proxy/exports.def" \
        --target-dll "$library.dll" --output "$proxy"
    "$sdk/bin/clang" --target=armv5t-none-eabi -c "$proxy/exports.S" -o "$proxy/exports.o"
    "$sdk/bin/ld.lld" -m armelf -shared --hash-style=sysv --build-id=none --soname="$library.dso" \
        --version-script="$proxy/exports.map" -T "$proxy/proxy.ld" "$proxy/exports.o" -o "$proxy/$library.dso"
    proxies="${proxies:+$proxies;}$proxy/$library.dso"
done
openssl req -x509 -newkey rsa:2048 -sha1 -nodes -days 3650 -set_serial 1 -config "$src/test-signer.cnf" \
    -keyout "$work/test.key" -out "$work/test.pem" >/dev/null 2>&1
openssl rsa -in "$work/test.key" -traditional -out "$work/notes.key" 2>/dev/null
for version in 1 2; do
    project="$work/v$version"
    mkdir -p "$project"
    cp "$src/CMakeLists.txt" "$src/app.cc" "$src/start.S" "$project/"
    sed "s/version = \[1, 0, 0\]/version = [$version, 0, 0]/" "$src/symbian.toml" > "$project/symbian.toml"
    node -e 'console.log(JSON.stringify({ sdk: process.argv[1] }))' "$sdk" > "$project/sdk-location.json"
    "$sdk/bin/cmake" -S "$project" -B "$project/build" -G Ninja \
        -DCMAKE_MAKE_PROGRAM="$sdk/bin/ninja" -DCMAKE_TOOLCHAIN_FILE="$sdk/cmake/symbian-arm.cmake" \
        -DSYMBIAN_TARGET_ARCH=armv6 -DCMAKE_BUILD_TYPE=Release -DNOTES_VERSION="$version" \
        "-DSYMBIAN_IMPORT_PROXIES=$proxies"
    "$sdk/bin/cmake" --build "$project/build"
    for asset in v86_notes_reg v86_notes_loc; do
        "$sdk/bin/clang" -E -P -x c -I "$epoc/include" "$src/$asset.rss" -o "$project/$asset.rpp"
        "$sdk/bin/rcomp" -u "-s$project/$asset.rpp" "-o$project/$asset.rsc" "-h$project/$asset.rsg"
    done
    cp "$project/build/e32/v86_notes.exe" "$project/v86_notes.exe"
    cp "$work/test.pem" "$work/notes.key" "$project/"
    sed "s/(0xE0860505),1,0,0/(0xE0860505),$version,0,0/" "$src/v86_notes.pkg" > "$project/v86_notes.pkg"
    (
        cd "$project"
        "$makesis" v86_notes.pkg unsigned.sis
        "$signsis" -s unsigned.sis v86_notes.sisx test.pem notes.key
    )
    mkdir -p "$out/v$version"
    cp "$project/v86_notes.sisx" "$out/v$version/"
done
