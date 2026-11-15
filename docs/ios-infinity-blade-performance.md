# Infinity Blade 安装与帧率验证

## 180 帧窗口的 AP 线程归属（2026-11-15）

从同一桥上配对检查点重新克隆，预热 8 帧，在后续 180 帧中仅对 AP 的
`a64_run_slice` 设置诊断边界，并在已有时钟读取处观察 TPIDRPRW/处理器模式
变化。IOP 与边界外设备处理不混入 AP 归属；结束后恢复全部原函数。
这是带开销的片段经过时间近似，包含宿主调度、时钟采样间隔偏差，不能当作
精确进程 CPU 时间或 FPS 对比。没有更改时钟返回值、寄存器或游戏逻辑。

82,057 个 AP slice、5,089,577 个时钟观察点合计约 23.33 秒片段时间：
SwordGame 用户态约 34.4%、SVC 17.3%、其他模式约 2.7%；backboardd 用户态
11.9%、SVC 5.6%；kernel_task 的 SVC/IRQ 合计约 15.6%；mediaserverd 各模式
合计约 5.7%。线程可识别，旧的“slice 前后线程不同即未知”方法已不用于此结论。
结束图与无采样 180 帧基准相同（`4a831d4becc27800…`），没有教学覆盖。

因此剩余开销涉及游戏、内核与显示合成，并非旧 AMC MP3 初始化忙循环仍主导。
具体耗时比例仍需结合 CPU profiler，不把归属片段百分比当作可直接回收比例。
证据为本地 `golem-ap-attribution.json`、`golem-ap-window.json` 及私有采样脚本。

## 桥上 Horned Guardian：180 帧动态战斗基准（2026-11-15）

从第一血脉起点按原生操作进入桥上战斗，完成闪避/反击提示。冻结关闭后的
`infinity-next/golem-battle-master-profile`，RAM 1,458,268,557 bytes，与其 NAND
配对；旧国王战斗和第一血脉起点主副本保留。临时的闪避提示快照不能充当 FPS
基准。操作、保存和图像均在本地 `infinity-perf-next/golem-*`。

独立恢复动态检查点，仍使用已接受的 IT FP helper 核心、正常时钟 rate 1、
保持检查点盾牌触点，预热 8 帧后测量 180 个完整 960×640 drawable 提交：
31,800.6 ms，5.660 FPS。计时区间 host pause/discard 计数不变，屏幕持续唤醒，
起/终图均无提示覆盖。玩家 HP 460 保持、敌人 HP 115 保持、盾 10→8，
终图为敌人新一轮攻击抬手，支持该窗口持续执行动态战斗而非停在教学界面。
三个循环使用的游戏缓冲区各增加 60 帧，面板也增加 180 帧。

起/终图 SHA-256 分别为 `b9ec3f60ac1f81d4…` / `4a831d4becc27800…`。
这是新场景自己的基准，不能与旧国王场景短窗口直接比较并计算优化收益；
也尚未达到 60 FPS。后续 A/B 必须每次从这份关闭的配对主副本克隆。

## NEON 整数/浮点转换：无稳定战斗收益，撤回（2026-11-15）

尝试在异常累计位已经置位时直接使用 Wasm SIMD 的有符号/无符号整数与 f32
转换，否则仍走原精确 helper。新增 `qneonconvert.a32.S`：ARM/Thumb、D/Q、
源目的别名、相邻 D 保持、边界/NaN/无穷/非规格化数、FPSCR 和 FP 禁用异常。
候选与原控制核心各通过 1,794 个独立 QEMU 对照出口；完整 28 组 page、
fallback 八组、seed 5536 的 40×100×32 随机程序通过。

同一配对战斗，预热 8/计量 30 帧的 A/B/B/A 为
5.263 / 5.480 / 5.309 / 5.363 FPS，renderer CPU 秒/帧为
0.4456 / 0.4421 / 0.4734 / 0.4535。第二对未复现收益；起图完全一致，
终图分别落在已核对的两个相邻动画帧，亮屏且正常时钟 rate 1，空间保护通过。
不将约 1–4% 的短窗口波动视作优化成功。撤回运行时改动，保留独立测试；
默认核心仍为已接受的 IT FP helper 版本。证据为本地
`infinity-perf-next/neon-convert-*`，没有提交游戏资源。

## 低空间保护与第二批过时文件清理（2026-11-15）

在新地图导航时可用空间一度仅约 240 MiB，先停止并关闭自有虚机。核对原 origin
的名称/长度后，移除已被第一血脉起点替代的旧剧情 RAM（1,110,040,515 bytes），
以及缺少解码历史的旧故障 RAM（1,108,619,821 bytes）；两者所有 NAND 均保留。
当前原战斗及第一血脉的配对主副本不变。删除记录为本地
`retired-prologue-ram/` 与 `retired-fault-ram/`，这两份旧 profile 此后仅可冷启动。

另外删除 11 月 4 日生成的 `bag-candidate.img`、`provisioned-s4.img`；历史计划
记录它们用于钥匙包/挂载实验。清理前核对精确长度、时间、普通文件、单硬链接和
无打开句柄；分配块合计 3,110,207,488 bytes。审计在
`obsolete-keybag-img-cleanup.json`。本轮累计清理的五份旧 img 分配块约 7.23 GiB；
RAM 长度与稀疏 img 的逻辑长度不冒充精确回收量，宿主交换文件也影响 `df`。

`battle-performance.html` 现在在创建虚机前、计量前及计量后核对宿主可用磁盘，
默认保留 1 GiB；不足时停止并报告失败，不接受该次 FPS。检查在计时区间之外。
用空临时 profile 将保留阈值提高到 10^15 bytes，实际验证在创建 iframe/虚机与
恢复 RAM 前因空间保护退出（预期 exit 1），没有加载检查点；记录为
`disk-guard.log`。无需实际填满磁盘来测试保护分支。

## 第一血脉导航检查点已保存并恢复（2026-11-15）

从配对剧情主副本继续正常运行，使用原生触摸保活。黑屏旋转指示期间 NAND
在独立 10 秒窗口读取 8,970,240 bytes，指令计数持续增加；继续运行后进入
`Start Bloodline` 原生画面。该段是导航/资源加载，不纳入战斗 FPS。

保存 RAM 1,008,609,217 bytes，关闭浏览器后冻结为
`infinity-next/bloodline-start-master-profile`，再从其克隆工作副本独立恢复。
恢复后正常运行 2.5 秒，截图仍为相同第一血脉起点，屏幕唤醒、clock rate 1。
它用于继续寻找更长的战斗窗口，尚未替代旧战斗 A/B 基准。配对源、保存记录、
恢复图分别在本地 `bloodline-state-save.json`、`bloodline-checkpoint*`、
`bloodline-navigation/bloodline-restored.png`，均不提交游戏资源。

同时只读检查实际接收的 63 个着色器，其中 7 个含 BoneMatrices、BlendWeight、
BlendIndices 及骨骼加权运算，表明后端已接收 GPU 骨骼处理路径；仅此不能量化
其当前绘制占比。原始检查在本地 `skin-shader-probe.json`。

## PL1 线程 ID 直访：实际战斗退步，撤回（2026-11-15）

针对高频 MCR p15,c13，尝试只在 PL1 将 TPIDRURW/TPIDRURO/TPIDRPRW 的
低 32 位读写直接生成访存；保留高半部，不涉及 CONTEXTIDR、翻译、Rt=PC、
MCR2/MRC2 或 EL0 权限处理。新增独立 `tests/a32/thread_id.mjs` 在恒等映射 RAM
中预热 ARM/Thumb 六轮、读写三寄存器及真假条件，全部输出与 QEMU 一致，另
核对高 32 位保持。加入 `a32-system-tests`；原控制核心也通过此 oracle。
系统 48 行、MMU 58 行 QEMU 对照、完整 27 组 page、fallback 八组及 thread-ID
oracle、seed 5535 的 40×100×32 随机程序通过。组件 steps 4088→1032。

同一战斗，预热 8/计量 30 帧的 A/B/B/A 为 5.496 / 4.452 / 4.514 / 4.823 FPS；
renderer CPU 秒/帧为 0.4446 / 0.4950 / 0.5040 / 0.4789。候选没有实际收益，
撤回运行时改动，仅保留独立测试和本地 `infinity-perf-next/thread-id-*` 证据。
起图一致，一张候选结束图为相邻动画帧，其余终图一致，亮屏且 rate 1。
默认源码和二进制继续保留已接受的 IT FP helper 优化。

## 长窗口准备与过期 RAM 隔离（2026-11-15）

剧情副本预热 8 帧后暂停虚机 10 秒，三个 renderer 合计仅增加约 0.26 CPU 秒
（`warm-idle-cpu.json`），不支持该窗口仍被大量后台 Wasm 编译占用的假设。
这不是所有场景的编译时间或持续战斗 FPS 测量。

长导航曾触发 iOS 1 分钟自动锁屏；该段未计入 FPS。通过 Home、滑动解锁、
原生 Settings → General → Auto-Lock 选择 Never，并截图确认。随后导航 runner
触发 15 分钟上限，NAND 已更新而 RAM 未重存：在关闭 profile 的原 origin 中核对
并删除其过期 1,110,040,515-byte RAM，保留所有 NAND，克隆为仅供冷启动的
`settings-never-cold-profile`。不能将任何旧 RAM 恢复到该 NAND。
原配对 `amc-battle-master-profile` 和 `prologue-progress-master-profile` 均未改变；
后续剧情导航从配对副本重来，采用原生触摸保活与分段截图，避免状态错配。

## 已接受 FP 优化后的剩余瓶颈（2026-11-15）

对 `df2a575c0` 核心重新克隆同一音频战斗，预热 8 帧后同时采样 CPU Worker
和主线程，严格限制在后续 30 完整帧。起/终图分别与基准的 `d7c741183e4b…` /
`ad48629b287c…` 一致，HP 1440、敌人 500、盾 21，无教学暂停，亮屏且 rate 1。
Profiler 的窗口时长不作为 FPS 对照数据，也不跨不同宿主负载比较采样耗时。

CPU Worker 约 83.9% 样本包含在 `run_machine_core`；解释器包含约 14.4%，
page access 包含约 6.6%，精确 A32 helper 包含约 6.2%，IOP 包含约 5.4%，
CLCD render 包含约 4.3%。`pages::run` 自身约 6.2%、宿主 `now` 自身约 3.8%、
`postMessage` 自身约 4.2%。这些存在嵌套，不能相加或当成独立可回收比例。
主线程同期约 91.2% 空闲，GLES 提交包含约 4.3%；这不是 GPU 硬件利用率测量，
现有证据仍支持优先削减 CPU 执行、解释器退出和访存/调度开销。

只读回看 AMC stats：本次恢复后完成 20 个新输入、1,414,656 个 decoded samples、
2,829,312 bytes PCM，failures 0、errors 空。初始化 busy 问题未在该窗口复现。
原始 CPU/main profiles、窗口元数据、起止 PNG 和音频计数在本地
`infinity-perf-next/accepted-30*`、`accepted-profile*`。采样后关闭自有浏览器。

## IT 最后一槽的调用候选：两种寄存器策略均撤回（2026-11-15）

热点代码包含 IT 后的 BL/BLX。尝试让合法的最后一槽 B/BL/BX/BLX 原生执行，
真假条件分别控制 LR、目标 PC 和 ISA 切换；显式条件编码和非末槽仍保守处理。
新增 `qitcall` 的 32 个热循环退出与 QEMU 一致，包含 Thumb/ARM 目标、LR、
假条件的无效目标、前一条件加载的 abort 及其 ITSTATE。原核心也通过这些
oracle。组件 helper 6119→31，steps 4493→445；不能以此代替实际游戏 FPS。

以已接受的 IT FP helper 核心为 A，同一战斗、预热 8/计量 30 帧：

| 候选 | A1 / B1 / B2 / A2 FPS |
| --- | --- |
| 允许新调用页保留 GPR locals | 4.728 / 4.730 / 5.501 / 5.262 |
| 新调用页保持原 GPR 内存策略 | 4.960 / 4.811 / 5.832 / 6.004 |

首版未显示稳定收益；内存策略版两对均约退步 3%，每帧 renderer CPU 时间也
没有改善。起图一致；每版各有一个结束图落在相邻动画帧，其余结束图一致，
均为正常时钟和亮屏动态战斗。两版均通过完整 27 组 page、fallback 八组及
40×100×32 随机程序（seed 5533/5534）。撤回运行时代码及寄存器策略变更，
仅保留独立回归和本地补丁/结果 `infinity-perf-next/it-call-*`。
默认核心继续使用 `df2a575c0` 的精确 IT FP helper 优化。

## 清理旧挂载实验 img（2026-11-15）

磁盘可用量降至约 2.9 GiB 后，核对并删除 11 月 4 日的三份旧原始 NAND
实验文件：`build/ios/cprotect.img`、`cprotect-dkey.img`、`cp-cbc.img`。
它们早于本轮 IPA 安装，相关本地脚本用于启动/密钥包/挂载探针；清理前检查
精确长度、修改时间、普通文件、单硬链接及无打开句柄。当前 OPFS NAND、
战斗 master 和独立剧情进度副本均未受影响。

三份分配块合计 4,649,402,368 bytes（约 4.33 GiB）；不是按 55.5 GB 稀疏逻辑
长度报告回收。清理后 `df` 可用约 7.4 GiB，完整审计在本地忽略文件
`infinity-perf-next/obsolete-img-cleanup.json`。清理在 FPS 批次结束后进行。

## IT 内精确 FP helper：同场景复测通过（2026-11-15）

对已校验的 scalar VADD/VSUB/VMUL/VDIV/VNMUL、VCMP 及不涉及 GPR 的
VMOV/VABS/VNEG，将 IT 条件编译为分支；条件通过后仍调用原精确 FP helper。
ITSTATE 成功路径保持 0，失败退出在指令地址恢复精确 mask，再由解释器执行。
没有改变浮点运算规则；含内存、GPR transfer、NEON 或其他未知指令的 IT 块
仍沿用其已有处理。这样可保持周围 GPR locals，减少整块退回解释器的成本。

新增 `qitfph` 的 12 个热循环退出与 QEMU 一致，覆盖 1–4 槽、真假条件、
单/双精度、FPSCR、dirty GPR、禁用 FP 的真假条件及最后一槽的异常现场。
完整 26 组 AArch32 page、fallback 八组、seed 5532 的 40×100×32 随机程序
通过。原核心也通过新增 oracle，测试不依赖候选实现。

相同完整音频检查点、相同输入、预热 8/计量 30 帧，按 A/B/B/A 顺序：

| 配对 | 控制 FPS | 候选 FPS | 候选变化 |
| --- | ---: | ---: | ---: |
| A1 → B1 | 4.183 | 5.071 | +21.2% |
| B2 → A2 | 4.071 | 4.984 | +22.4% |

四轮起图各自逐字节一致（`d7c741183e4b…`），终图也各自一致
（`ad48629b287c…`），亮屏、rate 1，无教学暂停。renderer CPU 秒/帧分别
0.4883→0.4562 和 0.5312→0.4760，下降约 6.6%/10.4%。宿主负载仍有波动，
这是同一短片段的收益，不是长时稳定帧率验收，**60 FPS 尚未达到**。
保留实现并更新本地默认主核心/fallback；证据在本地忽略目录
`infinity-perf-next/it-fp-helper-*`，本步没有新增 `.img`。

## 完整音频检查点的 NEON FZ 复测：仍不保留（2026-11-15）

因新的指令诊断仍出现频繁非规格化输入，将旧冷分支 FZ 候选移植到已接受的
同步 helper 核心。只在本地 SIMD 值中规范化输入，成功后设置 IDC；异常、
NaN/Inf、细小输出及不能精确维护 sticky flags 的路径仍使用原精确 helper，
不改变原始操作数后回退。256 个 exact 和 1592 个 sticky 退出与 QEMU 一致；
完整 25 组 page、fallback 七组及 seed 5531 的 40×100×32 随机程序通过。

同一主副本，预热 8/计量 30 完整帧，两批按相反顺序测量：

| 批次 | 顺序 FPS（A 控制 / B 候选） |
| --- | --- |
| A/B/B/A | A 5.819 / B 6.153 / B 6.120 / A 6.188 |
| B/A/A/B | B 5.922 / A 4.316 / A 4.916 / B 4.264 |

每轮绝对计数均为 8→38、亮屏、rate 1；起图一致，首批最后一个控制轮结束
PNG 为相邻动画帧，其余结束图一致。配对收益方向不稳定，renderer CPU 秒/帧
也随宿主负载变化，不能只选前一个正向结果。撤回运行时改动，默认核心仍为
`sync-gprmask`；证据及补丁为本地 `infinity-perf-next/neon-input-*`。

另在独立工作副本通过原生 swipe 完成开场格挡/挥剑教学，进入 God King 剧情。
Arena 按钮在此阶段不可用，尚未得到可连续计量的后续战斗。保存关闭的
`prologue-progress-master-profile`（RAM 1,110,040,515 bytes，匹配其自身 NAND），
供继续导航；它不替代现有战斗基准，也不把剧情帧当作战斗 FPS。没有新增 `.img`。

## 同步 helper 局部保存：结果不一致，撤回（2026-11-15）

在已校验 exclusive/barrier 的 GPR mask 基础上，尝试只提交并重载该 mask 中的
寄存器，PC/access-cache 元数据仍照常同步；retry 的退出仍完整写回所有 locals。
20 个 QEMU 同步退出、完整 25 组 AArch32 page、fallback 八组、seed 5530 的
40×100×32 随机程序及 state-layout 检查均通过。

同一音频检查点、预热 8/计量 30 帧的 A/B/B/A 分别为控制 3.565、候选 4.148、
候选 3.714、控制 4.362 FPS。两对收益方向相反；renderer CPU 秒/帧为
0.5567 / 0.5113 / 0.6317 / 0.5580，也不一致。四轮起止 PNG 各自一致，
亮屏且 rate 1。无法确认稳定收益，撤回该运行时改动，默认核心仍是已接受的
`sync-gprmask`，不把本轮当作提速。补丁和日志保留于本地忽略目录
`infinity-perf-next/sync-partial-*`。后续优先取得不跨教学暂停的更长战斗窗口，
减少短片段和宿主负载对判定的影响。

## FP 批量访存：同场景退步，撤回（2026-11-15）

在已经验证完整单页跨度的 FP load/store 中，尝试将 16–128 字节的逐字搬运
替换为 Wasm `memory.copy`；parallel 核心仍保留原子逐字路径。候选通过主核心
24 组 page 回归、fallback 七组、seed 5529 的 40×100×32 随机程序检查。
新增 `qfpcopy` 的 22 个 ARM/Thumb 用例与 QEMU 一致，覆盖非零 FP 寄存器起点、
writeback、12/16/24/32/128 字节、未对齐、跨页、条件失败及关闭 CPACR 时的
异常优先级；最终用例还回读存储区域的每个字及尾部 sentinel，避免只验证寄存器。

从同一完整音频战斗检查点顺序执行 A/B/B/A，预热 8 帧后计量 30 完整帧：

| 顺序 | 实现 | FPS | renderer CPU 秒/帧 |
| --- | --- | ---: | ---: |
| A1 | 已接受的同步 helper 优化 | 4.372 | 0.4855 |
| B1 | FP 批量复制候选 | 3.296 | 0.5778 |
| B2 | FP 批量复制候选 | 3.299 | 0.6082 |
| A2 | 已接受的同步 helper 优化 | 4.500 | 0.5095 |

四轮开始 PNG 各自一致（SHA256 `d7c741183e4b…`），结束 PNG 也各自一致
（`ad48629b287c…`），均为动态格挡、亮屏、rate 1，未进入教学暂停。
宿主 load average 约 22.6–47.7，不能将绝对 FPS 与前一批跨批次比较；本批候选
两轮均未显示收益，撤回运行时代码。保留独立 oracle 和默认 page 回归入口；
现有核心继续使用原逐字传输，不把本次尝试计为提速。原始证据为本地忽略目录
`infinity-perf-next/fpcopy-30-*`，撤回补丁为 `fp-copy-rejected.patch`。
本步没有创建 `.img`；测量后可用磁盘约 5.3 GiB。

## 动态战斗复采与查找缓存撤回（2026-11-15）

重新从主副本复现预热 8 帧，再只采样后续 30 个完整战斗帧。起止图确认全程
动态格挡、亮屏、rate 1。CPU Worker 的 `run_machine_core` 包含约 85.4% 样本，
`pages::run` 自身约 7.2%、解释器包含约 14.6%、时钟宿主 `now` 自身约 4.8%；
主线程同期约 88.0% 空闲，GLES 提交包含约 7.0%。包含时间有嵌套，不相加。
这份采样替代此前在教学暂停页取得的 CPU profile，原始文件为
`infinity-perf-next/live-30.cpuprofile*`，起止 PNG 在 `live-profile/`。

针对新的热点，将旧实验的函数索引缓存扩为 256 槽后重测；每次仍验证翻译、
模式、Ready 状态、代码 key 和入口，ASID 切换、DMA 改码/逐出/快照及
AArch32 回归通过。但两对 30 帧实测控制/候选为 5.447/5.919 FPS（+8.7%）及
5.945/5.950 FPS（约 +0.1%）；结束 PNG 有相邻帧差异，不能确认稳定收益。
撤回运行时缓存，默认源码和核心保持已接受的同步 helper 优化。补丁和日志留在
本地 `infinity-perf-next/cache256-*` 与 `cache-30-*`，不把该尝试计为性能提升。

## 同步 helper 的寄存器保存优化（2026-11-15）

对已校验编码的 ARM/Thumb LDREX/STREX（含 byte/half/double）及屏障/CLREX，
编译器现在登记实际 GPR 集合，允许这些页面保留 GPR locals。仍经原有 helper
执行同步、访存、全局 monitor、异常和 spin yield；调用前后提交/重载全部存活
locals。未知编码和 IT 内的 opaque helper 继续保守处理，没有绕过锁或屏障。

独立 20 例热循环的全部 R0–R14、标志、别名、条件失败、CLREX、spin yield 和
load abort 与 QEMU 一致。另 4 例无有效 reservation 的 STREX 故障，对照本机
解释器以保留既有“先校验地址”行为（QEMU 可先使 reservation 失败）。原有
22 组 page 回归、新增两组、fallback 八组，以及 seed 5521 的 40×100×32
随机程序通过；状态布局检查通过。没有修改共享 monitor 或异常实现。

新完整音频主副本、相同输入、预热 8/计量 30 完整游戏帧，按 A/B/B/A 顺序：

| 对照方向 | 控制 FPS | 候选 FPS | 候选变化 |
| --- | ---: | ---: | ---: |
| 控制 2 → 候选 2 | 5.517 | 6.006 | +8.9% |
| 候选 3 → 控制 3 | 5.723 | 6.016 | +5.1% |

四轮开始 PNG 各自逐字节一致，结束 PNG 也各自一致，均为 HP 1440、敌人 500、
盾 21 的动态格挡，没有教学暂停页、息屏或时钟变速。候选 renderer CPU 秒/帧
两对约减少 3.5%/4.1%。首个同时运行回归的探索轮和此前跨提示页的 60 帧轮
不参加这张表。保留该优化，但这是短片段收益，**60 FPS 仍未达到**。
原始结果位于本地 `infinity-perf-next/sync-30-*`，核心和回归日志同目录。

## 清理被替代的旧诊断 RAM（2026-11-15）

新的完整音频战斗源已通过恢复验收，删除旧 `battle-master-profile`（空闲提示）、
`progress-master-profile`（菜单）和 `sleep-debug-profile`（休眠）中的诊断 RAM。
逐一在原 origin 的关闭 profile 中核对文件名及精确长度，通过 OPFS 删除，页面
不启动虚机。三份合计逻辑长度 3,320,777,041 bytes；清理后 `df` 可用约 11 GiB。
所有 NAND、游戏存档、原故障 `active-master-profile`、AAC 检查点及新战斗主副本
均保留。不把 APFS 共享文件的逻辑长度当作精确回收量；本轮没有新增临时 `.img`。
盘点及删除记录位于本地 `infinity-perf-next/removed-obsolete-*/state-cleanup.json`。

## 完整音频战斗的剩余热点（2026-11-15）

后续检查起止 PNG 发现：下述 60 帧窗口跨入 `Swipe to Strike` 教学暂停页，
因此 **2.850 FPS 不作为动态战斗基线**；其后的八秒 CPU profile 也处于该提示页，
不能据此精确归因动态战斗。原始文件保留为诊断，改回已确认动态的预热 8/计量
30 帧协议，并在新的独立副本内按完整游戏帧数限定 CPU profile。另一副本从
检查点起运行六秒的指令计数未经过该暂停页，仍可用于选择待验证候选。

从新的 `amc-battle-master-profile` 克隆同一配对状态，保留盾牌手指，不在计量期
发送主机手势；预热 12 个完整帧后计量 60 帧。控制轮耗时 21,053.3 ms，
2.850 FPS；该窗口的游戏 IOSurface 回读累计 1,332.7 ms，JIT 编译增量
423.8 ms。宿主仍有较重并发负载（1 分钟 load 约 26.6），不能与前一次不同长度
窗口的 4.490 FPS 直接比较。后续候选统一使用本轮固定工作量并交替复跑。

计量结束后独立采样 CPU Worker 八秒：`run_machine_core` 包含约 86.8% 样本，
ARM `a64_run_slice` 包含约 73.8%，解释器包含约 13.1%；这些包含时间有嵌套，
不能相加。`pages::run` 自身约 5.6%，CLCD `render` 包含约 5.0%，
`surface_words` 自身约 2.0%，`performance.now` 自身约 3.5%。GPU 回读延迟包含
线程调度，不等同于 GPU 运算；现阶段优先减少 CPU 执行与调度/访存成本。

另一份关闭副本中启用指令计数，热点仍包含音频 SIMD 的精确回退、IT 条件块，
也包含大量 ARM/Thumb LDREX/STREX（含双字）及系统库同步路径。三个实际用户
代码页与机主 dyld cache 的完整 64 字节匹配，得到一致 slide `0x1f1f000`：
`0x3b135000/0x3b136000` 属于 libsystem_c，`0x33c31000` 属于 IOKit。
没有按地址猜测库名。独立六秒 MMIO 中 PMGR 时基 high/low 占约 70%；
原 AMC 初始化忙等已经消失，MP3 继续交付、错误数 0。

采样、计数窗口均与 FPS 分开，临时包装已移除，浏览器关闭。原始证据位于
本地忽略目录 `build/ios/infinity-perf-next/`；本步未改变运行时，也没有新增 `.img`。

## 冷启动 MP3 重启验收与新战斗基线（2026-11-15）

重新构建正式 CPU Worker/模块后，从持久 NAND 冷启动，通过实际 Install IPA →
Open 启动 1.4.3，推进原生开场并进入 God King 战斗。未恢复 RAM、重放启动命令、
修改客体代码/时钟或手动改 pending；只读包装记录原始 MMIO 调用及其实际返回值。

| 原生启动程序 | 缓冲区协议 | 原生初始化循环的状态读取 |
| --- | --- | --- |
| AAC | 2 × 2048 样本 | 首次即返回 `0x4` |
| MP3 引导程序 | 2 × 2304 样本 | 首次即返回 `0x4` |
| 驻留 type-0 MP3 再启动 | 2 × 2304 样本 | 首次即返回 `0x4` |

战斗入口再次写 `99c=3`、`984=0` 时，SRAM 已是
`01c2006a 080001d7 428007c8 083ed008`，三个窗口和入口均与已确认的 type-0
程序一致。原生 PC `0x807fcaae`、LR `0x807f75f7` 三次均只查询一次并读到 ready，
没有零状态重试。最终累计 462 批输入、71,148,032 bytes PCM、0 解码错误。
移除全部观察包装后，再运行约六秒，新增 7 批 MP3 输入、1,032,192 bytes PCM，
错误数仍为 0；真实战斗画面继续提交。

从该原生战斗通过公共 `save_state_stream` 保存完整音频状态，快照
1,107,354,622 bytes；关闭浏览器后用 APFS 保留配对 NAND/RAM 主副本
`build/ios/infinity-next/amc-battle-master-profile`。再次从它的关闭副本恢复，
MP3 初始化、历史和队列保持，继续处理 20 批新输入、交付 2,829,312 bytes PCM，
0 错误、snapshot I/O 为 0。恢复不会重新制造 ready，也不把历史重放计入新 PCM。

修复后的新基线在正常时钟 rate 1、全程亮屏下，预热 8 帧后完成 30 个完整
960×640 游戏帧，耗时 6,682.2 ms，**短窗口 4.490 FPS**，面板也更新 30 次。
起止图像为真实动态格挡，HP 1440、敌人 500、盾 21；没有静止提示页或生命周期切换。
这轮没有对旧故障检查点做同场景 A/B，不能由此计算修复的提升倍数，也不代表持续
稳定帧率；**60 FPS 仍未达到**。后续优化从新的完整音频战斗主副本开始。

原始记录为本地 `build/ios/infinity-amc-fix/cold-native-trace.json`、
`post-restart-before/after.json`、`cold-native/` 和 `restored-battle/`。
未创建新的原始临时 `.img`；只保留必要的配对主副本，并删除本轮工作副本中
已与推进后的 NAND 失配的 RAM 文件。专有游戏/固件和原生截图不提交仓库。

## MP3 就绪忙等：ARM 客户机回归与适用范围（2026-11-15）

初始化缺口由 `41ffe8df` 修复：识别 type-0 MP3 指纹及其窗口配置后，填写
两个 2304 样本缓冲区的协议头，再通过设备完成路径报告 ready。没有改变客体
时钟、驱动指令或未知程序的处理方式；真实冷启的原生 MP3 重启及 PCM 交付
证据见下文“原生 type-0 重启与冷启验证”。

新增 `tests/ios/amc-guest.mjs`，使用独立构造的微型 Mach-O/设备树启动真实
N90/Wasm ARM 核心，由客户机指令执行 reset、start、读状态循环和 ready 应答。
MP3 引导程序及驻留 type-0 重启均只需两次状态读取：首次即读到 ready，随后
客户机应答并读到已清除的状态，正常进入 WFI。未知指纹确实反复轮询，不能通过
握手。主核心与 fallback 均通过。测试进程内临时撤掉 type-0 识别的负向对照
在第二种程序的“退出轮询”断言失败，证明此回归能检出原始缺口；源码未被修改。

`make ios-amc-tests` 汇总设备、真实 ARM 握手和 Chrome WebCodecs/DMA/快照测试；
普通 `ios-tests` 也纳入 AMC 设备测试。真实 AAC/MP3 PCM、两个 MP3 程序的
engine-0/CDMA 交付、逐样本快照续播、取消与错误路径再次通过。

原故障 RAM 检查点缺失 codec 元数据，已在旧模型中越过 start 写入。独立诊断
在核对原生 PC/LR、进程、指令、固件、窗口和空缓冲区后，一次性让新模型处理
此前已发出的命令；原生驱动退出等待并解码首批 MP3。随后移除全部诊断包装，
六秒窗口内没有再次读取 AMC 状态，亮屏战斗继续提交完整帧。
这只证明初始化等待可以解除：旧状态的输出 DMA 队列也缺失，本实验没有交付 PCM，
不作为音频连续性、自动快照迁移或 FPS 提升验收。产品不凭 SRAM 内容猜测旧命令；
使用更新后的构建应从持久 NAND 冷启动，新的完整音频检查点可保留初始化与队列。
诊断原始记录在忽略目录 `build/ios/infinity-amc-fix/`。60 FPS 仍未达到。

## 原生播放中快照的完整序列化与恢复（2026-11-15）

从真实冷启及 UI 启动的游戏中，通过公共 `save_state_stream` 保存播放中的 AAC
检查点，531,384,988 bytes，机器 RAM 为 512 MiB。其 codec 状态版本 2 包含
26 个真实压缩批次、212,919 bytes 历史，以及一个待交付 PCM 块和尚未完成的输入。
关闭浏览器后克隆配对 NAND/RAM，再从该状态恢复；26 批历史、待输出队列和
初始化状态均恢复，重放不增加音频解码/PCM 统计。

恢复后运行并执行真实触摸，继续处理 6 个新输入、交付 1,056,768 bytes PCM，
错误数 0、snapshot I/O drain 归零；原生按钮按下状态及释放后的提示消失可见。
这验证了完整状态格式和真实 iOS 通路，尚非战斗 FPS 验收。
配对副本为本地 `infinity-next/push-master-profile`，原始保存/恢复元数据与截图
位于 `build/ios/infinity-audio-state/`。后续导航从关闭的副本重新克隆，不把旧 RAM
恢复到已推进的 NAND 上。

## 清理剩余旧格式探针（2026-11-15）

按磁盘空间要求，再清理 `build/ios` 下 12 个过期物理 NAND 格式/引导探针：
`eff-2/8`、`yaftl-v2`、`face-v1/v11/test`、`grdn0/1`、`ctrl-public`、
`nand-probe`、`fbbt-format`、`plog-format`。删除前遍历全部已分配 extent，
未发现正向或反相的有效 HFS/HFSX 卷头，文件均为单链接、无打开句柄。
原分配块合计 67.64 MiB，不把每个稀疏文件约 17 GiB 的逻辑长度当作腾出空间。
真实安装盘、系统/数据卷和不可变基准副本保留。
审计和删除记录为本地 `perf/old-probe-audit.json` / `old-probe-cleanup.json`。

## 有界重放保留正在播放的音频检查点（2026-11-15）

为建立没有 AMC 忙等的真实战斗检查点，新增 codec 状态版本 2：在解码批次之间
保存完整压缩历史，最多 16 MiB；恢复时经同一 WebCodecs 配置重放，丢弃历史 PCM，
保留快照中的待输出 PCM、缓冲区槽、输入完成状态和 engine-0/CDMA 顺序。
超出上限仍继续正常播放，但明确拒绝不完整的重放快照。旧版空闲 codec 状态保持兼容。
解码和重放接入现有 snapshot I/O drain，保存操作等待异步解码结束；复位会取消重放。
这替代此前“凡有 WebCodecs decoder 就拒绝保存”的限制，没有清空 reservoir 后继续播放。

真实浏览器回归确认 AAC 和带 Layer III reservoir 的 MP3 在恢复后的下一帧 PCM
逐样本完全一致；覆盖格式切换后的时间戳、超额历史拒绝、异步配置/重放取消。
两种 MP3 程序均在已播放一帧后恢复并把精确下一帧送到 CDMA；三帧输入批次在
只交付首帧后恢复，剩余 PCM 顺序输出，原输入只完成一次，重放不增加解码/PCM 统计。
Node AMC/设备回归和正式 CPU Worker/模块构建通过。

这项是有效性能对照的前置条件，尚未据此报告战斗加速；接下来从原生冷启重新建立
配对 RAM/NAND 检查点，验证实际游戏和完整状态序列化。

## 原生 type-0 重启与冷启验证（2026-11-15）

新构建从配对 NAND 冷启，经真实 Install IPA → Open 启动 1.4.3，关闭推送提示、
跳过电影并点击 Begin，进入 God King 的 HOLD TO BLOCK 场景。首次 MP3 启动
仍使用原有引导指纹；紧接着 SRAM 换成 type-0 主程序，首批真实压缩数据头为
`ff fb 92 00`，参数掩码 1、44100 Hz。进入战斗时，原生再次写 `99c=3`、
`984=0`，这次启动时 SRAM 已经是 type-0 指纹，新分支发出缓冲区就绪，随后
继续真实 MP3 输入。最终累计 249 个 AAC/MP3 输入、36,899,840 bytes PCM、
0 解码错误，未再停在原来的 AMC 就绪循环。不是手动改 pending 或改游戏内存。

尚未取得可用的战斗 FPS 对照：这次流程包含锁屏/唤醒，后来 3D drawable 不再
提交，保留的 HUD 不能证明仍在渲染；该窗口已拒绝，没有输出 FPS 成绩。
旧版快照中已卡住的初始化仍不能凭空重放。后续需要没有 AMC 忙等且能完整保留
音频状态的配对战斗检查点，再继续同场景对照。60 FPS 仍未达到。

原始原生启动/输入记录位于 `build/ios/infinity-type0/native-mp3-events.json`，
截图、最终音频计数和被拒绝采样证据均在同一忽略目录。冷启推进 NAND 后，已删除
工作副本中不再配对的旧 `battle-state.v86`；原始不可变基准副本保留。

## 保存空闲 AMC 程序和待处理 DMA（2026-11-15）

此前 AMC 快照只包含寄存器、IRQ 和 SRAM，恢复时却复位整个 codec。
即使没有活跃 WebCodecs，已初始化的 AAC/MP3 程序、已提交输入和待交付输出列表
也会丢失。新增独立版本的 codec 状态，保存这些协议字段；恢复继续使用快照中的
结果头与源状态，已经 ack 的 ready 不会再次触发。活跃 WebCodecs 的 MP3 reservoir
仍不可序列化，该状态继续明确拒绝保存。

Node 回归覆盖未 ack/已 ack 就绪、待处理输入、复位、旧状态和活跃解码拒绝。
真实浏览器在两个 MP3 程序提交压缩输入及 engine-0 输出列表后保存、复位、恢复，
两者都成功解码并经 CDMA 交付真实 PCM；AAC/MP3 批次及设备回归通过。
旧版五字段快照无法证明启动命令是否发出，保持兼容读取，但不凭 SRAM 代码自动
合成一次启动。战斗性能仍需原生重新初始化的现场验证。

## AMC type-0 MP3 程序识别（2026-11-15）

原生等待栈进一步确认是 PID 48 `mediaserverd`；对象配置为 type 0、双声道、
44100 Hz，选择 AppleAMC-176 内嵌描述符 `0x80867280`。其指令平面中的
`0x808151d0` 对应实际本地地址 `0x4600`，前四字为
`01c2006a 080001d7 428007c8 083ed008`，与此前支持的另一程序不同。
原生 MP3 参数掩码为 1，输出区 `0x18100 / 0x19300` 相距 `0x1200` bytes；
与两个 2304 样本输出缓冲区协议一致。12 秒内有 790,957 次就绪查询，
没有新的启动写入，结果头始终为空。

现在对这组指纹也执行已有 MP3 HLE，仍要求同一入口及三个原生窗口寄存器
全部吻合；不同指纹不成功。初始化只声明缓冲区，实际 PCM 继续由 WebCodecs
解码并沿 engine-0/CDMA 交付。Node 指纹/拒绝/复位回归，以及真实浏览器中
两个程序的 MP3 解码、AAC、批次连续性和 DMA 顺序检查均通过。

这一步尚未改变战斗 FPS 验收结果。旧 RAM 状态中没有保存 codec 元数据，
且已停在缺失握手之后；不能把新代码加载成功当作旧状态已经修复。
原始诊断保留于忽略目录 `perf/amc-stack-*`、`perf/amc-firmware-context.json`。

## MMIO 热地址定位到 AMC 初始化等待（2026-11-15）

在同一战斗 RAM/NAND 预热 12 帧后，单独统计 6 秒 MMIO；读写都调用原有处理器，
每 256 次抽样当前原生 PC/LR，结束恢复包装。采样有开销，完整游戏帧 12→14，
这不是 FPS 对照。计数总计 3,647,729 次，其中 PMGR 计数器 high/low 读取
2,077,231 / 1,038,615 次（约 85.4%）；AMC `0x84100a98` 读取 439,195 次，
抽样值始终 0。PMGR 的主要 LR 是 `_clock_delay_until`、`_delay_for_interval`。

AMC 采样 PC `0x807fcaae`、LR `0x807f75f7`。核对机主内核原始指令可见：
该处先读 a98 状态，再在 `0x807f75fa` 测 bit 4；不满足则回到
`0x807f75e6` 重复等待。这属于初始化完成等待，与 PCM 输出完成位 bit 20
不同。当前证据提示 AMC 初始化握手可能缺失，需要继续核对实际程序、寄存器、
进程和调用栈；不能仅凭 0 状态就伪造完成位或确认唯一瓶颈。

原始计数和抽样位于 `build/ios/infinity-next/perf/mmio-counts.json`，两端画面
位于 `mmio-addresses`，对应原生指令为 `amc-poll.dis` / `amc-wait-caller.dis`。

## 原生 Mach 时基实查：与宿主正常时间一致（2026-11-15）

在独立检查点中只读核对 10B329 内核实际数据，没有替换或调用客户机函数。
`mach_absolute_time` 经当前 CPU data 的回调 `0x80089604`，读取虚拟
`0xc02a1000/4`（MMU 实查物理 `0xbf102000/4`），并加 CPU data 的 64-bit
偏移；本次偏移为 0。原生 `_clock_timebase_info` 所指数据的 numer/denom
实读为 125/3，与 PMGR 的 24 MHz 计数器匹配。

normal/rate 1 的六秒运行窗口，两端停机读取数据。依据实际回调及换算常量计算
Mach 时间差 6006.3 ms，机器时钟差 6006.3000002 ms，宿主窗口 6007.2 ms。
未发现 16 倍等时间比例错误；不能通过改变时钟比例来声称 FPS 优化。
末尾画面确认亮屏、God King 战斗仍在前进。该次是时间诊断，不作为 FPS 成绩。
证据为 `build/ios/infinity-next/perf/native-timebase-result.json` 和
`native-timebase/timebase-end.png`，原始回调、常量与前后读取一并保留。

默认主核心/fallback 已重新从接受的源码构建，条件 FP、调度缓存和权限检查复用
候选都没有混入默认核心。当前实测仍约 1.7–2.1 FPS，**60 FPS 未达成**；
更大的已观测开销仍在 ARM 执行/调度及解释器的访存、MMIO 路径。

## 同块 FP 权限检查复用：未确认战斗收益（2026-11-15）

候选在代码生成时复用同一基本块内支配后续指令的 FP 访问检查；每个新块重置，
条件分支取两路交集，opaque helper 使证明失效。没有增加运行期状态或修改 FP 数学。
全部 22 组、fallback 八组、seed 4417 的 40×100×32 随机程序、10 个 qfplocals
及 26 个 qitfp 的 QEMU 现场、256 次 PL1 FPEXC 切换故障均通过。
qfplocals 的 helper/指令数相同，代码 438,384→437,816 bytes。

同战斗检查点两对为控制/候选 1.872/1.975 FPS（+5.5%），反向候选/控制
1.756/1.871 FPS（-6.2%）。开始 PNG 四轮一致；结束三轮一致，第一候选
差一帧。没有稳定收益，撤下运行时代码；独立权限回归和本地候选补丁保留。
下一步核对原生时间换算与等待，不能由“看起来约 2 FPS”推断时间比例有错。

## FP 权限复用前的独立异常回归（2026-11-15）

`qfplocals` 增加两个 A32 假条件后真实 FP trap 的案例：未执行的 VADD 或
VMOV 不能为后续无条件 FP 指令提供访问权限。已提交控制核心的全部 10 个
MMU/JIT 退出现场与 QEMU 一致。

新增 `tests/a32/fp_access.*`：真正的 PL1、MMU 开启、热 ARM 与 Thumb 函数，
先执行 FP，再通过 VMSR helper 关闭 FPEXC.EN；下一条 VMOV 必须 UNDEFINED，
重启 FP 后结果仍为 2.0。每个指令集重复 128 次，并核对故障指令地址和返回值；
Thumb 还覆盖禁用后的假条件 FP。控制核心与 QEMU 的全部输出一致，实际执行
约 3.9 万条 native 指令。新样例加入 A32 默认裸机回归。

## 调度函数索引缓存：结果不一致，未保留（2026-11-15）

尝试用 64 槽缓存已发布函数的索引，仍在 `code_page` 校验当前翻译/模式/权限后，
核对索引对应函数的 key、Ready 状态与入口覆盖；失效和重新编译不得使用旧函数。
全部 22 组 AArch32、fallback 八组、A32 40×100×32 与 A64 40×120×64 随机程序、
ASID 0/1/auto、扩展内存 DMA 改码/帧逐出/快照、100 个 MMU 场景的 1468 个
QEMU 探针（4/16/64 KiB）均通过，状态布局和导入边界检查通过。

实际同场景两对：候选/控制为 1.951/1.825 FPS（+6.9%），反向控制/候选为
1.923/1.826 FPS（-5.0%）。主要 renderer 累计 CPU 时间也反向：
23.859/25.737 秒、25.457/24.196 秒。起始有相邻帧差异，候选结束 PNG 与
控制也相差一帧；不能证明稳定收益，撤下索引缓存，保留本地实验补丁。

下一项缩减同一基本块中重复的 FP 访问权限检查：只复用已在所有到达路径上
成功执行的检查；条件不成立、opaque helper、任何新块入口都不能错误继承。
不改变浮点数学、FPSR 或访问权限规则，仍须独立的异常回归和真实战斗对照。

## 条件 FP 的寄存器策略修订：仍未通过（2026-11-15）

保留新提升 IT 页面原有 GPR 内存策略的修订，相关主核心八组、fallback 四组和
seed 4411 的 40×100×32 对照通过；但两对真实战斗仍为候选/控制
1.049/1.423 FPS、反向控制/候选 1.670/1.576 FPS。没有可保留的性能收益，
两版条件 FP 运行时代码均撤下；26 例独立 QEMU 回归保留。修订补丁和独立核心
仅在 `build/ios/infinity-next/perf/it-fp-memory-*` 留作诊断，不作为默认核心。

这排除了“仅调整新增页面的 GPR 策略就能解决首版退步”的假设；
不能进一步断言唯一原因是模板大小或编译器。继续针对采样中最大的自身开销
`pages::run`，测试已发布函数的索引查找缓存，保持翻译权限、mode、函数存活和
入口覆盖校验。目标仍为 60 FPS，当前接受版本远未达到。

状态布局检查曾被已提交的 host-only `write_watch.rs` 三个诊断 static 的分类
遗漏阻止。`39958ecb` 将它们标为 debug；未改变客户机架构字段。
现全仓 `node gen/state_layout.js --check` 通过，不再使用排除该模块的临时检查。

## 条件 FP 原生化首版：战斗退步，未保留（2026-11-15）

首版将已有 VFP/NEON、浮点访存和寄存器传递模板扩展到 Thumb IT 条件块，
成功时保持 ITSTATE 清零，仅 fault/retry 物化精确槽位。26 个 FP 条件现场和
32 个返回现场与 QEMU 一致，全部 22 组、fallback 八组、seed 4409 的
40×100×32 随机程序以及 IOP 状态回归通过。qitfp helper 从 17,316 减至 2,213。

真实战斗却明显退步：控制→候选为 2.063→1.265 FPS；反向候选→控制为
1.128→1.752 FPS。前三轮起止 PNG 各自一致，第四轮控制结束也与第一轮一致，
第二次候选结束存在一帧差异。第一对候选宿主负载更低（约 19→17，控制
22→19），第二次控制负载更高（36→32，候选 23→23），仍然是控制更快。
主要 renderer 累计 CPU 时间约 22.64→33.97、25.24→38.97 秒；
不能把 helper 数下降当成性能通过，首版不保留。

继续隔离寄存器策略的影响：只对新提升的 IT FP/transfer 页面保留原先的
GPR 内存策略，其余保持已提交版本。此修订需要单独测试，不能沿用首版
的正确性或 FPS 结论。本地首版补丁为 `it-fp-original-unproven.patch`。

## 条件 FP 访存的独立异常回归（2026-11-15）

`qitfp` 从 20 扩展到 26 个 QEMU 退出，增加条件 VLDR/VSTR 的热循环、
首槽/次槽/写故障、FP 禁用时的假条件，以及跨页双精度读取。原来 20 例
保留 NEON/VFP 的真假条件、精确 helper 回退、首/次 FP trap 和已保存 ITSTATE。
已提交的控制核心 `69c545c2` 在开启 MMU/JIT 后通过全部 26 个 QEMU 现场，
证明新增 oracle 不依赖候选模板。候选和真实战斗收益继续单独验证。

## 优化后重新采样（2026-11-15）

在 `69c545c2` 的相同有效格挡 RAM/NAND 上预热 12 帧，停机保存起始画面，
开启 CPU Profiler 后恢复正常 rate 1 运行 8 秒，再停机保存结束画面。两端均亮屏，
盾值 20→19，原生 960×640 完整帧数 12→18。采样会改变运行速度，
**这 6 帧不作为 FPS 对照或成绩**。

8.024 秒采样中，`pages::run` 自身约 1.238 秒（15.4%），包含时间约 6.602 秒；
解释器 `interpret_one` 包含约 1.987 秒，`bus::read` 包含约 1.144 秒，
MMIO 入口自身约 0.379 秒。`a64_page_access` 包含约 0.498 秒，
`a32_page_helper` 包含约 0.323 秒。包含时间相互重叠，不能相加；
V8 的函数归属也不能精确代替客户机线程耗时。

随后独立开启 6 秒逐指令诊断，结束恢复原统计开关 0。最热 helper 中仍有
NEON 算术、IT、独占访存及 VCVT；例如两个 VADD 各约 25.9 万次、两个
VMUL 各约 19.8 万次，IT `bf1c/bf08/bf18` 约 18.9/14.6/8.0 万次。
下一项检查 IT 中已有 FP 模板能否继续原生运行，减少 helper 和调度往返；
保留每槽的精确 fault/ITSTATE、假条件以及异常 FP 回退。
本地栈为 `build/ios/infinity-next/perf/post-gprmask.cpuprofile`，画面和
原始诊断位于 `post-gprmask-profile` / `post-profile-*`。

## 按页面 GPR 引用集合缩小同步：FP 优化后复测（2026-11-15）

纯 FP helper 现在允许更多页面使用 GPR 局部值，因此重新测试之前没有确认收益的
页面引用集合方案。按整页所有原生模板的读写并集，加载和写回实际涉及的 R0–R14；
条件写的目的寄存器也加载初值，保证条件不成立时保留原值。opaque helper
保守引用全部 GPR，纯 FP helper 引用集合为空。PC、NZCV、retry 和 chaining
仍走原有路径，没有新增运行期状态。

同一有效格挡检查点、normal/rate 1、12+2 帧预热和固定 30 个完整游戏画面：

| 对照次序 | 控制 FPS | 引用集合 FPS | 相对变化 |
| --- | ---: | ---: | ---: |
| 控制 1 → 候选 1 | 1.753 | 1.796 | +2.4% |
| 候选 2 → 控制 2 | 1.731 | 1.870 | +8.1% |
| 候选 3 → 控制 3 | 1.732 | 1.798 | +3.8% |

三对均较快；第一对主要 renderer 累计 CPU 时间约 25.994→25.205 秒，
第二对约 26.051→24.818 秒。宿主负载有变化，起始 PNG 也有相邻帧差异，
不能给出精确、稳定的提升幅度。六轮结束 PNG 一致，盾值 20→19、HP 1396/500，
无全屏教学遮罩或息屏。此结果只适用于该短战斗片段；保留小幅改进，继续定位
更大的开销，**尚未接近 60 FPS**。

全部 22 组 AArch32 对照、fallback 相关八组、qgprmask/qfplocals 共 16 个
QEMU 退出现场、seed 4407 的 40×100×32 随机程序及 ARM7 状态回归通过。
qfplocals 生成代码 445,965→443,885 bytes，helper 次数保持 899。
首次 ARM7 命令遗漏固件目录参数，修正为 `build/ios/10B329` 后通过。
证据保存在 `build/ios/infinity-next/perf/active30-fp-gprmask-*`。

## FP 局部值优化后的条件返回复测（2026-11-15）

在已验证的 FP-only helper 优化上，重新启用 IT 最后一槽的 POP/LDM/LDR PC
原生模板。只有最后一槽可以返回；fault/retry 出口写回该槽精确 ITSTATE。
这些页面保持原先使用内存的 GPR 策略，避免引入额外全寄存器同步。

同一 `active-master-profile`、normal/rate 1、12+2 帧预热、30 个完整游戏帧：

| 交替对照 | 控制 FPS | 条件返回 FPS | 相对变化 |
| --- | ---: | ---: | ---: |
| 控制 1 → 候选 1 | 1.301 | 1.711 | +31.5% |
| 候选 2 → 控制 2 | 1.754 | 1.870 | +6.6% |
| 控制 3 → 候选 3 | 1.402 | 1.458 | +4.0% |
| 候选 4 → 控制 4 | 1.430 | 1.558 | +8.9% |

八轮均从盾值 20 推进到 19，HP 1396/500，保持可见战斗和有效格挡。
起始画面有两种相邻帧，结束画面也有两种相邻帧，因此这组证据没有上一项
四轮 PNG 完全一致的对照严格。第一对宿主负载下降尤其明显；不把 +31.5%
视为该优化的稳定幅度。后两组候选的宿主负载还更高，仍分别较快；对应
renderer 累计 CPU 时间 31.27→30.05、30.57→29.35 秒，helper 次数也减少。
结合四组同向结果保留此优化，继续测量；实际仍约 1.4–1.9 FPS，未达 60 FPS。

32 个条件返回退出现场与 QEMU 一致；主核心的 q3、qitreturn、qitmem、
qinterwork、qfplocals、qgprmask、q4、qitfp，fallback 相关四组，以及
seed 4405 的 40×100×32 随机程序对照通过。未改变状态布局。
本地产物位于 `build/ios/infinity-next/perf/active30-fp-itreturn-*`。

## 保留纯 FP helper 的 GPR 局部值：同场景复测通过（2026-11-15）

在 helper 前后写回／重载全部 R0–R14 的开销已被定位。新的 FP-only helper
分类覆盖 VFP 和 NEON 数据处理，保留通用寄存器局部值；现有原生算术／比较
需要精确 helper 回退时也使用相同路径。内存访问、GPR 传递和系统协处理器
继续使用原同步路径，不改变 FP 运算、舍入、NaN 或异常规则。

相同 `active-master-profile` RAM/NAND、已生效格挡输入、normal/rate 1，
预热 12+2 帧后完成 30 个完整游戏画面，交替次序为控制→候选→候选→控制：

| 对照 | 控制 FPS | 候选 FPS | 相对变化 |
| --- | ---: | ---: | ---: |
| 第一对 | 1.266 | 1.670 | +31.9% |
| 反向一对 | 1.376 | 1.800 | +30.8% |

四轮 `battle-start.png` 完全相同，四轮结束 PNG 也完全相同；画面从盾值 20
推进到 19，HP 1396/500，没有全屏教学遮罩或息屏。相同 PNG 哈希和既有
完整帧计数共同验证场景；第一对主要 renderer 的累计 CPU 时间约
34.959→27.060 秒。两对控制的宿主 load average 约 22→20、19→18，候选
约 24→21、19→17。保留此优化；它证明这个短战斗片段的可重复收益，
**仍只有约 1.7–1.8 FPS，距离 60 FPS 很远**，不能外推为全部游戏场景成绩。

新增 oracle、完整主核心／fallback、异常与随机程序验证详见下一节。此次没有
增加 Rust static 或改变状态布局；全仓布局检查曾被并行开发中新建的
`write_watch.rs` 三个尚未分类 static 阻止，未改动该不相关文件。


## 纯 FP helper 的寄存器现场回归（2026-11-15）

新 `qfplocals` 比较全部 R0–R14 和异常现场，覆盖新写入的 GPR、NaN/inexact
标量算术、条件转换、NEON 转换和饱和、比较后读取 FPSCR/APSR，以及 FP 禁用
和非法指令时的 retry。主核心与原版控制核心的 8 个退出均与 QEMU 一致，
加入默认 AArch32 回归。候选完整 22 组、fallback 相关 8 组、seed 4403 的
40×100×32 随机程序及 ARM7 状态回归通过。

当前候选仅给已分辨为不读写 GPR 的 FP/SIMD 数据处理保留通用寄存器局部值；
排除所有内存操作、core-register transfer 和系统协处理器。A32 NZCV 本就位于
内存，指令 PC 显式传入；helper 拒绝时仍由统一 retry 出口提交完整 GPR，之后
原解释器处理异常。VFP/NEON 数学、精确回退和 FPSR 语义未放宽。相同样例
helper 均为 899 次，生成代码 465,118→445,965 bytes。实际战斗收益已由上一节的四轮交替验证。

## 导航与睡眠现场（2026-11-15）

重新检查 `progress-master-profile`，画面存在游戏下拉菜单和续作推广按钮；
不能把该画面的停顿直接归因于剧情或 CPU 性能。原生触摸集合实际记录了有效
UITouch（phase 2、path 258），硬件队列为零。宿主 `(490,790)` 对应 UIKit
`(253,394.5)`，与先前 `(45,480)`→`(30.5,240)` 一样提示横向约 16 physical px
偏移；尚未执行全屏校准，也未修改触摸模型。导航手势已结束。

随后真实诊断确认 panel awake=false、backlight=0；黑屏不是进入新战斗的证据。
该现场以 normal/rate 1 停止 CPU 保存，RAM 1,103,630,576 bytes，关闭 Chrome 后
克隆为 `sleep-debug-profile`。用原控制核心重新加载时，RAM/NAND 身份与代次校验
通过。它只用于睡眠诊断，不能用于 FPS；原 active/progress master 均保留。
电源键和 Home 测试后的显示仍熄灭，GPIO 待处理按键位已清除，CPU 继续退休指令。
原生 Settings 查询受 User 应用列表限制；另一请求发生超时，不能宣称助手解锁成功。
没有修改固件、游戏或自动锁屏配置，后续仍需验证唤醒和较长战斗场景。


## 预取提示的最终战斗复测（2026-11-15）

`control-3` 与 `hint-4` 的开始 PNG 完全相同，结束 PNG 也完全相同；同一
正常时钟、固定 30 帧，分别为 1.403 与 1.323 FPS。宿主负载分别约 36→31
和 32→32。候选未超过控制，组件优势没有转为实际游戏收益，因此撤下原生
提示运行时代码，保留 11 个 QEMU oracle 与本地实验核心。`hint-3` 的超时
仍标为拒绝，尚无足够证据确定其原因；后续正常轮未复现超时。

当前继续推进已保存剧情检查点，寻找适合更长窗口的教学后战斗；不将短教学
格挡窗口的性能外推到整场游戏，也不把组件微基准当作达到 60 FPS 的证据。


## 拒绝失败窗口并保留现场（2026-11-15）

追加的 `active30-prefetch-hint-3` 在 120 秒内未完成 30 帧；它没有产生有效
FPS 结果，不能与成功窗口比较。随后原核心 `control-3` 完成 30 帧，约
1.403 FPS。首次失败轮缺少终止现场，尚不能确定是息屏、调度压力还是候选回归。

基准现于每次已有的预热／测量轮询同时检查正常时钟和亮屏；息屏立即拒绝，
失败时暂停 CPU、保存 `battle-failure.json`（原错误及最终 clock/panel/CPU
诊断），并尽可能保存 `battle-failure.png`，然后才通知 runner 失败。错误不会
被写成 FPS 成绩。用独立克隆实际运行 `duration=1 frames=30 warmup=1`，确认
预期超时、进程失败退出、诊断与非黑屏截图均保存，未接受 FPS；该轮仅验证
失败取证流程。正常候选复测继续使用 120 秒上限与 12+2 帧预热。


## 原生预取提示：战斗复测后撤下（2026-11-15）

helper/step 统计捕获到高频 `0xf891f040`，即 `PLD [r1,#64]`。编译器现直接
消除支持的 A32 PLD/PLDW/PLI、Thumb PLD/PLI imm12 提示，包含 PC literal
和 IT 真／假路径；其他 Thumb 编码继续使用原解码检查。只在编译时识别，不
增加运行时 guard，不执行内存访问。相邻 LDRB 仍访问内存并保留 fault 行为。

新增 `qpreload` 的 11 个退出与 QEMU 一致，覆盖未映射／回绕地址、正负偏移、
寄存器移位、literal、IT 和普通 load。完整 21 组 AArch32、fallback 相关 4 组、
seed 4397 的 40×80×32 随机程序及真实 ARM7 counter 回归通过。默认短程序
helper 1542→10、steps 1129→367；较长固定工作量（每循环 200000 次，寄存器
退出现场完全相同）三轮交替结果如下，包含独立虚拟机建立和冷 JIT 成本：

| 核心 | 宿主 elapsed ms | 本 Node 全线程 CPU ms |
| --- | --- | --- |
| 控制 | 435.8 / 295.3 / 224.6 | 731.6 / 649.1 / 401.3 |
| 原生提示 | 99.4 / 94.3 / 112.3 | 247.7 / 309.2 / 288.3 |

组件测试虽有收益，运行时代码在战斗复测后撤下，仅保留 `qpreload` oracle。
**上述组件时间不是游戏 FPS**。正常时钟的首批固定 30 帧战斗控制为
2.238 / 1.113 FPS，候选为 1.273 / 1.037 FPS；测试期间宿主负载从约 17 升到
约 74，无法据此确认收益或精确回退幅度，仍在追加反向测量。60 FPS 未达到。


## 继续清理无文件系统的旧探针（2026-11-15）

检查生成脚本后清理 8 个 11 月 4 日临时 `.img`：`context-probe`、`context-abs`、
`context-white`、`lba-probe`、`lba-v2`、`lba-v3`、`lba-v4`、`special-probe`。
脚本仅调用 `nand_build.mjs bootstrap/format`，写入人工生成的上下文、FTL 或
分区头，没有调用 `volumes`、导入 HFS 或系统／数据文件，不能包含已安装游戏。
清理前确认无打开句柄、硬链接和符号链接引用；分配块合计 123.40625 MiB。
稀疏逻辑长度仍不当作实际释放量。旧安装盘、工厂盘及所有匹配的战斗 master 保留。


## AP 时钟直读候选：未保留（2026-11-15）

独立采样确认内核 `0x800894a4` 的计时入口最终读取虚拟 `0xc02a1000/4`，
对应 PMGR `0xbf102000/4`。尝试在真实地址翻译、权限检查后，通过数值
machine-clock import 提供一次对齐 scalar LDR；设备 owner 必须由 AppleTimer
显式登记并与实时 bus mapping 一致，不填 RAM cache，不优化写入或其他寄存器。
这与先前仍调用 JS MMIO handler 的实验不同。

主核心/fallback 的真实 EL0 短描述符、2048 次 LDR、Device/strongly ordered
映射、低位回卷、暂停/恢复、权限、宽度、非 scalar、跨页和替换 owner 检查通过，
原 ARM7 counter/LDM、设备、uncached DRAM 回归通过。原始 fixture 与补丁
仅保留在本地 `perf/pmgr-*-unproven.*`，不增加默认运行时入口。

同一有效格挡检查点的 30 帧测试：第一对控制/候选 2.169/1.875 FPS；
反向控制/候选 2.231/2.273 FPS。第一对地址访问拒绝约 1426 万→319 万，
但未形成可重复 FPS 收益，撤下该候选。独立 12 秒 CPU 采样结束仍在盾值 19
的真实战斗，无教学遮罩：`pages::run` 包含约 9.985 秒，时钟 import 包含
1.498 秒，访存 access 包含 2.245 秒；这些时间有嵌套，不能相加。
进一步 helper 统计发现 `PLD [r1,#64]` 仍频繁单步；下一步检查该架构 hint
的原生生成，避免仅按 helper 数下降宣称游戏提速。


## 宿主 CPU 时间诊断（2026-11-15）

浏览器 runner 可用 `BROWSER_PROCESS_METRICS=1`，配合固定
`BROWSER_DEBUG_PORT` 在 `/__host_metrics` 记录本轮自有 Chrome 各进程累计
CPU 秒数。来源为 [CDP SystemInfo.getProcessInfo](https://github.com/ChromeDevTools/devtools-protocol/blob/master/pdl/domains/SystemInfo.pdl)，
包含同一进程的所有线程，不能当作 CPU Worker 单线程占用率。只在计时窗口外
取两端读数，调用失败记录 error、不改变原宿主指标和 FPS 公式。

正常时钟、同一有效格挡检查点的反向时钟候选对照中，该指标已实际回读：候选
30 帧 13.199 秒，主要 renderer 累计增加 19.987 CPU 秒；控制 30 帧 13.446 秒，
增加 20.616 CPU 秒。CPU 秒数用于辅助诊断构建、线程和宿主调度噪声，绝不
将 FPS 按 CPU 时间或 load average 换算为“校正 FPS”。


## NEON 非规格化输入候选：未保留（2026-11-15）

尝试在本地向量中将有限 subnormal 输入转为带符号零，成功路径设置 IDC，
NaN/Inf、细小输出及不精确情形仍用原 helper；没有改变 guest 寄存器后再回退。
增加 880 个输入 FZ、sticky flags、别名和累加器用例，合计 1592 个 QEMU
退出现场。直接/冷分支两版均通过主核心、fallback 和随机程序对照；撤下候选后，
保留的原版核心也通过这 1592 个退出，新增 oracle 不依赖候选实现。

新的有效格挡检查点，固定 30 帧两对结果：控制/冷分支候选分别为
1.578/1.900 FPS；反向为 2.138/2.136 FPS。第一对开始及结束 PNG 各自完全一致；
反向候选开始姿势略有差异。宿主 load average 从第一轮约 22 降到最后约 11，
不能把首轮差异归因于候选。未确认稳定收益，撤下运行时代码，保留 oracle
和本地实验补丁。后续优先分析已经采样到的 AP PMGR 时钟访问回退。


## 固定有效格挡输入的战斗检查点（2026-11-15）

旧 master 原样保留输入时，游戏会停在 “Hold to block” 教学等待，盾值 21
不变；`work30-neon-*` 两轮已标为拒绝，不能作为实际战斗性能。新
`active-master-profile` 在原版游戏已接受格挡、盾值 21→20 后暂停保存，
RAM 为 1,108,619,821 bytes，触摸队列为空、已处理的手指仍保持在盾牌上。
恢复前将统一时钟恢复 normal/rate 1，并在 Chrome 完全关闭后连同 NAND 克隆。

基准新增 `input=checkpoint`（保留上述已生效输入）和 `input=hold`（运行中释放
2000 ms 后持续举盾），避免周期手势的 wall-time 时序改变教学状态。当前采用
`active-master-profile`、`input=checkpoint`、预热 12+2 帧、完成 30 个完整
960×640 游戏帧、最多等待 120 秒；两端都验证亮屏和场景截图。它仍是实际发生
格挡的教学战斗短片段，不能推断完整战斗或过场的性能。

第一对控制/候选开始和结束 PNG 分别完全相同，盾值 20→19、双方 HP 1396/500，
没有全屏教学提示；这比仅凭完整帧计数更能排除场景差异。第二对候选的开始姿势
略有差异，比较时保留这一限制，不宣称严格逐帧确定性。后续每个候选均沿用此
RAM/NAND 与固定帧数协议，并保留原始图片及宿主负载。


## 页面 GPR 同步候选：未保留（2026-11-15）

尝试按页面引用集合，只加载/写回实际涉及的 R0–R14；条件写的目的寄存器也
加载初值，opaque helper 保守覆盖全部 GPR。独立代码页的 `qgprmask` 比较全部
15 个寄存器，覆盖假条件、寄存器移位、MOVT、VFP 通用寄存器传递及精确 helper、
双字/多寄存器/NEON 访存。8 个 QEMU 退出、完整 AArch32、fallback、seed 4387
随机程序、原 ARM7 状态与 PMGR 回归通过，样例存活代码减少 2632 bytes。

两对正常时钟 20 秒同场景测量：候选/控制为 34/33 帧（1.700/1.650 FPS）和
31/34 帧（1.550/1.700 FPS）。两端均在动态格挡教学阶段，没有进入全屏提示页，
但未验收到可重复收益。因此撤下运行时代码，保留新增 oracle 和本地实验补丁。

## 条件返回再次对照：未保留（2026-11-15）

在 retry 才写 ITSTATE 的基础上重新尝试最后一槽的条件 POP/LDR PC，并保留
这类页面原有的 GPR 存储策略。32 个真实 QEMU 退出现场、主核心/fallback、IT
访存和跨 ISA 回归、seed 4383 的 40×80×32 随机程序均通过；helper 从 6131 降至 31。

同一 God King RAM/NAND、同一输入、预热与 20 秒宿主时间窗口，三对结果如下。
六轮前后均正常亮屏、rate 1，截图均为动态战斗、无教学遮罩；每对开始截图相同。

| 对照次序 | 原版完整帧 / FPS | 候选完整帧 / FPS |
| --- | --- | --- |
| 原版 → 候选 | 17 / 0.850 | 22 / 1.100 |
| 原版 → 候选 | 17 / 0.850 | 18 / 0.899 |
| 候选 → 原版 | 15 / 0.750 | 14 / 0.700 |

第三对宿主 load average 分别约 25→22（候选）、38→34（原版），与前两对的
15–19 明显不同。短窗口也存在波动；目前不能确认可重复收益，因此运行时代码撤下，
保留原回归测试和本地实验补丁。上述数值均为真实完整游戏帧，**60 FPS 仍未达到**。

## 短战斗窗口与导航检查点（2026-11-15）

增加 `battle-start.png`：预热 12 个完整游戏帧后暂停、强制完整重绘并验证非黑屏，
恢复后再预热 2 帧才开始计时。结束仍保存 `battle.png`，两端均需人工确认是动态
战斗且没有教学遮罩。当前缩短到 20 秒，避免先前长窗口进入提示页；这不证明
较长战斗或其他场景具有相同帧率。最初两对共四轮正常时钟的浏览器测量已通过
亮屏、完整帧和可见截图检查，优化收益另行记录。

旧 RAM 内的手指先在**运行中的机器**释放 2000 ms，再开始新手势，避免在暂停
时产生相同时间戳的 Up/Down。`navigate=1` 仅恢复检查点并停住 CPU，不开始计时；
供原生 UI 教学导航使用，不产生 FPS 成绩。导航已实际触发格挡扣盾、攻击手势，
随后进入 God King 对话过场。该剧情 RAM 共 1,108,562,892 bytes，与当前 NAND
一起在关闭 Chrome 后克隆为 `build/ios/infinity-next/progress-master-profile`；
原战斗 master 保留，不允许把任一 RAM 与另一轮已推进的 NAND 混用。

## 输入积压诊断与临时文件清理（2026-11-15）

专用导航轮在原版 UIKit 的 `UIApplication.sendEvent:` 入口观察到延迟：
客体时钟从 2116.978 s 到 2129.959 s，所处理的 `UIInternalEvent` 时间戳仅从
2116.336 s 到 2118.204 s。随后读取 `_gsEvent` 所指的原版包，确认类型为 23、
轴数据为 `(0,-1,0)`；类型名称交叉核对 [Theos 的 GSEvent 定义](https://github.com/theos/headers/blob/master/GraphicsServices/GSEvent.h)。
先前查看 UIEvent 对象边界外得到的 1004 不作为事件类型。该观察轮临时恢复每条入口原指令后单步执行，结束时
已全部移除；不作为 FPS 成绩或之后保存的正式检查点。

后续仅在教学导航中把统一客体时钟速率设为 0.05，原版游戏的 `EAGLView` 中
已观察到有效 UITouch（phase 2、path 258、位置 30.5/240），格挡后盾牌值下降。
这项导航诊断不是提高真实游戏速度；正式对照必须恢复正常速率 1，以宿主真实
elapsed time 计算完整游戏帧率，并记录时钟模式与速率。

ARM 公开诊断现提供 clock mode/rate/now_ms/paused；基准在开始、预热后、结束
三处拒绝非 normal、rate 非 1 或暂停的时钟。独立真实核心回归验证 0.25 倍时间推进、
暂停冻结与宿主时间分别可见，避免把慢时钟导航误算为正常速度验收。

核对生成脚本和 `nand_build.mjs` 后，清理 `build/ios/ctrl-a.img` 至 `ctrl-e.img`
五个旧控制器探针：它们由空白 NAND bootstrap 和生成的 CX01 字节构建，未写入
系统/数据卷，无进程打开，原分配块合计 87.390625 MiB；每个 17.23 GiB 的稀疏
逻辑长度不能当作实际释放量。旧安装盘清理批次被自动审批拒绝（未证明不存在
独有存档），该批次未执行；相关安装盘、工厂源盘和战斗检查点均保留。

## Thumb 条件访存状态写回（2026-11-15）

原生 IT 块中的成功访存不再逐次设置、清除 PSTATE.IT。编译器记录当前指令的
静态 mask，只在统一 retry 出口写回，让解释器和异常现场仍取得精确 ITSTATE；
包括 inline/outlined lookup 的直接退出，不能只修改 `retry_if`。

`qitmem` 的数据移到独立页，防止 warm loop 写入代码页而持续失效，确保回归实际
执行缓存命中路径。增加跨页 load/store、第三条指令异常及 false 未对齐访问，
10 个退出与 QEMU 一致；主核心/fallback 与解释器一致，真实触发 2 次跨页和
4 次地址翻译拒绝。相同程序生成的存活代码从 110,064 bytes 降至 109,287 bytes。
`q3`、条件返回、跨 ISA 回归及 seed 4381 的 40×80×32 随机程序对照通过。
这是执行路径和正确性验证，尚未验收到该项的公平战斗 FPS 收益。

## 教学场景的对照限制（2026-11-15）

截图检查发现 60 秒长窗口会进入“Swipe to strike”教学提示；不同吞吐的构建在
提示页停留时长不同，不能将这样的混合窗口当作纯战斗 FPS 提升。CLCD 首轮
107 帧/60 秒（1.783 FPS）和其长窗口控制组 96 帧（1.600 FPS）因此不参加该项验收。

随后尝试同一 God King 检查点、相同输入、预热 12 帧后**再完成 60 个完整游戏帧**，
以真实 elapsed host time 计算 FPS，最多等待 180 秒，亮屏和完整帧计数要求不变。
旧核心首个固定工作量控制组完成 60 帧耗时 39.666 秒（1.513 FPS）。
新核心完成 60 帧耗时 28.860 秒（2.079 FPS），但截图仍显示不同教学状态：旧核心
HP 1396、盾 19，无提示；新核心 HP 1374、盾 20，仍有 Hold to block。因此这对
成绩也**不用于宣称公平的战斗 FPS 提升**。触摸与教学状态受 wall-time 时序影响，
固定帧数不足以解决。下一步先完成教学、创建与 NAND 匹配的新战斗检查点，再进行
较长实际战斗窗口；目前 60 FPS 未达到。

```sh
node tests/ios/clone-battle-profile.mjs \
  build/ios/infinity-next/battle-master-profile \
  build/ios/infinity-next/battle-work-profile
BROWSER_PROFILE=build/ios/infinity-next/battle-work-profile \
BROWSER_PORT=64978 BROWSER_DEBUG_PORT=9493 BROWSER_FOCUS=1 \
BROWSER_WASM=build/ios/infinity-next/perf/nohist.wasm \
TEST_ARTIFACT_DIR=build/ios/infinity-next/perf/fixed-control-1 TIMEOUT_MS=1200000 \
node tests/app/browser_runner.mjs tests/ios/battle-performance.html \
vm=9e3aab9c-cbd7-4ec0-9f6d-9887fa2e4410 warmup=12 frames=60 duration=180000 \
label=fixed-control-1 webgpu=1 autoplay=1
```

## CLCD 扫描优化（2026-11-15）

每次仍读取完整帧并计为扫描，先在 Wasm 中按全部 32 bits 比较；变化时保持原有
JS 像素转换，dirty、背光和 restore 仍强制重绘。DART 页直接聚集到 staging，
物理连续帧使用一次 typed-array copy；两个缓存仅为派生显示数据，不进入 guest RAM
或快照。并行运行的客体回退到原路径，避免比较和转换间的并发写入。
准备缓存后才取得 Wasm view，比较过程不再分配内存，以免 memory.grow 分离视图。

真实核心与原 JS 路径逐像素一致，覆盖每个 SIMD lane、末像素、alpha、背光舍入、
恢复、memory.grow、DART、部分无效映射和并行回退；SIMD/fallback、原设备/DART
回归通过。静态连续帧的三轮交替 600 次扫描，JS 672/631/633 ms，Wasm 92/94/93 ms；
这只证明该组件的比较成本下降，不能换算成游戏 FPS。
真实长窗口 3598 次扫描约 2.029 秒，对照约 6.270 秒；固定工作量时平均每次扫描
约 0.535 ms，对照 1.779 ms。保留此优化，战斗 FPS 的最终对照受上一节教学状态限制。

## 同一战斗检查点对照（2026-11-14 晚）

新增 `tests/ios/battle-performance.html`：从真实 God King 战斗 RAM 检查点恢复，
举盾位置固定为 `(45/46,480)`，每 2 秒移动 1 像素、每 16 秒释放 100 ms；预热 12 个完整游戏画面，
再采样 60 秒。计数来自成功、连续覆盖整个 960×640 IOSurface 的 GPU 读回，
同时记录 CLCD 实际画面变更、扫描耗时、读回等待、CPU 指令和 JIT 计数。
单独读取最后一条 strip、不连续行、不同翻转方向均不会被计为一帧；真实 GPU
回归覆盖这些条件。诊断计数不属于虚拟机状态，恢复后重新开始。

每轮必须从**关闭 Chrome 后的只读主 profile**复制工作 profile，保持同一端口、
VM ID、RAM 文件和 OPFS NAND 的身份及代次。macOS 用 `cp -cR` 创建 APFS 克隆，
避免额外复制约 4 GB NAND 和 1.1 GB RAM。不得在已写入的磁盘上反复恢复旧 RAM，
不得关闭磁盘代次检查。JIT 缓存不序列化，每轮都从同一冷 JIT 开始并预热相同帧数。

```sh
node tests/ios/clone-battle-profile.mjs \
  build/ios/infinity-next/battle-master-profile \
  build/ios/infinity-next/battle-work-profile

BROWSER_PROFILE=build/ios/infinity-next/battle-work-profile \
BROWSER_PORT=64978 BROWSER_DEBUG_PORT=9493 BROWSER_FOCUS=1 \
BROWSER_WASM=build/ios/infinity-next/perf/baseline.wasm \
TEST_ARTIFACT_DIR=build/ios/infinity-next/perf/baseline-1 TIMEOUT_MS=600000 \
node tests/app/browser_runner.mjs tests/ios/battle-performance.html \
vm=9e3aab9c-cbd7-4ec0-9f6d-9887fa2e4410 warmup=12 duration=60000 \
label=baseline-1 webgpu=1 autoplay=1
```

初版四轮完成 19–47 帧/60 秒，但其中有黑屏截图，**不能用作可见战斗的 A/B 成绩**。
持续 held touch 不足以可靠避免自动锁屏；现在先结束 RAM 中保存的手指，再开始
新手势，每 16 秒释放 100 ms 后重新举盾，并记录屏幕状态，窗口中任何息屏即拒绝。
采样后暂停 CPU、请求完整面板重绘，并校验截图非黑屏。`hold=1` 可保留现场供诊断，
此模式不会自动向 runner 报告成功。诊断轮的 profiler 成绩不作为 FPS。

修正输入与视觉校验后的基线 `awake-baseline-1`：**38 帧 / 60.003 秒 = 0.633 FPS**，
面板 39 次更新；前后均为满背光 2047，没有息屏事件，截图确认 God King 战斗。
该轮 CLCD 扫描累计 6.872 秒。后续对照只使用这一协议，前述黑屏试跑不参加加速比计算。

CPU Worker 独立 30 秒采样中，ARM 执行占 22.45 秒；`pages::run` 自身 1.95 秒，
解释器包含 5.67 秒，A32 helper 包含 3.38 秒（与解释器有嵌套，不相加）。
CLCD render 包含 3.44 秒；native readback 不是当前主要耗时。
本地 LLVM 反汇编确认 `f3a661cc/f3a441cc/f2a261ec/f2a151ec` 实际是
`vmla.f32 q3,q11,d12[0]` 等 **scalar-lane VMUL/VMLA**，不是立即数移位。
此前把编码当成 VSRA 的推断已纠正，相应未证明有效的 VSRA 改动已撤下。
多个实际 scalar-lane 变体各调用约 320 万次 helper，下一步为其生成带精确回退的 SIMD。

已实现 scalar-lane VMUL/VMLA/VMLS：按编码的 lane 从 Dm 广播至 `f32x4`，Q 选择位与
普通向量形式不同；只对 Dd/Dn 检查偶数 Q 编号。保留已有普通数、sticky IXC、下溢
和两次舍入检查，全部检查完成后才写回，覆盖标量与目的寄存器重叠。364 个 ARM/Thumb、
D/Q、两个 lane、Dd=Dn/Dm 与 Dd 重叠、NaN/denorm/tiny/zero、非法 Q 编码及 FP trap
用例与 QEMU、MMU page JIT 和解释器一致；fallback 构建结果也一致。

相同检查点和上述亮屏输入协议的首个有效对照：

| 构建 | 完整游戏帧 / 秒 | FPS | 面板更新 | helper 调用 |
| --- | ---: | ---: | ---: | ---: |
| 基线 `awake-baseline-1` | 38 / 60.003 | 0.633 | 39 | 115,168,915 |
| scalar-lane `scalar-1` | 59 / 60.001 | 0.983 | 60 | 75,929,948 |

两轮开始/结束满背光 2047，无息屏事件，非黑屏截图确认同一 God King 战斗。
第一对窗口提高约 55%，仍需交替复跑确认波动范围，**60 FPS 未达到**。
优化后独立诊断中，原先高频的 scalar-lane 编码已退出前 40 个 helper 热点；
截图、原始计数与采样文件保存在 `build/ios/infinity-next/perf/`，不提交专有游戏数据。

PMGR 实验（已撤下）：独立 MMIO 计数中 `+0x2004/+0x2000` 合计 2857 万次，
尝试在当前 EL 权限/对齐校验后，用实际 AppleTimer handler 提供单次 scalar LDR，
不缓存值或指针。低/高位 rollover、暂停/恢复、真实 EL0 循环及宽度/写入/权限/owner
排除均通过，ARM7 原路径也通过。实测首版 22 帧/60 秒（0.367 FPS），去除 BigInt
转换的第二版 32 帧/60 秒（0.533 FPS），虽大幅减少翻译拒绝，均没有优于 scalar-lane
基线；因此没有保留该运行时代码，也没有把计数下降称为 FPS 提升。

回归暴露调试版启动修复访问 `ram.byteLength` 与动态内存 view 的属性约束冲突，
改用等价的 Uint8Array `length`，增加真实 proxy view 覆盖，IOP clock/status 和 I2C
255/256/512-byte 用例通过。清理已被 generation-7 战斗 NAND 替代、无打开句柄或
符号链接引用的 `build/ios/infinity-play/direct-fixed.packed`，释放约 3.73 GiB；
保留 `mp3-battle.packed` 与匹配检查点，清理记录在忽略目录 `perf/cleanup.json`。

scalar-lane 版本交替控制轮 `scalar-2` 为 65 帧/60.002 秒（1.083 FPS），与首轮
0.983 FPS 接近。随后试验 Thumb IT 内 VFP/NEON 原生化，20 个条件真假、NaN/denorm
精确回退、首/次指令 FP trap 的 ITSTATE 用例与 QEMU 一致，SIMD/fallback 均通过；
但战斗只有 44 帧/60.002 秒（0.733 FPS），高频 vector FP helper 仍在，因此撤下
运行时改动，仅保留 `qitfp` 的回归覆盖。继续针对实际保留的 VCMP/VCMPE helper 工作。

新增 VCMP/VCMPE 的普通数/零快路径，只更新 FPSCR.NZCV；NaN、无穷大、denorm
仍由精确 helper 处理。293 个单/双精度、比较零、条件失败、FP trap 及标志组合与
QEMU/解释器一致，fallback 同样通过。其独立试跑为 0.867 FPS，未单独验收到收益。
随后优化 NEON 的 guard：合并 f32 的上下界比较，删除非累加运算的重复结果检查；
对可证明精确的零操作、抵消和乘以二的整数次幂，允许 IXC 保持清零，其他运算仍
检查 sticky IXC 或回退，VMLA/VMLS 保留两次舍入。

256 个每次运算前清除 IXC 的新增边界用例、364 个 scalar-lane/别名用例、既有
180 个向量 FP 用例及 600 个 A64 SIMD MMU/JIT 随机用例（77 种形式）均与 QEMU
一致；SIMD/fallback、单个不精确 lane、tiny/overflow、符号零及标志保留均通过。
组合构建 `exact-1/exact-2` 同场景完成 **76/66 帧，分别为 1.267/1.100 FPS**，
面板 76/67 次更新、全程亮屏。相对 scalar-lane 的 0.983/1.083 FPS 有小幅改善，
样本仍少，不能给出稳定加速比；60 FPS 未达到。

进一步读取原生状态时，按 TTBCR.N=2 的真实 4 KiB TTBR0 对齐解析页表，四个代码页
与本地 dyld cache 字节匹配得到同一 slide `0x18f6000`。原先最热的
`0x3242f000/0x324ef000` 实际属于 **AudioToolbox**；`0x32969000` 是
CoreFoundation，`0x3ab0b000` 是 libsystem_c，不能按未修正 slide 的地址猜库名。
独立进程观察窗口约 76.6 秒，65.7 秒 core 执行中约 39.6 秒横跨上下文切换，
无法精确分摊；同一线程窗口中 mediaserverd 占约 13.8 秒、SwordGame 约 4.3 秒。
这些是近似 CPU 归因，不能当作各进程完整占比，也不混入 FPS 成绩。
I2S0 为 44100 Hz，控制/模式寄存器 `0x181/0x03000081`；AMC mask/pending 为零，
没有活动 decoder 或解码失败。后续应继续定位音频处理及调度开销，而不是仅靠 FPS 计数器。

通过 Wasm helper 的条件断点进一步采样 `ef026d24/ef035d23`：它们是
`vadd.f32 d6,d2,d20` / `vadd.f32 d5,d3,d19`，返回地址属于 AudioToolbox。
首次命中含 `0xffffff26/0x7fc00000` NaN，随后八次命中中 D2/D3 的第二个 lane
为 `0x9b9/0xa16` 等非规格化数。FPSR 低位均为 `0x9d`，即 IOC、OFC、UFC、
IXC、IDC 已置位。普通数 guard 因此持续回退，不能仅凭 helper 数量将其归因于 IT。
断点显著改变执行速度，这些数据只解释回退条件，不参加 FPS 对照。

随后试验仅在 `FPSR & 0x9d == 0x9d` 时用 SIMD 实现输入 FZ、输出 FZ/DN，
下溢边界保留 helper。712 个 ARM/Thumb、D/Q、scalar、别名、缺失 sticky bit
用例与 QEMU、MMU/JIT、fallback 一致。但后置路径两轮为 0.983/1.400 FPS，
优先选择该路径的一轮为 1.183 FPS；交替原版控制组为 1.433 FPS。
helper 虽从控制组 7433 万次降至 5532–5921 万次，**没有验收到 FPS 收益**，
已撤下运行时试验，仅保留 `qneonsticky` 回归。不能把 helper 减少作为游戏提速。

新 CPU 诊断窗口中 `pages::run` 自身约 2.13 秒/30.05 秒，解释器包含 7.24 秒，
CLCD render 包含 3.31 秒，各包含时间有嵌套，不能相加。八次 IT helper 断点显示
`bf08/bf18` 后多为内核条件 `POP {…,PC}`；`bf1c` 后包含条件 BLX。
下一步优先验证最后一条 IT 指令的条件返回，保留内存 fault 和跨指令集重试的 ITSTATE。

额外删除已被主 profile 替代、无打开句柄的旧 `infinity-next/browser-profile`
（逻辑大小 5.28 GB）。由于 APFS 克隆共享块，不将该逻辑大小报告成实际释放量；
匹配的主检查点和当前工作克隆保留，记录在忽略目录 `perf/profile-cleanup.json`。

只读解析用户原 IPA 的 `Coalesced_INT.bin` 和 `Coalesced_CHN.bin`，两份均完整解析
到文件末尾。`IPhone-SwordEngine.ini` 的 `Engine.Engine` 段为
`bSmoothFrameRate=TRUE`、`MinSmoothedFrameRate=20`、`MaxSmoothedFrameRate=35`，
`SystemSettings.UseVsync=False`。这是原包的配置事实，尚不能证明运行中的对象没有
覆盖它；后续接近该范围时还须核实引擎限帧，否则仅优化模拟器也不能保证 60 FPS。
当前约 1 FPS 远低于此范围，先处理 CPU 瓶颈。没有修改 IPA 或存档配置，保持 A/B 场景
一致；只保留上述属性的本地证据在 `perf/frame-config.json`，不提交原包内容。

条件返回试验：让 IT 最后一槽的 POP/LDR PC 使用原有内存模板，重试前保留该槽
ITSTATE，成功后在 dispatch 前清零；32 个热循环、真假条件、fault、writeback、
ARM interworking 用例在 `A64_MMU=1` 下与 QEMU 一致（无 MMU 时 QEMU 的物理
0 地址是未分配总线读，本实现会 abort，不能用它比较页故障）。MMU/JIT 和 fallback
一致，helper 从 6131 降至 31；40×80×32 随机程序、arm32 system/mmu 同样通过。
但战斗只有 0.633 FPS；保留原页面寄存器策略的隔离版本仍为 0.633 FPS。
后续原版控制组为 1.050 FPS（之前 1.433），主机同期另有两个高 CPU 的 NV40
测试，16 GiB RAM、约 12.8 GiB swap 在用。因此不推断精确回退百分比，也不将
原先的页面寄存器策略变化确认为原因。该运行时试验已撤下，仅保留 `qitreturn`。
下一步检查高频的 ARM/Thumb BLX/BX 互跳，尽量避免完整取指和解释器解码。

已为 ARM/Thumb BLX immediate 与跨 ISA 的 BX/BLX register 生成直接路径，
保留原模式、NZCV 与中断掩码，先读取目标再写 LR；切换后直接退出旧 ISA 的函数，
不使用旧模式的 chaining 表。19 个热循环覆盖双向、正负位移、H=1、Thumb 调用点
2 mod 4、BLX LR 别名、后续 fetch fault 与非法 BLX 低位，均与 QEMU 一致；
MMU/JIT、fallback、既有分支/IT 用例和另 40×80×32 随机程序通过。
同场景首轮 61 帧/60.002 秒，约 **1.017 FPS**，与邻近原版 1.050 FPS 接近，
仍不能声称 FPS 提升。解释器 steps 从 5845 万降至 2560 万、retries 从 9882 万
降至 6645 万，但 page activations 从 1.419 亿增至 1.495 亿；后续需要优化互跳
后的模式正确的 chaining，不能只以减少解释器调用作为完成条件。

测量工具新增只读 `/__host_metrics`：每轮在计数窗口前后保存 CPU 并行度、
1/5/15 分钟 load average、总/空闲内存与磁盘可用字节，不采集进程参数或用户内容。
首个集成窗口确实返回两份记录（16 GiB RAM、约 122/149 MB 空闲）；这些只用于
识别外部负载变化，不参与 FPS 计算，也不用于将某轮结果“校正”成更高帧率。

模式 chaining 现通过很短的原生 helper 设置目标 T 位并选择该模式的表；保留同一
EL、ASID 和数据访问 epoch，沿原有 epoch/tag 校验连接，miss 时返回调度循环。
不再用原 ISA 的表查找新 ISA 的 PC。增加两种热目标代码自修改用例，确保同一页
的 ARM/Thumb 缓存均被失效；21 个 QEMU 用例、MMU/JIT、fallback、分支/IT 回归
和 40×80×32 随机程序均一致。无自修改时测试页激活从 3598 降至 389 次。

同检查点、相同亮屏协议和 60 秒窗口的交替结果：

| 构建 | 完整游戏帧 | FPS | 起止 1 分钟 load average |
| --- | ---: | ---: | --- |
| 模式 chaining 第 1 轮 | 92 | 1.533 | 10.41 → 8.61 |
| 原版控制 `exact-5` | 70 | 1.167 | 9.96 → 9.14 |
| 模式 chaining 第 2 轮 | 83 | 1.383 | 7.52 → 9.48 |

新构建两轮均高于邻近原版控制（另一次 `exact-4` 为 1.050 FPS），保留此优化；
主机负载有变化、样本仍少，不能给出稳定提升百分比。第 1 轮实际页面激活降至
约 8972 万次，截图确认仍在 God King 战斗、全程亮屏。**60 FPS 尚未达到。**

一次切换实验中 Chrome 尚在退出、清理目录失败；该轮 `nohist-2` 被丢弃，未作为
对照证据。新增 `clone-battle-profile.mjs`：先检查进程锁和打开句柄，仅允许 build/ios
内相互独立的浏览器目录，确认关闭后才删除工作副本并用 APFS 克隆；任何清理或复制
失败即抛错，避免把主 profile 嵌套复制进仍存在的旧工作目录。活跃源目录拒绝测试
保留了目标 sentinel；真实关闭 profile 的克隆也通过。源 NAND 的代次检查继续启用。
同时修正 runner：Chrome 在结果上报前退出时明确失败、关闭 HTTP 服务；无 VM 的
提前关闭测试验证失败信息和端口可以重新绑定，避免后续一轮误连旧测试服务。

修正 `a64_step_stats=0` 仍更新 A32 完整 word histogram 的遗漏。普通 iPhone UI
明确关闭逐指令统计，debug UI 保留；总指令、helper 总数及实际 drawable/panel 计数
始终保留。新增 0→1→0 各 64 次 NOP 回归，验证只在开启时增加直方图、总 helper
仍准确计数、R0 不变；22 项配置测试及关闭统计后的 21 个互跳、712 个异常浮点
QEMU 用例通过。普通 UI 恢复检查点后实查开关为 0，word histogram 为空。
两轮有效成绩为 88/77 帧，即 1.467/1.283 FPS；无效 `nohist-2` 不计入。
与前一版 1.383–1.533 FPS 接近，主机负载变化明显，**没有单独验收到 FPS 收益**。

该版本独立 30.07 秒 CPU 采样：CLCD render 包含约 3.42 秒、其中循环自身约
2.63 秒，surface_words 包含约 0.79 秒；pages::run 自身约 3.00 秒，解释器包含
约 5.68 秒，各包含时间不可相加。AudioToolbox 的浮点 helper 已不是当前最大的
采样项。下一步优先缩短未变化面板的完整 JS 像素比较，保留每次真实扫描、像素变化、
背光、映射切换和 snapshot restore 的显示语义。

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
