// 热力图：按【比特错误率 BER】着色（绿→黄→红）。每格含义 = 该数据格内判错 bit 数 / 该格总 bit 数。
// ⚠️ BER ≠ 格错误率：格错误率 = 整格判错的数据格占比（见 GridResult.wrong[]）。
// 二者数值不同，任何报告引用本图时必须注明是「比特错误率 BER」。
import type { GridResult } from "./analyze.ts";
import { createCanvas, fillRect, type Canvas } from "./png.ts";

// 错误率(0..1) → 颜色：0 绿(0,200,80) → 0.5 黄(230,200,0) → 1 红(220,40,40)
function errColor(f: number): [number, number, number] {
  const x = Math.max(0, Math.min(1, f));
  if (x <= 0.5) {
    const t = x / 0.5;
    return [Math.round(0 + t * 230), Math.round(200 + t * 0), Math.round(80 - t * 80)];
  }
  const t = (x - 0.5) / 0.5;
  return [230, Math.round(200 - t * 160), Math.round(0 + t * 40)];
}

export function renderBerHeatmap(g: GridResult, cellPx: number): Canvas {
  const W = g.cols * cellPx;
  const H = g.rows * cellPx;
  const c = createCanvas(W, H);
  c.data.fill(0);
  for (let r = 0; r < g.rows; r++) {
    for (let col = 0; col < g.cols; col++) {
      const [rr, gg, b] = errColor(g.errorFrac[r][col]);
      fillRect(c, col * cellPx, r * cellPx, cellPx, cellPx, rr, gg, b);
    }
  }
  return c;
}
