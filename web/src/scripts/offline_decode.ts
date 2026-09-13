// 离线分析脚本（tsx 运行）：真机照片 / 合成帧 → 定位 → 透视校正 → 逐格解码 → 与真值比对。
// 输入：用户用 SendPage 拍的照片（按修改时间排序，对应循环播放序列）。
// 处理：每帧解码后，与所有真值帧逐格比对，取格错误率最小者为其所属帧（自动对齐帧序）。
// 输出：格错误率（cell error rate；注意不是比特错误率 BER）、错误分布热力图(SVG)、错格清单(JSON)。
//
// 用法：
//   npx tsx src/scripts/offline_decode.ts --selftest            # 合成帧自检（格错误率应≈0）
//   npx tsx src/scripts/offline_decode.ts --photos <dir>        # 真机照片回归
import { readdirSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { encodeFile, countDataCells, CELL_META_DATA, type CellFrame } from "../core/encoder.ts";
import { DEMO_PAYLOAD } from "../shared/testPayload.ts";
import type { ModulationScheme } from "../shared/types.ts";
import { decodeImage } from "../receiver/pipeline.ts";
import { rasterizeFrame } from "../viz/raster.ts";
import type { RGBAImage } from "../receiver/types.ts";

const OUT_DIR = "../calibration/out_offline_decode";
mkdirSync(OUT_DIR, { recursive: true });

const COLS = 24;
const ROWS = 14;
const SCALE = 26;
const scheme: ModulationScheme = {
  id: "send",
  cellPx: 13,
  symbolBits: 4,
  colorBits: 2,
  calibMode: "dense",
  denseN: 3,
  note: "发送"
};

function groundTruth(): CellFrame[] {
  return encodeFile(DEMO_PAYLOAD, scheme, { cols: COLS, rows: ROWS, fileId: 1 }).frames;
}

// 取某真值帧的数据格预期值（按 cellMeta 顺序）
function expectedDataValues(frame: CellFrame): Int16Array {
  return frame.values;
}

interface PhotoResult {
  file: string;
  frameIndex: number;
  dataCells: number;
  errors: number;
  cellErrorRate: number; // 格错误率 = 判错的数据格数 / 数据格总数（注意：不是比特错误率 BER）
}

function compareDecodedToFrames(decoded: { values: Int16Array; cellMeta: Uint8Array }, frames: CellFrame[]): { frameIndex: number; errors: number; dataCells: number } {
  let best = { frameIndex: -1, errors: 1e9, dataCells: 0 };
  for (let fi = 0; fi < frames.length; fi++) {
    const gt = expectedDataValues(frames[fi]);
    let errors = 0;
    let dataCells = 0;
    for (let i = 0; i < decoded.cellMeta.length; i++) {
      if (decoded.cellMeta[i] !== CELL_META_DATA) continue;
      dataCells++;
      if (decoded.values[i] !== gt[i]) errors++;
    }
    if (errors < best.errors) best = { frameIndex: fi, errors, dataCells };
  }
  return best;
}

function writeHeatmap(path: string, errGrid: Float32Array, cntGrid: Float32Array, cols: number, rows: number): void {
  const cell = 22;
  const W = cols * cell + 1;
  const H = rows * cell + 1;
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" font-size="9">`;
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

function runSelfTest(frames: CellFrame[]): void {
  let totalData = 0;
  let totalErr = 0;
  const errGrid = new Float32Array(COLS * ROWS);
  const cntGrid = new Float32Array(COLS * ROWS);
  for (const f of frames) {
    const img = rasterizeFrame(f, SCALE);
    const dec = decodeImage(img, f);
    for (let i = 0; i < f.cellMeta.length; i++) {
      if (f.cellMeta[i] !== CELL_META_DATA) continue;
      cntGrid[i]++;
      if (dec.values[i] !== f.values[i]) {
        totalErr++;
        errGrid[i]++;
      }
    }
    totalData += countDataCells(f.cellMeta);
  }
  console.log(`[selftest] 数据格=${totalData} 错误=${totalErr} 格错误率=${(totalErr / totalData).toFixed(4)}`);
  writeHeatmap("../calibration/out_offline_decode/heatmap_selftest.svg", errGrid, cntGrid, COLS, ROWS);
  console.log(`[selftest] 热力图 → ${OUT_DIR}/heatmap_selftest.svg`);
}

async function runPhotos(dir: string, frames: CellFrame[]): Promise<void> {
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
  const errGrid = new Float32Array(COLS * ROWS);
  const cntGrid = new Float32Array(COLS * ROWS);
  const results: PhotoResult[] = [];
  let totalData = 0;
  let totalErr = 0;
  for (const f of files) {
    // ensureAlpha 保证 4 通道 RGBA（raw() 的 RawOptions 不接受 channels 字段）
    const buf = await sharp(join(dir, f)).ensureAlpha().raw().toBuffer();
    const meta = await sharp(join(dir, f)).metadata();
    const img: RGBAImage = { width: meta.width!, height: meta.height!, data: new Uint8ClampedArray(buf) };
    const dec = decodeImage(img, frames[0]); // 用 frames[0] 的布局（所有帧布局相同）
    const cmp = compareDecodedToFrames(dec, frames);
    for (let i = 0; i < dec.cellMeta.length; i++) {
      if (dec.cellMeta[i] !== CELL_META_DATA) continue;
      cntGrid[i]++;
      const gt = frames[cmp.frameIndex].values[i];
      if (dec.values[i] !== gt) errGrid[i]++;
    }
    totalData += cmp.dataCells;
    totalErr += cmp.errors;
    // cmp.errors 为「判错的数据格数」，故该比值是格错误率，不是比特错误率 BER
    const cellErrorRate = cmp.dataCells ? cmp.errors / cmp.dataCells : 0;
    results.push({ file: f, frameIndex: cmp.frameIndex, dataCells: cmp.dataCells, errors: cmp.errors, cellErrorRate });
    console.log(`[photos] ${f} → 帧#${cmp.frameIndex} 数据格=${cmp.dataCells} 错=${cmp.errors} 格错误率=${cellErrorRate.toFixed(4)}`);
  }
  const outDir = "../calibration/out_offline_decode";
  mkdirSync(outDir, { recursive: true });
  writeFileSync(
    join(outDir, "cell_error_report.json"),
    JSON.stringify({ totalData, totalErr, cellErrorRate: totalErr / Math.max(1, totalData), photos: results }, null, 2)
  );
  writeHeatmap(join(outDir, "heatmap.svg"), errGrid, cntGrid, COLS, ROWS);
  console.log(`[photos] 汇总：数据格=${totalData} 错误=${totalErr} 格错误率=${(totalErr / Math.max(1, totalData)).toFixed(4)}`);
  console.log(`[photos] 报告 → ${outDir}/ber_report.json ；热力图 → ${outDir}/heatmap.svg`);
}

const args = process.argv.slice(2);
const frames = groundTruth();
if (args.includes("--selftest")) {
  runSelfTest(frames);
} else {
  const pi = args.indexOf("--photos");
  if (pi < 0) {
    console.error("用法：--selftest | --photos <dir>");
    process.exit(1);
  }
  runPhotos(args[pi + 1], frames);
}
