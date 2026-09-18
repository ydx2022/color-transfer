// 信道仿真器（纯 TS、零 DOM）：直接读取实测 ChannelModel，对单个数据格做端到端信道模拟。
// 链路：CCM(编码域) → 非径向亮度梯度(局部增益) → 加性噪声 → 量化。形状维度对梯度近似不变（阈值相对）。
// 校准模式：none / four_corner / dense（密集网格，每 N×N 插 1 校准格，局部估计增益以校正颜色判定）。
// 铁律：梯度/CCM/噪声/PSF 全部来自实测 calibration.json；局部高频成分以经验波纹建模（标「假设」）。
import type { ChannelModel, CalibMode } from "../shared/types.ts";
import { MOIRE_ATT_SIGMA_DEFAULT } from "../shared/params.ts";

export type Rng = () => number; // 均匀 0..1，可种子化以保证可复现

export interface CellPos {
  col: number;
  row: number;
  u: number; // 0=左 1=右
  v: number; // 0=上 1=下
  isCalib: boolean;
}

export interface Frame {
  cols: number;
  rows: number;
  denseN: number;
  cells: CellPos[];
}

export function buildFrame(cols: number, rows: number, denseN: number, mode: CalibMode): Frame {
  const cells: CellPos[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      let isCalib = false;
      if (mode === "dense" && denseN > 0) isCalib = col % denseN === 0 && row % denseN === 0;
      else if (mode === "four_corner") isCalib = (col === 0 || col === cols - 1) && (row === 0 || row === rows - 1);
      cells.push({ col, row, u: (col + 0.5) / cols, v: (row + 0.5) / rows, isCalib });
    }
  }
  return { cols, rows, denseN, cells };
}

// ——— 梯度场 ———
export function bilinear(u: number, v: number, g: { tl: number; tr: number; bl: number; br: number }): number {
  const top = g.tl * (1 - u) + g.tr * u;
  const bot = g.bl * (1 - u) + g.br * u;
  return top * (1 - v) + bot * v;
}

// 真实梯度 = 四角双线性 基 + 局部高频波纹（假设：实测仅四角，局部高频以经验波纹建模，待更高分辨率标定）
export function trueGradAt(u: number, v: number, ch: ChannelModel): number {
  const base = bilinear(u, v, ch.gradient);
  const ripple = 1 + 0.08 * Math.sin(3 * Math.PI * u) * Math.sin(2 * Math.PI * v) + 0.05 * Math.sin(5 * Math.PI * v);
  return base * ripple;
}

function trueGradAtCell(col: number, row: number, ch: ChannelModel, frame: Frame): number {
  const u = (col + 0.5) / frame.cols;
  const v = (row + 0.5) / frame.rows;
  return trueGradAt(u, v, ch);
}

// 解码端对当前格的增益估计（校准核心）
export function estimateGradAt(pos: CellPos, mode: CalibMode, ch: ChannelModel, frame: Frame): number {
  if (mode === "none") return 1;
  if (mode === "four_corner") return bilinear(pos.u, pos.v, ch.gradient);
  // dense：在四周校准格的真实梯度上做双线性插值（采样到局部高频）
  const N = frame.denseN || 1;
  const c0 = Math.max(0, Math.floor(pos.col / N) * N);
  const c1 = Math.min(frame.cols - 1, c0 + N);
  const r0 = Math.max(0, Math.floor(pos.row / N) * N);
  const r1 = Math.min(frame.rows - 1, r0 + N);
  const g00 = trueGradAtCell(c0, r0, ch, frame);
  const g10 = trueGradAtCell(c1, r0, ch, frame);
  const g01 = trueGradAtCell(c0, r1, ch, frame);
  const g11 = trueGradAtCell(c1, r1, ch, frame);
  const fu = (pos.col - c0) / Math.max(1, c1 - c0);
  const fv = (pos.row - r0) / Math.max(1, r1 - r0);
  const top = g00 * (1 - fu) + g10 * fu;
  const bot = g01 * (1 - fu) + g11 * fu;
  return top * (1 - fv) + bot * fv;
}

// ——— CCM（编码域）：known → captured ———
export function ccmEncode(rgb: number[], ch: ChannelModel): number[] {
  const M = ch.ccmEncoded;
  const c = ch.ccmOffset;
  const out = [0, 0, 0];
  for (let i = 0; i < 3; i++) out[i] = M[i][0] * rgb[0] + M[i][1] * rgb[1] + M[i][2] * rgb[2] + c[i];
  return out;
}

// ——— 摩尔纹 / 混叠合成 ———
// 屏幕像素栅格 × 摄像头传感器栅格 → 基础拍频；Bayer CFA 的 R/G/B 子采样 → 彩色混叠；
// 相对角度 θ → 旋转混叠。输出：每个数据格的"混叠污染颜色"（加性，作用于捕获域，增益校准无法消除）。
// 注：此为可见摩尔纹的唯象模型——真实混叠频率由屏幕子像素间距/传感器间距/放大率决定，
// 但其对"单元级判色"的危害可等效为整帧跨度内若干周期的低频彩色 fringe，本模型按此建模。
export interface MoireOpts {
  intensity: number; // 设备档倍率：native=1 / web_locked=3 / web_auto=5
  angleDeg: number; // 屏幕-传感器相对角度（度）
  cycles: number; // 整帧跨度内的摩尔纹周期数（可见 fringe 数）
  phaseShift?: number;
  attenuationSigma?: number; // OLPF σ（格）
  frameCols?: number;
  frameRows?: number;
}

// 光学低通（OLPF）等效衰减：真实相机的抗混叠低通 + 有限孔径 + 手持微抖会大幅削弱
// "理想栅格叠加"产生的摩尔纹。高斯 OLPF 对频率 f 的正弦 fringe 传递函数 H(f)=exp(-2π²f²σ²)。
// σ 单位 = 格；f 单位 = 周期/格（由整帧周期数 cycles 除以帧格数得到）。
export function olpfAttenuation(m: MoireOpts): number {
  const sigma = m.attenuationSigma ?? MOIRE_ATT_SIGMA_DEFAULT;
  if (sigma <= 0) return 1;
  const cols = m.frameCols ?? 24;
  const rows = m.frameRows ?? 16;
  const th = (m.angleDeg * Math.PI) / 180;
  const kx = (m.cycles * Math.cos(th)) / cols;
  const ky = (m.cycles * Math.sin(th)) / rows;
  return Math.exp(-2 * Math.PI * Math.PI * (kx * kx + ky * ky) * sigma * sigma);
}

export function moireContamination(u: number, v: number, m: MoireOpts): [number, number, number] {
  const theta = (m.angleDeg * Math.PI) / 180;
  const phase = 2 * Math.PI * m.cycles * (u * Math.cos(theta) + v * Math.sin(theta)) + (m.phaseShift ?? 0);
  const a = 0.04 * m.intensity * olpfAttenuation(m); // 基础幅度 × 光学低通衰减
  // Bayer/RGB 子像素错位：三通道相位差 120°，制造彩色镶边（R/G/B 子采样混叠）
  const ph = [0, (2 * Math.PI) / 3, (4 * Math.PI) / 3];
  return [a * Math.sin(phase + ph[0]), a * Math.sin(phase + ph[1]), a * Math.sin(phase + ph[2])];
}

// 频域带阻解混叠：已知摩尔纹频率 (cycles, angle)，从每通道场的单频正弦分量中投影并扣除。
// 因频率已知（由 cycles/angle 生成），无需全 FFT，直接做单频 Goertzel 式投影即可精确去除。
export function applyBandstop(capGrid: (number[] | null)[][], cycles: number, angleDeg: number): void {
  const rows = capGrid.length;
  if (rows === 0) return;
  const cols = capGrid[0].length;
  const theta = (angleDeg * Math.PI) / 180;
  const fx = (cycles * Math.cos(theta)) / cols; // 每列周期数
  const fy = (cycles * Math.sin(theta)) / rows; // 每行周期数
  for (let ch = 0; ch < 3; ch++) projectAndRemove(capGrid, fx, fy, ch);
}

function projectAndRemove(grid: (number[] | null)[][], fx: number, fy: number, ch: number): void {
  const rows = grid.length;
  const cols = grid[0].length;
  let a = 0;
  let b = 0;
  let cnt = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cell = grid[r][c];
      if (!cell) continue;
      const ang = 2 * Math.PI * (fx * c + fy * r);
      a += cell[ch] * Math.cos(ang);
      b += cell[ch] * Math.sin(ang);
      cnt++;
    }
  }
  if (cnt === 0) return;
  a = (2 * a) / cnt;
  b = (2 * b) / cnt;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cell = grid[r][c];
      if (!cell) continue;
      const ang = 2 * Math.PI * (fx * c + fy * r);
      cell[ch] -= a * Math.cos(ang) + b * Math.sin(ang);
    }
  }
}

// ——— 颜色维度 ———
export function simulateColorCell(
  intentRgb: number[],
  u: number,
  v: number,
  cellPx: number,
  calibEstimate: number,
  ch: ChannelModel,
  rnd: Rng,
  moire?: MoireOpts
): number[] {
  const nominal = ccmEncode(intentRgb, ch);
  const grad = trueGradAt(u, v, ch);
  const samples = Math.max(1, Math.round(Math.pow((ch.rho * cellPx) / 4, 2) * 0.25));
  const noiseStd = ch.noiseSigmaY / 255 / Math.sqrt(samples);
  const cap: number[] = [];
  for (let i = 0; i < 3; i++) cap[i] = clamp01(nominal[i] * grad + gauss(rnd) * noiseStd);
  // 摩尔纹污染：加性作用于捕获域，增益校准（cap/estimate）无法消除 → 真实恶化判色
  if (moire) {
    const mc = moireContamination(u, v, moire);
    for (let i = 0; i < 3; i++) cap[i] = clamp01(cap[i] + mc[i]);
  }
  return cap;
}

export function decodeColorCell(captured: number[], palette: number[][], ch: ChannelModel, calibEstimate: number): number {
  // 校正：received / estimate，再与各色板标称 captured 距离最小匹配
  const corr = [captured[0] / calibEstimate, captured[1] / calibEstimate, captured[2] / calibEstimate];
  let best = 0;
  let bestD = Infinity;
  for (let p = 0; p < palette.length; p++) {
    const nom = ccmEncode(palette[p], ch);
    const d = (nom[0] - corr[0]) ** 2 + (nom[1] - corr[1]) ** 2 + (nom[2] - corr[2]) ** 2;
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}

// ——— 形状维度（8×8 二值点阵）———
export function blurContrast(cellPx: number, grid: number, sigmaPsf: number): number {
  const dotSize = cellPx / grid; // 单点屏幕像素
  const r = sigmaPsf / dotSize;
  return 1 / (1 + r * r); // 大点→接近 1；小点被模糊→降低
}

export function simulateSymbolCell(
  pattern: number[],
  cellPx: number,
  grid: number,
  u: number,
  v: number,
  ch: ChannelModel,
  rnd: Rng
): number[] {
  const cf = blurContrast(cellPx, grid, ch.sigmaPsf);
  const grad = trueGradAt(u, v, ch);
  const darkBase = 0.06;
  const range = 0.88;
  const samples = Math.max(1, Math.round(Math.pow(ch.rho * (cellPx / grid), 2)));
  const noiseStd = ch.noiseSigmaY / 255 / Math.sqrt(samples);
  const threshold = grad * (darkBase + 0.5 * cf * range);
  const out = new Array<number>(pattern.length);
  for (let i = 0; i < pattern.length; i++) {
    const level = grad * (darkBase + pattern[i] * cf * range) + gauss(rnd) * noiseStd;
    out[i] = level > threshold ? 1 : 0;
  }
  return out;
}

export function decodeSymbolCell(received: number[], symbols: number[][]): number {
  let best = 0;
  let bestD = Infinity;
  for (let s = 0; s < symbols.length; s++) {
    let d = 0;
    for (let i = 0; i < received.length; i++) d += received[i] ^ symbols[s][i];
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return best;
}

// ——— 工具 ———
function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

export function gauss(rnd: Rng): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rnd();
  while (v === 0) v = rnd();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// ============================================================================
// 空间模糊【物理模型】——取代此前的 `blurContrast = 1/(1+r^2)` 近似
//
// 定案前提：σ_PSF 单位 = 【屏幕像素】（见 calibration/analyze_calibration.py:12/395/1085 与
// calibration.json 的 psf.sigma_screen_px）。在此单位下，web_auto 的 σ=2.78 屏幕像素
// 大于现行 sub=1.625 屏幕像素，旧模型仍给出 25.5% 残余对比度（物理上约 5.5e-7），
// 故旧模型对符号型过于乐观约 5 个数量级，且纯颜色型完全没有模糊项 —— 均已废弃。
//
// 统一模型：局域盒式渲染 → 真实高斯卷积 → 按采样窗取平均。
// 实现为【解析盒到盒权重】：源矩形经高斯 PSF 后在采样矩形窗内的平均贡献。
// 这等价于「超采样离散卷积」在超采样倍数→∞ 时的连续极限（无离散化误差），
// 且为 O(1)，使上千组参数扫描可完成。
// ============================================================================

// 误差函数（Abramowitz & Stegun 7.1.26，|ε| < 1.5e-7）
export function erf(z: number): number {
  const s = z < 0 ? -1 : 1;
  const x = Math.abs(z);
  const t = 1 / (1 + 0.3275911 * x);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-x * x);
  return s * y;
}

function gaussCdf(z: number): number {
  return 0.5 * (1 + erf(z / Math.SQRT2));
}
function gaussPdf(z: number): number {
  return Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI);
}
// ∫Φ(u)du = u·Φ(u) + φ(u)
function antiderivF(u: number): number {
  return u * gaussCdf(u) + gaussPdf(u);
}

/**
 * 源区间 [a,b] 的均匀发光，经标准差 sigma 的高斯 PSF 后，
 * 落在采样窗 [c,d] 内的**平均贡献权重**（窗内取平均）。
 * 推导：∫_c^d [Φ((b-x)/σ) − Φ((a-x)/σ)] dx / (d−c)
 *     = σ·[F((b-c)/σ) − F((b-d)/σ) − F((a-c)/σ) + F((a-d)/σ)] / (d−c)
 */
export function boxToBoxWeight(a: number, b: number, c: number, d: number, sigma: number): number {
  const w = d - c;
  if (w <= 0) return 0;
  if (sigma <= 1e-9) {
    const lo = Math.max(a, c);
    const hi = Math.min(b, d);
    return Math.max(0, hi - lo) / w;
  }
  const s = sigma;
  const I = (lo: number) => s * (antiderivF((lo - c) / s) - antiderivF((lo - d) / s));
  return (I(b) - I(a)) / w;
}

/**
 * 均匀网格（间距 pitch 屏幕像素）上的 1D 模糊核。
 * K[m] = 「偏移 m 个格位」的源格 → 「中心格内、边长占 winFrac 的居中采样窗」的平均权重。
 * 返回 { k, R }：k 长度为 2R+1，k[R+m] 即 K[m]。已归一化以补偿截断（Σ K = 1）。
 */
export function blurKernel1D(pitch: number, winFrac: number, sigma: number, radiusSigma = 3.5): { k: number[]; R: number } {
  const p = Math.max(pitch, 1e-9);
  const R = Math.max(1, Math.ceil((radiusSigma * sigma) / p) + 1);
  const half = (winFrac * p) / 2;
  const wc = 0.5 * p; // 中心格中心
  const c0 = wc - half;
  const c1 = wc + half;
  const k: number[] = [];
  let sum = 0;
  for (let m = -R; m <= R; m++) {
    const v = boxToBoxWeight(m * p, (m + 1) * p, c0, c1, sigma);
    k.push(v);
    sum += v;
  }
  for (let i = 0; i < k.length; i++) k[i] /= sum > 0 ? sum : 1;
  return { k, R };
}

// 符号型：把（中心格 + 邻格）的符号子格亮度场做可分离高斯卷积，返回中心格 symRes×symRes 的观测电平。
// levels 取值：1 = 亮（底色），0 = 暗（符号点）。邻格内容由调用方随机生成。
export function convSymbolCell(
  symRes: number,
  sub: number,
  sigmaPsf: number,
  levels: (gx: number, gy: number, cellCx: number, cellCy: number) => number,
  winFrac = 1,
  neighborRange = 3
): Float64Array {
  const { k, R } = blurKernel1D(sub, winFrac, sigmaPsf);
  const nCell = Math.max(1, Math.ceil((R + 1) / symRes) + neighborRange);
  const lo = -nCell * symRes;
  const hi = nCell * symRes; // 扩展格范围 [lo, hi)
  const N = hi - lo;
  const src = new Float64Array(N * N);
  for (let iy = 0; iy < N; iy++) {
    const gy = (lo + iy) % symRes < 0 ? ((lo + iy) % symRes) + symRes : (lo + iy) % symRes;
    const cy = Math.floor((lo + iy) / symRes);
    for (let ix = 0; ix < N; ix++) {
      const gx = (lo + ix) % symRes < 0 ? ((lo + ix) % symRes) + symRes : (lo + ix) % symRes;
      const cx = Math.floor((lo + ix) / symRes);
      src[iy * N + ix] = levels(gx, gy, cx, cy);
    }
  }
  // 可分离卷积：先 y 后 x
  // 可分离卷积：先 y 后 x。源全局索引 = 输出全局索引 + m；数组下标 = 全局索引 − lo。
  const tmp = new Float64Array(N * symRes);
  for (let ix = 0; ix < N; ix++) {
    for (let j = 0; j < symRes; j++) {
      let acc = 0;
      for (let m = -R; m <= R; m++) {
        const iy = j + m - lo;
        if (iy < 0 || iy >= N) continue;
        acc += k[R + m] * src[iy * N + ix];
      }
      tmp[ix * symRes + j] = acc;
    }
  }
  const out = new Float64Array(symRes * symRes);
  for (let j = 0; j < symRes; j++) {
    for (let i = 0; i < symRes; i++) {
      let acc = 0;
      for (let m = -R; m <= R; m++) {
        const ix = i + m - lo;
        if (ix < 0 || ix >= N) continue;
        acc += k[R + m] * tmp[ix * symRes + j];
      }
      out[j * symRes + i] = acc;
    }
  }
  return out;
}

// 纯颜色型：中心格 + 邻格（3×3 起的邻域）在中心采样窗内的混色权重。
// 返回 { wSelf, wOther }：wSelf = 中心格自身权重；wOther = 1 − wSelf（邻格总权重）。
export function colorMixingWeights(colCellPx: number, sigmaPsf: number, winFrac: number): { wSelf: number; wOther: number } {
  const { k, R } = blurKernel1D(colCellPx, winFrac, sigmaPsf);
  const wSelf = k[R] * k[R]; // (mx=0, my=0)
  return { wSelf, wOther: Math.max(0, 1 - wSelf) };
}
