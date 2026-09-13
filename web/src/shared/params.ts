// 共享参数层（纯 TS、零 DOM）。所有编码档位、调色板、调制方案集中在此，参数均源自实测标定。
import type { ColorBits, ProfileName, SymbolBits, CalibMode, ModulationScheme } from "./types.ts";

export interface Profile {
  name: ProfileName;
  cellPx: number;
  label: string;
  description: string;
}

// 档位：safe / balanced / fast（人工选档，发送后全程不变）。cellPx 单位统一为【屏幕像素】。
export const PROFILES: Record<ProfileName, Profile> = {
  safe: { name: "safe", cellPx: 13, label: "safe（最差包络）", description: "web_auto 最差包络 d_rec = 13 屏幕像素；σ_PSF 实测 2.78 屏幕像素" },
  balanced: { name: "balanced", cellPx: 8, label: "balanced（折中）", description: "擂台赛 M3 实测依据（解码成功率 0.9999）；cellPx = 8 屏幕像素。7 从未测过，不引入未验证参数" },
  fast: { name: "fast", cellPx: 5, label: "fast（锁定模式）", description: "web_locked 锁定模式 d_rec = 5 屏幕像素；σ_PSF 实测 1.03 屏幕像素" }
};

export const PROFILE_ORDER: ProfileName[] = ["safe", "balanced", "fast"];

// 默认颜色位宽 = 2 bit (4色：红/绿/蓝/白)。符号在任一亮底色上均可见，避免 1 bit (2色)「深灰/白」调色板
// 在 colorIdx=0 时形状几乎不可见的解码退化；也契合摩尔纹校准「颜色维度高于 16 色」的结论方向。
export const DEFAULT_COLOR_BITS: ColorBits = 2;
export const DEFAULT_SYMBOL_BITS: SymbolBits = 4; // 8×8 形状，4 bit
export const SYMBOL_GRID = 8; // 符号为 8×8 二值点阵

// RS 内层参数（RS(n,k)，n=255）
export const RS_N = 255;
export const RS_PARITY = 32; // 校验字节
export const RS_K = RS_N - RS_PARITY; // 223

// 假设：屏幕 PPI 未能由标定确认（report.md §0/§7），96 为占位假设
export const PPI_ASSUMPTION = 96;
export const PPI_ASSUMPTION_NOTE =
  "假设，待校准：屏幕 PPI 未由标定确认（仅影响毫米换算，不影响以屏幕像素为单位的信道仿真）。";

// 摩尔纹光学低通（OLPF）等效 σ，单位 = 格（cell）。
// 4.19 = 由 calibration/calibrate_moire.py 对真实标定照片做 2D FFT 反推得到（三档中位数）。
// 各档更精确的值存在 calibration/out_moire_calibration/moire_calibration.json，
// 由 calibration.ts 按档载入；此处仅作为该文件缺失时的回退默认。
export const MOIRE_ATT_SIGMA_DEFAULT = 4.19;

// 时间平均（多帧平均）档位：1=单帧；4/8=模拟手持微抖下连拍 N 帧平均，用于抑制摩尔纹
export const TEMPORAL_AVERAGING_OPTIONS = [1, 4, 8] as const;
export type TemporalAveraging = (typeof TEMPORAL_AVERAGING_OPTIONS)[number];

// 类型定义集中在 types.ts（避免重复）；此处重导出供历史导入路径兼容
export type { ModulationScheme } from "./types.ts";

export function bitsPerCell(symbolBits: SymbolBits, colorBits: ColorBits): number {
  return symbolBits + colorBits;
}

// 调色板（归一化 sRGB 0..1）。colorBits 决定取用色数：
// 1 bit (2色)、2 bit (4色)、3 bit (8色)、4 bit (16色)、5 bit (32色)、6 bit (64色)、7 bit (128色)。
// colorBits = 0 表示无颜色维度（符号 only），此时色数 = 1（单色底）。
export function colorPalette(colorBits: number): number[][] {
  switch (colorBits) {
    case 0:
      return [];
    case 1:
      return [
        [0.04, 0.04, 0.04],
        [0.92, 0.92, 0.92]
      ]; // 仅亮度+暗
    case 2:
      return [
        [0.95, 0.05, 0.05],
        [0.05, 0.95, 0.05],
        [0.05, 0.05, 0.95],
        [0.95, 0.95, 0.95]
      ];
    case 3:
      return hsvPalette(8);
    case 4:
      return hsvPalette(16);
    default:
      // 5..7 bit：高色数用 HSV 等距调色板（颜色维度二分测试所需，128 色 = 7 bit）
      return hsvPalette(1 << colorBits);
  }
}

function hsvPalette(n: number): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < n; i++) out.push(hsvToRgb((i / n) * 360, 0.85, 0.95));
  return out;
}

function hsvToRgb(h: number, s: number, v: number): number[] {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r = 0,
    g = 0,
    b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [r + m, g + m, b + m];
}

// 擂台赛方案集（M1–M7），与任务书一致
export function bakeoffSchemes(): ModulationScheme[] {
  return [
    { id: "M1", cellPx: 13, symbolBits: 4, colorBits: 2, calibMode: "four_corner", denseN: 0, note: "libcimbar 基准（4 bit 符号 + 2 bit (4色)）" },
    { id: "M2", cellPx: 13, symbolBits: 4, colorBits: 0, calibMode: "none", denseN: 0, note: "符号维度纯收益（无颜色维度）" },
    { id: "M3", cellPx: 8, symbolBits: 4, colorBits: 1, calibMode: "dense", denseN: 3, note: "主力候选（4 bit 符号 + 1 bit (2色) + 密集校准 N=3）" },
    { id: "M4", cellPx: 6, symbolBits: 2, colorBits: 1, calibMode: "dense", denseN: 3, note: "极限密度（2 bit 符号 + 1 bit (2色) + 密集）" },
    { id: "M5", cellPx: 5, symbolBits: 4, colorBits: 0, calibMode: "none", denseN: 0, note: "纯符号极限（4 bit 符号，无颜色维度）" },
    { id: "M6", cellPx: 3, symbolBits: 0, colorBits: 1, calibMode: "dense", denseN: 3, note: "已判死对照（3×3 屏幕像素 级）" },
    { id: "M7a", cellPx: 13, symbolBits: 0, colorBits: 2, calibMode: "dense", denseN: 3, note: "纯颜色 2 bit (4色)（密集 vs 无校准）" },
    { id: "M7b", cellPx: 13, symbolBits: 0, colorBits: 3, calibMode: "dense", denseN: 3, note: "纯颜色 3 bit (8色)" },
    { id: "M7c", cellPx: 13, symbolBits: 0, colorBits: 4, calibMode: "dense", denseN: 3, note: "纯颜色 4 bit (16色)" }
  ];
}
