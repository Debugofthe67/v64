# GeForce 6800 GT（NV40）显示适配器实施计划

状态：G0–G7 的本次实施与验收已完成，保留下述已记录偏差；设备仍为 experimental。实施分支：`refactor`。

2026-11-17 的 XP 175.16 后续修复按用户要求提交于 `ios6`：接通关闭 API 代理时的
浏览器 WebGPU 加载，补全 PVIDEO 原生视频通知，并修复未使用的 TEX8/9 控制字及
SHORT2N/SHORT4N 顶点声明。原版 DxDiag 和三款游戏的功能验证见下表；这不扩大
93.71 的基准测试或性能结论。GTA SA 当前仍较慢，不计作流畅度验收。

本阶段实现 AGP 版 GeForce 6800 GT 的 NV40 身份，在 i440FX/IDE 平台以 PCI 模式运行。
原版 XP 93.71 和 Win98 81.98 都接受此路径，因此未触发可选 A1（AGP/GART）。
设备保持 experimental；既有 XP/98 预设保留原显示适配器。

## 阶段与验收证据

| 阶段 | 交付与验收 | 证据 |
| --- | --- | --- |
| G0 | PCI/BAR/PROM、官方驱动跟踪、XP PFIFO 初始化与 Win98 PCI bus 枚举 | [XP 初始化](../tests/acceptance/nv40/g1-xp-9371-initialized.json)、[Win98 PCI](../tests/acceptance/nv40/g0-win98-pci-bus.json) |
| G1 | 自编 NV VBE ROM、VPLL、光标、gamma、EDID；两驱动桌面/模式切换、DOS 与快照往返 | [桌面](../tests/acceptance/nv40/g1-xp-9371-desktop.json)、[模式/DOS](../tests/acceptance/nv40/g1-native-modes-dos.json) |
| G2 | DMA/PFIFO/RAMHT/RAMFC、通知/中断及 CPU 2D/GDI/字体；两系统原生 DirectDraw/DxDiag | [XP](../tests/acceptance/nv40/g2-xp-9371-dxdiag-ddraw.json)、[Win98](../tests/acceptance/nv40/g2-win98-8198-dxdiag-ddraw.json)、[字体](../tests/acceptance/nv40/g2-xp-9371-font-reference.json) |
| G3 | 原生固定功能生成程序、纹理/表面、DxDiag 3D；99 MAX、2000 完整套件与固定帧 | [99/2000 图像复核](../tests/acceptance/nv40/g5-legacy-original-fixed-frame-review.json)、[设备说明](gpu-devices.md#geforce-6800-gt) |
| G4 | VP/FP 指令、控制流/条件码/地址、半精度别名、顶点纹理、MRT、FP16/32、深度比较/查询；2001/03/05/06 原版套件、图像 | [旧套件](../tests/acceptance/nv40/g5-legacy-original-fixed-frame-review.json)、[03](../tests/acceptance/nv40/g4-03-nine-point-sprite-fixed-frames.json)、[05](../tests/acceptance/nv40/g4-05-current-format-eight-fixed-frames.json)；[06 四图](../tests/acceptance/nv40/g4-06-current-cold-four-fixed-frames.json)、[七项特性](../tests/acceptance/nv40/g4-06-seven-feature-reference-review.json) |
| G5 | 81.98 下99/2000/2001/03；16-bit RA2、8-bit StarCraft、DOS、桌面返回及正常关机 | [03 九图/生命周期](../tests/acceptance/nv40/g5-win98-8198-03-nine-iq-desktop-return.json)、[RA2](../tests/acceptance/nv40/g5-win98-8198-ra2-16bpp.json)、[StarCraft](../tests/acceptance/nv40/g5-win98-8198-starcraft-8bpp.json) |
| G6 | 缓存、顶点/常量/索引准备、FIFO/传输热点优化；同配套状态、release、单客体重复采样 | [两次 GT1 渲染窗口](../tests/acceptance/nv40/g6-xp-9371-06-final-gt1-work-windows.json)、[方法](profiling.md#native-nv40-guests) |
| G7 | 管理器集成、驱动/偏差/性能文档、证据复核与本计划精简 | [设备](gpu-devices.md#geforce-6800-gt)、[偏差](gpu-deviations.md#geforce-6800-gt)、[收尾](../tests/acceptance/nv40/g7-final-closeout.json)、[历史完整性检查](../tests/acceptance/nv40/g7-retained-artifact-integrity.json) |

## 原版客体覆盖

| 客体 | 已验证套件 | 图像方法 |
| --- | --- | --- |
| XP SP3 / 93.71 | 99 MAX 26项、2000 22项、2001 SE 21项、03 11项、05 16项、06默认6项及补充7 feature/6 batch | 原版 IQ；06 feature 无 IQ 时用原版固定帧率模式的匹配 HUD 帧截图 |
| XP SP3 / 175.16 | 原版 DxDiag DirectDraw/D3D7/8/9；Warcraft III、KartRider、GTA SA 实际画面与操作 | [DxDiag](../tests/acceptance/nv40/xp-17516-dxdiag.json)、[魔兽3](../tests/acceptance/nv40/xp-17516-warcraft3.json)、[跑跑计时赛](../tests/acceptance/nv40/xp-17516-kartrider.json)、[GTA 新游戏与移动](../tests/acceptance/nv40/xp-17516-gtasa.json)；各自记录退出与关机 |
| Win98 SE / 81.98 | 99 MAX 26项、2000 22项、2001 SE 21项、03 11项 | 原版 IQ，XP/Win98与API代理参照逐图复核 |

成功项目文件、完成窗口、GPU/FIFO/PGRAPH 诊断、原始 BMP、配套 RAM/磁盘及正常关机
证据分别记录；一次保存或一个短采样窗口不能替代整套完成。较早的真实驱动超时和宿主
ENOSPC 失败保留在实施历史，不归因于未经隔离验证的单一优化。

参考路径使用同一原始游戏镜像和现有 D3D 代理，比较内容、局部差异与逐像素统计。
06 Shader Particles 的三次原生六帧序列相同，云团中心/宽度/亮度与参考对应，但单粒子位置
存在显著且稳定的跨路径差异；未定位唯一原因，不声称逐粒子轨迹一致。
99/2000/2001 的 I 图排除顶部64行元数据，T 缩略图不排除；03/05/06排除底部64行。
所有原图、SHA、最大值、分位数和有符号误差均保留。API代理与原生驱动生成程序的
算术/栅格路径不同，已记录的局部细节残差不等于物理NV40位精确验证。
原版固定帧率的 feature 截图只验证图像，不报告默认测试分数或性能。

## 实现与运行契约

- `graphics_adapter: "geforce_6800"`，128/256 MiB VRAM。XP 使用1024–2048 MiB RAM；
  Win98通常256/384/512 MiB，03完整冷跑使用512 MiB。当前原生路径是 i440FX、IDE、无ACPI。
- `src/graphics_adapters/geforce_6800/` 分离设备/显示、DMA/PFIFO、PGRAPH/2D、状态/纹理、
  VP/FP 解码翻译及 D9WG 渲染桥。沿用共享 WebGPU 执行器，保留NV40私有硬件语义。
- 原版官方驱动与原始OS/game镜像不修改；客体写入只发生在overlay。下载驱动、用户素材、
  私人注册码、RAM和原版程序不随源码分发。仓库 ROM 从 `bios/nv40/` 的 SeaVGABIOS 后端构建。
- DMA 检查完整地址/权限/limit，跨页故障不留下半个通知。未知已检查的绘制状态明确故障，
  不伪造完成。原生软件回调 `17D0/17D4, source64,status16384` 单列，不当成硬件绘制失败。
- VRAM 是快照权威；依赖操作和保存前完成GPU工作并回读。恢复时重建宿主纹理/程序缓存。
  `.bundle.json` 校验 RAM、OS/game overlay、客体/显存和原盘路径；`.state.zst` 与 overlay `.bin.zst` 透明无损恢复。
- 测试保持正常时钟，不改客体驱动、分数、计时或看门狗。性能采样一次只执行一个客体，
  宿主其他负载另作说明；后端 pending 墙钟与Node CPU可重叠，信号量次数不当作FPS。
- 宿主余量默认保护8192 MiB（`NV_DISK_RESERVE_MB`）；不足时尽可能保存配套检查点并退出。
  RAM只在完整解压SHA校验后删raw；仅删除已关闭客体不用的临时IMG/可再生成缓存。

## 验证与复现

```sh
make devices-test
make test-glbridge
make build/v86-geforce-6800.js
NV_GPU_RENDERER=chrome node tests/devices/geforce_6800_render.mjs
```

原生客体使用 `tests/devices/geforce_xp.mjs` / `geforce_win98.mjs`，设置
`TEST_RELEASE_BUILD=1`、`NV_GPU_RENDERER=chrome`，按fixture提供匹配镜像/overlay。
`NV_STATE_LOAD` 可从已校验配套状态恢复，`NV_TRACE=0` 保留故障与计数而关闭重型跟踪。
冷启动的 `NV_UI_BINARY` 将原生 helper 送至IDE工具盘；不得与RAM恢复混用。
`NV_CPU_PROFILE=1` 的报告用 `node tools/nv40_profile_report.mjs <out>` 汇总。
最终 G6 采样从同一活动 GT1 配套状态恢复；颜色图是已完成批次的中间表面，
用于确认渲染工作，不据此声称完成呈现、默认套件耗时或FPS。
详细方法、解释范围及配置见 [profiling.md](profiling.md#native-nv40-guests)。

## 限制与可选阶段

当前验证范围和明确拒绝的状态见 [gpu-deviations.md](gpu-deviations.md#geforce-6800-gt)。
这不是周期精确NV40或物理显卡分数等价；NVIDIA驱动暴露的硬件能力可能大于已经验证的组合。

- A1：i440BX/AGP/GART，仅在官方驱动必须依赖AGP时触发；本次PCI验收未触发。
- V1 的 packed YUYV/UYVY、颜色键和原生 PVIDEO 通知路径已在 175.16 后续修复中接通，
  见 [PVIDEO fixture](../tests/acceptance/nv40/pvideo-native-counter.json)；planar/精确滤波仍待验证。
- P1：3D扫描输出免回读合成。
- O1：用所有者OpenGL游戏验收ICD；W1：Vista/7 WDDM。

以上仍为独立可选阶段，不计入本次G0–G7。
完整逐次实施记录和来源保留在 [实施历史](geforce-6800-implementation-history.md)，当前事实以本页与fixture为准。
