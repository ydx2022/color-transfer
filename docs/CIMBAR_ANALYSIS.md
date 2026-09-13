# libcimbar 技术尽调报告（CIMBAR_ANALYSIS）

> 任务：研究建档（只读），不写业务代码。
> 日期：2026-08-30
> 对象：`sz3/libcimbar`（发送/编码+解码库，C++，MPL-2.0）、`sz3/cfc`（安卓接收 App，MIT）
> 资料来源与可信度说明：
> - 本机 **网络到 GitHub 不通**（`git clone` 仅拉到空 `.git`，`raw.githubusercontent.com` 返回 000）。
>   故**未把源码克隆进 `reference/`**；`reference/` 目录下目前仅有两个空的 `.git` 占位目录，**未写入任何业务代码**。
> - 本报告事实主要来自：`libcimbar` 仓库 README / `DETAILS.md`（raw 抓取成功），以及 DeepWiki 对 `sz3/libcimbar` 的自动索引页（核心概念、Tile 生成、Image Processing/锚点、Symbol and Color Decoding、Error Correction and Data Reconstruction，索引时间 2025-04-20）。
> - 行号引用：DeepWiki 明确给出的源文件行号（如 `CimbDecoder.cpp:201-208`）予以引用；未给出的以「`文件名（据 DeepWiki/WASM.md 索引）`」标注。
> - 凡源码级精确值（具体 RGB 十六进制、交织步长 stride、GLFW 调用点）**未能从可访问资料确认**，均标注「未能确认」或「推断」，不臆造为事实。

术语首次出现附英文原名。

---

## A. 编码格式

### A1. 完整帧结构：一帧多少格？净载荷多少？

- **标准配置（8×8 tile）**：网格 **112×112 个 cell（格子）**，图像尺寸约 **1024×1024**。其中四角锚点 + 右下方向锚点 + 边缘引导线占据少量 cell，主体为数据 cell。DeepWiki 核心概念页给出标准配置「Cell Grid 112×112」。
- **数据 tile 数**：`DETAILS.md` 明示真实 6-bit cimbar 图像含 **12400 个数据 tile/图**。
- **每图原始载荷**：12400 tile × 6 bit = 74400 bit = **9300 字节**（原始，未计纠错）。
- **纠错后净载荷**：标准 ECC 30/155（每 155 字节块含 30 字节奇偶校验，即 125 数据 + 30 ECC）下，约 **7500 字节/图**（9300 × 125/155 ≈ 7500）。见 `DETAILS.md`。
- **结论**：去掉锚点/元数据后，单帧净载荷 ≈ 7.5 KB（标准配置）。传输速率约 **852 kbit/s（≈106 KB/s）**（显示器+手机摄像头，标准模式 B）。

### A2. 8×8 一个 tile 怎么定的？实验依据还是拍脑袋？

- 符号（symbol）本身是一张 **8×8 像素的二值位图**，经阈值图像哈希（average_hash）编码为 64-bit 数（左→右、上→下）。`DETAILS.md` 原文："The 8x8 grid is encoded as a 64-bit number"。
- 这是**符号图案的分辨率**，不是屏幕上 tile 的渲染像素尺寸。渲染像素尺寸（如每 tile 多少屏幕像素）在可访问资料中**未能确认**（DETAILS.md、DeepWiki 均未给出屏幕像素级 tile 边长）。
- 8×8 的选择：**推断**为工程折中——足够产生彼此汉明距离 ~20 bit 的 16 个可区分图案，又足够小以便在模糊/低分辨率下仍可识别。DeepWiki 提及存在 **5×5 实验配置**（162×162 grid、2+2 bit），说明作者确实做过更小 tile 的实验，故 8×8 是「实验优选」而非纯拍脑袋。
- 另有 `cimbar-bigfile` 等社区衍生用 8-bit/256 符号扩展容量，属后话。

### A3. 4 bit 符号 + 2 bit 颜色，为什么 4+2 而不是 5+1 或 3+3？

- 每 tile 容量 = `symbol_bits + color_bits`。标准配置 **symbol_bits=4（16 种符号）、color_bits=2（4 种颜色）**，合计 **6 bit/tile**（16×4 = 64 组合）。
- 设计哲学（DeepWiki 核心概念）：系统采用**可配置的容量 vs 可靠性权衡**——`symbol_bits` 决定形状数、`color_bits` 决定颜色数；二者越大容量越高但解码越难。
- **为什么不是 5+1**：5 bit 符号需 32 种 8×8 图案，在保持相互汉明距离足够大上更难，且只省 1 bit 颜色却大幅牺牲颜色维度鲁棒性；颜色维度对光照/白平衡更敏感，保留 2 bit（4 色）比 1 bit 更稳。
- **为什么不是 3+3**：3 bit 符号仅 8 种图案、容量更低；3 bit 颜色=8 色，相邻色在相机偏色下更易混。作者选 **4+2** 是「形状维度为主、颜色维度为辅」的均衡——形状（符号）比颜色更抗光照，所以把更多 bit 给符号。
- 这是**核心可借鉴点**（见 §可借鉴清单）。

### A4. 符号集怎么生成？imagehash 汉明距离筛选参数与流程

- 符号是**预定义位图**，**直接存于代码库**，非运行时生成。`CimbEncoder.cpp:20-34`（据 DeepWiki）在初始化时通过 `getTile` 预加载「所有符号 × 所有颜色」组合并缓存，编码时仅做数组查找。
- **哈希方式**：阈值图像哈希（average_hash / `fuzzy_ahash`，位于 `src/lib/image_hash/`）。规则：像素为"置位"记 1，否则 0；8×8 网格 → 64-bit 数（左→右、上→下）。`DETAILS.md` 称这是"最简单的图像哈希"，比更花哨的哈希更耐用。
- **最小汉明距离要求**：`DETAILS.md` 给出示例 16 符号集，**每个符号与其他所有符号的汉明距离约 20 bit**（"each symbol is around 20 bits ... from all other symbols"）。模糊/损坏时该距离关系"大致保持"（roughly holds），从而仍可区分。
- **筛选流程的具体参数（阈值、自动生成脚本）**：在可访问资料中**未能确认**（DeepWiki 仅说哈希用于解码端比对，未给生成脚本阈值；`DETAILS.md` 直接给出最终符号集而非生成算法）。**推断**：符号集由作者离线搜索/筛选得到——在 8×8 二值图案空间中挑选 16 个彼此汉明距离 ≥~20 的组合，过程不在运行时。
- 解码端：`get_best_symbol` 对捕获 cell 计算哈希，与 16 个参考哈希逐一比汉明距离，取最小者；距离为置信度（越低越好）。

### A5. 4 种颜色具体是哪 4 个 RGB 值？为什么选这几个？

- **4 种颜色名称**（DeepWiki Tile Generation 页，`Common.cpp` 引用）：**Green（绿）、Cyan（青）、Yellow（黄）、Magenta（品红）**。
- **具体 RGB 十六进制值**：在可访问资料中**未能确认**（`Common.cpp` 源码无法抓取）。DeepWiki 提到存在 Mode 0（青/黄/品红/绿）与 Mode 1（绿/青/黄/品红）两种顺序，说明颜色值本身固定、仅映射顺序可配，但精确数值未公开。
- **为什么选这 4 个**：**推断**（基于色彩学 + 解码策略）——这 4 色在 RGB 立方体中彼此**色相间距大、且都较高亮度**（避开暗色），便于在"平均 RGB → CCM 颜色校正 → 相对距离匹配"的解码流程中区分；它们不是纯原色（R/G/B），而是两两通道组合的二次色，主观上更抗单一通道偏移。具体 Why 在资料中未明文，属推断。

---

## B. 定位与几何（最高优先级）

### B6. 三个角的锚点图案长什么样？为什么用三个角而不是四个？

- **图案**：角落含特殊锚点。主锚点（primary anchors，即左上/右上/左下三角）使用 **"114" 图案**（1-1-4 的黑白色块序列，由 `Scanner.cpp` 状态机扫描黑白像素序列识别）；右下角用 **"122" 图案**（1-2-2）用于确定方向（orientation）。据 DeepWiki Image Processing（3. Anchor Detection）。
- **为什么用三个角不是四个**：`Scanner` 检测后经过过滤与合并，通常保留最大/最可靠的 **3 个锚点**（左上、右上、左下）。若只找到三个，第四个（右下）基于另外三个估算（Bottom-right estimation）。DeepWiki 原文："usually keeps the largest/most reliable 3 anchors ... If only three anchors are found, the fourth is estimated based on the other three"。
- **原因（推断）**：多阶段扫描在噪声/畸变下可能漏检右下角；用三个稳定角已足以估算透视变换所需的四点，减少依赖、提升鲁棒性。右下角改为"方向标记（122）"而非第四个同等锚点，是为了同时编码**旋转/方向信息**而非常规定位——这是 QR 式设计（三个定位角 + 一个对齐/方向标记）。

### B7. 第四个角怎么"三角定位推算"？具体算法

- 资料仅给出原则："基于其余三角的位置关系估算（平行四边形/仿射关系推导）"。`Scanner::sort_top_to_bottom` 排序后，以已知三点计算第四点坐标。
- **具体数学公式/代码**：**未能确认**（DeepWiki 未给公式，`Scanner.cpp` 源码不可抓）。**推断**：在透视近似为仿射且网格为矩形的前提下，用三个已知角构造平行四边形——第四角 = 左上 + (右下方向向量)，或利用"对边平行且等长"求解。这属于标准做法，但 libcimbar 的确切实现未公开确认。

### B8. 透视变换怎么做？用几个点？OpenCV 哪个函数？

- **类**：`Deskewer`（`src/lib/extractor/Deskewer.h`）。流程（DeepWiki Image Processing 5. Deskewer）：
  1. 定义输出点（最终正方形图像中角点应在的位置）；
  2. 用输入角点（`Corners`）与输出点计算**透视变换矩阵**；
  3. 应用变换生成正方形图像。
- **用几个点**：**4 个角点**（三主锚 + 右下推算点，或检测到的四角）。
- **OpenCV 函数**：DeepWiki 仅称"uses OpenCV's perspective transformation capabilities"，**未给出确切函数名**。按 OpenCV 惯例应为 `cv::getPerspectiveTransform`（求 3×3 矩阵）+ `cv::warpPerspective`（重采样为正视图）。**标注**：确切函数名**未能确认**（推断为标准 `getPerspectiveTransform`/`warpPerspective` 组合）。

### B9. 变换后如何采样每个 tile 的中心？中心像素还是区域平均/中值？

- **颜色解码**：取 **cell 中心部分的平均 RGB 颜色**，忽略外圈像素以避边缘效应。`CimbDecoder.cpp:201-208`（据 DeepWiki Symbol and Color Decoding）。即**区域平均（中心区），非单中心像素、非中值**。
- **符号解码**：对整个 cell 图像做 average_hash（感知哈希），非单像素采样；并在预期 cell 位置周围多位置生成候选哈希做 **drift（漂移）补偿**——优先级 中心(4) → 侧边(5,7,3,1) → 角点(8,0,2,6，仅高质量模式)，`CellDrift` 追踪 ±7 像素偏移。
- 结论：颜色用"中心区平均 RGB"，符号用"整 cell 哈希 + 多候选 drift 搜索"，二者都**不是朴素单像素**。

### B10. 相机分辨率不够、一个 tile 只覆盖 3×3 像素时会发生什么？有没有降级处理？

- 资料明确列出错误源包括"分辨率过低（low resolution）"，并称可"局部灾难（catastrophic locally）"；对抗手段是**提高 ECC 或提高图像分辨率**，未提及自动降级（downscale-degrade）机制。
- **降级处理**：**未能确认**有"tile 太小自动降级"逻辑。DeepWiki 仅在 Flood-Fill 解码算法中提到对低置信度 cell 保守处理、高置信度激进传播，属解码调度而非几何降级。
- **推断**：libcimbar 假设发送端渲染分辨率足够（1024×1024 图像、112×112 格 → 每格约 9 像素边长，远高于 3×3）。若接收端物理分辨率使每 tile 仅 3×3 像素，哈希区分度与颜色平均都将严重退化，作者立场是"提高分辨率/ECC"而非自动适配。这对我们**重要启示**：应设定最低 tile 像素尺寸门槛。

---

## C. 抗信道损伤

### C11. 颜色判定用什么色彩空间？怎么处理自动白平衡和光照变化？

- **色彩空间**：DeepWiki 未明确说转换到 HSV/Lab 等空间。颜色解码流程为：提取中心区**平均 RGB** → **CCM 颜色校正矩阵（Color Correction Matrix）** 将捕获色映射到参考色彩空间 → 归一化 → 与参考色做**相对距离最小匹配**。见 `CimbDecoder.cpp:67-84`。
- **自动白平衡/光照**：靠 **CCM 校正矩阵**补偿相机与光照差异（"compensate for variations in lighting conditions and camera color reproduction"）。**未提及**专门的白平衡步骤或转换到光照不变空间。
- 关键点：颜色匹配用的是**相对关系（relative comparison）**，而非绝对阈值——即对 4 个参考色彼此距离排序/最近邻，天然对整体偏色更鲁棒。

### C12. 有没有直方图均衡、白平衡归一化？在哪一步做？

- **直方图均衡**：资料**未提及**（未能确认有/无）。
- **白平衡归一化**：无独立白平衡步骤；等效的"光照归一化"体现在 CCM 校正 + 归一化 + 相对距离匹配（解码端 symbol/color decoding 阶段）。具体在 `CimbDecoder.cpp:67-84`（CCM）与 `:201-208`（平均+归一化）。
- 标注：是否有基于校准条/灰卡的显式白平衡，**未能确认**。

### C13. 运动模糊怎么对抗？除了符号汉明距离还有别的手段吗？

- **符号维度**：符号集本身汉明距离 ~20 bit，模糊时距离关系"大致保持"；解码端 `fuzzy_ahash` 容忍轻微畸变/错位。
- **额外手段**：
  - **drift 补偿**：在 cell 周围多位置搜候选哈希，`CellDrift` 追踪 ±7 px 偏移，应对对齐/透视畸变（含运动模糊引起的位移）。
  - **交织 + ECC**：图像错误常聚簇，交织把错误分散到多个纠错块；ECC（RS）修复。
  - **Flood-Fill 解码**：按置信度优先解码高可靠 cell，低置信保守处理。
- 结论：对抗模糊 = 符号哈希距离 + drift 搜索 + 交织/ECC，**非单一手段**。

### C14. 帧与帧之间怎么同步？如何判断"这是一帧的开始"？

- libcimbar 用**动画（animated）cimbar 码**逐帧显示，但资料**未给出"帧同步/帧开始检测"的显式机制**（无"帧头 preamble"描述）。
- 文件级靠 **wirehair 喷泉码**：每帧（每个 fountain block）前缀 **6 字节元数据** = `encode_id(7bit) + file_size(25bit) + block_id(16bit)`（`fountain_encoder_stream.h`，据 DeepWiki Error Correction）。解码端依元数据识别属于哪个文件/哪块，**乱序、重复、缺失均可**——只要收够 N+1 个唯一块即重建。因此"帧同步"在 libcimbar 里被**转化为 fountain 块的元数据路由**，而非时间同步。
- **推断**：单帧图像自身是完整自包含码图（含四角锚点），"一帧的开始"由锚点检测界定；多帧靠 fountain 元数据去重与重组，无需严格时间对齐。这对我们**关键启示**：用喷泉码可彻底绕开"帧率精确同步"难题。

### C15. RS 的交织（interleaving）怎么做？为什么必须交织？

- **为什么必须交织**：图像损伤（遮挡、模糊、摩尔纹）是**空间聚簇**的——坏掉往往是一整片 cell。若连续字节映射到相邻 cell，一片损坏会击穿单个 RS 块；交织把同一 RS 块的数据**分散到图像不同位置**，使局部损坏变为"每个块都坏一点点"，RS 可修。
- **交织做法**：`CellPositions` 类管理"顺序映射 + 避开锚点 + 交织"；DeepWiki 核心概念："Interleaving is a critical feature that spreads related data across the image. If part of the image is damaged ..., errors are spread out"。
- **具体 stride/跳格参数**（如每隔 N 格跳一下的确切值）：**未能确认**（源码不可抓）。**推断**：为网格上的固定步长散布（类似 RAID 条带化），确切参数在 `CellPositions` 实现中。
- 这是**核心可借鉴点**。

---

## D. 工程与架构

### D16. wirehair 喷泉码的接入方式、参数选择、33.55MB 上限来源

- **接入方式**（`fountain_encoder_stream.h` / `fountain_decoder_stream.h` / `fountain_decoder_sink.h`，据 DeepWiki）：
  - 编码：原数据切分为「固定大小 − 头部」块；`FountainEncoder` 按需生成唯一编码块；每块前缀 6 字节元数据（encode_id + file_size + block_id）；流式生成。
  - 解码：`fountain_decoder_sink` 按 `encode_id` 管理多解码器，收集唯一块，收够即重建、完成即停。
- **参数选择**：每 744 字节真实数据耗 6 字节开销（6-bit cimbar，据 DETAILS.md）；喷泉码天然容忍乱序/丢块，需 N+1 帧（N = 文件大小/每帧字节）。
- **33.55MB 上限来源**：元数据 `file_size` 字段为 **25 bit**（配合 byte0 的 1 bit MSB），最大可表示 **2^25 = 33,554,432 字节 ≈ 33.55 MB**。DETAILS.md 称 wirehair 需**全文件驻留 RAM**，故限制文件尺寸；更大文件需外部拆分（cimbar 未实现，社区 `cimbar-bigfile` 用多喷泉流分片突破）。
- 注：每图净载 ecc=30 时约 7500 字节；单文件上限由 25-bit 字段 + RAM 决定，与每帧大小共同约束总帧数。

### D17. 为什么解码端只做 Android 原生、不移植 WASM？浏览器里跑解码的性能/依赖判断

- **cfc 事实**（GitHub sz3/cfc，MIT，948★）：Android 应用，通过相机单向接收动画 cimbar 码；"Nearly all the interesting logic is from libcimbar -- included via a git subtree"；官方 APK 仅 `arm64-v8a`（作者称"that is all I can test"）；需 Android Studio + NDK + OpenCV Android SDK。
- **是否考虑 WASM**：cfc 仓库**无任何 WASM/浏览器解码讨论**；`libcimbar` 的 WASM 构建（`cimbar.js`，见 `WASM.md`）存在，但 **`cimbar.js` 是编码器（供 cimbar.org 在浏览器里把文件编码成动画码），并非解码器**。即：**浏览器端目前只能"编码/生成"，不能"解码/接收"**。
- **我的判断（性能角度）**：解码端是计算热点——锚点扫描（`Scanner` 状态机）、透视变换、每 cell 哈希 + drift 多候选搜索（±7px 共 9 候选）、CCM 颜色校正、Fountain 解码。在手机上用 NDK/C++ 才能达到 850 kbit/s；若搬进浏览器用 WASM 跑这套 OpenCV 密集流水线，**单帧解码延迟与功耗会显著上升**，实时相机流解码在 WASM 下可行性低（尤其中低端机）。
- **依赖角度**：libcimbar 解码依赖 OpenCV + wirehair + libcorrect(RS) + zstd，均 C/C++。OpenCV 有官方 **OpenCV.js（WASM 版）** 可替代其视觉部分；wirehair/libcorrect/zstd 也可用 Emscripten 编成 WASM。**依赖上技术上可替代**，但体积大（OpenCV.js ~数 MB~十余 MB）、且相机帧需经 `getUserMedia` → ImageData → WASM 内存拷贝，额外开销大。
- **结论**：解码端不做 WASM 是"实时性能 + 维护成本（作者只测得起 arm64）"双重考量，非技术不可行。**对我们的启示**：若想"接收端零安装（浏览器）"，可用 OpenCV.js + 自写解码，但需接受性能降级、且要先验证单帧解码耗时。

### D18. 帧率怎么控制？渲染用 GLFW 还是别的方式？

- **渲染依赖**：构建需 `libglfw3-dev` + `libgles2-mesa-dev`（README 安装步骤："install opencv and GLFW"）。`cimbar_send` 用 **GLFW** 做动画显示（屏幕逐帧播放动画码）。
- **帧率控制具体参数/调用**：**未能确认**（源码 `cimbar_send` / GLFW 调用点不可抓）。**推断**：GLFW 窗口 + 定时器/帧间隔实现动画播放；因文件经 fountain 分帧、无需严格时间同步，帧率更多是"播放节奏"而非解码同步关键。
- 编码也可输出**静态 PNG 序列**（`--encode -o prefix` 生成 `prefix*.png`），此时无实时帧率，靠接收端逐张拍/逐帧录。

---

## E. 已知缺陷

### E19. issue 区与 TODO 主要问题、作者承认的局限

- 来源：README 的 `TODO.md` 与仓库说明（可访问资料未含 issue 逐条列表，以下为文档明示项）：
  1. **Windows 原生支持是 "best efforts"**：更 bug，非一等公民（README）。
  2. **大输入文件编码会占满磁盘 PNG**：`--encode` 生成海量图片（README 警告）。
  3. **文件上限 33.55MB**（压缩后）：wirehair 需全文件驻 RAM（DETAILS.md）。
  4. **低分辨率/模糊可局部灾难**：需提高 ECC 或分辨率（DETAILS.md）。
  5. **仍有改进空间（"Room for improvement/next steps"）**：TODO.md 列出但未展开细节。
  6. **cfc 仅 arm64-v8a**：作者只测得起该架构，其他 ABI 未保证。
- 社区衍生反馈（搜索结果）：`cimbar-bigfile` 旨在突破 ~10MB 限制（用多喷泉流分片）；社区有 8-bit/256 符号扩展容量方案。
- 标注：精确的 GitHub issue 讨论（如具体 bug 报告）**未能逐条确认**（网络不通，仅能依据文档明示项）。

---

## 可借鉴清单（我们直接采用的设计 + 理由）

1. **符号 + 颜色双编码（4+2）**：把更多 bit 给"抗光照的形状维度"、较少 bit 给"易偏色的颜色维度"。我们原方案 5-5-5 纯颜色、零形状，是最脆弱处。→ 应引入**形状/图案维度**，大幅降颜色通道压力。
2. **预定义符号集 + 图像哈希最小汉明距离筛选（~20 bit）**：离线挑图案、运行时仅查表比对，工程干净且鲁棒。→ 我们可预生成一组高距离 2D 图案替代"纯色块"。
3. **三主锚 + 右下方向标记 + 透视校正（Deskewer）**：用三个稳定角 + 推算第四角，兼顾定位与方向。→ 我们的四角棋盘思路可对标，但要补"右下角编码方向"与"第四角估算"。
4. **颜色用中心区平均 RGB + CCM 校正 + 相对距离匹配**：避开绝对阈值、抗整体偏色。→ 我们必须弃用"round((v-65)/6) 绝对反查"，改相对匹配。
5. **RS 块纠错 + 网格交织 + 喷泉码（wirehair）**：交织把聚簇损伤摊薄，喷泉码让"帧同步/顺序/丢帧"不再是问题。→ **这是对我们最关键的补课**：用喷泉码可彻底绕开原方案缺失的"帧同步/重传/长度/CRC"全部难题。
6. **每帧自包含 + 6 字节块元数据路由**：解码端无需时间同步即可重组。→ 直接采用。
7. **drift 多候选搜索（±7px）**：应对透视/对齐误差。→ 接收端必备。

## 可改进清单（我们认为有更好做法的地方 + 理由）

1. **颜色维度仍偏敏感**：4 色（2 bit）在强白平衡偏移下仍有混色风险。→ 我们可进一步降颜色 bit（如 1 bit 双色）或加显式灰卡白平衡，换取可靠性。
2. **无最低 tile 像素尺寸自适应**：低分辨率直接"局部灾难"。→ 我们应在协议层规定发送端最小渲染尺寸，并对接收端物理分辨率做门槛校验。
3. **33.55MB / 全文件驻 RAM 限制**：大文件不可用。→ 我们若需传大文件，应在 fountain 之上做"分卷多流"或流式分块，避免全量驻留。
4. **Windows 支持薄弱、构建复杂（OpenCV+GLFW+NDK）**：→ 我们若用 Python/Web 技术栈，可大幅降低构建与跨平台成本（见考古报告方案 1/2）。
5. **符号集生成未开源脚本**：→ 我们应把"高距离图案搜索"做成可复现脚本，便于调参与扩展 8-bit。

## 不可借鉴清单（因目标不同不能照搬）

1. **C++/OpenCV/GLFW/NDK 重构建链**：我们的目标是"自研可用工具 + 可能浏览器零安装接收"，应优先 Python 或 Web，不照搬其重型 C++ 工具链（除非追求 850 kbit/s 极限性能）。
2. **仅 Android 原生解码、无浏览器解码**：与我们"接收端零安装（手机浏览器）"目标冲突，需自补 Web 解码端。
3. **1024×1024 / 112×112 高密度配置**：这是为"显示器→手机摄像头近距高清"优化的；若我们场景含"任意屏幕→任意摄像头"，应从更低密度（更大 tile）起步以保证可解。
4. **cimbar.org 的 WASM 仅编码不解码**：不能直接复用其浏览器解码，需自研。

---

## 若要在浏览器里实现解码端：可行性评估与关键技术障碍

**现状事实**：libcimbar 官方 WASM（`cimbar.js`）**仅编码器**（cimbar.org 用它生成动画码）；解码端只有 Android 原生（cfc）。即"浏览器解码"在官方路线里**不存在**，需我们自研。

**可行性：中等偏高（工程量大、性能需验证）**。

关键技术障碍：
1. **视觉流水线 WASM 化**：锚点扫描、透视变换、每 cell 哈希 + drift 多候选（±7px×9）、CCM 颜色校正。可用 **OpenCV.js（OpenCV 的 WASM 构建）** 覆盖几何与哈希部分；wirehair/libcorrect(RS)/zstd 用 Emscripten 编 WASM。依赖层面**可替代**，但包体大（OpenCV.js 数 MB~十余 MB），首屏加载需容忍。
2. **相机帧接入**：`getUserMedia` 取视频流 → 逐帧 `drawImage` 到 canvas → `getImageData` → 拷入 WASM 内存。这一步的 JS↔WASM 内存拷贝与 GC 是**性能热点**；建议用 `ImageData` 直接 `HEAP` 写、避免逐像素 JS 循环。
3. **实时性**：libcimbar 在手机 NDK 下达 850 kbit/s；浏览器 WASM 单帧解码（约 12400 cell × 9 候选哈希）在中低端机上可能掉到"逐帧而非实时视频"。**对策**：不做实时视频流解码，改为"用户拍/录一段 → 后端逐帧解码 → 喷泉重组"，与官方"静态 PNG 序列"思路一致，降低实时压力。
4. **透视与定位精度**：OpenCV.js 提供 `findChessboardCorners`/轮廓 + `getPerspectiveTransform`/`warpPerspective`，可直接对标 `Deskewer`，可行。
5. **颜色鲁棒性**：浏览器内 `getImageData` 拿到的是 sRGB，需自行实现 CCM + 相对距离匹配；注意不同设备摄像头色彩响应差异，建议内置灰卡校准步骤。
6. **性能兜底方案**：若 OpenCV.js 太重，可用纯 JS + 轻量定点哈希（average_hash 本质只是阈值+位运算，极易用 JS/TypedArray 实现），仅透视变换用 OpenCV.js 或自写 4 点仿射。这样能压住包体与延迟。

**结论**：浏览器解码端"能做"，但官方无现成轮子，需自研约一个 `Deskewer + Symbol/Color Decoder + Fountain sink` 的 JS/WASM 移植；推荐先用"录屏/拍照 → 离线逐帧解码 → 喷泉重组"降低实时门槛，再视性能决定是否上实时视频流。这与考古报告中"方案 2（Python 发送 + 浏览器接收）"一致，是达成"接收端零安装"最现实的路径。

---

## 附录：资料可获取性声明（合规备注）

- 本机 `git clone` 至 `reference/` **仅生成两个空 `.git` 目录**（`libcimbar/`、`cfc/`），因 GitHub 网络不通，**未拉取任何源码文件、未写入业务代码**，满足"只读、不改 reference/"约束。
- 全部事实性结论来自：`libcimbar` README / `DETAILS.md`（raw 抓取）、DeepWiki 自动索引页（核心概念、Tile Generation、Image Processing、Symbol and Color Decoding、Error Correction）、`cfc` GitHub 页、社区文档（cimbar-bigfile、CSDN 镜像等）。
- 标注「未能确认」项：`Common.cpp` 中 4 色精确 RGB、交织 stride 具体值、`Scanner` 第四角推算公式、`GLFW` 帧率调用点、`Deskewer` 确切 OpenCV 函数名、GitHub issue 逐条内容、5×5 配置屏幕像素尺寸。以上均不作事实断言。
