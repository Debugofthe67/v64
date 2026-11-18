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
