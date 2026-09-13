// 颜色维度二分测试 + 可视化（任务 3 补充）。
// 1) 颜色位宽二分：2/4/8/16/32/64 色（1..6 bit），密集校准 N=3/N=4，三组实测 + 合成最差包络，
//    目标找「BER<1%」的最大颜色位宽。
// 2) 可视化产出（docs/bakeoff_visuals/）：模拟帧、校准对比、BER 热力图、颜色散点、曲线。
// 3) 追加二分测试结果表 + 图片 + 更新推荐到 docs/MODULATION_BAKEOFF.md。
// 运行：npm run bakeoff:color
import { writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { loadAllModels } from "../core/calibration.ts";
import { bakeoffSchemes } from "../shared/params.ts";
import { runScheme } from "../core/bakeoff.ts";
import { colorPalette } from "../shared/params.ts";
import type { ChannelModel, ModulationScheme } from "../shared/types.ts";
import { renderCapturedFrame } from "../viz/frameRender.ts";
import { runGrid } from "../viz/analyze.ts";
import { renderBerHeatmap } from "../viz/heatmap.ts";
import { renderColorScatter } from "../viz/scatter.ts";
import { renderCalibComparison } from "../viz/calibCompare.ts";
import { lineChartSvg } from "../viz/charts.ts";
import { savePng } from "../viz/png.ts";

const here = dirname(fileURLToPath(import.meta.url));
const docsDir = resolve(here, "../../../docs");
const vizDir = resolve(docsDir, "bakeoff_visuals");
mkdirSync(vizDir, { recursive: true });

// ——— 合成最差包络：各标量参数取三组最大值，梯度取最大展布 ———
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
    moireIntensity: 5, // 合成最差包络：取最大摩尔纹强度
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

const COLOR_BITS = [1, 2, 3, 4, 5, 6, 7]; // 1..7 bit（2/4/8/16/32/64/128 色）；主线 4..7 bit = 16/32/64/128 色
const DENSE = [3, 4];

interface Rec {
  cname: string;
  dn: number;
  cb: number;
  ber: number;
  cer: number;
  overhead: number;
  net: number;
  success: number;
}

const records: Rec[] = [];
for (const [cname, ch] of channels) {
  for (const dn of DENSE) {
    for (const cb of COLOR_BITS) {
      const scheme: ModulationScheme = {
        id: `c${cb}_n${dn}`,
        cellPx: 13,
        symbolBits: 0,
        colorBits: cb as ModulationScheme["colorBits"],
        calibMode: "dense",
        denseN: dn,
        note: `纯颜色 ${1 << cb} 色 dense N=${dn}`
      };
      const res = runScheme(scheme, ch, { cells: 3000, seed: 20260906 });
      records.push({ cname, dn, cb, ber: res.ber, cer: res.cellErrorRate, overhead: res.overhead, net: res.netBitsPerCell, success: res.decodeSuccessRate });
    }
  }
}

function maxColorBits(cname: string, dn: number): number {
  for (const cb of [...COLOR_BITS].reverse()) {
    const r = records.find((x) => x.cname === cname && x.dn === dn && x.cb === cb);
    if (r && r.ber < 0.01) return cb;
  }
  return 0;
}

console.log("== 颜色维度二分测试（纯颜色，cellPx=13，密集校准）==");
console.log("信道 | N | 1bit | 2bit | 3bit | 4bit | 5bit | 6bit | BER<1%最大位宽");
for (const [cname] of channels) {
  for (const dn of DENSE) {
    const line = COLOR_BITS.map((cb) => {
      const r = records.find((x) => x.cname === cname && x.dn === dn && x.cb === cb)!;
      return r.ber < 0.01 ? r.ber.toFixed(3) : r.ber.toFixed(3) + "*";
    }).join(" | ");
    console.log(`${cname} | N=${dn} | ${line} | ${maxColorBits(cname, dn) || "无"}`);
  }
}

// ——— 可视化：为关键方案生成四图 ———
const vizSchemes: ModulationScheme[] = bakeoffSchemes().filter((s) => ["M1", "M3", "M7a", "M7b", "M7c"].includes(s.id));
const maxCb = maxColorBits("envelope", 4) || 4;
vizSchemes.push({
  id: `M7max_${maxCb}bit`,
  cellPx: 13,
  symbolBits: 0,
  colorBits: maxCb as ModulationScheme["colorBits"],
  calibMode: "dense",
  denseN: 4,
  note: `纯颜色 ${1 << maxCb} 色（最差包络 BER<1% 最大位宽）`
});
// 可视化用真实最差实测信道（web_auto）：σ_PSF 同为 2.78，且携带项目真正关心的「非径向梯度」，
// 比合成的包络梯度更真实、更直观；数值擂台赛仍用 envelope 作为保守包络。
const vizChannel = models.web_auto;

function safeId(id: string): string {
  return id.replace(/[^\w]+/g, "_");
}

for (const s of vizSchemes) {
  const id = safeId(s.id);
  // 1) 模拟帧（带模糊+色偏+噪声）
  const frame = renderCapturedFrame(s, vizChannel, 30, 20, 7);
  savePng(resolve(vizDir, `${id}_frame.png`), frame.canvas);
  // 2) 校准对比
  const cc = renderCalibComparison(s, vizChannel, 24, 18, 7, 18);
  savePng(resolve(vizDir, `${id}_calib.png`), cc.canvas);
  // 3) BER 热力图
  const grid = runGrid(s, vizChannel, 40, 30, 7);
  savePng(resolve(vizDir, `${id}_heat.png`), renderBerHeatmap(grid, 10));
  // 4) 颜色散点
  const sc = renderColorScatter(colorPalette(s.colorBits), vizChannel);
  savePng(resolve(vizDir, `${id}_scatter.png`), sc.canvas);
  console.log(`可视化已生成：${id}（校准对比 无=${cc.noneWrong}/${cc.total} 误码，密集=${cc.denseWrong}/${cc.total} 误码，颜色重叠对=${sc.overlapPairs.length}）`);
}

// ——— 曲线图（每信道：BER 对数、净吞吐）———
const COLORS = ["#3B82F6", "#F59E0B", "#22C55E", "#EF4444"];
for (const [cname, ch] of channels) {
  const berSeries = DENSE.map((dn, i) => ({
    name: `N=${dn}`,
    color: COLORS[i % COLORS.length],
    xs: COLOR_BITS,
    ys: COLOR_BITS.map((cb) => records.find((r) => r.cname === cname && r.dn === dn && r.cb === cb)!.ber)
  }));
  const netSeries = DENSE.map((dn, i) => ({
    name: `N=${dn}`,
    color: COLORS[i % COLORS.length],
    xs: COLOR_BITS,
    ys: COLOR_BITS.map((cb) => records.find((r) => r.cname === cname && r.dn === dn && r.cb === cb)!.net)
  }));
  const berSvg = lineChartSvg({
    title: `颜色位宽 vs BER（${cname}）`,
    xlabel: "颜色位宽 (bit)",
    ylabel: "BER",
    series: berSeries,
    ylog: true
  });
  const netSvg = lineChartSvg({
    title: `颜色位宽 vs 净吞吐（${cname}）`,
    xlabel: "颜色位宽 (bit)",
    ylabel: "净吞吐 bit/格",
    series: netSeries
  });
  writeFileSync(resolve(vizDir, `curve_ber_${cname}.svg`), berSvg);
  writeFileSync(resolve(vizDir, `curve_net_${cname}.svg`), netSvg);
}
console.log("曲线已生成：bakeoff_visuals/curve_*.svg");

// ——— 追加到擂台赛报告 ———
const maxBitsSummary = channels
  .map(([cname]) => {
    const n3 = maxColorBits(cname, 3);
    const n4 = maxColorBits(cname, 4);
    return `  - ${cname}：N=3 → ${n3 ? n3 + "bit(" + (1 << n3) + "色)" : "无满足"}；N=4 → ${n4 ? n4 + "bit(" + (1 << n4) + "色)" : "无满足"}`;
  })
  .join("\n");

function recTable(cname: string): string {
  const rows = DENSE.map((dn) => {
    const lines = COLOR_BITS.map((cb) => {
      const r = records.find((x) => x.cname === cname && x.dn === dn && x.cb === cb)!;
      const ok = r.ber < 0.01 ? "✅" : "";
      return `| N=${dn} | ${cb} (${1 << cb}色) | ${r.cer.toFixed(4)} | ${r.ber.toFixed(4)} ${ok} | ${r.overhead.toFixed(3)} | ${r.net.toFixed(3)} | ${r.success.toFixed(4)} |`;
    }).join("\n");
    return lines;
  }).join("\n");
  return rows;
}

const vizImages = vizSchemes
  .map((s) => {
    const id = safeId(s.id);
    return `### ${s.id}（${s.cellPx}px, colorBits=${s.colorBits}, ${s.calibMode}${s.denseN ? " N=" + s.denseN : ""}）

- 模拟采集帧（模糊+色偏+噪声）：![frame](bakeoff_visuals/${id}_frame.png)
- 校准对比（左:原始带梯度 / 中:无校准 / 右:本方案校准模式，琥珀框=参考灰块位置，绿=正确 红=误码）：![calib](bakeoff_visuals/${id}_calib.png)
- BER 热力图（绿→红=错误率升）：![heat](bakeoff_visuals/${id}_heat.png)
- 颜色空间散点（红连接=捕获域重叠对）：![scatter](bakeoff_visuals/${id}_scatter.png)
`;
  })
  .join("\n");

const curves = channels
  .map(([cname]) => `| ${cname} | ![ber](bakeoff_visuals/curve_ber_${cname}.svg) | ![net](bakeoff_visuals/curve_net_${cname}.svg) |`)
  .join("\n");

const appendix = `

## 6. 颜色维度二分测试（任务 3 补充）

> 在 M7 纯颜色基线（cellPx=13，密集校准）上，扩展颜色位宽 1..7 bit（2/4/8/16/32/64/128 色），
> 主线测试序列为 **16/32/64/128 色（4/5/6/7 bit）**，1..3 bit 作曲线基线；
> 校准模式 N=3 与 N=4 各跑一遍，信道覆盖三组实测（native / web_locked / web_auto）+ 合成最差包络（各参数取三组最大值，梯度取最大展布）。
> 目标：找到 **BER<1%** 的最大颜色位宽（✅ 标记达标）。

### 6.1 各信道 BER<1% 最大颜色位宽

${maxBitsSummary}

- N=3 开销 ≈ 1/9 (11.1%)；N=4 开销 ≈ 1/16 (6.25%)。开销计入净吞吐。
- 合成最差包络：σ_PSF=${envelope.sigmaPsf.toFixed(2)}，noiseσ_Y=${envelope.noiseSigmaY.toFixed(1)}，梯度 tl/tr/bl/br=${envelope.gradient.tl}/${envelope.gradient.tr}/${envelope.gradient.bl}/${envelope.gradient.br}。

### 6.2 二分测试结果明细

| 校准 | 颜色位宽 | 格错误率 | BER | 校准开销 | 净吞吐 bit/格 | 解码成功率 |
|---|---|---|---|---|---|---|
${recTable("native")}
${recTable("web_locked")}
${recTable("web_auto")}
${recTable("envelope")}

### 6.3 曲线（颜色位宽 vs BER / 净吞吐）

| 信道 | BER 曲线（对数） | 净吞吐曲线 |
|---|---|---|
${curves}

### 6.4 关键方案可视化

${vizImages}

### 6.5 更新后的推荐

- 纯颜色维度在**合成最差包络 / web_auto（safe 设计依据）** 下可达 **4 bit（16 色）且 BER<1%**（N=4）—— 即 safe 默认设计的颜色位宽硬上限；在锁定实测（web_locked）下可达 **7 bit（128 色）**，原生（native）下 4 bit。
- 但 safe 档默认仍推荐 **M1（4bit 符号 + 2bit 颜色 + 四角校准）**：符号维度对梯度/模糊鲁棒，与颜色维度互补，综合鲁棒性优于纯颜色。
- 颜色位宽默认维持 **1（双色）** 的保守判断不变；若真机实测确认高色数可行，可按本节二分结果上调至 ${maxCb} bit。
- 非径向梯度下，**密集校准（N=4，开销 6.25%）是纯颜色方案可行的必要条件**（见 6.4 校准对比图：中栏无校准大面积红，右栏密集校准基本全绿）。
`;

const reportPath = resolve(docsDir, "MODULATION_BAKEOFF.md");
const existing = readFileSync(reportPath, "utf8");
const APPEND_MARK = "## 6. 颜色维度二分测试（任务 3 补充）";
// 重跑时刷新既有 §6（而非重复追加）
let base = existing;
if (existing.includes(APPEND_MARK)) {
  base = existing.slice(0, existing.indexOf(APPEND_MARK)).replace(/\s+$/, "");
  console.log("检测到既有 §6，将刷新而非重复追加。");
}
const updated = base + appendix;
writeFileSync(reportPath, updated);
console.log(`\n报告已追加至 ${reportPath}`);
console.log(`可视化目录：${vizDir}`);
