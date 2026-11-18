# Nokia N97 RM-505 固件与早期引导验收

## 固件基线

使用原厂 22.0.110、产品代码 `0576555`、变体 `001`（MENA MEA B black）。本地 VPL 的 SHA-256 为 `c779d64d3a5d4e5cc1e3a9611e28c3115857a14dce430118a9d8187bf6972c38`。七个必需文件均在场，六个清单 CRC 与文件一致。节点工具以下列命令重建并校验镜像，输出 `firmware.json` 记录全部字节数与摘要。

```sh
node tools/symbian/vpl.mjs check <firmware-directory>
node tools/symbian/vpl.mjs extract <firmware-directory> <new-output-directory>
```

| 核对项 | 样本结果 |
| --- | --- |
| 应用处理器 `SOS+CORE` | 重建的 ROM/XIP 为 15,646,720 字节。1954 页经 BytePair 展开，34 页按原样复制。SHA-256 为 `9c0863e379d243f953d3cfcd87d11c98231f2d0469e69244d9ee059472c99194`。ROM 目录可枚举 988 个文件，含 `Sys/Bin/ekern.exe`（253,592 字节）。 |
| ROFS1 | 90,117,152 字节，枚举出 5109 个文件。`resource/versions/product.txt` 的 SHA-256 以 `ec853bea66cf` 开头。 |
| ROFS2 | 19,889,920 字节，枚举出 4315 个文件。`resource/bootdata/languages.txt` 的 SHA-256 以 `85bd605b71ed` 开头。 |
| ROFS3 | 440 字节，包含 `customersw.txt`、`fwid3.txt`。 |
| UDA | FAT16 逻辑长度 76,640,256 字节。容器提供的 9,216,000 字节覆盖最后一个已分配簇（2237）。余下空闲区作为稀疏零区写入本地文件。 |

FPSX 的程序、证书和擦除范围以闪存地址记录。`SOS+CORE` 中 ROM 头对应的闪存地址为 `0x00D61000`，`TRomHeader.iRomBase` 给出的虚拟基址为 `0x80000000`。头部第一条分支的目标是 ROM 偏移 `0x1880`，重启分支目标是 `0x1D00`。主 ROM 映像 `ekern.exe` 的头声明其虚拟入口为 `0x8004F110`。当前引导试验在 RAM 中从 ROM 偏移 0 开始，保留原版分支和初始化指令。[Symbian ROM 头与页表](https://github.com/SymbianSource/oss.FCL.sf.os.kernelhwsrv/blob/master/kernel/eka/include/e32rom.h) · [Symbian ROFS 结构](https://github.com/SymbianSource/oss.FCL.sf.os.kernelhwsrv/blob/master/userlibandfileserver/fileserver/inc/rofs.h)

## 板级交接与实际执行

`new V86({ machine_type: "nokia-n97", symbian: { rom } })` 将本地 22.0.110 XIP 放在物理地址 `0x08900000`，并从 ROM 偏移 0 执行。可用 `load_address` 与 `boot_registers` 成对指定裸机诊断交接。板型单核、128 MiB，CPU 参考 QEMU 的 ARM1136 r1p3（MIDR `0x4117B363`）。RM-505 板图确认 RAPIDOYAWE 和组合存储，真机的 MIDR 修订值待测。[Nokia RM-505 板图](https://www.manualslib.com/manual/896600/Nokia-N97-Rm-505.html) · [Arm ARM1136 TRM](https://developer.arm.com/documentation/ddi0211/k/) · [QEMU ARM1136 CPU 参数](https://github.com/qemu/qemu/blob/master/target/arm/tcg/cpu32.c#L1940)

| 交接项 | 固件证据与当前实现 |
| --- | --- |
| ROM 物理地址 | CORE 的应用处理器闪存 TOC 位于 `0x80000`，SHA-256 为 `482b607a6113162e95a984b6d26bb2af30d08afbe8d338dc00f8fa34dec696d1`。原始 `SOS+CORE` 记录从闪存 `0xD60000` 载入 `0x088FF000`，ROM 头在该范围偏移 `0x1000`。 |
| 主内存和 SRAM | RAP3NAND `+0x314C–0x3174` 以 `0x08000000` 为 SDRAM 基址并写入 type 4。主内存范围是 `0x08000000–0x0FFFFFFF`。RAP3NAND 的 SRAM 交接地址 `0x30003EF0` 和 type 5 给出 16 KiB 的 SRAM。原版 ROM 在 `0x30000010` 保存 R0–R3，并以 `0x30001000` 为初始栈顶。 |
| 配置记录 | 原版标签用小端 `type, byte_length, payload`，从 SDRAM 顶部向下建立。R2 指向表首，本机型用连续表并为 ROM 在 type 2 结尾的三字读取预留一个字。原版查找和复制函数在 ROM `+0x1C04`、`+0x1BC4` 识别 type 3 续表地址。R0、R1、R3 目前采用零作为默认交接。 |
| 频率、启动原因和保留区 | RAP3NAND `+0x3254–0x3266` 写入 type 22 的 433,920,000 Hz 和 type 7 的 433.92 MHz。type 13 取加载器 `+0x1CCC` 使用的初始原因 `0x00012400`。type 16 对应加载器 `+0x331A` 的 MDI 缓冲区，原版据此在 SDRAM 顶部预留 3 MiB。 |
| type 10 目录 | RAP3NAND `+0x32A6–0x32BC` 写入 SDRAM TOC 指针。加载器 `+0x13A2–0x13D6` 生成 32 字节条目并用 `0xFF` 结尾，`+0x167E–0x16A0` 按表改名为 `MCUSW`。本机型在 `0x0FCFF000` 重建已装载 XIP 的单条目录，其他引导映像的内容与地址仍需建模。 |
| 初始计时器和控制字 | ROM 与 RAP3NAND 都向 `0x20040484` 写 1，向 `0x20040494` 写 0 后读取 `0x20040490`。RAP3NAND `+0x596–0x5AA` 对计数差乘 `2^-15`，计时器模型使用 32,768 Hz 并在写捕获寄存器时锁存。ROM 向 `0x20040308` 写 8，当前保存这次写值。 |
| 共享引导字 | ROM `+0x1958` 读 `0x20032D10`，随后在 `+0x1974` 覆盖该值。分别返回零与 `0xFF55AA99` 时，到该指令的 1,867 步 PC 序列、R0–R15 和 SDRAM+SRAM SHA-256 完全相同（`05b6342917737168c79e259ab9d1bd303a861bdc2d33d3d642b3c2c2d6e8745a`）。机型使用零作为该只读字的复位值假设。ROM 重启路径还访问其邻近的 `0xC6032D14`，与 `0xC6050014` 共同参与握手。 |

## 原版内核与板级时钟

默认机型从本地 XIP 启动。工具记录客体访问和异常，使用与浏览器相同的板级模型。最初的 S1.2 探测在物理 `0x20030300` 处观察到版本查询。加入下列板级行为后，原版自己启用了 MMU、执行 `ekern.exe` 并完成变体时钟初始化。

| 设备 | 依据与实现 |
| --- | --- |
| ARM1136 CTR | `0x1D152152` 按 Arm DDI 0211K §3.3.2 编码，Ctype 为 `1110`，指令和数据缓存各 16 KiB、4 路、32 字节行。此前的值使原版 XTI 记录 `CacheFault 0x00000074`。[Arm ARM1136 TRM](https://developer.arm.com/documentation/ddi0211/k/) |
| RAPIDO 修订查询 | 写 `0x20030300` 选中命令 `0xA` 时返回 `0x0003110A`。ROM 将 `[15:8]` 与 `[19:16]` 重组为 `0x113`。仿真采用服务记录中出现的 RAPIDO3G 1.13 作为代表修订。尚未读取该固件样本对应的物理主板寄存器。[RM-505 服务读取](https://forum.gsmhosting.com/vbb/f550/n97-restart-917790/) |
| L2x0 | 基址 `0x50000000`。固件访问 `CTRL`、`AUX_CTRL`、`INV_WAY` 和 `DEBUG_CTRL`。辅助寄存器声明 8 路、每路 16 KiB。缓存维护在 V86 的一致内存上同步完成。[Arm 的 Linux L2x0 寄存器定义](https://github.com/torvalds/linux/blob/master/arch/arm/include/asm/hardware/cache-l2x0.h) |
| RAPIDO 时钟 | ROM `0x8008D948` 使用 38.4 MHz 基频和 `0x20032D24`、`0x20032C04` 的分频字段。默认 M=113、N=9、后分频=0，重现加载器的 433.92 MHz。变体在 `0x20032D84` 设置 PLL3 倍频，通过 `0x20032C84` 和 `0x20032D8C` 上电及启用，再读后者的 bit 4。模型在有效配置和使能成立时置位，省略模拟电路稳定时间。 |
| XTI | 原版以 byte 写入 `0x401E0000` 或 `0x401E2000`，再向 `0x401FD800` 写 `0xE0` 或 `0xE2` 提交相应通道。最近的包出现在 CPU 诊断中。设备状态包括部分包，可在挂起后接续。 |
| 调试启动字 | `0x10001F00` 为冷启动只读零。ROM `+0x1EA0` 只在该字为 `0xDEB0DEB0` 时进入带延时的调试分支。 |

| 实测点 | 执行结果 |
| --- | --- |
| 第 29,801 步后 | SCTLR.M 在物理 PC `0x08900A88` 首次置位，随后执行链接地址 `0x80000A90`。 |
| 第 1,336,737 步后 | 到达 `ekern.exe` 的 `0x8004F110`，R0=`0x80000000`、R1=`0xC0000000`、SCTLR=`0x00C5387D`。执行首条指令后 PC 为 `0x8004F114`。 |
| 第 1,360,182 步后 | 变体时钟配置返回到 `0x8009746C`。原版已经读取到 PLL3 锁定状态 `0xD490`。 |
| 第 1,360,196 步 | 原版在 `0x800974C4` 写 `0xAAAAAAAA` 到 VA `0xC6031C10`，产生外部数据异常（DFSR `0x808`）。此地址之后是一系列相邻寄存器的写入，具体设备语义待核对。 |

独立裸机探针还覆盖 ARM/Thumb 互操作、SVC/IRQ 进入和返回、ARMv6 短描述符地址转换及数据异常。旧版 N97 机型配置可继续冷启动。由于新增板级寄存器和 XTI 状态，早期 N97 挂起快照需重新创建。板级中断、计时器驱动和客体存储挂载仍待后续验收。

```sh
make build/v86-arm64.wasm
node --test tests/symbian/*.mjs
node tools/symbian/boot-n97.mjs <new-output-directory>/rom.xip.bin
```
