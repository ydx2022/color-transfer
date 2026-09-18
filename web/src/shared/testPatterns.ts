// 实测图案（T1–T8）的唯一事实来源：SendPage 渲染、/#/test/receive 现场解码、离线导出共用。
// **全部为纯颜色型**（symbolBits = 0，无符号），术语 v1.2。
//
// 本组为【真机对比序列】：仿真未建模色度子采样 4:2:0（色彩分辨率仅亮度 1/4），
// 对纯颜色型杀伤最大，故 safe 档的 8 屏幕像素 vs 10 屏幕像素 不由仿真拍板，改由真机判定。
// 覆盖：colCellPx ∈ {8, 9, 10, 13} 屏幕像素 × {2 bit (4色), 4 bit (16色)}，
// 校准一律四角，采样窗口一律 1/4。校准格与数据格同尺寸。
import type { CalibMode, ColorBits, ModulationScheme } from "./types.ts";

export interface TestPattern {
  id: number;
  profile: "safe" | "balanced" | "fast";
  colCellPx: number; // 纯颜色型数据格边长，单位【屏幕像素】
  colorBits: ColorBits;
  calibMode: CalibMode;
  denseN: number;
  winFrac: number; // 采样窗口比例
  note: string; // 该图案在对比序列中的角色
}

export const TEST_PATTERNS: TestPattern[] = [
  { id: 1, profile: "safe", colCellPx: 8, colorBits: 2, calibMode: "four_corner", denseN: 0, winFrac: 0.25, note: "仿真最优候选：colCellPx=8 屏幕像素 + 2 bit (4色)" },
  { id: 2, profile: "safe", colCellPx: 8, colorBits: 4, calibMode: "four_corner", denseN: 0, winFrac: 0.25, note: "同为 8 屏幕像素但升到 4 bit (16色)：验证位宽 vs 串扰权衡" },
  { id: 3, profile: "safe", colCellPx: 9, colorBits: 2, calibMode: "four_corner", denseN: 0, winFrac: 0.25, note: "9 屏幕像素 + 2 bit (4色)：工程余量档（推荐落点区间）" },
  { id: 4, profile: "safe", colCellPx: 9, colorBits: 4, calibMode: "four_corner", denseN: 0, winFrac: 0.25, note: "9 屏幕像素 + 4 bit (16色)" },
  { id: 5, profile: "safe", colCellPx: 10, colorBits: 2, calibMode: "four_corner", denseN: 0, winFrac: 0.25, note: "10 屏幕像素 + 2 bit (4色)：更保守的余量档" },
  { id: 6, profile: "safe", colCellPx: 10, colorBits: 4, calibMode: "four_corner", denseN: 0, winFrac: 0.25, note: "10 屏幕像素 + 4 bit (16色)" },
  { id: 7, profile: "safe", colCellPx: 13, colorBits: 2, calibMode: "four_corner", denseN: 0, winFrac: 0.25, note: "d_rec 基准对照：13 屏幕像素 + 2 bit (4色)" },
  { id: 8, profile: "safe", colCellPx: 13, colorBits: 4, calibMode: "four_corner", denseN: 0, winFrac: 0.25, note: "d_rec 基准对照：13 屏幕像素 + 4 bit (16色)（v12 定案值）" }
];

export const SYMBOL_BITS_OFF = 0; // 纯颜色型：无符号维度

export function schemeOfPattern(p: TestPattern): ModulationScheme {
  return {
    id: `T${p.id}`,
    cellPx: p.colCellPx,
    symbolBits: SYMBOL_BITS_OFF,
    colorBits: p.colorBits,
    calibMode: p.calibMode,
    denseN: p.denseN,
    note: p.note
  };
}

// 全屏网格：在 1920×1080 参考屏上每格恰好 colCellPx，铺满全屏（解码端据此 warp，必须一致）。
export function gridForColCellPx(colCellPx: number): { cols: number; rows: number } {
  return { cols: Math.max(1, Math.floor(1920 / colCellPx)), rows: Math.max(1, Math.floor(1080 / colCellPx)) };
}

export function colorFormat(colorBits: number): string {
  return colorBits === 0 ? "无颜色维度（单色底）" : `${colorBits} bit (${1 << colorBits}色)`;
}

export function winFracLabel(f: number): string {
  if (Math.abs(f - 0.25) < 1e-9) return "1/4";
  if (Math.abs(f - 1 / 3) < 1e-9) return "1/3";
  if (Math.abs(f - 0.5) < 1e-9) return "1/2";
  if (Math.abs(f - 2 / 3) < 1e-9) return "2/3";
  if (Math.abs(f - 1) < 1e-9) return "1.0";
  return f.toFixed(2);
}
