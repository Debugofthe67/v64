# iOS 6 桌面和 2D 游戏性能

## 计量协议（2026-11-17）

`tests/ios/ui-performance.html` 分别测试 SpringBoard 翻页与 PvZ 实际关卡。先通过真实 UI 定位场景，
用 `setup=1` 和 `checkpoint_save('springboard'|'pvz')` 流式保存 RAM。关闭浏览器后，克隆整个测试
profile，保证 RAM 与 OPFS NAND 的身份、内容和代次配对；每一轮重新克隆，不复用上一轮推进后的磁盘。
macOS 用现有 `tests/ios/clone-battle-profile.mjs` 创建 APFS 共享副本，不新建原始 NAND/HFS 镜像。

桌面交替执行左右 600 ms 拖动，仅统计移动阶段。按下后的 150 ms 等待、松手后的 650 ms 停顿及
截图暂停均排除。PvZ 记录同一关卡检查点的实际游戏画面，预热后计量固定时长。
采用 normal、rate 1 的虚机时钟；任何息屏、黑屏或零画面更新窗口均拒绝。
LCD FPS 来自 CLCD 内容变化，游戏 FPS 来自完整成功发布的 960×640 IOSurface；两者分开报告。
同时保留完整前后诊断、宿主负载/空间/Chrome 进程 CPU 时间及起止截图。
进程 CPU 时间不是 GPU 硬件耗时，多个表面的读回等待也可能重叠，不能直接相加解释全部时间。

第一轮桌面控制 `desktop-control-1` 预热 4 次拖动，20 次计量拖动得到 309 次可见更新，
活动窗口 12,266.18 ms，**25.191 FPS**。对应 CLCD 扫描累计 885.635 ms，共有表面的读回等待
累计 3,482.215 ms；仍有明显 JIT 活动。因此后续默认预热提高为 40 次拖动，再做配对复测。
这轮仅为较短预热的基线，不作为未验证候选的加速成绩。

场景图片、检查点及原始数据仅保存在本地 `build/ios/ios6-2d/`，不提交用户固件、游戏或浏览器数据。
