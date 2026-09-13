// 离线导出 8 张实测测试图案 PNG 到 calibration/test_patterns/，并做程序化自检。
// 与 SendPage 共用同一编码/光栅化代码（raster.ts 与 screenRender.ts 严格对偶），
// 保证导出文件与网页渲染逐像素一致。运行：npm run export:patterns
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  encodeFile,
  CELL_META_ANCHOR,
  CELL_META_PILOT,
  CELL_META_ORIENT,
  CELL_META_DATA,
  type CellFrame
} from "../core/encoder.ts";
import { encodeCell, popcount } from "../core/modulation.ts";
import { colorPalette } from "../shared/params.ts";
import { rasterizeFrame } from "../viz/raster.ts";
import { savePng, createCanvas, fillRect, type Canvas } from "../viz/png.ts";
import { DEMO_PAYLOAD } from "../shared/testPayload.ts";
import { TEST_PATTERNS, schemeOfPattern } from "../shared/testPatterns.ts";
import { SYMBOLS_8x8 } from "../shared/symbols.ts";
import type { RGBAImage } from "../receiver/types.ts";

const COLS = 24;
const ROWS = 14;
const SCALE = 64;
const CANVAS_W = 1600;
const CANVAS_H = 900;
const DARK: number[] = [11, 15, 26]; // #0b0f1a
const GRAY: number[] = [128, 128, 128]; // colorBits=0 时的中性灰底 0.5
// 符号点按「间距 sub、点宽 sub-1」绘制，故点之间有 1px 缝隙：
// scale=64 时子格 (3,3) 的点覆盖偏移 25..31，取 28 才是点内部（取 32 会落在缝隙上，永远读到底色）。
const DOT_OFF = 28;
const DOT_SUB = 3 * 8 + 3; // 子格 (dx=3, dy=3) 对应的图案位索引 27

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, "../../../calibration/test_patterns");

function blit(dst: Canvas, src: RGBAImage, ox: number, oy: number): void {
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      const s = (y * src.width + x) * 4;
      const d = ((y + oy) * dst.width + (x + ox)) * 4;
      dst.data[d] = src.data[s];
      dst.data[d + 1] = src.data[s + 1];
      dst.data[d + 2] = src.data[s + 2];
      dst.data[d + 3] = 255;
    }
  }
}

function pixelAt(img: RGBAImage, x: number, y: number): number[] {
  const o = (y * img.width + x) * 4;
  return [img.data[o], img.data[o + 1], img.data[o + 2]];
}

function to255(col: number[]): number[] {
  return [Math.round(col[0] * 255), Math.round(col[1] * 255), Math.round(col[2] * 255)];
}

function near(a: number[], b: number[], tol = 2): boolean {
  return Math.abs(a[0] - b[0]) <= tol && Math.abs(a[1] - b[1]) <= tol && Math.abs(a[2] - b[2]) <= tol;
}

// 符号集最小汉明距离（设计要求 ≥20）
function minSymbolDistance(): number {
  let min = Infinity;
  for (let i = 0; i < SYMBOLS_8x8.length; i++) {
    for (let j = i + 1; j < SYMBOLS_8x8.length; j++) {
      let d = 0;
      for (let k = 0; k < 64; k++) if (SYMBOLS_8x8[i][k] !== SYMBOLS_8x8[j][k]) d++;
      min = Math.min(min, d);
    }
  }
  return min;
}

let totalIssues = 0;
const notes: string[] = [];
const lines: string[] = [];

// 同时输出到控制台与报告文件（部署环境无法捕获 stdout，报告文件可被预览服务读取）
function say(s = ""): void {
  lines.push(s);
  console.log(s);
}

say(`导出 ${TEST_PATTERNS.length} 张测试图案 → ${outDir}`);
say();
say("图案                | 数据格 | 校准格 | 帧数 | 检查");
say("--------------------|--------|--------|------|------");

for (const p of TEST_PATTERNS) {
  const scheme = schemeOfPattern(p);
  const enc = encodeFile(DEMO_PAYLOAD, scheme, { cols: COLS, rows: ROWS, fileId: 1 });
  const frame: CellFrame = enc.frames[0];
  const img = rasterizeFrame(frame, SCALE);
  const palette = colorPalette(scheme.colorBits);

  // 居中铺满到 1600×900 黑底（与网页一键导出一致）
  const cv = createCanvas(CANVAS_W, CANVAS_H);
  fillRect(cv, 0, 0, CANVAS_W, CANVAS_H, 0, 0, 0);
  blit(cv, img, Math.floor((CANVAS_W - img.width) / 2), Math.floor((CANVAS_H - img.height) / 2));
  const name = `T${p.id}_${p.profile}_${p.cellPx}px_${p.colors}色.png`;
  savePng(resolve(outDir, name), cv);

  // —— 自检 ——
  const issues: string[] = [];

  // 1) 三主锚：元数据 + 白环像素 + 中心黑块像素
  for (const [c, r] of [[0, 0], [COLS - 1, 0], [0, ROWS - 1]] as Array<[number, number]>) {
    const i = r * COLS + c;
    if (frame.cellMeta[i] !== CELL_META_ANCHOR) {
      issues.push(`锚点元数据缺失 @(${c},${r})`);
      continue;
    }
    const ring = pixelAt(img, c * SCALE + 2, r * SCALE + 2);
    if (ring[0] < 200 || ring[1] < 200 || ring[2] < 200) issues.push(`锚点白环异常 @(${c},${r}) rgb=${ring}`);
    const mid = pixelAt(img, c * SCALE + (SCALE >> 1), r * SCALE + (SCALE >> 1));
    if (!near(mid, DARK, 8)) issues.push(`锚点中心黑块异常 @(${c},${r}) rgb=${mid}`);
  }

  // 2) 数据格取样点像素 = 底色或符号暗点（取子格 (3,3) 的点内部 DOT_OFF，图案位 pat[27]）
  let dataChecked = 0;
  let calibCount = 0;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const i = r * COLS + c;
      const meta = frame.cellMeta[i];
      if (meta === CELL_META_PILOT) {
        calibCount++;
        const exp = to255(palette[frame.pilotParity[i] % Math.max(1, palette.length)]);
        const got = pixelAt(img, c * SCALE + (SCALE >> 1), r * SCALE + (SCALE >> 1));
        if (!near(got, exp)) issues.push(`校准格颜色异常 @(${c},${r}) 期望${exp} 实际${got}`);
        continue;
      }
      if (meta !== CELL_META_DATA) continue;
      const v = frame.values[i];
      if (v < 0) continue;
      dataChecked++;
      if (v < 0 || v >= (1 << (scheme.symbolBits + scheme.colorBits))) {
        issues.push(`格值越界 @(${c},${r}) v=${v}`);
        continue;
      }
      const code = encodeCell(scheme, v);
      const bg = scheme.colorBits > 0 ? palette[code.colorIdx] : [0.5, 0.5, 0.5];
      const pat = SYMBOLS_8x8[code.symbolIdx % SYMBOLS_8x8.length];
      const exp = pat[DOT_SUB] ? DARK : to255(bg);
      const got = pixelAt(img, c * SCALE + DOT_OFF, r * SCALE + DOT_OFF);
      if (!near(got, exp)) issues.push(`数据格符号位异常 @(${c},${r}) 期望${exp} 实际${got}`);
    }
  }

  // 3) 右下角方向标记：必须存在，且图案与主锚相反（暗底亮心 vs 亮底暗心），否则旋转不可判
  const br = (ROWS - 1) * COLS + (COLS - 1);
  if (frame.cellMeta[br] !== CELL_META_ORIENT) {
    issues.push(`右下角 (${COLS - 1},${ROWS - 1}) 缺少方向标记 meta=${frame.cellMeta[br]}`);
  } else {
    const oRing = pixelAt(img, (COLS - 1) * SCALE + 2, (ROWS - 1) * SCALE + 2);
    const oMid = pixelAt(img, (COLS - 1) * SCALE + (SCALE >> 1), (ROWS - 1) * SCALE + (SCALE >> 1));
    if (oRing[0] > 60 || oRing[1] > 60 || oRing[2] > 60) issues.push(`方向标记暗底异常 rgb=${oRing}`);
    if (oMid[0] < 200 || oMid[1] < 200 || oMid[2] < 200) issues.push(`方向标记亮心异常 rgb=${oMid}`);
  }

  // 4) T8 专项：无颜色位时数据格必须可见（灰底或暗点，绝不能是纯黑）
  if (p.colorBits === 0) {
    let pureBlack = 0;
    for (let r = 1; r < ROWS - 1; r++) {
      for (let c = 1; c < COLS - 1; c++) {
        const i = r * COLS + c;
        if (frame.cellMeta[i] !== CELL_META_DATA || frame.values[i] < 0) continue;
        const got = pixelAt(img, c * SCALE + DOT_OFF, r * SCALE + DOT_OFF);
        if (got[0] === 0 && got[1] === 0 && got[2] === 0) pureBlack++;
      }
    }
    if (pureBlack > 0) issues.push(`T8 有 ${pureBlack} 个数据格中心为纯黑（黑上画黑，不可见）`);
  }

  totalIssues += issues.length;
  say(
    `T${p.id} ${p.profile}/${p.cellPx}px/${p.colors}色/${p.calibLabel.padEnd(6)} | ${String(dataChecked).padEnd(6)} | ${String(calibCount).padEnd(6)} | ${String(enc.frames.length).padEnd(4)} | ${issues.length === 0 ? "OK" : issues.join("；")}`
  );
}

const minDist = minSymbolDistance();
say();
say(`符号集：${SYMBOLS_8x8.length} 个 8×8 图案，最小汉明距离 = ${minDist}（设计要求 ≥20）${minDist >= 20 ? " ✓" : " ✗ 不达标"}`);
for (const n of notes) say(`提示：${n}`);
if (totalIssues > 0) {
  say(`自检未通过：共 ${totalIssues} 个问题`);
} else {
  say("自检全部通过 ✓");
}

// 报告落盘（dist 目录，可被预览服务读取，便于无 stdout 的环境取证）
const reportPath = resolve(here, "../../dist/export_report.txt");
mkdirSync(dirname(reportPath), { recursive: true });
writeFileSync(reportPath, lines.join("\n"), "utf8");

if (totalIssues > 0) process.exitCode = 1;
