# iOS 6 桌面和 2D 游戏性能

## 计量协议（2026-11-17）

`tests/ios/ui-performance.html` 分别测试 SpringBoard 翻页与 PvZ 实际关卡。先通过真实 UI 定位场景，
用 `setup=1` 和 `checkpoint_save('springboard'|'pvz')` 流式保存 RAM。关闭浏览器后，克隆整个测试
profile，保证 RAM 与 OPFS NAND 的身份、内容和代次配对；每一轮重新克隆，不复用上一轮推进后的磁盘。
macOS 用现有 `tests/ios/clone-battle-profile.mjs` 创建 APFS 共享副本，不新建原始 NAND/HFS 镜像。

桌面交替执行左右 600 ms 拖动，仅统计移动阶段。按下后的 150 ms 等待、松手后的 650 ms 停顿及
截图暂停均排除。PvZ 记录同一关卡检查点的实际游戏画面，预热后计量固定时长。
采用 normal、rate 1 的虚机时钟；任何息屏、黑屏或零画面更新窗口均拒绝。
LCD FPS 来自 CLCD 内容变化，游戏发布 FPS 来自完整成功发布的应用 IOSurface；两者分开报告。
本地 ARMv6 PvZ 1.0 的应用 drawable 实测为非 Retina 的 320×480，不能沿用 Infinity Blade 的
960×640 计数筛选。其他样本可通过 `width` / `height` 指定实际尺寸。发布计数可能包含内容相同的帧，
不能直接等同于肉眼可见的新画面数。
同时保留完整前后诊断、宿主负载/空间/Chrome 进程 CPU 时间及起止截图。
进程 CPU 时间不是 GPU 硬件耗时，多个表面的读回等待也可能重叠，不能直接相加解释全部时间。

第一轮桌面控制 `desktop-control-1` 预热 4 次拖动，20 次计量拖动得到 309 次可见更新，
活动窗口 12,266.18 ms，**25.191 FPS**。对应 CLCD 扫描累计 885.635 ms，共有表面的读回等待
累计 3,482.215 ms；仍有明显 JIT 活动。因此后续默认预热提高为 40 次拖动，再做配对复测。
这轮仅为较短预热的基线，不作为未验证候选的加速成绩。

场景图片、检查点及原始数据仅保存在本地 `build/ios/ios6-2d/`，不提交用户固件、游戏或浏览器数据。

## 线程采样与 IOP 调度候选撤回

40 次桌面预热后的独立 20 秒采样，主线程 idle 权重约 89.37%；CPU Worker 的 IOP 包含权重约
40.87%，其中反复读取 PMGR 24 MHz 计数器的路径明显，`performance.now` 自身约 18.5%。包含权重有
重叠，不能相加；采样窗口用于归因，不作为 A/B FPS。

尝试将每次 AP 宿主返回附带的 4096 条 IOP 指令改为按 AP 累计执行量或 1 ms 到期触发；中断、等待
AP、复位和 NAND 轮询保持服务。定向调度边界、原生 IOP counter/status、iOS 回归、构建和类型检查
均通过，但同一检查点的反向复测没有稳定收益，因此撤回运行时、Makefile 和候选单元测试。

| 场景，可见 LCD FPS | 控制 1 | 候选 1 | 候选 2 | 控制 2 |
| --- | ---: | ---: | ---: | ---: |
| 桌面，40 次预热、20 次计量拖动 | 25.947 | 24.409 | 25.672 | 25.634 |
| PvZ 1-2 开局，一株向日葵与教程文字，10 s 预热、20 s 计量 | 25.697 | 26.298 | 24.948 | 27.700 |

PvZ 的应用发布 FPS 分别为 25.697 / 26.348 / 25.198 / 27.850；可见更新与应用发布均无一致改善。
窗口为 normal rate 1，无 discarded host time 或未定义指令。场景起止图片已核对。
未优化 CPU worker SHA-256 为 `fbdbec997f7678941c69c36e82551079ce8a7cfab14b67b73c467165e5179851`，
候选为 `29328a379385e5767e7fc73b98003f28d1a2373e67ec37d4e47112edbf925535`，两者使用同一 Wasm。
测试 runner 新增 `BROWSER_CPU_WORKER` / `BROWSER_WEBGPU_BUNDLE`，固定读取保存的对照 JS，
避免覆盖共享构建。后续宿主进程时间边界移到预热之后；早期包含预热的 CPU 时间不可与其混算。

本轮曾作废一个运行期寄存器组诊断后的设置副本，并从原种子重新克隆；不把该设置现场计入 FPS。

## 连续 IOSurface 条带共用 GPU 读回

原生适配器将一幅画面分成条带回读。执行器现在对连续、同方向的条带先读回整幅 GPU 图像，继续按
原协议逐条返回 BGRA 字节。新发布从 y=0 重新读取；不连续条带、方向或表面变化重新取 GPU 数据，
其他协议记录使缓存失效。缓存只保留一幅且限于 16 MiB，恢复状态时重置，保留窗口行序和最终发布语义。
真实 GPU 检查证明连续条带可以只做一次读回，覆盖跨批次/同批次、多行反向条带及写入后失效。

固定未优化 CPU worker 与相同 Wasm，仅切换 WebGPU bundle；每轮重新克隆同一 RAM/NAND：

| 场景，可见 LCD FPS | 控制前 | 缓存 1 | 缓存 2 | 控制后 |
| --- | ---: | ---: | ---: | ---: |
| 桌面，40 次预热、20 次计量拖动 | 25.634 | 26.722 | 26.248 | 25.466 |
| PvZ 1-2 开局，10 s 预热、20 s 计量 | 27.700 | 27.998 | 28.599 | 27.399 |

两轮均呈小幅改善，均值约为桌面 +3.7%、PvZ +2.7%，尚未达到 60 FPS。该结果只覆盖所列场景，
不能代表整场 PvZ 的平均帧率。原始结果为 `*-cache-*`，起止截图与 normal rate 1 时钟已核对。
控制 WebGPU bundle SHA-256 为 `06476b82d6bdcc5934776b8af61a3a215fd9a7b0783559aac4409208bdc1ca7e`，
缓存版本为 `4236eabbb7746540dca8e6ad4c1dacbe779806890751624de08794615403abd6`。
GLES 单元、198 项 ES1/ES2 GPU、107 项 ES3 GPU及跨进程 IOSurface/快照像素回归通过。

## LCD 完整亮度的 Wasm SIMD 像素转换

变化帧原来在 JS 中逐像素比较并交换红蓝通道。现在复用预分配的 Wasm staging，四像素一组转换为
不透明 RGBA；比较 shadow 保持原始 BGRA，来宾 RAM 不修改。部分亮度、并行核心及旧 Wasm 保留
原路径。转换本身不分配内存，避免使 JS 持有的 Wasm 视图失效。

真实 Wasm 组件测试中，300 个变化帧的旧 staging + JS 路径为 314–320 ms，新路径为 112–118 ms。
同一 GPU 缓存版本、成对检查点的 A/B/B/A 结果如下：

| 场景，可见 LCD FPS | 控制前 | SIMD 1 | SIMD 2 | 控制后 |
| --- | ---: | ---: | ---: | ---: |
| 桌面，同上拖动协议 | 26.332 | 27.074 | 27.106 | 26.800 |
| PvZ 1-2 开局，同上协议 | 28.699 | 29.295 | 28.848 | 28.745 |

本步骤均值提升约桌面 +2.0%、PvZ +1.2%。桌面计量窗口的 CLCD 扫描累计耗时从 920–930 ms
降至 399–406 ms；整机收益远小于组件收益，说明转换只占整个执行链的一部分。
全部窗口 normal rate 1，无 discarded host time 或未定义指令，起止图片已核对。
原始结果为 `*-simd-*`。SIMD CPU worker SHA-256 为
`aa569c75d4764e373c50730d0dc0c97d86e8c0545714e157b8e9880a280f6bad`，Wasm 为
`77bb5ddf33dacc2b143b53d41e6b72bef105d385425fb38b9ddccecfb49e6e53`。
SIMD 与非 SIMD Wasm 均通过逐字节像素、alpha、尾部、背光、DART、内存增长、快照和并行回退测试；
`make ios-tests`、`make app-check app` 通过。

## Worker 内条带缓存候选撤回

进一步尝试把完整 BGRA 回复保留在 CPU Worker，连续条带不再逐次向页面请求，并将完成发布的
行序提交与捕获分开。功能检查通过，实际计数也确认命中（首轮桌面 358 次捕获、1,060 次缓存条带）。
但新增整帧复制的首版和直接保留传输回复的第二版，均没有同时改善两个场景，因此撤回运行时与
相关候选协议/测试，不加入最终产品。保留 runner 的 `BROWSER_GLES_PLUGIN`，便于独立固定插件对照。

| 场景，可见 LCD FPS | 控制前 | 首版 1 | 首版 2 | 控制中 | 免复制 1 | 免复制 2 | 控制后 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 桌面 | 26.189 | 26.364 | 25.459 | 26.650 | 27.931 | 25.727 | 26.066 |
| PvZ 1-2 开局 | 29.148 | 28.649 | 28.898 | 28.748 | 27.698 | 29.198 | 29.099 |

免复制版两轮均值相对中/后对照为桌面约 +1.8%、PvZ 约 -1.6%，不足以保留这项复杂度。
宿主 10 个逻辑处理器，记录到 20–35 的一分钟 load average，存在 VS Code 索引与系统后台活动；
这些负载不能直接换算为某一个线程的占用，但提示小幅差异需要反向对照，不能挑最好一轮宣传。
对照 GLES 插件 SHA-256 为 `1fae5b2890819c9a986e3ae1bdee6e16b50c20b781be2baa6cacca18183cf276`，
免复制候选为 `de194543c15d53716ae99197f1063b3eba9c0576d09627bc1f88ef6c105dae0a`。
原始结果与撤回补丁仅保存在本地 `*-thread-*` / `thread-rejected.patch`。

## PvZ 1.0 的应用自身调度上限

检查用户提供的原始 `Plant vs Zombies V1.0.ipa`（SHA-256：
`25bd09f5da779abac6aa2a90bd243f280df3975eba990d667cb204801a76c9c8`）发现：

- ARMv6 `AppController::startAnimating` 在原始虚拟地址 `0x156de8`。
- `0x156e54` 把第一个 Objective-C 实参 r2 设为 2，随后调用 `setFrameInterval:`。
  `0x156e58` 的 PC 相对取址解析到 selector 引用 `0x239e70`，字符串地址 `0x20d5ac`，确认不是
  仅凭立即数猜测。调用在 `0x156e68`。
- 同一函数的备用 NSTimer 分支加载 `0x156f54` 的 double 常量
  `0x3fa1111111111111`，即 `0.03333333333333333` 秒。

[Apple 对 frameInterval 的说明](https://developer.apple.com/documentation/quartzcore/cadisplaylink/frameinterval?language=objc)
规定值 2 每两个显示刷新触发一次。因此，在本设备 60 Hz 的显示时钟下，该版本主动按约 30 FPS
调度，两条代码路径一致。观察到接近 30 的发布帧率不能全部归因为模拟器没有达到 60。
兼容运行原始应用时应先优化 30 FPS 的稳定性；60 FPS 还需要另行评估应用调度和更新逻辑的修改，
不能通过加速虚机时钟、重复呈现旧帧或修改 FPS 计数来达成。

本轮没有修改游戏二进制或游戏速度。SpringBoard 翻页仍以真实 60 FPS 为目标。
诊断反汇编仅保存在本地；临时解出的可执行文件在验证后删除，不提交游戏内容。

## 两项保留优化的组合复测

用户确认 PvZ 保持原版行为，目标调整为优先稳定 30 FPS；桌面仍以 60 FPS 为目标。
重新通过 UI 建立 1-2 关实战现场，包含豌豆射手、向日葵、行走/啃食僵尸及阳光，流式检查点
为 578,509,282 字节。该片段涵盖攻击、走动和植物被啃食的变化，不代表后期大量单位或整场平均。

固定同一原生适配器和 GLES 插件，以任务开始时的 CPU worker/Wasm/WebGPU bundle 为控制，
以 GPU 读回缓存 + SIMD 转换为优化组。每轮独立克隆配对 profile，桌面仍为 40 次预热、20 次
计量拖动；PvZ 仍为至少 10 s/60 发布帧预热、20 s 计量：

| 场景，可见 LCD FPS | 控制前 | 优化 1 | 优化 2 | 控制后 | 配对均值提升 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 桌面翻页 | 25.463 | 27.217 | 27.209 | 25.433 | +6.9% |
| PvZ 1-2 实战片段 | 25.747 | 27.499 | 28.949 | 25.549 | +10.0% |

PvZ 原生发布 FPS 为 25.797 / 27.599 / 28.999 / 25.499。所有窗口 normal rate 1，无 discarded
host time 或未定义指令，画面中没有失败菜单或息屏。起止图片已核对。
结果在 `desktop-final-*` / `pvz-combat-*`。桌面尚未达到 60 FPS；PvZ 接近原版 30 FPS 上限，
本次观测仍有波动，不能宣称已稳定锁定 30 FPS。

## 计数器访存入口候选撤回

在原有 IOP PMGR 标量读实现之前增加 MMU-off、注册 MMIO、访问宽度及对齐守卫，让常见读直接
进入同一时钟/同一 bounce 槽逻辑，省略通用 RAM 访问缓存的准备。每次仍采样时钟，不缓存高位，
不减少 IOP 指令或调整调度。SIMD/非 SIMD、低高位溢出、暂停恢复、LDM 回退、守卫与通用入口
差分、AArch32 页 JIT/fuzz、JIT MMU、IOP 状态和 iOS 回归通过。

暂停时钟的组件测量中，100,000 次读取稳态约从 5.4–5.5 ms 降为 5.0 ms，不能直接推断整机收益。
固定前述两项已保留优化，只切换 Wasm 的 A/B/B/A 如下：

| 场景，可见 LCD FPS | 控制前 | 候选 1 | 候选 2 | 控制后 |
| --- | ---: | ---: | ---: | ---: |
| 桌面 | 27.077 | 26.912 | 27.365 | 27.141 |
| PvZ 同一实战检查点 | 28.898 | 28.149 | 29.248 | 29.448 |

桌面均值仅 +0.1%，PvZ 约 -1.6%，所以撤回运行时及候选测试。组件优化没有带来可确认的帧率
改善，最终构建仍为 GPU 读回缓存 + SIMD 转换。原始数据在 `*-counter-*`，撤回补丁仅在本地
`counter-rejected.patch`，候选 Wasm SHA-256 为
`6ccc71a43e5c506fc8f02787bd046bba84c218c09cdb2469bd6a809deb0790ea`。

## 最终构建与存储

撤回候选后，最终 Wasm/CPU worker/WebGPU/GLES 插件哈希分别恢复为上述
`77bb5ddf…` / `aa569c75…` / `4236eabb…` / `1fae5b28…`，与组合复测的优化组完全一致。
重建、`make app-check app ios-tests`、SIMD/非 SIMD 的强制转换检查及原生 IOP counter 检查通过。
此前通过的 198 项 ES1/ES2、107 项 ES3 和跨进程 IOSurface 像素测试使用同一最终 GPU bundle。

保留桌面与新实战的配对种子，删除已关闭的工作副本、旧开局种子及临时解包的游戏可执行文件。
本轮没有创建原始 NAND/HFS 临时 `.img`；原始测试 profile 和 Downloads 中的 IPA 未作删除。

## 桌面继续分析：传输调用与线程时序

新增只用于诊断的 `desktop-profile-worker.js`、GLES 插件探针及构建/采集工具。探针在 JS/Wasm
调用边界计时，不切换寄存器组，不改来宾时钟、IOP 预算或设备响应；环形事件记录上限 131,072。
正常构建不加载这些入口。先用 `tools/ios/build-desktop-profile.mjs` 构建，在独立 runner 上指定
`BROWSER_CPU_WORKER=build/ios-desktop-profile-worker.js` 和
`BROWSER_GLES_PLUGIN=build/ios-desktop-profile-gles.js`，随后运行
`tools/ios/capture-desktop-profile.mjs build/ios/<prefix> [debug-port]`。

同一桌面检查点、40 次拖动预热后的 20.26 s 诊断窗口中，AP Wasm 调用累计 10.19 s，IOP 7.64 s；
这些包含时间与帧请求/宿主排队有重叠，不可相加作为完整独占分解。观察到约 166,544 次机器调度、
226,082 次 GLES 非读传输调用和 47,269 次空读重试。保留下来的末尾 2.26 s 时间线有 220 个完整
配对 GPU 请求，等待中位数 0.282 ms、95 分位 6.380 ms。下一步验证频繁 UDF 图形传输入口的
解释器往返是否可减少；IOP 的采样权重本身仍不足以证明限帧原因。

该采样运行带探针与 V8 Profiler，仅用于归因，不计入 FPS 优化成绩。原始资料为本地
`desktop-trace-2-{trace.json,cpu.cpuprofile,main.cpuprofile}`；诊断页面完整运行、场景检查通过。

## 图形 UDF helper 候选复核后撤回

尝试让精确匹配的 A32/T32 用户态图形 UDF 直接进入 page helper，省去再次取指和解码。
保留 PL0、调用 magic、IT 条件、真实空读 yield，并在调用后退出当前 activation，防止回复
写入代码页后继续执行旧代码。真实 MMU-on ARM/Thumb 差分、自修改代码、设备缺失及
非 SIMD 构建、iOS 回归和 AArch32 page/fuzz 通过。早期 MMU 命令指向不存在的
`jit_mmu.mjs`，不能计为已通过的检查；候选最终未保留，也未据此声称通过该检查。

固定同一 528,555,214 字节 SpringBoard 检查点和 NAND 配对，正常 rate 1、40 次预热及
20 次计量拖动，只切换 Wasm，进行了两组独立 A/B/B/A：

| 可见 LCD FPS | 对照前 | helper 1 | helper 2 | 对照后 | 均值变化 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 既有运行 `desktop-helper-*` | 25.184 | 25.540 | 26.773 | 23.817 | +6.8% |
| 继续复核 `desktop-helper-confirm-*` | 26.358 | 25.830 | 25.851 | 24.550 | +1.5% |

复核中候选低于前对照、高于后对照，未确认稳定收益，撤回运行时和候选测试。
所有窗口保持屏幕唤醒，无 undefined、discarded host time；起止场景为同一正常桌面。
继续使用 GPU 条带读回缓存和 LCD SIMD 转换。候选补丁、测试及原始结果只保存在
本地 `build/ios/ios6-2d/helper-rejected*` 和上述运行目录，未提交来宾数据。

## IOP 计数器 JIT 入口候选撤回

另一候选在 IOP 的标量 LDR 模板里守卫两个精确的 PMGR 物理地址，跳过必然不能命中的
RAM access cache；专用 helper 仍检查 IOP、MMU-off 和当前 MMIO 映射，每次读取同一
机器时钟。没有缓存计数值、减少 IOP 指令或改动调度。高低位溢出、暂停/恢复、AP 拒绝、
非对齐/相邻地址、MMU-on 拒绝、移除 MMIO 和 LDM 回退检查，以及 SIMD/非 SIMD 构建、
iOS 回归、QEMU JIT MMU 300 cases / 4,285 probes 均通过。

同一 RAM/NAND 配对、40 次预热和 20 次计量拖动，只切换 Wasm：

| 可见 LCD FPS | 对照前 | 候选 1 | 候选 2 | 对照后 |
| --- | ---: | ---: | ---: | ---: |
| `desktop-inline-counter-*` | 23.383 | 22.279 | 24.075 | 23.435 |

候选均值约 -1.0%，没有确认改善，撤回运行时及候选测试。所有窗口 normal rate 1、
屏幕保持唤醒，无 undefined 或 discarded host time，起止桌面已核对。
宿主存在并发 Node/Chrome、C++ 索引和存储管理负载，此组只能与自己的前后对照比较。
原始资料与 `inline-counter-rejected.patch` 留在本地，不把组件路径缩短当作 FPS 成绩。

## 区分 AP 等待和 IOP 时间片

诊断工具现在可用 `IOS_PROFILE_STEPS=1` 临时打开指令统计，保存开始/结束诊断及原 JIT
开关，结束时恢复开关；只在独立诊断 worker 中使用。采集器等待 CPU Worker 就绪，避免
在页面尚未创建 worker 时过早失败。AP 返回的等待时间另计 `ap.wait` / `ap.run`，不切换
寄存器组，也不更改来宾时间。

正常构建的同一桌面检查点、40 次预热后，20.258 s 诊断窗口有 141,813 次 IOP 时间片，
累计 6.525 s；AP 75,408 次返回等待，仅消耗 0.394 s，另有 66,405 次运行返回。
IOP 每次仍获得完整的 4,096 指令预算；AP 等待不会减掉独立 IOP 的完整时间片。
这是后续独立 IOP 服务期限候选的依据，包含时间存在重叠，不能相加成独占 CPU 分解。
带统计/Profiler 的运行不计入 FPS 成绩。原始资料为本地 `desktop-phase-4-*`。

## 独立 IOP 服务期限候选撤回

尝试在正常时钟下按 1 ms 来宾时间为 IOP 提供独立时间片；AP 的 WFI 和图形 yield 不再
各自附带一次完整 IOP 时间片。IRQ/FIQ、复位立即处理；调度返回时间限制在下一次 IOP
服务期限以内，确定性时钟和显式 `iop.run()` 保持原预算。复位/恢复清除派生期限。
AP 等待/运行、时钟倒退、IRQ/FIQ、异步 NAND 的 32/4,096 指令预算、停止/重启与快照
边界测试，以及原生 counter/status、iOS 回归、类型检查及 app 构建通过。

固定同一配对检查点、Wasm、GLES、WebGPU，仅切换 CPU worker，仍用 40/20 拖动协议：

| 可见 LCD FPS | 对照前 | 候选 1 | 候选 2 | 对照后 |
| --- | ---: | ---: | ---: | ---: |
| `desktop-deadline-*` | 26.422 | 25.217 | 25.936 | 26.621 |

均值约 -3.6%，两轮都低于两个对照，故撤回运行时及候选测试。首对活动窗口的累计
page-tier native retirement 从 11.806 亿降到 8.212 亿，AP 自身 retirement 为 8.484 /
8.053 亿；说明减少执行工作没有转化为帧率收益，不能用 IOP 的包含时间直接认定它限帧。
该差值不是精确的 IOP 指令数，未编译指令与 AP 执行变化也会影响它。
所有窗口 normal rate 1、亮屏、无 undefined/discarded host time；起止桌面已核对。
本地保留 `deadline-rejected.patch`、测试及原始记录，产品继续使用原调度。

## Thumb IT 调用：桌面复核仍未确认收益

根据 AP 条件块回退采样，重新评估之前在 Infinity Blade 上未保留的最后 IT 槽 B/BL/BX/BLX
模板，仅允许合法最后槽和正确条件，保留 LR、跨 ISA、假条件及前置加载故障的 ITSTATE。
MMU-on QEMU 的 `qitcall` 32 个出口、完整 30 组 page、fallback 八组以及 seed 6017 的
40×100×32 随机程序均通过。最初未开 MMU 的 QEMU 命令不适用于含零地址故障的该组测试；
改用 `A64_MMU=1 A64_JIT=1 A64_JIT_HOT=1` 后通过，未修改原有 oracle。

仍从相同检查点重新克隆每轮 RAM/NAND，固定全部其他组件：

| 可见 LCD FPS | 对照前 | 候选 1 | 候选 2 | 对照后 |
| --- | ---: | ---: | ---: | ---: |
| 桌面 `desktop-it-call-*` | 27.351 | 27.739 | 27.217 | 26.691 |
| PvZ 实战 `pvz-it-call-*` | 28.548 | 29.649 | 29.245 | 29.449 |

首组桌面均值 +1.7%，追加反向复测却为候选 26.633 / 对照 27.268（-2.3%）。
三轮桌面每组均值合并仅约 +0.3%，无法确认可重复改善，因此撤回候选；PvZ 的约 +1.5%
也不足以抵消桌面复核不一致。保留原调度、原 IT 模板及已有两项图形优化。
所有窗口 normal rate 1、亮屏、无 undefined/discarded host time；桌面与实际战斗图片已核对。
原始记录、候选 Wasm 及 `desktop-it-call-rejected.patch` 仅保存在本地。

## AArch32 单步的精确指令字诊断

此前 `steps.stepped` 按指令类别累计，却只保存该类别最后出现的 word，不能据此认定某一个
word 的频率。新增有界的 `steps.a32_stepped_words`，仅在 `a64_step_stats=1` 时维护，
普通 UI 的开关 0 不更新直方图。取指/调试异常未成功读取指令时，排除遗留的 LAST_STEPPED，
并恢复旧诊断值以保留原类别统计的行为；不更改架构状态、异常或总执行量。

新增 0→1→0 各 64 次实际单步回归，检查每次 PC 正确前进和精确计数；随后故意取指失败，
确认不会重复计算前一条指令。主核心及非 SIMD 核心通过，原 helper 开关回归仍通过。
新静态表归类为 debug，状态布局检查、iOS 回归、类型检查与 app 构建通过。
只在独立诊断 worker 打开，采样结束恢复原开关；相关采样不计入 FPS。

## 全局 AArch32 GPR locals：桌面收益与游戏回退

整页只要有 opaque helper，原策略就让所有原生指令通过状态内存读写 GPR。尝试让所有
AArch32 页面保留 locals，在 helper 前后仍提交/重载完整存活 GPR，不改变精确 retry、
异常、NZCV 或页失效。完整 30 组 page、fallback 十组、QEMU IT 调用和 ARM32 特权/GIC
差分、seed 6021 的 40×100×32 随机程序、iOS 回归及原生 IOP 状态检查通过。

固定同一 RAM/NAND 配对和全部其他组件，桌面保持 40/20 拖动，PvZ 保持同一实战检查点：

| 可见 LCD FPS | 对照前 | 候选 1 | 候选 2 | 对照后 | 均值变化 |
| --- | ---: | ---: | ---: | ---: | ---: |
| `desktop-gpr-locals-*` | 27.242 | 29.662 | 29.700 | 27.893 | +7.7% |
| `pvz-gpr-locals-*` | 28.648 | 27.549 | 27.895 | 28.146 | -2.4% |

桌面两对均改善，但 PvZ 两对均回退，因此不保留全局策略，继续验证仅对 PL1 内核代码
放开缓存、EL0 保留原策略的较窄候选。桌面代码量约 76.6→75.2 MiB，
无 evictions；不把代码量变化当作 FPS。
所有窗口 normal rate 1、亮屏、无 undefined/discarded host time；场景图片已核对。
本地保留 `all-gpr-rejected.patch`、冻结构建与原始记录。

排除取指异常残留后的 20.251 s 诊断 `desktop-words-2` 记录到 BX LR `0x4770`
3,423,434 次、DCCSW `0xee070f5a` 886,784 次及 LDREX `0xe8531f00` 553,608 次。
这些是指令调用频率，不是独占耗时；后续同时验证内核缓存清理指令的解释器往返。

## 仅 PL1 GPR locals 候选撤回

为避免全局候选的 PvZ 回退，单独对 PL1 放开 opaque helper 页的 locals，EL0 保留原策略。
完整 page、fallback、ARM32 特权/GIC 差分、seed 6022 随机程序、iOS 和原生 IOP 状态回归通过。
同一桌面/实战检查点与同样冻结的其他组件，A/B/B/A 为：

| 可见 LCD FPS | 对照前 | 候选 1 | 候选 2 | 对照后 |
| --- | ---: | ---: | ---: | ---: |
| `desktop-pl1-gpr-*` | 26.874 | 25.509 | 26.195 | 26.353 |
| `pvz-pl1-gpr-*` | 22.049 | 21.348 | 24.547 | 25.298 |

桌面均值约 -2.9%，PvZ 约 -3.1%；两场景的两对均回退，撤回该策略，继续单独验证 EL0。
PvZ 组的前后对照有较大变化，只与本组相邻对照比较，不与先前接近 30 FPS 的运行混算。
所有窗口 normal rate 1、亮屏、无 undefined/discarded host time。
本地保留 `pl1-gpr-rejected.patch` 及全部原始结果。

## 仅 EL0 GPR locals 候选撤回

反向单独开启 EL0 的 opaque helper 页 locals，PL1 保持原策略。完整 page、fallback、
QEMU IT 调用、seed 6023 随机程序、iOS 与原生 IOP 状态回归通过。同一配对检查点：

| 可见 LCD FPS | 对照前 | 候选 1 | 候选 2 | 对照后 |
| --- | ---: | ---: | ---: | ---: |
| `desktop-el0-gpr-*` | 24.874 | 24.103 | 25.091 | 26.979 |
| `pvz-el0-gpr-*` | 20.898 | 28.398 | 27.147 | 24.397 |

桌面两对均回退，均值约 -5.1%，因此撤回此单独策略。PvZ 两对更快，但对照本身也明显
波动，不能将跨场景或跨组差值当作稳定收益。两种单独策略均未复现全局候选的桌面改善，
说明不能直接把包含采样和简单分组的收益相加。下一项实测全局 locals 与 DCCSW 原生空操作
组合，验证去掉内核单步/同步往返后的实际效果。
所有窗口 normal rate 1、亮屏、无 undefined/discarded host time，实战图片已核对。
本地保留 `el0-gpr-rejected.patch` 及原始记录。
