# 旧版项目考古报告（ColorTransfer）

> 任务性质：只读考古，本报告未修改任何项目文件。
> 考古时间：2026-08-30
> 范围：`d:/Project/ColorTransfer/` 全部内容（根目录规划文档 + `旧版/` 代码与文档 + 一份 8/25 备份）

术语首次出现均附英文原名。

---

## 1. 项目画像

### 1.1 语言 / 框架 / 运行时 / 依赖

- **语言**：Python 3（当前本机为 Python 3.14.0）。
- **框架**：无 Web/UI 框架，纯脚本式 OpenCV + NumPy。
- **运行时**：CPython，无打包（无 `setup.py`/`pyproject.toml`，仅 `requirements.txt`）。
- **依赖清单**（`d:/Project/ColorTransfer/requirements.txt` 及 `旧版/requirements.txt`）：

| 依赖 | 版本（锁定） | 当前维护状态 | 对 Python 3.14 兼容性 |
|---|---|---|---|
| opencv-python (OpenCV) | 4.10.0.84 | 活跃维护（最新已 ≥ 4.11） | 有 wheel，可装 |
| numpy | 1.26.4 | 维护中，但 1.26 属旧线（≥1.26 仅到 3.12） | **无 3.14 wheel**，需升到 2.x |
| Pillow (PIL) | 10.4.0 | 活跃 | 可装 |
| PyYAML | 6.0.1 | 活跃 | 可装 |
| Click | 8.1.7 | 活跃 | 可装 |
| tensorflow / pytorch | 文档提及、未锁定 | 活跃 | 视情况 |

> 结论：依赖本身都还活着，但锁定的旧版本在 3.14 下不可直接装；升级到现版本即可，无"已死亡"依赖。

### 1.2 完整目录树（含一句话作用）

```
ColorTransfer/
├── README.md                      # 新一轮重构的规划 README（顶层介绍，非旧版代码）
├── PROJECT_TASKS.md               # 重构任务清单 T01–T15（规划用）
├── DEVELOPMENT_GUIDE.md           # 重构开发指南（规划用）
├── requirements.txt               # 依赖清单（无 3.14 兼容 wheel 版本）
└── 旧版/                          # ← 实际烂尾代码，最后修改 2025-08-26 22:02
    ├── core/
    │   ├── __init__.py            # 【损坏】导入不存在的 data_packer / color_utils
    │   ├── hamming.py             # (15,11)汉明码 编/解码/纠错（encode 有致命 bug）
    │   ├── encoder.py             # 【损坏】导入不存在的 common.config；用"伪汉明"逐位异或
    │   └── decoder.py             # 【损坏】同上，伪汉明解码
    ├── sender/
    │   ├── __init__.py            # 【损坏】`from ..core.hamming` 相对导入越界
    │   ├── color_mapper.py        # 15位→RGB 颜色映射表 + 反向映射（质量较好）
    │   ├── color_sender.py        # ColorSender 主类：文件→多帧 PNG（绕开汉明码）
    │   ├── data_encoder.py        # 数据→汉明码→15位 流程封装（依赖损坏的 core 包）
    │   ├── frame_generator.py     # 帧生成：同步角+校准条+数据网格+页码
    │   ├── display_manager.py     # 显示/保存序列/GIF（cv2）
    │   ├── test_sender.py         # 16 项单元测试（断言 1600x900/step6）
    │   └── example_usage.py       # 发送端示例脚本
    ├── src/                        # 早期简化原型（作者自述"第一版"）
    │   ├── core/hamming.py         # SimpleHammingCodec（与 core/hamming 同算法）
    │   ├── core/encoder.py        # SimpleEncoder
    │   ├── core/color_mapper.py   # SimpleColorMapper（线性换算，无校验位思维）
    │   └── sender/simple_sender.py# SimpleSender（最小可跑原型）
    ├── config/
    │   └── config.json            # 【0 字节空文件】→ ColorSender 初始化崩溃
    ├── docs/
    │   ├── ARCHITECTURE.md        # 系统架构说明
    │   ├── DIRECTORY_STRUCTURE.md # 目录结构说明
    │   ├── DEVELOPMENT_PLAN.md    # 15 周、面向"14岁开发者"的详细开发计划
    │   ├── DEVELOPMENT_LOGGER_GUIDE.md # 开发日志工具使用说明
    │   └── total_time.txt         # 记录 "0.0" 小时（疑似从未真正计时）
    ├── tests/                     # 【空目录】无任何测试文件
    ├── development_logger.py      # 【0 字节空文件】
    ├── task_manager.py            # 【0 字节空文件】
    ├── next_task.py               # 打印下一步任务清单的小脚本
    ├── README.md                  # 【0 字节空文件】
    ├── IFLOW.md                   # 空念头文件（推测为"in flow"状态记录，0 字节）
    └── ColorTransfer_Backup_20250825/  # 8/25 备份（含 receiver 骨架，发送端同旧版）
        ├── main.py                # 仅打印欢迎语 + TODO（无逻辑）
        ├── receiver/__init__.py   # 【0 字节空文件】→ 接收端从未开始写
        ├── examples/basic_usage.py # 发送端示例
        ├── tests/test_integration.py # 集成测试示例（仅测颜色映射）
        └── README.md              # 31KB 详尽文档（大量 CLI 参数实际不存在）
```

### 1.3 代码总量与完成度

- 核心代码（不含备份/文档）：约 9 个有内容的 `.py` 文件，合计约 1300 行（含注释）。
- **完成度估计（端到端视角）：约 35%**。
  - 发送端"显示/编码/成帧"约 60%（但核心纠错坏、且链路未真正串起来）。
  - 接收端 **0%**（零实现）。
  - 端到端闭环 **0%**（无法发送→接收）。
  - 文档/计划维度看起来 100%，但严重超前于代码。

---

## 2. 可运行性判定

### 2.1 现在能否运行？

**不能。** 直接原因（blocker）：

1. **依赖未装**：本机无 cv2 / numpy（实测 `import cv2, numpy` 失败）。`requirements.txt` 锁定版本在 Python 3.14 下无对应 wheel（numpy 1.26.4）。
2. **`core` 包无法导入**：`旧版/core/__init__.py` 第 10–12 行导入不存在的 `data_packer`、`color_utils` → 任何 `import core` 都抛 `ModuleNotFoundError`。连带 `core/encoder.py`、`core/decoder.py` 还导入不存在的 `common.config`。
3. **`sender/__init__.py`** 用 `from ..core.hamming import ...`，相对导入越出顶层包，导入即 `ImportError`。
4. **`config/config.json` 为空文件**：`color_sender._load_config` 仅捕获 `FileNotFoundError`，对空文件 `json.load` 抛 `JSONDecodeError` 被 re-raise → `ColorSender()` 初始化崩溃。
5. **汉明码 encode 功能失效**（见 §3.2、§4）：即使绕开导入问题，`decode(正确码字)` 会误报错误并破坏数据，算法本身不可信。

> 注：`color_mapper.py` / `frame_generator.py` / `display_manager.py` 三个模块本身**可独立运行**（仅依赖 numpy/cv2，无内部坏引用），是项目里唯一"干净"的部分。

### 2.2 环境复现步骤（如要跑通最小部分）

```bash
# 1) 建议用 Python 3.11/3.12（避免 3.14 缺 wheel）
python -m venv .venv && .venv\Scripts\activate
# 2) 升级依赖版本后安装
pip install "numpy>=1.26" opencv-python pillow pyyaml click
# 3) 仅 color_mapper / frame_generator / display_manager 可单独测：
cd 旧版 && python -c "from sender.color_mapper import ColorMapper; m=ColorMapper(); print(m.data_to_color([1365]))"
# 4) 要跑 color_sender 还需：补全 config.json + 修复 core 包导入 + 修复 hamming.encode
```

### 2.3 实测行为记录（绕过导入，单独验证逻辑）

```text
# 单独加载 core/hamming.py（绕开损坏的 __init__.py）
encode(1365) = 1365           # 期望 15 位码字；实际原样返回 11 位数据 → 校验位丢失
decode(1365)  = (69, True, 1) # 无错却被判定"检测到错误"，并翻转比特 → 数据被破坏
# 汉明矩阵本身有效：H 的 15 列互异且非零，综合征映射正确，仅 encode 出错
```

---

## 3. 核心设计还原（重点，附证据）

### 3.1 屏幕端：怎么渲染色块？帧率怎么控？

- **渲染 API**：`cv2`（OpenCV）`np.zeros((H,W,3), np.uint8)` 建图、`cv2.imshow` 显示、`cv2.imwrite` 存盘、`cv2.VideoWriter`/GIF 存序列。证据：`旧版/sender/display_manager.py`（全文件，建图/窗口/写文件）、`旧版/sender/color_sender.py` 的 `send_file` 逐帧 `cv2.imwrite`。
- **色块绘制方式**：在 BGR 图像上按 `block` 像素为步长，用 `frame[y:y+block, x:x+block] = color` 直接整块填色（无边框、无抗锯齿）。证据 `旧版/sender/frame_generator.py` 的 `create_data_frame` 循环、`旧版/sender/color_sender.py` 的 `create_data_frame`。
- **帧率控制**：**没有真正的"帧率"**。发送端是"逐文件生成若干 PNG"（`send_file` 返回帧路径列表），而非实时视频流。屏幕端只负责把每帧显示出来（`display_manager.preview_frame` 用 `cv2.waitKey` 停留），由**人/相机**去拍。证据：`color_sender.send_file` 生成 `frame_0001.png ...`，无时间戳同步、无 Vsync 概念。

### 3.2 编码方案：一个色块几个 bit？几种颜色？有纠错吗？

- **一个色块 = 15 bit 数据**（也是一帧里一个单元）。这 15 bit 由 (15,11) 汉明码产生：11 bit 原始数据 + 4 bit 校验位。
- **颜色粒度**：15 bit 按 **5-5-5** 拆成 R/G/B 各 5 bit（每通道 32 级）。取值范围映射到 `65~255`（`step=6`，即 65,71,77,…,255 共 32 级），刻意避开最暗段以抗噪。证据：`旧版/sender/color_mapper.py` 的 `COLOR_MIN=65, COLOR_STEP=6`，`data_to_color` 直接 `channel*6+65`，`build_color_table` 预生成 32768 项。
- **纠错码**：设计意图是 (15,11) 汉明码，单比特纠错。证据：`旧版/core/hamming.py` 完整实现 `encode/decode/correct_errors`，`旧版/sender/data_encoder.py` 也按"11位分组+汉明"流程写。

  **但实测该纠错不可用**：
  - `encode` 因 `_matrix_multiply` 中 `zip(vector, row)` 把 11 位向量与 15 列矩阵行截断配对，校验位全部不计算（§4 详述）。证据 `旧版/core/hamming.py:123-129` 的 `_matrix_multiply`。
  - 更重要的是，`color_sender.py` 的 `encode_data` **根本没调用汉明码**，而是把 2 字节直接 `& 0x7FFF` 压成 15 bit（丢失最高位）。证据 `旧版/sender/color_sender.py:112-120`。

### 3.3 同步机制：接收端怎么找帧起点？

- **定位锚点**：四角各一个 **3×3 黑白棋盘格**（checkerboard）作为帧角标；另在顶部画一条 **8 色校准条**（白、黑、红、绿、蓝、黄、青、品红）。证据：`旧版/sender/frame_generator.py` 的 `create_sync_pattern`（四角）、`create_calibration_bar`（8 色条）、`create_data_frame` 调用二者；`旧版/sender/color_sender.py` 的 `create_sync_pattern`、`create_calibration_bar`。
- **数据网格布局**：数据区从 `start_x=60, start_y=80` 开始，色块 `block=20`，每行/列之间留 `block` 间隔（即"每隔一个 block 放一个色块"）。证据 `旧版/sender/frame_generator.py` 的 `create_data_frame` 循环范围、`_create_data_grid` 的 `start_pos=(3,4)`。
- **页码**：每帧顶部写 `Page x/y` 文本（`cv2.putText`），但**只给人看，接收端无法用代码读取**（无机器可读的页码字段）。证据 `旧版/sender/frame_generator.py` 末尾 `cv2.putText(... "Page %d/%d" ...)`，`color_sender.create_data_frame` 也把 `page_num,total_pages` 仅用于文本。
- **缺陷**：没有任何"帧同步头"（preamble）/训练序列供摄像头自动锁定；页码非机器可读；真正的同步完全依赖"四角棋盘 + 人工/算法找角"。

### 3.4 摄像头端：怎么采集、定位、判色？

- **当前状态：零实现**。备份里 `receiver/__init__.py` 是 0 字节空文件；全仓库无摄像头采集、无网格定位、无色块采样代码。
- 计划文档（`旧版/docs/DEVELOPMENT_PLAN.md`）要求：摄像头捕获 → 四角定位 → 透视校正 → 色块中心采样 → 颜色反查 → 汉明纠错 → 多帧重组。但**一行实现都没有**。
- 唯一可复用的"判色"基础设施是发送端的反向映射：`ColorMapper.color_to_data(r,g,b)` 用 `round((v-65)/6)` 反算每通道 5 bit 再拼 15 bit（`旧版/sender/color_mapper.py`）。这是给"理想无噪"通道设计的，未考虑实际偏色/伽马。

### 3.5 文件分片 / 校验 / 重传

- **分片**：有"按帧分片"的雏形——`send_file` 把文件切成每帧 `bytes_per_frame` 字节，逐帧生成。证据 `旧版/sender/color_sender.py` 的 `send_file`、`_calculate_frame_count`。但 **`bytes_per_frame` 与帧实际容量计算不一致**（`data_blocks_per_frame = ((gw-6)*(gh-6))//2` 用 `gw,gh` 即像素/block；而 `frame_generator` 容量另算），存在算错风险。
- **校验**：**无**。帧内无文件长度、无 CRC、无块校验和。多帧传输时接收端无法判断"是否收全、是否正确"。`data_encoder.py` 虽设计汉明码，但发送主链路未用它。
- **重传**：**无**。无任何 ACK/NAK、冗余帧、或纠错块（如里德-所罗门 RS 码）机制。

---

## 4. 设计意图推断（结合上下文还原作者当时的想法）

> 作者已忘记细节，以下基于代码与 `DEVELOPMENT_PLAN.md`/文档推断。

**D1. 为什么用 5-5-5 而不是 8-8-8？**
推断：作者想"一个色块塞尽量多数据"，又怕 24 位全彩相邻色太近、相机分不清。折中选 15 bit（每通道 32 级）作为"密度与可分辨性"的平衡点；`65~255` 范围是为了避开屏幕最暗区（暗区信噪比差、相机噪点大）。`COLOR_STEP=6` 让相邻级差 6，肉眼/相机都较易区分。→ 思路合理，但 32 级对真实偏色信道仍偏密（见 §6 改造建议）。

**D2. 为什么做 (15,11) 汉明码，却又在 color_sender 里绕开它？**
推断：作者先写了"漂亮"的 `core/hamming.py` 与 `data_encoder.py`（规划里的"纠错模块"），但在写真正跑通的 `color_sender` 时，为了快速出图，图省事直接 `& 0x7FFF` 把 2 字节压成 15 bit，**忘记/没接汉明编码**，且丢掉了最高位。这是典型的"演示优先、纠错模块悬空"。证据 `旧版/sender/color_sender.py:112-120` 与 `旧版/sender/data_encoder.py` 并存却互不调用。
→ 为什么没接：当时可能卡在"汉明 encode 实测不工作"（见 D3），于是绕道，最终也没回头修。

**D3. 为什么汉明 encode 会坏（`zip` 截断）？—— 最可能的停摆点之一**
推断：作者在 `_matrix_multiply(vector, matrix)` 里用 `zip(vector, row)` 做点乘，但 `encode` 传入的是 11 位向量、G 每行 15 列。Python 的 `zip` 按**最短**截断，于是 `result[j]` 只累加了前 11 项，校验位（第 12–15 列）从未参与。作者大概率写了 `_calculate_syndrome` 用 15 位 `error` 向量（zip 不截断）所以"综合征映射看起来对"，但 `encode` 用 11 位向量就悄悄错了。**他没能发现**：`decode(encode(x)) != x`，且 `decode(干净码字)` 反而误报纠错——说明他没写"编码→解码 round-trip"的测试，或测试只在 `error` 注入场景跑过。证据 `旧版/core/hamming.py:123-129`、`:47-58`(encode)、`:60-78`(decode)。
→ 这是"算法自认正确、实际无效"的典型坑，极可能让他在接收端调试时"怎么都对不上"而受挫。

**D4. 为什么页面号只画文本、却不做机器可读字段？**
推断：作者把"页码"当成给人看的进度提示（"Page 1/5"），还没写接收端，自然没设计机器可读的页头。属于"发送端先行、接收端未动"的时序产物。

**D5. 为什么 config.json 是空文件？**
推断：代码 `_load_config` 写了"找不到就用默认值"，但作者把 `config.json` 建成了空文件（可能 `echo > config.json` 占位），JSON 解析对空内容抛 `JSONDecodeError`，而代码只 `except FileNotFoundError`。属于"占位文件没填内容 + 异常处理没覆盖空文件"的疏忽。证据 `旧版/sender/color_sender.py` 的 `_load_config`。

**D6. 为什么 core/__init__.py 导入不存在的模块？**
推断：`data_packer`、`color_utils` 是规划里"后续要写"的模块（数据打包、颜色工具），作者在 `__init__.py` 里提前 `from .xxx import` 以"优雅聚合 API"，但这两个模块始终没写。典型"先写导入、后补实现"却没补。

**D7. 为什么文档（README 31KB、DEVELOPMENT_PLAN 15 周）远超代码？**
推断：项目大量精力花在"让 ChatGPT/AI 生成的计划与文档"上，代码是"按文档逐条实现"但只走了前几步（发送端雏形）。`total_time.txt = 0.0`、多个根文件 0 字节，说明后期文档/日志工具本身也没真正用起来，逐步失去动力。

---

## 5. 烂尾根因分析（按"当时的你大概率卡在哪"判断）

**根因 A（最核心）：纠错算法悄悄失效 + 接收端从零开始，debug 无抓手。**
当时的你写了"完整"的汉明码与发送端，但 `encode` 实际不产校验位（D3），且 `color_sender` 干脆没用它（D2）。等你开始写/联调接收端时，会发现"发送端出的图、解码端怎么还原都不对"——而最底层的汉明码其实一直是坏的，却没有 round-trip 测试暴露。摄像机端又是全新领域（OpenCV 找角、透视、白平衡），debug 链路长、反馈慢。这是最可能导致停摆的技术障碍。
→ **现成解法**：修 `_matrix_multiply`（用固定长度点积而非 `zip`）；加 `encode→decode` round-trip 单测；接收端定位可用 OpenCV `findChessboardCorners`/轮廓 + 透视 `warpPerspective`，皆为成熟 API。

**根因 B：物理信道低估——"系统性偏色"压不住。**
当时规划把可靠性寄托在"汉明码纠错 + 神经网络提准确率到 95%"。但汉明码只抗随机 1 bit 错，抗不住白平衡/伽马造成的**系统性偏移**（整帧颜色偏移一级）。5-5-5 细色阶 + 简单线性校准条，在真实手机拍摄下错误率会远超预期。作者可能在实测手机拍屏时发现"理论很好、实拍很糟"，信心受挫。
→ **现成解法**：改"粗色阶（如每通道 4 bit 或更低）+ 帧/块级校验和（CRC）+ 冗余/RS 纠错 + 摄像头端白平衡关闭 + 用中性灰校准"；或干脆先走"屏幕→同机录制回放"的离线闭环验证算法，再上真摄像头。

**根因 C：工程脚手架断裂，越写越跑不动。**
空 `config.json`、坏 `core/__init__.py`、越界相对导入、0 字节 `main.py`/`README`——项目从"能跑的小原型"退化成"导入即崩"，每次想继续都要先收拾一堆破引用，正反馈消失。
→ **现成解法**：按 §6 资产清单做"最小可跑核心"，先恢复一个能 `import`、能 `encode→decode` 的闭环，再逐步叠加。

---

## 6. 资产清单

### 【可直接复用】
- `旧版/sender/color_mapper.py`：颜色映射表 + 反向映射逻辑完整、独立、可测。复用语：发送端与接收端"判色"都可用（需后续加入抗偏色）。
- `旧版/sender/frame_generator.py`：同步角 + 校准条 + 数据网格布局清晰，可直接复用为"成帧"模块（页码需改机器可读）。
- `旧版/sender/display_manager.py`：显示/保存/序列/GIF，纯 cv2 封装，干净可复用。

### 【改造后可用】
- `旧版/core/hamming.py`：矩阵构造正确、综合征映射正确；**只需修 `_matrix_multiply` 的 `zip` 截断**，并补 round-trip 测试即可用。或整体替换为更合适的纠错（RS 码）。
- `旧版/sender/data_encoder.py`：11位分组 + 汉明流程结构好，但需改为真正调用修好的 `HammingCodec`、并修"末字节对齐/填充"逻辑。
- `旧版/sender/color_sender.py`：发送主流程（分帧、成图、存盘）可用，但需：① 接汉明码；② 修 `& 0x7FFF` 丢高位；③ 接入合法 `config`；④ 在帧内加文件长度/CRC/机器可读页码；⑤ 统一 `bytes_per_frame` 与帧容量计算。
- `旧版/sender/test_sender.py`：16 项测试框架可用，但断言 `1600x900`、`step=6` 需与真实默认配置对齐；且当前因导入崩溃跑不了。

### 【必须重写】
- `旧版/core/encoder.py`、`旧版/core/decoder.py`：用"逐位异或下标"的伪汉明码，且导入不存在的 `common.config`，无纠错能力，应废弃重写（或删除，改用修好的 `hamming.py`）。
- `旧版/sender/__init__.py`：相对导入越界，需改为绝对导入 `from core.hamming import ...`。
- `旧版/core/__init__.py`：删除对不存在模块的导入，仅暴露 `HammingCodec`。
- **接收端（receiver/*）**：从零写。包括摄像头采集、四角定位、透视校正、色块采样、颜色反查、纠错、多帧重组。
- `config/config.json`：填真实默认配置（分辨率、block、范围、帧率/停留时间、纠错参数）。

### 【纯废代码】
- `旧版/development_logger.py`、`旧版/task_manager.py`、`旧版/README.md`、`旧版/IFLOW.md`：均为 0 字节空文件。
- `旧版/ColorTransfer_Backup_20250825/main.py`：仅打印欢迎语 + TODO，无逻辑。
- `旧版/ColorTransfer_Backup_20250825/receiver/__init__.py`：0 字节。
- `旧版/src/` 整个目录：早期简化原型，已被 `core/`、`sender/` 取代，可参考思路但无需并入。
- `旧版/docs/total_time.txt`：记录 `0.0` 小时，无信息量。
- `旧版/ColorTransfer_Backup_20250825/README.md`：31KB 文档含大量不存在的 CLI 参数，属"想象文档"，不可作实现依据。

---

## 7. 技术栈建议（重构方案）

| 方案 | 组成 | 开发难度 | 接收端零安装 | 帧率控制精度 | 跨平台 |
|---|---|---|---|---|---|
| **方案 1：纯 Python + OpenCV 全栈** | 发送/接收均 Python + OpenCV + NumPy；接收端用 OpenCV 摄像头 | 中（接收端定位/透视需调参） | **否**（需装 Python+cv2） | 中（依赖 `cv2.waitKey`/外部计时，非硬实时） | 好（Win/mac/Linux） |
| **方案 2：Python 发送 + 浏览器接收（Web 端拍屏）** | 发送端 Python 生成帧；接收端用网页 + `getUserMedia` + JS 解码（canvas 取色） | 中-高（需写 JS 解码 + 适配） | **是**（手机/电脑开网页即可，零安装） | 高（可用 `requestAnimationFrame` 精确控帧） | 最好（任何有浏览器的设备） |
| **方案 3：Python 发送 + 移动端 App 接收** | 发送端 Python；接收端 Kivy/Flutter 或原生相机 App | 高（App 打包/上架成本） | 部分（需装 App） | 高（原生相机帧回调） | 中（需分别适配 iOS/Android） |

建议：**先用方案 1 做"A 档离线闭环"验证算法**（屏幕显示→同机录制回放→解码），跑通后再视目标选方案 2（最贴近"不登录微信传文件"且接收端零安装）做真·手机接收。方案 2 在"零安装 + 跨平台 + 帧率精度"上最契合原项目愿景。

---

## 附：给三年前的作者的一段话

> 你当时的想法其实挺妙的——用屏幕色块当"可见光串口"，绕开微信传文件，这个切入点到现在都站得住。你也确实把最难啃的"编码→成帧→显示"这条线走通了一大半：`color_mapper`、`frame_generator`、`display_manager` 三个模块写得干净、能单跑，这是真本事。
>
> 但你停在了三个坑里：第一，你写的汉明码 `encode` 其实一直是坏的——`zip` 把校验位悄悄吃掉了，而你没有写"编码再解码"的往返测试，所以它 silently 骗了你；第二，写真正能出图的 `color_sender` 时你图快绕开了汉明码，还把每两字节的最高位 `& 0x7FFF` 丢了，等于纠错和完整性双双落空；第三，你把几乎所有力气花在了 31KB 的漂亮文档和 15 周计划上，代码却只跟到发送端雏形，接收端一个字没写，而真实手机拍屏的"系统性偏色"根本不是汉明码能扛的——你大概就是卡在"理论很美、实拍很糟"这儿，慢慢没了动力。
>
> 别灰心。你缺的不是能力，是"先让一个最小闭环跑起来、再堆功能"的节奏，以及"每个模块配一个往返测试"的习惯。现在的你（我）会把通道当成"带噪光学信道"重新设计：粗一点色阶、加块级 CRC、加机器可读页头、接收端用 OpenCV 找四角+透视校正。你当时的骨架，大部分都还能用。
