# iPhone 5s（A7）与 iOS 12 实施计划

首个目标选 iPhone 5s（`iPhone6,1`，N51AP）和 iOS 12.5.7（16H81）。第一次交付从 VM 管理器导入固件，从持久盘启动 ARM64 XNU、`launchd` 和可读写数据的用户程序。第二次交付可触控的 SpringBoard、本地 ARM64 应用和 **Metal → WebGPU** 渲染，用一款安装到客体的 Metal 应用验证整条路径。两次交付都通过正式浏览器控制台验收。ARM64 启动可与 [iPhone 4s 主线](iphone4s-plan.md) 同期推进。

截至 2026-11-22，按仓库提交 `d11fb9570` 核对。v86 已有 AArch64 EL0/EL1、MMU、浮点/SIMD、页级 JIT 及协作和 Worker 多核，并有 Linux、Android 启动记录。本计划复用这些能力。N51 固件尚待实际引导。Aleph 的 QEMU 项目在另一套平台配置上做到 iOS 12.1 用户空间、可写磁盘和文本 framebuffer，可参考其启动检查点。[v86 AArch64 验收](../aarch64.md) · [Aleph 项目记录](https://github.com/alephsecurity/xnu-qemu-arm64)

## 第一阶段　ARM64 内核、磁盘和用户空间

### A0　固定固件与板型

从用户本地 IPSW 选择匹配 `iPhone6,1`、N51AP 和 16H81 的 BuildIdentity。记录 IPSW 与组件摘要、内核架构及 UUID、设备树、ramdisk、系统卷输入的容器和压缩格式。共用 4s 计划的“型号＋板号＋build”选择逻辑，按组件识别目标 IPSW 格式，避免把 N90 的 IMG3、解压和制卷流程套到 N51。工具与浏览器向导读取同一份清单。[现有导入器](../../src/ios/ipsw.js) · [镜像组装](../../src/ios/assemble.js)

**通过条件**

能从本地输入重建组件清单，解析出 ARM64 内核和 N51 设备树。混入其他板型、build 或截断组件时，指出具体输入并在写盘前退出。固件、密钥与生成卷保存在本地。

### VM 管理器与控制台 UI

沿用 4s 的型号选择、导入进度与实例管理。配置保存机型、build 和用户的图形偏好。控制台在运行时读取最后到达的引导阶段、客体图形桥支持的 API 及宿主 WebGPU 设备状态。旧配置中的 `ios.gles_proxy` 继续表示 GLES 偏好。[VM 配置](../../src/app/vm_config.js) · [可选机器与设备](../../src/app/vm_model.js) · [新建向导](../../src/app/ui/wizard.js) · [导入 Worker](../../src/app/ios_import_worker.js)

| 用户操作 | 第一阶段 | 第二阶段 |
| --- | --- | --- |
| 导入、保存和重开 | 摘要核对 iPhone 5s、N51AP、16H81、ARM64 和盘空间。分步显示组件校验、磁盘准备与提交。取消或空间不足可重试，成功后列表显示该实例的版本与持久盘。 | 详情及设置显示随固件安装的图形桥版本。重开 VM 时重新检测宿主适配器，分别显示已保存的图形偏好和本次实际后端。 |
| 启动与操作 | 控制台提供串口与电源操作，从引导事件显示内核和用户程序到达的阶段。尚无画面时，能看到最后一个检查点。 | 屏幕按 640 × 1136 等比缩放，旋转时同步更新触控映射。Home、锁屏及安装按钮随设备和服务就绪开放。图形详情按最近一次提交显示客体使用的 API、系统合成输出和宿主后端。 |
| 安装与图形故障 | 安装服务尚未启动时，界面说明原因，串口仍可诊断。 | 安装前显示 ARM64 切片、最低 iOS 版本及应用声明的图形需求。WebGPU 不可用、设备丢失、库载入失败分别给出原因和可行操作，例如重新初始化图形设备或查看串口。设备丢失期间停止提交，并向客体结束在途请求。 |

**浏览器验收**　先在无 WebGPU 的环境完成导入并通过串口运行 A3 的小程序。再在有 WebGPU 的环境导入并安装 B1 的 Metal 样例，点击、旋转、锁屏、唤醒、关机、刷新页面、重开，核对图形状态、触点和应用数据。用模拟设备丢失验证错误提示和恢复结果。与 N90、N94 并列时，三台机器须显示各自的型号、盘与可用图形能力。[设置页](../../src/app/ui/settings.js) · [运行控制台](../../src/app/ui/console.js) · [向导测试](../../tests/app/wizard_test.html) · [安装 UI 测试](../../tests/app/ios_install_test.html)

### A1　让 ARM64 内核地址完整抵达入口

现有 Mach-O 解析器会把部分 64 位段地址、节地址和符号值转成 JavaScript `Number`，线程入口只提取 ARM32 PC。现有 Apple 引导器会拒绝 64 位内核。为 N51 增加 ARM64 线程状态与入口解析，按 16H81 的 XNU 约定组装 boot_args、设备树、物理与虚拟基址、可用内存及保留区，检查把启动参数地址交给 `x0` 时的地址空间和入口异常级别。[Mach-O 解析](../../src/apple/macho.js) · [N90 内核交接](../../src/apple/boot.js)

**通过条件**

用合成 Mach-O 构造两个仅低位相差 1、超过 `Number.MAX_SAFE_INTEGER` 的高位地址，经过段、节、符号、入口解析和虚实换算后仍可区分。客体地址在 JS/Wasm 边界保持 BigInt 或高低字，仅对已验证范围的宿主缓冲区偏移转成 Number。检查越界段与未映射入口会报错。最后用 16H81 记录入口 PC、x0、第一次取指的物理地址，并核对该指令与内核镜像中的字节。

### A2　接入 A7 平台并跑通双核

建立 A7（S5L8960）机器配置，拟定双应用核、1 GiB RAM、640 × 1136 显示。用 N51 设备树和实际访问确定内存映射、CPU 标识、系统寄存器、中断控制器、定时器、UART、核间中断、电源管理及次核释放。先使主核完成异常处理、启用 MMU 并持续接收定时器中断，再在协作模式释放次核。对首处异常保留 PC、ESR/FAR、异常级别、最近一次 MMIO 和中断状态。遇到执行差异时用相同输入对照解释器与页级 JIT。[ARM 机器装配](../../src/arm/cpu.js) · [多核执行方式](../multicore.md)

**通过条件**

同一 build 可重复输出 XNU 早期串口日志并到达平台初始化。日志能证明两个核都执行过工作，并完成一次核间唤醒。可先用诊断 ramdisk 运行探针，验收记录须注明启动介质，随后再接正式系统卷。

### A3　让客体从 APFS 启动，识别数据保护依赖

| 工作 | 实施与验证 |
| --- | --- |
| 宿主准备镜像 | 确认 16H81 恢复包的源卷格式、目标分区与 APFS 容器布局。优先复用本地恢复工具制成可重复导入的盘种子，记录转换步骤、卷角色与摘要。若需初始化数据卷，比较本地制卷和客体首次启动初始化两条路径。 |
| 客体访问磁盘 | 按 N51 驱动探测实现存储控制器、块读写、完成中断、flush 与错误返回。由 iOS 的 APFS 驱动处理文件系统语义。浏览器为每台 VM 维护独立可写盘，重开同一实例能读到已提交块。 |
| Secure Enclave（SEP）与数据保护 | 在新虚拟设备上先跟踪启动和文件访问，在第二阶段补测锁屏、解锁和应用安装，记录实际等待的邮箱请求、共享内存、完成中断及服务。按观测到的依赖实现服务和每实例持久状态，记录成功、锁定和失败返回。锁屏前后按文件的保护类别核对访问结果。 |

iOS 从 10.3 起默认使用 APFS，5s 起配有 Secure Enclave。是否需要在宿主增加 APFS 写入能力、哪些 SEP 服务会阻塞 16H81，分别由制镜实验和运行轨迹决定。[Apple 文件系统说明](https://developer.apple.com/documentation/foundation/about-apple-file-system) · [Apple Secure Enclave 说明](https://support.apple.com/en-gb/guide/security/sec59b0b31ff/web)

**第一阶段通过条件**

从持久盘冷启动目标系统，保留系统卷与可写数据卷的挂载记录。`launchd` 启动一个 ARM64 小程序，程序创建标记文件、同步、重新打开并打印摘要。正常关机，销毁 CPU 与内存，再从同一盘启动并读回相同摘要。若停在 ramdisk 或某个安全服务，记录最后完成的检查点、首个未完成请求和重现输入。

## 第二阶段　桌面、Metal → WebGPU 与 ARM64 应用

### B0　确定系统桌面和应用的呈现路径

先接通 framebuffer 和输入，观测 16H81 的系统合成器、SpringBoard 和测试应用从创建表面到呈现一帧的过程，记录进程、API、像素格式、IOSurface 所有者和等待事件。若桌面使用 GLES，为其实现 ARM64 EAGL 桥并验证跨进程 IOSurface。若桌面使用 Metal，优先实现下列 M0–M4 中它调用的接口。两种情况下，Metal 应用均须走完整的 Metal → WebGPU 链路。A7 硬件支持 GLES 3.0 和 Metal。[Apple GPU 能力表](https://developer.apple.com/library/archive/documentation/DeviceInformation/Reference/iOSDeviceCompatibility/HardwareGPUInformation/HardwareGPUInformation.html)

### Metal → WebGPU 实现里程碑

客体应用照常调用系统 Metal API。拟新增适配 16H81 的 ARM64 客体桥，由 CPU Worker 解码，沿现有渲染通道增加版本化的 Metal 命令流。页面端执行器通过 `V86GPUHost` 取得共享设备，将完成、读回和错误按提交序号送回客体。系统合成后的画面进入控制台。先用同一执行器回放合成命令流，再接真实 ARM64 应用。[现有 ARM32 传输](../../tools/ios/guest/gles-transport.h) · [渲染通道与回复区](../../src/graphics_adapters/renderer_protocol.js) · [共享 WebGPU 设备](../../src/browser/glbridge/webgpu_host.js) · [宿主合成器](../../src/browser/glbridge/webgpu_compositor.js) · [Apple Metal 命令模型](https://developer.apple.com/library/archive/documentation/Miscellaneous/Conceptual/MetalProgrammingGuide/Cmd-Submiss/Cmd-Submiss.html)

| 里程碑 | 实现 | 通过条件 |
| --- | --- | --- |
| M0　客体入口与传输 | 跟踪 `MTLCreateSystemDefaultDevice` 到 16H81 中实际的设备对象与提交入口，确定系统和应用都能调用的接入位置。按 ARM64 Objective-C ABI 实现实际用到的选择器和 completion block。命令包包含版本、操作码、长度、连接、对象句柄及提交序号。高位客体指针在 CPU 侧解引用，跨页校验后传入数据。 | 客体取得设备、创建队列、提交空命令缓冲并恰好收到一次完成回调。合成用例覆盖跨页输入、失效句柄、错误包长和并发连接。设备查询只报告已验证的能力。 |
| M1　资源与拷贝 | 将 `MTLBuffer`、`MTLTexture` 和 sampler 映射到 WebGPU 对象，按 VM 与设备管理句柄及引用。为 shared 缓冲实现 CPU 写入的可见性及 GPU 完成后的回写，private 资源走上传和读回缓冲。处理行距、格式与对齐，先支持 BGRA8/RGBA8，按实际用法扩展。 | 客体写入已知字节，blit 完成后读回相同结果。再测带行填充的非方形纹理及提交后立即释放的对象，检查回读字节、在途引用与最终释放。 |
| M2　着色器与管线 | 实现下文的 MSL 源码和预编译库入口。把函数、顶点布局、资源绑定、颜色与深度格式、混合和采样数转换为 WebGPU 管线描述，按着色器内容、选项和描述缓存。 | 两条库入口各自绘出预期像素。修改片元函数或混合状态后的输出按预期变化。格式不匹配和不支持的函数都返回可定位的客体错误。 |
| M3　编码、执行与同步 | Render encoder 映射到 render pass，处理 attachment 的 load/store、绘制、深度、混合和按索引绘制。Blit 映射到复制命令，compute encoder 通过 compute pass 分派。按 Metal 队列顺序提交，为每批命令记录完成序号，区分已提交、已完成和失败。同步等待挂起对应客体线程，宿主事件循环继续处理完成通知。 | 同一队列依次执行“计算写缓冲 → 绘制读取 → 拷贝读回”，核对数值、像素和回调次序。延迟宿主完成时，等待线程应在结果可读后才唤醒。模拟设备丢失时，所有在途等待都以明确结果结束。[WebGPU 规范](https://www.w3.org/TR/webgpu/) |
| M4　呈现与系统合成 | 把 `CAMetalLayer.nextDrawable` 取得的 drawable 与 IOSurface、WebGPU 纹理关联。处理 drawable 池、背压、`presentDrawable:`、GPU 完成、合成器消费及回收。让系统按原有层次合成应用、桌面与遮挡窗口。 | 两个不同颜色的表面按正确顺序和透明度叠加。轮转小型 drawable 池，跨多帧、旋转、锁屏、唤醒和前后台切换验证画面与回收。应用回到桌面后应再次看到可操作的 SpringBoard。[Apple CAMetalLayer](https://developer.apple.com/documentation/quartzcore/cametallayer) |

**M2 的两个编译入口**

- **运行时 MSL 源码。** 先支持样例实际使用的顶点、片元及计算函数，将参数、地址空间、阶段输入输出和资源槽位转换为带类型的中间表示，再生成 WGSL。用浏览器编译诊断回填库和管线错误。对支持的子集测试常量缓冲布局、纹理采样、颜色通道和线程组索引。[WGSL 规范](https://www.w3.org/TR/WGSL/)
- **随 IPA 分发的 `.metallib`。** 从目标 SDK 生成、能在目标系统载入的自编库入手，覆盖 `newDefaultLibrary`、文件和内存载入。识别库版本、函数表、反射和载荷类型。若含可解析的 AIR 中间表示，为样例所用的操作和内建函数实现解码，接入同一个中间表示与 WGSL 后端。对仅含其他二进制变体的库返回具体格式、阶段和函数，记录受影响应用。仓库现有 Naga 管线可复用有效 SPIR-V 到 WGSL 的部分，MSL 和 AIR 各自需要输入前端。[Apple Metal 库与函数](https://developer.apple.com/library/archive/documentation/Miscellaneous/Conceptual/MetalProgrammingGuide/Prog-Func/Prog-Func.html) · [仓库 Naga 实现](../../src/browser/glbridge/vx/naga/)
- **交叉验证。** 从同一着色器生成源码版与预编译版，用独立输入在两条路径渲染，和已知像素或参考设备的结果对照。预编译用例运行时仅提供库，改变 shader 运算后重新编译再测一次。若实际应用的默认库无法转换，该应用保留为阻塞项。

**Metal 端到端验收**　从正式控制台安装一款 ARM64 Metal IPA，使用随包的预编译库绘制持续变化的场景，触控改变画面，返回桌面后再次进入。留存应用和库摘要、客体提交序号、WebGPU 完成记录、合成后的像素以及 60 秒帧时间。宿主回放、客体离屏渲染、应用上屏分别记录结果。以后每款游戏按其着色器变体、资源格式与同步需求增加兼容样例。

### B1　原生桌面、安装与数据

1. 从正式 VM 控制台冷启动，触控解锁，打开设置、滚动、切回 SpringBoard，熄屏再唤醒。分别留存操作前后画面、触控事件和对应帧的提交记录。
2. 为 iOS 12 适配本地 IPA 的 ARM64 Mach-O 切片、最低系统版本、签名校验与原生安装服务。用一个自编 ARM64 应用及一个带多架构切片的样例检查实际装载架构。仅含 32 位切片的 IPA 应在导入时报明原因。iOS 11 起移除了 32 位应用支持。[现有 IPA 检查](../../src/ios/ipa.js) · [Apple 64 位迁移说明](https://developer.apple.com/library/archive/qa/qa1971/_index.html)
3. 在一个可操作的 ARM64 应用内创建可辨认的数据，验证锁屏、解锁后的访问行为。通过原生关机关闭 VM，重开浏览器，从持久盘冷启动后重新打开应用，核对安装状态、内容和摘要。
4. 用同一安装入口装入 M4 验收的 Metal 样例。把触控选择的颜色或场景写入存档，冷启动后打开该应用，验证存档值与 WebGPU 呈现的第一帧一致。

**第二阶段通过条件**

同一份 16H81 配置能重现上述桌面操作、安装、原生启动和冷启动后的数据读取，并通过 M0–M4 及随包预编译库的 Metal 应用上屏验收。应用兼容记录写明版本、ARM64 切片、实际图形路径和可完成的操作。

### B2　浏览器资源预算与回归

在固定宿主和浏览器、发布构建、1.0× 客体时钟下，从相同盘种子做三轮测量。第一阶段记录上电到用户程序完成的时间、客体 RAM 和宿主峰值内存。第二阶段增加首次可交互桌面耗时、触控到呈现延迟、固定场景 60 秒的呈现帧率及帧时间 P95。列出 JIT 缓存、页表、GPU 纹理及缓冲区的可测占用。协作双核与每核 Worker 用相同工作负载对比，首轮实测后确定性能预算。[AArch64 基线](../aarch64.md) · [冷启动测量方法](../perf/ios-cold-boot-performance.md)

修改共用解析器、CPU 或存储层时，运行现有 `make ios-tests` 及受影响的 AArch64 MMU、Linux 启动回归。用合成 Mach-O 和块设备覆盖无固件测试。真固件记录附机型、build、输入摘要、机器配置以及各阶段的串口或画面证据，分别标明“用户空间已达”“桌面可交互”“指定应用通过”的实测结果。[MMU 页粒度测试](../../tests/a64/mmu_granule.mjs) · [Linux 启动测试](../../tests/a64/linux_boot.mjs)
