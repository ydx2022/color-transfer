// 任务 10 · P1 全量细扫（纯颜色型为主 + 符号型拐点补测）
// 术语 v1.2：colCellPx / sub / N bit (M色) / 长度一律标【屏幕像素】。
// 物理模型与 v12 相同：解析盒到盒权重（= 超采样高斯卷积的连续极限）。
// 本版优化：预计算线性调色板与捕获域标称色、自适应蒙特卡洛（明显不可用者提前终止），以支撑上万组。
// 运行：npx tsx src/scripts/run_sweep_v13.ts
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
  gauss,
  buildFrame,
  blurKernel1D,
  boxToBoxWeight,
  convSymbolCell,
  type MoireOpts
} from "../core/channelSim.ts";
import { colorPalette } from "../shared/params.ts";

const here = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(here, "../../../calibration/out_sweep_v13");
mkdirSync(OUT, { recursive: true });

const SCREEN_W = 1920;
const SCREEN_H = 1080;
const FPS = 30;
const RS_N = 255;
const RS_T = 16;
const LT_BLOCKS = 1000;
const LT_EPS = 0.05;
const LT_DELTA = 0.01;

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
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return s * y;
}
const normSf = (z: number) => 0.5 * (1 - erf(z / Math.SQRT2));
const srgbToLin = (v: number) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
const linToSrgb = (v: number) => (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(Math.max(0, v), 1 / 2.4) - 0.055);
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

function rsBlockFail(q: number): number {
  if (q <= 0) return 0;
  const mu = RS_N * q;
  const sd = Math.sqrt(RS_N * q * (1 - q));
  if (sd <= 0) return mu > RS_T ? 1 : 0;
  return normSf((RS_T + 0.5 - mu) / sd);
}
function ltFileSuccess(pf: number): number {
  const M = Math.round(LT_BLOCKS * (1 + LT_EPS));
  const need = Math.ceil(LT_BLOCKS * (1 + LT_DELTA));
  const ps = 1 - pf;
  const mu = M * ps;
  const sd = Math.sqrt(M * ps * (1 - ps));
  if (sd <= 0) return mu >= need ? 1 : 0;
  return normSf((need - 0.5 - mu) / sd);
}
function calibOverhead(cellSide: number, mode: CalibMode, denseN: number): number {
  const cols = Math.max(1, Math.floor(SCREEN_W / cellSide));
  const rows = Math.max(1, Math.floor(SCREEN_H / cellSide));
  const total = cols * rows;
  if (mode === "none" || mode === "four_corner") return 4 / total;
  let pilots = 0;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (c % denseN === 0 && r % denseN === 0) pilots++;
  return pilots / total;
}

interface Row {
  group: string;
  family: string;
  channel: string;
  sigma_psf_screen_px: number;
  d_rec_screen_px: number;
  colCellPx_screen_px?: number;
  symRes?: string;
  sub_screen_px?: number;
  symCellPx_screen_px?: number;
  colorBits: number;
  colorFmt: string;
  calibMode: string;
  denseN: number;
  winFrac: number;
  pilotSide_screen_px: number;
  bitsPerCell: number;
  samples: number;
  cellErrRate: number;
  rsBlockFail: number;
  fileSuccess: number;
  meets: boolean;
  calibOverhead: number;
  netThroughput_bit_per_screenpx2: number;
  effectiveRate_MBps: number;
}
const rows: Row[] = [];
const fmtColor = (b: number) => (b === 0 ? "无颜色维度（单色底）" : `${b} bit (${1 << b}色)`);

function push(base: Omit<Row, "rsBlockFail" | "fileSuccess" | "meets" | "calibOverhead" | "netThroughput_bit_per_screenpx2" | "effectiveRate_MBps">, cellSide: number, bpc: number): void {
  const q = 1 - Math.pow(1 - base.cellErrRate, 8 / Math.max(bpc, 0.001));
  const pf = rsBlockFail(q);
  const succ = ltFileSuccess(pf);
  const ov = calibOverhead(cellSide, base.calibMode as unknown as CalibMode, base.denseN);
  const net = (bpc * (1 - ov)) / (cellSide * cellSide);
  rows.push({
    ...base,
    rsBlockFail: pf,
    fileSuccess: succ,
    meets: succ >= 0.999,
    calibOverhead: ov,
    netThroughput_bit_per_screenpx2: net,
    effectiveRate_MBps: (net * SCREEN_W * SCREEN_H * FPS) / 8 / 1e6
  });
}

// ---- P1-1 纯颜色型（自适应蒙特卡洛）----
function simColor(
  ch: ChannelModel,
  colCellPx: number,
  colorBits: number,
  mode: CalibMode,
  denseN: number,
  winFrac: number,
  pilotSide: number | null,
  moire: MoireOpts,
  batch = 400,
  maxSamples = 3000
): { cellErr: number; samples: number } {
  const palette = colorPalette(colorBits);
  const linPal = palette.map((c) => [srgbToLin(c[0]), srgbToLin(c[1]), srgbToLin(c[2])]);
  const capNom = palette.map((c) => ccmEncode(c, ch));
  const rnd = mulberry32(0x85ebca6b);
  const { k, R } = blurKernel1D(colCellPx, winFrac, ch.sigmaPsf);
  const wList: Array<{ dx: number; dy: number; w: number }> = [];
  let wSum = 0;
  for (let my = -R; my <= R; my++)
    for (let mx = -R; mx <= R; mx++) {
      const w = k[R + mx] * k[R + my];
      if (w <= 1e-9) continue;
      wList.push({ dx: mx, dy: my, w });
      wSum += w;
    }
  for (const e of wList) e.w /= wSum;

  const cols = Math.max(1, Math.floor(SCREEN_W / colCellPx));
  const rowsN = Math.max(1, Math.floor(SCREEN_H / colCellPx));
  const frame = buildFrame(cols, rowsN, denseN, mode);
  const winPx = winFrac * colCellPx;
  const noiseStd = ch.noiseSigmaY / 255 / Math.sqrt(Math.max(1, (winPx * ch.rho) ** 2));
  const pilotSelfW = pilotSide !== null ? boxToBoxWeight(-pilotSide / 2, pilotSide / 2, -pilotSide / 2, pilotSide / 2, ch.sigmaPsf) : 1;
  const pilotNoise = pilotSide !== null ? ch.noiseSigmaY / 255 / Math.max(1, Math.sqrt(Math.max(1, (pilotSide * ch.rho) ** 2))) : 0;

  let errs = 0;
  let done = 0;
  while (done < maxSamples) {
    for (let s = 0; s < batch && done < maxSamples; s++, done++) {
      const u = rnd();
      const v = rnd();
      const grad = trueGradAt(u, v, ch);
      const trueCol = (rnd() * palette.length) | 0;
      const mixed = [0, 0, 0];
      for (const e of wList) {
        const ci = e.dx === 0 && e.dy === 0 ? trueCol : (rnd() * palette.length) | 0;
        const lp = linPal[ci];
        mixed[0] += e.w * lp[0];
        mixed[1] += e.w * lp[1];
        mixed[2] += e.w * lp[2];
      }
      const ms = [linToSrgb(mixed[0]), linToSrgb(mixed[1]), linToSrgb(mixed[2])];
      const nominal = ccmEncode(ms as number[], ch);
      const mc = moireContamination(u, v, moire);
      const cap = [0, 0, 0];
      for (let i = 0; i < 3; i++) cap[i] = clamp01(nominal[i] * grad + gauss(rnd) * noiseStd + mc[i]);

      let est: number;
      if (pilotSide !== null) {
        const nb = (rnd() * palette.length) | 0;
        const pm = [0, 0, 0];
        for (let i = 0; i < 3; i++) pm[i] = pilotSelfW * linPal[trueCol][i] + (1 - pilotSelfW) * linPal[nb][i];
        const pn = ccmEncode([linToSrgb(pm[0]), linToSrgb(pm[1]), linToSrgb(pm[2])] as number[], ch);
        let num = 0;
        let den = 0;
        for (let i = 0; i < 3; i++) {
          num += pn[i] + gauss(rnd) * pilotNoise;
          den += capNom[trueCol][i];
        }
        est = grad * (num / Math.max(1e-6, den));
        if (!isFinite(est) || est <= 0) est = grad;
      } else {
        est = estimateGradAt({ col: (u * cols) | 0, row: (v * rowsN) | 0, u, v, isCalib: false }, mode, ch, frame);
      }
      const corr = [cap[0] / est, cap[1] / est, cap[2] / est];
      let best = 0;
      let bd = Infinity;
      for (let p = 0; p < capNom.length; p++) {
        const nom = capNom[p];
        const d = (nom[0] - corr[0]) ** 2 + (nom[1] - corr[1]) ** 2 + (nom[2] - corr[2]) ** 2;
        if (d < bd) {
          bd = d;
          best = p;
        }
      }
      if (best !== trueCol) errs++;
    }
    // 自适应：明显不可用者提前终止（后续仅用于归档，不参与排名）
    if (done >= batch && errs / done > 0.12) break;
  }
  return { cellErr: errs / done, samples: done };
}

// ---- P1-2 符号型拐点补测 ----
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
      if (set.length === 0) dmin = -Math.abs(p.reduce((a, b) => a + b, 0) - len / 2);
      if (dmin > bestD) {
        bestD = dmin;
        best = p;
      }
    }
    set.push(best);
  }
  return set;
}
const SYM8 = genSymbolSet(8, 16, 0x5eed1234);
const SYM4 = genSymbolSet(4, 16, 0x5eed1234);

function simSymbol(ch: ChannelModel, symRes: number, sub: number, samples: number): number {
  const symSet = symRes === 8 ? SYM8 : SYM4;
  const rnd = mulberry32(0x9e3779b9);
  const darkLum = 0.06;
  const bgLum = 0.5; // (4,0) bit：单色底，符号型最优形态
  const noiseStd = ch.noiseSigmaY / 255 / Math.max(1, Math.sqrt(Math.max(1, (sub * ch.rho) ** 2)));
  let errs = 0;
  for (let s = 0; s < samples; s++) {
    const grad = trueGradAt(rnd(), rnd(), ch);
    const trueSym = (rnd() * symSet.length) | 0;
    const nbSym = new Map<string, number>();
    const levels = (gx: number, gy: number, cx: number, cy: number): number => {
      if (cx === 0 && cy === 0) return symSet[trueSym][gy * symRes + gx] ? darkLum : bgLum;
      const key = `${cx},${cy}`;
      let si = nbSym.get(key);
      if (si === undefined) {
        si = (rnd() * symSet.length) | 0;
        nbSym.set(key, si);
      }
      return symSet[si][gy * symRes + gx] ? darkLum : bgLum;
    };
    const obs = convSymbolCell(symRes, sub, ch.sigmaPsf, levels, 1, 3);
    let mn = Infinity;
    let mx = -Infinity;
    const lv = new Float64Array(obs.length);
    for (let i = 0; i < obs.length; i++) {
      lv[i] = grad * obs[i] + gauss(rnd) * noiseStd;
      mn = Math.min(mn, lv[i]);
      mx = Math.max(mx, lv[i]);
    }
    const thr = (mn + mx) / 2;
    let bestI = 0;
    let bestD = Infinity;
    for (let k = 0; k < symSet.length; k++) {
      let d = 0;
      for (let i = 0; i < obs.length; i++) if ((lv[i] < thr ? 1 : 0) !== symSet[k][i]) d++;
      if (d < bestD) {
        bestD = d;
        bestI = k;
      }
    }
    if (bestI !== trueSym) errs++;
  }
  return errs / samples;
}

const CHANNELS: Array<[string, ChannelModel]> = [
  ["native", loadChannelModel("native")],
  ["web_locked", loadChannelModel("web_locked")],
  ["web_auto", loadChannelModel("web_auto")]
];
const moireOf = (ch: ChannelModel): MoireOpts => ({
  intensity: ch.moireIntensity,
  angleDeg: ch.moireAngleDeg,
  cycles: ch.moireCycles,
  attenuationSigma: ch.moireAttenuationSigma,
  frameCols: 24,
  frameRows: 16
});

const CALIBS: Array<[CalibMode, number, string]> = [
  ["none", 0, "无"],
  ["four_corner", 0, "四角"],
  ["dense", 3, "密集 N=3"],
  ["dense", 4, "密集 N=4"]
];

// ---- P1-1 ----
let combos = 0;
for (const [cname, ch] of CHANNELS) {
  const moire = moireOf(ch);
  const dRec = Math.ceil(4.5 * ch.sigmaPsf);
  for (let colCellPx = 3; colCellPx <= 16; colCellPx++) {
    for (const cb of [1, 2, 3, 4, 5]) {
      for (const [mode, dn, label] of CALIBS) {
        for (const wf of [0.25, 1 / 3, 0.5, 2 / 3, 1.0]) {
          const pilots: Array<number | null> = mode === "none" ? [null] : [colCellPx, 5, 8, 13];
          for (const ps of pilots) {
            const r = simColor(ch, colCellPx, cb, mode, dn, wf, ps, moire);
            combos++;
            push(
              {
                group: "P1-1",
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
                pilotSide_screen_px: ps === null ? 0 : ps,
                bitsPerCell: cb,
                samples: r.samples,
                cellErrRate: r.cellErr
              },
              colCellPx,
              cb
            );
          }
        }
      }
    }
  }
  console.log(`P1-1 ${cname} 完成，累计 ${rows.length} 行`);
}

// ---- P1-2 ----
for (const [cname, ch] of CHANNELS) {
  const dRec = Math.ceil(4.5 * ch.sigmaPsf);
  for (const symRes of [4, 8]) {
    for (const sub of [3, 3.5, 4, 4.5, 5]) {
      const cellErr = simSymbol(ch, symRes, sub, 500);
      push(
        {
          group: "P1-2",
          family: "符号型",
          channel: cname,
          sigma_psf_screen_px: ch.sigmaPsf,
          d_rec_screen_px: dRec,
          symRes: `${symRes}×${symRes}`,
          sub_screen_px: sub,
          symCellPx_screen_px: symRes * sub,
          colorBits: 0,
          colorFmt: fmtColor(0),
          calibMode: "四角",
          denseN: 0,
          winFrac: 1,
          pilotSide_screen_px: 0,
          bitsPerCell: 4,
          samples: 500,
          cellErrRate: cellErr
        },
        symRes * sub,
        4
      );
    }
  }
}
console.log(`P1-2 完成，累计 ${rows.length} 行（纯颜色型组合 ${combos} 组）`);

const headers = [
  "group", "family", "channel", "sigma_psf_screen_px", "d_rec_screen_px",
  "colCellPx_screen_px", "symRes", "sub_screen_px", "symCellPx_screen_px",
  "colorBits", "colorFmt", "calibMode", "denseN", "winFrac", "pilotSide_screen_px",
  "bitsPerCell", "samples", "cellErrRate", "rsBlockFail", "fileSuccess", "meets",
  "calibOverhead", "netThroughput_bit_per_screenpx2", "effectiveRate_MBps"
];
const csv = [headers.join(",")]
  .concat(rows.map((r) => headers.map((h) => String((r as unknown as Record<string, unknown>)[h] ?? "")).join(",")))
  .join("\n");
writeFileSync(resolve(OUT, "sweep_full.csv"), csv);
console.log(`\nCSV → ${OUT}/sweep_full.csv（${rows.length} 行）`);
console.log(`满足硬约束的组合数：${rows.filter((r) => r.meets).length} / ${rows.length}`);
