// 纯 TS 光栅化（零 DOM）：把 CellFrame 画成 RGBA 缓冲区，与 viz/screenRender.ts 严格对偶。
// 用途：离线回归自检（合成「完美照片」跑解码管线）、以及作为真机照片解码的对照基线。
//
// ⚠️ 与 screenRender 同步的修正：8×8 符号点阵按「取整边界」映射到 scale 个屏幕像素，
// 保证每个符号像素至少 1px。旧的 sub-1 在 scale<16 时点宽趋近 0，符号整体消失，
// 导致真机照片里根本拍不到形状维度（详见 screenRender.ts 顶部说明）。
import { SYMBOLS_8x8 } from "../shared/symbols.ts";
import { colorPalette } from "../shared/params.ts";
import { symbolSubset } from "../core/modulation.ts";
import { CELL_META_ANCHOR, CELL_META_PILOT, CELL_META_ORIENT, type CellFrame } from "../core/encoder.ts";
import type { RGBAImage } from "../receiver/types.ts";

const DARK: [number, number, number] = [11, 15, 26]; // #0b0f1a

function setRect(img: RGBAImage, x: number, y: number, w: number, h: number, col: [number, number, number]): void {
  const { width, data } = img;
  for (let yy = y; yy < y + h; yy++) {
    for (let xx = x; xx < x + w; xx++) {
      if (xx < 0 || yy < 0 || xx >= img.width || yy >= img.height) continue;
      const o = (yy * width + xx) * 4;
      data[o] = col[0];
      data[o + 1] = col[1];
      data[o + 2] = col[2];
      data[o + 3] = 255;
    }
  }
}

// scale = 单格边长，单位：屏幕像素（与 screenRender 同义；非摄像头像素）
export function rasterizeFrame(frame: CellFrame, scale: number): RGBAImage {
  const { cols, rows, scheme, cellMeta, values, pilotParity } = frame;
  const W = cols * scale;
  const H = rows * scale;
  const img: RGBAImage = { width: W, height: H, data: new Uint8ClampedArray(W * H * 4) };
  setRect(img, 0, 0, W, H, [0, 0, 0]); // 黑底

  const palette = colorPalette(scheme.colorBits);
  const symbols = symbolSubset(scheme.symbolBits);
  const inset = scale >= 16 ? 1 : 0;
  const inner = scale - 2 * inset;
  const sub = inner / 8;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      const x = c * scale + inset;
      const y = r * scale + inset;
      const meta = cellMeta[i];
      if (meta === CELL_META_ANCHOR) {
        setRect(img, x, y, inner, inner, [255, 255, 255]);
        const m = Math.floor(scale * 0.3);
        setRect(img, x + m, y + m, Math.max(1, inner - 2 * m), Math.max(1, inner - 2 * m), DARK);
        continue;
      }
      if (meta === CELL_META_ORIENT) {
        setRect(img, x, y, inner, inner, DARK);
        const m = Math.floor(scale * 0.3);
        setRect(img, x + m, y + m, Math.max(1, inner - 2 * m), Math.max(1, inner - 2 * m), [255, 255, 255]);
        continue;
      }
      if (meta === CELL_META_PILOT) {
        const col = palette[pilotParity[i] % Math.max(1, palette.length)];
        if (col) setRect(img, x, y, inner, inner, [col[0] * 255, col[1] * 255, col[2] * 255]);
        continue;
      }
      const v = values[i];
      if (v < 0) continue;
      // 与 screenRender 对偶：底色 = 调色板（有颜色位）/ 中性灰（无颜色位，纯形状对照如 T8）
      const bg = scheme.colorBits > 0 ? palette[v & ((1 << scheme.colorBits) - 1)] : [0.5, 0.5, 0.5];
      if (bg) setRect(img, x, y, inner, inner, [bg[0] * 255, bg[1] * 255, bg[2] * 255]);
      if (scheme.symbolBits > 0) {
        const pat = symbols[(v >> scheme.colorBits) % symbols.length];
        for (let p = 0; p < 64; p++) {
          if (!pat[p]) continue;
          const gx = p % 8;
          const gy = Math.floor(p / 8);
          const x0 = Math.round(x + gx * sub);
          const x1 = Math.round(x + (gx + 1) * sub);
          const y0 = Math.round(y + gy * sub);
          const y1 = Math.round(y + (gy + 1) * sub);
          setRect(img, x0, y0, Math.max(1, x1 - x0), Math.max(1, y1 - y0), DARK);
        }
      }
    }
  }
  void SYMBOLS_8x8;
  return img;
}
