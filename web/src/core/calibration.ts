// 标定加载：直接读取 calibration/out_*/calibration.json（机器可读实测），构建 ChannelModel。
// 铁律：仿真器必须读实测标定数据，禁止凭空假设；文件缺失/字段越界显式抛错，禁止静默。
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { CalibrationData, ChannelModel } from "../shared/types.ts";
import { MOIRE_ATT_SIGMA_DEFAULT } from "../shared/params.ts";

const here = dirname(fileURLToPath(import.meta.url));
const CALIB_DIR = resolve(here, "../../../calibration");

// 四角亮度因子（非径向梯度，线性 0..1）—— 来源：out_20260904 原生组四角 gray_lin（report §6 / calibration.json 实测）
// 任务书指定用于仿真器「局部颜色偏移」建模。标定为实测值，非假设。
export const MEASURED_GRADIENT = { tl: 0.252, tr: 0.201, bl: 0.493, br: 0.428 };

export const GROUP_FILES: Record<string, string> = {
  native: "out_20260904/calibration.json",
  web_auto: "out_web/calibration.json",
  web_locked: "out_web_locked/calibration.json"
};

export function loadCalibration(group: string): CalibrationData {
  const rel = GROUP_FILES[group];
  if (!rel) throw new Error(`loadCalibration: 未知标定组 "${group}"（可选：${Object.keys(GROUP_FILES).join(", ")}）`);
  const file = resolve(CALIB_DIR, rel);
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch (e) {
    throw new Error(`loadCalibration: 无法读取标定文件 ${file}（请确认 calibration/ 下存在该实测文件）—— ${(e as Error).message}`);
  }
  let data: CalibrationData;
  try {
    data = JSON.parse(raw) as CalibrationData;
  } catch (e) {
    throw new Error(`loadCalibration: JSON 解析失败 ${file} —— ${(e as Error).message}`);
  }
  validateCalibration(data, group);
  return data;
}

function validateCalibration(d: CalibrationData, group: string): void {
  const need: Array<[string, unknown]> = [
    ["geometry.rho", d.geometry?.rho_camera_px_per_screen_px?.value],
    ["psf.sigma", d.psf?.sigma_screen_px?.value],
    ["contrast.t_c", d.contrast?.t_c_screen_px?.value],
    ["gamma.gamma", d.gamma?.gamma?.value],
    ["ccm.M_encoded", d.ccm?.M_encoded],
    ["noise.sigma_Y", d.noise?.sigma_Y_8bit?.value]
  ];
  for (const [k, v] of need) {
    if (v === undefined || v === null || (typeof v === "number" && !isFinite(v))) {
      throw new Error(`loadCalibration(${group}): 标定字段缺失或越界 "${k}"`);
    }
  }
  if (!Array.isArray(d.ccm.M_encoded) || d.ccm.M_encoded.length !== 3 || d.ccm.M_encoded[0].length !== 3) {
    throw new Error(`loadCalibration(${group}): CCM 矩阵形状非法（应为 3×3）`);
  }
}

// 摩尔纹强度/角度/周期的设备档默认（验收要求：native=1×, web_locked=3×, web_auto=5×）
function defaultMoireForGroup(group: string): { intensity: number; angleDeg: number; cycles: number } {
  switch (group) {
    case "native":
      return { intensity: 1, angleDeg: 0.6, cycles: 3 };
    case "web_locked":
      return { intensity: 3, angleDeg: 1.2, cycles: 3 };
    case "web_auto":
      return { intensity: 5, angleDeg: 2.5, cycles: 3 };
    default:
      return { intensity: 1, angleDeg: 0.6, cycles: 3 };
  }
}

// 摩尔纹 OLPF σ（单位：格）：由 calibration/calibrate_moire.py 对真实照片做 2D FFT 反推得到。
// 文件缺失时回退 MOIRE_ATT_SIGMA_DEFAULT 并显式告警（禁止静默回退）。
const MOIRE_CALIB_FILE = "out_moire_calibration/moire_calibration.json";
let moireCalibCache: Record<string, number> | null = null;

export function loadMoireCalibration(): Record<string, number> {
  if (moireCalibCache) return moireCalibCache;
  const file = resolve(CALIB_DIR, MOIRE_CALIB_FILE);
  const out: Record<string, number> = {};
  if (existsSync(file)) {
    const j = JSON.parse(readFileSync(file, "utf8")) as {
      tiers?: Record<string, { calibrated_sigma_cells?: number }>;
    };
    for (const [k, v] of Object.entries(j.tiers ?? {})) {
      const s = v?.calibrated_sigma_cells;
      if (typeof s === "number" && isFinite(s) && s >= 0) out[k] = s;
    }
  } else {
    console.warn(`loadMoireCalibration: 未找到 ${file}，摩尔纹 σ 回退默认值 ${MOIRE_ATT_SIGMA_DEFAULT}`);
  }
  moireCalibCache = out;
  return out;
}

export function buildChannelModel(cal: CalibrationData, group: string, worstCase = false): ChannelModel {
  const dm = cal.moire
    ? { intensity: cal.moire.intensity.value, angleDeg: cal.moire.angle_deg.value, cycles: cal.moire.cycles ?? 3 }
    : defaultMoireForGroup(group);
  const mSigma = loadMoireCalibration()[group] ?? MOIRE_ATT_SIGMA_DEFAULT;
  return {
    group,
    rho: cal.geometry.rho_camera_px_per_screen_px.value,
    sigmaPsf: cal.psf.sigma_screen_px.value,
    tC: cal.contrast.t_c_screen_px.value,
    gamma: cal.gamma.gamma.value,
    gain: cal.gamma.gain.value,
    blackOffset: cal.gamma.black_offset.value,
    ccmEncoded: cal.ccm.M_encoded,
    ccmOffset: cal.ccm.c_encoded,
    ccmLinear: cal.ccm.M_linear,
    ccmLinearOffset: cal.ccm.c_linear,
    cornerLoss: cal.vignetting.corner_loss_percent.value / 100,
    noiseSigmaY: cal.noise.sigma_Y_8bit.value,
    gradient: MEASURED_GRADIENT,
    worstCase,
    moireIntensity: dm.intensity,
    moireAngleDeg: dm.angleDeg,
    moireCycles: dm.cycles,
    moireAttenuationSigma: mSigma
  };
}

export function loadChannelModel(group: string, worstCase = false): ChannelModel {
  return buildChannelModel(loadCalibration(group), group, worstCase);
}

// 三组标定 → 三个信道模型（供 getChannelQuality 单测与擂台赛一键切换）
export function loadAllModels(): Record<string, ChannelModel> {
  const out: Record<string, ChannelModel> = {};
  for (const g of Object.keys(GROUP_FILES)) out[g] = loadChannelModel(g);
  return out;
}

export const CALIBRATION_DIR = CALIB_DIR;
