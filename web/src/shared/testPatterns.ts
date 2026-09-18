// 8 张实测测试图案（T1–T8）的唯一事实来源：SendPage 渲染与离线导出/回归共用，
// 避免两处定义各自漂移。
// **全部为纯颜色型**（symbolBits = 0，无符号）——依据：纯颜色型在三组信道净吞吐全面胜出，
// 符号型（M1）在 web_auto 下整文件解码成功率 0.0000，已在 v1.2 重扫中推翻。
// 覆盖维度：colCellPx ∈ {3,5,13}、4 bit (16色) / 3 bit (8色)、四角 / 密集 N=4、采样窗口 1/3 与 1/2。
import type { CalibMode, ColorBits, ModulationScheme } from "./types.ts";

export interface TestPattern {
  id: number;
  profile: "safe" | "balanced" | "fast";
  colCellPx: number; // 纯颜色型数据格边长，单位【屏幕像素】
  colorBits: ColorBits;
  calibMode: CalibMode;
  denseN: number;
  winFrac: number; // 采样窗口比例
  note: string; // 该图案要验证的边界
}

export const TEST_PATTERNS: TestPattern[] = [
  { id: 1, profile: "fast", colCellPx: 3, colorBits: 3, calibMode: "four_corner", denseN: 0, winFrac: 0.5, note: "fast 档基准（3 bit (8色) + 四角 + 窗口 1/2）" },
  { id: 2, profile: "fast", colCellPx: 3, colorBits: 4, calibMode: "four_corner", denseN: 0, winFrac: 1 / 3, note: "色数上探 4 bit (16色) + 窗口收紧 1/3" },
  { id: 3, profile: "balanced", colCellPx: 5, colorBits: 4, calibMode: "four_corner", denseN: 0, winFrac: 1 / 3, note: "balanced 档基准（4 bit (16色) + 四角 + 窗口 1/3）" },
  { id: 4, profile: "balanced", colCellPx: 5, colorBits: 3, calibMode: "dense", denseN: 4, winFrac: 1 / 3, note: "校准模式边界：改用密集 N=4" },
  { id: 5, profile: "safe", colCellPx: 13, colorBits: 4, calibMode: "dense", denseN: 4, winFrac: 1 / 3, note: "safe 档基准（4 bit (16色) + 密集 N=4 + 窗口 1/3）" },
  { id: 6, profile: "safe", colCellPx: 13, colorBits: 3, calibMode: "dense", denseN: 4, winFrac: 0.5, note: "色数下探 3 bit (8色) + 窗口放宽 1/2" },
  { id: 7, profile: "safe", colCellPx: 13, colorBits: 4, calibMode: "four_corner", denseN: 0, winFrac: 1 / 3, note: "校准模式边界：safe 改用四角（预期因非径向梯度失败，用于对照）" },
  { id: 8, profile: "balanced", colCellPx: 8, colorBits: 4, calibMode: "dense", denseN: 4, winFrac: 1 / 3, note: "中间点 colCellPx=8，用于观察崩溃是断崖还是渐变" }
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
  const cols = Math.max(1, Math.floor(1920 / colCellPx));
  const rows = Math.max(1, Math.floor(1080 / colCellPx));
  return { cols, rows };
}

export function colorFormat(colorBits: number): string {
  return colorBits === 0 ? "无颜色维度（单色底）" : `${colorBits} bit (${1 << colorBits}色)`;
}
