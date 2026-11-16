# Original v86 iPhone graphics adapter

`libv86gles.dylib` is v86's ARMv7 bridge between the simulated iPhone's
graphics interfaces and the host GLES/WebGPU transport. It targets N90
iOS 6.1.3 build 10B329 and carries an ad-hoc signature. It contains v86
code built with symbol-only link stubs, without Apple framework
implementations, firmware, keys or the owner's dyld cache. The local cache
supplies interface slot numbers when building the bridge.

The binary is distributed under the repository's [BSD license](../../LICENSE).
`manifest.json` records SHA-256 digests of the binary and its source inputs.
`make pages` verifies these inputs and the signed Mach-O, copies the adapter
to `build/ios-guest`, and requires it in the static site. Linux CI needs no
Apple build tools or firmware. A changed source or corrupt asset fails the
build instead of publishing a site with a missing or stale adapter.

To rebuild the release asset on macOS using your own supported cache:

```sh
make ios-graphics-assets-refresh IPHONE4_DYLD_CACHE=/path/to/dyld_shared_cache_armv7
```

Review and commit the sources, binary and manifest together. `make ios-guest`
still builds a local development adapter; `make pages` uses the verified
release copy. No IPSW, dyld cache or generated test IPA belongs here.
