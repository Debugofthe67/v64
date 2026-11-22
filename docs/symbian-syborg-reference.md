# Nokia 5800 Syborg 启动对照

2026-11-20 在 qembian 上验证 Nokia 5800（RM-356）`31.0.101`。在 Debian x86-64 上组装两次镜像，混合 XIP、只读 ROFS、设备树、出厂盘种子和组合清单逐字节一致。将同一份镜像交给 Debian ARM64 上的同版本 Syborg QEMU，完成离线启动到原厂 S60 主屏、按键和触摸、原厂 Notes 保存以及冷启动读回。首个可复现配置采用空白 `C:` 种子。

## 构建环境

qembian 固定为 `aae8b5f4ecf4fccacac91b2b93a6a24df586d9bb`。参考构建在 Debian 13.7 x86-64（内核 `6.12.111+deb13-cloud-amd64`）上进行。Apple Silicon 主机用 QEMU 10.2.0 运行该 Debian 虚拟机，分配六核和 6 GiB。为现代 QEMU 使用 `qemu-system-arm` 构建目标。旧工具、EKA2、BSP 和替代驱动用 Podman 5.4.2 中的 Debian squeeze i386 构建。容器依赖安装完成后，编译在断网的容器内执行。[qembian 构建说明](https://github.com/emgfc/qembian/blob/aae8b5f4ecf4fccacac91b2b93a6a24df586d9bb/README.md#building)

| 输入 | 版本或摘要 |
| --- | --- |
| Debian 云镜像 | `debian-13-genericcloud-amd64-20261001-2618.qcow2` |
| Debian 云镜像 SHA-512 | `f46f0671a6e5bdec5291ab8972bae2f10e5408c2f64a74078f11efc2f06a436a9d0313ed50e0472542eeabf780e9f7c792ac0a314c6c20507fcd9fd81b468c3d` |
| qembian 源码归档 SHA-256 | `4bc2323407c8d1965f24748f36afa36533503d7e34fca727ed39ba5cea0a7501` |
| Debian squeeze i386 容器基础 | `docker.io/debian/eol@sha256:4a306675b658d01a453bb89404daa87367f894b6ee62ea8f8980484099ca9bea` |
| PDK | `PDK_4_0a.zip`，SHA-256 `1ca8e880d36288bd3c478042e62f7b2b7b1d368910dbd2b654d1cd6a5b93b08e` |
| GCCE | CodeSourcery 2009q3-63，GCC 4.4.1，归档 SHA-256 `21f91d1692e3987d1d9cb23bda7b10822b3134cf63d985b95c2b55d35ebde789` |
| QEMU | 11.1.3，归档 SHA-256 `5a8289c7940dc77d3873c81a6c29ba3afe1446fc9d36e77fa1658cdbecb84b22` |

先按 qembian 的 `sources.lock` 验证四个 Symbian Foundation 源码提交、工具归档及 libgcc 辅助文件。CORE、V05、C01 三份固件文件使用计划中的摘要，另可导入同一归档里的 `RM356_31.0.008_020_xxx_U01.uda.fpsx`，SHA-256 为 `04072dad58a5a01c794955dda3f0cebf24008612c185930290cb0d3c22775ba7`。[qembian 源码锁定文件](https://github.com/emgfc/qembian/blob/aae8b5f4ecf4fccacac91b2b93a6a24df586d9bb/sources.lock) · [固件摘要](plan/n97-plan.md#选型和对照环境) · [固件归档目录](https://firmware.center/firmware/Nokia/5800%20%28RM-356%2C%20RM-428%29/Flash%20Files/)

交互验收使用同一 Debian 云镜像发布版本的 `debian-13-genericcloud-arm64-20261001-2618.qcow2`，SHA-512 为 `d8470b8c6c38fead046c794b5800a5a7b96672d5bcf543cc230ceb0c4b8ace05ed341a0c8928045422243fde26b2f1f2f58e99244c65709ffda2e3d4b674dd5a`。用 Apple Hypervisor Framework 运行该 Linux 虚拟机，分配六核和 5 GiB。重编译相同的 Syborg QEMU 11.1.3，给 `scripts/build-qemu-modern.sh` 设置 `SYVG_CXX=g++` 以使用 ARM64 编译器的默认位宽。复用 x86-64 生成并核验过摘要的客体镜像。

## 构建步骤

在干净的 qembian 副本中准备锁定输入。构建前把 `patches/qemu-baseport/` 下各补丁以及其引用的 `external/oss.FCL.sf.adapt.Qemu/` 源文件从 CRLF 统一为 LF。补丁 `0020-nvmemory-reopen-geometry-unsupported-requests.patch` 的删除侧有一行 `-// Instance parameters, overridable so that a second NVMemory device (syborg-pg: the N95 E: drive,`，把该行的 `syborg-pg:` 改为 `qembian:`，使它与先应用的 0006 补丁匹配。独立重放该系列后，`baseport/syborg/fb/syborg_fb.cpp` 和 `baseport/syborg/mednvmemory/syborg_mednvmemory.cpp` 的 SHA-256 分别为 `0fae52de88a9bffc7fa4d60818a0cc8eb5da2f3716e3172cc0f012c7228100dd` 和 `fc3825ae4ba4d3d44b77fb8e83fe79de0780375d7e3659ffec678b7ec2191a28`。

在 `scripts/build-standins.sh` 的 AWK 程序里跳过原 `time=` 行，并在输出 `romname=` 后输出 `time=16/09/2009 00:00:00.0`。这样混合 XIP 的时间戳取自固件标注日期。两次组装均使用该设置。[rombuild 时间格式](https://github.com/SymbianSource/oss.FCL.interim.SFTools.LinuxBuild/blob/5da968bda7c82d2e7cb5392a40447a2523eac077/imgtools/romtools/group/release.txt)

```bash
device=nokia-5800-rm356@31.0.101
python3 -I tools/fw/store.py import /path/to/firmware
python3 -I tools/fw/inventory.py --device "$device"
python3 -I tools/device.py drive-image "$device" --kind nvmem --out C-factory-seed.img

scripts/build-qemu-modern.sh
scripts/setup-epocroot.sh
export CONTAINER_ARGS='--network none -e MAKEFLAGS=-j4'
scripts/build-hosttools.sh

kernel=build/epocroot/sf/os/kernelhwsrv/kernel/eka/kernel
maps=()
for mapping in personalities/*/exec.map; do
    personality=${mapping%/exec.map}
    maps+=("${personality#personalities/}=$mapping")
done
python3 -I tools/personality/gen_exec_map.py "$kernel/execs.txt" "$kernel/execpers_map.h" "${maps[@]}"
scripts/build-kernel.sh
python3 -I tools/device.py build "$device" --kernel --out ROM.img
```

如果只构建 QEMU 的 ARM 系统模拟器，配置生成后可执行 `ninja -C build/qemu-modern/build qemu-system-arm`，并在启动时把 `SYBORG_QEMU` 指向该目录的 `qemu-system-arm`。组合工具把 ROFS 写成 `ROM.img.rofs`。设备树和组合清单用 `tools/device.py paths "$device" dtb` 和 `tools/device.py paths "$device" manifest` 定位。

## 参考产物

| 文件 | 字节数 | SHA-256 |
| --- | ---: | --- |
| `ROM.img` | 45060096 | `977483ad88275c596570a74c4cc4b8ba1a0b387eee58460b401f8968d00bf90c` |
| `ROM.rofs` | 96337920 | `526d6370802739af79cda1855c5d32f48958ecd76f86b9ad6adc8c50eebdb9bf` |
| `syborg.dtb` | 2533 | `cbb986294b68586d85d3d2c6dca82e3d3f4f6001a143bd9f8cb4b22618ba8714` |
| `C-factory-seed.img` | 90316800 | `677adef8b0567d754a9f66e4accae829324ebbfe1a15443ba241f55dc794ab4a` |
| `C-blank-seed.img` | 67108864 | `3b6a07d0d404fab4e23b6d34bc6696a6a312dd92821332385e5af7c01c421351` |
| `hybrid-manifest.txt` | 109769 | `c2b191d508a322e33565d9bf0dda9b897da9470bcf353dbdc35456d863284b94` |

ROM 链接地址为 `0x80000000`，根目录位于 `0x82af6c68`，`efile.exe` 的目录项为 `0x82ae5ff8`。`SYBROFS` v2 的表头位于物理地址 `0x60000000`，三层 ROFS 对应本地驱动号 9、10、11，其内容摘要分别与固件提取所得的三层 ROFS 一致。

## 启动参数和交接

以 `-M syborg -cpu arm1136-r2 -m 172M` 启动，显式传入设备树，使用 360×640 framebuffer、`-nic none` 和 `syborg-gl.backend=off`。复位 PC 为 `0x00000000`。执行启动存根后在 `0x00010000` 交接，ROM 的首条指令分支到 `0x00010200`。交接时 `R0/R1/R3/SP/LR` 均为 0，`R2=0x05600000`，`CPSR=0x400001d3`（ARM SVC）。设备树同时由平台设备从 `0xC0012000` 提供。

| 首批设备访问 | 物理地址 | 宽度 | 值 |
| --- | --- | ---: | --- |
| 读取平台 RAM 容量 | `0xC001100C` | 4 | `0xAC` |
| 读取 UART ID | `0xC0006000` | 4 | `0xC51D0001` |
| 写入中断控制器 | `0xC000000C` | 4 | `0` |

最先记录的 CPU 异常是正常 IRQ。原厂 `sospmmhandler.exe` 因缺少 PMM 分区报告 `SosPmmHandler -5`，启动继续进入 EStart、Starter 和文件服务器。在 Apple Silicon 上用软件模拟的 Debian x86-64 环境做交接和早期设备采样。出厂盘种子的两次测试在开机画面后遇到 AlarmServer 相关内核异常。空白盘配合 `-icount shift=5,align=off,sleep=on` 启动到地区选择界面。两组测试保存了日志和画面。[qembian 的 5800 启动记录](https://github.com/emgfc/qembian/blob/aae8b5f4ecf4fccacac91b2b93a6a24df586d9bb/docs/devices/nokia-5800-rm356/bring-up.md)

## 交互与持久化验收

在 Debian ARM64 上通过 qembian 的普通启动脚本启用软件显示。用 `SYBORG_UDA=0` 生成新实例的空白 64 MiB `C:`，并为该实例准备 FAT32 `E:`。`ROM.img.rofs` 指向上表的只读 `ROM.rofs`。从同一目录启动，第二次保留 `C.img`。TOML 配置和模拟设备响应使用固定提交的原始配置。

```bash
device=nokia-5800-rm356@31.0.101
export SYBORG_QEMU="$PWD/build/qemu-modern/build/qemu-system-arm"
test -e ROM.img.rofs || ln -s ROM.rofs ROM.img.rofs
if ! test -e C.img; then
    SYBORG_UDA=0 python3 -I tools/device.py drive-image "$device" --kind nvmem --out C.img
fi
if ! test -e E.img; then
    truncate -s 1G E.img
    mkfs.fat -F 32 E.img
fi

scripts/run-modern.sh --device "$device" --dtb syborg.dtb \
    --qmp phone.qmp --serial-log serial.log --nvmem C.img --nvmem2 E.img \
    ROM.img -nic none -global syborg-gl.backend=off
```

1. 触摸选择地区，确认日期和时间，进入 360×640 原厂 S60 主屏。
2. 用 F8 对应的菜单键打开菜单，触摸打开 Applications 和原厂应用。File manager 显示内部盘和存储卡，执行复制时返回了应用列表。持久化验收随即改用原厂 Notes。
3. 在 Notes 中选择 New note，用屏幕数字键盘输入 `580026`，按 Done 保存，核对列表的内容。
4. 退出 Notes，用 QMP `quit` 结束模拟器进程。保留 `C.img`，把 `E.img` 换成空白 FAT32 存储卡。启动全新的 QEMU 进程，进入显示 Offline 的原厂主屏，再用菜单键和触摸进入 Notes，读到 `580026`。

本地 `build/syborg-s0/reference/` 保存镜像与组合清单，`build/syborg-s0/preflight/` 保存构建输入记录，`build/syborg-s0/run-arm64/` 保存启动参数、串口记录、`note-saved.png`、`cold-screen.png` 和 `cold-note-readback.png`。保存后、冷启动前的 `C.img` SHA-256 为 `8aaad5540f4f7aee89f685f3a507bdc4b431051de9ce23c0a463cfad52b6bca7`。

## S1 本地导入

产物格式为 `v86-symbian-syborg` 版本 1，固件配置为 `nokia-5800-rm356` / `31.0.101`。`manifest.json` 记录每个文件的名称、大小和 SHA-256，并包含原厂文件摘要、qembian 提交、`sources.lock` 摘要、组合清单、CPU、内存、客体 ABI、ROFS 层序、盘符和 `C:` 种子。构建严格使用上文的依赖、补丁和时间戳。保留组合工具输出的 `hybrid-manifest.txt`，供本地核对生成目录和原始固件。

在 qembian 工作目录完成上面的构建后，把 `ROM.img`、`ROM.img.rofs`、设备树和组合清单放到一个本地目录。v86 导入使用下列名称。

| 文件 | 用途 |
| --- | --- |
| `ROM.img` | EKA2、Syborg BSP、替代驱动及原厂用户态的混合 XIP |
| `ROM.rofs` | 原 `ROM.img.rofs`，SYBROFS v2 格式，`Z:` 的 ROFS1/2/3 分别对应本地驱动 9/10/11 |
| `syborg.dtb` | 参考机型的设备树 |
| `C-blank-seed.img` | 默认 64 MiB 空白种子，通过 `SYBORG_UDA=0 python3 -I tools/device.py drive-image "$device" --kind nvmem --out C-blank-seed.img` 生成 |
| `C-factory-seed.img` | 可选出厂种子，通过上文带 UDA 的命令生成。S0 的交互验收使用空白种子 |
| `hybrid-manifest.txt` | qembian 生成的组合清单 |
| `manifest.json` | v86 生成的导入清单 |

在 v86 仓库运行下列命令。`firmware` 校验原厂 CORE、V05、C01 和存在的 UDA。`manifest` 在全部校验通过后写入清单。要选择出厂种子，可在 `manifest` 命令末尾加 `--factory-seed`。向 `verify` 提供原厂目录会同时比对 CORE 和组合清单。

```bash
firmware=/path/to/firmware
artifacts=build/syborg-s0/reference
node tools/symbian/syborg.mjs firmware "$firmware"
node tools/symbian/syborg.mjs manifest "$firmware" "$artifacts"
node tools/symbian/syborg.mjs verify "$artifacts" "$firmware"
node tests/symbian/syborg_import.mjs "$artifacts"
```

浏览器构造参数约定见 [代码级启动约定](plan/n97-plan.md#代码级启动约定) 和 [`V86SyborgOptions`](../v86.d.ts)。`symbian.manifest`、`rom`、`rofs` 和 `devicetree` 接受 URL 或 `{ buffer: ArrayBuffer }`。`nvmemory` 对应本地驱动 1，为每台 VM 单独从选定的 `C:` 种子建立可写磁盘。`nvmemory2` 对应可移除的 `E:`（本地驱动 2）。省略此描述符时，v86 提供一张空白的 1 GiB 临时卡，只有改写的扇区占用宿主内存。`D:` 是客体临时存储（本地驱动 0）。持久盘用 `disk_option: "read_write"`，冷启动时重挂同一盘。启动校验以只读产物为准，盘种子摘要用于新建实例时的导入校验。

### 镜像检查结果

两个 S0 构建的参考文件生成相同的清单。原厂 CORE 去分页后的 SHA-256 为 `7e5c51639926d9f9e6ade21f46c1aed4950a56592e669aceb1e4e65548133ea5`。混合 ROM 的 `0x80286DD0` 到 `0x825FD000` 与该 CORE 逐字节相同。目录将 2,017 个原厂文件保留在原链接地址，其中包括原厂 EUser 和文件服务器，另外列出 38 个替代或配置文件。2,055 个目录路径指向 1,995 个独立的可执行镜像及其他文件。异常查找表有 1,958 个代码起始地址和一个尾界。

链接检查确认导出表和依赖指针的边界，并检查文件、目录和异常查找表的地址范围。原厂存在多个文件名指向同一个镜像的条目，具有相同的地址、大小和属性。EUser 保留原地址的 2,259 个导出槽。沿原厂保留镜像扫描 ARM 的绝对跳转导入桩，77,867 个导入桩与 EUser 导出的目标匹配，涉及 1,570 个序号。多个序号可共用目标地址，计数包含对应的全部序号。

负例检查覆盖缺件、固件或清单版本错误、摘要不匹配、清单文件路径越界、ROFS 层顺序错误、ROM 地址重叠和无效导出序号。空白种子流程使用有 UDA 和无 UDA 两种输入复测，出厂种子通过产物校验。

### sym94 ABI 核对

解包的原厂 EUser 指令区起始地址为 `0x8028A998`，SHA-256 为 `3952090365629b2ad9deacd335a19e126fa6113fcf5e1c88a0ea70cd007f9de0`，组合后内容相同。扫描可识别的 ARM SVC 指令，共 280 个位置，其中快速调用 28 个，慢速调用 252 个。用原厂 `ekern.exe` 核对慢速表及以下 copy-in 常数，慢速表地址为 `0x8005F384`、表头计数为 246。表中调用号对应同一份 EUser 中观察到的 SVC。检查方法见 [sym94 执行调用映射](https://github.com/emgfc/qembian/blob/aae8b5f4ecf4fccacac91b2b93a6a24df586d9bb/personalities/sym94/exec.map) 和 [固件内核 copy-in 检查](https://github.com/emgfc/qembian/blob/aae8b5f4ecf4fccacac91b2b93a6a24df586d9bb/tools/personality/exec_sizes.py)。

| 功能 | 原厂调用号 | 接口核对 |
| --- | --- | --- |
| 进程加载和启动 | S97 `ProcessCreate`、S98 `ProcessLoaded` | 原厂内核处理函数使用 `0x208` 字节。ROM 的 personality 字段为 3，混合内核从启动日志所示的 `472+44` 字节计算拷贝长度 |
| 线程创建与启动 | S68 `ThreadCreate`、S28 `ThreadResume` | `ThreadCreate` 的原厂内核处理函数可见 `0x30` 字节的 copy-in 常数 |
| 块分配 | S6B `ChunkCreate`、S6C `ChunkAdjust` | `TChunkCreate` 为 `0x18` 字节，包含 `iClearByte` |
| 计时器 | S35 `TimerCancel`、S36 `TimerAfter`、S37 `TimerAt` | `TimerAt` 从引用读取 8 字节时间值，qembian 的 shim 转为内核所用的两个 32 位值 |
| LDD/PDD | S81 `DeviceLoad`、S82 `DeviceFree`、S83 `ChannelCreate`、S0A `ChannelRequest` | 原厂通道创建处理函数可见 `0x10` 字节 copy-in 常数。客体驱动处理请求及异步完成 |
| IPC 完成 | S25 `SessionSend`、S4D `SessionSendSync`、S42 `MessageComplete`、S43 `MessageCompleteWithHandle`、SA6–SA8 描述符访问 | 会话提交、消息完成、带句柄完成和描述符拷贝使用原厂编号，执行由客体内核负责 |

`0x208` 是原厂拷贝长度，混合内核按 `iFlags` 偏移截断进程附加字段。S0 使用该内核完成两次冷启动，日志记录为 `Symbian 9.4 exec personality enabled (28 fast, 243 slow; loader structs 472+44)`。S1 沿用这套已通过启动的内核。S2/S3 的运行对照继续检查实际驱动请求、取消和错误路径。[sym94 内核补丁](https://github.com/emgfc/qembian/blob/aae8b5f4ecf4fccacac91b2b93a6a24df586d9bb/personalities/sym94/patches/0014-sym94-personality.patch) · [计时器兼容补丁](https://github.com/emgfc/qembian/blob/aae8b5f4ecf4fccacac91b2b93a6a24df586d9bb/personalities/sym92/patches/0005-exec92-timerat-by-reference.patch)

原厂调用检查可在完成固件 inventory 的 qembian 工作目录重复执行。第二条命令读取同一份 `core-flat.img` 和 `core.json`，打印原厂慢速表及所选调用的候选 copy-in 常数。

```bash
python3 -I tools/fw/probe.py --device nokia-5800-rm356@31.0.101 stubs
PYTHONPATH=tools/personality python3 - /path/to/core-flat.img /path/to/core.json <<'PY'
import sys
from exec_sizes import kernel

table, count, sizes = kernel(*sys.argv[1:])
print(hex(table), count)
for call in (0x37, 0x68, 0x6b, 0x83, 0x97, 0x98):
    print(f"S{call:02X}", [hex(size) for size in sizes[call]])
PY
```

## S2 v86 板级验收

`symbian-syborg` 通过普通 `new V86(...)` 接入单核 ARM1136 r0p2，默认启用现有 ARM 页 JIT，可用 `disable_jit: true` 走解释器。加载经过 S1 校验的产物后才发出 `emulator-loaded`。从物理地址 `0x0` 执行 S0 的 ARM 启动存根，以 `CPSR=0x400001D3` 和 `R2=0x05600000` 交接到 `0x00010000`。R2 指向按 172 MiB RAM 调整的启动设备树。平台窗口 `0xC0012000` 提供原始设备树。CTR 使用 qembian 补丁中的 `0x1D992992`。未修补的 QEMU 默认值会在 EKA2 的 `InternalCache::Init1` 触发故障。[qembian ARM1136 缓存类型修复](https://github.com/emgfc/qembian/blob/aae8b5f4ecf4fccacac91b2b93a6a24df586d9bb/patches/qemu-modern/0002-arm1136-cache-type.patch)

中断控制器以最低编号的已使能中断驱动 CPU IRQ，定时器以 100 kHz 计数。串口使用现有的 `serialN-output-byte` 事件。软件 framebuffer 通过 DisplayHub 输出，触控坐标使用 360×640 逻辑屏幕，`symbian_send_key` 接收 8 位客体扫描码。ROFS 是独立的只读物理窗口。NVMemory 以 512 字节扇区在共享 RAM 和块设备之间传输，并在读取状态时撤销 IRQ。首次开源 BSP 对照从 `0xC0010060` 读取盘容量，确认寄存器布局是每项间隔 16 字节。平台的关机和重启寄存器接入 CPU 生命周期。快照在恢复前比对启动清单和盘身份，保存中断、计时与输入队列，并沿用块后端对在途 I/O 的等待。[Syborg 板级接口](https://github.com/emgfc/qembian/tree/aae8b5f4ecf4fccacac91b2b93a6a24df586d9bb/src/qemu-syborg/hw/arm)

用 S0 的锁定环境运行 `scripts/build-syborg.sh udeb`。将开源诊断镜像 `build/epocroot/epoc32/rom/syborg_tshell_ARMV5_udeb.img` 放到 v86 的本地产物目录。验收使用的镜像 SHA-256 为 `8ac75e4b7327ca17a1c86d2cc49c74244a36ee7fec5718940e21227f39defa96`。在固定 QEMU 上用同一设备树和空白 C:、E: 盘启动后，串口记录 EStart 属性 `1020e34e = 65535` 及 `Thread svphostfs.exe::Main Killed -44`。v86 在解释器和 JIT 下都到达同样的两个标记。另一个从仓库汇编构建的诊断通过了启动寄存器、ARM/Thumb、MMU 别名、非对齐读、SVC、定时器 IRQ 和返回、UART 收发、旋转画面像素、按键与触摸队列、ROFS 写入保护、NVMemory 读写、客体重启及快照恢复。

混合镜像在解释器和 JIT 下均从 S0 的同一组文件冷启动，依次记录三层 `SYBROFS`、原厂 `EStart.exe` 和 `Thread efile.exe::CFat32BitCachePopulator_drv_4 Killed -39`。达到文件服务器标记约需 4.65 亿条客体指令，独立复测中 JIT 编译 624 次，解释器编译次数为 0。串口记录及本地固件留在被忽略的 `build/syborg-s0/`。

S2 的 Chrome 发布构建 CPU Worker 加载 S0 产物，以一份空白种子建立独立的 OPFS `C:`，从画布读到 360×640 framebuffer 并核实盘写入。文件服务器启动后，串口记录了未定义指令异常 `ExcCode 00000002`，当时 `R15=0x827135BC`、`DFAR=0xEE070F90`。S3 修复了这个异常，并扩展同一浏览器测试以复测整个路径。[更新后的浏览器复测命令](#s3-浏览器内的原厂主屏)

```bash
make build/v86-arm64.wasm build/libv86.mjs
artifacts=build/syborg-s0/reference
open_rom=build/syborg-s0/diagnostic/syborg_tshell_ARMV5_udeb.img
node tests/symbian/syborg_board.mjs "$open_rom" "$artifacts/syborg.dtb"
node tools/symbian/boot-syborg.mjs "$artifacts"
node tools/symbian/boot-syborg.mjs "$artifacts" --interpreter
```

## S3 浏览器内的原厂主屏

S2 的首个启动异常在两种执行方式下都发生于 `KASYBORG.DLL` 的空闲路径。ROM 虚拟地址 `0x827135BC` 的指令字 `0xEE070F90` 是 ARM1136 的 `MCR p15, 0, r0, c7, c0, 4`（Wait For Interrupt）。该操作现在通过现有的 CPU 等待和唤醒路径执行。合成板级客体安装了未定义指令失败处理程序，并让实际 Syborg 定时器唤醒 CPU，核对 IRQ 应答及返回。使用同一 S0 混合镜像复测，解释器和 JIT 均在执行约 4.75 亿条指令后到达 `System start ok`。[ARM1136 技术参考手册 DDI 0211I](https://documentation-service.arm.com/static/5e8e4306fd977155116aade2) · [qembian ARM1136 BSP 补丁](https://github.com/emgfc/qembian/blob/aae8b5f4ecf4fccacac91b2b93a6a24df586d9bb/patches/qemu-baseport/0011-cpu-arm1136.patch)

在 `System start ok` 之后，SAServer 和 ETel 通过原有 ISC 客体驱动查询 SIM、无线状态及设备属性。Syborg 的两个离线邮箱位于 `0xC0019000` 和 `0xC001B000`，使用 IRQ 15、16。立即应答由客体在发送路径中收取。静音 DSP 周期借助客体时钟延后完成，并触发邮箱中断，直到客体取走待处理帧。每个端口保留至多 64 个接收帧和 16 个延迟应答，溢出帧被丢弃。关闭或复用 ISC 句柄会清除该句柄未收取的帧和待完成请求。SIM 接收通知的取消由客体驱动处理。浏览器串口复核 `09 EF` 无 SIM 指示、`0A 01` 无服务登记应答和 `F3 35` DSP 周期完成。合成测试另核对队列上限、端口隔离、取消、复位和带待完成请求的状态恢复。该配置使用离线网络和静音 DSP。[qembian 邮箱协议](https://github.com/emgfc/qembian/blob/aae8b5f4ecf4fccacac91b2b93a6a24df586d9bb/src/qemu-syborg/hw/arm/syborg_modem.c) · [ISC 客体驱动](https://github.com/emgfc/qembian/blob/aae8b5f4ecf4fccacac91b2b93a6a24df586d9bb/src/standins/_shared/iscpeer.inl) · [RM-356 应答](https://github.com/emgfc/qembian/blob/aae8b5f4ecf4fccacac91b2b93a6a24df586d9bb/models/nokia-5800-rm356/isi-replies.txt)

邮箱为 Syborg 设备布局版本 2 增加了待传输帧、虚拟时钟期限和句柄状态。S2 的布局版本 1 快照需要从持久 `C:` 冷启动。

测试页面从空白 OPFS `C:` 启动，经地区、日期和时间向导进入原厂主屏。页面比较实际 360×640 画布与 S0 参考画面的固定区域，并等待客体主屏进程发布 `101f8766/43 = 101` 后发送菜单键。菜单和应用文件夹的检测包含图标区域，确保目标图标显示后才触摸。测试用 `EStdKeyApplication0`（`0xB4`）打开菜单，触摸选择 Applications 和原厂 Notes，并操作原厂软键退出 Notes 和菜单。第二次创建 CPU Worker 时重新打开同一 `C:`，在主屏复测同一流程。[RM-356 键位表](https://github.com/emgfc/qembian/blob/aae8b5f4ecf4fccacac91b2b93a6a24df586d9bb/models/nokia-5800-rm356/keymap.toml)

本地 Chrome 158 发布构建中，首次启动在 62.7 秒进入地区向导，95.9 秒进入主屏，107.7 秒打开菜单，114.4 秒进入 Notes，124.9 秒返回主屏。沿用同一 `C:` 的冷启动在 67.4 秒直接进入主屏，88.2 秒打开菜单，95.3 秒进入 Notes，107.6 秒返回主屏。计时均从各自 Worker 的构造开始，包含测试输入和画面确认。两次启动都记录了文件服务器挂载、系统启动、窗口服务器和 Uikon 服务，各收到一次无 SIM 指示、两次无服务登记应答和 110 次静音 DSP 完成。串口和实际画面保存在本地 `build/syborg-s0/s3-browser-full/`，其中包括 `cold-home.png`、`cold-menu.png`、`cold-notes.png` 和 `cold-home-return.png`。

未启用截图记录的默认测试也通过。首次启动在 98.7 秒进入主屏，冷启动在 60.5 秒进入主屏，两次均在客体主屏进程发布状态后按菜单键，完成 Notes 的启动与退出。该次日志保存在本地 `build/syborg-s0/s3-browser-no-capture-final.log`。

```bash
make build/v86-arm64.wasm build/libv86.mjs
artifacts=build/syborg-s0/reference
node --test tests/symbian/syborg_modem.mjs
node tools/symbian/boot-syborg.mjs "$artifacts" --system-start
node tools/symbian/boot-syborg.mjs "$artifacts" --system-start --interpreter
TIMEOUT_MS=430000 node tests/app/browser_runner.mjs tests/symbian/syborg_browser.html
TIMEOUT_MS=430000 TEST_ARTIFACT_DIR=build/syborg-s0/s3-browser-full \
  node tests/app/browser_runner.mjs tests/symbian/syborg_browser.html capture=1
```

## S4 原厂 SIS 安装

v86 Notes 1.0 和 2.0 沿用仓库内的签名包，包 UID、E32 UID3 和安全 ID 均为 `0xE0860505`，目标是 S60v5 产品 UID `0x1028315F`，两版都没有额外能力。原厂 SDK 的构建方法、包和摘要见 [Notes 构建记录](symbian-n97.md#原生-sissisx-递送与-v86-notes)。两版同用一张 RSA/SHA-1 自签名证书，有效期为 UTC 2026-11-18 06:29:23 至 2036-11-15 06:29:23。

从两份签名包提取实际 E32 导入节，按库名和序号查 S0 组合 ROM 的 XIP 导出表，排除空项和缺失导出占位。两版分别解析 59 和 60 项，包括 `efsrv.dll` 11 项、`euser.dll` 18 或 19 项、`gdi.dll` 2 项和 `ws32.dll` 28 项。qembian 组合清单用 `N95` 标记原厂侧。在 RM-356 配置中，`Z:` 的这四个文件路径均从 5800 固件的原厂 XIP 解析。

```sh
SYBORG_ROM=build/syborg-s0/reference/ROM.img node --test tests/symbian/sis.mjs
```

实际固件的 `Z:\System\Data\swipolicy.ini` 包含 `AllowUnsigned = false`、`SISCompatibleIfNoTargetDevices = false`、`OcspEnabled = true` 和 `OcspMandatory = false`。原厂 Application manager 的 **Installation settings** 显示 **Software installation: All**、**Online certificate check: Off** 和 **Default web address: None**。验收保留这些出厂值和原厂证书库。首次向导的默认日期是 2009 年，完整验收中用同一 `C:` 冷启后主屏显示 2026-11-22，位于测试证书有效期内。[Nokia 5800 用户指南，第 92–94 页](https://manuals.plus/m/658c640e14a6ed88eb809cd64af58c6718be9e1087c555f112df186702fae509.pdf)

Chrome 和参考 QEMU 从 `E:` 直接打开测试包时，File manager 均提示 **Unable to open. File type not supported.**。Chrome 在证书有效期内也重现该提示。QEMU 的硬件断点确认该操作未进入原厂 SIS 识别函数或安装界面入口。在客体 File manager 里把原包从 `E:` 复制到 **C: Phone mem.** 的 **Root folder** 后，实际路径为 `C:\Data\V1.SIS`。复制件的 SHA-256 与签名包一致。Chrome 在同一开机期间选中刚复制的文件，再用页面的 **Enter** 按钮打开，进入原厂 **v86 Notes 1.00(0)** 安装确认和自签名警告。另一轮冷启动曾对之前复制的文件报类型不支持，因此每个待安装的包在当前开机期间复制。

2026-11-22 的 Chrome 发布版验收使用 `build/syborg-s0/reference/` 的 S0 产物和空白 OPFS `C:`。原厂安装器取消 1.0 后，盘上无 Notes 安装文件或登记。再次打开并安装后，从 **Applications** 启动 1.0，输入并保存 `580086`。结束 Worker 2 后用同一 OPFS 卷启动 Worker 3，从菜单打开 1.0，读回同一标记。复制 `V2.SIS` 后，原厂安装器显示从 1.00(0) 替换为 2.00(0)，升级后从菜单打开 2.0，仍显示 `580086`。两份 `C:\Data\V*.SIS`、存储卡上的包和仓库夹具逐字节一致。

只读盘检查核对 `C:\sys\bin\v86_notes.exe`、两个应用注册资源、`C:\sys\install\sisregistry\e0860505` 中的原厂记录，以及 `C:\private\e0860505\note.txt`。两版的可执行文件和记录中的已签名控制器与各自的包一致。原厂 **Installed applications** 卸载后列表为空，磁盘读回确认删除安装文件、登记和私有笔记。随后从菜单启动原厂 **Calendar**，退出并返回主屏。该次运行的串口日志与界面截图位于本机的 `build/syborg-s0/s4-final/`。

### 复现

准备 S0 产物和发布版浏览器构建。用 FAT32 裸卷递送两个仓库签名包。`.SIS` 文件名用于递送，保留原 SISX 字节。

```sh
make build/libv86.mjs build/cpu-worker.js build/v86-arm64.wasm
mkdir -p build/syborg-s0/s4-acceptance
card=build/syborg-s0/s4-acceptance/E.img
truncate -s 67108864 "$card"
mkfs.fat -F 32 -n V86S4 "$card"
mcopy -i "$card" tests/symbian/fixtures/notes-v1.sisx ::V1.SIS
mcopy -i "$card" tests/symbian/fixtures/notes-v2.sisx ::V2.SIS
python3 -m http.server 8000 --bind 127.0.0.1
```

macOS 上可用 `/sbin/newfs_msdos -F 32 -S 512 -s 131072 -v V86S4 "$card"` 代替 `mkfs.fat`。用独立的临时 Chrome 配置文件打开 [S4 验收页面](http://127.0.0.1:8000/tests/symbian/syborg_sis.html)。页面核对两份包的全部字节，然后创建独立 OPFS `C:` 和 `E:`。关闭并移除该临时浏览器配置文件即可清理验收用盘。

1. 完成首次开机向导。若出现 **Welcome**，选 **No**。用 **Cold reopen same C: disk** 新建 Worker，等主屏显示 **Offline** 和日期，确认客体日期在证书有效期内。若首次按 **Menu** 没有响应，在主屏停留片刻再按一次。
2. 从 **Menu → Applications → File mgr.** 打开存储卡。选中 `V1.SIS`，选 **Options → Organise → Copy to folder → C: Phone mem. → Root folder → Copy**。回到 File manager 的手机内存，选中复制件并按页面的 **Enter**。
3. 在原厂安装确认界面选 **Cancel**，用 **Check Notes is absent** 核对正式安装文件和登记。重新打开包，确认版本，接受该测试包的自签名警告，然后选择 **C: Phone mem.** 安装。
4. 从 **Applications** 中启动带拼图图标的 **Notes**，输入 `580086`，用页面的 **Save (F2)** 保存，随后按 **Escape** 退出。用 **Check Notes 1.0 and saved text** 核对正式登记、E32 文件和应用私有数据。用 **Cold reopen same C: disk** 创建新 Worker，从手机菜单重新启动应用并核对读回。
5. 在当前开机期间用同一方法把 `V2.SIS` 复制到手机内存并打开。确认原厂升级提示，再启动 v86 Notes。检查它显示 2.0 和原标记，随后用 **Check Notes 2.0 and saved text** 核对盘上记录。
6. 从 **Menu → Settings → Application mgr. → Installed apps.** 选 v86 Notes 并执行 **Options → Uninstall → Yes**。卸载结束后，用 **Check Notes is absent** 核对磁盘，再从 **Menu** 启动 **Calendar**，退出并返回主屏。

## S5 浏览器中的 Nokia 5800

在 Chrome 158.0.8127.36 发布构建中，从 **New virtual machine → Symbian → S60v5 → Nokia 5800 (RM-356)** 选择 S0 产物目录。Worker 校验 manifest、混合 ROM、ROFS、设备树、C: 种子和构建清单。浏览器保存四个只读启动文件和这台虚拟机的独立 C:。实测选取缺件目录会报出缺少的文件，取消创建后可以用同一文件夹重试。机器库、设置、控制台和递送窗口显示固件版本 `31.0.101`。

原厂 Menu、触摸和首次开机向导在正式应用中运行。失焦和指针取消释放已按下的键和触摸。接听、菜单、挂断、音量和相机键使用 RM-356 的 `keypad_exp.dll` 矩阵。锁开关使用 `switch.dll` 的 `EStdKeyDeviceF`（`0xB3`），控制台的短按会发送至少 220 毫秒的锁开关脉冲。原厂钥匙图标亮起时，Menu 不能打开应用菜单，再拨一次恢复。两次操作均等待原厂钥匙图标确认。Media 使用 `exyin.dll` 触键区的 `EStdKeyDevice27`（`0xF0`），打开原厂 Media bar。拍摄半按为 `0xE2`，全按为 `0xAB`。电源键发送 `EStdKeyDevice2`，控制台的 **Power → Power off** 提供实测的关机路径。[S60 按键常量](https://katastrophos.net/symbian-dev/GUID-C6E5F800-0637-419E-8FE5-1EBB40E725AA/GUID-2DD6456C-7BE2-3A55-8DAF-CE413CC28A8A.html)

1. 用 `make app build/v86-arm64.wasm` 构建，在本机打开 `index.html`。选择 `build/syborg-s0/reference/`，创建并启动 5800，完成首次开机向导。
2. 在控制台选 **Send SIS/SISX**，添加 `tests/symbian/fixtures/notes-v1.sisx`。保存客体中的工作到 C:，选择 **Save card and power off**，再开机。临时 E: 由该虚拟机独享的持久 FAT16 递送卡接替。
3. 退出首次启动的 **Welcome** 和设置向导。在 **Menu → Applications → File mgr.** 中将 `E:\INSTALL\PKG00001.SIS` 通过 **Options → Organise → Copy to folder → C: Phone mem. → Root folder → Copy** 复制。选中 C: 上的副本，点控制台 **Open selected file**，在原厂安装器确认签名测试包并选择 C:。
4. 启动 **Applications** 中拼图图标的 **Notes**。聚焦手机屏幕，输入 `580086`，触摸 **Save**。关机，刷新机器库并启动同一虚拟机，再次打开 Notes 核对原文。保持 Notes 开着，从 **Power → Suspend** 挂起，并从机器库恢复，核对同一个 Notes 界面及标记。

本地 Chrome 验收确认卡中的包与签名夹具逐字节一致，原厂安装登记与 C: 上的文件一致。冷启和挂起恢复均显示 `580086`。第二台同固件 VM 的 C: 保持其初始内容，原 VM 的递送卡未出现在第二台。屏幕截图位于 `build/syborg-s0/s5-app/`（递送、安装、保存和恢复）与 `build/syborg-s0/s5-controls-observe/`（锁开关和 Media bar）。

[应用验收页面](../tests/app/syborg_test.html) 自动检查缺件、取消重试、两台机器、触控、按键和挂起，原厂复制、安装与 Notes 操作由操作者完成。空白 C: 已通过完整验收，重复首次启动时曾在主屏出现后等待 Menu 超时。单独复测按键时使用 S4 导出的 `build/browser-test-output/syborg-s4-stock-notes-v1-C.img`。测试把这份盘的副本写到刚创建的虚拟机，并用原厂锁图标和菜单画面验证按键响应。

```sh
BROWSER_FOCUS=1 node tests/app/browser_runner.mjs tests/app/syborg_test.html part=controls prepared=1
```

## S6 Syborg EGL 和 WebGPU

在 5800 的 **Symbian firmware** 设置中为单台虚拟机选用 **WebGPU acceleration**。API 接收 `symbian.webgpu: true`。默认使用软件显示。浏览器找不到 WebGPU 适配器时，CPU Worker 仍可冷启动并操作原厂系统。启用时保留软件 framebuffer，并另建一个 WebGPU 设备供 EGL/GLES 使用。

### 客体接口与固件 ABI

固定的 qembian 5800 配置使用 `gpu = "none"`，S0 混合 XIP 仍含其开源 `d_display.ldd`。该驱动已提供 `0x7f10` 能力查询和 `0x7f11` 命令及结果复制。v86 在 `0xC000F000` 实现这两个控制所用的 Syborg 寄存器。驱动以调用者进程 ID 提交物理 RAM 中的请求和响应缓冲，各限 1 MiB。v86 只接受特权 MMIO，核对进程和 EGL 会话，每个会话只保留一个待回读请求，最后一个驱动通道关闭时释放该进程的对象。用独立的轮询与取数步骤等待 WebGPU 回读。客体包采用独立实现的 `VGL1` 协议，命令只复用仓库已有 GLES 编码，RenderControl 上下文和颜色缓冲句柄由设备创建并保留。[5800 配置](https://github.com/emgfc/qembian/blob/aae8b5f4ecf4fccacac91b2b93a6a24df586d9bb/models/nokia-5800-rm356/model.toml) · [DisplayDriver 控制接口](https://github.com/emgfc/qembian/blob/aae8b5f4ecf4fccacac91b2b93a6a24df586d9bb/src/standins/d_display/d_display.cpp)

原始 RM-356 XIP 中的图形 DLL 模块版本均为 `0x000A0000`。`libGLES_CM.dll` 有 175 个导出，合并早期 EGL 和 GLES 1.x。分开的 `libEGL.dll` 和 `libGLESv1_CM.dll` 分别有 270 和 252 个导出。原厂 S60v5 SDK 的 `libgles_cm.dso` 对应合并 DLL。核对了 EGL 的 `eglChooseConfig` 1、`eglCreateContext` 3、`eglCreateWindowSurface` 6、`eglGetDisplay` 14、`eglInitialize` 17、`eglMakeCurrent` 18 和 `eglSwapBuffers` 22，以及 GLES 1.x 的 `glColor4f` 38、`glDrawArrays` 54、`glGetError` 68、`glMatrixMode` 90、`glReadPixels` 108 和 `glTexImage2D` 125。该 XIP 和 S60v5 SDK 没有 GLES 2.0 系统 DLL 和导入库。S6 测试程序静态链接仓库中的客体适配层，提供一致的窗口表面、配置查询、上下文创建与绑定、交换和销毁。原厂 DLL 及其导出保留在固件中，原厂游戏的导入和扩展留到各游戏样本验收。

S6 EGL 配置为 RGBA8888、24 位深度、无多重采样，用 CPU Worker 的共用 GLES 主机创建真实 1.1 或 2.0 上下文。浏览器从 WebGPU 读取 `eglSwapBuffers` 的颜色缓冲后，按自顶向下的行序把 RGBA 交还客体。客体将每行像素转换为原厂 Font and Bitmap Server 支持的 32 位位图并画入自己的 `RWindow`。窗口服务器负责裁剪、遮挡和焦点，DisplayHub 提交最终画面。应用失焦时停画，GLES API 的 `glReadPixels` 保留左下角原点。GPU 丢失后应用报告 `EGL_CONTEXT_LOST`，软件窗口仍能重绘。

S5 的软件快照可在相同固件和软件后端恢复。WebGPU 快照要求原有后端可用，保存 Syborg 寄存器和共用 GLES 状态。活跃 EGL 会话期间保存会返回明确错误，退出应用后可保存。持久的 C: 和 E: 与 CPU Worker 的后端选择独立。

### 可复现构建与实测

```sh
make build/v86-arm64.wasm build/libv86.mjs build/cpu-worker.js build/v86-gles.js glbridge
probe=build/syborg-s0/s6-probe
sh tools/symbian/gles-probe/build.sh <symbian-platform-sdk> <S60v5-epoc32> <makesis> <signsis> "$probe"
cp build/browser-test-output/syborg-s4-stock-notes-v1-C.img "$probe/C.img"
truncate -s 67108864 "$probe/E.img"
/sbin/newfs_msdos -F 32 -S 512 -s 131072 -v V86S6 "$probe/E.img"
mcopy -i "$probe/E.img" "$probe/v86_gles.sisx" ::EGL.SIS
BROWSER_DEBUG_PORT=23961 BROWSER_FOCUS=1 TIMEOUT_MS=1800000 TEST_ARTIFACT_DIR="$probe" \
  node tests/app/browser_runner.mjs tests/symbian/syborg_gles.html webgpu=1
```

命令用无头 Chrome 验收，可通过调试端口操作该测试页。手动复现时可用 `python3 -m http.server 8000 --bind 127.0.0.1` 启动站点，再在独立 Chrome 配置中打开 `/tests/symbian/syborg_gles.html`。测试页将 C: 和 E: 分别复制到当前标签页独享的 OPFS 路径。

使用 symbian-platform SDK 0.3.0 ARM64、原厂 S60v5 导入库及可运行的 MakeSIS 和 SignSIS。两次独立构建产生相同的 E32 可执行文件，SHA-256 为 `022909c3b1e2029a6dee1274e73013b9079bba9ddf06724c645085ac32593c51`。测试证书每次生成，实测 SISX SHA-256 为 `8ab379bf1d29ecbb8dca41d8978bafe4a978bd68c357589250414ce8c38ff82d`。包 UID 为 `0xE0860506`，零能力。可执行文件的 68 个导入均在同一份混合 XIP 中核对。应用和适配层源码位于 `tools/symbian/gles-probe/`，驱动来自原有 S0 混合镜像。保持原厂软件安装设置和证书库。

1. 在测试页面等原厂主屏就绪，从 **Menu → Applications → File mgr.** 进入 E:。选择 **EGL.SIS → Options → Organise → Copy to folder → C: Phone mem. → Root folder → Copy**。在同一开机期间选中 C: 的复制件，用 **Enter** 打开，接受测试证书并安装到 C:。
2. 从原厂 **Applications** 启动 **v86 EGL**。应用先绘制 ES 1.1 场景。等 **Readback 0** 和 **Swaps** 数值增长，在页面开发者工具运行 `await s6.measure_scene()`。触摸应用底部的 **ES 2.0**，再次核对读回和持续出图。
3. 用 **Menu** 将原厂菜单置于 GPU 窗口前，检查菜单覆盖窗口并停止交换。退出后重新打开探针，确认再次绘制。在探针前台时点测试页面的 **Lose WebGPU device**，确认收到 `EGL_CONTEXT_LOST`，再用探针的 **Exit** 返回原厂菜单和主屏。
4. 用 `gpu=off` 复测软件桌面和输入。验证无适配器路径时在测试参数加入 `gpu=unavailable seed=fallback`。测试的 `C-fallback.img` 取自 S4 卸载后测试盘的副本，`E-fallback.img` 是只含已签名 Notes 1.0 的递送卡。可用 S4 的 FAT32 制卡命令，也可用应用的 FAT16 递送卡流程。沿用 S4 步骤完成安装、启动和保存。

Chrome 158.0.8127.36 发布版使用 Apple M1 Pro 的 Metal 适配器。两种场景均绘制 192×144 窗口，绘制四象限最近邻纹理、半透明前景，并由深度测试挡住后方的图元。两者的客体回读与浏览器画布采样均为 `E62814 0AD21E 143CF0 E6D214 7D3282 143CF0`。ES 1.1 首次采样得到 42 次交换、126 次绘制和 48 次 WebGPU 回读。切换到 ES 2.0 后约 6 秒得到该上下文 48 次交换，累计 546 次绘制和两次着色器转换。两次采样中 WebGPU 执行器均无拒绝或错误。窗口被原厂菜单覆盖后，两次间隔 2.1 秒的采样停在同一交换计数 299。连开两个探针时各有自己的 GPU 会话，关掉前台实例后只余一条隐藏会话，新实例仍可持续绘制。

复测用两个各 2.3 秒的独立区间，每个场景新增 19 次交换和 57 次 WebGPU 绘制，六像素全部一致。显式销毁 WebGPU 设备后，主机累计停在 251 次交换和 753 次绘制，活跃会话归零。客体收到十进制 `12302`，即 `EGL_CONTEXT_LOST`。应用退出并返回原厂主屏，物理 Menu 键再次打开完整菜单，触摸进入 Applications。实测日志和截图保存在本机 `build/syborg-s0/s6-probe/`。关闭 WebGPU 时，CPU Worker 冷启动到原厂主屏，用 Menu 键和触摸进入 Applications。请求 WebGPU 但无适配器时，CPU Worker 同样完成主屏和输入验证，并通过原厂签名安装器安装 Notes、运行和保存 `580086`。关机后核对 C: 上的登记、包字节和应用私有数据。

## S7　从原厂菜单验收原生 3D 游戏

### Bantumi GL 2.05 · OpenGL ES 1.1

Bantumi GL 是 Martin Storsjö 发布的 GPL 游戏，支持 Nokia 5800 触摸屏。原包 `bantumigl-2.05.sisx` 的 SHA-256 为 `5b94321c78c60b9c39cc009aa2888f011a41dc0df9c76f2083e7f8f575845592`，`bantumi-2.05.tar.gz` 的 SHA-256 为 `cc3828ae4c7732b51abd8451a8760183728c326fc63fe27fff8041d3888ae838`。[发布页与源码](https://www.martin.st/software/)

原签名有效期为 2007-05-25 到 2017-05-22。原厂安装器在当前 RTC 下报告 `Expired certificate`，通过 Clock 修改界面日期后仍是同一错误。使用普通开发证书重新签名的包经过了原厂安装器的自签名警告、能力授权、C: 目标选择及安装登记。原包与验收包中相同的 E32 文件 SHA-256 为 `bac3b2ace3aba09e599ab3955653f39966988ce6aa77f2de9dbe181e25d4fad6`，UID 和安全标识均为 `0xf0273929`。验收包 SHA-256 为 `72340d5b5eecc4bab64fa3e7a25796bf9a1e1ac532e4adefd486c0432b3a5216`，测试证书有效期从 2026-11-22 04:26:05 UTC 到 2036-11-19 04:26:05 UTC。固件继续执行原厂证书和能力检查。

`build-legacy-rom.sh` 从经过摘要核对的 S0 XIP 另建可选图形镜像。在 `0x80260000` 的空闲 XIP 区域置入 ARM 客体驱动，连接 `libGLES_CM.dll` 的 58 个 EGL/GLES 入口。入口先核对进程的安全标识和 DisplayDriver 的 WebGPU 可用性。其他进程和软件模式继续执行该入口的原指令。输出目录的 `graphics-rom.json` 记录入口序号、替换前后的指令和镜像摘要。GLES 包含客户端顶点、法线、颜色和纹理坐标数组，按实际索引范围复制数据，支持固定点变换、光照、透明纹理和带深度的索引绘制。360×640 交换缓冲通过本地 `RChunk` 分配，适配原应用的 1 MiB 堆上限。客体将 WebGPU 读回的位图画入应用的 `RWindow`，由原厂窗口服务器合成。

```sh
games=build/syborg-s0/s7-games
sh tools/symbian/gles-game/build-legacy-rom.sh <symbian-platform-sdk> <S60v5-epoc32> \
  build/syborg-s0/reference "$games/firmware"
cp build/browser-test-output/syborg-s4-stock-uninstalled-C.img "$games/C.img"

# 从作者的原包生成原厂安装器可在当前 RTC 下检查的签名副本。
# 使用有效期包含虚拟机当前日期的普通 RSA 自签名测试证书。
signsis -u "$games/bantumigl-2.05.sisx" "$games/bantumigl.unsigned.sis"
signsis -s "$games/bantumigl.unsigned.sis" "$games/bantumigl-current.sisx" test.pem rsa.key
node --input-type=module - "$games/bantumigl-current.sisx" "$games/E.img" <<'JS'
import { readFile, writeFile } from 'node:fs/promises';
import { make_sis_card, sis_card_files } from './src/symbian/sis_card.js';
const [input, output] = process.argv.slice(2);
const packages = await sis_card_files([new File([await readFile(input)], 'Bantumi.sisx')], undefined, 'E');
await writeFile(output, new Uint8Array(await make_sis_card(packages, 0x53701358, true).arrayBuffer()));
JS
BROWSER_FOCUS=1 BROWSER_DEBUG_PORT=23971 TIMEOUT_MS=1800000 TEST_ARTIFACT_DIR="$games" \
  node tests/app/browser_runner.mjs tests/symbian/syborg_gles.html webgpu=1 game=bantumi
```

1. 从 **Menu → Applications → File mgr. → E: → INSTALL** 选中 `PKG00001.SIS`，经 **Options → Organise → Copy to folder → C: Phone mem. → Root folder → Copy** 复制。返回 File Manager 的盘符页，在同一开机期间进入 C:，选择复制件后按 **Enter**。安装器依次显示 `Bantumi GL`、`2.05(0)`、自签名警告、C: 目标及原应用的连接和网络能力提示。按原厂软键确认后，串口的 InstallServer 记录了 UID `0xf0273929` 和成功状态。
2. 返回 **Applications**，向下移动焦点直至 **BantumiGL** 图标可见，选中图标并按 **Enter**。在标题界面发出 `EStdKeyDevice3`，扫描码 `0xA7`。画面进入默认棋盘，可见受光的棋碗、被碗壁部分遮挡的棋子、3D 手形和纹理数字。稍候轮到己方，按右方向键切换棋碗，再按 `0xA7` 播种。实测一个蓝色棋碗从 5 变为 0，邻碗从 5、5、4 变为 6、6、5。无额外输入时在控制台运行 `await s6.measure_game("gles1", 8000)`。测试页可用 `await s6.key(167)` 发送上述选择键。
3. 在棋盘按实体 **Menu** 回到 **Applications**。遮挡后的两次采样相隔 2.9 秒，交换计数均为 3,366，仍有一条会话。再从同一图标进入，棋盘保留当前棋子分布，交换计数增至 3,427。右软键 `0xA5` 回到游戏标题，在标题按两次向下、一次向右和 `0xA7` 选择 **Exit**。应用退出后回到 **Applications**，图形会话归零。再次从图标启动后重现标题和默认棋盘。第二次正常退出后按原厂软键返回主屏。

Chrome 158.0.8127.36 在 Apple M1 Pro Metal 适配器上用 CPU Worker 实测。默认棋盘在 8.003 秒内完成 103 次交换及 2,080 次 WebGPU 绘制。交换间隔中位数 77.05 ms，P95 为 83.50 ms。交换回读往返中位数 4.30 ms，P95 为 5.80 ms，总回读量 94,924,800 字节。客体执行片段耗时 6,170.70 ms，退休约 5.46 亿条 ARM 指令。GPU 路径发生 104 次队列提交，主线程在提交调用中耗时 2.40 ms。104 次缓冲映射的等待时间累计 260.00 ms。这些时间取自主机时钟。采样没有失败的交换、执行器拒绝或 WebGPU 错误。

重开后的第二次采样持续 8.004 秒，完成 105 次交换及 2,100 次绘制。交换间隔中位数 76.00 ms，P95 为 80.50 ms。交换回读往返中位数 4.20 ms，P95 为 5.30 ms，总回读量 96,768,000 字节。客体执行片段耗时 6,097.80 ms，退休约 5.54 亿条 ARM 指令。105 次 WebGPU 队列提交耗时 2.00 ms，缓冲映射等待累计 258.90 ms。

该样本使用窗口表面，扩展字符串为空。样本范围包括固定点变换、客户端索引数组、Alpha 字形纹理和深度遮挡。Pixmap、Pbuffer、多 EGL 上下文及联机玩法未验收。游戏启动时读取受保护属性触发两条 `ReadDeviceData` 日志，原厂权限检查后仍进入棋盘。视频画面、原厂安装器截图、原始测量和复测步骤留在被忽略的 `build/syborg-s0/s7-games/`。

### ClassiCube · OpenGL ES 2.0 构建的装载诊断

基于 ClassiCube 的 S60v5 源码和项目自带的 GLES 2.0 渲染器构建，复用官方发布包的应用资源、图标及纹理包。原厂安装器安装了验收包，原厂 Applications 菜单显示游戏图标。早期构建的进程创建返回 `KErrNotSupported`（-5）。独立签名的诊断包用 `RProcess::Create` 检查 36 个场景，成功创建的子进程在恢复运行前关闭。只导入无版本后缀的 `drtaeabi.dll` 或 `eikcore.dll` 的样本各自返回 -5，其余单库样本及大代码段无导入对照均通过。`drtaeabi` 的 ELF 导入项含高位地址修正量，版本兼容性检查使用了整个导入字。`eikcore` 的四个实际导出后一槽为空，版本兼容性检查和最终 ELF 重定位采用不同的导出表下标。

为 21 个依赖库填入与 RM-356 固件匹配的模块版本和标识后，原厂菜单启动构建 `1.3(14)`，串口确认 `C:\sys\bin\ClassiCube.exe` 的代码、数据及入口已装载。该构建随后在启动阶段触发 `KERN-EXEC 3`。崩溃指令位于 `drtaeabi.dll` 的 `__cxa_allocate_exception`，访问尚未初始化的线程 C++ 异常全局状态。原厂 SDK 的 `CallThrdProcEntry` 在进入应用前构造 `TCppRTExceptionsGlobals`。此处记录的是补上线程初始化前的复测结果，只验证了安装和装载。诊断输出及崩溃寄存器保存在 `build/syborg-s0/s7-review/`。[ClassiCube 源码](https://github.com/shinovon/ClassiCube/tree/548296423b9c716c0a6ee3530dd1dabd9b17340b) · [qembian 的原生启动对照](https://github.com/emgfc/qembian/blob/aae8b5f4ecf4fccacac91b2b93a6a24df586d9bb/tools/probes/cf/cfprobe.cpp)

补齐线程初始化后的 `1.3(16)` 由原厂安装器安装并打开。首次启动完成字体缓存，选择 **No** 跳过联网资源，然后选择 **Classic** 和 **Singleplayer**。测试使用作者的 [提交源码归档](https://codeload.github.com/shinovon/ClassiCube/tar.gz/548296423b9c716c0a6ee3530dd1dabd9b17340b) 和 [S60v5 安装包](https://nnproject.cc/cc/)。构建脚本校验两者的摘要，从原包读取注册资源、图标和纹理。脚本为生成的测试包使用普通测试签名。

```sh
games=build/syborg-s0/s7-games/classicube
sh tools/symbian/gles-game/classicube/build.sh <native-sdk> <S60v5-epoc32> \
  <ClassiCube-source.tar.gz> <author.sis> <makesis> <signsis> "$games"
cp build/browser-test-output/syborg-s4-stock-uninstalled-C.img "$games/C.img"
node --input-type=module - "$games/ClassiCube.sisx" "$games/E.img" <<'JS'
import { readFile, writeFile } from 'node:fs/promises';
import { make_sis_card, sis_card_files } from './src/symbian/sis_card.js';
const [input, output] = process.argv.slice(2);
const packages = await sis_card_files([new File([await readFile(input)], 'ClassiCube.sisx')], undefined, 'E');
await writeFile(output, new Uint8Array(await make_sis_card(packages, 0x58000710, true).arrayBuffer()));
JS
BROWSER_FOCUS=1 BROWSER_DEBUG_PORT=23969 TIMEOUT_MS=1800000 TEST_ARTIFACT_DIR="$games" \
  node tests/app/browser_runner.mjs tests/symbian/syborg_gles.html webgpu=1 game=classicube
```

`1.3(17)` 用同一 EGL 上下文重建同尺寸窗口表面。ClassiCube 的界面和地形资源耗尽了最初的 32 个纹理名称，复测记录了 `glGenTextures` 被拒绝。将每会话的纹理对象限制提高到 128 后，发布版的离线单人场景显示完整的树叶、泥土、岩石、水面和界面纹理，近处方块正确遮挡远处场景。

在 Apple M1 Pro 上以 Chrome CPU Worker 路径测量，湖边初始视角在 8.005 秒内完成 119 帧和 21,301 次 WebGPU 绘制。帧间隔中位数为 63.40 ms，P95 为 79.40 ms。交换回读的中位数为 4.30 ms，P95 为 7.30 ms，读回约 109.67 MB。客体 CPU 执行耗时 6,346.90 ms，退休约 4.87 亿条 ARM 指令。119 次队列提交的调用开销合计 2.30 ms，GPU 读回映射的等待累计 267.30 ms。该区间没有失败的交换或 WebGPU 错误。

实体右方向键和数字 **2** 改变了视角和位置。游戏内 **Game menu** 暂停后，以右软键恢复到原位置。切到原厂 **Applications** 后，约 3.5 秒内仅交换 3 帧。用实体 **Menu** 长按唤出的任务切换器返回游戏，画面保持原位置并恢复正常更新。测试场景通过游戏的 **Save level** 保存，可以从 **Load level** 重新打开。

原厂任务切换器的 **Exit ClassiCube?** 确认后，WebGPU 会话归零，总计 3,229 次交换且没有失败。再次从 **Applications** 启动，进入 **Singleplayer → Game menu → Load level**，选中保存的 `jt7.cw`，读回相同的湖边地形并继续用新会话绘制。复测 8.006 秒，完成 122 帧。帧间隔中位数为 62.10 ms，P95 为 76.20 ms。最终构建也复测了 Bantumi GL 的启动和棋盘纹理。

### 用户提供的安装包兼容性检查

| 安装包 | SHA-256 | 只读检查结果 |
| --- | --- | --- |
| Assassin's Creed HD 1.00(9) | `53111a6c922e95a0dff814927273034ed6fada941c129d4affdf3ebfdcab6408` | SIS 控制器 CRC 一致，数据区 CRC 声明为 `0xfdb2`，复算为 `0xeb8c`。随包的 Gameloft Ovi 叶证书于 2016-12-31 到期。未确认可执行文件的图形 API。 |
| Asphalt 4 1.0(2) | `f497bae3e27e8ef31160de8d6741018f244008bd9cda8d77dfad28c7ea573890` | 旧版 EPOC SIS，声明依赖 Nokia 6630 及旧版 Series 60 产品 UID。安装目标为 EKA1 ARMv4 `.app`。导入表与代码字符串未发现 EGL 或 GLES。 |
| Prince of Persia HD 1.0(5) | `73b0f30baf185a2756e780df208c0dafdfa68f4ecb41b1eb83706c4a9c767e20` | 包内 79 个文件通过摘要检查，控制器签名可用随包叶证书公钥验证。唯一声明设备为 Sony Ericsson Idou（Satio，`0x2001f0a1`），叶证书于 2019-07-24 到期。EKA2 ARM EABI 可执行文件导入原厂位图及窗口库，导入表与解压后的代码字符串未发现 EGL 或 GLES。 |

《波斯王子》额外通过 5800 原厂安装器试装，安装器报失败并返回文件管理器。其余两份只做静态检查。这三份样本均未计入 S7 的 GPU 验收。试装沿用原厂安装策略和原始安装包。
