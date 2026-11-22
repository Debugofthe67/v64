# Nokia 5800 on v86

v86 runs the Nokia 5800 XpressMusic (RM-356) S60v5 firmware version 31.0.101 on the Syborg virtual board. You can use the original home screen and apps, install compatible SIS/SISX packages, and keep your files between sessions.

## Start the phone

1. Download **RM-356 v.31.01 5800.rar**. A ZIP or 7z archive containing the same firmware files also works. [5800 firmware archive](https://firmware.center/firmware/Nokia/5800%20%28RM-356%2C%20RM-428%29/Flash%20Files/)
2. In v86, choose **New virtual machine → Symbian → S60v5 → Nokia 5800 (RM-356)**. Click **Choose File** and select the archive. The browser extracts and checks the files and prepares the phone's system images locally. When **Verified firmware 31.0.101** appears, click **Next**, name the VM, and finish creating it.
3. Select the VM and click **Power on**. Set the time and date if prompted. On the home screen, tap the display or press **Menu** beneath it to find your apps. **Lock** toggles the guest's screen lock. **Media** opens the original media shortcuts.
4. Use **Power → Save and power off** to keep the VM's disk changes and start it fresh next time. Use **Power → Suspend** to resume the same screen later.

Each VM has its own writable phone memory (`C:`). The browser stores it for this site. Clearing the site's data removes its VMs and browser disks. You can export the disks from **Browser disks**.

## Connect to the Internet

1. With the VM powered off, go to **Library → Edit settings → Symbian firmware**. Enable **Internet via virtual SIM**, enter a **Wisp relay URL** or keep the prefilled one, and save. Use a `wisps://` relay when v86 is served over HTTPS.
2. Power on. If the phone asks whether to continue in offline mode, choose **No**. The phone should show **3G**.
3. In the phone, open **Menu → Settings → Connectivity → Destinations → Access point**. Choose **No** when asked to check for available access points. Choose **Packet data**, enter `internet` as the access point name, then select the **Internet** destination. The phone saves this setup for future boots.
4. Open **Menu → Internet → Web** and select **Internet → internet** when the phone asks how to connect. Try an HTTP page first. The original browser may fail on sites that require newer HTTPS support.

Internet connections pass through your selected Wisp relay. The virtual SIM supports IPv4 data for the phone's apps.

## Install an app

1. Get a signed S60v5 SIS or SISX package that supports the Nokia 5800. To try the included example, use [v86 Notes 1.0](../tests/symbian/fixtures/notes-v1.sisx).
2. Save any open work in the phone. In the v86 toolbar, choose **Send SIS/SISX…**, select the package, and click **Save card and power off**. Then click **Power on again**.
3. In the phone, open **Menu → Applications → File mgr. → E: → INSTALL**. v86 lists each transferred filename. The first is `PKG00001.SIS`.
4. Select the file and choose **Options → Organise → Copy to folder → C: Phone mem. → Root folder → Copy**. In the same boot, open **Phone memory**, select the copy, and click **Open selected file** in the v86 toolbar.
5. Follow the original Symbian installer and choose **C: Phone mem.**. Open the installed app from **Applications**. v86 Notes has a puzzle-piece icon. Type a note and tap **Save**. Open it again after a cold start to see the saved text.

If an installer reports an expired certificate, check the guest's date against the certificate's validity period. The included Notes packages are valid from 18 November 2026 to 15 November 2036 UTC. The original installer checks signing, permissions, and device compatibility. If you see a file-type error, copy the package from E: to C: again and open the new copy during that session.

To replace the transfer card, power off and use **Library → Edit settings → Symbian firmware → Eject transfer card**, then save. You can still find its image in **Browser disks**. To remove an installed app, use **Menu → Settings → Application mgr. → Installed apps.** inside the phone.

## Play 3D games

New Nokia 5800 VMs start with **WebGPU acceleration** enabled. To change it, power off the VM and open **Library → Edit settings → Symbian firmware**. If the browser cannot provide WebGPU, the phone starts with the software display. Exit active 3D apps before suspending. To resume a snapshot, use the same firmware and graphics mode.

The tested samples are **Bantumi GL 2.05** (OpenGL ES 1.1) and **ClassiCube 1.3(17)** (OpenGL ES 2.0). Bantumi uses the optional [graphics ROM builder](../tools/symbian/gles-game/build-legacy-rom.sh) and a test-signed copy of the author's package. ClassiCube uses [the v86 build script](../tools/symbian/gles-game/classicube/build.sh) and the regular Syborg firmware. On its first launch, choose **No** for optional online assets, then **Classic → Singleplayer**. [Bantumi GL releases](https://www.martin.st/software/) · [ClassiCube for Symbian](https://nnproject.cc/cc/)

Both samples ran through the original installer and Applications menu. On Chrome with an Apple M1 Pro, median frame intervals were 77.1 ms for Bantumi and 63.4 ms for ClassiCube. The ClassiCube test also saved and reopened a map. Compatibility varies by game and package version.

## Build the firmware folder

This section is for maintainers preparing the assembly components and developers reproducing the reference build. The original Nokia firmware is supplied by the user.

1. Obtain the three matching RM-356 31.0.101 files below. Verify them with `node tools/symbian/syborg.mjs firmware /path/to/original-firmware` from the v86 checkout. [5800 firmware archive](https://firmware.center/firmware/Nokia/5800%20%28RM-356%2C%20RM-428%29/Flash%20Files/) · [Known file hashes](plan/n97-plan.md#选型和对照环境)

   - `RM-356_31.0.101_prd.core.C00`
   - `RM-356_31.0.101_prd.rofs2.V05`
   - `RM-356_31.0.101_C01_prd.rofs3.fpsx`

2. On Linux, build qembian at revision `aae8b5f4ecf4fccacac91b2b93a6a24df586d9bb` with its locked tools and sources. Import the firmware using `python3 -I tools/fw/store.py import /path/to/original-firmware`. After building its host tools and kernel, run the commands below in the qembian checkout. The exact Linux build, patch adjustments, and reference hashes are in the [validation archive](#developer-reference). [Pinned qembian build guide](https://github.com/emgfc/qembian/blob/aae8b5f4ecf4fccacac91b2b93a6a24df586d9bb/README.md#building)

   ```sh
   device=nokia-5800-rm356@31.0.101
   python3 -I tools/device.py build "$device" --kernel --out ROM.img
   SYBORG_UDA=0 python3 -I tools/device.py drive-image "$device" --kind nvmem --out C-blank-seed.img
   python3 -I tools/device.py paths "$device" dtb
   python3 -I tools/device.py paths "$device" manifest
   ```

3. Put `ROM.img`, `ROM.img.rofs` (rename it to `ROM.rofs`), the device tree as `syborg.dtb`, the qembian composition list as `hybrid-manifest.txt`, and `C-blank-seed.img` in one folder. In the v86 checkout, create and verify the import manifest, then prepare the reusable assembly components.

   ```sh
   firmware=/path/to/original-firmware
   artifacts=/path/to/syborg-build-folder
   node tools/symbian/syborg.mjs manifest "$firmware" "$artifacts"
   node tools/symbian/syborg.mjs verify "$artifacts" "$firmware"
   node tools/symbian/syborg.mjs components "$firmware" "$artifacts"
   ```

The components command writes `build/syborg-5800-components.bin`. The site build includes it when present. This file carries the Syborg boot code and layout data. Each original firmware import restores the Nokia user-side ROM and ROFS from the user's archive and starts with a blank C: drive. Archive extraction uses the packaged 7-Zip WebAssembly module. [Decoder source](https://github.com/arktronic/sevenzip-wasm)

To import a prepared build, ZIP `manifest.json` and its referenced files together and select that ZIP in the same wizard. A prepared build can use the optional factory seed. Build `C-factory-seed.img` from `RM356_31.0.008_020_xxx_U01.uda.fpsx` with qembian's `drive-image` command and add `--factory-seed` to v86's `manifest` command.

## Developer reference

Build the local UI with `make app build/v86-arm64.wasm` and serve the checkout with `python3 -m http.server 8000 --bind 127.0.0.1`. Open [the local v86 library](http://127.0.0.1:8000/). For WebGPU, also run `make build/v86-gles.js glbridge`. For programmatic startup, use `machine_type: "symbian-syborg"`, `cpu_type: "arm32"`, and `cpu_profile: "arm1136-r2"`. Copy the selected seed to a separate writable disk for each VM. In browser code, keep the same OPFS URL when reopening that VM. [Constructor example](plan/n97-plan.md#代码级启动约定) · [TypeScript options](../v86.d.ts)

Build your own test app with the symbian-platform SDK, the S60v5 `epoc32` headers and import libraries, MakeSIS, and SignSIS. The Notes script builds and signs both versions with the same test certificate so you can exercise a native upgrade. [Notes source and build script](../tools/symbian/notes/)

```sh
sh tools/symbian/notes/build.sh "$native_sdk" "$s60v5_epoc32" makesis signsis ./notes-build
```

The full S0–S7 validation archive includes the reference build, ABI checks, installer and GPU test procedures, and frame measurements. Read it with `git show dc9d6aea4:docs/symbian-syborg-reference.md`. The retired N97 hardware research is available in Git at `4d3311a5b`. Existing N97 configurations can be exported from the library and their disk images from **Browser disks**. Those configurations and snapshots require a historical v86 build to run.
