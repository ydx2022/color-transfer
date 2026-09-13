# 🎨 ColorTransfer（opti-link）

通过**屏幕彩色编码帧 → 手机摄像头**传输文件的 TypeScript 全栈系统。发送端在网页全屏渲染彩色编码帧，接收端用手机浏览器 `getUserMedia` 拍摄并解码还原文件。

## 核心特性

- **跨设备、零安装**：发送端 Web（Vite + React + PWA），接收端手机浏览器直接访问。
- **纯 TS codec（零 DOM）**：`web/src/core` 可在 Node 与浏览器双跑，全部模块 round-trip 测试覆盖。
- **实测驱动**：信道仿真器直接读取 `calibration/` 三组实测 `calibration.json`，禁止凭空假设。
- **分级纠错**：外层 LT 喷泉码（rateless，收够即停）+ 内层 RS(255,223)；铁律**禁止汉明码**。
- **抗非径向亮度梯度**：密集网格校准（每 N×N 插 1 校准格）做局部增益归一化。

## 目录

| 路径 | 说明 |
|---|---|
| `web/src/core/` | 编码核心：gf256、rs、symbolGen、channelSim、modulation、fountain、blockAssembler、calibration、getChannelQuality、bakeoff |
| `web/src/shared/` | 共享：档位参数 `params.ts`、类型 `types.ts`、符号集 `symbols.ts`、协议帧头 `protocol.ts` |
| `web/src/pages/` | `SendPage` / `ReceivePage`（React） |
| `web/src/scripts/` | `gen_symbols.ts`（符号集离线寻优）、`run_bakeoff.ts`（擂台赛） |
| `web/test/` | `run.ts` 模块 round-trip 套件（含协议帧头） |
| `calibration/` | **保留**：Python 标定工具链 + 三组实测数据 |
| `docs/` | `MODULATION_BAKEOFF.md`（擂台赛报告）、`DESIGN_DECISIONS.md`（决策+反证） |
| `旧版/` | **弃用**：旧 Python 编码方案，仅参考 |

## 快速开始

```bash
cd web
npm install
npm run dev          # 发送端/接收端本地预览
npm test             # 模块 round-trip 测试（当前 20/20 通过）
npm run typecheck    # 类型检查（零错误）
npm run gen:symbols  # 重新生成符号集（确定性种子）
npm run bakeoff      # 跑调制擂台赛，生成 docs/MODULATION_BAKEOFF.md
npm run server       # Express 静态托管 + 健康检查
```

## 档位（人工选档，发送后锁定）

| 档位 | cellPx | 依据 |
|---|---|---|
| safe（默认，跨设备） | 13 | 最差包络 web_auto，σ_PSF≈2.78 |
| balanced | 7 | 居中 |
| fast | 5 | 网页锁定模式 web_locked，σ_PSF≈1.03 |

`colorBits` 默认 = 1（双色：仅亮度+暗）。推荐方案见 `docs/MODULATION_BAKEOFF.md`（safe 档 M1：4bit 符号 + 2 色 + 四角校准，净吞吐 5.98 bit/格）。

## 部署

前端通过 **GitHub Actions + Cloudflare Pages** 部署：push 到 `main` 后自动构建 `web/` 并把 `web/dist` 上传到 Pages 项目 `color-transfer`。

```bash
# 一次性：在 GitHub 仓库 Settings → Secrets and variables → Actions 配置
#   CLOUDFLARE_API_TOKEN   （权限 Account → Cloudflare Pages → Edit）
#   CLOUDFLARE_ACCOUNT_ID
git push origin main      # 触发自动部署
```

产物地址 `https://color-transfer.pages.dev/`（HTTPS，手机浏览器可直接调起 `getUserMedia`）。

> 仓库**不跟踪**标定数据与调试产物（`calibration/photos`、`calibration/out_*`、录屏 zip 等，见 `.gitignore`），它们仅保留在本地用于离线回归。

## 铁律

1. ECC 一律 RS + 喷泉，禁止汉明码。
2. 每个模块 round-trip 测试，encode→decode bit-exact。
3. 仿真器只读实测 `calibration.json`，禁止假设。
4. 不确定处标「假设」；数值类模块须可视化校验；自动检测须完整性校验并显式报错。

## 设计决策

见 [`docs/DESIGN_DECISIONS.md`](docs/DESIGN_DECISIONS.md)，每条决策附「反证条件」。
