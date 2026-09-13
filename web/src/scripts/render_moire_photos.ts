// 渲染带摩尔纹的"模拟照片"（相机采集帧），供直观查看屏幕-传感器混叠的彩色 fringe。
// 与 channelSim 数学一致：blur + 色偏 + 噪声 + 非径向梯度，再叠全像素摩尔纹污染。
// 运行：npm run moire:photos
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { loadAllModels } from "../core/calibration.ts";
import type { ModulationScheme, ColorBits } from "../shared/types.ts";
import { renderCapturedFrame } from "../viz/frameRender.ts";
import { savePng } from "../viz/png.ts";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, "../../../docs/bakeoff_visuals");
const models = loadAllModels();

const COLS = 24;
const ROWS = 16;

function pureColorScheme(cb: number): ModulationScheme {
  return {
    id: `mc${cb}`,
    cellPx: 13,
    symbolBits: 0,
    colorBits: cb as ColorBits,
    calibMode: "dense",
    denseN: 4,
    note: `纯颜色 ${1 << cb} 色`
  };
}
function m1Scheme(): ModulationScheme {
  return {
    id: "m1",
    cellPx: 13,
    symbolBits: 4,
    colorBits: 2,
    calibMode: "four_corner",
    denseN: 0,
    note: "M1 4bit 符号 + 2bit 颜色"
  };
}

function moireOf(ch: { moireIntensity: number; moireAngleDeg: number; moireCycles: number; moireAttenuationSigma: number }) {
  return {
    intensity: ch.moireIntensity,
    angleDeg: ch.moireAngleDeg,
    cycles: ch.moireCycles,
    attenuationSigma: ch.moireAttenuationSigma
  };
}

const jobs: Array<{ file: string; ch: keyof typeof models; scheme: ModulationScheme; moire: boolean; seed: number }> = [
  { file: "sim_photo_web_auto_moire.png", ch: "web_auto", scheme: pureColorScheme(4), moire: true, seed: 20260906 },
  { file: "sim_photo_web_auto_clean.png", ch: "web_auto", scheme: pureColorScheme(4), moire: false, seed: 20260906 },
  { file: "sim_photo_native_moire.png", ch: "native", scheme: pureColorScheme(4), moire: true, seed: 20260906 },
  { file: "sim_photo_web_auto_moire_M1.png", ch: "web_auto", scheme: m1Scheme(), moire: true, seed: 20260906 }
];

for (const job of jobs) {
  const ch = models[job.ch];
  const rf = renderCapturedFrame(job.scheme, ch, COLS, ROWS, job.seed, job.moire ? moireOf(ch) : undefined);
  const path = resolve(outDir, job.file);
  savePng(path, rf.canvas);
  console.log(`已生成：${path}`);
}
console.log("\n说明：_moire 图为带摩尔纹的模拟采集帧，_clean 为对照（同一信道、无摩尔纹）。");
