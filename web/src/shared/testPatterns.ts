// 8 张实测测试图案（T1–T8）的唯一事实来源：SendPage 渲染与离线导出/回归共用，
// 避免两处定义各自漂移。参数依据 calibration/ 三组标定（d_rec 13/5、最差包络）与档位设计。
import type { CalibMode, ModulationScheme } from "./types.ts";

export interface TestPattern {
  id: number;
  profile: "safe" | "balanced" | "fast";
  cellPx: number;
  colorBits: 0 | 1 | 2 | 3 | 4;
  colors: number;
  calibMode: CalibMode;
  denseN: number;
  calibLabel: string;
}

export const TEST_PATTERNS: TestPattern[] = [
  { id: 1, profile: "safe", cellPx: 13, colorBits: 2, colors: 4, calibMode: "four_corner", denseN: 0, calibLabel: "四角" },
  { id: 2, profile: "safe", cellPx: 13, colorBits: 4, colors: 16, calibMode: "four_corner", denseN: 0, calibLabel: "四角" },
  { id: 3, profile: "safe", cellPx: 13, colorBits: 4, colors: 16, calibMode: "dense", denseN: 3, calibLabel: "密集N=3" },
  { id: 4, profile: "balanced", cellPx: 8, colorBits: 2, colors: 4, calibMode: "dense", denseN: 3, calibLabel: "密集" },
  { id: 5, profile: "balanced", cellPx: 8, colorBits: 3, colors: 8, calibMode: "dense", denseN: 3, calibLabel: "密集" },
  { id: 6, profile: "fast", cellPx: 5, colorBits: 3, colors: 8, calibMode: "none", denseN: 0, calibLabel: "无" },
  { id: 7, profile: "fast", cellPx: 5, colorBits: 4, colors: 16, calibMode: "dense", denseN: 3, calibLabel: "密集" },
  { id: 8, profile: "safe", cellPx: 13, colorBits: 0, colors: 0, calibMode: "four_corner", denseN: 0, calibLabel: "四角" }
];

export function schemeOfPattern(p: TestPattern): ModulationScheme {
  return { id: `T${p.id}`, cellPx: p.cellPx, symbolBits: 4, colorBits: p.colorBits, calibMode: p.calibMode, denseN: p.denseN, note: p.calibLabel };
}
