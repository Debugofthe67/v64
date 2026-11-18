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

原版在 XIP `+0x8DD2C` 初始化 ICU，在 `+0x8DFA4` 绑定 IRQ 35。它在 `+0x8E4B0` 向 `0x200401A4` 装入 9600 计数，再向 ICU `0x2040000C` 写 35 解屏蔽。计时器以客体每毫秒重载 9600 为依据，按仿真时钟每毫秒递减 9600。到零时提出 IRQ，客体读 `0x20400008` 取得源编号，读 `0x200401C4` 得到零并写 9600 重载。客体随后读到空队列 ID `0xFFFFFFFF`，再读 `0x20400080` 后走完 IRQ 路径。这一阶段验收的是计时器 IRQ。后续 GPIO 接线和原厂驱动验收记录见下文。

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

原版 XIP 第 1,470 步进入 Thumb 服务 `0xFFFF1208`（接 OneNAND 时为第 1,550 步）。R0 为 16 字节描述符地址 `0x08902A08`，四个字为 `0x96BD0FAB`、`0x71C22AAF`、`0xAF6462D2`、`0x00140000`。R2 为 `0x08480000`，指向 ISASW 的 1 KiB 证书和紧随其后的解压映像。此次调用中 R1、R3 都为零，尚无独立证据说明它们的含义。缺芯片 ROM 时，下一条指令触发外部预取异常（向量 `0x0000000C`、IFSR `8`）。`--reject-probe` 仅让调用以 R0=0 返回到 ARM 的 `0x08902890`，原版随后转到 `0x08902898` 的拒绝路径。原版比较指令要求返回值恰为 1 才继续。这个比较来自静态检查，诊断只执行了拒绝路径。

设置支持从本地附加映射于 `0xFFFF0000` 的原始 Boot ROM 文件。入口处需有内容，文件大小为 8–64 KiB 且按页对齐。RM-505 服务报告的 ROM ID 为 `4B9B75103E691FF8`，可随转储提供以排除不匹配的报告。可选的预期 SHA-256 与实际文件比对，每次装载和快照恢复继续核对已保存的文件指纹。当前检查覆盖文件结构、区域和摘要。实机报告中两个 ROM CRC 的覆盖范围和真实转储的启动结果仍待验证。[RM-505 芯片读数](https://forum.gsmhosting.com/vbb/f609/n97-rm-505-flashing-problem-1218453/)

仅 AP 的显式诊断入口使用同一未修改的 XIP 和其可选配置记录路径，保留内核 IRQ 验收。原版通过 `Sys/Bin/dma.dll` 的六通道复位，并从 `0x8009D114` 返回调用者 `0x8009D2EC`。XIP `+0x2594` 和 `+0x2598` 把 TOC 查询得到的 ISASW 地址和长度写到变体记录 `+0x20`、`+0x24`。零售诊断在芯片服务前读回 `0x08480000` 和 3,893,852 字节，仅 AP 路径读回两个零。`sisa.ext` 的 `0x800B3B40` 随后从零地址读证书头，产生 `FAR=0`、`FSR=5` 的数据异常。原版 XTI 报告异常线程 `ekern.exe::Supervisor`。

0576555 清单里的 `RM505_APE_ONLY_ENO_09w23_v0.072.fpsx` 是独立的 `SOS*ENO` 交付组件。该样本的 2877440 字节压缩区域位于闪存 `0x00400400`，解压得到 5585920 字节，证书描述的装载起点为 `0x088FF000`。公开实机刷写记录在独立的 `RAPIDOv11_2nd.fg` 装载前读取芯片 ROM 标识。仍未找到可核对身份的 RAPIDO 芯片 ROM 转储，或 N97 零售固件支持的 AP-only 离线启动方式。普通 VM 仍在原始 ROM 服务入口保留该依赖。[RM-505 实机刷写记录](https://forum.gsmhosting.com/vbb/f528/nokia-n97-rm-505-flash-ok-817598/)

```sh
node tools/symbian/vpl.mjs extract <firmware-directory> <output> --product-code 0576555
node tools/symbian/boot-n97.mjs <output>/rom.xip.bin --boot-media <output>/rapido-boot.bin
node tools/symbian/boot-n97.mjs <output>/rom.xip.bin --nand <output>/onenand.img --boot-media <output>/rapido-boot.bin --reject-probe
node tools/symbian/boot-n97.mjs <output>/rom.xip.bin --boot-media <output>/rapido-boot.bin --boot-rom <local-dump>
node tools/symbian/boot-n97.mjs <output>/rom.xip.bin --ap-only
node tools/symbian/boot-n97.mjs <output>/rom.xip.bin --ap-only --isa-probe <output>/rapido-boot.bin
```

### 原版 ISASW 启动与中断回调交接

静态对照显示，在 ISASW 记录非零的路径上，XIP `+0x2350–0x2390` 把 ISASW 映射到 `0xC6300000`，保存原物理地址，然后用虚拟地址更新记录。`sisa.ext` 检查证书魔数 `0x809795A3` 和 `+0x148` 非零入口偏移，从变体记录 `+0x78–0x84` 取四个参数，最后在同一应用处理器上 `BX` 到映像。0576555 的偏移为 `0x1000`。另外两处芯片服务调用仅出现在原厂加载器发布 `KEYS`（tag 12）或 `R&D`（tag 25）的分支，本次零售冷启动没有这些记录。其描述符末字分别为 `0x00110000`、`0x00100000`。

`--isa-probe` 在原版仅 AP 内核读取空指针前保存状态。探针先验证原来的数据异常，再恢复状态，在这一临时实例内补映射原版只读 ISASW 和工作内存，填入该次诊断的映像地址及长度。它让原版 `sisa.ext` 从 `0x800B3B38` 重新读取记录，由原版代码检查证书头、恢复栈和寄存器，以及跳转到 `0xC6301000`。R2 为来宾实际建立的 `HW_CONF` 链，包含 type `0x0A` 的 TOC 指针和 type `0x0B` 的两个中断服务交接地址。

原版 ARM 入口到达 Thumb 早期初始化 `0xC6362726`。随后在 `0xC63627E4` 读取 type `0x0B`，把 AP 回调表 `0xC8008B50` 存到 `0xC68020C8`，并在 `0xC6362808` 向 AP 提供的回写地址 `0xC8008B38` 发布原版函数 `0xC6679028`。隔离诊断在确认回调写入后结束。初次调查曾在同一引导流程的 `0xC636206A` 读取启动源时遇到外部异常，该寄存器现已接入兼容冷启。

### 原厂证书链的独立对照

对 0576555 的原厂 `KEYS`、ISASW 和 DSP0 用 OpenSSL 做了证书和载荷对照。`KEYS` 位于同套 OneNAND 主区偏移 `0x82A00`，占 `0x600` 字节。`KEYS[0x004:0x08C]` 的 SHA-1 对应 RM-505 的根键指纹 `CAEEBB65D3C48E6DC73B49DC5063A2EE5867D611`。原厂 RSA 公钥的指数为 3，128 字节模数为小端。根键以 PKCS#1 v1.5/SHA-1 验证 `KEYS[0:0x444]`，签名为 `[0x444:0x4C4]` 的大端数。其 `+0x21C` 的基带公钥验证两个组件各自的证书 `[0:0x168]`，签名位于 `[0x350:0x3D0]`。两个样本的扩展载荷 SHA-1 与证书 `[0x24:0x38]` 仅首字节的 `0x80` 位不同。分别改动根指纹、签名、证书字段、基带公钥或载荷后，独立校验均拒绝数据。

### 用兼容 ROM 冷启原版基带

库选项 `symbian.rapido_compat_rom: true` 或本地工具的 `--rapido-compat-rom` 可为 RM-505 22.0.110 启用 v86 自写的 Thumb ROM 服务。需要原版 XIP、`rapido-boot.bin` 与同套 OneNAND。该选项与自带芯片转储或仅 AP 诊断互斥，普通零售路径仍使用原来的 Boot ROM 选项。兼容模式的快照与原始芯片 ROM 模式分开，即使两者的 ROM 字节完全相同。

`0xFFFF1208` 的 Thumb 代码将原版调用的四个参数转交 v86 私有 MMIO。验证器从实际 SDRAM 核对调用描述符、TOC 里的组件名称、地址及长度，从 OneNAND 主区读取 `KEYS`，按固定的 RM-505 根指纹、根签名和基带公钥验签。它对当前 SDRAM 中两个组件的完整展开载荷计算摘要，并核对该版本原厂证书签名未覆盖的尾部 SHA-256。通过才返回 1，校验失败返回 0。支持范围限于本次实测的 ISASW 调用及其同时装载的 DSP0。[PKCS#1 v1.5，RFC 8017 §8.2、§9.2](https://www.rfc-editor.org/rfc/rfc8017#section-8.2)

带同套 OneNAND 的冷启动在第 1,559 步向原版 `0x08902890` 返回 1，原版比较后进入 `0x0890289C`。随后原版 XIP 把 `0x08480000` 映射到 `0xC6300000`，`sisa.ext` 在第 4,018,740 步自行跳到原版 ISASW 的 `0xC6301000`。原版 ISASW 把 `0xC6679028` 写入 `HW_CONF` 提供的 `0xC8008B38`。Chrome 的发布版 CPU Worker 也用同套媒体完成了兼容 ROM 的验签。

以下命令使用上文提取的文件。负例在新启动的诊断实例内改动一次 RAM 或 OneNAND 读出副本，分别覆盖调用描述符、TOC 名称和长度、根键、`KEYS` 签名、基带公钥、ISASW 证书及尾部、ISASW 和 DSP0 的载荷末字节。每个负例都返回 0，原版进入 `0x08902898`。

```sh
node tools/symbian/boot-n97.mjs <output>/rom.xip.bin --boot-media <output>/rapido-boot.bin --nand <output>/onenand.img --rapido-compat-rom
node tools/symbian/boot-n97.mjs <output>/rom.xip.bin --boot-media <output>/rapido-boot.bin --nand <output>/onenand.img --rapido-compat-rom --compat-negative isasw-payload
```

### RAPIDO 启动源、复位状态和共享 PLL

RAP3NAND `+0x1EFE` 读取 PA `0x20040400` 的位 `[23:20]`，零对应正常加载。原版 ISASW `+0x61C5C` 还读取低两位，并在 `+0x61C72` 更新这两个字段。寄存器支持直接写和 `+4` 置位、`+8` 清位。原版冷启动实际执行两次读零、一次写零，随后在 `0xC6360618` 和 `0xC6360628` 读取 PA `0x20032C18`。该地址携带原版 `SisaResetReason` 所需的复位标志，本次冷开状态为零。原版软件复位请求使用相邻的 `0x20032C1C`，其执行路径留待验收。

原版 ISASW 和 AP 侧 `usb.dll` 均访问 `0x20040380` 的清位别名，RAP3NAND 使用同组置位别名。模型保存该组的程序写入，也保存时钟配置 `0x20032CA8`、`0x20032C44`。原版 AP 先经 `0x20032C84` 置共享 PLL 电源位 14。ISASW 通过 `0x20032C88` 清位 15，再配置 ACCPLL，读到 `0x20032D8C = 0xD490`，最后经置位别名置位 15。两端之间保留位 14 才能在固件第二次配置后报告锁定。快照保存共享寄存器，旧快照沿用已保存的 PLL 电源字并初始化新配置字。

加入启动寄存器后的首次冷启在 `0xC666B36C` 遇到 CP15 未定义指令。随后原版异常处理的 `exmondebug.dll` 在 `0x801DCBF4` 读空指针。这两次异常均已在下述 ARM1136 寄存器接入后消失。复现时可将上节 `--nand` 换成同一出厂映像的可写副本。

### ARM1136 内存重映射与原版 MMU 切换

ARM1136 的 CP15 `c15,c2` 在特权模式提供数据、指令、DMA 和外设端口四个重映射寄存器。前三项复位为 `0x01C97CC8`，外设窗口复位为零，来宾写入后可读回定义位。快照保存这四个值，恢复旧快照时缺失字段取架构复位值。当前 v86 使用一致性内存和统一的物理地址总线，保存这些重映射值供原版上下文切换，物理设备仍按其物理地址响应。Cache Dirty Status 和 Block Transfer Status 读取为零，Stop Prefetch 写入时无待撤销的异步取数任务。Cache Dirty Status 只允许特权读，块传输状态读取与停止预取可由 User 和特权模式分别按指令方向访问。[ARM1136 r1p3 TRM §3.3.38，表 3-80、3-81、3-86 至 3-89](https://documentation-service.arm.com/static/5e8e4306fd977155116aade2)

正常兼容冷启中，原版 ISASW 读回数据、指令和外设重映射的复位值，然后把 `0x20000013` 写入外设端口寄存器。第 4,357,410 步在 `0xC666B6F0` 把 SCTLR 从 `0x00C5387D` 写成 `0x00C5207A`，关闭 MMU。关闭之前，原版下一条指令 `0xC666B6F4` 映射至 `0x087EB6F4`，机器字 `0xE1A0F001` 为 `MOV PC,R1`。关闭后再次从高地址取指时，当前 CPU 在第 4,357,412 步进入外部预取异常（IFSR `8`）。原版该分支的 R1 为芯片 ROM 地址 `0xFFFF8A94`，ISASW 原始入口表也包含它。后续需验证 ARM1136 取指过渡及该处原版服务的功能。此次未执行该分支或返回 SISA。取指异常及芯片 ROM 地址可用上节同一引导命令复现。

## Samsung MuxOneNAND 物理介质

RM-505 的 CS0 是单 die 256 MiB 的 SLC，块大小 128 KiB，页大小 2 KiB，另有每页 64 字节 spare。原版 RAP3NAND 在 `+0x2EB4` 读取物理 `0x1E000/2/4`，得到制造商 `00EC`、器件 `0040` 和修订 `0121`。有 OneNAND 的 VM 随正常冷启动发布 type 19，payload 为 `[0x10000000, 0, 0x20000, 0xEC, 0x40, 0, 0, 0x121]`。`mednand.pdd` 用这组 ID 选中 `XIP+0xF7A4C` 的第 50 条设备记录。记录 `+0x11` 为零，故 `0x800F6490–0x800F64C0` 选择 `0x800F3724` 的逐块解锁入口，经 F24C 和 `0x23` 解锁。原版解锁块 `0x7FA` 时在 SA1 写 `0x87FA`，在 SA2 写 `0x8000`。单 die 忽略 DDP 选择位 15，块地址仍使用 bits 10:0。[Samsung MuxOneNAND 手册 §2.8、§3.1 与 §3.4](https://www.kontest.ru/datasheet/SAMSUNGELECTR0NICS/KFxxG16Q2M.pdf) · [Samsung 向 Linux 提交的寄存器头](https://kernel.googlesource.com/pub/scm/linux/kernel/git/bp/bp/+/refs/heads/for-next/include/linux/mtd/onenand_regs.h)

新导入的 VM 有独立的 `onenand.img`。提取器按原厂 `(0,3,0)` 目标空间，写入 CORE、ENO、两个 ROFS 覆盖层和 UDA 的外层记录。证书组按 RM-505 根键选用单个交付记录，包括 type 28 的 `PAPUBKEYS`。物理主区保留压缩的原始字节和记录间的擦除值。FPSX 未提供的普通页 spare 初始化为 `FF`。磁盘文件由绑定 XIP 摘要的 512 字节头及交错的主区和 spare 构成。每个存储字节取反，使文件空洞从客体读取为 `FF`。导入时校验完整的初始摘要。开机核对头和配套 XIP。快照绑定可写文件的标识、大小和代次，客体再次编程或擦除后拒绝恢复旧代次。

原版 RAP3NAND `+0x2CE8` 在 V86 中通过真实 CS0 读出以下整页。第一页的后半包含相邻的 ADA 证书。原版读 `F241h` 的完成位，核对 `FF00h`，再从 DataRAM0 复制 1024 个半字。验收工具另用最小 MMU 映射执行原版 `mednand.pdd` 的识别和解锁函数，`0x7FA–0x7FC` 三块解锁后返回 0。公开夹具在 Chrome CPU Worker 中用 ARM 指令编程最后一个可用块 `0x7D1`，关机后仅本 VM 的 OPFS 文件保留该值，冷开再读取同一页。Node 侧另验证主区与 spare 的 `1→0`、擦除、冷复位、快照恢复，以及相同 XIP 的另一介质无法套用快照。

| 物理主区页地址 | 内容 | 整页 SHA-256 |
| --- | --- | --- |
| `0x00080000` | TOC 和 ADA 证书 | `7d205c7846a817f407f667ebb6d5e887e24fcb390561982b7850abc62acc06a1` |
| `0x01A21000` | ROFS1 | `d7ae3de957f38a94bf6d1adf7651dfa5ea570c10ae727806629a763bbd8e5b3d` |
| `0x079A1000` | ROFS2 | `337c98a4d956116b8e799428b35895474fc810ab97604c514bb58168afa468e8` |
| `0x09CA1000` | ROFS3 | `7ff2686472083798be88dd71c55a3952059207bbe7abcb74550741014ba64cf6` |
| `0x0ABA0000` 原始布局，`0x0ABA0800` 出厂 STL 布局 | UDA FAT16 BPB，逻辑字节数 `0x04917000` | `6b5f0abf82be73c4d3572cfda1098c7a148bfc3f29b40da55e9ebf1fba31f37b` |

当前模型同步完成常规读、编程和实际擦除。正常读取返回介质中的主区、spare 和已存储的 ECC 字节。介质读取失败时返回控制器错误及 ECC 不可纠正位，ECC bypass 屏蔽该 ECC 状态。读出校验和单比特纠正、厂级坏块资料仍待验证。接入 OneNAND 后，正常零售引导第 1,550 步到达 `0xFFFF1208`，须通过 RAPIDO 芯片 Boot ROM 才能进入完整存储初始化。

D3000 的 INTo 经 MEMCONT[10] 接到 GENIO22。原版 `mednand.pdd` 设置 bank 0 的输入和上升沿，`egpio.dll` 给这一输入分配 IRQ 245。OneNAND 的 IOBE、INTpol 和完成位共同决定引脚电平。GPIO 保留边沿并经 ICU 提交，恢复快照时保留待处理状态。原版 PDD 另在 `0x800DF9B0` 向闪存接口配置地址 PA `0x20034094` 写入 `0x300`。当前模型保存此配置字，既有 CS0 地址解码不依赖该字。[Nokia RM-505/RM-507 板图第 2 页](https://www.s-manuals.com/manuals/phone/nokia/nokia_n97_rm-505_rm-507_service_schematics_v4.pdf) · [Samsung MuxOneNAND 2G §§2.8.19、7.1](https://www.kontest.ru/datasheet/SAMSUNGELECTR0NICS/KFxxG16Q2M.pdf)

PDD 探针冷启真正的 AP 内核，在 SISA 依赖前调用原版 `mednand.pdd`。扩展向 LocDrv 注册 10 个 NAND 驱动。使用未预置 BML 的基线时，原版 PDD 硬件创建阶段识别 `EC/0040/0121`，扫描 44 个预留块（`0x7D4–0x7FF`），设备完成 528 次读操作，数据与 spare 均为擦除值。探针在原版异步完成回调之前停下，再调用原版 `PartitionInfo`。原版从 `0x800F085C` 获得 XSR 状态 `0x80110000`，随后返回 `KErrGeneral (-2)`。该路径使用由 FPSX 重建的同一 OneNAND 的私有副本，未编程或擦除任何页。[Samsung UniStore II v1.5.1](https://www.bitsavers.org/components/samsung/flash/UniStore_II_v1.5.1_Installation_Guide_200606.pdf) · [Symbian LocDrv](https://github.com/SymbianSource/oss.FCL.sf.os.kernelhwsrv/blob/master/kernel/eka/drivers/locmedia/locmedia.cpp)

探针另启用芯片中断输出，经原版 PDD 确认 GPIO 并解除屏蔽，再触发一次诊断读。EKA2 实际领取 IRQ 245，经过原版 `egpio.dll` 的 `0x8009FEFC` 到达 PDD 中断入口 `0x800F6724`。这个检查在进入本地驱动请求回调前结束；前面的 528 次 BML 读取走轮询。

```sh
node tools/symbian/vpl.mjs extract <firmware-directory> <raw-output-directory> --raw-onenand
node tools/symbian/nand-pdd-n97.mjs <raw-output-directory>
```

### 新机的 XSR/BML 分区

浏览器导入和 CLI 提取从 CORE 的 type EE 读取 `(0,3,0)` 分区表。0576555 的四条记录按 ID、属性、起始逻辑块、块数表示为 `[3,2,4,205]`、`[4,2,209,1164]`、`[8,1,1373,604]` 和 `[10,1,1990,11]`。原版校验例程允许 2002 个可用块，末块为 `0x7D1`。新建介质使用 `0x7D4` 和 `0x7FF` 的前两页存放两份池控制头、分区信息及块映射的镜像和 spare 确认标记。Nokia 的分区签名是 `XSRPART5`。该流程只在新提取时运行，已入库的磁盘和快照沿用原配置。[Samsung RFS 预编程指南 §3](https://datasheet.datasheetarchive.com/originals/library/Datasheets-SW18/DSASW00343735.pdf)

`--bml-only-onenand` 提取 0576555 得到 276824576 字节，SHA-256 `ca92e711e6126d042bf8831b83567678f2232b8a416f76702378f0cbc8963f84`，与原版 `BML_Format` 在私有副本上的输出逐字节一致。与 `--raw-onenand` 的基线摘要 `e41fe3a84fa2b8d0546ca9eda3cab73a677469b921dfdf4d45d56ef8835be5fc` 相比，只有四个管理页改变。

原版 `BML_Open`、`BML_Read`、`BML_Close` 在首次打开及冷重开都返回 0，表中的 TOC、三层 ROFS 和原始 UDA 头五个整页的摘要均吻合。仅预置 BML 的基线首次打开对管理区进行两次编程和两次擦除，冷重开无需继续写入。探针在两次关闭后核对全部用户区的主区和 spare 摘要。探针运行在 AP 内核诊断中，停在 PDD 启动 STL 初始化前。

```sh
node tools/symbian/nand-pdd-n97.mjs <extraction-directory> --bml
```

```sh
node tools/symbian/onenand-n97.mjs <output> <firmware-directory>/RM-505_22.0.110_prd.core.C00
node tools/symbian/boot-n97.mjs <output>/rom.xip.bin --boot-media <output>/rapido-boot.bin --nand <output>/onenand.img
```

### 新机的 C: FAT16 和服务卷

默认导入依据 CORE 的分区起址，把原厂 UDA 编入分区 8 的 STL FAT16 卷，并初始化空的分区 10。每个 `XSR2` 单元首个 2 KiB 页保存归属和管理信息，后续 63 页各存 4 个逻辑扇区。页的 spare 保存单元内扇区索引、补码、分区 ID、确认标记及 ECC。分区 8 和 10 分别保留 10 和 3 个周转单元，`0x7D2` 首个管理页保存原版 BML 擦除日志标识 `ERLSIG`。工具逐块生成 OneNAND，按 UDA 的 BPB 补齐原厂未提供的零值扇区。

只有 UDA 起址、512 字节扇区和容量均与分区表一致，且两个卷及管理区都有明确写入范围时，才初始化新机。厂商已有管理记录、其他记录占据可写卷或格式超出支持范围时，导入保留源物理布局并在摘要里说明原因。此初始化仅用于新导入。

```sh
node tools/symbian/vpl.mjs extract <firmware-directory> <extraction-directory> --product-code 0576555
node tools/symbian/nand-pdd-n97.mjs <extraction-directory> --stl-volume
```

0576555 的默认 OneNAND 摘要为 `cea8bcae23f346696114c4ad88cbd037f6cae69a4706d1fced7233eb22227fcf`。原版 AP 内核诊断中新启动的 PDD 完成硬件初始化，`PartitionInfo` 返回 LocDrv 接受的 `KErrCompletion (-17)`。原版 STL 逐扇区读完 C: 的 149,688 个扇区，SHA-256 为 `bc023d949a95ba598320d80560376be2d3429000b55fd67c1586898d5509b322`，与解包的 `uda.fat` 相同。分区 10 的 2,016 个扇区均为擦除值。整个冷开及读取完成 75,843 次设备读，零编程、零擦除。正常零售启动仍依赖 RAPIDO 芯片 ROM，文件服务器挂载未验收。

### 多块擦除与原版 STL 写入

原版 `mednand.pdd` 在 `0x800F5A98` 用 `0x95` 锁存地址，在 `0x800F5B7C` 用 `0x94` 提交，批次最多 64 块。锁存完成时 `F241=0x8020`，`F240=0x8800` 保留忙状态。若最后一块受保护，先前锁存的地址可由下一次有效提交继续使用。中间块失败时，其余可擦除块继续执行。原版在 `0x800F4554` 用 `0x71` 分别检查每块。该命令以 `F241=0x8000` 通知完成，由 `F240` 的错误位反映该块结果。验证读取主区和 spare。开始其他命令或复位可取消尚未提交的批次。快照保留锁存地址及最近一次批次失败，旧快照从空批次恢复。[Samsung MuxOneNAND 2G §§2.8.21–22、3.13.2–3](https://www.kontest.ru/datasheet/SAMSUNGELECTR0NICS/KFxxG16Q2M.pdf)

```sh
node tools/symbian/nand-pdd-n97.mjs <bml-only-extraction-directory> --stl-erase
```

探针使用带 BML 预置的 0576555 提取目录。它仅在一次性副本上运行原版 `STL_Format`，按原版配置准备分区 8 和 10。在新启动的 AP 内核中，原版 PDD 完成硬件创建阶段并返回 0。探针停在通知异步队列之前，随后调用原版分区查询。`PartitionInfo` 返回 `KErrCompletion (-17)`，原版 LocDrv 将其作为成功。分区 8 的原版异步写入锁存 `0x7B7–0x7B3`，提交 `0x7B8` 并逐块验证六块。

启用 ECC 时，`0x80` 从每个参与编程的 BufferRAM 扇区计算两组校验码。512 字节主区的 24 位码写入该扇区 spare 的 `8–10` 字节。spare 中逻辑扇区号 `2–4` 字节的 10 位码写入 `11–12`，高六位为 1。`0x1A` 仅编程 spare，保留已有主区和主区校验码。ECC bypass 允许调用者写入这些位置。NAND 编程只允许位从 1 变 0，生成的校验码在随后读取时进入 BufferRAM。位序采用三星发布的 512 字节软件参考格式，三星指出硬件位序可能不同。此位序已通过 0576555 原版驱动校验，尚需 RM-505 实机原始页验证硬件位序。[Samsung MuxOneNAND 2G §§2.7.2、2.7.5、3.17](https://www.kontest.ru/datasheet/SAMSUNGELECTR0NICS/KFxxG16Q2M.pdf) · [Samsung 512-byte ECC Algorithm](https://www.elnec.com/sw/samsung_ecc_algorithm_for_512b.pdf)

原版 `STL_Read` 从扇区 0、3377、2048 分别读回 4、2、16 个扇区。同次开机和调用 `STL_Close` 后冷开均逐字节匹配原始 UDA，五个相邻的未写扇区保持擦除值。该诊断用原版 AP 内核以及一次性副本。

### 从原版 ROFS 按路径读取文件

在已提取的 `0576555` 固件上运行以下命令。需要同一套 LLVM 中的 `llvm-mc` 和 `llvm-objcopy`。工具会组装诊断用的只读驱动适配器，在临时目录复制 OneNAND，退出时清理副本。

```sh
node tools/symbian/rofs-n97.mjs <extraction-directory> <firmware-directory>/RM-505_22.0.110_prd.core.C00
```

此工具在 ARM1136 中执行零售 `erofs.fsy` 的卷头验证、目录缓存构造函数、`FileOpenL` 和 `ReadSectionL`。诊断程序提供内存中的文件服务器对象、目录缓存空间，以及向原版 RAP3NAND 读页服务转发请求的本地驱动接口。卷头、目录、文件条目和内容均从模拟 OneNAND 的物理页取得。另用独立解包的镜像及预先记录的 SHA-256 逐一核对。[Symbian ROFS 源码](https://github.com/SymbianSource/oss.FCL.sf.os.kernelhwsrv/tree/master/userlibandfileserver/fileserver/srofs)

| 分区 | 原厂文件 | 字节 |
| --- | --- | ---: |
| ROFS1 | `\system\data\wsini.ini`、`\data\bookmarkimportsample.txt` | 2,126、17,280 |
| ROFS2 | `\data\bookmarkimportsample.txt`、`\resource\versions\langsw.txt` | 7,772、50 |
| ROFS3 | `\resource\versions\customersw.txt`、`\resource\versions\fwid3.txt` | 52、74 |

六个文件各完成三次读取，包括改变路径大小写、从偏移 2,047 跨页读取、请求超出文件尾时返回剩余字节。18 次返回的长度和内容全部一致，输出缓冲区末尾的哨兵字节保持原值。原厂变体文件报告 `22.0.110.C01.01`。各分区均由诊断程序单独选中。正常启动时由原版文件服务器挂载合并后的 `Z:`，以及通过原厂 BML/STL 读写 `C:`，仍待验收。

## RAPIDO MMC 主机与用户存储

RM-505 的内置 eMMC 是板图第 6 页的 D5250，标称 32 GB。`ESTARTCOMP.TXT` 将本地驱动 3 映射为 E:，驱动 2 映射为 F:。`EPBUSMV.DLL` 的 `0x80160890` 使用 GENIO44 控制第 6 页的 N5252 时钟多路器。原版代码为 socket 0 写 `0x20031CC4=0x1000`，选择外置 microSD。socket 1 写 `0x20031CC8=0x1000`，选择内置 eMMC。GENIO45 是外置卡低有效检测脚，`egpio.dll` 原版输入函数 `0x800A0450` 读 `0x20031D88` 的位 13。插卡由 IRQ 234 通知原版驱动，与触屏和侧锁共用 GPIO 中断。[Nokia RM-505/RM-507 维修板图第 2、6 页](https://www.s-manuals.com/manuals/phone/nokia/nokia_n97_rm-505_rm-507_service_schematics_v4.pdf)

两张卡共享 `0xC6032800`（PA `0x20032800`）的半字 MMC 主机寄存器。`EPBUSMV.DLL` 在 `0x8016085C` 将主机中断绑定到 IRQ 159，并在 `0x8016059C` 读取 IE 和 STAT。平台在 `0x20031C94/98` 置位或清除时钟控制位 14，主机另有 CON 的供电位。命令、响应顺序、FIFO、计数和中断标志按原版访问以及 TI 寄存器资料核对。内置卡使用 MMC 扇区寻址，提供 EXT_CSD。外置卡依映像大小使用 SDSC 字节寻址或 SDHC 扇区寻址。[TI MMC/SD Controller SPRU765A §2](https://www.ti.com/lit/ug/spru765a/spru765a.pdf) · [SD Physical Layer Simplified Specification](https://www.sdcard.org/cms/wp-content/themes/sdcard-org/dl.php?f=Part1_Physical_Layer_Simplified_Specification_Ver6.00.pdf)

新 VM 的 E: 从一个空的 FAT32 用户卷开始。MBR 的分区从 LBA 2048 开始，卷含主备 BPB、FSInfo 和两份 FAT。32,000,000,000 字节是客体逻辑容量，每台 VM 的初始稀疏容器占 2,150,400 字节，首次写入未分配区域时以 64 KiB 增长。独立用 `fsck_msdos -n` 检查了新卷。0576555 清单列出的可选 `MemoryCardContent` 文件 `RM505_RM507_101_000_M028_32G.fpsx` 在本地样本中缺失，当前导入器跳过此角色。通过 **Settings → Symbian firmware** 选择兼容的本地 raw microSD 映像，浏览器按原始字节创建该 VM 的可写副本。卸卡后可在浏览器磁盘库找到保留的副本。先前 VM 保留原介质配置和同配置的快照；若需要新建 eMMC，可重新导入到单独的 VM。

下列探针用同一份未改动的零售 XIP 运行原版选槽、检测脚、发命令及响应读取代码。原版完成 5 个 eMMC 和 7 个 microSD 命令的寄存器访问。探针用短 ARM PIO 循环读 EXT_CSD、E: 的 MBR 和 FAT32 BPB，以及 microSD 扇区 1。公开回归还验证多块读写、传输中的 CMD13、IRQ 159 的确认及清除、插卡产生的 IRQ 234、快照中途恢复和写盘代次隔离。PIO 同步完成。客体文件服务器挂载仍待验证。

```sh
node tools/symbian/mmc-n97.mjs <output>/rom.xip.bin
node --test tests/symbian/mmc.mjs
```

## RAPIDO DMA 与原版 MMC 驱动

`dma.dll` 在 `0x8009D114` 复位六个物理通道。第一个通道从 PA `0x20040C00` 开始，各通道相隔 `0x400`。原版依次打开通道门控、发复位、从状态寄存器读到 `0x6E`、清运行模式并关闭门控。使用确定性诊断时钟和 0576555 原版 XIP，未接 OneNAND 时在第 3,320,080 步返回 `0x8009D2EC`，第 3,405,223 步到达 `sisa.ext` 的异常向量。接上对应的 OneNAND 副本时分别是第 3,320,444 和 3,405,699 步。

原版 `EPBUSMV.DLL` 的 DMA 辅助对象由 `0x80160AC0` 初始化。请求 20 经 `0x80160B5C` 设置 16 位 FIFO 与接收/发送请求号 15/16。原版 `0x80162484` 正常提交请求，从内核真实页表取得缓冲区 PA，通过 `DDmaRequest::Fragment` 和硬件队列选择物理通道 1。控制器访问 PA `0x20032820` 的半字 FIFO，按通道寄存器 `+0x2C` 的计数运行，每 512 字节对应 256 次半字传送。完成时主中断控制器收到 IRQ 1，原版到达 `0x8009D8C0` 和 `0x8009DA0C`，再用 `0x8004F354` 恢复调用者。L2 按物理行清理和失效的寄存器在主机与客体共用内存时同步完成。原版发送路径也会在 `0x80052EE4` 执行 ARMv6 `SWP`。回归另核对 `SWPB` 和权限异常。[Arm PL310 技术手册 §3.2–3.3](https://documentation-service.arm.com/static/5e8e1bc3fd977155116a451c) · [Arm1136 技术手册](https://developer.arm.com/documentation/ddi0211/k/)

本地探针先冷启原版 AP 内核，停在它读取 ISASW 指针前。探针选择卡并发识别命令，用原版内核分配带真实页表映射的缓冲区，再调用原版 MMC 数据请求入口。E: 与 F: 均完成 512 字节读、写和 IRQ 1 异常返回，读出数据与种子逐字节一致。销毁 VM 后从主机重开两张卡，写入扇区的 SHA-256 均为 `fd49127e5044b01be4d3548674955f43944406b6e778f95e1a540597e4026da4`。

原版 DMA 另有位于 `0x20042440` 起的四个逻辑通道，对应 IRQ 6–9。实现覆盖同一 MMC 请求及原版接收完成时调用的地址与宽度同步端口。公开回归覆盖物理和逻辑寄存器、进行中快照、复位、无效地址及命令取消后立即开始另一笔传输。DMA 只会继续处理绑定的那笔 MMC 命令。适用范围为 MMC 连接的半字 FIFO 和 SDRAM。其他外设请求、独立的内存间拷贝引擎、硬件等待时间和完整 L2 时序尚未模拟。客体文件服务器的真实挂载仍取决于完整零售引导。

```sh
node tools/symbian/boot-n97.mjs <output>/rom.xip.bin --ap-only --nand <output>/onenand.img
node tools/symbian/dma-n97.mjs <output>/rom.xip.bin
node --test tests/symbian/mmc.mjs tests/symbian/arm1136.mjs
```

## 浏览器导入与重新打开

在新建虚拟机的 **Source** 页选择 **Symbian → S60v5 · Nokia N97**，再用 **Choose firmware folder…** 选择本地固件目录。若目录包含多个 RM-505 变体，选中一个后才开始完整预检。向导会列出缺少的文件。将文件补到所选变体的 VPL 旁，再用 **Change firmware folder…** 重选整个固件目录。真实 0576555 样本的 ROFS 语言清单识别为 Arabic、English（默认）及 Farsi。[Nokia S60 SDK 语言枚举](https://docs.huihoo.com/symbian/s60-5th-edition-cpp-developers-library-v2.1/GUID-35228542-8C95-4849-A73F-2B4F082F0C44/sdk/doc_source/ToolsAndUtilities94/Installing-ref/PKG_format/PKG_languages_table.html)

导入 Worker 核对清单和 FPSX 分组，重建 XIP、ROFS1–3、UDA、OneNAND 和适用的调制解调器映像。写入浏览器私有存储后读回核对 SHA-256。每台 VM 有独立的 OneNAND 和 eMMC。导入取消或页面刷新留下的未提交文件按导入记录回收。重新打开时，CPU Worker 在装载前核对 XIP、调制解调器映像以及所选芯片 ROM 的摘要。

从库中选择 **Settings → Symbian firmware** 可以附加芯片 ROM。保存配置前校验并复制新转储，取消保留现有配置，保存失败回收临时副本。挂起的 VM 可以使用原有 ROM 恢复，再在关机后更换。先前导入的 VM 仍可打开和恢复同配置的快照。用 **New VM** 重新导入同款包可建立带 OneNAND 和调制解调器映像的虚拟机，每台 VM 各自保有原来的手机数据。

库、向导和控制台将此机型标为 **Experimental boot**。ROFS、UDA 和用户存储的客体挂载及零售显示初始化仍待验证。DISPC 的 LCD 光栅取帧、键盘、滑盖、触屏、接听键、挂断键和侧锁已在原版驱动路径上验收。

```sh
make build/v86_app.js build/symbian-import-worker.js build/libv86.mjs build/v86-arm64.wasm
node tests/symbian/fixtures/make_package.mjs
node tests/app/browser_runner.mjs tests/app/symbian_test.html
node tests/symbian/manual/browser_import.mjs <firmware-directory>
```

## 滑盖键盘和机身按键

在 N97 控制台选择 **Keyboard**。模拟器冷开时滑盖关闭，接听、挂断、Menu、侧锁、音量和两段式快门均可操作。选择 **Open slider** 展开 QWERTY 和五向键。面板获焦后可用实体键盘输入，F2 对应 Fn，F3 对应 Chr，反引号对应五向键中央的 Select。Shift、Chr 和 Fn 各闭合自己的触点，字符组合和长按重复由原版客体决定。指针取消、失去捕获或失焦释放相应触点。快门全按先闭合对焦触点，再闭合快门触点。快照保存滑盖位置和进行中的硬件事务，恢复时释放没有现实输入源的触点。

RM-505 的 N2850 键盘扩展器由 RAPIDO 的 I²C 总线访问。原版 `keypad_exp.dll` 的 NSC 探测在 `0x800FC140` 向从地址 `0x42` 发送 `0x80`，检查制造商字节 0。模拟器提供这一兼容身份，芯片的物理修订仍待实物确认。原版设置 `0x59`（5 行 9 列），用 `0x82` 确认中断，用 `0x89` 读取 14 字节的键盘 FIFO。每个按下事件置位 bit 7，松开时清除。相机的两个触点使用同一芯片的 SF 接线，分别接地 ROW0 和 ROW1。原厂手册图 21 列出 43 个触点，ROM 表还确认 Select 和 Enter 对应不同扫描码。RAPIDO 主机位于 PA `0x20032200`、IRQ 135，原版 I²C 例程按小端半字收发。地址 `0x42` 的 N2850 和地址 `0x4A` 的 N500 共用主机，其他地址返回 NACK。[Nokia N97 维修手册图 21](https://www.s-manuals.com/manuals/phone/nokia/nokia_n97_rm-505_rm-506_service_manual-34_v1.pdf) · [TI LM8323 SNLS273A](https://www.ti.com/lit/ds/symlink/lm8323.pdf) · [TI OMAP5912 外设手册 SPRU760C](https://www.ti.com/lit/ug/spru760c/spru760c.pdf)

N2850 的低有效 IRQ 接到 GENIO66（bank 2，IRQ 249）。`egpio.dll` 读取 PA `0x20031DD8` 和 `0x20031DCC`，再向 `0x20031DE0` 写 bit 2 确认。滑盖 Hall 传感器走 GENIO58（bank 1，IRQ 248），与同一输入寄存器中的 GENIO45 microSD 检测脚各自独立。原版 `switch.dll` 采到高电平后输出 `0xBB`（QwertyOn），采到低电平后输出 `0xBC`（QwertyOff），每次重新配置为检测相反边沿。[Nokia RM-505/RM-507 维修板图第 2、8、9 页](https://www.s-manuals.com/manuals/phone/nokia/nokia_n97_rm-505_rm-507_service_schematics_v4.pdf)

本地探针用未改动的 22.0.110 ROM 执行原版 `i2c.dll` 的传输和接收片段、`egpio.dll` 的中断接收和确认、`keypad_exp.dll` 的扫描码读取，以及 `switch.dll` 的滑盖读取和事件构造。43 个触点的按下与松开、两次滑盖切换均抵达原版 `Kern::AddEvent` 调用处。探针为这些例程提供最小 MMU、调用者对象和事件观测点，截在完整系统事件队列之前。Chrome 从常规控制台经过 CPU Worker 验证输入和失焦释放，并从库中挂起、恢复同一台机器，核对 Hall 电平和键盘显示一致。I²C 传输和矩阵扫描采用同步模型，机械抖动、模拟电气鬼键、LM8323 PWM 与低功耗时序尚未模拟。默认零售启动仍停在芯片 Boot ROM 依赖处，客体桌面上的交互尚未验证。

```sh
node tools/symbian/keyboard-n97.mjs <output>/rom.xip.bin
node --test tests/symbian/n97_keyboard.mjs
```

## 电阻触屏

在 N97 控制台的设备屏幕上，可用鼠标或第一根手指按下和拖动，松开、取消、失焦、暂停或切换滑盖时释放接触。屏幕在合盖时按 360×640 竖屏计算，开盖时按 640×360 横屏计算。依据 0576555 ROFS1 的 `System/Data/Wsini.ini`，竖屏模式旋转 270°。原版窗口服务器将原生 `(x,y)` 转为 `(359−y,x)`，因此竖屏输入点 `(px,py)` 送入 `(py,359−px)`，横屏直接使用原生坐标。尺寸换算以屏幕实际显示区域为准，拖出边缘时坐标停在最近的像素。恢复挂起的 VM 时，屏幕方向跟随保存的 Hall 电平，原来手指的接触释放。零售引导到达有效扫描输出前，设备屏幕呈黑色。[原版 `WsPointer::HandleRawEvent`](https://github.com/SymbianSource/oss.FCL.sf.os.graphics/blob/master/windowing/windowserver/nonnga/SERVER/POINTER.CPP#L429-L442)

板图中 N500 的 TSC2004 接到同一 RAPIDO I²C 主机，与地址 `0x42` 的键盘扩展器共存。N500 的 AD1 接 VIO、AD0 接地，七位地址 `0x4A`。`exyin.dll` 从 `0x8016E458` 取原厂配置，启用十位自动 XY、Z1、Z2 采样，并以 10 ms 批次推进。读完整组测量值后释放低有效 PINTDAV。它连到 GENIO38 的 bank 1 bit 6 和 IRQ 234，原版按低电平触发。辅助复位从 N2850 的 KP-Y11 输出，`keypad_exp.dll` 将编号 19 映射为 GPIO0，通过 `0x85` 设输出、`0x86` 驱动电平。N500 识别有效低脉冲及软件复位，短于 5 µs 的低脉冲保留现有配置。[Nokia N97 维修手册第 8–25 页](https://www.s-manuals.com/manuals/phone/nokia/nokia_n97_rm-505_rm-506_service_manual-34_v1.pdf) · [Nokia 板图第 2、10 页](https://www.s-manuals.com/manuals/phone/nokia/nokia_n97_rm-505_rm-507_service_schematics_v4.pdf) · [TI TSC2004 SBAS408E，第 26–40 页](https://www.ti.com/lit/ds/symlink/tsc2004.pdf) · [TI LM8323 SNLS273A，表 6](https://www.ti.com/lit/ds/symlink/lm8323.pdf)

原版 `0x8016DB30` 将 ADC 读数换为 `(1023−Y,X)`，再以原厂校准将两轴映射到屏幕。模拟按像素中心取样，并提供代表性的 Z1/Z2。公开测试核对两轴每个像素经过原版校准后的落点，并覆盖长按重采样、共用 GPIO 的并行中断、N500 复位和快照恢复。本地探针运行原版 `i2c.dll` 的发送和接收、`egpio.dll` 的确认，以及 `exyin.dll` 的采样、压力计算、校准与抬笔处理。原版 `Kern::AddEvent` 调用处收到按下 `(0,0)`、移动 `(320,180)`、`(639,359)`、`(15,42)` 和抬起 `(15,42)`。探针提供最小调用对象和回调调度。完整 AP 诊断中，真实 IRQ 234 也进入原版触屏处理，随后完整的异步读路径遇到尚缺的 `sisa_wrapper.dll` 服务。面板的模拟滤波、噪声和压力变化，以及窗口服务器中的完整交互仍待验证。

```sh
node tools/symbian/touch-n97.mjs <output>/rom.xip.bin
node --test tests/symbian/n97_touch.mjs
node tests/app/browser_runner.mjs tests/app/symbian_test.html
```

## LCD 光栅取帧和 LoSSI

RM-505 的 RAPIDO DISPC 从 SDRAM 读像素，经 ViSSI 给 D6001 显示控制器。LoSSI 传输控制命令，D6001 负责帧缓存及到面板的 Compact DisplayPort 输出。22.0.110 XIP 的 `d_display.ldd` 含 `DispC`，另有 `lossi.dll`、`r_display_kernel.dll` 和 `r_display.dll`。原版内核页表把 VA `0xC6024800` 映射到 PA `0x20024800`，`DispC` 初始化例程 `0x801327D4` 绑定 IRQ 131。寄存器契约以原版代码及相符的 TI DISPC 文档核对。[Nokia 板图第 2、8、10 页](https://www.s-manuals.com/manuals/phone/nokia/nokia_n97_rm-505_rm-507_service_schematics_v4.pdf) · [Nokia N97 维修手册第 8–26 至 8–27 页](https://www.s-manuals.com/manuals/phone/nokia/nokia_n97_rm-505_rm-506_service_manual-34_v1.pdf) · [TI SPRUF98Y §15.4 与 §15.7.2.2](https://www.ti.com/lit/ug/spruf98y/spruf98y.pdf)

控制器的连续 LCD 光栅模式支持 RGB565 和 XRGB8888 主图层。取帧使用客体写入的物理地址、显示窗口和有符号像素／行步进。GOLCD 在帧边界切换已准备的寄存器，IRQ 131 分别反映 VSYNC、编程扫描线和关闭输出后的 FRAMEDONE。扫描节拍采用 60 Hz，IP 修订号采用与原驱动分支兼容的 3.1。CPU Worker 通过现有显示接口提交实际像素。滑盖开合后的画面转向与上节的触摸变换互为反向，挂起恢复保存正在显示的配置及待提交状态。

原版 `d_display.ldd` 的 `0x801335E0` 向 `DISPC_SYSCONFIG` 写入 2，观察 `DISPC_SYSSTATUS` 的 RESETDONE 变为 0 后写回 0 并返回。DISPC 复位清除光栅、寄存器和 IRQ 状态，板级时钟随后将 RESETDONE 置回 1。模拟的复位窗口为 0.25 ms，快照保存剩余时序，整机冷启直接从就绪状态开始。原版紧接着写入的配置可供复位完成后的光栅使用。D6001 继续显示保留的帧。[TI SPRUF98Y §15.3.1.2、表 15-155 与 15-157](https://www.ti.com/lit/ug/spruf98y/spruf98y.pdf)

本地探针为未改动的 0576555 XIP 提供最小 MMU 和光栅模式的调用者对象，由原版 `0x80132758` 构造控制器，再经 `0x80132950` 编程和启用主图层。原版 `0x80132B24` 与 `0x80133178` 随后提交硬件旋转的扫描配置。RGB565 和 XRGB8888 的四象限图案在 640×360 与 360×640 下逐像素吻合。独立的原版 AP 内核探针运行 `0x801327D4` 初始化，在诊断开启 VSYNC 中断后，实测 IRQ 131 经原版分派到 `0x8013333C`、确认状态并返回被中断的指令。公开 Chrome 夹具由 ARM 客体先写图案再编程 DISPC，核对两种方向的画布颜色及挂起恢复。

原版 `lossi.dll` 驱动通过 PA `0x20032100` 的两组端口发送命令和数据，经发送就绪、发送空闲及接收确认完成传输。维修手册的 Figure 76 显示 CS0 接 D6001（UPD809400），CS1 经 ASIP 接 TFT。原版两个构造函数与该走线一致。D6001 的行列窗口使用两个 24 位大端端点，TFT 的窗口端点为 16 位。D6001 在退出休眠、选择 24 位 ViSSI 和收到 `0x2C` 后，按窗口从光栅帧接收像素。TFT 的 `0x28/0x29` 和 `0x10/0x11` 控制关屏、开屏、休眠与唤醒，画面隐藏时保留帧缓存。快照保留缓存、窗口、命令及未完成的传输。S3.1 的旧快照仍可显示直接光栅。串行节拍采用板载 38.4 MHz 参考，休眠退出采用 DCS 的 5 ms 稳定时间。[Nokia 维修手册第 8–26 至 8–27 页](https://www.s-manuals.com/manuals/phone/nokia/nokia_n97_rm-505_rm-506_service_manual-34_v1.pdf) · [MIPI Display Command Set](https://www.mipi.org/specifications/display-command-set)

`panel-n97.mjs` 冷启 0576555 原版 AP 内核，以原版 `lossi.dll` 初始化 DFC 队列，再由 `DisplayControllerHw` 和 `WhiteDwarf` 原版构造函数创建两条命令路径。原版 `DispC` 经 ViSSI 向缓存提交全屏 230400 像素。探针执行原版软件复位，确认复位期间两个方向的画面完整保留。原版 `0x801327D4` 重新初始化寄存器并绑定 IRQ 131。复位后原版窗口回调 `0x8013C5A8` 从带行步进的 SDRAM 更新 (304, 30) 起的 180×25 矩形，保留剩余 225900 像素，并执行原版显示中断处理例程。探针清空原始 SDRAM 后逐像素核对黑屏和唤醒前后两种方向的 RGBA。公开 Chrome 夹具通过正常 CPU Worker 由 ARM 客体发起复位，核对两种方向的画布、关屏复位再开屏及挂起后的保存画面。

原版 `0x80132DEC` 的 stall 模式仍需单独验收。已观测到 `TControllerDifPlatform` 编程 PA `0x20024080/0x20024100`，其在手机主屏完整引导中的作用仍待确认。面板物理复位及电源、LoSSI 像素 PIO、私有面板命令及视频叠层待接入。私有读取当前为总线高电平，缺少实机读数。完整 S60 桌面仍待验证。

```sh
node tools/symbian/display-n97.mjs <output>/rom.xip.bin
node tools/symbian/panel-n97.mjs <output>/rom.xip.bin
node --test tests/symbian/n97_dispc.mjs tests/symbian/n97_panel.mjs
node tests/symbian/fixtures/make_package.mjs
node tests/app/browser_runner.mjs tests/app/symbian_test.html
```

## 接听、挂断和侧锁

控制台的 **Keyboard** 面板提供 **Send**、**End** 和 **Lock**。面板获焦时，也可用 Home、End 和 F4 分别按住和松开。接听、挂断和显示区域共用单点电阻屏，后续接触需先松开，再重新按下。侧锁可与其他按键或屏幕同时操作。

正面两键取样走 N500 的 TSC2004。原版 `DTouchKeyHandler` 在显示校准之前识别两块区域，`exyin.dll` 的静态表 X 下限为 995，初始化后的 X 范围为 991–1023，接听和挂断的 Y 范围分别为 571–870 和 130–456。模拟 ADC 原始 `(X,Y)` 分别为 `(720,15)` 和 `(293,15)`，经原版换轴后落在相应区域。触屏探针经原版 I²C 传输、GPIO 中断及采样回调观测到 `0xC4`（Yes）和 `0xC5`（No）的按下与松开。长按重采样保留一次按下，原版释放回调上报松开。[Nokia RM-505/RM-507 维修板图第 2、10 页](https://www.s-manuals.com/manuals/phone/nokia/nokia_n97_rm-505_rm-507_service_schematics_v4.pdf)

侧锁 S4404 按下时将 GENIO40 拉低，松开回到高电平。该脚使用 bank 1 bit 8，与 GENIO38 触屏 DAV 共用 IRQ 234。原版 `switch.dll` 的 ROM 表在 `0x80168ED0` 声明 GPIO40 和扫描码 `0xB3`（DeviceF）。侧锁探针冷启原版 EKA2，在已知 ISASW 依赖处加载原版开关扩展，拨动实装的 GPIO。原版中断、去抖定时器和事件队列生成 `0xB3` 的按下与松开，并在每次转换后重新检测相反边沿。客体的拨号和按键锁功能仍需完整零售引导验证。[Nokia RM-505/RM-507 维修板图第 2、8 页](https://www.s-manuals.com/manuals/phone/nokia/nokia_n97_rm-505_rm-507_service_schematics_v4.pdf)

```sh
node tools/symbian/touch-n97.mjs <output>/rom.xip.bin
node tools/symbian/lock-n97.mjs <output>/rom.xip.bin
```

## 手机电源键

在控制台的 **Keyboard** 面板按住 **Power**，或让面板获得焦点后按住 F9。松开鼠标或 F9、取消指针操作、失去焦点及恢复快照都会释放触点。控制台的 **Power** 菜单另外负责 VM 的运行、挂起和关机。

手机顶端的开关把 AVILMA 的 `PWRONX` 拉低。RM-505 原版 ISASW 从 CBUS 设备 1 读取 `0x16` 的 bit 5，使用寄存器 `0x01` 的 bit 0 确认中断，并用 `0x02` 的 bit 0 屏蔽。AVILMA ASIC 编号 `0x0296` 来自同一版本的 RM-505 服务读数。RAPIDO CBUS 位于 PA `0x20030700`，使用 4.39 MHz 时钟推进命令和 16 位数据。原版初始化和访问例程使用 PA `0x20040204` 起的六个硬件信号量。AVILMA 中断走 GENIO74（bank 2 bit 10），由 IRQ 250 以高电平触发。键盘扩展器在同一 GPIO bank 使用自己的引脚和 IRQ。[Nokia N97 维修手册第 8–11、8–20 页](https://www.s-manuals.com/manuals/phone/nokia/nokia_n97_rm-505_rm-506_service_manual-34_v1.pdf) · [Linux AVILMA/Retu 寄存器与中断](https://github.com/torvalds/linux/blob/master/drivers/mfd/retu-mfd.c) · [Linux 电源键驱动](https://github.com/torvalds/linux/blob/master/drivers/input/misc/retu-pwrbutton.c) · [RM-505 22.0.110 服务读数](https://forum.gsmhosting.com/vbb/f550/very-emaging-nokia-n97-rm-505-answered-1253608/)

`power-n97.mjs` 从导出的零售固件载入原版 ISASW，并由其 ARM scatterload 例程初始化可写区。原版键状态函数报告 `2 → 3 → 3 → 2`，分别对应松开、按下、保持和松开。隔离探针提供 MMU、IRQ 分派入口和缺少 `HW_CONF` type `0x0B` 时所需的回调注册。实体按键输入经正常机器的 CBUS、GPIO 和 ICU 触发 ARM IRQ 250；原版 ISR `0xC6361780` 调用 `0xC6348D64`，屏蔽按键中断并请求 30,000 µs 的去抖定时。独立调用原版定时回调又验证了提前松开、50,000 µs 的按住轮询和松开通知。探针在原版定时接口处观测请求，基带定时器自动分派、双处理器仲裁、其余 AVILMA 电源控制和零售固件的整机关机仍待验证。

```sh
node tools/symbian/power-n97.mjs <output>
node --test tests/symbian/n97_power.mjs
node tests/app/browser_runner.mjs tests/app/symbian_test.html
```

## 原生 SIS/SISX 递送与 v86 Notes

打开一台 microSD 槽为空的 N97，选择控制台的 **Send SIS/SISX…**。文件选择器接受本地 `.sis` 和 `.sisx`。确认框列出原始文件名和对应的手机路径，例如 `F:\INSTALL\PKG00001.SIS`。8.3 文件名按选择顺序分配，同名、长名和中文名各占一个独立文件。选择 **Insert transfer card** 后，浏览器创建该 VM 的新卡并在当前会话插入，保留客体 RAM 和运行状态。看到 **Transfer card inserted** 后，可在已启动的手机系统中从文件管理器打开 `F:\INSTALL`。挂起恢复和冷开都继续使用同一张卡。若已有卡，可在关机后到 **Library → Settings → Symbian firmware** 卸下，原映像仍在 **Browser disks**。

递送工具检查 Symbian 9.x UID、UID CRC、文件及控制器边界、控制器内的包 UID 和实际提供的两个字段 CRC。高容量文件分段读取，解压控制器上限 8 MiB。新的 FAT16 卡按所选数据量采用 16 MiB 至 2 GiB 标准容量，并核对浏览器配额。包字节原样复制。写入程序先保存库里的卡配置，再向客体发出插卡通知。可确认卡未插入时，失败会回滚登记并回收尚未使用的映像。Chrome 回归由正在运行的 ARM 客体读取实装 MMC 的 FAT16 卡，核对客体 RAM、挂起和冷开。签名、能力、安装和升级由客体的应用程序管理器判断。当前零售引导仍需 RAPIDO 芯片 Boot ROM，客体文件服务器挂载、原版安装与应用运行尚待验证。[Symbian OS v9.x SIS 文件格式说明](https://www.cryer.co.uk/file-types/s/sis/softwareinstallsis.pdf)

`dma-n97.mjs --live-sis` 在同一份未改动的 0576555 原版 AP 内核诊断会话插入新卡。原版 `EPBUSMV.DLL` 经 IRQ 234 和去抖回调确认插卡，原版 `ELocal.fsy` 判定 DMA 读到的 BPB 为 FAT16。探针随后由原版 DMA 驱动及 IRQ 1 读取共 27 个扇区，主机从这些扇区解析目录和 FAT 链，核对两份 v86 Notes 的全部包字节。

随附的 **v86 Notes** 是可分发的 BSD-2-Clause 原创测试应用，使用测试 UID `0xE0860505` 和零额外能力。用 N97 键盘输入短文本，选 **Save** 写入私有目录 `C:\private\e0860505\note.txt`，下次打开读回。2.0 增加 **Clear**，两版继续使用同一个文本文件。应用使用真实 Window Server 和文件服务器 API。构建从原版 Nokia N97 SDK 的 ARM 导入库读取序号，用 symbian-platform v0.3.0 生成 E32，资源按原版 SDK 的格式编译，再由 Nokia MakeSIS 和 SignSIS 打包、签名。两版声明 S60v5 目标 UID `0x1028315F`。已按 RM-505 固件的导出表独立核对 v1 的 59 项和 v2 的 60 项符号。随附签名为同一测试证书，自签名有效期为 2026-11-18 至 2036-11-15，客体日期需处于有效期内。[symbian-platform v0.3.0](https://github.com/hpnkv/symbian-platform/releases/tag/v0.3.0) · [Nokia SIS 工具说明](https://devlib.symbian.slions.net/s3/GUID-AFE0238A-D6A4-5D07-BB99-85E8CF97BD26.html)

| 可分发文件 | SHA-256 |
| --- | --- |
| [v86 Notes 1.0](../tests/symbian/fixtures/notes-v1.sisx) | `8bf046b06ef911359e54a7fcce18cfcd86a109d69d7cd7c1e3cced7d6c5990db` |
| [v86 Notes 2.0](../tests/symbian/fixtures/notes-v2.sisx) | `10c4ddd39de689e1ffcdfe42529f401929c1240fc8927c28a884463cdfc505d0` |

构建脚本的 `makesis`、`signsis` 参数可为本机命令，也可为调用原版 Windows 工具的包装命令。每次构建为两版生成一张新测试证书，因此签名和最终 SISX 摘要随构建变化。公开回归用 OpenSSL 验证两版的证书及 RSA-SHA1 签名，核对 UID、目标平台、E32 能力，以及主机卡上两个包的摘要。原版 `SignSIS -o` 和 `DumpSIS -l` 能读取两版。独立的 `INTERPRETSIS` 验收以 RM-505 的 237 个固件登记桩为只读输入，先离线安装 1.0，再升级到 2.0，核对 EXE 更换、AppArc 注册和已有私有测试文件保留。这个检查在主机目录完成。`fsck_msdos -n` 和 GNU mtools 独立读取了卡；原版 MakeSIS 生成的 105,906,908 字节附加样本也从 128 MiB 卡抽出并通过 SHA-256 比对。

```sh
sh tools/symbian/notes/build.sh <symbian-platform-sdk> <nokia-n97-sdk-epoc32> <makesis> <signsis> <output-directory>
node --test tests/symbian/sis.mjs
node tools/symbian/dma-n97.mjs <output>/rom.xip.bin --live-sis
node tests/app/browser_runner.mjs tests/app/symbian_test.html
mdir -i 'exported-card.img@@1048576' ::/INSTALL
mcopy -i 'exported-card.img@@1048576' ::/INSTALL/PKG00001.SIS recovered.sis
```
