// 离线分析脚本（tsx 运行）：真机照片 → 定位 → 透视校正 → 逐格解码 → 与真值比对。
// 用于**纯颜色型**实测图案（T1–T8，与 SendPage 同一小块网格 / 同一循环填充）。
// 输入：用手机拍 /#/test 图案的照片（按修改时间排序）。
// 输出：格错误率（判错的数据格占比；**不是**比特错误率 BER）、错误分布热力图(SVG)、报告(JSON)。
//
// 用法：
//   npx tsx src/scripts/offline_decode.ts --selftest             # 合成帧自检（格错误率应≈0）
//   npx tsx src/scripts/offline_decode.ts --photos <dir>         # 真机照片回归（默认 T1）
//   npx tsx src/scripts/offline_decode.ts --pattern T5 --photos <dir>
import { readdirSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { encodeFile, countDataCells, CELL_META_DATA, type CellFrame } from "../core/encoder.ts";
import { DEMO_PAYLOAD } from "../shared/testPayload.ts";
import { TEST_PATTERNS, schemeOfPattern, colorFormat } from "../shared/testPatterns.ts";
import { decodeImage } from "../receiver/pipeline.ts";
import { rasterizeFrame } from "../viz/raster.ts";
import type { RGBAImage } from "../receiver/types.ts";

const OUT_DIR = "../calibration/out_offline_decode";
mkdirSync(OUT_DIR, { recursive: true });

const PATCH_W = 640; // 必须与 SendPage 的小块一致
const PATCH_H = 360;
const SCALE = 26; // 合成自检时的渲染像素（仅 selftest 用）

interface PhotoResult {
  file: string;
  pattern: string;
  dataCells: number;
  errors: number;
  cellErrorRate: number;
}

function pickPattern(idArg: string | undefined) {
  const id = idArg ? parseInt(idArg.replace(/^T/i, ""), 10) : 1;
  const p = TEST_PATTERNS.find((x) => x.id === id) ?? TEST_PATTERNS[0];
  const cols = Math.max(1, Math.floor(PATCH_W / p.colCellPx));
  const rows = Math.max(1, Math.floor(PATCH_H / p.colCellPx));
  return { p, cols, rows, scheme: schemeOfPattern(p) };
}

function compareDecoded(dec: { values: Int16Array; cellMeta: Uint8Array }, truth: CellFrame): { errors: number; dataCells: number } {
  let errors = 0;
  let dataCells = 0;
  for (let i = 0; i < dec.cellMeta.length; i++) {
    if (dec.cellMeta[i] !== CELL_META_DATA) continue;
    dataCells++;
    if (dec.values[i] !== truth.values[i]) errors++;
  }
  return { errors, dataCells };
}

function writeHeatmap(path: string, errGrid: Float32Array, cntGrid: Float32Array, cols: number, rows: number): void {
  const cell = 22;
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${cols * cell + 1}" height="${rows * cell + 1}" font-size="9">`;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      const rate = cntGrid[i] > 0 ? errGrid[i] / cntGrid[i] : 0;
      const red = Math.round(rate * 220);
      const fill = cntGrid[i] > 0 ? `rgb(${red},${Math.round((1 - rate) * 120)},40)` : "rgb(40,40,48)";
      s += `<rect x="${c * cell}" y="${r * cell}" width="${cell - 1}" height="${cell - 1}" fill="${fill}"/>`;
    }
  }
  s += `</svg>`;
  writeFileSync(path, s);
}

function runSelfTest(truth: CellFrame, cols: number, rows: number): void {
  const img = rasterizeFrame(truth, SCALE);
  const dec = decodeImage(img, truth);
  const { errors, dataCells } = compareDecoded(dec, truth);
  const errGrid = new Float32Array(cols * rows);
  const cntGrid = new Float32Array(cols * rows);
  for (let i = 0; i < truth.cellMeta.length; i++) {
    if (truth.cellMeta[i] !== CELL_META_DATA) continue;
    cntGrid[i]++;
    if (dec.values[i] !== truth.values[i]) errGrid[i]++;
  }
  console.log(`[selftest] 数据格=${dataCells} 错=${errors} 格错误率=${(dataCells ? errors / dataCells : 0).toFixed(4)}`);
  writeHeatmap(join(OUT_DIR, "heatmap_selftest.svg"), errGrid, cntGrid, cols, rows);
  console.log(`[selftest] 热力图 → ${OUT_DIR}/heatmap_selftest.svg`);
}

async function runPhotos(dir: string, truth: CellFrame, cols: number, rows: number, label: string): Promise<void> {
  const files = readdirSync(dir)
    .filter((f) => /\.(jpe?g|png|bmp)$/i.test(f))
    .map((f) => ({ f, m: statSync(join(dir, f)).mtimeMs }))
    .sort((a, b) => a.m - b.m)
    .map((x) => x.f);
  if (files.length === 0) {
    console.error(`[photos] 目录无图片：${dir}`);
    return;
  }
  const sharp = (await import("sharp")).default;
  const errGrid = new Float32Array(cols * rows);
  const cntGrid = new Float32Array(cols * rows);
  const results: PhotoResult[] = [];
  let totalData = 0;
  let totalErr = 0;
  for (const f of files) {
    const buf = await sharp(join(dir, f)).ensureAlpha().raw().toBuffer();
    const meta = await sharp(join(dir, f)).metadata();
    const img: RGBAImage = { width: meta.width!, height: meta.height!, data: new Uint8ClampedArray(buf) };
    const dec = decodeImage(img, truth);
    const { errors, dataCells } = compareDecoded(dec, truth);
    for (let i = 0; i < dec.cellMeta.length; i++) {
      if (dec.cellMeta[i] !== CELL_META_DATA) continue;
      cntGrid[i]++;
      if (dec.values[i] !== truth.values[i]) errGrid[i]++;
    }
    totalData += dataCells;
    totalErr += errors;
    const rate = dataCells ? errors / dataCells : 0;
    results.push({ file: f, pattern: label, dataCells, errors, cellErrorRate: rate });
    console.log(`[photos] ${f} → 数据格=${dataCells} 错=${errors} 格错误率=${rate.toFixed(4)}`);
  }
  writeFileSync(
    join(OUT_DIR, "cell_error_report.json"),
    JSON.stringify({ pattern: label, totalData, totalErr, cellErrorRate: totalData ? totalErr / totalData : 0, photos: results }, null, 2)
  );
  writeHeatmap(join(OUT_DIR, "heatmap.svg"), errGrid, cntGrid, cols, rows);
  console.log(`[photos] 汇总：数据格=${totalData} 错=${totalErr} 格错误率=${(totalData ? totalErr / totalData : 0).toFixed(4)}`);
  console.log(`[photos] 报告 → ${OUT_DIR}/cell_error_report.json ；热力图 → ${OUT_DIR}/heatmap.svg`);
}

const args = process.argv.slice(2);
const pi = args.indexOf("--pattern");
const { p, cols, rows, scheme } = pickPattern(pi >= 0 ? args[pi + 1] : undefined);
const truth = encodeFile(DEMO_PAYLOAD, scheme, { cols, rows, fileId: 1, fill: "cycle" }).frames[0];
const label = `T${p.id} 纯颜色型 colCellPx=${p.colCellPx} 屏幕像素 ${colorFormat(p.colorBits)} 校准=${
  p.calibMode === "none" ? "无" : p.calibMode === "four_corner" ? "四角" : `密集 N=${p.denseN}`
}`;
console.log(`[图案] ${label} 网格=${cols}×${rows} 数据格=${countDataCells(truth.cellMeta)}`);
if (args.includes("--selftest")) {
  runSelfTest(truth, cols, rows);
} else {
  const pdi = args.indexOf("--photos");
  if (pdi < 0) {
    console.error("用法：--selftest | --photos <dir> [--pattern T1]");
    process.exit(1);
  }
  runPhotos(args[pdi + 1], truth, cols, rows, label);
}
