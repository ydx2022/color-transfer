// 单格解码（纯 TS、零 DOM）：颜色 = 局部增益校正后相对调色板最小距离匹配；形状 = 8×8 暗点阵汉明最近匹配。
import { SYMBOLS_8x8 } from "../shared/symbols.ts";
import { colorPalette } from "../shared/params.ts";
import { decodeCell, symbolSubset, popcount } from "../core/modulation.ts";
import type { ModulationScheme } from "../shared/types.ts";
import type { DecodedCell } from "./types.ts";
import type { GainField } from "./normalize.ts";

const SUB = 8; // 符号点阵 8×8

// 由 M×M 采样区（Float32 RGB 0..255）构造 8×8 暗点阵：先估背景亮度，再按阈值取暗点，2×2 多数决下采样。
function symbolMask(region: Float32Array, M: number): Uint8Array {
  const n = M * M;
  const lum = new Float32Array(n);
  let minL = 1e9;
  let maxL = 0;
  for (let i = 0; i < n; i++) {
    const o = i * 3;
    const l = 0.299 * region[o] + 0.587 * region[o + 1] + 0.114 * region[o + 2];
    lum[i] = l;
    if (l < minL) minL = l;
    if (l > maxL) maxL = l;
  }
  // 背景亮度取高百分位（形状暗点恒为近黑，故背景在亮簇）；阈值取明暗中点，对蓝等暗底也稳健。
  const sorted = Float32Array.from(lum).sort();
  const bgLum = sorted[Math.floor(n * 0.72)] || (minL + maxL) / 2;
  const darkT = minL + (bgLum - minL) * 0.5;
  const mask = new Uint8Array(SUB * SUB);
  const bin = M / SUB; // 整数下采样（M 取 16 → bin=2）
  for (let by = 0; by < SUB; by++) {
    for (let bx = 0; bx < SUB; bx++) {
      let on = 0;
      let tot = 0;
      for (let dy = 0; dy < bin; dy++) {
        for (let dx = 0; dx < bin; dx++) {
          const si = (by * bin + dy) * M + (bx * bin + dx);
          if (lum[si] < darkT) on++;
          tot++;
        }
      }
      mask[by * SUB + bx] = on > tot * 0.5 ? 1 : 0;
    }
  }
  return mask;
}

// 背景颜色（暗点之外的亮像素均值），返回 0..1。
function backgroundRGB(region: Float32Array, M: number, mask: Uint8Array): [number, number, number] {
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  const bin = M / SUB;
  for (let by = 0; by < SUB; by++) {
    for (let bx = 0; bx < SUB; bx++) {
      if (mask[by * SUB + bx]) continue; // 暗点（形状）不计入背景
      for (let dy = 0; dy < bin; dy++) {
        for (let dx = 0; dx < bin; dx++) {
          const si = ((by * bin + dy) * M + (bx * bin + dx)) * 3;
          r += region[si];
          g += region[si + 1];
          b += region[si + 2];
          n++;
        }
      }
    }
  }
  if (n === 0) {
    // 无亮像素（极端情况）：用全格均值
    for (let i = 0; i < M * M; i++) {
      r += region[i * 3];
      g += region[i * 3 + 1];
      b += region[i * 3 + 2];
    }
    n = M * M;
  }
  return [r / n / 255, g / n / 255, b / n / 255];
}

// 对数据格做完整解码（含局部增益校正）。
export function decodeDataCell(
  region: Float32Array,
  M: number,
  scheme: ModulationScheme,
  gain: [number, number, number]
): DecodedCell {
  const palette = colorPalette(scheme.colorBits);
  const mask = symbolMask(region, M);
  const bg = backgroundRGB(region, M, mask);

  let colorIdx = 0;
  let colorConf = 1;
  if (scheme.colorBits > 0 && palette.length > 0) {
    let best = 1e9;
    let second = 1e9;
    for (let i = 0; i < palette.length; i++) {
      const p = palette[i];
      const dr = bg[0] / gain[0] - p[0];
      const dg = bg[1] / gain[1] - p[1];
      const db = bg[2] / gain[2] - p[2];
      const d = dr * dr + dg * dg + db * db;
      if (d < best) {
        second = best;
        best = d;
        colorIdx = i;
      } else if (d < second) {
        second = d;
      }
    }
    colorConf = Math.max(0, Math.min(1, (Math.sqrt(second) - Math.sqrt(best)) / (Math.sqrt(second) + 1e-6)));
  }

  let symbolIdx = 0;
  let symbolConf = 1;
  if (scheme.symbolBits > 0) {
    const symbols = symbolSubset(scheme.symbolBits);
    let best = 1e9;
    let second = 1e9;
    let bestIdx = 0;
    for (let i = 0; i < symbols.length; i++) {
      const pat = symbols[i];
      let ham = 0;
      for (let k = 0; k < SUB * SUB; k++) ham += pat[k] === mask[k] ? 0 : 1;
      if (ham < best) {
        second = best;
        best = ham;
        bestIdx = i;
      } else if (ham < second) {
        second = ham;
      }
    }
    symbolIdx = bestIdx;
    symbolConf = Math.max(0, Math.min(1, (second - best) / (SUB * SUB)));
  }

  const value = decodeCell(scheme, symbolIdx, colorIdx);
  return { symbolIdx, colorIdx, value, colorConf, symbolConf, isData: true };
}

// 读数校准格的测量颜色（0..1），用于拟合局部增益场。
export function measureCalibColor(region: Float32Array, M: number): [number, number, number] {
  let r = 0;
  let g = 0;
  let b = 0;
  const n = M * M;
  for (let i = 0; i < n; i++) {
    r += region[i * 3];
    g += region[i * 3 + 1];
    b += region[i * 3 + 2];
  }
  return [r / n / 255, g / n / 255, b / n / 255];
}

void SYMBOLS_8x8;
void popcount;
