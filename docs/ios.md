# iPhone 4 in v86

The experimental `s5l8930` machine models the GSM iPhone 4 (`iPhone3,1`,
N90AP) with one Cortex-A8, 512 MiB of RAM, a 640 × 960 display and a
16 GB NAND layout. The supported restore is iOS 6.1.3, build 10B329.
See [the implementation plan](iphone4-plan.md) for the current acceptance
results.

## Import in the VM manager

1. Open **New virtual machine…** and choose **iPhone 4 (GSM) · iOS 6.1.3 (.ipsw)**
   in **Source**. Choose or drop your original `iPhone3,1_6.1.3_10B329_Restore.ipsw`.
2. In **Keys**, follow the link to [The Apple Wiki’s iPhone3,1 (10B329) keys page](https://theapplewiki.com/wiki/Keys:BrightonMaps_10B329_(iPhone3,1)).
   Click **Keys** in the **JSON** row, save the file, and select it in the wizard.
   The browser verifies it against your IPSW. You can also paste the full JSON
   and click **Verify keys**. Existing `v86-ios-keys` files are supported.
3. Name the machine and review its NAND settings and summary. Finish the
   import. The browser verifies the package, builds the data
   volume, and saves a NAND disk in this site's private storage. The keys
   are discarded. The NAND holds its own boot files; the original system
   volume is kept separately so data can be reset without the keys.

Pages deployments include v86's signed ARMv7 graphics adapter. `make pages`
verifies the release binary and its source manifest, so Linux CI requires no
Apple build tools or firmware. A missing, corrupt or stale adapter fails the
build. For a local development server, `make ios-graphics-assets` copies the
same verified adapter to `build/ios-guest/libv86gles.dylib`.

To build a development adapter on macOS from your own 10B329 dyld cache:

```sh
make ios-guest IPHONE4_DYLD_CACHE=/path/to/dyld_shared_cache_armv7
```

After changing its sources, use `make ios-graphics-assets-refresh` with the
same `IPHONE4_DYLD_CACHE` argument to rebuild the release asset and manifest.
Review and commit both with the sources; [the asset README](../bios/ios-guest/README.md)
describes its contents and provenance.

The importer reads `build/ios-guest/libv86gles.dylib` or a copy you select
in the wizard. It links the two local display daemons, Safari and Photos
to the adapter and adds the updated executables and library to the kernel's
trust cache. Safari and Photos load the copy on the read-only system
volume. Build the current adapter and import the firmware again to pick up
the application fixes on a previously imported phone.
The graphics path needs WebGPU and the `make glbridge` assets. Boot
without the graphics adapter only for serial diagnostics.
The guest clock runs at wall-clock speed (1.0×) by default, including
with graphics enabled. API callers can set `cpu_clock.rate` for diagnostics.

The browser prepares the simulated phone for offline use. It selects
10B329 lockdownd's existing local activation path and seeds the Setup
Assistant preferences on the new data volume. The original phone's
activation service, SIM and credentials are unnecessary. This changes
only the copy of the supplied firmware and retains native code signature
checks.

The console has Home, Lock, volume, Silent and Rotate controls. Esc is
Home; Command-L sends Lock when the browser delivers it to the page.
Drag for one finger, hold Option while starting a drag for two fingers,
or touch directly on a touchscreen. Settings includes the boot terminal,
initial orientation, WebGPU and NAND reset. Power off before using
**Erase All Content and Settings**. The original system stays; the
writable data volume and the suspended state are replaced.

Browser NAND is packed by written ranges. Its logical geometry is fixed;
the actual host file grows as the guest writes new ranges. Browser disk
exports contain Apple system files and are for personal backup.

## Install a local IPA

New IPSW imports include the v86 installation helper. In the running iPhone
console, choose **Install IPA…**, select a local IPA and review its application
name, bundle ID, version and compatibility report. Choose **Install** or
**Update**. **Installed** appears after the native iOS installer, the installed
code identity check and the persistent NAND commit have all completed.
Choose **Open application** to ask SpringBoard to launch it. The first iPhone
startup can take several minutes; if SpringBoard is still starting, wait and
try Open again.

The installer accepts unencrypted ARMv7 and ARMv6 applications compatible
with iOS 6.1.3. Fat applications prefer ARMv7 and fall back to ARMv6;
preparation preserves the selected subtype when linking and signing code.
ARMv7s, ARM64, simulator code and encrypted executables remain unsupported.
Installation acceptance alone does not establish graphics/API compatibility.
Legacy `Container/` sandbox backups are checked for ZIP integrity but are
excluded from the prepared IPA; they never overwrite the new sandbox.
ARM64-only packages, FairPlay-encrypted App Store executables, unsupported
entitlements and executables without enough Mach-O header space are rejected
with a reason. Applications are prepared and signed locally in a browser
Worker. The installation policy accepts only approved local code identities
and retains native signature validation. A successful installation does not
imply that an application's unavailable device features or graphics will work.

Updating uses iOS's existing application container. Close the dialog after
the update and reopen the application to check its saved data. Power off and
reopen the same VM to test persistence without a memory snapshot. Closing the
installation dialog preserves its task; reopening it shows the same progress.

Older NAND disks without the helper report that installation is unsupported.
Import the IPSW as a new iPhone and keep the existing VM for its data.
Developer builds verify the bundled original helper assets with
`make ios-install-assets`; changing their guest sources requires
`make ios-install-assets-refresh` on macOS before rebuilding the app.

For reproducible local test applications, `make ios-install-fixtures` builds
`build/ios-install-fixtures/V86InstallTest.ipa` (UIKit and a saved tap counter)
and `V86GLES2Test.ipa` (the same counter plus a GLES 2.0 triangle).
`V86GLES565Test.ipa` requests an RGB565 EAGL drawable, checks framebuffer
completeness, and draws using a reflected shader uniform. Both GLES
fixtures check active uniform/attribute queries, including truncated names
and omitted outputs. RGB565 drawables use the compositor's BGRA8888
backing and report that actual storage; 16-bit color quantization is not
emulated.
`V86NetworkTest.ipa` opens a real Safari HTTP navigation.
`V86VolumeTest.ipa` displays the native `AVSystemController` ringtone and
active-category volume. A test-owned `v86.test.volume` backdoor service can
record these values independently of screen rendering; production CPUs
do not register that service. This distinguishes lost button edges from
stale on-screen text or HUD frames.
For a volume regression, start at `0.5000`, press Volume − four times and
check both the native readings and the screen show `0.4375`, `0.3750`,
`0.3125`, `0.2500`; four Volume + presses should restore `0.5000`.
Six clicks spaced 120 ms apart also verified `0.5000 → 0.1250 → 0.5000`.
The graphics adapter checks CPU-backed IOSurface seeds before drawing,
so reused texture names follow UIKit's updated pixels. Unchanged seeds
skip uploads. An existing NAND keeps its embedded native adapter; import
a new iPhone to use an updated adapter while retaining the old VM's data.
The same seed refresh fixes the lock screen's alternating stale highlight
frames. A 40-frame capture over seven seconds verified repeated left-to-right
highlight sweeps: one cycle's bright-pixel centroid moved approximately
`20 → 73 → 143 → 191 → 253` across a 280-pixel text crop, followed by the
normal dim interval. To repeat, wake the lock screen, capture the slider
text without touching it for six to seven seconds, and check multiple
consecutive sweeps. Wake the display again before further input tests;
screenshots can retain the last frame after the guest display sleeps.
Build an update with
`V86_FIXTURE_VERSION=2 sh tools/ios/guest/build-apps.sh build/ios-install-fixtures-v2`.
The [IPA implementation plan](ios-ipa-install-plan.md) records the acceptance
results and the real console UI test procedure.

Owner-firmware acceptance on iPhone 4 / iOS 6.1.3 verified Angry Birds 5.1.0
(minimum iOS 6.0, unencrypted ARMv7): installation through the console,
offline menu and level selection, tutorial dismissal, slingshot input,
bird flight, collision and a nonzero score. Its RGB565 request previously
left a zero-sized renderbuffer; missing native `glGetActiveUniform` and
`glGetActiveAttrib` callbacks also prevented scene parameters from reaching
the renderer. Both paths are now bridged. The first uncached launch in
this test hit iOS's launch watchdog; a second launch reached the game.
This acceptance does not establish a frame-rate target or eliminate that
startup performance limitation.

Settings' grouped background uses an Apple texture upload path. The native
adapter translates the [Apple RGBA/BGRA format pair](https://registry.khronos.org/OpenGL/extensions/APPLE/APPLE_texture_format_BGRA8888.txt)
to the host's EXT format, handles [unpack row bytes](https://registry.khronos.org/OpenGL/extensions/APPLE/APPLE_row_bytes.txt)
before transport, and retains the [client-storage preference](https://registry.khronos.org/OpenGL/extensions/APPLE/APPLE_client_storage.txt)
locally while copying uploads. These states belong to each context and can
be queried as integers, floats or booleans. Previously those parameters
raised GL errors and left the striped background black, obscuring the
Vibrate and other group headings. `node tests/ios/guest-texture.mjs`
compiles the production upload/query headers with a host C compiler and
checks channel order, padded source rows, alignment override, state reset,
context isolation and bounds. It is included in `make ios-tests`.
Native cold-boot acceptance verified the striped Settings → Sounds
background and readable Vibrate headings, both switches changing from
ON to OFF and back, and correct rendering after scrolling. No refused
GL calls or GL errors remained in that run.

## Networking

New iPhones offer an Internet connection through a virtual IP tunnel. The
native helper opens iOS 6's `utun` interface and configures IPv4, a default
route and DNS; packets use the browser's existing Wisp backend. Configure
the relay in the VM's iPhone settings. The default is
`wisps://wisp.mercurywork.shop/v86/`; Internet traffic passes through that
server. Turn the virtual network off to keep the VM offline. The `fetch`
backend is also available for HTTP endpoints that permit CORS.

This does not emulate a cellular modem or a Wi-Fi access point. Imported
phones seed the native airplane-mode preference independently of the IP
tunnel. Guest applications use
their normal sockets and resolver, including Safari. Old iOS TLS, trust
stores and WebKit still limit which modern HTTPS sites can be displayed.

The networking helper is included in newly imported NAND images. An older
VM's on-disk helper does not acquire new code when the website is updated;
keep that VM and its data, and import a new iPhone to use this helper.
Changing the relay or disabling networking takes effect at the next power-on.
The tunnel reconnects after restoring a memory snapshot; existing TCP
sessions may need to be reloaded. DNS uses the existing DoH backend, with
Google as a fallback when the default Cloudflare endpoint fails. An
explicitly configured DoH server is used without a fallback provider.

For owner-firmware acceptance, build the helper with
`V86_NETWORK_PROBE=1 sh tools/ios/guest/build-apps.sh build/ios-network-probe`,
prepare a disposable NAND using that directory, and run
`node tests/ios/network-native.mjs <probe-directory>`. The test requires
native DNS resolution and an HTTP 200 response from `example.com`.
Release helpers are built without `V86_NETWORK_PROBE`.

The iOS 6 Safari UI was also verified loading `http://example.com/` through
this tunnel on 2026-11-16. Since there is no associated Wi-Fi or cellular
radio, Safari can initially show its native airplane-mode data warning;
dismiss it with OK to continue using the tunnel.

## Local tools and checks

`tools/ios/ipsw.mjs` checks and extracts the supplied firmware.
`system-volume.mjs` prepares a copy of its HFSX system volume,
`data-volume.mjs` builds its matching data volume, and
`nand_build.mjs volumes` writes a raw sparse NAND image. The data volume
builder also runs without macOS utilities. With graphics, pass
`--gles-library` and the adapter path to both volume builders, then prepare
the matching kernel with `graphics-kernel.mjs`. Add `--offline` to
`system-volume.mjs` and `graphics-kernel.mjs` for the browser's offline
setup behavior; the data builder detects that prepared system.

Run `make ios-tests` without Apple files. Original kernel and system
tests in `tests/ios` take the owner's locally prepared firmware and NAND.
With a graphics-enabled system, `tests/ios/system.mjs` accepts
`--panel-power` to check two cycles of Lock and Home against the LCD
pixels.
The VM manager's `ios_dialog` browser test checks the experimental
entry, firmware rejection and fixed hardware settings.

The model does not emulate the boot ROM or iBoot, the cellular modem,
Wi-Fi, Bluetooth or the SGX hardware. Native audio control is present;
PCM output is not implemented. A NAND cold boot has displayed the
original iOS lock screen and accepted a touch swipe to SpringBoard's
home screen on the simulated LCD. The plan tracks app interactions and
guest rotation separately.
