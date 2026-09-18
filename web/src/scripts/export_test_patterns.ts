// 离线导出 8 张**纯颜色型**实测图案 PNG 到 calibration/test_patterns/，并做程序化像素级自检。
// 与 SendPage 共用同一编码（core/encoder）与光栅化（viz/raster），保证导出与网页渲染逐像素一致。
// 图案为【真实密度小块】：数据格边长 = colCellPx 屏幕像素，小块约 640×360 屏幕像素（与发送页一致）。
// 运行：npm run export:patterns
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  encodeFile,
  CELL_META_ANCHOR,
  CELL_META_PILOT,
  CELL_META_ORIENT,
  CELL_META_DATA,
  countDataCells,
  type CellFrame
} from "../core/encoder.ts";
import { encodeCell } from "../core/modulation.ts";
import { colorPalette } from "../shared/params.ts";
import { rasterizeFrame } from "../viz/raster.ts";
import { savePng, createCanvas, type Canvas } from "../viz/png.ts";
import { DEMO_PAYLOAD } from "../shared/testPayload.ts";
import { TEST_PATTERNS, schemeOfPattern, colorFormat } from "../shared/testPatterns.ts";
import type { RGBAImage } from "../receiver/types.ts";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, "../../../calibration/test_patterns");
mkdirSync(outDir, { recursive: true });

const PATCH_W = 640;
const PATCH_H = 360;

function pixelAt(img: RGBAImage, x: number, y: number): number[] {
  const cx = Math.max(0, Math.min(img.width - 1, x));
  const cy = Math.max(0, Math.min(img.height - 1, y));
  const o = (cy * img.width + cx) * 4;
  return [img.data[o], img.data[o + 1], img.data[o + 2]];
}
const to255 = (c: number[]) => [Math.round(c[0] * 255), Math.round(c[1] * 255), Math.round(c[2] * 255)];
function near(a: number[], b: number[], tol = 6): boolean {
  return Math.abs(a[0] - b[0]) <= tol && Math.abs(a[1] - b[1]) <= tol && Math.abs(a[2] - b[2]) <= tol;
}
function blit(dst: Canvas, src: RGBAImage): void {
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      const s = (y * src.width + x) * 4;
      const d = (y * dst.width + x) * 4;
      dst.data[d] = src.data[s];
      dst.data[d + 1] = src.data[s + 1];
      dst.data[d + 2] = src.data[s + 2];
      dst.data[d + 3] = 255;
    }
  }
}

let totalIssues = 0;
const lines: string[] = [];
const manifest: unknown[] = [];
const say = (s = "") => {
  lines.push(s);
  console.log(s);
};

say(`导出 ${TEST_PATTERNS.length} 张纯颜色型测试图案（真实密度小块）→ ${outDir}`);
say();
say("图案 | 族 | colCellPx(屏幕px) | 网格 | 颜色 | 校准 | 窗口 | 数据格 | 校准格 | 检查");
say("---|---|---|---|---|---|---|---|---|---");

for (const p of TEST_PATTERNS) {
  const scheme = schemeOfPattern(p);
  const cols = Math.max(1, Math.floor(PATCH_W / p.colCellPx));
  const rows = Math.max(1, Math.floor(PATCH_H / p.colCellPx));
  const frame: CellFrame = encodeFile(DEMO_PAYLOAD, scheme, { cols, rows, fileId: 1, fill: "cycle" }).frames[0];
  const scale = p.colCellPx;
  const img = rasterizeFrame(frame, scale);
  const palette = colorPalette(scheme.colorBits);

  const cv = createCanvas(img.width, img.height);
  blit(cv, img);
  savePng(resolve(outDir, `T${p.id}_color_${p.colCellPx}px_${1 << p.colorBits}色.png`), cv);

  const issues: string[] = [];
  // 四角标记：3 锚点（亮底暗心）+ 右下方向标记（暗底亮心）
  for (const [c, r] of [[0, 0], [cols - 1, 0], [0, rows - 1]] as Array<[number, number]>) {
    const i = r * cols + c;
    if (frame.cellMeta[i] !== CELL_META_ANCHOR) {
      issues.push(`锚点元数据缺失 @(${c},${r})`);
      continue;
    }
    const corner = pixelAt(img, c * scale, r * scale);
    if (corner[0] < 200 || corner[1] < 200 || corner[2] < 200) issues.push(`锚点白底异常 @(${c},${r}) rgb=${corner}`);
  }
  const oi = (rows - 1) * cols + (cols - 1);
  if (frame.cellMeta[oi] !== CELL_META_ORIENT) {
    issues.push("右下角缺少方向标记");
  } else {
    const oc = pixelAt(img, (cols - 1) * scale, (rows - 1) * scale);
    if (oc[0] > 60 || oc[1] > 60 || oc[2] > 60) issues.push(`方向标记暗底异常 rgb=${oc}`);
  }

  let calibN = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      const meta = frame.cellMeta[i];
      if (meta === CELL_META_PILOT) {
        calibN++;
        const exp = to255(palette[frame.pilotParity[i] % Math.max(1, palette.length)]);
        const got = pixelAt(img, c * scale + (scale >> 1), r * scale + (scale >> 1));
        if (!near(got, exp)) issues.push(`校准格颜色异常 @(${c},${r}) 期望${exp} 实际${got}`);
        continue;
      }
      if (meta !== CELL_META_DATA) continue;
      const v = frame.values[i];
      if (v < 0) continue;
      const code = encodeCell(scheme, v);
      const exp = to255(palette[code.colorIdx % Math.max(1, palette.length)]);
      const got = pixelAt(img, c * scale + (scale >> 1), r * scale + (scale >> 1));
      if (!near(got, exp)) issues.push(`数据格底色异常 @(${c},${r}) 期望${exp} 实际${got}`);
    }
  }

  totalIssues += issues.length;
  const dataCells = countDataCells(frame.cellMeta);
  say(
    `T${p.id} | 纯颜色型 | ${p.colCellPx} | ${cols}×${rows} | ${colorFormat(p.colorBits)} | ${
      p.calibMode === "none" ? "无" : p.calibMode === "four_corner" ? "四角" : `密集 N=${p.denseN}`
    } | ${p.winFrac === 1 / 3 ? "1/3" : p.winFrac === 0.5 ? "1/2" : p.winFrac.toFixed(2)} | ${dataCells} | ${calibN} | ${
      issues.length === 0 ? "OK" : issues.join("；")
    }`
  );
  manifest.push({
    id: p.id,
    family: "纯颜色型",
    profile: p.profile,
    colCellPx: p.colCellPx,
    colorBits: p.colorBits,
    colorFmt: colorFormat(p.colorBits),
    calibMode: p.calibMode,
    denseN: p.denseN,
    winFrac: p.winFrac,
    cols,
    rows,
    dataCells,
    calibCells: calibN
  });
}

say();
say(totalIssues > 0 ? `自检未通过：共 ${totalIssues} 个问题` : "自检全部通过 ✓");
writeFileSync(resolve(outDir, "manifest.json"), JSON.stringify(manifest, null, 2));
say(`manifest → ${outDir}/manifest.json`);

const reportPath = resolve(here, "../../dist/export_report.txt");
mkdirSync(dirname(reportPath), { recursive: true });
writeFileSync(reportPath, lines.join("\n"), "utf8");
if (totalIssues > 0) process.exitCode = 1;
