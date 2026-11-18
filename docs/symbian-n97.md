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
| ROM 物理地址 | CORE 的应用处理器闪存 TOC 位于 `0x80000`，首 1 KiB 的 SHA-256 为 `482b607a6113162e95a984b6d26bb2af30d08afbe8d338dc00f8fa34dec696d1`。原始 `SOS+CORE` 记录从闪存 `0xD60000` 载入 `0x088FF000`，ROM 头在该范围偏移 `0x1000`。 |
| 主内存和 SRAM | RAP3NAND `+0x314C–0x3174` 以 `0x08000000` 为 SDRAM 基址并写入 type 4。主内存范围是 `0x08000000–0x0FFFFFFF`。RAP3NAND 的 SRAM 交接地址 `0x30003EF0` 和 type 5 给出 16 KiB 的 SRAM。原版 ROM 在 `0x30000010` 保存 R0–R3，并以 `0x30001000` 为初始栈顶。 |
| 配置记录 | 原版标签用小端 `type, byte_length, payload`，从 SDRAM 顶部向下建立。R2 指向表首，本机型用连续表并为 ROM 在 type 2 结尾的三字读取预留一个字。原版查找和复制函数在 ROM `+0x1C04`、`+0x1BC4` 识别 type 3 续表地址。R0、R1、R3 目前采用零作为默认交接。 |
| 频率、启动原因和保留区 | RAP3NAND `+0x3254–0x3266` 写入 type 22 的 433,920,000 Hz 和 type 7 的 433.92 MHz。仿真采用 `0x00012400` 作为代表启动原因。type 16 对应加载器 `+0x331A` 的 MDI 缓冲区，原版据此在 SDRAM 顶部预留 3 MiB。 |
| type 10 目录 | RAP3NAND `+0x32A6–0x32BC` 写入 SDRAM TOC 指针。加载器 `+0x13A2–0x13D6` 生成 32 字节条目并用 `0xFF` 结尾，`+0x167E–0x16A0` 按表改名为 `MCUSW`。本机型在 `0x0FCFF000` 重建单条目录。条目从 SOS+CORE 的 `0x088FF000` 开始，原版在 XIP `+0x26D0` 单独保留这里的 4 KiB。当前只装载原版 XIP，前导页的数据和其他引导映像尚未接入。 |
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
| 第 1,360,196 条指令 | 原版从 `0x800974C4` 向物理 `0x20031C10` 写入 `0xAAAAAAAA`，进入 18 个板级配置字的初始化。 |

## 变体计时器和内核首个中断

变体按 XIP `+0x974A4–0x9759C` 写入 18 个配置字。V86 保留写入值和字节通道，`0x20031C80` 等间隙仍为未映射空间。RAP3NAND `+0x3A86` 也访问 `0x20031C00` 所在区域，具体位与板上引脚的对应关系待测。

原版在 XIP `+0x8DD2C` 初始化 ICU，在 `+0x8DFA4` 绑定 IRQ 35。它在 `+0x8E4B0` 向 `0x200401A4` 装入 9600 计数，再向 ICU `0x2040000C` 写 35 解屏蔽。计时器以客体每毫秒重载 9600 为依据，按仿真时钟每毫秒递减 9600。到零时提出 IRQ，客体读 `0x20400008` 取得源编号，读 `0x200401C4` 得到零并写 9600 重载。客体随后读到空队列 ID `0xFFFFFFFF`，再读 `0x20400080` 后走完 IRQ 路径。当前连接了这条计时器 IRQ，FIQ 和 GPIO 中断源未接入。

原版 RAM 分配器扫描普通内存和专用保留区。此前的 MCUSW 起址指向 XIP 首地址 `0x08900000`，导致原版试图保留已从普通 RAM bank 移除的页并报告 `RAM-ALLOC 13`。修正 TOC 后，原版通过该检查并执行内核线程上下文切换。ARM1136 的 VFPv2 `FPINST` 和 `FPINST2` 现在支持有权限的客体保存、恢复和快照。固件两次在 FPEXC 禁用时访问 FPSCR，进入自己的惰性 VFP 异常处理，随后继续执行。[Symbian RAM 分配器](https://github.com/SymbianSource/oss.FCL.sf.os.kernelhwsrv/blob/master/kernel/eka/memmodel/epoc/mmubase/ramalloc.cpp) · [QEMU VFPv2 系统寄存器](https://github.com/qemu/qemu/blob/master/target/arm/tcg/translate-vfp.c)

| 实测点 | 0576555 原版执行结果 |
| --- | --- |
| 第 3,261,459 条指令 | 变体向首个周期装入 9600；第 3,261,473 条指令解屏蔽 IRQ 35。 |
| 第 3,269,441 步后 | ARM 进入 IRQ 向量 `0xFFFF0018`，随后执行原版 `0x8008DE88` 计时器服务程序并重载下一周期。 |
| 第 3,269,566 步后 | 原版进入 SVC 延后调度程序 `0x8004F31C`。 |
| 第 3,269,951 步后 | `0x8004F354` 的异常返回指令恢复 CPSR `0xA0000013`，回到被中断的 `0x8008F640`（`LR_irq - 4`）。 |
| 第 3,272,619 步后 | 原版在 `0x80096144` 报告 `RapidoVariant 0x200002C0`。该路径检查配置记录计数，缺少 RAP3NAND `+0x33D0–0x33D6` 写入的 type 18 ROM 跳转表地址 `0xFFFF1200`。 |

验收工具对同一款默认机器的未修改 XIP 单步执行。它使用 8000 步/ms 的确定性诊断时钟，每 32 步调用实际硬件计时器，未写客体寄存器或内存。通用裸机探针另外覆盖 ARM/Thumb、VFPv2、SVC/IRQ 返回和 ARMv6 地址转换与数据异常。当前入口可单独复测 IRQ，并沿路与后续阶段共用断言。

```sh
make build/v86-arm64.wasm
node --test tests/symbian/*.mjs
node tools/symbian/boot-n97.mjs <new-output-directory>/rom.xip.bin
```

## 零售调制解调器映像和芯片 Boot ROM

RM-505 的 CORE 包含外层 FPSX 闪存目录和 `SOS*DSP0`、`SOS*ISASW` 组件。提取器按目录和证书中的物理地址检查布局，读取记录中的根键字段选择实机服务报告对应的原厂证书。组件原始 DEFLATE 流的输入和输出长度与证书 `+0x3D4`、`+0x3D8` 核对。加载器 `+0x600–0x624` 把 1 KiB 证书放在每个解压段前面。辅助文件 `rapido-boot.bin` 保存这些证书和映像，以及 CORE 的完整 4 KiB 前导页，绑定到同一 XIP 的 SHA-256。[RM-505 原厂固件档案](https://archive.org/details/rm-505-emea-22.0.110-v-8.00)

| 0576555 样本 | SDRAM | 大小和 SHA-256 |
| --- | --- | --- |
| DSP0 | `0x08200000` | 1,820,720 字节，`a4d24c50241c40a26a07db4ac180908e2eecab1839e20565b8adee976b7f123e` |
| ISASW | `0x08480000` | 3,893,852 字节，`60863fb9c4af32f638b0f867d69ab9304dec2d439648832852a3b15b39d31f21` |

原版 XIP 在第 1,470 步进入 Thumb 服务 `0xFFFF1208`，R0 指向实际固件的 16 字节描述，R2 指向 ISASW 证书起址。这个芯片 ROM 入口在 RAP3NAND 的 type 18 跳转表附近。用真 XIP 和完整映像运行时，缺芯片 ROM 会在第 1,471 步产生外部预取异常。该服务需要本地的 RAPIDO 芯片转储。合成探针仅验证指令调用和失败分支，回传零后原版跳到其失败处理 `0x08902898`。

设置支持从本地附加映射于 `0xFFFF0000` 的原始 Boot ROM 文件。入口处需有内容，文件大小为 8–64 KiB 且按页对齐。RM-505 服务报告的 ROM ID 为 `4B9B75103E691FF8`，可随转储提供以排除不匹配的报告。可选的预期 SHA-256 与实际文件比对，每次装载和快照恢复继续核对已保存的文件指纹。当前检查覆盖文件结构、区域和摘要。实机报告中两个 ROM CRC 的覆盖范围和真实转储的启动结果仍待验证。[RM-505 芯片读数](https://forum.gsmhosting.com/vbb/f609/n97-rm-505-flashing-problem-1218453/)

仅 AP 的显式诊断入口使用同一未修改的 XIP 和其可选配置记录路径，保留内核 IRQ 验收，并到达 `Sys/Bin/dma.dll` 的原版初始化 `0x8009D114`。原版随后在 `0x8009D13C` 向第一个 DMA 通道的 VA `0xC6040C04`（PA `0x20040C04`）写 1。该入口用于开发主板和外设。零售固件的普通 VM 启动保留 DSP0、ISASW 以及芯片 ROM 服务的原版调用。

```sh
node tools/symbian/boot-n97.mjs <output>/rom.xip.bin --boot-media <output>/rapido-boot.bin
node tools/symbian/boot-n97.mjs <output>/rom.xip.bin --boot-media <output>/rapido-boot.bin --boot-rom <local-dump>
node tools/symbian/boot-n97.mjs <output>/rom.xip.bin --ap-only
```

## Samsung MuxOneNAND 物理介质

RM-505 的 CS0 是单 die 256 MiB 的 SLC，块大小 128 KiB，页大小 2 KiB，另有每页 64 字节 spare。原版 RAP3NAND 在 `+0x2EB4` 读取物理 `0x1E000/2/4`，得到制造商 `00EC`、器件 `0040` 和修订 `0121`。有 OneNAND 的 VM 随正常冷启动发布 type 19，payload 为 `[0x10000000, 0, 0x20000, 0xEC, 0x40, 0, 0, 0x121]`。`mednand.pdd` 用这组 ID 选中 `XIP+0xF7A4C` 的第 50 条设备记录。记录 `+0x11` 为零，故 `0x800F6490–0x800F64C0` 选择 `0x800F3724` 的逐块解锁入口，经 F24C 和 `0x23` 解锁。原版解锁块 `0x7FA` 时在 SA1 写 `0x87FA`，在 SA2 写 `0x8000`。单 die 忽略 DDP 选择位 15，块地址仍使用 bits 10:0。[Samsung MuxOneNAND 手册 §2.8、§3.1 与 §3.4](https://www.kontest.ru/datasheet/SAMSUNGELECTR0NICS/KFxxG16Q2M.pdf) · [Samsung 向 Linux 提交的寄存器头](https://kernel.googlesource.com/pub/scm/linux/kernel/git/bp/bp/+/refs/heads/for-next/include/linux/mtd/onenand_regs.h)

新导入的 VM 有独立的 `onenand.img`。提取器按原厂 `(0,3,0)` 目标空间，写入 CORE、ENO、两个 ROFS 覆盖层和 UDA 的外层记录。证书组按 RM-505 根键选用单个交付记录，包括 type 28 的 `PAPUBKEYS`。物理主区保留压缩的原始字节和记录间的擦除值。FPSX 未提供的 spare 初始化为 `FF`。磁盘文件由绑定 XIP 摘要的 512 字节头及交错的主区和 spare 构成。每个存储字节取反，使文件空洞从客体读取为 `FF`。0576555 的初始文件为 276,824,576 字节，SHA-256 `e41fe3a84fa2b8d0546ca9eda3cab73a677469b921dfdf4d45d56ef8835be5fc`。导入时校验完整的初始摘要。开机核对头和配套 XIP；快照绑定可写文件的标识、大小和代次，客体再次编程或擦除后拒绝恢复旧代次。

原版 RAP3NAND `+0x2CE8` 在 V86 中通过真实 CS0 读出以下整页。第一页的后半包含相邻的 ADA 证书。原版读 `F241h` 的完成位，核对 `FF00h`，再从 DataRAM0 复制 1024 个半字。验收工具另用最小 MMU 映射执行原版 `mednand.pdd` 的识别和解锁函数，`0x7FA–0x7FC` 三块解锁后返回 0。公开夹具在 Chrome CPU Worker 中用 ARM 指令编程末块，关机后仅本 VM 的 OPFS 文件保留该值，冷开再读取同一页。Node 侧另验证主区与 spare 的 `1→0`、擦除、冷复位、快照恢复，以及相同 XIP 的另一介质无法套用快照。

| 物理主区页地址 | 内容 | 整页 SHA-256 |
| --- | --- | --- |
| `0x00080000` | TOC 和 ADA 证书 | `7d205c7846a817f407f667ebb6d5e887e24fcb390561982b7850abc62acc06a1` |
| `0x01A21000` | ROFS1 | `d7ae3de957f38a94bf6d1adf7651dfa5ea570c10ae727806629a763bbd8e5b3d` |
| `0x079A1000` | ROFS2 | `337c98a4d956116b8e799428b35895474fc810ab97604c514bb58168afa468e8` |
| `0x09CA1000` | ROFS3 | `7ff2686472083798be88dd71c55a3952059207bbe7abcb74550741014ba64cf6` |
| `0x0ABA0000` | UDA FAT16 BPB，逻辑字节数 `0x04917000` | `6b5f0abf82be73c4d3572cfda1098c7a148bfc3f29b40da55e9ebf1fba31f37b` |

当前模型同步完成常规读、编程和单块擦除，经 INT 寄存器轮询。理想介质的读出 ECC 为零。无法读取介质数据时返回控制器失败和 ECC 不可纠正位，ECC bypass 只屏蔽 ECC 位。硬件的 ECC 编码与单比特纠正、厂级坏块资料、INT 引脚布线、完整 XSR/BML/STL 挂载仍待验证。ROFS 和 FAT16 此处均为原版读页验证。接入 OneNAND 后，正常零售引导第 1,550 步到达 `0xFFFF1208`，须通过 RAPIDO 芯片 Boot ROM 才能进入完整存储初始化。

```sh
node tools/symbian/onenand-n97.mjs <output> <firmware-directory>/RM-505_22.0.110_prd.core.C00
node tools/symbian/boot-n97.mjs <output>/rom.xip.bin --boot-media <output>/rapido-boot.bin --nand <output>/onenand.img
```

## 浏览器导入与重新打开

在新建虚拟机的 **Source** 页选择 **Symbian → S60v5 · Nokia N97**，再选择本地固件目录或多选 VPL 和配套文件。若目录有多个 RM-505 变体，选中一个后才开始完整预检。目录缺件可在该变体下用文件多选框补入，同目录已有的文件优先。真实 0576555 样本的 ROFS 语言清单识别为 Arabic、English（默认）及 Farsi。[Nokia S60 SDK 语言枚举](https://docs.huihoo.com/symbian/s60-5th-edition-cpp-developers-library-v2.1/GUID-35228542-8C95-4849-A73F-2B4F082F0C44/sdk/doc_source/ToolsAndUtilities94/Installing-ref/PKG_format/PKG_languages_table.html)

导入 Worker 核对清单和 FPSX 分组，重建 XIP、ROFS1–3、UDA、OneNAND 和适用的调制解调器映像。写入浏览器私有存储后读回核对 SHA-256。每台 VM 有独立的 OneNAND。导入取消或页面刷新留下的未提交文件按导入记录回收。重新打开时，CPU Worker 在装载前核对 XIP、调制解调器映像以及所选芯片 ROM 的摘要。

从库中选择 **Settings → Symbian firmware** 可以附加芯片 ROM。保存配置前校验并复制新转储，取消保留现有配置，保存失败回收临时副本。挂起的 VM 可以使用原有 ROM 恢复，再在关机后更换。先前导入的 VM 仍可打开和恢复同配置的快照。用 **New VM** 重新导入同款包可建立带 OneNAND 和调制解调器映像的虚拟机，每台 VM 各自保有原来的手机数据。

库、向导和控制台将此机型标为 **Experimental boot**。默认运行的边界见上节。ROFS 和 UDA 的客体挂载、大容量盘、显示与输入属于后续板级与系统工作。

```sh
make build/v86_app.js build/symbian-import-worker.js build/libv86.mjs build/v86-arm64.wasm
node tests/symbian/fixtures/make_package.mjs
node tests/app/browser_runner.mjs tests/app/symbian_test.html
node tests/symbian/manual/browser_import.mjs <firmware-directory>
```
