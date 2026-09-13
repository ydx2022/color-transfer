// 把编码帧（CellFrame）绘制到 Canvas 2D 上下文：三主锚 + 右下角方向标记 + 校准格 + 数据格（符号+颜色）。
// 与 core/encoder 严格对应；接收端将摄像头帧逆映射回同一 CellFrame 结构。
// scale = 单格边长，单位：屏幕像素（渲染画布像素，非摄像头像素）。

import { SYMBOLS_8x8 } from "../shared/symbols.ts";
import { colorPalette } from "../shared/params.ts";
import { encodeCell, symbolSubset } from "../core/modulation.ts";
import { CELL_META_ANCHOR, CELL_META_PILOT, CELL_META_ORIENT, type CellFrame } from "../core/encoder.ts";

export function paintCellFrame(ctx: CanvasRenderingContext2D, frame: CellFrame, scale: number): void {
  const { cols, rows, scheme, cellMeta, values, pilotParity } = frame;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, cols * scale, rows * scale);

  const palette = colorPalette(scheme.colorBits);
  const symbols = symbolSubset(scheme.symbolBits);
  const sub = scale / 8;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      const x = c * scale;
      const y = r * scale;
      const meta = cellMeta[i];

      if (meta === CELL_META_ANCHOR) {
        paintAnchor(ctx, x, y, scale);
        continue;
      }
      if (meta === CELL_META_ORIENT) {
        paintOrient(ctx, x, y, scale);
        continue;
      }
      if (meta === CELL_META_PILOT) {
        const col = palette[pilotParity[i] % Math.max(1, palette.length)];
        if (col) ctx.fillStyle = rgbCss(col);
        ctx.fillRect(x + 1, y + 1, scale - 2, scale - 2);
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
        ctx.fillRect(x + 1, y + 1, scale - 2, scale - 2);
      }
      if (scheme.symbolBits > 0) {
        const pat = symbols[code.symbolIdx % symbols.length];
        ctx.fillStyle = "#0b0f1a";
        for (let p = 0; p < 64; p++) {
          if (pat[p]) {
            const dx = (p % 8) * sub;
            const dy = Math.floor(p / 8) * sub;
            ctx.fillRect(x + dx + 1, y + dy + 1, sub - 1, sub - 1);
          }
        }
      }
    }
  }
}

function paintAnchor(ctx: CanvasRenderingContext2D, x: number, y: number, scale: number): void {
  // 锚点：亮底 + 居中暗方（接收端用角点检测定位）
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(x + 1, y + 1, scale - 2, scale - 2);
  const m = Math.floor(scale * 0.3);
  ctx.fillStyle = "#0b0f1a";
  ctx.fillRect(x + m, y + m, scale - 2 * m, scale - 2 * m);
}

// 方向标记：与锚点图案相反（暗底 + 居中亮方），保证四角两两可区分 → 旋转唯一可判。
function paintOrient(ctx: CanvasRenderingContext2D, x: number, y: number, scale: number): void {
  ctx.fillStyle = "#0b0f1a";
  ctx.fillRect(x + 1, y + 1, scale - 2, scale - 2);
  const m = Math.floor(scale * 0.3);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(x + m, y + m, scale - 2 * m, scale - 2 * m);
}

function rgbCss(col: number[]): string {
  return `rgb(${(col[0] * 255) | 0},${(col[1] * 255) | 0},${(col[2] * 255) | 0})`;
}
