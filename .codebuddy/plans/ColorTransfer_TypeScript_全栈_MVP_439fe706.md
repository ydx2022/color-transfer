---
name: ColorTransfer TypeScript 全栈 MVP
overview: 将 ColorTransfer 重构为 TypeScript 全栈：基于已完成的实测标定数据与 CIMBAR 设计清单，实现端到端 MVP（网页发送编码帧 → 手机浏览器拍照解码 → 喷泉码重组），音频反馈降级为预留优化项。
design:
  architecture:
    framework: react
    component: shadcn
  styleKeywords:
    - 深色科技
    - 高对比
    - 单屏拍摄优先
    - 数据可视化
  fontSystem:
    fontFamily: PingFang SC
    heading:
      size: 24px
      weight: 600
    subheading:
      size: 16px
      weight: 500
    body:
      size: 14px
      weight: 400
  colorSystem:
    primary:
      - "#2563EB"
      - "#3B82F6"
      - "#1D4ED8"
    background:
      - "#0B0F1A"
      - "#141A26"
    text:
      - "#E5E7EB"
      - "#9CA3AF"
    functional:
      - "#22C55E"
      - "#EF4444"
      - "#F59E0B"
todos:
  - id: setup-ts-monorepo
    content: 搭建 Vite+React+TS 全栈骨架与共享参数层，按标定数据定默认档位（cellPx 13/5、颜色与符号位宽）
    status: completed
  - id: core-codec
    content: 实现核心编码层：符号集离线生成与汉明距离筛选、RS 与网格交织、帧布局与块元数据、块重组
    status: completed
    dependencies:
      - setup-ts-monorepo
  - id: sender-page
    content: 实现发送端：数据编码与 Canvas 彩色帧渲染，支持循环播放与档位切换
    status: completed
    dependencies:
      - core-codec
  - id: receiver-decoder
    content: 实现接收端：锚点定位与透视校正、旋转自适应、局部增益归一化、符号与颜色相对匹配解码
    status: completed
    dependencies:
      - core-codec
  - id: e2e-field-test
    content: 用 [integration:eop] 部署到 HTTPS，做跨设备真机端到端实测并调优默认档位，以三组标定照片做离线回归
    status: completed
    dependencies:
      - sender-page
      - receiver-decoder
  - id: docs-assets
    content: 更新 PROJECT_TASKS 与 README 为 TS 全栈计划，标注旧版 Python 编码方案弃用、标定工具链保留
    status: completed
    dependencies:
      - e2e-field-test
---

## 产品概述

将 ColorTransfer 从「Python 桌面端设想」正式落地为 **TypeScript 全栈** 的屏幕—相机数据传输系统：发送端在网页上显示彩色编码帧，接收端用手机浏览器 `getUserMedia` 拍摄并解码还原文件。目标是一次编码、跨设备可用（用户核心诉求：多设备、且设备表现"飘忽不定"）。

## 核心功能

- **发送端**：选择文件 → 分块编码 → 在网页全屏渲染彩色编码帧并循环播放
- **接收端**：手机浏览器调摄像头拍照/连拍 → 自动定位、透视校正、解码 → 重组文件
- **跨设备自适应**：按实测信道质量切换编码档位（单元尺寸、颜色数、纠错强度）
- **抗真实信道损伤**：应对模糊、色彩串扰、非径向亮度梯度、采样不足

## 关键约束（来自已完成的三组实测标定）

| 组 | 设备 | σ_PSF | d_rec | 说明 |
| --- | --- | --- | --- | --- |
| 原生相机 | 华为 Mate50E | 0.52 | 3 | 上限 |
| 网页锁定 | Android+Edge | 1.03 | 5 | 典型 |
| 网页自动 | 华为浏览器 | 2.78 | 13 | 最差包络 |


- 单元尺寸必须按**最差包络 13px 起步**，好设备经信道估计后降到 5px；像素级 3×3 子格在所有网页端配置下均不可行
- **存在非径向亮度梯度**（实测四角 0.25/0.20/0.49/0.43，下方更亮），径向暗角模型失效，必须局部归一化或相对匹配
- 网页端 `getUserMedia` 输出传感器原生方向，存帧为"躺倒"竖图，解码端需做旋转自适应

## 关于音频反馈（用户 idea）

喷泉码只需收够任意 N+1 个块即可重建，**天然不需要帧同步与重传**，因此音频反馈最被看重的 ARQ 价值被大幅削弱；其剩余价值仅剩"通知发送端收够可停"与"回传信道质量"。本期**不实现音频**，仅在协议层预留反馈接口。

## 关于「元宝」

工作区内未检索到「元宝」（0 结果、无 AGENTS.md），推测为外部协作者，本会话无法直接征询。故以上按推荐方案制定，若元宝对优先级或音频有不同判断，可据此立即调整。

## 技术栈

- **前端**：Vite + React 18 + TypeScript + Tailwind CSS（发送页 / 接收页）
- **后端**：Node + Express（MVP 仅提供静态托管与健康检查；预留文件暂存与多端配置同步）
- **图像处理**：纯 TS/JS + TypedArray 自写（锚点检测、透视校正、哈希、颜色匹配），**不引入 OpenCV.js**（体积数 MB，CIMBAR 尽调已判定可用纯 JS 实现）
- **纠错**：RS(255,k) + 网格交织 + 循环播放收够即停（等价于简化无速率喷泉，MVP 不引入 WASM 版 wirehair）
- **部署**：EdgeOne Pages（HTTPS 安全上下文，手机端 `getUserMedia` 前置条件）
- **保留**：`calibration/` Python 标定工具链（一次性工具，继续用于信道验证与回归）

## 实现方案

采用 **CIMBAR 尽调报告「可借鉴清单」** 作为设计基线，并用本项目实测数据校准参数：

1. **符号 + 颜色双编码**：4 bit 符号（16 图案）+ 2 bit 颜色（4 色）= 6 bit/cell；形状维度抗光照优于颜色维度。弱信道档位降为 4 bit 符号 + 1 bit 颜色
2. **符号集离线生成**：`scripts/gen_symbols.ts` 在 8×8 二值图案空间中搜索 16 个彼此汉明距离 ≥20 bit 的图案，输出为 TS 常量（可复现、可扩展）
3. **定位与几何**：三主锚 + 右下方向标记 → `getPerspectiveTransform`/`warpPerspective` 同效的自写透视校正 → drift 多候选搜索（±7px）；旋转 0/90/180/270 全角度评分（复用分析脚本中已验证的各向异性 + 灰阶相关性判据）
4. **颜色判定**：cell 中心区平均 RGB → CCM 校正 → **相对距离最小匹配**（弃用旧版绝对阈值反查）
5. **抗非径向亮度梯度**：帧内散布参考灰块，解码时按区块估计局部增益并归一化（针对实测的上下梯度问题）
6. **交织 + RS**：图像损伤空间聚簇，交织把同一 RS 块数据分散，使局部损坏摊薄为"每块坏一点"

## 架构设计

```mermaid
flowchart LR
  A[文件] --> B[分块+RS+交织]
  B --> C[符号/颜色映射]
  C --> D[帧布局:锚点+参考灰块+数据格]
  D --> E[Canvas 渲染·循环播放]
  E --> F[手机拍摄]
  F --> G[锚点定位+透视校正+旋转自适应]
  G --> H[局部增益归一化]
  H --> I[符号汉明匹配+颜色相对匹配]
  I --> J[解交织+RS 纠错]
  J --> K[块重组·收够即停]
  K --> L[还原文件]
```

## 目录结构

```
ColorTransfer/
├── web/                          # [NEW] TypeScript 全栈主体
│   ├── package.json
│   ├── vite.config.ts
│   ├── src/
│   │   ├── shared/               # [NEW] 前后端共享
│   │   │   ├── params.ts         # 编码档位（d_rec 13/5、颜色数、符号位宽）
│   │   │   └── symbols.ts        # 生成的符号集常量
│   │   ├── core/                 # [NEW] 平台无关编码核心
│   │   │   ├── rs.ts             # RS 编解码
│   │   │   ├── interleave.ts     # 网格交织
│   │   │   ├── frameLayout.ts    # 帧布局与元数据(fileId/blockId/total)
│   │   │   └── blockAssembler.ts # 块重组（收够即停）
│   │   ├── sender/
│   │   │   ├── encoder.ts        # [NEW] 数据→符号/颜色序列
│   │   │   └── renderer.ts       # [NEW] Canvas 渲染
│   │   ├── receiver/
│   │   │   ├── locate.ts         # [NEW] 锚点检测+透视校正+旋转自适应
│   │   │   ├── normalize.ts      # [NEW] 局部增益归一化+CCM
│   │   │   └── decoder.ts        # [NEW] 符号/颜色解码
│   │   ├── pages/
│   │   │   ├── SendPage.tsx      # [NEW] 发送页
│   │   │   └── ReceivePage.tsx   # [NEW] 接收页
│   │   └── main.tsx
│   ├── server/
│   │   └── index.ts              # [NEW] Express（静态托管+健康检查）
│   └── scripts/
│       └── gen_symbols.ts        # [NEW] 符号集离线生成与汉明距离筛选
├── calibration/                  # [保留] Python 标定工具链与三组实测数据
├── docs/CIMBAR_ANALYSIS.md       # [参考] 设计基线
└── PROJECT_TASKS.md              # [MODIFY] 更新为 TS 全栈新计划
```

## 实施要点

- **参数默认值**：`cellPx=13`（最差包络）、`colorBits=2`、`symbolBits=4`、`rsParity=30/155`；提供 `profile: safe|balanced|fast` 三档
- **验收基线**：复用 `calibration/photos/` 三组真实拍摄照片做解码器离线回归，验证定位/透视在不同设备下的稳定性
- **旧资产处理**：标定工具链完整保留；`旧版/` Python 编码方案（5-5-5 纯颜色 + 绝对阈值）弃用，仅保留汉明码思路参考；`PROJECT_TASKS.md` 的 T01–T15 作废重写
- **性能**：单帧解码走"拍照 → 逐帧解码 → 重组"，不做实时视频流解码（CIMBAR 尽调已判定实时 WASM 不可行）

## 设计风格

深色科技工具风格。发送页为全屏无干扰的编码帧播放（深色背景降低屏外杂光干扰），接收页为相机取景 + 解码进度的一屏式界面（延续已验证的「拍摄优先」单屏布局：预览占满主区、操作常驻底部、详情折叠）。

## 页面规划

### 1. 发送页（SendPage）

- **顶部状态条**：文件名、大小、档位（safe/balanced/fast）、当前帧序号
- **主区**：Canvas 全屏渲染彩色编码帧，循环播放，支持暂停/单步
- **底部操作栏**：选择文件、开始/暂停、档位切换、全屏
- **折叠详情**：分块进度、RS 参数、符号/颜色配置

### 2. 接收页（ReceivePage）

- **顶部状态条**：锁定状态（对焦/曝光/白平衡）、分辨率、已解码块数
- **主区**：相机预览占满，底部叠加直方图与曝光提示（复用标定页已验证的 HUD）
- **底部操作栏**：启动摄像头、参数锁定、连拍、开始解码
- **折叠详情**：解码日志、信道估计结果（σ/CCM/建议档位）、错误统计
- **完成态**：进度达 100% 显示"收够可停"并提示保存文件

## 交互要点

- 发送页播放时禁止息屏（Wake Lock）
- 接收页连拍间隔与锁定逻辑复用 `capture_test.html` 已验证实现
- 解码进度用环形进度 + 块矩阵热力图（直观显示哪些块已收齐）

## Agent Extensions

### Integration

- **eop**（EdgeOne Pages，已连接）
- 用途：部署 TS 前端到 HTTPS 公网，供手机真机端到端实测（`getUserMedia` 需安全上下文，与标定期的 HTTPS 需求一致）
- 预期结果：拿到可访问公网地址，完成跨设备实拍解码验证并据此调优默认档位