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

Chrome 的发布构建 CPU Worker 复测见 `tests/symbian/syborg_browser.html`。页面加载 S0 产物，以一份空白种子建立独立的 OPFS `C:`，从画布读到 360×640 framebuffer 并核实盘写入。浏览器串口在文件服务器标记之后记录了未定义指令异常 `ExcCode 00000002`，当时 `R15=0x827135BC`、`DFAR=0xEE070F90`。继续启动到主屏属于 S3 的验收。

```bash
make build/v86-arm64.wasm build/libv86.mjs
artifacts=build/syborg-s0/reference
open_rom=build/syborg-s0/diagnostic/syborg_tshell_ARMV5_udeb.img
node tests/symbian/syborg_board.mjs "$open_rom" "$artifacts/syborg.dtb"
node tools/symbian/boot-syborg.mjs "$artifacts"
node tools/symbian/boot-syborg.mjs "$artifacts" --interpreter
TIMEOUT_MS=110000 node tests/app/browser_runner.mjs tests/symbian/syborg_browser.html
```
