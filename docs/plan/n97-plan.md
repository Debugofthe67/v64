# Symbian S60v5（EKA2 + Syborg）实施计划

2026-11-20 起，v86 的 Symbian 开发主线采用开源 EKA2、Syborg 虚拟板和原厂 S60v5 用户态。首个固件配置选用 Nokia 5800 XpressMusic（RM-356）`31.0.101`。首轮目标是在浏览器离线冷启动到 S60 主屏，使用触摸和按键，完成自编 SIS/SISX 的安装、运行、保存、升级和卸载。随后接入 WebGPU，用原生 S60v5 3D 游戏验收图形兼容性与性能。

此前的 N97 硬件工作作为 Syborg 实施的参考。S0–S7 全部通过后，S8 从当前分支移除 `nokia-n97` 机型、RAPIDO ROM 兼容实现和 RM-505 整机引导代码。旧计划、技术记录和源代码可从 Git 提交 `4d3311a5b` 查阅。S0 已完成 qembian 对照验收。[S0 复现记录](../symbian-syborg-reference.md)

## 选型和对照环境

以 qembian 提交 `aae8b5f4ecf4fccacac91b2b93a6a24df586d9bb` 的 QEMU 系统模式作为对照，在其已测试的 Linux x86-64 环境中按 `sources.lock` 构建。上游记录显示，5800 `31.0.101` 已到达主屏、菜单和触摸输入，也记录了 ARM1136 对齐设置导致的菜单故障及修复。v86 复用自身的 ARM 执行器，在设备层实现 Syborg 接口。将同一份混合镜像与盘种子用于两边的启动对照。[qembian 架构与构建](https://github.com/emgfc/qembian/blob/aae8b5f4ecf4fccacac91b2b93a6a24df586d9bb/README.md) · [5800 启动记录](https://github.com/emgfc/qembian/blob/aae8b5f4ecf4fccacac91b2b93a6a24df586d9bb/docs/devices/nokia-5800-rm356/bring-up.md)

首轮用户态取自以下固件文件。按文件名和摘要识别变体，生成镜像时也记录各 ROFS 层的顺序与摘要。有匹配 UDA 时，可用它初始化新实例的 `C:`。首个对照环境采用哪一种 `C:` 种子在 S0 确定并记录。[原厂文件摘要](https://github.com/emgfc/qembian/blob/aae8b5f4ecf4fccacac91b2b93a6a24df586d9bb/README.md#firmware) · [31.0.101 固件配置](https://github.com/emgfc/qembian/blob/aae8b5f4ecf4fccacac91b2b93a6a24df586d9bb/models/nokia-5800-rm356/firmware/31.0.101/firmware.toml)

| 固件文件 | SHA-256 |
| --- | --- |
| `RM-356_31.0.101_prd.core.C00` | `bffaa4b9fb0e727934aa1ffb55ed48f98403f767227f4c746dc27cfe5ea834fb` |
| `RM-356_31.0.101_prd.rofs2.V05` | `671054fe238ca5634b493f898ad1e415760c5b3b0fdc148c67af61c3fcb23812` |
| `RM-356_31.0.101_C01_prd.rofs3.fpsx` | `1ce5ca18b5f923b64d10318a52fc61999e338f525d781692ea5611fff7407c1e` |

## 机器设计

| 层 | 实施方案 |
| --- | --- |
| 机器和 CPU | 新增 `machine_type: "symbian-syborg"`，由固件配置选板参数。首个配置以 qembian 的单核 `arm1136-r2` 为参考，核对 MIDR、CP15、MMU 和非对齐访问后决定复用或扩展 v86 的 ARM1136 配置。 |
| 启动 | 执行含开源 EKA2 和 Syborg BSP 的混合 XIP。复现对照环境的入口、物理装载地址、初始寄存器、设备树、RAM、只读 ROFS 窗口和平台配置。ROM 链接地址依固件头核对。 |
| 内核 ABI | 使用 `sym94` 对接 Symbian 9.4 的 EUSER 调用。核对执行调用编号和参数、加载器结构大小、导入序号、句柄、描述符和 IPC 行为。 |
| 系统服务 | 保留原厂文件服务器、窗口服务器、S60 库、桌面和应用。由客体 Syborg BSP 及替代驱动承接启动和交互所需的板级请求，覆盖异步完成、取消及错误。离线模式验证无网状态和相关请求的正常收尾。 |
| 板级设备 | 以参考 BSP 和实际 MMIO 轨迹核对中断控制器、定时器、RTC、串口、平台寄存器、framebuffer、指针键盘及 NVMemory 的访问宽度、时序、IRQ 和复位语义。 |
| 显示与输入 | 首轮采用软件绘图，客体 framebuffer 经 DisplayHub 进入浏览器画布。以 360×640 竖屏校验触摸坐标和画面方向，控制台按 5800 的按键布局和固件键位表发送客体输入。 |
| 3D 加速 | WebGPU 作为按虚拟机选择的宿主后端。Syborg 客体通过 EGL/OpenGL ES 接入 v86 的共用 GLES 执行器，输出与软件 framebuffer 共同呈现。软件绘图是离线桌面和安装验收的基线。 |
| 存储 | `Z:` 由混合 XIP 和三层 ROFS 提供，`C:` 由 NVMemory 提供实例独享的可写卷。首个配置按参考映射接入临时 `D:` 和可选的 `E:` 卡，盘符与容量由固件配置描述。 |

表中的装载条件以 S0 采集的对照数据为准。Syborg 原始 BSP 与 qembian 的现代 QEMU 板级实现提供核对依据。[Symbian Foundation 的 Syborg BSP](https://github.com/SymbianSource/oss.FCL.sf.adapt.Qemu/tree/master/baseport/syborg) · [qembian Syborg 板级源码](https://github.com/emgfc/qembian/blob/aae8b5f4ecf4fccacac91b2b93a6a24df586d9bb/src/qemu-syborg/hw/arm/syborg.c) · [sym94 ABI 记录](https://github.com/emgfc/qembian/blob/aae8b5f4ecf4fccacac91b2b93a6a24df586d9bb/personalities/sym94/README.md)

### 代码级启动约定

以下是拟新增的浏览器 API。示例启动已在本地构建的 Nokia 5800（RM-356）`31.0.101` 混合镜像。首次启动前，调用方从盘种子为这台 VM 创建 `C:` 文件。重开同一台 VM 时使用同一个 OPFS 路径。

```js
const vm = new V86({
    cpu_type: "arm32",
    cpu_profile: "arm1136-r2",
    machine_type: "symbian-syborg",
    cpu_worker: true,
    graphics_adapter: "none",
    net_device: { type: "none" },
    screen_container: document.getElementById("screen"),
    autostart: false,
    symbian: {
        manifest: { url: "./5800/manifest.json" },
        rom: { url: "./5800/ROM.img" },
        rofs: { url: "./5800/ROM.rofs" },
        devicetree: { url: "./5800/syborg.dtb" },
        nvmemory: {
            url: "opfs:v86/disks/5800-vm1-c.img",
            disk_option: "read_write",
        },
    },
});

vm.add_listener("emulator-loaded", () => vm.run());
```

- `cpu_profile: "arm1136-r2"` 选用 Syborg 对照机的 ARM1136 r0p2。省略时，`symbian-syborg` 会自动选择该配置。
- `manifest` 标识机型、固件版本和产物格式，提供各只读文件的大小和 SHA-256。v86 据此选择 CPU、RAM 和板级配置，并在启动前校验传入的产物。`rom` 是本地组装的混合 XIP，包含开源 EKA2、Syborg BSP 和原厂用户态模块。`rofs` 是按固件顺序合并的只读分区。`devicetree` 提供 Syborg 平台设备树。示例用本地站点的文件 URL，浏览器文件夹导入也可传入 `{ buffer: ArrayBuffer }`。
- `nvmemory` 是 `C:` 的可写介质。需要 `E:` 时，按同样的磁盘描述提供可选 `nvmemory2`。浏览器新建向导和程序化调用使用同一套构造参数。
- qembian 使用 ARM 启动存根，混合 XIP 的物理装载地址为 `0x00010000`，ROFS 只读窗口从 `0x60000000` 开始，设备树由平台设备在 `0xC0012000` 提供。v86 从所选配置取得装载条件。S0 记录首次取指地址、CPU 模式及寄存器交接，S2 对照实现。[qembian Syborg 板级源码](https://github.com/emgfc/qembian/blob/aae8b5f4ecf4fccacac91b2b93a6a24df586d9bb/src/qemu-syborg/hw/arm/syborg.c#L1-L32)
- 镜像校验和机器初始化完成后触发 `emulator-loaded`。示例随后调用 `run()` 开始执行。客体继续启动后，S60 主屏经 Syborg framebuffer 输出到 `screen_container`。可按虚拟机启用 `symbian.webgpu: true`。[WebGPU 接入与运行条件](../symbian-syborg-reference.md#s6-syborg-egl-和-webgpu)

### 混合镜像和存储

在本地构建开源内核、BSP 和替代驱动，用固件提取的原厂用户态组合混合 XIP，并生成一个可导入目录。保留原厂用户模块的链接地址和导入关系，检查模块范围、ROM 目录、异常查找表和 ROFS 合并顺序。把必要的配置差异和修补逐项记录在构建清单中，附原始文件摘要和回归场景。系统应用仍在客体中执行 ARM 代码并通过 EKA2 发起系统调用。[Symbian Foundation EKA2 源码](https://github.com/SymbianSource/oss.FCL.sf.os.kernelhwsrv) · [qembian 镜像组合工具](https://github.com/emgfc/qembian/blob/aae8b5f4ecf4fccacac91b2b93a6a24df586d9bb/tools/romcompose.py)

导入目录包含混合 XIP、只读 ROFS、板级描述和驱动兼容版本、磁盘种子及清单。清单记录固件标识、镜像版本、文件大小和摘要、构建来源、CPU 与盘符映射。首次建机时为每台 VM 生成独立的可写盘，后续冷启动重挂同一份持久介质。快照保存机器配置、镜像指纹、可写介质身份和设备状态，包括待处理 IRQ、计时器、输入队列和 NVMemory 请求。恢复时先核对这些标识。

### 3D 图形路径

固定的 qembian 5800 配置声明 `gpu = "none"`。S0 以该配置复现软件绘图，S6 在同一 S60v5 用户态上验证新增的 3D 路径。先从固件和拟测应用核对 EGL/GLES 的 DLL 导入、导出序号和调用约定，再选择可复用的客体适配层。实现 EGL 配置查询、上下文与表面绑定、`eglSwapBuffers` 及与窗口服务器的交接，能力报告由实际实现决定。[5800 固件机型配置](https://github.com/emgfc/qembian/blob/aae8b5f4ecf4fccacac91b2b93a6a24df586d9bb/models/nokia-5800-rm356/model.toml) · [qembian 的 Syborg 图形设备](https://github.com/emgfc/qembian/blob/aae8b5f4ecf4fccacac91b2b93a6a24df586d9bb/src/qemu-syborg/hw/arm/syborg.c) · [Khronos EGL](https://www.khronos.org/egl/)

S6 用现有 Syborg DisplayDriver 的复制控制把调用送至 CPU Worker，并复用 `src/gles/` 的状态、命令批次、着色器转换和 WebGPU 执行器。客体在交换窗口表面时读回颜色缓冲并提交位图，由原厂窗口服务器处理位置和遮挡，DisplayHub 继续显示最终画面。适配器不可用时直接使用软件桌面。GPU 设备丢失时让应用收到 EGL 上下文丢失错误，软件窗口和输入继续工作。[v86 共用 GLES 代理](gles-proxy-plan.md) · [S6 传输与画面验证](../symbian-syborg-reference.md#s6-syborg-egl-和-webgpu)

首轮 3D 验收覆盖 OpenGL ES 1.1 固定功能与 OpenGL ES 2.0 可编程着色器。按游戏实际使用的纹理格式、扩展和 EGL 能力补齐兼容性。测试清单标明原生 GLES、J2ME/M3G 或私有接口等运行依赖，以便定位无法启动的游戏。[Khronos OpenGL ES 规范](https://registry.khronos.org/OpenGL/index_es.php)

### 浏览器入口和 5800 按键

在 S5 把新建虚拟机的 `Symbian → S60v5 → Nokia N97` 入口替换为 `Symbian → S60v5 → Nokia 5800 (RM-356)`，绑定 `symbian-syborg` 和 `31.0.101` 固件配置。保留单一的文件夹选择入口。向导、库卡片、详情、固件设置、控制台及 SIS 递送界面从所选配置读取机型名和固件版本。

5800 控制台在屏幕下方提供接听、菜单、挂断键，另提供电源、音量增减、屏幕与按键锁、媒体触控键和拍摄键。拍摄键区分半按与全按。用 5800 控件替换 N97 的滑盖和 QWERTY 面板。文字输入使用客体提供的屏幕键盘。按键事件从机型配置映射到 Syborg 输入，核对 RM-356 固件的扫描码及事件语义。qembian 键位表用于比对，媒体键、锁键和拍摄全按等仍需用固件或客体事件确认。失焦、指针取消和挂起时释放已按下的键及触摸。[Nokia 5800 用户手册](https://one.nz/MEDIA_CustomProductCatalog/m1550043_Nokia_5800_Userguide.pdf) · [qembian 5800 键位表](https://github.com/emgfc/qembian/blob/aae8b5f4ecf4fccacac91b2b93a6a24df586d9bb/models/nokia-5800-rm356/keymap.toml)

### 仓库落点

- ARM 执行、MMU、异常、JIT 和 Worker 沿用现有 ARM32 入口。Syborg 设备模型接入 `src/arm/` 与 `src/symbian/`，用独立的机器配置注册。
- FPSX、ROM、ROFS、摘要和目录预检优先复用 `src/symbian/` 中的通用逻辑。首个固件配置按 RM-356 验证，S8 移除 RM-505 专用导入规则。
- 生命周期和快照沿用 VM 管理器，画面接 DisplayHub，虚拟输入接浏览器控制台，NVMemory 接现有块存储和 OPFS。SIS/SISX 复用本地包检查与递送逻辑，客体以自己的安装与签名策略处理安装。

### 源码和固件分发

qembian 的工具、客体内核相关代码和 QEMU 板级源码按文件适用相应许可证。记录直接引用的文件、版本、来源和许可证，开源 EKA2 与 BSP 使用独立客体构建流程，v86 侧依据设备接口实现并用对照轨迹验证。原厂固件和 SDK 由用户在本机提供，混合镜像及由它生成的磁盘和快照作为本地产物。仓库提交构建工具、配置、摘要和可分发的测试程序。[qembian 许可说明](https://github.com/emgfc/qembian/blob/aae8b5f4ecf4fccacac91b2b93a6a24df586d9bb/README.md#license)

## 阶段与验收

按顺序完成各阶段。每阶段核对通过条件，记录复现输入、命令和结果，审查通过后单独提交到 `n97` 分支。

### S0　复现 qembian 的 S60v5 基线

在 Linux x86-64 上固定 qembian、工具链和容器版本，用上述 5800 固件重建混合 XIP、ROFS 和盘种子。设备交接和早期设备访问在 x86-64 上采集，首次启动和交互使用同一 qembian 版本及同一份镜像在硬件加速的 Linux ARM64 上验收。用全新盘进入主屏，打开菜单并用触摸启动应用。复测保存文件后冷启动读回，保存有效启动参数、产物摘要、串口日志、早期设备访问、交互结果和首个异常。记录复现所需的驱动或策略差异，特别是进程退出和异步请求超时。

**通过条件**为从固定输入重复得到同一套可用产物，冷启动和交互可复现，并能将这一套字节直接作为 v86 的对照输入。

**实测通过。** 两次组装逐字节一致。以空白 64 MiB `C:` 启动到原厂主屏，通过菜单键和触摸操作原厂应用，再用原厂 Notes 保存 `580026`。换上空白 `E:` 后从同一块 `C:` 冷启动，读回记录。[构建和交互结果](../symbian-syborg-reference.md#交互与持久化验收)

### S1　稳定混合镜像的构建与导入格式

从 S0 导出固定清单，验证用户模块的链接地址、导入序号和 ROM 目录。复核 `sym94` 的关键接口，优先覆盖进程和线程创建、块分配、计时器、LDD/PDD 通道与 IPC 请求完成。用现有固件解析器识别 RM-356 的 CORE、ROFS2、ROFS3 和可选 UDA。固定 v86 导入所需的产物版本、盘符定义和 `new V86(...)` 参数。

**通过条件**为本地工具能校验固件与产物，并能识别缺件、错版本、错摘要及 ROM 地址重叠。清单足以从原始输入重复生成这套镜像。

**实测通过。** RM-356 原厂 CORE、V05、C01 和可选 UDA 通过结构和摘要检查。S0 的混合 ROM 保留原厂用户窗口的地址和字节，文件目录、异常查找表和 EUser 导入序号通过核对。用本地产物验证了缺件、错版本、错摘要和 ROM 重叠的拒绝路径。[导入工具和 sym94 复核](../symbian-syborg-reference.md#s1-本地导入)

### S2　接入 v86 的 Syborg 板级模型

先启动同一 BSP 构建的开源内核诊断镜像，沿正常入口验证 ARM/Thumb、MMU、异常、中断确认、定时器、串口和冷重启。再接 framebuffer、键盘与指针、只读 ROFS 窗口及 NVMemory。使用合成客体程序验证设备，然后通过 `new V86(...)` 执行 S0 的同一套镜像。按首个不同的 PC、异常寄存器或 MMIO 事件定位差异，验证解释器与正常 JIT 入口。

**通过条件**为开源内核能接管机器、处理中断并从 IRQ 返回，客体通过实际设备访问读写虚拟盘、接收输入和输出像素，混合镜像进入文件服务器启动路径。

**实测通过。** 同一 Syborg BSP 的开源诊断和合成设备诊断在解释器与 JIT 下通过。S0 的混合镜像以两种执行方式进入原厂文件服务器启动路径。浏览器 CPU Worker 复测了 360×640 画面和 OPFS `C:` 写入。[板级验收与复现命令](../symbian-syborg-reference.md#s2-v86-板级验收)

### S3　启动原版 S60v5 用户态并进入可操作主屏

挂载 `Z:` 和 `C:`，通过首次向导，核对文件服务器、窗口服务器、应用框架与主屏关键进程。追踪启动依赖的离线请求，验证请求完成和取消。用浏览器测试页面记录客体窗口服务器提交的画面，复测菜单动画、触摸落点、几个关键按键和切换焦点。

**通过条件**为从持久卷冷启动到由客体输出的原厂主屏，能通过触摸和按键打开菜单、启动系统应用并返回。关键服务持续存活，原版用户态的重复操作与 S0 对照一致。

**实测通过。** Chrome 发布构建使用 S0 的 RM-356 `31.0.101` 产物，从空白 OPFS `C:` 完成首次向导，随后用同一持久卷冷启动进入 360×640 原厂主屏。两次都通过客体菜单键打开菜单，触摸启动原厂 Notes 后退出并返回主屏。串口确认文件服务器、窗口服务器和应用框架启动，以及无 SIM、无服务和静音 DSP 的应答。合成诊断复测延迟完成、取消、端口隔离和状态恢复。[S3 浏览器验收与复现命令](../symbian-syborg-reference.md#s3-浏览器内的原厂主屏)

### S4　验证 SIS/SISX 的安装和持久化

运行有源码的 [v86 Notes 1.0](../../tests/symbian/fixtures/notes-v1.sisx) 和 [2.0](../../tests/symbian/fixtures/notes-v2.sisx)。现有包的导入序号已对照 RM-505 核对，在 RM-356 上先检查 UID、实际导入、签名策略和有效期，再决定复用现有包或按首个固件的导入表重新构建同一份应用。把包送入客体可访问的卷，从原生安装界面完成安装，再从客体菜单启动。qembian 调试工具的 SIS 安装记录覆盖 Belle，S60v5 的验收以实际运行结果为准。[Notes 构建记录](../symbian-n97.md#原生-sissisx-递送与-v86-notes) · [qembian SIS 工具范围](https://github.com/emgfc/qembian/blob/aae8b5f4ecf4fccacac91b2b93a6a24df586d9bb/docs/sydb.md#installing-sis--sisx-sydb-sis-install)

**通过条件**为安装 1.0 → 菜单启动 → 输入和保存 → 关机后冷启动读回 → 安装 2.0 并保留数据 → 卸载后主屏和其他应用仍可用。记录原生安装器在取消或拒绝时的结果，并核对正式安装记录与可写卷一致。

**实测通过。** 2026-11-22，Chrome 发布版使用 S0 的 RM-356 `31.0.101` 产物和同一持久 OPFS `C:` 完成整轮验收。从存储卡在客体内复制两版签名 SIS，在原厂界面完成取消、安装、升级和卸载。1.0 从菜单启动并保存 `580086`，更换 Worker 后读回，2.0 升级后保留同一标记。只读检查确认盘上已签名控制器、登记和文件符合每个阶段的结果。卸载后原厂 Calendar 可启动并返回主屏。[S4 结果与复现步骤](../symbian-syborg-reference.md#s4-原厂-sis-安装)

### S5　切换浏览器入口与控制台到 Nokia 5800

从新建向导选择 Nokia 5800，用一个文件夹入口导入本机构建目录，在 Worker 中校验内容和指纹，再保存到浏览器私有存储。建机时检查配额，支持取消和重试。换用 5800 控制台布局，连接实体键、触控、软件包递送、关机和重开。页面刷新后从库中打开同一 VM，再验证挂起恢复。

**通过条件**为新建入口选择 5800 后生成 Syborg VM，各页面显示正确机型和固件版本，按键映射在客体中产生对应的按下和释放事件。通过菜单键打开 S60 菜单，实测触摸、锁屏与解锁、失焦释放，并完成“导入 → 冷启动 → 安装 → 保存 → 刷新页面并重开 → 读回”。用第二台 VM 验证磁盘隔离。后续 S60v3 或 Symbian^3 通过独立的固件配置和 ABI 验收接入。

**实测通过。** Chrome 发布版用一个文件夹导入 S0 的 RM-356 `31.0.101` 产物，验证缺件、取消和重试。原厂主屏实测 Menu、触摸、锁定时阻拦 Menu、解锁和 Media bar，失焦及指针取消释放输入。独立的持久 E: 卡递送签名 Notes，原厂安装器安装到 C:。刷新后重开和挂起恢复均读回 `580086`，第二台 VM 的 C: 保持初始内容。[S5 操作与验收](../symbian-syborg-reference.md#s5-浏览器中的-nokia-5800)

### S6　用 WebGPU 验证 EGL 与 OpenGL ES

先用可重复构建的客体测试程序验证 EGL 窗口表面、交换和回到桌面。分别用 GLES 1.1 固定功能场景、GLES 2.0 着色器场景覆盖纹理、深度、混合和读回。核对参考像素与浏览器结果，允许记录清楚且可复现的精度差异。随后验证 GPU 模式下的图形资源恢复，以及关闭加速或适配器不可用时的主屏、输入和 Notes 安装流程。

**通过条件**为发布版浏览器的 CPU Worker 路径能让两个客体场景分别通过实际 WebGPU 提交持续出图。画面可随窗口切换正确显示，软件模式仍通过 S5 的主要用户流程。

**实测通过。** Chrome 发布版的 CPU Worker 通过 Apple M1 Pro 实际提交 GLES 1.1 固定功能和 GLES 2.0 着色器场景。两者的纹理、深度、混合像素和读回与参考一致。原厂菜单遮挡后停画，关闭并重开应用可继续出图，设备丢失后可退出到原厂主屏并继续操作。关闭 WebGPU 验证主屏、Menu 和触摸。无适配器时用原厂安装器安装 Notes 并保存，关机后读回登记和笔记。[S6 实测和复现步骤](../symbian-syborg-reference.md#s6-syborg-egl-和-webgpu)

### S7　验收真实 S60v5 3D 游戏

从用户提供的游戏包中选择与首个固件配置匹配的样本，优先覆盖 GLES 1.1 和 GLES 2.0 各一款。固定游戏版本、场景、输入步骤、浏览器和 GPU；从原生安装器安装，再从 S60 菜单启动，进入可操作的 3D 场景，检查纹理、深度遮挡、按键或触摸、暂停返回以及再次启动。

**通过条件**为实际游戏持续输出可操作画面，退出后能返回桌面，并可按固定步骤复测。记录帧时间的中位数和 P95、客体 CPU 时间、GPU 提交与回读开销；按游戏记录缺失扩展、渲染偏差和影响范围。两种 GLES 路径各有实测结果后发布兼容性结论。

### S8　移除旧 N97 硬件实现

S0–S7 全部验收通过后，删除 `nokia-n97` 的机型注册、启动和外设模型、RAPIDO ROM 兼容服务及 RM-505 专用固件导入。清理旧机型剩余的 UI、API 接线和构建配置，删除专用探针和测试。按实际调用关系保留 Syborg 或其他受支持机型复用的 ARM1136、通用固件解析、SIS 递送和测试资产。

把 Notes 等仍适用的操作和构建说明迁入 Syborg 使用文档。旧硬件的研究记录和复现工具可从历史提交查阅，现行使用说明引导用户创建 Syborg 虚拟机。清理范围限于仓库与构建产物，旧虚拟机和快照的兼容性在变更说明中明确。

**通过条件**为常规构建和运行时已解除对旧 N97 板型的依赖，Syborg 的离线冷启动、Notes 持久化与 WebGPU 游戏验收仍通过，其他机型的共用代码回归通过。
