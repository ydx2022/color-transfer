// 共享类型定义（纯 TS、零 DOM）。codec 与仿真器共用，可在 Node 与浏览器运行。

export interface Stat {
  value: number;
  std?: number;
  n?: number;
}

export interface CalibrationData {
  schema_version: number;
  unit_note: string;
  source: {
    canvas: { w: number; h: number; dpr: number; css_w?: number; css_h?: number };
    ppi: number | null;
    photos: string[];
    n_ok: number;
  };
  geometry: { rho_camera_px_per_screen_px: Stat; rho_anisotropy: Stat; reprojection_rms_screen_px: Stat };
  psf: {
    sigma_screen_px: Stat;
    sigma_moment_screen_px: Stat;
    fwhm_screen_px: Stat;
    mtf50_period_screen_px: Stat;
    mtf_at_period_screen_px: Record<string, Stat>;
  };
  contrast: { t_c_screen_px: Stat; T_c_definition: string };
  gamma: { gamma: Stat; gain: Stat; black_offset: Stat; fit_rms: Stat; model: string };
  ccm: {
    M_linear: number[][];
    c_linear: number[];
    rms_linear: number;
    M_encoded: number[][];
    c_encoded: number[];
    rms_encoded: number;
    note: string;
  };
  vignetting: {
    k1: Stat;
    k2: Stat;
    rmax_screen_px: Stat;
    corner_loss_percent: Stat;
    edge_mid_loss_percent: Stat;
    distortion_max_screen_px: Stat;
    model: string;
  };
  noise: { sigma_Y_8bit: Stat; sigma_Cb_8bit: Stat; sigma_Cr_8bit: Stat; snr_db: Stat };
  // 可选：摩尔纹/混叠实测（缺省时由 device tier 推导默认）
  moire?: { intensity: Stat; angle_deg: Stat; cycles?: number };
  design: {
    d_min_screen_px: number;
    d_recommended_screen_px: number;
    rules: string[];
    pixel_level_3x3_feasible: boolean;
  };
  per_photo?: unknown[];
}

// 仿真/解码使用的归一化信道模型（全部长度单位为屏幕像素；颜色 0..1 归一化）
export interface ChannelModel {
  group: string;
  rho: number; // 摄像头像素 / 屏幕像素
  sigmaPsf: number; // 屏幕像素
  tC: number; // 临界周期 屏幕像素
  gamma: number;
  gain: number;
  blackOffset: number;
  ccmEncoded: number[][]; // 3x3 解码器判色用（编码域）
  ccmOffset: number[]; // 3
  ccmLinear: number[][]; // 3x3 线性域
  ccmLinearOffset: number[]; // 3
  cornerLoss: number; // 0..1 角点衰减比例
  noiseSigmaY: number; // 8bit 标准差
  // 四角亮度因子（非径向梯度，线性 0..1）——来源：out_20260904 原生组四角 gray_lin（实测）
  gradient: { tl: number; tr: number; bl: number; br: number };
  worstCase: boolean;
  // 摩尔纹/混叠模型参数（屏幕-摄像头空间频率混叠）
  moireIntensity: number; // 摩尔纹强度倍率：native=1 / web_locked=3 / web_auto=5
  moireAngleDeg: number; // 屏幕-传感器相对角度（度），驱动旋转混叠
  moireCycles: number; // 摩尔纹在整帧跨度内的周期数（可见 fringe 数）
  moireAttenuationSigma: number; // 摩尔纹光学低通(OLPF) σ（单位：格），由真实照片 FFT 校准得到
}

export type ProfileName = "safe" | "balanced" | "fast";
export type CalibMode = "none" | "four_corner" | "dense";
export type ColorBits = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
export type SymbolBits = 0 | 1 | 2 | 3 | 4;

// 调制方案：单元尺寸、形状位宽、颜色位宽、校准模式（含密集网格 N）。铁律：档位参数须有实测/推导依据。
export interface ModulationScheme {
  id: string;
  cellPx: number; // 数据格边长，单位：屏幕像素（非摄像头像素）
  symbolBits: SymbolBits; // 符号维度位宽（形状携带的 bit 数）
  colorBits: ColorBits; // 颜色维度位宽：0 = 无颜色维度（色数 1），2 = 2 bit (4色)，依此类推
  calibMode: CalibMode;
  denseN: number; // 密集网格 N（每 N×N 插 1 校准格 pilot cell；仅 dense 模式有效）
  note: string;
}
