// 帧渲染（纯 TS）：把编码方案渲染成「屏幕显示帧」与「相机采集帧（带模糊+色偏+噪声+非径向梯度）」的像素图。
// 与 channelSim 的数学一致：displayed = ccmEncode(color) × 符号亮度调制 × 真实梯度场；再经高斯模糊与加性噪声。
import type { ChannelModel, ModulationScheme } from "../shared/types.ts";
import { ccmEncode, trueGradAt, gauss, moireContamination, type MoireOpts } from "../core/channelSim.ts";
import { colorPalette } from "../shared/params.ts";
import { symbolSubset } from "../core/modulation.ts";
import { createCanvas, fillRect, type Canvas } from "./png.ts";
import { mulberry32 } from "./rng.ts";

function bitsOf(scheme: ModulationScheme): number {
  return scheme.symbolBits + scheme.colorBits;
}

// 高斯模糊（可分离，sigma 为屏幕像素）。原地模糊浮点 RGB 缓冲。
function gaussianBlur(rgb: Float32Array, w: number, h: number, sigma: number): void {
  if (sigma <= 0.01) return;
  const radius = Math.max(1, Math.ceil(sigma * 3));
  const kernel: number[] = [];
  let sum = 0;
  for (let i = -radius; i <= radius; i++) {
    const v = Math.exp(-(i * i) / (2 * sigma * sigma));
    kernel.push(v);
    sum += v;
  }
  for (let i = 0; i < kernel.length; i++) kernel[i] /= sum;

  const tmp = new Float32Array(w * h * 3);
  // 横向
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0,
        g = 0,
        b = 0;
      for (let k = -radius; k <= radius; k++) {
        const xx = Math.min(w - 1, Math.max(0, x + k));
        const i = (y * w + xx) * 3;
        const ww = kernel[k + radius];
        r += rgb[i] * ww;
        g += rgb[i + 1] * ww;
        b += rgb[i + 2] * ww;
      }
      const o = (y * w + x) * 3;
      tmp[o] = r;
      tmp[o + 1] = g;
      tmp[o + 2] = b;
    }
  }
  // 纵向
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0,
        g = 0,
        b = 0;
      for (let k = -radius; k <= radius; k++) {
        const yy = Math.min(h - 1, Math.max(0, y + k));
        const i = (yy * w + x) * 3;
        const ww = kernel[k + radius];
        r += tmp[i] * ww;
        g += tmp[i + 1] * ww;
        b += tmp[i + 2] * ww;
      }
      const o = (y * w + x) * 3;
      rgb[o] = r;
      rgb[o + 1] = g;
      rgb[o + 2] = b;
    }
  }
}

export interface RenderedFrame {
  canvas: Canvas;
  truth: number[][]; // [row][col]
}

// 渲染相机采集帧（带模糊+色偏+噪声）。返回画布与逐格真值（供校准对比）。
export function renderCapturedFrame(
  scheme: ModulationScheme,
  channel: ChannelModel,
  cols: number,
  rows: number,
  seed: number,
  moire?: MoireOpts
): RenderedFrame {
  const cellPx = scheme.cellPx;
  const W = cols * cellPx;
  const H = rows * cellPx;
  const rgb = new Float32Array(W * H * 3);
  const symbols = scheme.symbolBits > 0 ? symbolSubset(scheme.symbolBits) : [];
  const palette = colorPalette(scheme.colorBits);
  const rng = mulberry32(seed);
  const bpc = bitsOf(scheme);
  const truth: number[][] = [];

  for (let row = 0; row < rows; row++) {
    truth.push([]);
    for (let col = 0; col < cols; col++) {
      const value = Math.floor(rng() * (1 << bpc));
      truth[row].push(value);
      const cidx = scheme.colorBits > 0 ? value & ((1 << scheme.colorBits) - 1) : 0;
      const sidx = scheme.symbolBits > 0 ? (value >> scheme.colorBits) & ((1 << scheme.symbolBits) - 1) : 0;
      const base = scheme.colorBits > 0 ? ccmEncode(palette[cidx], channel) : [0.5, 0.5, 0.5];
      const pattern = scheme.symbolBits > 0 ? symbols[sidx] : null;
      for (let sy = 0; sy < cellPx; sy++) {
        for (let sx = 0; sx < cellPx; sx++) {
          let bright = 1;
          if (scheme.symbolBits > 0 && pattern) {
            const gi = Math.min(7, Math.floor((sy / cellPx) * 8));
            const gj = Math.min(7, Math.floor((sx / cellPx) * 8));
            bright = pattern[gi * 8 + gj] ? 1 : 0.12;
          }
          const x = col * cellPx + sx;
          const y = row * cellPx + sy;
          const u = x / W;
          const v = y / H;
          const g = trueGradAt(u, v, channel);
          const i = (y * W + x) * 3;
          rgb[i] = base[0] * bright * g;
          rgb[i + 1] = base[1] * bright * g;
          rgb[i + 2] = base[2] * bright * g;
        }
      }
    }
  }

  gaussianBlur(rgb, W, H, channel.sigmaPsf);
  // 与 simulateColorCell 一致：噪声按单元内采样数平均衰减（cellPx 屏幕像素 ≈ 一个解码单元，
  // 其噪声即单元平均噪声），否则逐像素叠加满幅传感器噪声会淹没整个画面。
  const samples = Math.max(1, Math.round(Math.pow((channel.rho * cellPx) / 4, 2) * 0.25));
  const noiseStd = channel.noiseSigmaY / 255 / Math.sqrt(samples);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 3;
      for (let c = 0; c < 3; c++) {
        rgb[i + c] = Math.max(0, Math.min(1, rgb[i + c] + gauss(rng) * noiseStd));
      }
    }
  }

  const moireOpts: MoireOpts | undefined = moire ? { ...moire, frameCols: cols, frameRows: rows } : undefined;
  const canvas = createCanvas(W, H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 3;
      let r = rgb[i];
      let g = rgb[i + 1];
      let b = rgb[i + 2];
      if (moireOpts) {
        // 全像素级摩尔纹叠加（与 channelSim 加性模型一致）：屏幕-传感器混叠彩色 fringe
        const mc = moireContamination(x / W, y / H, moireOpts);
        r = Math.max(0, Math.min(1, r + mc[0]));
        g = Math.max(0, Math.min(1, g + mc[1]));
        b = Math.max(0, Math.min(1, b + mc[2]));
      }
      fillRect(canvas, x, y, 1, 1, Math.round(r * 255), Math.round(g * 255), Math.round(b * 255));
    }
  }
  return { canvas, truth };
}

// 渲染「原始带梯度」的屏幕显示帧（无模糊/噪声，仅展示编码色 + 非径向梯度），用于校准对比左栏。
export function renderIntendedFrame(
  scheme: ModulationScheme,
  channel: ChannelModel,
  cols: number,
  rows: number,
  seed: number,
  cellPx: number = scheme.cellPx
): Canvas {
  const W = cols * cellPx;
  const H = rows * cellPx;
  const canvas = createCanvas(W, H);
  const palette = colorPalette(scheme.colorBits);
  const rng = mulberry32(seed);
  const bpc = bitsOf(scheme);
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const value = Math.floor(rng() * (1 << bpc));
      const cidx = scheme.colorBits > 0 ? value & ((1 << scheme.colorBits) - 1) : 0;
      const base = scheme.colorBits > 0 ? ccmEncode(palette[cidx], channel) : [0.5, 0.5, 0.5];
      const u = (col + 0.5) / cols;
      const v = (row + 0.5) / rows;
      // 自动曝光：按最亮角归一化，保留相对梯度形状（顶部暗/底部亮）同时让颜色可见
      const gmax = Math.max(channel.gradient.tl, channel.gradient.tr, channel.gradient.bl, channel.gradient.br, 1e-3);
      const g = trueGradAt(u, v, channel) / gmax;
      const r = Math.round(Math.max(0, Math.min(1, base[0] * g)) * 255);
      const gg = Math.round(Math.max(0, Math.min(1, base[1] * g)) * 255);
      const b = Math.round(Math.max(0, Math.min(1, base[2] * g)) * 255);
      fillRect(canvas, col * cellPx, row * cellPx, cellPx, cellPx, r, gg, b);
    }
  }
  return canvas;
}
