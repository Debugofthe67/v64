# Infinity Blade 安装与帧率验证

## MP3 切换与输入阻塞续作（2026-11-14）

本轮已修复电影结束后的 AMC/MP3 阻塞，完整 NAND 冷启动后可进入 God King 战斗，
举盾、`BLOCK` 提示和盾牌扣减均由实际触摸触发。**60 fps 未达到，目前仍无法流畅游玩。**

本轮无 profiler 的战斗采样（完成原生 960×640 drawable，面板变更数复核一致）：

| 构建/路径 | 状态来源 | 采样秒数 | 完成帧数 | fps |
| --- | --- | ---: | ---: | ---: |
| MP3 修复后的基线 | 完整 NAND 冷启 | 60.814 | 66 | 1.085 |
| NEON 向量与一次性 DRAM 路径 | 另一次完整 NAND 冷启 | 61.466 | 17 | 0.277 |
| 再去除重复 MMU 翻译 | 恢复已暂停的真实战斗状态 | 60.881 | 40 | 0.657 |

三个窗口的战斗进度、JIT 缓存状态及主机并发负载不同，不能据此宣称确定的加速比；
**本轮没有验收到稳定的游戏帧率提升**。最后窗口中位帧间隔 1474 ms、p95 2343 ms。
RAM 状态只用于最后一项帧率复测，不计入冷启动成绩；恢复时校验了同一持久磁盘的身份
和代次。当前冷启动到桌面 2 分钟目标也未验收通过。

本轮提交为 `4b831c3b`（MP3）、`b9df7fc9`（NEON 向量）、`57e7d25d`
（uncached DRAM）、`550cfd41`（保护回归与战斗基线）、`5c598489`（一次 MMU 翻译）。
本地证据在忽略目录 `build/ios/infinity-play/` 与 `build/ios/infinity-next/`，
不提交 IPA、固件、NAND 或 RAM 状态。仍需继续针对实际 ARM 执行、MMU、JIT 缓存和
显示路径做性能工作，不能通过计数 VBL/rAF 或修改 FPS 显示值视为达标。

已纠正此前对 `0x84004600` 程序的识别：它是 MP3 解码器，而非单独的电源控制
程序。原生寄存器窗口 `0x960=c6005c00 / 0x964=8544602f / 0x968=c013f7fb`
与其指令前缀共同匹配；未知窗口不确认。原先只发 ready、没有初始化结果头，
导致 AppleAMC-176 第 582 行缓冲区数量校验失败。随后背景 MP3 的 AudioQueuePrime
返回 `nope`，主线程在 AudioQueueDispose 等待回调退出，而回调等待主线程持有的
AVAudioPlayer mutex，UIKit 事件时间停在电影结束处。此前显示战斗 HUD 并不代表可操作。

现按 MP3 协议声明两个 2304 样本输出缓冲区，沿真实 engine-0、CDMA、S24-in-S32
路径交付解码数据。WebCodecs 每个 chunk 接收一个完整 MPEG Layer III 包；以逐帧
输出通知等待批次完成，避免 `flush()` 清掉跨批次的 bit reservoir。未知格式、
变更格式、截断包与超过 64 包的批次显式失败，不跳过 AudioQueueDispose 或伪造 PCM。

回归使用自行生成的 44.1 kHz 双声道 MP3：三帧批次、下一批帧的左右 1000/1500 Hz
频率能量、MP3/AAC 不同的输出容量及真实 CDMA 交付均通过；AMC、I2S、CDMA pause/reset
测试通过。后续正式游戏验证结果见本节开头；已验收战斗操作，未达到 60 fps。

下一步把 A32 NEON 的 VADD/VSUB/VMUL/VMLA/VMLS 从逐 lane 的标量 Wasm 改为
`f32x4` 运算及整向量 guard，D 形式只写低 64 bits。继续检查 sticky IXC、普通数、
每个乘法 lane 的下溢和中间结果；VMLA/VMLS 保持两次舍入，异常仍走精确解释器。
180 个 ARM/Thumb、D/Q、重叠寄存器及异常边界用例与 QEMU 一致，MMU/page JIT
与解释器一致；额外 200 个随机 NEON 用例无差异。SIMD 和 fallback 正式核心构建通过。
尚未把指令实现变化换算为游戏 FPS，待同一可操作场景测量。

正式 MP3 构建已重新从 generation 7 NAND 冷启，经 Install IPA → Open 打开原包，
推送提示和电影结束后 MP3 持续输出，未再出现上述 AMC 断言，解码错误数 0。
主菜单可打开、主线可进入；格挡教程中保持真实触摸后角色举盾、提示消失，
敌人攻击后盾牌从 23 降到 22，生命从 1440 到 1396。**已验收实际战斗输入**，
不是仅凭动画或 HUD 判定可玩。该冷启动尚未加载后续向量/uncached JIT 优化。

带实际格挡的 101.37 s 窗口完成 70 个原生 drawable（0.691 fps），中位帧间隔
1277 ms；其中同时有开发构建工作，不作为严格 A/B 基线。更早开场的带 profiler
窗口为 89 帧 / 51.32 s（1.734 fps），两者进度不同。60 fps 仍未达到。

采样还发现 Device 属性的 IOSurface DRAM 访问总是退出编译代码。增加对齐、
单页、通过当前 EL 权限检查的 DRAM 一次性 host pointer，**不填访问缓存**；
后续未对齐访问仍产生原生 fault，MMIO、空洞、只读写入、代码页、设备本地内存、
exclusive reservation 沿用拒绝路径。真实 A32 EL0 循环、无 Device cache fill、
对齐/权限异常与 MMIO/hole/watched-code 回归通过，MMU/JIT 用例通过。
诊断 `uncached_accesses` 单独计数；实际游戏性能需重新测量。

补充回归覆盖 1/2/4/8/16-byte 访问和双核 reservation：Normal 别名的 LDREX
仍阻止 Device 别名获得写指针。SIMD 与 fallback 核心均通过；单核原有 monitor
策略允许当前核自己的普通写入，测试使用双核验证跨观察者保护。

无 profiler、未同时运行本任务构建/回归的格挡基线为 66 帧 / 60.814 s，
即 1.085 fps；中位 892 ms、p95 1261 ms。第二次格挡结算后盾牌为 21、生命 1352。
关机导出的完整持久盘为 `build/ios/infinity-play/mp3-battle.packed`，
4,002,422,272 bytes，SHA-256
`f4f854b2a6797f89f795915e0331ecca29aa84dbe4b3f2727c230fee6faa8396`。
该盘随后在新的隔离浏览器配置中完成冷启复测，冷启过程不使用 RAM 快照。

后续减少该路径的自身开销：一次 TLB 查询同时返回权限、PA 与 Device 属性，
不再先尝试 Normal cache 后重复翻译；Device MMIO/hole 在 DRAM aperture 外直接拒绝。
Device 指针继续不缓存，对齐/写保护/代码页/reservation 条件保持。SIMD/fallback
构建、真实 A32 EL0 宽度及双核保护测试通过；300 组 MMU 用例、4285 个探测与参考
无差异，PAN 回归通过。实际战斗复测数据见本节开头，仍未接近 60 fps。

为腾出后续验收空间，已清理本轮生成的旧 adapter/query 中间 NAND 文件；原始输入、
安装后原始备份、generation 7 的完整备份和各阶段哈希记录保留。

## 当前续作结果

更新后的正式构建已从 generation 5 NAND 完整冷启，通过 UI 打开原包。
全部 925 个初始 PVRTC mip 上传成功，原生 renderbuffer 查询得到 960×640，
没有 framebuffer 拒绝或 WebGPU validation error。关闭原生推送提示、跳过电影后，
实际显示了城堡大厅、人物、光照和主菜单；尚未验收战斗操作。

开场动态场景采样（面板实际变更图像，非 VBL/rAF）：带 CPU profiler 的 50.28 s
记录 31 帧、0.617 fps；关闭 profiler 的另一个 30.82 s 窗口记录 11 帧、0.357 fps，
中位帧间隔 2246 ms。两个窗口处于不同开场进度，不能当作优化 A/B。
证据在忽略目录 `build/ios/infinity-play/`。60 fps 目标仍未达成。

已将自有 native 适配器的 IOSurface 发布改为请求 BGRA 后按行 memcpy，
通道交换移到宿主回读完成后执行；保留 GPU 真实回读、alpha、窗口倒行、stride
及原生 IOSurfaceLock/Unlock。真实 GPU 回归 97 项通过，包括逐字节 BGRA、
不支持格式显式失败和原纹理不变；ARMv7 dylib 构建通过。
该优化尚待在原生游戏中做 A/B，不据此声称帧率提升。

主菜单之后的停滞已定位到 XNU 的 I2C 接收循环，5 s 采样有 1081 万次
I2C2 FIFO 读取、没有新的 GL 命令。原生 MPU3100 发起 256-byte FIFO 读取时，
`0x8074f03a` 的 `uxtb r5,r6` 将索引截为 8 位，永远小于请求长度 256；
发送循环 `0x8074ef8c` 有相同截断。隔离 RAM 诊断改用完整索引后，
FIFO 读取退出、输入队列清空、游戏重新提交图形命令，但此前长时间停滞导致
原生 watchdog 终止了游戏/重启 backboardd，需要从冷启动重新验收。

启动器现仅对 UUID `3bfc23e42eb53dad9d909e79ac235537` 的 10B329，
在全部邻接指令指纹验证后，将这两个截断换成完整计数器赋值。只改变加载到
RAM 的代码，不改机主固件文件、NAND 内核归档、信任基线或游戏主程序；
I2C 的真实传输、数据长度和完成检查继续执行。未知 UUID 保持原状，已知 UUID
指纹不符则拒绝启动。`tests/ios/i2c-counters.mjs` 验证原子拒绝、幂等性和
真实 ARM Thumb 的 255/256/512-byte 计数，原始本地内核指纹验证通过。

generation 6 已通过原生文件系统完整写入 BGRA 适配器并更新启动归档，
再从 NAND 完整冷启。两个计数器均由启动器加载为完整计数，CPU 无临时运行钩子，
宿主也无方法替换。重新经 UI 打开、关闭推送提示和跳过电影，城堡开场再次出现，
925 个初始 PVRTC mip 上传、renderbuffer 查询及 AAC 队列继续工作。
Apple Metal 3 WebGPU 上的 38.53 s 原生游戏 drawable 回读采样为 13 帧 / 0.337 fps，
面板同窗为 13 次图像变更 / 0.340 fps；约 18.98 亿客户机指令。
这仍是开场流程，不能代替战斗验收，也不能与不同进度窗口作严格加速比。

下一项已实现的直接 IOSurface 回读使用私有协议，将正确行序的 BGRA 直接交给
已锁定的紧密排列原生表面，减少临时分配和 ARM memcpy；有 padding 的表面保留
按行复制。所有权、范围、方向和回包长度均检查，完成状态晚于真实 GPU 回包。
真实 GPU 回归 103 项、跨进程 IOSurface 读取/恢复及 ARMv7 构建通过。
这一路径尚未写入当前游戏测试盘，不声称游戏加速。

睡眠/唤醒续测发现另一个 AMC 控制程序：入口 `0x84004600`，与 AAC 程序不同。
原生 `AppleAMC_r2` 在 `0x807f75f2` 读取 pending、等待 bit 2；缺少这个启动握手会
阻塞电源转换，输入排队且面板无法唤醒。按已加载控制程序的入口和指令前缀识别，
只报告 control-program-ready 后，隔离诊断中的面板和游戏图形提交恢复。
该握手不会初始化 AAC、解出音频、消耗 DMA 或制造 PCM。未知入口/不同指纹不确认。
`tests/ios/amc.mjs` 新增正例、错误指纹、错误入口、无输入/PCM 及复位检查，
CDMA/I2S 回归通过。仍需完整正式构建验证新的睡眠/唤醒路径。

直接回读的完整启动测试暴露出传输层原先拒绝所有 Device 属性页。
IOSurface 的底层是 DRAM，但客户机会用 uncached/Device 属性映射，因此原生
直接写入失败。现保留 EL0 页表权限检查，对 Device 属性页额外核对物理 backing
确为 RAM；MMIO、空洞、只读映射和设备本地银行不放行。
`tests/ios/iosurface-memory.mjs` 运行真实 A32 EL0 页表与传输：旧核心正常 RAM
通过、Device/strongly ordered RAM 失败（位图 `6`）；新核心三种 RAM 均收到
正确像素，RO/MMIO/hole 三种失败且不消耗输出。新版正式 ARM 核心和 fallback 已构建。

generation 7 测试盘已关机分块导出为 `build/ios/infinity-play/direct-fixed.packed`，
4,002,422,272 bytes，SHA-256
`23642a4307a64b943ce5e84eae972e87e81b1fdafec20a802cab623f329b9a33`。

CPU profile 中 SoftFloat `f32_mul` 占约 935 ms / 30 s。为 RN 模式、有限普通
binary32 乘法增加宿主 f32 路径，并用精确 binary64 乘积计算 IXC；NaN、无穷、
非默认舍入与 tininess 边界继续使用 SoftFloat。4,800 个随机乘法、4,800 个二元
浮点、1,200 个 ARM32 VFP/NEON 用例与 QEMU 一致。新增 ARM/Thumb 的精确/
非精确乘积、初始清零及 sticky IXC、负零和最小 normal 舍入测试；34 个真实
EL0 用例与 QEMU 一致，MMU/page JIT 与解释器一致。尚未据此宣称游戏 FPS 提升。

generation 7 + uncached RAM 修复的正式冷启已通过 UI 打开游戏，完整 AAC
仍为 133 个输入 / 23,404,544 bytes PCM / 0 错误；AMC 控制程序握手计数 1。
原生直接回读持续成功。连续城堡动画的无 profiler 窗口：29.88 s 完成 27 个
960×640 原生 drawable，即 0.904 fps；面板同窗 29.77 s 变更 27 次，即 0.907 fps。
三个 drawable 为轮换表面，原生完成数与可见图像数一致。此为开场动画，仍不是
战斗验收；不同进度不能直接计算相对旧版的加速比。

新的 30 s profile 中，`__ashlti3` / `__lshrti3` 合计约 1.83 s。
将 ARM32 S/D 寄存器改为对应宽度的直接读写，并将对齐的 8/16/32/64-bit lane
提取/插入分解为两个 u64 半部，保留其他宽度的通用路径。
4,200 个 ARM32 VFP/NEON、4,800 个 A64 SIMD（266 个 mnemonic/form）与 QEMU 一致，
q4/qfz 的真实 MMU/page JIT 回归通过。该项仍待新冷启测量，不能据此声称游戏加速。

NEON 的 VADD/VSUB/VMUL/VMLA/VMLS 增加逐 lane 的原生 JIT 路径：
采用 NEON 标准 RN/FZ/DN 语义，只有 IXC 已经 sticky、输入为普通值且每个中间/
最终结果不会产生其他异常时走快路径。VMLA/VMLS 保持两次舍入；所有 lane 验证完
才写寄存器，晚出现 NaN/underflow 时不会破坏重叠源。180 个 ARM/Thumb、D/Q、
重叠目标、初始 clear/sticky IXC、非默认 FPSCR RMode、NaN/denormal/overflow/
underflow/符号零用例与 QEMU 一致；MMU/page JIT 与解释器一致，q4/qfz 回归通过。
这项新 JIT 路径尚未加载到当前游戏运行中，不能把该运行的帧率归因于它。

已进入 God King 战斗教学，出现双方血条、盾牌数 53 和 HOLD TO BLOCK。
当前触摸与图像方向仍在验证，不能仅凭 HUD 判定可游玩验收。教学待机窗口
62.62 s / 197 个原生完成为 3.146 fps，面板 62.61 s / 198 次变更为 3.162 fps；
这是教学提示等待状态，不能当作持续战斗帧率或 60 fps 达标。

传输诊断的 15.22 s 窗口发现大量 READ/AGAIN 空轮询，单个连接超过 30 万次。
现空读在完成本条 UDF（保留 AGAIN 和正确 PC）后结束宿主 slice，让浏览器处理
异步回包；不进入客户机 WFI、不制造完成/像素。真实 ARM/Thumb、解释器/JIT
四组测试均验证每个空读只尝试一次即归还宿主、续跑后只交付一次真实 payload，
PC 和尝试次数正确。uncached RAM 权限回归及 NEON/FP page 回归通过。
该调度优化还需新的正式冷启游戏复测。

战斗教学中的图像/触摸方向问题已定位为 IOSurface GPU 别名：窗口回读会
将 GL 行序转为 CPU/native 行序，但 CA 的直接 GPU 采样仍拿到生产者的 GL 行序。
现窗口发布记录 native 行序，采样使用独立的 GPU 翻转图像；生产者 renderbuffer
保持原始 GL 行序和 retained backing。CPU 部分更新先正规化未改写区域。
GLES 2 translator 和实际 native GLSL ES 1.00/glslang 两条真实 GPU 路径均验证
非对称角点、跨进程采样、原 framebuffer 内容、部分 CPU 更新与快照恢复。
GLES2/GLES3 executor 浏览器回归通过，无 WebGPU validation error。
隔离诊断画面方向已恢复；尚待正式构建冷启确认及触摸战斗验收。

含上述修复的正式构建已再次从 generation 7 NAND 冷启，约 172 s 经 UI
请求打开游戏；AAC 完整输入/PCM 数量与之前一致、0 错误，窗口采样方向修复已加载。
连续开场 66.32 s 为 130 个原生 drawable / 1.960 fps，面板 66.27 s 为 129 次
图像变更 / 1.947 fps；其中包含 30 s CPU profiler，因此不能直接与无 profiler
的旧窗口计算加速比。尚未验证完整战斗触摸流程，更未达成 60 fps。

新 profile 中 LCD 扫描/转换约 3.11 s / 30 s。满亮度像素转换现使用一次 u32
RGBA 写入，保留调暗时 Uint8Clamped 的原舍入，非 little-endian 宿主走原路径。
设备回归通过。本机 640×960、连续改写 60 帧的独立微基准中，中位耗时约
266 ms → 113 ms；这是像素转换微基准，不能当作游戏帧率或整机加速比。

## 测试输入（2026-11-14）

机主本地提供 `Infinity_Blade_1.4.3_ios_6.0.ipa`。原包只读，
IPA、游戏资源、固件、NAND 和运行截图均不提交仓库。

| 项目 | 检查结果 |
| --- | --- |
| 原包 SHA-256 | `42c204a602db8d5fb47dae412ed9e740d9cb35f30cd07f4342221855a5d31f31` |
| 原包大小 | 610,558,492 bytes |
| ZIP 成员 / 展开大小 | 645 / 988,023,533 bytes |
| Bundle / 版本 / build | `com.chairentertainment.birthright` / 1.4.3 / 7982.136 |
| 主程序 | `Payload/SwordGame.app/SwordGame`，ARMv7，`cryptid=0` |
| 最低系统 / 设备能力 | iOS 6.0 / `armv7`, `opengles-2` |
| 完整检查 | 所有成员 CRC、路径、符号链接、Mach-O 和整包摘要校验通过 |

安装器原来误拒绝 ZIP 中合法的空 `Payload/` 目录。已允许空的目录项，
继续拒绝有内容的目录项、伪装为目录的普通文件，以及其他 Payload 同级应用。
验证：`node tests/ios/ipa.mjs`，10 项通过。

## 帧率目标与计数口径

目标是可交互的动态游戏场景达到 60 fps。浏览器的刷新率、LCD/VBL 中断频率、
桌面合成频率和模拟 CPU 的 MIPS 都不能替代游戏帧率。
只有安装成功及启动请求成功，也不能判定游戏运行成功。

完整解析原包 `CookedIPhone/Coalesced_INT.bin` 后，
`IPhone-SwordEngine.ini` 的 `Engine.Engine` 配置为：

```ini
bSmoothFrameRate=TRUE
MinSmoothedFrameRate=20
MaxSmoothedFrameRate=35
```

`SystemSettingsIPhone4` 的 `MobileContentScaleFactor=2.0`。
这些是静态配置证据；是否在真机分支被其他运行时设置覆盖，需要实际运行验证。
先测试原包，再决定是否在独立副本中调整限帧设置；不能只修改上限就宣布达到 60 fps。

## 本地测试环境

使用正式控制台的 Install IPA 对话框、准备 Worker、CPU Worker、
原生 MobileInstallation 和持久 OPFS NAND。测试盘来自已正常关机的独立 NAND 副本，
不操作机主原有虚拟机。测试产物在忽略的 `build/ios/infinity-blade/`。

```sh
BROWSER_FOCUS=1 TEST_ARTIFACT_DIR=build/ios/infinity-blade/acceptance \
  BROWSER_DEBUG_PORT=9490 TIMEOUT_MS=7200000 \
  node tests/app/browser_runner.mjs tests/ios/ui-install.html \
  isolated=1 webgpu=1 autoplay=1 probe=build/ios/infinity-blade
```

大文件通过 CDP `DOM.setFileInputFiles` 选择本地原包，仍由真实文件输入框触发检查及安装，
避免测试脚本额外构造一个 582 MiB 的内存副本。

## 验收状态

| 验收项 | 本轮结果 |
| --- | --- |
| 真实 UI 安装 | **通过**。MobileInstallation 完成，原生回查版本 1.4.3 和主程序代码摘要一致 |
| 真实 UI 打开 | **请求被接受**。创建 `SwordGame`（pid 107），GLI 创建 context 37，原生屏幕显示 Unreal 启动画面 |
| 进入动态游戏 / 可交互场景 | **失败**。首次加载触发媒体服务线程中的内核 panic |
| 游戏 FPS / 60 fps 目标 | **无法测量 / 未通过**，不能把启动画面或浏览器刷新计为游戏帧率 |
| 原包完整性 | 测试后 SHA-256 与测试前一致 |

本轮旧核心的时间线，从测试页面加载起计（包含盘复制、启动和人工操作间隔，
不是冷启动成绩或游戏加载成绩）：

| 事件 | 时间 |
| --- | ---: |
| 开始向原生助手传输 | 195 s |
| 613,364,632 bytes 传输完成 | 1081 s |
| 原生 SHA-256 校验完成、staged | 1154 s |
| 再次校验后调用原生安装器 | 1228 s |
| 原生版本 / 代码摘要回查通过 | 1502 s |
| UI 点击 Open application | 1504 s |
| 原生启动请求接受 | 1508 s |

### 首次运行的确定性阻塞

串口报告：

```text
panic(cpu 0 caller 0x8008ce28): kernel abort type 4:
fault_type=0x3, fault_addr=0xd2f048f0
pc: 0x807fc1cc
Task ... pid 42: mediaserverd
```

通过正在运行的客户机页表核对，故障 VA `0xd2f048f0` 映射到物理地址
`0x841008f0`。10B329 原始 DeviceTree 的 `/arm-io/amc` 声明了
`0x84100000+0x3000`、`0x84000000+0x40000`、`0x84300000+0x5000` 三个银行；
故障 PC 位于预链接的 `com.apple.driver.AppleAMC_r2` 176.0.0
（`0x807f5000+0x79000`）。本轮 CPU 的 MMIO 表没有覆盖该地址，N90 设备构造器也没有 AMC。
这是已定位的音频硬件缺口，不能作为 IPA 签名失败或纯 GPU 性能问题处理。

GLES 累计 draw 数停在 127，命令拒绝和着色器编译错误均为 0；这些主要是系统/UI
启动画面的绘制，**127 不是 FPS**。在解决 AMC 访问、验证音频解码路线和重新进入动态
游戏前，不应发布游戏帧率结论，也不应只填充零寄存器或伪造音频任务完成来宣称通过。

后续顺序：验证 AMC 的寄存器、任务队列与完成中断，或通过原生软件解码路线完成兼容性
验证；通过正常游戏场景后，再加入应用实际 present 的帧时间采样、检查限帧设置，
区分 CPU、GPU 和 IOSurface 回读成本并做 A/B。60 fps 仍是未达成的目标。

### 保留的本地产物

`build/ios/infinity-blade/` 保留了预检、指令采样、原生进程状态、完整串口 panic、
`acceptance/launch-*.png`、`acceptance/launch-samples.json` 和 `result.json`。
已安装的独立测试盘另存为 `installed-after-panic.packed`，大小 4,000,751,104 bytes；
关闭虚拟机后分块导出、合并并记录 SHA-256，避免丢失这次大包安装成果。
此盘经历内核 panic 后的强制断电，下一次需要正常文件系统恢复，不能用来冒充干净关机的
冷启动性能样本。原有机主虚拟机和 Downloads 原包均未修改。

## 已定位的 CPU 开销

第一次大包上传时，指令采样发现 A32 的 `0xe8906ff0` 和 `0xe8806ff0`
各执行了超过 3200 万次 helper。这是包含 SP 的 LDM/STM 数据寄存器列表，
属于合法 A32 指令，JIT 原先过度保守地拒绝整个列表。现允许 A32 的 SP 参与批量搬运；
保留 T32 的限制、基址重叠检查，以及未对齐/跨页/非 RAM 的原有回退路径。

新增 `qspcopy` 的 10 个案例覆盖 IA/IB/DA/DB、写回、单独 SP 和条件不成立。
解释器及启用 MMU 的 JIT 均与 QEMU 一致；JIT 循环的总 helper 数为 9。
原有 10 组 A32/T32 回归通过，40 个随机程序、每个 100 个构造运行 32 轮，差异为 0。
主核心与 fallback 均已构建。当前测试 VM 的核心在改动前已载入，因此上述首次运行结果
仍来自旧核心；本轮没有对新核心做游戏帧率 A/B，不声称它已提高游戏 FPS。

## AMC 兼容性续作（2026-11-14）

以下改变已经分别验证并提交；上面的失败记录保留为首次测试基线。

| 步骤 | 提交 | 实际改变 / 验证 |
| --- | --- | --- |
| DMA 停止握手 | `dc23b2b0` | 返回停止确认，保留未传输数据；不伪造成功完成 |
| AMC 控制和 SRAM | `e432c6f8`, `5ed4b804` | 映射三个 DT 窗口，引擎复位状态、屏蔽/应答、旧快照默认状态，正式 Worker 构建通过 |
| DMA 复位游标 | `d1dc5265` | 复位后保留 MAR/描述符，避免原生 abort 路径解引用零游标 |
| 真实 AAC 后端 | `d394ef5c` | 用 WebCodecs 解压自生成双声道测试音；检查非零能量、幅值、声道频率和输出帧数 |
| AMC 输入/输出队列 | `880aa904` | 有界链表遍历、AAC 原生参数、逐帧输出、S24-in-S32 打包、engine-0/CDMA 有序交付；循环链表走错误路径 |
| I2S PCM 传输 | `0b563f54` | 按 PMGR bit clock / 64 和客户机单调时间搬运原生 PCM，更新 DMA 游标，音频中断送 AP；正式控制台启用扬声器 |
| AMC 汇总中断 | `7bb39907` | 内部完成位通过控制器汇总输出，避免把内部 bit 编号误当 VIC 引脚 |

已通过的针对性验证：

```sh
node tests/ios/amc.mjs
node tests/ios/cdma-pause.mjs
node tests/ios/i2s-pcm.mjs
node tests/ios/devices.mjs
node tests/app/vm_config.mjs
node tests/app/browser_runner.mjs tests/ios/amc-decoder.html
node tests/app/browser_runner.mjs tests/ios/amc-codec.html
make app
```

AAC fixture 是自行生成的 44.1 kHz 双声道正弦音（左 1000 Hz、右 1500 Hz），
没有游戏或固件资源。集成测试使用真实浏览器解码，验证一个 1024 帧 AAC 输出经 AMC
本地缓冲、engine-0 列表及 CDMA 写入 DRAM 的 8192 bytes S24-in-S32；完成通知晚于真实
数据交付。I2S 测试在 10 ms 客户机时间内仅消费 441 个立体声帧，5 ms 时不提前报告完成。

开发阶段的原生输入已实际解出 22 个 AAC 帧（45,056 个声道样本），确认单个压缩输入 DMA
会包含多个音频帧，输出环需要逐帧推进。该次含临时诊断的运行不作为正式验收；
新的完整正式构建正在从持久安装盘冷启复测。**目前仍未验收可游玩场景或 60 fps。**

实现是已观测到的 10B329 AAC 程序的 HLE，不是通用 DSP 指令仿真；未知程序不制造静音
成功结果。带有未释放解码器的 AMC 状态暂不保存 RAM 快照，避免丢失解码历史后恢复错误
音频；NAND 持久数据与此不同。原生 PCM 交付、可听播放和游戏场景需要分别验证。

寄存器、链表和输出打包的参考为公开的
[AMC 模型](https://github.com/samhenrigold/qemu-ios/blob/main/hw/arm/ipod_touch_amc.c) 与
[A4 CDMA 模型](https://github.com/samhenrigold/qemu-ios/blob/main/hw/arm/s5l8930_cdma.c)，
并用机主提供的 10B329 驱动实际访问复核；新实现及生成音频测试位于本仓库。

### 正式构建的原生 AAC 验证

重新从已安装 NAND 冷启动后，通过控制台 Install IPA → Open application 启动游戏；
第一次请求时桌面尚未准备完毕，后续在解锁后的 UI 重试成功。游戏显示了原生推送通知
提示，关闭后开始播放启动电影。未使用内存快照或临时设备覆盖。

运行采样中 AMC 累计处理 77 个压缩输入、3,397,632 个声道样本，向原生 DRAM 交付
13,574,144 bytes PCM，I2S 消费 2,501,689 个立体声帧；错误数 0、完成中断均已应答。
这验证了 AAC 多帧队列、CDMA、汇总中断和原生音频消费持续前进。浏览器中的可听音质
尚未独立录音验收。启动电影目前显示 QuickTime 占位画面，继续检查电影结束后的游戏
场景；这不是可游玩或帧率通过的证据。

本地证据保存在 `build/ios/infinity-amc/` 的 `native-audio-success.json` 和
`acceptance/amc-running.png`、`after-push.png`，不提交游戏资源或持久盘。

### 图形兼容和资源加载续作

- `b7322707`：实现 GLES 1/2 各向异性过滤的参数、查询和 WebGPU sampler；
  参数下界、最大值、逐纹理状态和 cache key 均已回归。
- `48e7f9b3`、`778634c1`：PVRTC1 压缩纹理直接通过协议送宿主，避免原先在 ARM
  客户机中逐像素解压再传 RGBA。宿主缓存每个压缩字的端点和解交错地址；
  生成数据的 2/4 bpp、矩形和小 mip 哈希与参考一致，真实 GPU 的四种格式上传/整级
  替换通过。完整 GLES executor 浏览器回归 91 项通过，无 WebGPU validation error。

旧路径原生加载线程的 PC 落在自有适配器 `upload_pvrtc` 中，加载期间上传接近千个
纹理 mip。Node 宿主微基准中，512²/1024² 随机 PVRTC 解压并哈希分别约 117/323 ms；
这是纹理加载测试，不能当作游戏 FPS。

测试专用 NAND 已通过原生文件系统的 atomic-file/fsync 路径写入新版自有适配器，
同时向下一代启动归档加入其代码摘要，保留已安装游戏。该阶段用了隔离机器里的
一次性诊断入口来暂存组件，随后重新冷启，正式运行不包含该内存覆盖。归档 generation 4
回读通过，游戏身份仍为 `com.chairentertainment.birthright` 1.4.3。
更新后的独立盘另存 `build/ios/infinity-amc/adapter-updated.packed`（4,002,422,272 bytes，
SHA-256 `e45d263fdde3f1d9e11eccf626e6768cba21266bc65d50f81fb08468c93930c3`）。
这不是对已有用户虚拟机的组件自动升级功能。

旧运行还观察到 depth/stencil renderbuffer 未分配，导致游戏 draw 被拒绝；正在新一轮
冷启中采集原始调用参数继续解决，仍未验收可玩场景或 60 fps。

### 核对实际加载的适配器

原已安装游戏的依赖是 `/usr/lib/libv86gles.dylib`，所以仅更新数据卷路径不足以启用
新解压器。隔离测试盘的系统卷空余不足以原子保留两份库；通过原生文件系统对自有
库原位替换、fsync 并重新挂为只读，实际 write 返回 76,336 bytes。原固件和测试盘备份
均保留；未删除系统提示音或其他无关文件。含系统库更新的测试盘另存为
`system-adapter-updated.packed`，SHA-256
`0633b011ba2bf0c40b3732abd77bd27ed57467597260da1b15503b95767d0942`。

新的隔离验收目录为 `build/ios/infinity-play/`，从上述盘重新冷启动；未恢复内存覆盖。
`node tests/ios/gl-scalar.mjs <10B329 cache>` 的 76 个原始 OpenGLES 入口全部发出
正确协议参数。原始 renderbuffer 失败记录中的 format 为 `0x88f0`，但 width/height
为指针/返回地址，说明必须核查实际加载的桥接库及其 ABI，不能改成忽略深度缓冲。

### 原生 drawable 查询与实际 glslang 路径

`7429e7e8` 补齐原生 `glGetRenderbufferParameteriv`：之前函数表中的默认无效操作没有
写调用方指针，游戏使用了未写入的宽高。真实 OpenGLES 入口回归覆盖宽、高和深度位数
的写回；`4c2b74fe` 为 scalar 回归增加 MMU/JIT 模式，确认实际执行了编译代码。
修复后 generation 5 的正式冷启动记录 `glRenderbufferStorage(0x8d41,0x88f0,960,640)`，
不再拒绝深度缓冲创建。测试库写入与启动归档回读均通过，游戏安装记录保留。

`58f44e83` 修复实际 iOS 的 API 20 / GLSL ES 1.00 经 glslang 路径：该路径原先将
PVRTC 交给 GLES3 压缩格式分支，925 次上传没有生成 texel，虽然基础 API 2 的测试通过。
现为该路径执行同一真实 PVRTC 解码并上传到 RGBA GPU 纹理。GLES3 executor 真实 GPU
回归 107 项通过，包含四种 PVRTC 格式的上传、替换与各向异性 sampler。

最新含 query 修复的测试盘保存在 `build/ios/infinity-play/query-fixed.packed`，
启动归档 generation 5；正在完整正式构建中重新冷启验收可玩场景，仍无可发布的游戏 FPS。
