// 调制擂台赛仿真核心（纯 TS、零 DOM）：对给定方案在实测信道上扫 BER / 有效吞吐 / 解码成功率。
import type { ChannelModel, ModulationScheme } from "../shared/types.ts";
import { colorPalette } from "../shared/params.ts";
import { buildFrame, estimateGradAt, simulateColorCell, decodeColorCell, simulateSymbolCell, decodeSymbolCell, applyBandstop, type Rng } from "./channelSim.ts";
import { encodeCell, decodeCell, symbolSubset, bitsPerCellOf, popcount } from "./modulation.ts";
import { rsBlockSuccessProbability } from "./rs.ts";
import { RS_K, RS_N, MOIRE_ATT_SIGMA_DEFAULT } from "../shared/params.ts";
import type { TemporalAveraging } from "../shared/params.ts";

export interface BakeResult {
  id: string;
  feasible: boolean;
  cellErrorRate: number;
  ber: number;
  overhead: number;
  grossBitsPerCell: number;
  netBitsPerCell: number;
  rsOverheadFactor: number;
  decodeSuccessRate: number;
  notes: string;
}

function mulberry32(seed: number): Rng {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export interface RunOpts {
  cells?: number;
  seed?: number;
  moireIntensity?: number; // 摩尔纹强度（默认 0 = 不启用，保持原基线可复现）
  dealias?: "none" | "multiframe4" | "multiframe8" | "bandstop" | "combined"; // 解混叠模式
  temporalAveraging?: TemporalAveraging; // 时间平均帧数 N=1/4/8（等价并覆盖 dealias 的 multiframe 档）
  moireAttenuationSigma?: number; // 摩尔纹 OLPF σ（格）；缺省用 MOIRE_ATT_SIGMA_DEFAULT
}

export function runScheme(scheme: ModulationScheme, channel: ChannelModel, opts: RunOpts = {}): BakeResult {
  const cells = opts.cells ?? 1200;
  const seed = opts.seed ?? 12345;
  const moireI = opts.moireIntensity ?? 0;
  const dealias = opts.dealias ?? "none";
  const rng = mulberry32(seed);
  const cols = 40;
  const rows = Math.ceil(cells / cols);
  const frame = buildFrame(cols, rows, scheme.denseN, scheme.calibMode);
  const symbols = scheme.symbolBits > 0 ? symbolSubset(scheme.symbolBits) : [];
  const palette = colorPalette(scheme.colorBits);
  const bitsPerCell = bitsPerCellOf(scheme);
  const mAngle = channel.moireAngleDeg ?? 0;
  const mCycles = channel.moireCycles ?? 3;
  const mSigma = opts.moireAttenuationSigma ?? channel.moireAttenuationSigma ?? MOIRE_ATT_SIGMA_DEFAULT;
  const multiN = opts.temporalAveraging ?? (dealias.startsWith("multiframe") ? (dealias === "multiframe8" ? 8 : 4) : 1);

  // 两遍：先逐格仿真（可选多帧平均/摩尔纹），再可选频域带阻，最后统一解码统计。
  // 默认路径（moireI=0, dealias=none）与原实现逐位一致、结果可复现。
  const capGrid: (number[] | null)[][] = [];
  const valGrid: number[][] = [];
  const symCapGrid: (number[] | null)[][] = [];
  const calibGrid: number[][] = [];
  for (let r = 0; r < rows; r++) {
    capGrid.push(new Array(cols).fill(null));
    valGrid.push(new Array(cols).fill(0));
    symCapGrid.push(new Array(cols).fill(null));
    calibGrid.push(new Array(cols).fill(0));
  }

  let dataCells = 0;
  let calibCells = 0;
  for (const pos of frame.cells) {
    if (pos.isCalib) {
      calibCells++;
      continue;
    }
    dataCells++;
    const value = Math.floor(rng() * (1 << bitsPerCell));
    const code = encodeCell(scheme, value);
    valGrid[pos.row][pos.col] = value;
    const calibEstimate = estimateGradAt(pos, scheme.calibMode, channel, frame);
    calibGrid[pos.row][pos.col] = calibEstimate;

    if (scheme.symbolBits > 0) {
      const len = symbols[0].length;
      const acc = new Array<number>(len).fill(0);
      for (let k = 0; k < multiN; k++) {
        const rx = simulateSymbolCell(symbols[code.symbolIdx], scheme.cellPx, 8, pos.u, pos.v, channel, rng);
        for (let i = 0; i < len; i++) acc[i] += rx[i];
      }
      symCapGrid[pos.row][pos.col] = acc.map((x) => x / multiN);
    }

    if (scheme.colorBits > 0) {
      let cr = 0,
        cg = 0,
        cb = 0;
      for (let k = 0; k < multiN; k++) {
        const shift = multiN > 1 ? (k / multiN) * 2 * Math.PI : 0;
        const cap = simulateColorCell(
          palette[code.colorIdx],
          pos.u,
          pos.v,
          scheme.cellPx,
          calibEstimate,
          channel,
          rng,
          moireI > 0
            ? { intensity: moireI, angleDeg: mAngle, cycles: mCycles, phaseShift: shift, attenuationSigma: mSigma, frameCols: cols, frameRows: rows }
            : undefined
        );
        cr += cap[0];
        cg += cap[1];
        cb += cap[2];
      }
      capGrid[pos.row][pos.col] = [cr / multiN, cg / multiN, cb / multiN];
    } else {
      capGrid[pos.row][pos.col] = [0, 0, 0];
    }
  }

  // 频域带阻解混叠（基于已知摩尔纹频率）；combined = 多帧平均后再带阻
  if ((dealias === "bandstop" || dealias === "combined") && scheme.colorBits > 0) {
    applyBandstop(capGrid, mCycles, mAngle);
  }

  let totalBits = 0;
  let bitErrors = 0;
  let cellErrors = 0;
  for (const pos of frame.cells) {
    if (pos.isCalib) continue;
    const value = valGrid[pos.row][pos.col];
    const cap = capGrid[pos.row][pos.col]!;
    const calibEstimate = calibGrid[pos.row][pos.col];
    let symbolRx = 0;
    let colorRx = 0;
    if (scheme.symbolBits > 0) {
      const bits = (symCapGrid[pos.row][pos.col] as number[]).map((x) => (x > 0.5 ? 1 : 0));
      symbolRx = decodeSymbolCell(bits, symbols);
    }
    if (scheme.colorBits > 0) {
      colorRx = decodeColorCell(cap, palette, channel, calibEstimate);
    }
    const decoded = decodeCell(scheme, symbolRx, colorRx);
    if (decoded !== value) {
      cellErrors++;
      bitErrors += popcount(decoded ^ value);
    }
    totalBits += bitsPerCell;
  }

  const overhead = calibCells / frame.cells.length;
  const cellErrorRate = dataCells > 0 ? cellErrors / dataCells : 1;
  const ber = totalBits > 0 ? bitErrors / totalBits : 1;
  // 可行性：3×3 像素级在网页端实测不可行（d_rec≥5），cellPx<5 判死
  const feasible = scheme.cellPx >= 5;
  const netBits = bitsPerCell * (1 - overhead);
  // 每格承载 ≤1 字节（bitsPerCell≤8），格错误率≈该字节错误率
  const decodeSuccessRate = rsBlockSuccessProbability(cellErrorRate, RS_K, RS_N);

  return {
    id: scheme.id,
    feasible,
    cellErrorRate,
    ber,
    overhead,
    grossBitsPerCell: bitsPerCell,
    netBitsPerCell: netBits,
    rsOverheadFactor: RS_K / RS_N,
    decodeSuccessRate,
    notes: scheme.note
  };
}

// M7 纯颜色：同一方案在「无校准」与「密集校准」下对比，量化改善幅度
export function denseVsNoneImprovement(
  base: ModulationScheme,
  channel: ChannelModel,
  opts: RunOpts = {}
): { none: BakeResult; dense: BakeResult; improvementFactor: number } {
  const noneScheme: ModulationScheme = { ...base, calibMode: "none" };
  const denseScheme: ModulationScheme = { ...base, calibMode: "dense", denseN: base.denseN || 3 };
  const none = runScheme(noneScheme, channel, opts);
  const dense = runScheme(denseScheme, channel, opts);
  const improvementFactor = none.cellErrorRate > 0 ? none.cellErrorRate / Math.max(dense.cellErrorRate, 1e-9) : 1;
  return { none, dense, improvementFactor };
}
