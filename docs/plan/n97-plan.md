# Symbian S60v5（EKA2 + Syborg）实施计划

2026-11-20 起，v86 的 Symbian 开发主线采用开源 EKA2、Syborg 虚拟板和原厂 S60v5 用户态。首个固件配置选用 Nokia 5800 XpressMusic（RM-356）`31.0.101`。首轮目标是在浏览器离线冷启动到 S60 主屏，使用触摸和按键，完成自编 SIS/SISX 的安装、运行、保存、升级和卸载。随后接入 WebGPU，用原生 S60v5 3D 游戏验收图形兼容性与性能。

此前的 N97 硬件工作作为 Syborg 实施的参考。S0–S7 全部通过后，S8 从当前分支移除 `nokia-n97` 机型、RAPIDO ROM 兼容实现和 RM-505 整机引导代码。旧计划、技术记录和源代码可从 Git 提交 `4d3311a5b` 查阅。Syborg 各阶段均待本仓库实测。

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
| 显示与输入 | 首轮采用软件绘图，客体 framebuffer 经 DisplayHub 进入浏览器画布。以 360×640 竖屏校验触摸坐标、画面方向、菜单键和文本输入，支持指针取消与失焦释放。 |
| 3D 加速 | WebGPU 作为按虚拟机选择的宿主后端。Syborg 客体通过 EGL/OpenGL ES 接入 v86 的共用 GLES 执行器，输出与软件 framebuffer 共同呈现。软件绘图是离线桌面和安装验收的基线。 |
| 存储 | `Z:` 由混合 XIP 和三层 ROFS 提供，`C:` 由 NVMemory 提供实例独享的可写卷。首个配置按参考映射接入临时 `D:` 和可选的 `E:` 卡，盘符与容量由固件配置描述。 |

表中的装载条件以 S0 采集的对照数据为准。Syborg 原始 BSP 与 qembian 的现代 QEMU 板级实现提供核对依据。[Symbian Foundation 的 Syborg BSP](https://github.com/SymbianSource/oss.FCL.sf.adapt.Qemu/tree/master/baseport/syborg) · [qembian Syborg 板级源码](https://github.com/emgfc/qembian/blob/aae8b5f4ecf4fccacac91b2b93a6a24df586d9bb/src/qemu-syborg/hw/arm/syborg.c) · [sym94 ABI 记录](https://github.com/emgfc/qembian/blob/aae8b5f4ecf4fccacac91b2b93a6a24df586d9bb/personalities/sym94/README.md)

### 混合镜像和存储

在本地构建开源内核、BSP 和替代驱动，用固件提取的原厂用户态组合混合 XIP，并生成一个可导入目录。保留原厂用户模块的链接地址和导入关系，检查模块范围、ROM 目录、异常查找表和 ROFS 合并顺序。把必要的配置差异和修补逐项记录在构建清单中，附原始文件摘要和回归场景。系统应用仍在客体中执行 ARM 代码并通过 EKA2 发起系统调用。[Symbian Foundation EKA2 源码](https://github.com/SymbianSource/oss.FCL.sf.os.kernelhwsrv) · [qembian 镜像组合工具](https://github.com/emgfc/qembian/blob/aae8b5f4ecf4fccacac91b2b93a6a24df586d9bb/tools/romcompose.py)

导入目录包含混合 XIP、只读 ROFS、板级描述和驱动兼容版本、磁盘种子及清单。清单记录固件标识、镜像版本、文件大小和摘要、构建来源、CPU 与盘符映射。首次建机时为每台 VM 生成独立的可写盘，后续冷启动重挂同一份持久介质。快照保存机器配置、镜像指纹、可写介质身份和设备状态，包括待处理 IRQ、计时器、输入队列和 NVMemory 请求。恢复时先核对这些标识。

### 3D 图形路径

固定的 qembian 5800 配置声明 `gpu = "none"`。S0 以该配置复现软件绘图，S6 在同一 S60v5 用户态上验证新增的 3D 路径。先从固件和拟测应用核对 EGL/GLES 的 DLL 导入、导出序号和调用约定，再选择可复用的客体适配层。实现 EGL 配置查询、上下文与表面绑定、`eglSwapBuffers` 及与窗口服务器的交接，能力报告由实际实现决定。[5800 固件机型配置](https://github.com/emgfc/qembian/blob/aae8b5f4ecf4fccacac91b2b93a6a24df586d9bb/models/nokia-5800-rm356/model.toml) · [qembian 的 Syborg 图形设备](https://github.com/emgfc/qembian/blob/aae8b5f4ecf4fccacac91b2b93a6a24df586d9bb/src/qemu-syborg/hw/arm/syborg.c) · [Khronos EGL](https://www.khronos.org/egl/)

调用通过 Syborg 图形设备传给 CPU Worker。S6 决定设备协议如何映射到共用 GLES 代理，优先复用 `src/gles/` 的状态、命令批次、着色器转换和 WebGPU 执行器。窗口交换由客体触发，GPU 颜色缓冲经现有合成通道显示，软件 framebuffer 继续提供桌面和普通窗口画面。验证两类内容的遮挡、方向和切换，按 API 语义完成同步与必要的回读。适配器不可用时提供软件桌面，GPU 设备丢失时验证应用退出或重建上下文后的桌面恢复。[v86 共用 GLES 代理](gles-proxy-plan.md) · [WebGPU 规范](https://www.w3.org/TR/webgpu/)

首轮 3D 验收覆盖 OpenGL ES 1.1 固定功能与 OpenGL ES 2.0 可编程着色器。按游戏实际使用的纹理格式、扩展和 EGL 能力补齐兼容性。测试清单标明原生 GLES、J2ME/M3G 或私有接口等运行依赖，以便定位无法启动的游戏。[Khronos OpenGL ES 规范](https://registry.khronos.org/OpenGL/index_es.php)

### 仓库落点

- ARM 执行、MMU、异常、JIT 和 Worker 沿用现有 ARM32 入口。Syborg 设备模型接入 `src/arm/` 与 `src/symbian/`，用独立的机器配置注册。
- FPSX、ROM、ROFS、摘要和目录预检优先复用 `src/symbian/` 中的通用逻辑。首个固件配置按 RM-356 验证，S8 移除 RM-505 专用导入规则。
- 生命周期和快照沿用 VM 管理器，画面接 DisplayHub，虚拟输入接浏览器控制台，NVMemory 接现有块存储和 OPFS。SIS/SISX 复用本地包检查与递送逻辑，客体以自己的安装与签名策略处理安装。

### 源码和固件分发

qembian 的工具、客体内核相关代码和 QEMU 板级源码按文件适用相应许可证。记录直接引用的文件、版本、来源和许可证，开源 EKA2 与 BSP 使用独立客体构建流程，v86 侧依据设备接口实现并用对照轨迹验证。原厂固件和 SDK 由用户在本机提供，混合镜像及由它生成的磁盘和快照作为本地产物。仓库提交构建工具、配置、摘要和可分发的测试程序。[qembian 许可说明](https://github.com/emgfc/qembian/blob/aae8b5f4ecf4fccacac91b2b93a6a24df586d9bb/README.md#license)

## 阶段与验收

按顺序完成各阶段。每阶段核对通过条件，记录复现输入、命令和结果，审查通过后单独提交到 `n97` 分支。

### S0　复现 qembian 的 S60v5 基线

在 Linux x86-64 上固定 qembian、工具链和容器版本，用上述 5800 固件重建混合 XIP、ROFS 和盘种子。用全新盘完成首次启动，进入主屏，打开菜单并用触摸启动应用。复测保存文件后冷启动读回，保存有效启动参数、产物摘要、串口日志、早期设备访问、交互结果和首个异常。记录复现所需的驱动或策略差异，特别是进程退出和异步请求超时。

**通过条件**为从固定输入重复得到同一套可用产物，冷启动和交互可复现，并能将这一套字节直接作为 v86 的对照输入。

### S1　稳定混合镜像的构建与导入格式

从 S0 导出固定清单，验证用户模块的链接地址、导入序号和 ROM 目录。复核 `sym94` 的关键接口，优先覆盖进程和线程创建、块分配、计时器、LDD/PDD 通道与 IPC 请求完成。用现有固件解析器识别 RM-356 的 CORE、ROFS2、ROFS3 和可选 UDA。固定 v86 导入所需的产物版本和盘符定义。

**通过条件**为本地工具能校验固件与产物，并能识别缺件、错版本、错摘要及 ROM 地址重叠。清单足以从原始输入重复生成这套镜像。

### S2　接入 v86 的 Syborg 板级模型

先启动同一 BSP 构建的开源内核诊断镜像，沿正常入口验证 ARM/Thumb、MMU、异常、中断确认、定时器、串口和冷重启。再接 framebuffer、键盘与指针、只读 ROFS 窗口及 NVMemory。使用合成客体程序验证设备，然后执行 S0 的同一套镜像。按首个不同的 PC、异常寄存器或 MMIO 事件定位差异，验证解释器与正常 JIT 入口。

**通过条件**为开源内核能接管机器、处理中断并从 IRQ 返回，客体通过实际设备访问读写虚拟盘、接收输入和输出像素，混合镜像进入文件服务器启动路径。

### S3　启动原版 S60v5 用户态并进入可操作主屏

挂载 `Z:` 和 `C:`，通过首次向导，核对文件服务器、窗口服务器、应用框架与主屏关键进程。追踪启动依赖的离线请求，验证请求完成和取消。用浏览器测试页面记录客体窗口服务器提交的画面，复测菜单动画、触摸落点、几个关键按键和切换焦点。

**通过条件**为从持久卷冷启动到由客体输出的原厂主屏，能通过触摸和按键打开菜单、启动系统应用并返回。关键服务持续存活，原版用户态的重复操作与 S0 对照一致。

### S4　验证 SIS/SISX 的安装和持久化

运行有源码的 [v86 Notes 1.0](../../tests/symbian/fixtures/notes-v1.sisx) 和 [2.0](../../tests/symbian/fixtures/notes-v2.sisx)。现有包的导入序号已对照 RM-505 核对，在 RM-356 上先检查 UID、实际导入、签名策略和有效期，再决定复用现有包或按首个固件的导入表重新构建同一份应用。把包送入客体可访问的卷，从原生安装界面完成安装，再从客体菜单启动。qembian 调试工具的 SIS 安装记录覆盖 Belle，S60v5 的验收以实际运行结果为准。[Notes 构建记录](../symbian-n97.md#原生-sissisx-递送与-v86-notes) · [qembian SIS 工具范围](https://github.com/emgfc/qembian/blob/aae8b5f4ecf4fccacac91b2b93a6a24df586d9bb/docs/sydb.md#installing-sis--sisx-sydb-sis-install)

**通过条件**为安装 1.0 → 菜单启动 → 输入和保存 → 关机后冷启动读回 → 安装 2.0 并保留数据 → 卸载后主屏和其他应用仍可用。记录原生安装器在取消或拒绝时的结果，并核对正式安装记录与可写卷一致。

### S5　接入浏览器虚拟机库

新建虚拟机沿用 `Symbian → S60v5`，展示首个已验证固件配置。使用一个文件夹入口导入本机构建目录，在 Worker 中校验内容和指纹，再保存到浏览器私有存储。建机时检查配额，支持取消和重试。控制台提供触控、菜单输入、软件包递送、关机和重开。页面刷新后从库中打开同一 VM，再验证挂起恢复。

**通过条件**为通过浏览器的正常入口完成“导入 → 冷启动 → 安装 → 保存 → 刷新页面并重开 → 读回”，并用第二台 VM 验证磁盘隔离。后续 S60v3 或 Symbian^3 通过独立的固件配置和 ABI 验收接入。

### S6　用 WebGPU 验证 EGL 与 OpenGL ES

先用可重复构建的客体测试程序验证 EGL 窗口表面、交换和回到桌面。分别用 GLES 1.1 固定功能场景、GLES 2.0 着色器场景覆盖纹理、深度、混合和读回。核对参考像素与浏览器结果，允许记录清楚且可复现的精度差异。随后验证 GPU 模式下的图形资源恢复，以及关闭加速或适配器不可用时的主屏、输入和 Notes 安装流程。

**通过条件**为发布版浏览器的 CPU Worker 路径能让两个客体场景分别通过实际 WebGPU 提交持续出图。画面可随窗口切换正确显示，软件模式仍通过 S5 的主要用户流程。

### S7　验收真实 S60v5 3D 游戏

从用户提供的游戏包中选择与首个固件配置匹配的样本，优先覆盖 GLES 1.1 和 GLES 2.0 各一款。固定游戏版本、场景、输入步骤、浏览器和 GPU；从原生安装器安装，再从 S60 菜单启动，进入可操作的 3D 场景，检查纹理、深度遮挡、按键或触摸、暂停返回以及再次启动。

**通过条件**为实际游戏持续输出可操作画面，退出后能返回桌面，并可按固定步骤复测。记录帧时间的中位数和 P95、客体 CPU 时间、GPU 提交与回读开销；按游戏记录缺失扩展、渲染偏差和影响范围。两种 GLES 路径各有实测结果后发布兼容性结论。

### S8　移除旧 N97 硬件实现

S0–S7 全部验收通过后，删除 `nokia-n97` 的机型注册、启动和外设模型、RAPIDO ROM 兼容服务及 RM-505 专用固件导入。同步移除旧机型的 UI 与 API 入口、构建接线、专用探针和测试。按实际调用关系保留 Syborg 或其他受支持机型复用的 ARM1136、通用固件解析、SIS 递送和测试资产。

把 Notes 等仍适用的操作和构建说明迁入 Syborg 使用文档。旧硬件的研究记录和复现工具可从历史提交查阅，现行使用说明引导用户创建 Syborg 虚拟机。清理范围限于仓库与构建产物，旧虚拟机和快照的兼容性在变更说明中明确。

**通过条件**为常规构建和运行时已解除对旧 N97 板型的依赖，Syborg 的离线冷启动、Notes 持久化与 WebGPU 游戏验收仍通过，其他机型的共用代码回归通过。
