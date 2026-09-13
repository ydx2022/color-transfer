// 校准效果对比图：三栏并排
//  左：原始带梯度（编码色 × 非径向梯度，无解码）
//  中：无校准解码——整格误码标红、正确标绿
//  右：本方案校准模式解码——整格误码标红、正确标绿
// 三栏均在「参考灰块（校准块）」位置叠加琥珀色轮廓，并在底部加图例。
// 用于直观展示「本方案校准消除非径向梯度误码」这一核心命题。
import type { ChannelModel, ModulationScheme } from "../shared/types.ts";
import { buildFrame } from "../core/channelSim.ts";
import { runGrid } from "./analyze.ts";
import { renderIntendedFrame } from "./frameRender.ts";
import { createCanvas, fillRect, setPx, type Canvas } from "./png.ts";
import { drawText } from "./pngText.ts";

export interface CalibCompareResult {
  canvas: Canvas;
  noneWrong: number;
  denseWrong: number;
  total: number;
}

// 在 (x,y,w,h) 区域画 1px 轮廓。
function drawRectOutline(c: Canvas, x: number, y: number, w: number, h: number, r: number, g: number, b: number): void {
  for (let i = 0; i < w; i++) {
    setPx(c, x + i, y, r, g, b);
    setPx(c, x + i, y + h - 1, r, g, b);
  }
  for (let j = 0; j < h; j++) {
    setPx(c, x, y + j, r, g, b);
    setPx(c, x + w - 1, y + j, r, g, b);
  }
}

// 在面板区域内居中绘制标题。
function drawTitle(c: Canvas, panelX: number, panelW: number, text: string, r: number, g: number, b: number): void {
  const scale = 2;
  const w = text.length * 6 * scale; // 5px 字形 + 1 间距
  drawText(c, Math.round(panelX + (panelW - w) / 2), 3, text, r, g, b, scale);
}

export function renderCalibComparison(
  scheme: ModulationScheme,
  channel: ChannelModel,
  cols: number,
  rows: number,
  seed: number,
  cellPx = 18
): CalibCompareResult {
  const panelW = cols * cellPx;
  const panelH = rows * cellPx;
  const gap = 12;
  const titleH = 22;
  const legendH = 30;
  const W = panelW * 3 + gap * 2;
  const H = titleH + panelH + legendH;
  const c = createCanvas(W, H);
  c.data.fill(255);

  // 左栏：原始带梯度（cellPx 与面板一致，避免尺寸错配导致越界黑块）
  const intended = renderIntendedFrame(scheme, channel, cols, rows, seed, cellPx);
  for (let y = 0; y < panelH; y++) {
    for (let x = 0; x < panelW; x++) {
      const i = (y * panelW + x) * 4;
      fillRect(c, x, titleH + y, 1, 1, intended.data[i], intended.data[i + 1], intended.data[i + 2]);
    }
  }

  // 中/右栏：解码正确=绿、误码=红。右栏使用方案自身校准模式（更真实）。
  const none = runGrid(scheme, channel, cols, rows, seed, "none");
  const calib = runGrid(scheme, channel, cols, rows, seed, scheme.calibMode);
  let noneWrong = 0;
  let denseWrong = 0;
  for (let r = 0; r < rows; r++) {
    for (let col = 0; col < cols; col++) {
      if (none.wrong[r][col]) noneWrong++;
      if (calib.wrong[r][col]) denseWrong++;
      const gx = panelW + gap + col * cellPx;
      const dx = panelW * 2 + gap * 2 + col * cellPx;
      const gy = titleH + r * cellPx;
      if (none.wrong[r][col]) fillRect(c, gx, gy, cellPx, cellPx, 220, 50, 50);
      else fillRect(c, gx, gy, cellPx, cellPx, 40, 190, 90);
      if (calib.wrong[r][col]) fillRect(c, dx, gy, cellPx, cellPx, 220, 50, 50);
      else fillRect(c, dx, gy, cellPx, cellPx, 40, 190, 90);
    }
  }

  // 参考灰块位置：按方案真实布局（four_corner / dense）标注三栏。
  const calibFrame = buildFrame(cols, rows, scheme.denseN, scheme.calibMode);
  const amber = [245, 158, 11];
  for (const pos of calibFrame.cells) {
    if (!pos.isCalib) continue;
    const px = pos.col * cellPx;
    const py = titleH + pos.row * cellPx;
    drawRectOutline(c, px, py, cellPx, cellPx, amber[0], amber[1], amber[2]);
    drawRectOutline(c, panelW + gap + px, py, cellPx, cellPx, amber[0], amber[1], amber[2]);
    drawRectOutline(c, panelW * 2 + gap * 2 + px, py, cellPx, cellPx, amber[0], amber[1], amber[2]);
  }

  // 标题
  drawTitle(c, 0, panelW, "RAW", 17, 24, 39);
  drawTitle(c, panelW + gap, panelW, "NO CALIB", 17, 24, 39);
  const modeLabel = scheme.calibMode === "dense" ? `CALIB N=${scheme.denseN}` : scheme.calibMode === "four_corner" ? "CALIB 4COR" : "CALIB OFF";
  drawTitle(c, panelW * 2 + gap * 2, panelW, modeLabel, 17, 24, 39);

  // 图例
  const ly = titleH + panelH + 8;
  const s = 14;
  fillRect(c, 8, ly, s, s, 40, 190, 90);
  drawText(c, 26, ly + 1, "OK", 17, 24, 39, 2);
  fillRect(c, 78, ly, s, s, 220, 50, 50);
  drawText(c, 96, ly + 1, "ERR", 17, 24, 39, 2);
  drawRectOutline(c, 150, ly, s, s, amber[0], amber[1], amber[2]);
  drawText(c, 168, ly + 1, "CALIB BLOCK", 17, 24, 39, 2);

  const total = cols * rows;
  return { canvas: c, noneWrong, denseWrong, total };
}
