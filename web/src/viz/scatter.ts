// 颜色空间散点图：将所有调色板颜色经 CCM 编码后投影到 R-G 平面（B 通道以色相提示），
// 标注在捕获域（相机所见）中相互重叠（欧氏距离过近）的颜色对。
import type { ChannelModel } from "../shared/types.ts";
import { ccmEncode } from "../core/channelSim.ts";
import { createCanvas, fillRect, drawLine, type Canvas } from "./png.ts";

export interface ScatterResult {
  canvas: Canvas;
  overlapPairs: Array<[number, number, number]>; // [i, j, 距离]
}

export function renderColorScatter(palette: number[][], channel: ChannelModel, threshold = 0.18): ScatterResult {
  const size = 460;
  const pad = 40;
  const c = createCanvas(size, size);
  c.data.fill(255); // 白底
  // 边框
  fillRect(c, 0, 0, size, pad, 235, 238, 242);
  fillRect(c, 0, size - pad, size, pad, 235, 238, 242);

  const cap = palette.map((col) => {
    const v = ccmEncode(col, channel);
    return [Math.max(0, Math.min(1, v[0])), Math.max(0, Math.min(1, v[1])), Math.max(0, Math.min(1, v[2]))];
  });

  const xOf = (r: number) => Math.round(pad + r * (size - 2 * pad));
  const yOf = (g: number) => Math.round(size - pad - g * (size - 2 * pad));

  // 重叠对检测（捕获域 RGB 欧氏距离）
  const overlapPairs: Array<[number, number, number]> = [];
  for (let i = 0; i < cap.length; i++) {
    for (let j = i + 1; j < cap.length; j++) {
      const d = Math.hypot(cap[i][0] - cap[j][0], cap[i][1] - cap[j][1], cap[i][2] - cap[j][2]);
      if (d < threshold) overlapPairs.push([i, j, d]);
    }
  }

  // 先画重叠连线（红）
  for (const [i, j] of overlapPairs) {
    drawLine(c, xOf(cap[i][0]), yOf(cap[i][1]), xOf(cap[j][0]), yOf(cap[j][1]), 220, 40, 40, 180);
  }

  // 画点（以其 B 通道映射成色相，便于区分）
  for (let i = 0; i < cap.length; i++) {
    const x = xOf(cap[i][0]);
    const y = yOf(cap[i][1]);
    const bv = cap[i][2];
    const pr = Math.round(40 + (1 - bv) * 160);
    const pg = Math.round(40 + bv * 60);
    const pb = Math.round(120 + bv * 120);
    for (let dy = -3; dy <= 3; dy++) {
      for (let dx = -3; dx <= 3; dx++) {
        if (dx * dx + dy * dy <= 9) fillRect(c, x + dx, y + dy, 1, 1, pr, pg, pb);
      }
    }
  }

  return { canvas: c, overlapPairs };
}
