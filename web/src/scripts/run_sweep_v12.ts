// 任务 9 · 参数定案后的全量擂台赛重扫（A/B/C/D 四组）
// 术语遵循 docs/术语规范_GLOSSARY.md v1.2：symCellPx/colCellPx 分离、N bit (M色)、长度标「屏幕像素」。
//
// 物理模型：局域盒式渲染 → 真实高斯卷积 → 采样窗取平均（channelSim.ts 的解析盒到盒权重实现）。
// 纠错模型：RS(255,223) 纠 t=16 错 → LT 喷泉（开销 ε=5%，需收够 N·(1+δ)）→ 整文件解码成功率。
// 运行：npx tsx src/scripts/run_sweep_v12.ts
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { loadChannelModel } from "../core/calibration.ts";
import type { ChannelModel, CalibMode } from "../shared/types.ts";
import {
  trueGradAt,
  estimateGradAt,
  ccmEncode,
  moireContamination,
  olpfAttenuation,
  gauss,
  buildFrame,
  blurKernel1D,
  boxToBoxWeight,
  convSymbolCell,
  type MoireOpts
} from "../core/channelSim.ts";
import { colorPalette } from "../shared/params.ts";

const here = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(here, "../../../calibration/out_sweep_v12");
mkdirSync(OUT, { recursive: true });

// ---- 参考屏与纠错模型常数 ----
const SCREEN_W = 1920;
const SCREEN_H = 1080;
const FPS = 30;
const RS_N = 255;
const RS_T = 16; // 可纠错误字节数
const LT_BLOCKS = 1000; // 代表文件：1000 个数据块
const LT_EPS = 0.05; // 喷泉开销 5%
const LT_DELTA = 0.01; // 鲁棒孤波分布额外需求 1%

// ---- 工具 ----
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function erf(z: number): number {
  const s = z < 0 ? -1 : 1;
  const x = Math.abs(z);
  const t = 1 / (1 + 0.3275911 * x);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-x * x);
  return s * y;
}
const normSf = (z: number) => 0.5 * (1 - erf(z / Math.SQRT2)); // 1 − Φ(z)
const lum = (c: number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const srgbToLin = (v: number) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
const linToSrgb = (v: number) => (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(Math.max(0, v), 1 / 2.4) - 0.055);
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

// P(Bin(n,p) > t) 的正态近似
function rsBlockFail(q: number, n = RS_N, t = RS_T): number {
  if (q <= 0) return 0;
  if (q >= 1) return 1;
  const mu = n * q;
  const sd = Math.sqrt(n * q * (1 - q));
  if (sd <= 0) return mu > t ? 1 : 0;
  return normSf((t + 0.5 - mu) / sd);
}
// LT：发 M=N(1+ε) 个编码包，需 ≥ N(1+δ) 个 RS 解码成功
function ltFileSuccess(pf: number, N = LT_BLOCKS, eps = LT_EPS, delta = LT_DELTA): number {
  const M = Math.round(N * (1 + eps));
  const need = Math.ceil(N * (1 + delta));
  const ps = 1 - pf;
  const mu = M * ps;
  const sd = Math.sqrt(M * ps * (1 - ps));
  if (sd <= 0) return mu >= need ? 1 : 0;
  return normSf((need - 0.5 - mu) / sd);
}

// 校准开销（按实际数据格边长与屏幕重算，v1.2 §16）
function calibOverhead(cellSide: number, mode: CalibMode, denseN: number): number {
  const cols = Math.max(1, Math.floor(SCREEN_W / cellSide));
  const rows = Math.max(1, Math.floor(SCREEN_H / cellSide));
  const total = cols * rows;
  if (mode === "none" || mode === "four_corner") return 4 / total; // 仅四角锚点
  let pilots = 0;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (c % denseN === 0 && r % denseN === 0) pilots++;
  return pilots / total;
}

// 符号集（symRes=4 时库内只有 8×8，需按同样「最大最小汉明距离」原则生成 4×4 集）
function genSymbolSet(res: number, count: number, seed: number): number[][] {
  const rnd = mulberry32(seed);
  const len = res * res;
  const set: number[][] = [];
  for (let i = 0; i < count; i++) {
    let best: number[] = new Array(len).fill(0);
    let bestD = -1;
    for (let t = 0; t < 300; t++) {
      const p = new Array(len).fill(0);
      for (let j = 0; j < len; j++) p[j] = rnd() < 0.5 ? 1 : 0;
      let dmin = Infinity;
      for (const s of set) {
        let d = 0;
        for (let j = 0; j < len; j++) if (p[j] !== s[j]) d++;
        dmin = Math.min(dmin, d);
      }
      if (set.length === 0) dmin = -Math.abs(p.reduce((a, b) => a + b, 0) - len / 2); // 首图取近半占比
      if (dmin > bestD) {
        bestD = dmin;
        best = p;
      }
    }
    set.push(best);
  }
  return set;
}
function minDist(set: number[][]): number {
  let m = Infinity;
  for (let i = 0; i < set.length; i++)
    for (let j = i + 1; j < set.length; j++) {
      let d = 0;
      for (let k = 0; k < set[i].length; k++) if (set[i][k] !== set[j][k]) d++;
      m = Math.min(m, d);
    }
  return m;
}
const SYM8 = genSymbolSet(8, 16, 0x5eed1234);
const SYM4 = genSymbolSet(4, 16, 0x5eed1234);

// ---- 单组结果 ----
interface Row {
  group: string;
  family: string;
  channel: string;
  sigma_psf_screen_px: number;
  d_rec_screen_px: number;
  symRes?: string;
  sub_screen_px?: number;
  symCellPx_screen_px?: number;
  colCellPx_screen_px?: number;
  colorBits: number;
  colorFmt: string;
  calibMode: string;
  denseN: number;
  winFrac: number;
  pilotSide_screen_px?: number;
  frames: number;
  bitsPerCell: number;
  cellErrRate: number;
  bitErrRate: number;
  rsBlockFail: number;
  fileSuccess: number;
  meets: boolean;
  calibOverhead: number;
  netThroughput_bit_per_screenpx2: number;
  effectiveRate_MBps: number;
}
const rows: Row[] = [];

const fmtColor = (b: number) => (b === 0 ? "无颜色维度（单色底）" : `${b} bit (${1 << b}色)`);

// ============================================================================
// 符号型模拟（A 组）
// ============================================================================
function simSymbol(
  ch: ChannelModel,
  symRes: number,
  sub: number,
  colorBits: number,
  calibMode: CalibMode,
  denseN: number,
  samples: number,
  moire: MoireOpts
): { cellErr: number; ber: number } {
  const symSet = symRes === 8 ? SYM8 : SYM4;
  const palette = colorPalette(colorBits);
  const rnd = mulberry32(0x9e3779b9);
  const symCellPx = symRes * sub;
  const cols = Math.max(1, Math.floor(SCREEN_W / symCellPx));
  const rowsN = Math.max(1, Math.floor(SCREEN_H / symCellPx));
  const frame = buildFrame(cols, rowsN, denseN, calibMode);
  const darkLum = 0.06;
  const noisePerDot = ch.noiseSigmaY / 255 / Math.max(1, Math.sqrt(Math.max(1, (sub * ch.rho) ** 2)));

  let errCells = 0;
  let errBits = 0;
  let totBits = 0;
  const nSym = symSet.length;
  for (let s = 0; s < samples; s++) {
    const u = rnd();
    const v = rnd();
    const grad = trueGradAt(u, v, ch);
    const trueSym = Math.floor(rnd() * nSym);
    const trueCol = colorBits > 0 ? Math.floor(rnd() * palette.length) : 0;
    const bgLum = colorBits > 0 ? lum(palette[trueCol]) : 0.5;

    // 邻格内容（随机符号 + 随机颜色）
    const nbSym = new Map<string, number>();
    const nbCol = new Map<string, number>();
    const levels = (gx: number, gy: number, cx: number, cy: number): number => {
      if (cx === 0 && cy === 0) {
        return symSet[trueSym][gy * symRes + gx] ? darkLum : bgLum;
      }
      const key = `${cx},${cy}`;
      let si = nbSym.get(key);
      if (si === undefined) {
        si = Math.floor(rnd() * nSym);
        nbSym.set(key, si);
        const ci = colorBits > 0 ? Math.floor(rnd() * palette.length) : 0;
        nbCol.set(key, ci);
      }
      const ci = nbCol.get(key)!;
      const nbBg = colorBits > 0 ? lum(palette[ci]) : 0.5;
      return symSet[si][gy * symRes + gx] ? darkLum : nbBg;
    };

    const obs = convSymbolCell(symRes, sub, ch.sigmaPsf, levels, 1, 3);
    // 梯度 + 噪声；解码端按格内 min/max 自适应阈值（不知增益）
    let mn = Infinity;
    let mx = -Infinity;
    const lv = new Float64Array(obs.length);
    for (let i = 0; i < obs.length; i++) {
      lv[i] = grad * obs[i] + gauss(rnd) * noisePerDot;
      mn = Math.min(mn, lv[i]);
      mx = Math.max(mx, lv[i]);
    }
    const thr = (mn + mx) / 2;
    let bits = new Array<number>(obs.length);
    for (let i = 0; i < obs.length; i++) bits[i] = lv[i] < thr ? 1 : 0; // 1 = 暗点
    let bestI = 0;
    let bestD = Infinity;
    for (let k = 0; k < nSym; k++) {
      let d = 0;
      for (let i = 0; i < obs.length; i++) if (bits[i] !== symSet[k][i]) d++;
      if (d < bestD) {
        bestD = d;
        bestI = k;
      }
    }
    // 颜色维度：用格内均值电平判底色（含邻格混色，由 obs 已体现）
    let meanLv = 0;
    for (let i = 0; i < lv.length; i++) meanLv += lv[i];
    meanLv /= lv.length;
    let colDec = 0;
    if (colorBits > 0) {
      let bd = Infinity;
      for (let p = 0; p < palette.length; p++) {
        const expLv = grad * (0.5 * lum(palette[p]) + 0.5 * darkLum);
        const d = Math.abs(expLv - meanLv);
        if (d < bd) {
          bd = d;
          colDec = p;
        }
      }
    }
    const symErr = bestI !== trueSym;
    const colErr = colorBits > 0 && colDec !== trueCol;
    if (symErr || colErr) errCells++;
    // 比特错误数（按位比较）
    let be = 0;
    if (symErr) be += Math.log2(nSym);
    if (colErr) be += colorBits;
    errBits += be;
    totBits += Math.log2(nSym) + colorBits;
  }
  return { cellErr: errCells / samples, ber: totBits ? errBits / totBits : 0 };
}

// ============================================================================
// 纯颜色型模拟（B/C/D 组共用）
// ============================================================================
function simColor(
  ch: ChannelModel,
  colCellPx: number,
  colorBits: number,
  calibMode: CalibMode,
  denseN: number,
  winFrac: number,
  samples: number,
  temporalN: number,
  moire: MoireOpts,
  pilotSide: number | null
): { cellErr: number; ber: number } {
  const palette = colorPalette(colorBits);
  const rnd = mulberry32(0x85ebca6b);
  const { k, R } = blurKernel1D(colCellPx, winFrac, ch.sigmaPsf);
  // 邻域权重（中心 + 邻格）
  const wList: Array<{ dx: number; dy: number; w: number }> = [];
  let wSelf = 0;
  let wSum = 0;
  for (let my = -R; my <= R; my++) {
    for (let mx = -R; mx <= R; mx++) {
      const w = k[R + mx] * k[R + my];
      if (w <= 1e-9) continue;
      wList.push({ dx: mx, dy: my, w });
      wSum += w;
      if (mx === 0 && my === 0) wSelf = w;
    }
  }
  for (const e of wList) e.w /= wSum;

  const cols = Math.max(1, Math.floor(SCREEN_W / colCellPx));
  const rowsN = Math.max(1, Math.floor(SCREEN_H / colCellPx));
  const frame = buildFrame(cols, rowsN, denseN, calibMode);
  const winPx = winFrac * colCellPx;
  const nSamplesPx = Math.max(1, (winPx * ch.rho) ** 2);
  const noiseStd = (ch.noiseSigmaY / 255 / Math.sqrt(nSamplesPx)) / Math.sqrt(temporalN);
  const moireScale = 1 / Math.sqrt(temporalN);

  // 校准格自身采样误差（C 组）：pilotSide ≠ null 时启用
  let pilotSelfW = 1;
  if (pilotSide !== null) {
    const half = pilotSide / 2;
    pilotSelfW = boxToBoxWeight(-half, half, -half, half, ch.sigmaPsf);
  }
  const pilotNoiseStd = pilotSide !== null ? ch.noiseSigmaY / 255 / Math.max(1, Math.sqrt(Math.max(1, (pilotSide * ch.rho) ** 2))) : 0;

  let errCells = 0;
  let errBits = 0;
  let totBits = 0;
  for (let s = 0; s < samples; s++) {
    const u = rnd();
    const v = rnd();
    const grad = trueGradAt(u, v, ch);
    const trueCol = Math.floor(rnd() * palette.length);
    // 混色（线性光域混合，物理正确）
    const mixed = [0, 0, 0];
    for (const e of wList) {
      let c: number[];
      if (e.dx === 0 && e.dy === 0) c = palette[trueCol];
      else c = palette[Math.floor(rnd() * palette.length)];
      for (let i = 0; i < 3; i++) mixed[i] += e.w * srgbToLin(c[i]);
    }
    const mixedSrgb = [linToSrgb(mixed[0]), linToSrgb(mixed[1]), linToSrgb(mixed[2])];
    const nominal = ccmEncode(mixedSrgb, ch);
    const mc = moireContamination(u, v, moire);
    const cap: number[] = [];
    for (let i = 0; i < 3; i++) cap[i] = clamp01(nominal[i] * grad + gauss(rnd) * noiseStd + mc[i] * moireScale);

    // 增益估计
    let est: number;
    if (pilotSide !== null) {
      // C 组：校准格自身被糊 → 估计含误差
      const nb = palette[Math.floor(rnd() * palette.length)];
      const pm: number[] = [0, 0, 0];
      for (let i = 0; i < 3; i++) pm[i] = pilotSelfW * srgbToLin(palette[trueCol][i]) + (1 - pilotSelfW) * srgbToLin(nb[i]);
      const pmSrgb = [linToSrgb(pm[0]), linToSrgb(pm[1]), linToSrgb(pm[2])];
      const pn = ccmEncode(pmSrgb, ch);
      const expN = ccmEncode(palette[trueCol], ch);
      let num = 0;
      let den = 0;
      for (let i = 0; i < 3; i++) {
        num += pn[i] + gauss(rnd) * pilotNoiseStd;
        den += expN[i];
      }
      est = grad * (num / Math.max(1e-6, den));
      if (!isFinite(est) || est <= 0) est = grad;
    } else {
      est = estimateGradAt({ col: Math.floor(u * cols), row: Math.floor(v * rowsN), u, v, isCalib: false }, calibMode, ch, frame);
    }
    const corr = [cap[0] / est, cap[1] / est, cap[2] / est];
    let best = 0;
    let bd = Infinity;
    for (let p = 0; p < palette.length; p++) {
      const nom = ccmEncode(palette[p], ch);
      const d = (nom[0] - corr[0]) ** 2 + (nom[1] - corr[1]) ** 2 + (nom[2] - corr[2]) ** 2;
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    if (best !== trueCol) {
      errCells++;
      let be = 0;
      let a = best;
      let b = trueCol;
      while (a > 0 || b > 0) {
        if ((a & 1) !== (b & 1)) be++;
        a >>= 1;
        b >>= 1;
      }
      errBits += be;
    }
    totBits += colorBits;
  }
  return { cellErr: errCells / samples, ber: totBits ? errBits / totBits : 0 };
}

function push(row: Omit<Row, "rsBlockFail" | "fileSuccess" | "meets" | "netThroughput_bit_per_screenpx2" | "effectiveRate_MBps" | "calibOverhead">, cellSide: number, bpc: number): void {
  const q = 1 - Math.pow(1 - row.cellErrRate, 8 / Math.max(bpc, 0.001)); // 每字节错误概率
  const pf = rsBlockFail(q);
  const succ = ltFileSuccess(pf);
  const ov = calibOverhead(cellSide, row.calibMode as CalibMode, row.denseN);
  const net = (bpc * (1 - ov)) / (cellSide * cellSide);
  const rate = (net * SCREEN_W * SCREEN_H * FPS) / 8 / 1e6; // MB/s
  rows.push({ ...row, rsBlockFail: pf, fileSuccess: succ, meets: succ >= 0.999, calibOverhead: ov, netThroughput_bit_per_screenpx2: net, effectiveRate_MBps: rate });
}

// ============================================================================
const CHANNELS: Array<[string, ChannelModel]> = [
  ["native", loadChannelModel("native")],
  ["web_locked", loadChannelModel("web_locked")],
  ["web_auto", loadChannelModel("web_auto")]
];
function moireOf(ch: ChannelModel): MoireOpts {
  return {
    intensity: ch.moireIntensity,
    angleDeg: ch.moireAngleDeg,
    cycles: ch.moireCycles,
    attenuationSigma: ch.moireAttenuationSigma,
    frameCols: 24,
    frameRows: 16
  };
}

console.log(`符号集最小汉明距离：8×8 = ${minDist(SYM8)}；4×4 = ${minDist(SYM4)}`);

// ---- A 组：符号型（独立扫 sub）----
for (const [cname, ch] of CHANNELS) {
  const moire = moireOf(ch);
  const dRec = Math.ceil(4.5 * ch.sigmaPsf);
  for (const symRes of [4, 8]) {
    for (const sub of [1, 1.5, 2, 3, 5, 8, 13]) {
      for (const cb of [0, 2]) {
        const symCellPx = symRes * sub;
        const r = simSymbol(ch, symRes, sub, cb, "four_corner", 0, 600, moire);
        const bpc = Math.log2(symRes === 8 ? SYM8.length : SYM4.length) + cb;
        push(
          {
            group: "A",
            family: "符号型",
            channel: cname,
            sigma_psf_screen_px: ch.sigmaPsf,
            d_rec_screen_px: dRec,
            symRes: `${symRes}×${symRes}`,
            sub_screen_px: sub,
            symCellPx_screen_px: symCellPx,
            colorBits: cb,
            colorFmt: fmtColor(cb),
            calibMode: "四角",
            denseN: 0,
            winFrac: 1,
            frames: 1,
            bitsPerCell: bpc,
            cellErrRate: r.cellErr,
            bitErrRate: r.ber
          },
          symCellPx,
          bpc
        );
      }
    }
  }
}
console.log(`A 组完成：${rows.length} 行`);

// ---- B 组：纯颜色型（扫 colCellPx × colorBits × 校准 × 采样窗口比例）----
for (const [cname, ch] of CHANNELS) {
  const moire = moireOf(ch);
  const dRec = Math.ceil(4.5 * ch.sigmaPsf);
  for (const colCellPx of [3, 5, 8, 13]) {
    for (const cb of [1, 2, 3, 4, 5]) {
      for (const [mode, dn, label] of [
        ["none", 0, "无"],
        ["four_corner", 0, "四角"],
        ["dense", 3, "密集N=3"],
        ["dense", 4, "密集N=4"]
      ] as Array<[CalibMode, number, string]>) {
        for (const wf of [1 / 3, 1 / 2, 2 / 3, 1.0]) {
          const r = simColor(ch, colCellPx, cb, mode, dn, wf, 3000, 1, moire, null);
          push(
            {
              group: "B",
              family: "纯颜色型",
              channel: cname,
              sigma_psf_screen_px: ch.sigmaPsf,
              d_rec_screen_px: dRec,
              colCellPx_screen_px: colCellPx,
              colorBits: cb,
              colorFmt: fmtColor(cb),
              calibMode: label,
              denseN: dn,
              winFrac: wf,
              frames: 1,
              bitsPerCell: cb,
              cellErrRate: r.cellErr,
              bitErrRate: r.ber
            },
            colCellPx,
            cb
          );
        }
      }
    }
  }
}
console.log(`B 组完成：${rows.length} 行`);

// ---- C 组：校准格尺寸（挂 B 组各信道最优候选）----
for (const [cname, ch] of CHANNELS) {
  const moire = moireOf(ch);
  const dRec = Math.ceil(4.5 * ch.sigmaPsf);
  const best = rows
    .filter((r) => r.group === "B" && r.channel === cname && r.meets)
    .sort((a, b) => b.netThroughput_bit_per_screenpx2 - a.netThroughput_bit_per_screenpx2)[0];
  if (!best) {
    console.log(`[C 组] ${cname}：B 组无满足硬约束的候选，跳过`);
    continue;
  }
  const mode: CalibMode = best.calibMode === "无" ? "none" : best.calibMode === "四角" ? "four_corner" : "dense";
  for (const pilotSide of [1, 2, best.colCellPx_screen_px!, 5]) {
    const r = simColor(ch, best.colCellPx_screen_px!, best.colorBits, mode, best.denseN, best.winFrac, 3000, 1, moire, pilotSide);
    push(
      {
        group: "C",
        family: "纯颜色型",
        channel: cname,
        sigma_psf_screen_px: ch.sigmaPsf,
        d_rec_screen_px: dRec,
        colCellPx_screen_px: best.colCellPx_screen_px,
        colorBits: best.colorBits,
        colorFmt: best.colorFmt,
        calibMode: best.calibMode,
        denseN: best.denseN,
        winFrac: best.winFrac,
        pilotSide_screen_px: pilotSide,
        frames: 1,
        bitsPerCell: best.colorBits,
        cellErrRate: r.cellErr,
        bitErrRate: r.ber
      },
      best.colCellPx_screen_px!,
      best.colorBits
    );
  }
}
console.log(`C 组完成：${rows.length} 行`);

// ---- D 组：多帧时间平均（挂 B 组各信道最优候选）----
for (const [cname, ch] of CHANNELS) {
  const moire = moireOf(ch);
  const dRec = Math.ceil(4.5 * ch.sigmaPsf);
  const best = rows
    .filter((r) => r.group === "B" && r.channel === cname && r.meets)
    .sort((a, b) => b.netThroughput_bit_per_screenpx2 - a.netThroughput_bit_per_screenpx2)[0];
  if (!best) {
    console.log(`[D 组] ${cname}：B 组无满足硬约束的候选，跳过`);
    continue;
  }
  const mode: CalibMode = best.calibMode === "无" ? "none" : best.calibMode === "四角" ? "four_corner" : "dense";
  for (const N of [1, 4, 8]) {
    const r = simColor(ch, best.colCellPx_screen_px!, best.colorBits, mode, best.denseN, best.winFrac, 3000, N, moire, null);
    push(
      {
        group: "D",
        family: "纯颜色型",
        channel: cname,
        sigma_psf_screen_px: ch.sigmaPsf,
        d_rec_screen_px: dRec,
        colCellPx_screen_px: best.colCellPx_screen_px,
        colorBits: best.colorBits,
        colorFmt: best.colorFmt,
        calibMode: best.calibMode,
        denseN: best.denseN,
        winFrac: best.winFrac,
        frames: N,
        bitsPerCell: best.colorBits,
        cellErrRate: r.cellErr,
        bitErrRate: r.ber
      },
      best.colCellPx_screen_px!,
      best.colorBits
    );
  }
}
console.log(`D 组完成：${rows.length} 行`);

// ---- 输出 CSV ----
const headers = [
  "group", "family", "channel", "sigma_psf_screen_px", "d_rec_screen_px",
  "symRes", "sub_screen_px", "symCellPx_screen_px", "colCellPx_screen_px",
  "colorBits", "colorFmt", "calibMode", "denseN", "winFrac", "pilotSide_screen_px", "frames",
  "bitsPerCell", "cellErrRate", "bitErrRate", "rsBlockFail", "fileSuccess", "meets",
  "calibOverhead", "netThroughput_bit_per_screenpx2", "effectiveRate_MBps"
];
const csv = [headers.join(",")]
  .concat(
    rows.map((r) =>
      headers
        .map((h) => {
          const v = (r as unknown as Record<string, unknown>)[h];
          return v === undefined || v === null ? "" : typeof v === "number" ? String(v) : String(v);
        })
        .join(",")
    )
  )
  .join("\n");
writeFileSync(resolve(OUT, "sweep_full.csv"), csv);
console.log(`\nCSV → ${OUT}/sweep_full.csv（${rows.length} 行）`);
console.log(`满足硬约束（整文件解码成功率 ≥99.9%）的组合数：${rows.filter((r) => r.meets).length} / ${rows.length}`);
