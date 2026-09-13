// 可视化分析：在给定方案/信道上对网格逐格仿真，产出每格错误率与误码标记。
import type { ChannelModel, ModulationScheme, CalibMode } from "../shared/types.ts";
import {
  buildFrame,
  estimateGradAt,
  simulateColorCell,
  decodeColorCell,
  simulateSymbolCell,
  decodeSymbolCell,
  type Rng
} from "../core/channelSim.ts";
import { encodeCell, decodeCell, symbolSubset, bitsPerCellOf, popcount } from "../core/modulation.ts";
import { colorPalette } from "../shared/params.ts";
import { mulberry32 } from "./rng.ts";

export interface GridResult {
  cols: number;
  rows: number;
  errorFrac: number[][]; // 每数据格内的比特错误率 BER（0..1）= 判错 bit 数 / 该格总 bit 数（注意：不等于格错误率）
  wrong: boolean[][]; // 每格是否整格误码
  truth: number[][]; // 每格真值
  decoded: number[][]; // 每格解码值（用于校准对比）
}

// 对网格逐格 run：calibOverride 可强制 none/dense 以做校准对比
export function runGrid(
  scheme: ModulationScheme,
  channel: ChannelModel,
  cols: number,
  rows: number,
  seed: number,
  calibOverride?: CalibMode
): GridResult {
  const rng = mulberry32(seed);
  const mode = calibOverride ?? scheme.calibMode;
  const denseN = mode === "dense" ? scheme.denseN : 0;
  const frame = buildFrame(cols, rows, denseN, mode);
  const symbols = scheme.symbolBits > 0 ? symbolSubset(scheme.symbolBits) : [];
  const palette = colorPalette(scheme.colorBits);
  const bpc = bitsPerCellOf(scheme);

  const errorFrac: number[][] = [];
  const wrong: boolean[][] = [];
  const truth: number[][] = [];
  const decoded: number[][] = [];
  for (let r = 0; r < rows; r++) {
    errorFrac.push(new Array(cols).fill(0));
    wrong.push(new Array(cols).fill(false));
    truth.push(new Array(cols).fill(0));
    decoded.push(new Array(cols).fill(0));
  }

  for (const pos of frame.cells) {
    const gi = pos.row;
    const gj = pos.col;
    if (pos.isCalib) continue;
    const value = Math.floor(rng() * (1 << bpc));
    const code = encodeCell(scheme, value);
    let sRx = code.symbolIdx;
    let cRx = code.colorIdx;
    const est = estimateGradAt(pos, mode, channel, frame);
    if (scheme.symbolBits > 0) {
      const rx = simulateSymbolCell(symbols[code.symbolIdx], scheme.cellPx, 8, pos.u, pos.v, channel, rng);
      sRx = decodeSymbolCell(rx, symbols);
    }
    if (scheme.colorBits > 0) {
      const cap = simulateColorCell(palette[code.colorIdx], pos.u, pos.v, scheme.cellPx, est, channel, rng);
      cRx = decodeColorCell(cap, palette, channel, est);
    }
    const dec = decodeCell(scheme, sRx, cRx);
    const err = popcount(dec ^ value);
    errorFrac[gi][gj] = bpc > 0 ? err / bpc : 0;
    wrong[gi][gj] = dec !== value;
    truth[gi][gj] = value;
    decoded[gi][gj] = dec;
  }

  return { cols, rows, errorFrac, wrong, truth, decoded };
}
