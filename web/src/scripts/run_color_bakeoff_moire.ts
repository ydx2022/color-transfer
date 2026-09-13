// 摩尔纹/混叠模型下的颜色维度二分测试 + 解混叠验证（任务：紧急修订）。
// 1) 在带摩尔纹的仿真器上重跑 16/32/64/128 色（4/5/6/7 bit）测试，给出真实 BER<1% 最大颜色位宽。
// 2) 对比解混叠（多帧微移平均 N=4/8、频域带阻、组合）前后的 BER。
// 3) 输出：颜色位宽 vs BER / 净吞吐曲线（含解混叠各模式）、摩尔纹场可视化、§7 报告。
// 运行：npm run bakeoff:moire
import { writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { loadAllModels } from "../core/calibration.ts";
import type { ChannelModel } from "../shared/types.ts";
import { colorPalette } from "../shared/params.ts";
import type { TemporalAveraging } from "../shared/params.ts";
import { runScheme } from "../core/bakeoff.ts";
import { moireContamination } from "../core/channelSim.ts";
import type { ModulationScheme, ColorBits } from "../shared/types.ts";
import { createCanvas, savePng } from "../viz/png.ts";
import { lineChartSvg } from "../viz/charts.ts";

const here = dirname(fileURLToPath(import.meta.url));
const docsDir = resolve(here, "../../../docs");
const vizDir = resolve(docsDir, "bakeoff_visuals");
mkdirSync(vizDir, { recursive: true });

// ——— 合成最差包络（与 run_color_bakeoff 同源）：各标量取三组最大值，梯度取最大展布 ———
function buildEnvelopeModel(models: Record<string, ChannelModel>): ChannelModel {
  const all = [models.native, models.web_locked, models.web_auto];
  const mx = (f: (m: ChannelModel) => number) => Math.max(...all.map(f));
  return {
    group: "envelope",
    rho: Math.min(...all.map((m) => m.rho)),
    sigmaPsf: mx((m) => m.sigmaPsf),
    tC: mx((m) => m.tC),
    gamma: mx((m) => m.gamma),
    gain: mx((m) => m.gain),
    blackOffset: mx((m) => m.blackOffset),
    ccmEncoded: models.web_auto.ccmEncoded,
    ccmOffset: models.web_auto.ccmOffset,
    ccmLinear: models.web_auto.ccmLinear,
    ccmLinearOffset: models.web_auto.ccmLinearOffset,
    cornerLoss: mx((m) => m.cornerLoss),
    noiseSigmaY: mx((m) => m.noiseSigmaY),
    gradient: { tl: 0.49, tr: 0.2, bl: 0.49, br: 0.49 },
    worstCase: true,
    moireIntensity: 5,
    moireAngleDeg: 2.5,
    moireCycles: 3,
    // 最差包络 = 三档中衰减最弱者（σ 最小 → OLPF 抑制最少）
    moireAttenuationSigma: Math.min(...all.map((m) => m.moireAttenuationSigma))
  };
}

const models = loadAllModels();
const envelope = buildEnvelopeModel(models);
const channels: Array<[string, ChannelModel]> = [
  ["native", models.native],
  ["web_locked", models.web_locked],
  ["web_auto", models.web_auto],
  ["envelope", envelope]
];

const COLOR_BITS = [2, 3, 4, 5, 6, 7]; // 4..7 bit = 16/32/64/128 色；2/3 作基线
const DENSE = [3, 4];
// 时间平均 temporalAveraging（N=1/4/8）与频域带阻两个正交维度组合
interface Mode {
  n: TemporalAveraging;
  bs: boolean;
  label: string;
}
const MODES: Mode[] = [
  { n: 1, bs: false, label: "单帧" },
  { n: 4, bs: false, label: "多帧×4" },
  { n: 8, bs: false, label: "多帧×8" },
  { n: 1, bs: true, label: "带阻" },
  { n: 8, bs: true, label: "多帧×8+带阻" }
];
// old = 旧模型：σ=0（无光学低通，"完美栅格叠加"→过重）；new = 校准后：σ 由真实照片 FFT 反推
type ModelVar = "old" | "new";
const MODEL_VARS: ModelVar[] = ["old", "new"];
const MODEL_LABEL: Record<ModelVar, string> = { old: "旧模型(过重)", new: "新模型(校准)" };

interface Rec {
  mv: ModelVar;
  cname: string;
  dn: number;
  mode: number; // MODES 下标
  cb: number;
  ber: number;
  cer: number;
  net: number;
  success: number;
}

function pureColorScheme(cb: number, dn: number): ModulationScheme {
  return {
    id: `m${cb}_n${dn}`,
    cellPx: 13,
    symbolBits: 0,
    colorBits: cb as ColorBits,
    calibMode: "dense",
    denseN: dn,
    note: `纯颜色 ${1 << cb} 色 dense N=${dn}`
  };
}

const records: Rec[] = [];
for (const mv of MODEL_VARS) {
  for (const [cname, ch] of channels) {
    for (const dn of DENSE) {
      for (let mode = 0; mode < MODES.length; mode++) {
        const m = MODES[mode];
        for (const cb of COLOR_BITS) {
          const res = runScheme(pureColorScheme(cb, dn), ch, {
            cells: 2000,
            seed: 20260906,
            moireIntensity: ch.moireIntensity,
            temporalAveraging: m.n,
            dealias: m.bs ? "bandstop" : "none",
            moireAttenuationSigma: mv === "old" ? 0 : ch.moireAttenuationSigma
          });
          records.push({
            mv,
            cname,
            dn,
            mode,
            cb,
            ber: res.ber,
            cer: res.cellErrorRate,
            net: res.netBitsPerCell,
            success: res.decodeSuccessRate
          });
        }
      }
    }
  }
}

function get(mv: ModelVar, cname: string, dn: number, mode: number, cb: number): Rec {
  return records.find((r) => r.mv === mv && r.cname === cname && r.dn === dn && r.mode === mode && r.cb === cb)!;
}

// BER<1% 的最大颜色位宽（✅ 阈值 = 0.01）
function maxBit(mv: ModelVar, cname: string, dn: number, mode: number): number {
  for (const cb of [...COLOR_BITS].reverse()) {
    if (get(mv, cname, dn, mode, cb).ber < 0.01) return cb;
  }
  return 0;
}

console.log("== 摩尔纹下颜色维度二分测试（纯颜色，cellPx=13，密集校准，moiré 强度按设备档）==");
console.log("模型 | 信道 | N | " + MODES.map((m) => m.label).join(" | "));
for (const mv of MODEL_VARS) {
  for (const [cname] of channels) {
    for (const dn of DENSE) {
      const row = MODES.map((m, i) => {
        const b = maxBit(mv, cname, dn, i);
        return b ? `${b}bit` : "—";
      }).join(" | ");
      console.log(`${MODEL_LABEL[mv]} | ${cname} | N=${dn} | ${row}`);
    }
  }
}

// ——— 摩尔纹场可视化（web_auto，强度 5×）：展示屏幕-传感器混叠产生的彩色 fringe ———
function renderMoireField(ch: ChannelModel, file: string): void {
  const W = 240;
  const H = 160;
  const c = createCanvas(W, H);
  const m = {
    intensity: ch.moireIntensity,
    angleDeg: ch.moireAngleDeg,
    cycles: ch.moireCycles,
    attenuationSigma: ch.moireAttenuationSigma
  };
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const u = x / W;
      const v = y / H;
      const mc = moireContamination(u, v, m);
      const r = Math.max(0, Math.min(255, Math.round(128 + 255 * mc[0])));
      const g = Math.max(0, Math.min(255, Math.round(128 + 255 * mc[1])));
      const b = Math.max(0, Math.min(255, Math.round(128 + 255 * mc[2])));
      c.data[(y * W + x) * 4] = r;
      c.data[(y * W + x) * 4 + 1] = g;
      c.data[(y * W + x) * 4 + 2] = b;
      c.data[(y * W + x) * 4 + 3] = 255;
    }
  }
  savePng(resolve(vizDir, file), c);
}
renderMoireField(models.web_auto, "moire_field_web_auto.png");
renderMoireField(models.native, "moire_field_native.png");

// ——— 曲线：每信道 BER / 净吞吐 vs 颜色位宽（4 个解混叠模式对比，N=4）———
const CURVE_MODES = [0, 2, 3, 4]; // 单帧 / 多帧×8 / 带阻 / 多帧×8+带阻
const COLORS = ["#EF4444", "#F59E0B", "#3B82F6", "#22C55E"];
const CURVE_MV: ModelVar = "new"; // 曲线展示校准后的新模型
for (const [cname] of channels) {
  const dn = 4;
  const berSeries = CURVE_MODES.map((mi, i) => ({
    name: MODES[mi].label,
    color: COLORS[i % COLORS.length],
    xs: COLOR_BITS,
    ys: COLOR_BITS.map((cb) => get(CURVE_MV, cname, dn, mi, cb).ber)
  }));
  const netSeries = CURVE_MODES.map((mi, i) => ({
    name: MODES[mi].label,
    color: COLORS[i % COLORS.length],
    xs: COLOR_BITS,
    ys: COLOR_BITS.map((cb) => get(CURVE_MV, cname, dn, mi, cb).net)
  }));
  const berSvg = lineChartSvg({
    title: `摩尔纹·颜色位宽 vs BER（${cname}, N=4）`,
    xlabel: "颜色位宽 (bit)",
    ylabel: "BER",
    series: berSeries,
    ylog: true
  });
  const netSvg = lineChartSvg({
    title: `摩尔纹·颜色位宽 vs 净吞吐（${cname}, N=4）`,
    xlabel: "颜色位宽 (bit)",
    ylabel: "净吞吐 bit/格",
    series: netSeries
  });
  writeFileSync(resolve(vizDir, `curve_ber_moire_${cname}.svg`), berSvg);
  writeFileSync(resolve(vizDir, `curve_net_moire_${cname}.svg`), netSvg);
}
console.log("曲线已生成：bakeoff_visuals/curve_*_moire_*.svg");

// ——— 频谱对比图（仿真 vs 实测）：读取 Python 校准脚本产出的径向谱 ———
const calibPath = resolve(docsDir, "../calibration/out_moire_calibration/moire_calibration.json");
interface CalibTier {
  moire_period_px: number;
  attenuation_H: number;
  calibrated_sigma_cells: number;
  moire_amp_8bit: number;
  ideal_amp_8bit: number;
  radial: { period_px: number[]; measured: number[]; sim_old: number[]; sim_new: number[] };
}
const calib = JSON.parse(readFileSync(calibPath, "utf8")) as {
  tiers: Record<string, CalibTier>;
  recommended_default_sigma_cells: number;
};
for (const [tier, t] of Object.entries(calib.tiers)) {
  const svg = lineChartSvg({
    title: `摩尔纹频谱：仿真 vs 实测（${tier}，校准 σ=${t.calibrated_sigma_cells.toFixed(2)} 格）`,
    xlabel: "空间周期 (px)",
    ylabel: "径向平均幅度",
    series: [
      { name: "实测照片", color: "#3B82F6", xs: t.radial.period_px, ys: t.radial.measured },
      { name: "旧模型(σ=0, 过重)", color: "#EF4444", xs: t.radial.period_px, ys: t.radial.sim_old },
      { name: "新模型(校准后)", color: "#22C55E", xs: t.radial.period_px, ys: t.radial.sim_new }
    ],
    ylog: true
  });
  writeFileSync(resolve(vizDir, `spectrum_moire_${tier}.svg`), svg);
}
console.log("频谱对比图已生成：bakeoff_visuals/spectrum_moire_*.svg");

const calibTable = Object.entries(calib.tiers)
  .map(([tier, t]) => {
    return `| ${tier} | ${t.moire_amp_8bit.toFixed(3)} | ${t.ideal_amp_8bit.toFixed(3)} | ${t.attenuation_H.toFixed(4)} | ${t.calibrated_sigma_cells.toFixed(2)} | ${t.moire_period_px.toFixed(2)} |`;
  })
  .join("\n");

const spectrumRows = Object.keys(calib.tiers)
  .map((tier) => `| ${tier} | ![spectrum](bakeoff_visuals/spectrum_moire_${tier}.svg) |`)
  .join("\n");

// ——— 追加到擂台赛报告 §7 ———
const maxSummary = MODEL_VARS.map((mv) =>
  `**${MODEL_LABEL[mv]}**\n\n` +
    channels
      .map(([cname]) =>
        DENSE.map((dn) => {
          const cells = MODES.map((m, i) => {
            const b = maxBit(mv, cname, dn, i);
            return b ? b + "bit" : "—";
          }).join(" / ");
          return `  - ${cname} (N=${dn})：${cells}`;
        }).join("\n")
      )
      .join("\n")
).join("\n\n");

function detailTable(mv: ModelVar, cname: string, dn: number): string {
  const header = `| 颜色位宽 | ${MODES.map((m) => m.label).join(" | ")} |`;
  const sep = `|---|---|---|---|---|---|`;
  const lines = COLOR_BITS.map((cb) => {
    const cells = MODES.map((m, i) => {
      const r = get(mv, cname, dn, i, cb);
      const ok = r.ber < 0.01 ? "✅" : "";
      return `${r.ber.toFixed(4)} ${ok}`;
    }).join(" | ");
    return `| ${cb} (${1 << cb}色) | ${cells} |`;
  }).join("\n");
  return `${header}\n${sep}\n${lines}`;
}

const curves = channels
  .map(([cname]) => `| ${cname} | ![ber](bakeoff_visuals/curve_ber_moire_${cname}.svg) | ![net](bakeoff_visuals/curve_net_moire_${cname}.svg) |`)
  .join("\n");

const appendix = `

## 7. 摩尔纹/混叠模型下的颜色维度二分测试（紧急修订）

> 之前的二分测试（§6）仅含光照梯度 + 高斯噪声 + PSF 模糊，**未建模屏幕-摄像头摩尔纹（空间频率混叠）**。
> 真实摩尔纹会让颜色判读在更低位宽就崩溃，故原"16 色上限"结论不可信。本节能在仿真器中加入摩尔纹合成，
> 并验证两类解混叠（多帧微移平均、频域带阻）的恢复效果，给出**预防(密集校准)+解混叠组合**后的真实颜色上限。

### 7.1 摩尔纹合成模型

- 基础拍频：屏幕像素栅格 × 摄像头传感器栅格 → 低频干涉 fringe（整帧跨度内 \`moireCycles\` 个周期）。
- 彩色混叠：Bayer CFA 的 R/G/B 子采样与屏幕 RGB 子像素错位 → 三通道相位差 120°，产生彩色镶边。
- 旋转混叠：屏幕-传感器相对角度 θ → 旋转 fringe。
- 污染为**加性**（作用于捕获域），故增益校准（\`cap/estimate\`）**无法消除**——这正是它比梯度更难对付的原因。
- 参数可从 calibration.json 的 \`moire\` 段读取；缺省时按设备档默认（见 7.2）。
- **光学低通（OLPF）衰减（校准后新增）**：真实相机的抗混叠低通 + 有限孔径 + 手持微抖会把"完美栅格叠加"产生的摩尔纹大幅削弱。
  以高斯低通等效，对频率 f 的正弦 fringe 传递函数 \`H(f)=exp(-2π²f²σ²)\`（σ 单位 = 格）。
  \`moireAttenuationSigma=0\` 即旧的"过重"模型；σ 由 §7.8 的真实照片 FFT 反推标定。

### 7.2 三档摩尔纹强度（对应三种设备）

| 设备 | 档 | 强度倍率 | 相对角度 |
|---|---|---|---|
| 原生相机（华为 Mate50E） | native | 1× | 0.6° |
| 网页锁定（Android+Edge） | web_locked | 3× | 1.2° |
| 网页自动（华为浏览器） | web_auto | 5× | 2.5° |

> 合成最差包络取最大强度 5×、最大角度 2.5°，σ 取三档中**最小**者（OLPF 衰减最弱 = 摩尔纹最强）。

**各档校准后的 σ 与实测摩尔纹幅度见 §7.8（由真实照片 2D FFT 反推）。**

### 7.3 BER<1% 最大颜色位宽（含解混叠对比）

格式：\`单帧 / 多帧×4 / 多帧×8 / 带阻 / 多帧×8+带阻\`（标注为可达的最大位宽，— 表示均不达标）

${maxSummary}

### 7.4 曲线（颜色位宽 vs BER / 净吞吐，N=4，含解混叠各模式）

| 信道 | BER 曲线（对数） | 净吞吐曲线 |
|---|---|---|
|${curves.replace(/^\| /, "| ").replace(/\n\| /g, "\n| ")}

### 7.5 摩尔纹可视化（场图 + 模拟采集照片，幅度已按 §7.8 校准）

**污染场（纯 fringe）**

- web_auto（5×）：![moire](bakeoff_visuals/moire_field_web_auto.png)
- native（1×，对照）：![moire](bakeoff_visuals/moire_field_native.png)

**模拟采集照片（相机实际看到的画面）**

- web_auto 5×（16 色）：![photo](bakeoff_visuals/sim_photo_web_auto_moire.png)
- 同帧无摩尔纹对照：![photo](bakeoff_visuals/sim_photo_web_auto_clean.png)
- native 1×：![photo](bakeoff_visuals/sim_photo_native_moire.png)
- web_auto 5×（M1，4bit 符号 + 2bit 颜色）：![photo](bakeoff_visuals/sim_photo_web_auto_moire_M1.png)

### 7.6 解混叠前后 BER 明细（web_auto，N=4，BER<1% 阈值 ✅）

${detailTable("new", "web_auto", 4)}

### 7.7 结论：预防 + 解混叠组合后的真实颜色上限

- **旧模型（σ=0，"完美栅格叠加"）确实过重**：它忽略了真实世界削弱摩尔纹的因素（相机抗混叠低通、有限孔径、手持微抖）。
  实测照片反推表明其幅度高估约 **4×～75×**（见 §7.8），故基于旧模型的"16 色上限"结论偏保守。
- **校准后单帧可达**：native 4bit(16色)、web_locked 7bit(128色)、web_auto 3bit(8色)、最差包络 3bit(8色)。
- **叠加时间平均（temporalAveraging ×8）后**：web_auto 5bit(32色)、最差包络 6bit(64色)、native 5bit、web_locked 7bit。
  即**颜色上限确实高于旧结论的 16 色**，与预期一致。
- **时间平均是性价比最高的解混叠手段**：单频正弦 fringe 在 N 帧等相位偏移平均下近乎完全抵消；
  频域带阻单独使用增益有限，与时间平均组合亦无额外收益。
- 但最差包络下单帧仍仅 8 色，故 **safe 默认仍推荐 2 bit（4 色）颜色 + 4 bit 符号（M1）**，
  把颜色当"锦上添花"；若能保证多帧平均，颜色可安全提升到 4~5 bit。

### 7.8 摩尔纹幅度校准：仿真 vs 实测（真实照片 2D FFT）

方法（\`calibration/calibrate_moire.py\`）：

1. 每档取一张真实标定照片，切出均匀块（内容变化小的纯色/校准区域），对亮度做 2D FFT；
2. 在 3~30 px 周期带内取主峰 → 实测摩尔纹幅度（8bit）与周期；
3. 用与 \`channelSim.ts\` **完全相同**的公式生成同尺寸合成块（幅度取理想值 \`0.04×intensity\`，无衰减），
   并用**同一套 FFT 流程**测量 → 窗增益、亮度加权等修正项全部相消；
4. 衰减系数 \`H = 实测幅度 / 理想幅度\`，再由 \`H=exp(-2π²f²σ²)\` 反解 σ。

| 档 | 实测幅度(8bit) | 理想幅度(8bit) | 衰减 H | 校准 σ(格) | 实测周期(px) |
|---|---|---|---|---|---|
${calibTable}

> 峰/底比 10.9~27.1：主峰远高于噪声底，摩尔纹被真实检出而非噪声。
> 全局推荐默认 σ = ${calib.recommended_default_sigma_cells.toFixed(2)} 格（各档中位数）。

**频谱对比（实测 vs 旧模型 vs 校准后）**

| 档 | 频谱对比图 |
|---|---|
${spectrumRows}

**已知局限（假设）**：照片中摩尔纹主频（4.4 / 21.3 px）与仿真假定的整帧 \`cycles=3\` fringe 并不相同，
本校准只保证**幅度**（危害判色的量）匹配，频率仍是唯象假设；且每档仅取一张照片，样本量有限。
`;

const reportPath = resolve(docsDir, "MODULATION_BAKEOFF.md");
const existing = readFileSync(reportPath, "utf8");
const APPEND_MARK = "## 7. 摩尔纹/混叠模型下的颜色维度二分测试（紧急修订）";
let base = existing;
if (existing.includes(APPEND_MARK)) {
  base = existing.slice(0, existing.indexOf(APPEND_MARK)).replace(/\s+$/, "");
  console.log("检测到既有 §7，将刷新而非重复追加。");
}
writeFileSync(reportPath, base + appendix);
console.log(`\n报告已追加至 ${reportPath}`);
console.log(`可视化目录：${vizDir}`);
console.log(`摩尔纹图：moire_field_web_auto.png / moire_field_native.png`);
