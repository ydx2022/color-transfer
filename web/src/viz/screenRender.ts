// 把编码帧（CellFrame）绘制到 Canvas 2D 上下文：三主锚 + 右下角方向标记 + 校准格 + 数据格（符号+颜色）。
// 与 core/encoder 严格对应；接收端将摄像头帧逆映射回同一 CellFrame 结构。
// scale = 单格边长，单位：屏幕像素（渲染画布像素，非摄像头像素）。
//
// ⚠️ 关键修正：8×8 符号点阵映射到 cellPx 个屏幕像素时，必须用「取整边界」画点，
// 不能用旧的 `sub - 1`（固定扣 1px 缝隙）。sub = cellPx/8：
//   cellPx=64 → sub=8，点宽 7px（正常）；cellPx=13 → sub=1.625，点宽 0.625px（符号几乎消失）；
//   cellPx=5  → sub=0.625，点宽为负 → 画不出来。
// 真机实测必须按真实 cellPx 渲染，否则拍到的不是设计密度，测出的结论无效。

import { SYMBOLS_8x8 } from "../shared/symbols.ts";
import { colorPalette } from "../shared/params.ts";
import { encodeCell, symbolSubset } from "../core/modulation.ts";
import { CELL_META_ANCHOR, CELL_META_PILOT, CELL_META_ORIENT, type CellFrame } from "../core/encoder.ts";

// 小格不再留 1px 内缩缝隙（否则 cellPx=13 只剩 11px 画 8×8），大格保留缝隙便于肉眼分辨。
export function cellInset(scale: number): number {
  return scale >= 16 ? 1 : 0;
}

export function paintCellFrame(ctx: CanvasRenderingContext2D, frame: CellFrame, scale: number): void {
  const { cols, rows, scheme, cellMeta, values, pilotParity } = frame;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, cols * scale, rows * scale);

  const palette = colorPalette(scheme.colorBits);
  const symbols = symbolSubset(scheme.symbolBits);
  const inset = cellInset(scale);
  const inner = scale - 2 * inset;
  const sub = inner / 8; // 单个符号像素的边长（可为小数）

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      const x = c * scale + inset;
      const y = r * scale + inset;
      const meta = cellMeta[i];

      if (meta === CELL_META_ANCHOR) {
        paintAnchor(ctx, x, y, inner, scale);
        continue;
      }
      if (meta === CELL_META_ORIENT) {
        paintOrient(ctx, x, y, inner, scale);
        continue;
      }
      if (meta === CELL_META_PILOT) {
        const col = palette[pilotParity[i] % Math.max(1, palette.length)];
        if (col) ctx.fillStyle = rgbCss(col);
        ctx.fillRect(x, y, inner, inner);
        continue;
      }

      const v = values[i];
      if (v < 0) continue;

      const code = encodeCell(scheme, v);
      // 数据格底色：有颜色位取调色板；无颜色位（纯形状对照，如 T8）用中性灰，
      // 否则暗色符号点画在纯黑底上完全不可见（与 frameRender 仿真行为保持一致）。
      const bg = scheme.colorBits > 0 ? palette[code.colorIdx] : [0.5, 0.5, 0.5];
      if (bg) {
        ctx.fillStyle = rgbCss(bg);
        ctx.fillRect(x, y, inner, inner);
      }
      if (scheme.symbolBits > 0) {
        const pat = symbols[code.symbolIdx % symbols.length];
        ctx.fillStyle = "#0b0f1a";
        for (let p = 0; p < 64; p++) {
          if (!pat[p]) continue;
          const gx = p % 8;
          const gy = Math.floor(p / 8);
          // 取整边界：保证每个符号像素至少占 1 个屏幕像素，且 8×8 恰好铺满 inner 区域。
          const x0 = Math.round(x + gx * sub);
          const x1 = Math.round(x + (gx + 1) * sub);
          const y0 = Math.round(y + gy * sub);
          const y1 = Math.round(y + (gy + 1) * sub);
          ctx.fillRect(x0, y0, Math.max(1, x1 - x0), Math.max(1, y1 - y0));
        }
      }
    }
  }
  void SYMBOLS_8x8;
}

function paintAnchor(ctx: CanvasRenderingContext2D, x: number, y: number, inner: number, scale: number): void {
  // 锚点：亮底 + 居中暗方（接收端用角点检测定位）
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(x, y, inner, inner);
  const m = Math.floor(scale * 0.3);
  ctx.fillStyle = "#0b0f1a";
  ctx.fillRect(x + m, y + m, Math.max(1, inner - 2 * m), Math.max(1, inner - 2 * m));
}

// 方向标记：与锚点图案相反（暗底 + 居中亮方），保证四角两两可区分 → 旋转唯一可判。
function paintOrient(ctx: CanvasRenderingContext2D, x: number, y: number, inner: number, scale: number): void {
  ctx.fillStyle = "#0b0f1a";
  ctx.fillRect(x, y, inner, inner);
  const m = Math.floor(scale * 0.3);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(x + m, y + m, Math.max(1, inner - 2 * m), Math.max(1, inner - 2 * m));
}

function rgbCss(col: number[]): string {
  return `rgb(${(col[0] * 255) | 0},${(col[1] * 255) | 0},${(col[2] * 255) | 0})`;
}
