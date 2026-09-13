// 调制擂台赛入口：在「最差包络」实测信道（web_auto）上扫 M1–M7，输出决策表并写入报告。
// 运行：npm run bakeoff
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { loadChannelModel, loadAllModels } from "../core/calibration.ts";
import { bakeoffSchemes } from "../shared/params.ts";
import { runScheme, denseVsNoneImprovement, type BakeResult } from "../core/bakeoff.ts";
import { getChannelQuality, estimateDRec } from "../core/getChannelQuality.ts";
import type { ModulationScheme } from "../shared/types.ts";

const here = dirname(fileURLToPath(import.meta.url));
const docsDir = resolve(here, "../../../docs");

const RS_K_FACTOR = 223 / 255; // RS(255,223) 块级开销因子

const channel = loadChannelModel("web_auto"); // 最差包络（safe 档依据）
console.log(`信道组=web_auto（最差包络）  σ_PSF=${channel.sigmaPsf}  ρ=${channel.rho}  d_rec≈${estimateDRec(channel)}`);

const schemes = bakeoffSchemes();
const results: BakeResult[] = schemes.map((s) => runScheme(s, channel));

// 推荐：可行且解码成功率≥0.999 中净吞吐最大者
const candidates = results.filter((r) => r.feasible && r.decodeSuccessRate >= 0.999);
const recommended = candidates.sort((a, b) => b.netBitsPerCell - a.netBitsPerCell)[0];

// M7 纯颜色：密集 vs 无校准 改善
const m7 = schemes.filter((s) => s.id.startsWith("M7"));
const m7improve = m7.map((s) => ({ id: s.id, imp: denseVsNoneImprovement(s, channel) }));

function fmt(x: number): string {
  return x.toFixed(4);
}

// 控制台表
console.log("\n方案 | cell | sym | col | 校准 | 可行 | 格错误率 | 净吞吐(bit/格) | 解码成功率");
for (const r of results) {
  const s = schemes.find((x) => x.id === r.id)!;
  console.log(
    `${r.id} | ${s.cellPx} | ${s.symbolBits} | ${s.colorBits} | ${s.calibMode} | ${r.feasible ? "Y" : "N"} | ${fmt(
      r.cellErrorRate
    )} | ${fmt(r.netBitsPerCell)} | ${fmt(r.decodeSuccessRate)}`
  );
}
console.log(`\n推荐 safe 方案: ${recommended?.id ?? "无（需放宽约束）"}  净吞吐=${recommended ? fmt(recommended.netBitsPerCell) : "-"}`);

// 三组标定 → 档位
const models = loadAllModels();
const qlines = Object.keys(models).map((g) => `  - ${g}: d_rec≈${estimateDRec(models[g])} → ${getChannelQuality(models[g])}`);

// M7 改善表
const m7table = m7improve
  .map((m) => {
    const f = m.imp.improvementFactor;
    const fstr = m.imp.dense.cellErrorRate < 1e-9 ? "完全消除（改善 ≥1000×）" : `${f.toFixed(1)}×`;
    return `  - ${m.id}: 无校准格错误率=${fmt(m.imp.none.cellErrorRate)} → 密集校准=${fmt(
      m.imp.dense.cellErrorRate
    )}（${fstr}）`;
  })
  .join("\n");

const md = `# 调制擂台赛报告（MODULATION BAKEOFF）

> 生成时间：${new Date().toISOString()}
> 信道：web_auto（最差包络，safe 档依据）  σ_PSF=${fmt(channel.sigmaPsf)}  ρ=${fmt(channel.rho)}  γ=${fmt(
  channel.gamma
)}  CCM误差≈88  σ_Y=${fmt(channel.noiseSigmaY)}
> 梯度场：四角 tl=${channel.gradient.tl} tr=${channel.gradient.tr} bl=${channel.gradient.bl} br=${
  channel.gradient.br
}（非径向，线性）；局部高频以经验波纹建模（假设）。

## 1. 方案决策表（BER / 有效吞吐 / 抗梯度 / 解码成功率）

| 方案 | cellPx | symbolBits | colorBits | 校准 | 可行 | 格错误率 | 净吞吐 bit/格 | 解码成功率(RS255,223) |
|---|---|---|---|---|---|---|---|---|
${results
  .map((r) => {
    const s = schemes.find((x) => x.id === r.id)!;
    return `| ${r.id} | ${s.cellPx} | ${s.symbolBits} | ${s.colorBits} | ${s.calibMode} | ${
      r.feasible ? "Y" : "N(判死)"
    } | ${fmt(r.cellErrorRate)} | ${fmt(r.netBitsPerCell)} | ${fmt(r.decodeSuccessRate)} |`;
  })
  .join("\n")}

- 净吞吐 = 每格 bits × (1 − 校准格开销)；RS 额外开销因子 = ${fmt(RS_K_FACTOR)}（块级）。
- 解码成功率 = RS(255,223) 块级成功概率解析界：给定每格错误率 p，最多纠正 (255−223)/2=16 字节错误。

## 2. 密集校准 vs 无校准（用户核心关切：纯颜色 M7）

${m7table}

> 结论：无校准时非径向梯度使纯颜色方案大面积误判（格错误率高）；密集网格校准通过局部增益估计显著降低错误率。
> 四角校准（双线性）可纠正主梯度趋势，密集校准进一步校正局部高频，二者差距由局部波纹幅度决定（当前假设 ±13%）。
> 假设说明：仿真器中「校准格采样」读取的是同一梯度场的真值，故对建模梯度的校正接近完全消除；真实设备存在采样噪声与屏幕-相机空间错位，实测残余误差会更高。此处验证的是「密集校准机制在原理上可消除梯度」这一核心命题。

## 3. 档位决策（三组标定 → 推荐档位）

${qlines.join("\n")}

- safe 起步（网页自动模式最差包络 d_rec≈13）；锁定模式设备可达 fast（d_rec≈5）。

## 4. 推荐最终参数

- **safe 档（默认，跨设备）**：${recommended ? recommended.id + " 系列" : "需放宽"} —— cellPx=${schemes.find((s) => s.id === recommended?.id)?.cellPx ?? 13}，${
  recommended ? "净吞吐 " + fmt(recommended.netBitsPerCell) + " bit/格" : ""
}。
- 颜色位宽：默认 1（双色）；若密集校准实测证明 4 色可行再上调（见 M7b/c）。
- 符号集：8×8 二值点阵，最小汉明距离由离线寻优决定（见 src/shared/symbols.ts）。

## 5. 反证条件（推翻上述结论需的新证据）

- 若某方案在**真实手机拍摄**（非仿真）下格错误率显著高于仿真 → 仿真梯度/CCM/噪声模型需重标定。
- 若密集校准在真实设备无法就近放置可读参考色块（屏幕空间不足）→ 回退四角校准或降 colorBits。
- 若 PSF σ 实测随设备显著 >2.78 → safe 档需加大 cellPx。
`;

void writeFileSync(resolve(docsDir, "MODULATION_BAKEOFF.md"), md);
console.log(`\n报告已写入 ${resolve(docsDir, "MODULATION_BAKEOFF.md")}`);
