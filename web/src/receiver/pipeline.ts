// 接收端编排（纯 TS、零 DOM）：图像 → 定位 → 透视校正 → 局部增益 → 逐格解码。
// 与 core/encoder.ts 的 CellFrame 严格对偶；浏览器与离线脚本共用。
import { colorPalette } from "../shared/params.ts";
import type { ModulationScheme } from "../shared/types.ts";
import {
  CELL_META_ANCHOR,
  CELL_META_PILOT,
  CELL_META_ORIENT,
  type CellFrame
} from "../core/encoder.ts";
import type { RGBAImage, DecodedFrame, DecodedCell } from "./types.ts";
import { detectAnchors, determineRotation, uprightImage, cornersFromAnchors } from "./locate.ts";
import { solveHomography, sampleCellRegion } from "./geometry.ts";
import { GainField, type CalibSample } from "./normalize.ts";
import { decodeDataCell, measureCalibColor } from "./decoder.ts";

const SAMPLE_M = 16; // 每格采样 16×16

export function decodeImage(img: RGBAImage, frame: CellFrame): DecodedFrame {
  const { cols, rows, scheme, denseN } = frame;
  const rotation = determineRotation(detectAnchors(img));
  const up = uprightImage(img, rotation);
  const anchors = detectAnchors(up);
  const { TL, TR, BL, BR } = cornersFromAnchors(anchors);

  const H = solveHomography(
    [
      [0, 0],
      [cols, 0],
      [0, rows],
      [cols, rows]
    ],
    [TL, TR, BL, BR]
  );

  const palette = colorPalette(scheme.colorBits);

  // 1) 先扫校准格，拟合局部增益场
  const calibSamples: CalibSample[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      if (frame.cellMeta[i] !== CELL_META_PILOT) continue;
      const region = sampleCellRegion(up, H, c + 0.5, r + 0.5, SAMPLE_M);
      const measured = measureCalibColor(region, SAMPLE_M);
      const parity = frame.pilotParity[i] % Math.max(1, palette.length);
      const expected = (palette[parity] || [0.5, 0.5, 0.5]) as [number, number, number];
      calibSamples.push({ c, r, measured, expected });
    }
  }
  const gain = new GainField();
  gain.fit(calibSamples, cols, rows);

  // 2) 逐格解码
  const values = new Int16Array(cols * rows).fill(-1);
  const cells: (DecodedCell | null)[] = new Array(cols * rows).fill(null);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      const meta = frame.cellMeta[i];
      // 锚点与右下角方向标记不承载数据
      if (meta === CELL_META_ANCHOR || meta === CELL_META_ORIENT) continue;
      const region = sampleCellRegion(up, H, c + 0.5, r + 0.5, SAMPLE_M);
      if (meta === CELL_META_PILOT) {
        // 校准格只用于增益估计，不输出数据值
        values[i] = -1;
        continue;
      }
      const g = gain.gainAt(c, r);
      const dc = decodeDataCell(region, SAMPLE_M, scheme, g);
      values[i] = dc.value;
      cells[i] = dc;
    }
  }

  void denseN;
  return { cols, rows, rotation, values, cellMeta: frame.cellMeta, cells };
}
