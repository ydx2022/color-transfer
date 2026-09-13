# 彩色数据传输系统 - 项目任务文档（TS 全栈版）

> 最后更新：2026-09-06 ｜ 当前阶段：任务 3（修订版）执行中
> 旧版 Python 计划（T01–T15）**已作废**，见文末「旧资产处理」。

## 高层决策（不可推翻，除非仿真/实测提供反证）

1. TypeScript 全栈 + PWA，接收端零安装
2. codec 纯 TS 零 DOM 依赖，Node/浏览器双跑
3. 旧 Python 代码只读不移植；`calibration/` 工具链保留为一次性测量工具
4. ECC：MVP 用 LT 喷泉（纯 TS 自实现）+ RS(255,k) 内层；禁止汉明码；交织暂不做，等仿真看错误聚簇再定
5. 每模块必须有 round-trip 测试（encode→decode bit-exact）
6. 档位：safe=13 / balanced=7 / fast=5，人工选档（UI 按钮），发送后全程不变
7. 音频反馈暂缓，协议帧预留 `feedback_capable` 标志位 + `getChannelQuality()` 函数
8. 符号集最小汉明距离由仿真实测决定，不预设 20bit
9. 屏幕 1600×900，PPI 暂按 96（标「假设，待校准」）

## 目录结构（新增/现有）

```
ColorTransfer/
├── web/                      # TS 全栈主体（新增）
│   ├── package.json
│   ├── vite.config.ts / tsconfig.json
│   ├── src/
│   │   ├── shared/           # 前后端共享：params.ts / types.ts / symbols.ts / protocol.ts
│   │   ├── core/             # 平台无关：gf256 / rs / symbolGen / channelSim / modulation / fountain / blockAssembler / calibration / getChannelQuality / bakeoff
│   │   ├── sender/           # encoder.ts / renderer.ts（待扩展）
│   │   ├── receiver/         # locate / normalize / decoder（待扩展）
│   │   ├── pages/            # SendPage / ReceivePage（React）
│   │   └── scripts/          # gen_symbols.ts / run_bakeoff.ts
│   ├── test/                 # run.ts（模块 round-trip 套件） + rs.test.ts
│   └── server/               # index.ts（Express 静态托管 + 健康检查）
├── calibration/              # 保留：Python 标定工具链 + 三组实测 calibration.json
├── docs/                     # MODULATION_BAKEOFF.md / DESIGN_DECISIONS.md
├── 旧版/                      # 弃用：Python 编码方案（5-5-5 纯颜色 + 绝对阈值），仅参考
└── reference/                 # 第三方参考（cimbar 等）
```

## 任务分解（任务 3）

| 任务ID | 描述 | 状态 | 验收 |
|---|---|---|---|
| T3A | TS 全栈骨架 + PWA 配置 + shared/params.ts（档位常量、colorBits 默认=1、symbolBits=4） | ✅ | 可 `npm run dev` 启动 |
| T3B | 信道仿真器（读 calibration.json；链路 CCM→非径向梯度→噪声→量化；none/4角/密集 三校准模式；最差包络合成） | ✅ | 三组标定一键切换；密集校准输出校正前后 BER |
| T3C | 核心 codec：gf256、RS(255,223)、符号集离线生成（minDistance=29）、调制映射、LT 喷泉、块重组 | ✅ | 各模块 round-trip 通过 |
| T3D | 调制擂台赛 M1–M7 扫 BER/有效吞吐；密集 vs 无校准改善；输出 MODULATION_BAKEOFF.md | ✅ | 含净吞吐决策表、M7 纯颜色 BER |
| T3E | getChannelQuality() 三组标定→档位 + 单元测试 | ✅ | web_auto→safe / web_locked→fast / native→fast |
| T3F | DESIGN_DECISIONS.md（每条含反证条件） | ✅ | — |
| T3G | 协议帧头协议.ts 预留 feedback_capable + 字节级 pack/unpack round-trip | ✅ | 版本不匹配显式抛错 |
| T3H | 接收端定位/透视/旋转自适应/局部归一化解码（实拍回归） | ⬜ | 复用 calibration/photos 三组照片离线回归 |
| T3I | eop 部署 HTTPS + 跨设备真机端到端实测并调优默认档位 | ⬜ | 公网地址 + 真机实测报告 |

## 测试与铁律

- 运行：`cd web && npm test`（test/run.ts，当前 20/20 通过）；`npm run typecheck` 零错误。
- 铁律：ECC 一律 RS + 喷泉；每模块 round-trip；仿真器只读实测 calibration.json；不确定处标「假设」；自动检测须完整性校验并显式报错。

## 旧资产处理

- `旧版/`：Python 编码方案（5-5-5 纯颜色 + 绝对阈值反查）**弃用**，仅保留汉明码思路参考。
- `calibration/`：完整保留，继续用于信道验证与回归；三组实测 `out_20260904 / out_web / out_web_locked`。
- 根目录 `requirements.txt / ARCHAEOLOGY.md / DEVELOPMENT_GUIDE.md / reference/`：参考材料，不参与 TS 构建。
