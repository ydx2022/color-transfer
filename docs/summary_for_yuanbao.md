# ColorTransfer 调制擂台赛 / 可视化工作总结（致元宝）

> 整理时间：2026-09-06
> 范围：`web/` 下调制擂台赛（bakeoff）与校准对比图（calib visuals）的修复与核查。

---

## 一、已修复的两个可视化 Bug

### 1. 校准对比图左图下半部分全黑
- **根因**：`renderIntendedFrame` 内部用 `scheme.cellPx`（M1=13）输出 **312×234**，但合成面板按 `cellPx=18` 算尺寸 **432×324**；拷贝时以 432 为步长去读 312 宽的数据，越界读到 `undefined` → 写 0（黑）。即底部约 90 行 + 右缘全黑。
- **修复**：`renderIntendedFrame` 增加 `cellPx` 参数，调用处（renderCalibComparison）传入面板尺寸，输出严格对齐 432×324。
- **验证**：修复后逐行亮度从顶部 ~85 平滑渐变到底部 ~177，全幅覆盖、无黑块；`tsc` 无错误，已重新生成 `docs/bakeoff_visuals/` 下全部图片。

### 2. 噪声函数口径（可视化渲染器）
- 噪声 bug 仅存在于**可视化渲染器 `renderCapturedFrame`**（曾对每个像素直接加未衰减噪声）。
- 该 bug **从未污染擂台赛数值**——数值仿真走 `channelSim.simulateColorCell/simulateSymbolCell`，自始即用正确衰减 `noiseSigmaY/255/√samples`。
- 渲染器噪声已修，所有 `_frame.png` 为修后重跑。

---

## 二、新增：校准块位置标注 + 图例

- 新增 `viz/pngText.ts`（5×7 位图字体，PNG 编码器本身无文字能力）。
- `_calib.png` 三栏叠加**琥珀色参考灰块轮廓**，加标题（`RAW / NO CALIB / CALIB <mode>`）与图例（`OK` 绿 / `ERR` 红 / `CALIB BLOCK` 琥珀框）。
- **顺手修了一处更深的口径不一致**：右栏原先被强制 `"dense"`，但 M1 实际是 `four_corner` + `denseN=0`（强制 dense 时根本不产生校准块，等于没校准）。现右栏改用 `scheme.calibMode`（M1=四角、M3/M7=密集），与真实帧一致；M1 四角校准后 **0/432 误码**。

---

## 三、擂台赛 sub-13px 核查（「13px 以下跑没跑」）

`run_bakeoff` 对 M1–M7 **全跑**（含 M3=8 / M4=6 / M5=5 / M6=3），web_auto 最差信道：

| 方案 | cellPx | 解码成功率 | 判定 |
|---|---|---|---|
| **M3** | 8 | **0.9999** | 唯一可行的 sub-13px（净吞吐 4.42 bit/格） |
| M4 | 6 | 0.0000 | RS 救不回 |
| M5 | 5 | 0.0000 | 纯形状无校准，崩 |
| M6 | 3 | — | 判死（<5px） |

**结论**：
- **safe 默认仍锁 13px（M1，成功率 1.0）**。
- M3(8px) 留作好设备 fast 候选，待真机验证（仿真中校准读真值偏乐观）。
- M4/M5/M6 在 web_auto 下均不可用。

---

## 四、M1 形状用在哪

M1 形状 = 4bit 符号 / 8×8 点阵（最小汉明距离 **29**，`gen_symbols.ts` 离线生成，已接 `npm run gen:symbols`）：
- **仿真解码**：`decodeSymbolCell` 汉明距离匹配（`received ^ symbols[s]`）。
- **可视化**：`renderCapturedFrame` 画 8×8 点阵（`_frame.png` 可见）。
- 注：`_calib.png` 左栏「原始带梯度」只画颜色不画形状——要看形状得看 `_frame.png`。

---

## 五、脚本使用须知

- 两脚本写入方式不同：`run_bakeoff` 整文件覆盖，`run_color_bakeoff` 仅追加 section 6。
- **正确顺序先跑前者再跑后者**；单独重跑前者会清掉 section 6（可视化图）。建议后续合并成幂等脚本。

---

## 六、待元宝拍板的决策点

1. 是否同意 **safe=13px / M3 作 fast 候选** 的档位策略？
2. 音频反馈本期**不实现**、仅协议层预留——是否同意？（喷泉码收够即停，ARQ 价值已被大幅削弱）
3. 真机前是否先以 `calibration/photos/` 三组照片做解码器离线回归？

---

## 七、背景约束（供元宝参考）

三组实测标定：

| 组 | 设备 | σ_PSF | d_rec | 说明 |
|---|---|---|---|---|
| 原生相机 | 华为 Mate50E | 0.52 | 3 | 上限 |
| 网页锁定 | Android+Edge | 1.03 | 5 | 典型 |
| 网页自动 | 华为浏览器 | 2.78 | 13 | 最差包络 |

- 单元尺寸按**最差包络 13px 起步**，好设备经信道估计后降到 5px；像素级 3×3 子格在所有网页端配置下均不可行。
- **存在非径向亮度梯度**（实测四角 0.25/0.20/0.49/0.43，下方更亮），径向暗角模型失效，必须局部归一化或相对匹配。
- 网页端 `getUserMedia` 输出传感器原生方向，存帧为「躺倒」竖图，解码端需做旋转自适应。
- 本期技术栈：Vite + React 18 + TS + Tailwind；纯 TS/JS 自写图像处理，**不引入 OpenCV.js**；RS(255,k) + 网格交织 + 循环播放收够即停；部署走 EdgeOne Pages（HTTPS，getUserMedia 前置条件）。
